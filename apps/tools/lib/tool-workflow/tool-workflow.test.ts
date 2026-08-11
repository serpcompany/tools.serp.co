import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createToolWorkflowTestHarness,
  defineScriptedProcessor,
} from "./testing.ts";

function bytes(hex: string) {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function base64Bytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

// Independently generated, parseable 1×1 PNG and JPEG fixtures.
const PNG_BYTES = bytes(
  "89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082",
);
const JPEG_BYTES = base64Bytes(
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z",
);
const MP4_FTYP_BYTES = new Uint8Array([
  0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 2, 0, 105, 115,
  111, 109,
]);
const SAMPLE_MP4_BYTES = new Uint8Array(
  readFileSync(
    new URL("../../benchmarks/fixtures/sample.mp4", import.meta.url),
  ),
);
const JSON_TABLE_BYTES = new TextEncoder().encode(
  '[{"name":"Ada","language":"Analytical Engine"}]',
);
const CSV_TABLE_BYTES = new TextEncoder().encode(
  "name,language\r\nAda,Analytical Engine\r\n",
);

test("a file Tool run crosses one workflow seam from acquisition through delivery", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
    },
  });
  const phases: string[] = [];

  const outcome = await harness.workflow.run(
    {
      toolId: "png-to-jpg",
      input: {
        kind: "file",
        media: {
          name: "photo.png",
          format: "png",
          mimeType: "image/png",
          bytes: PNG_BYTES,
        },
      },
    },
    { observe: (snapshot) => phases.push(snapshot.phase) },
  );

  assert.deepEqual(phases, [
    "acquiring",
    "processing",
    "validating",
    "delivering",
    "succeeded",
  ]);
  assert.deepEqual(outcome, {
    status: "succeeded",
    runId: "run-1",
    results: [
      {
        name: "photo.jpg",
        format: "jpg",
        mimeType: "image/jpeg",
        size: 270,
        deliveryId: "delivery-1",
      },
    ],
    telemetry: { start: "submitted", terminal: "submitted" },
  });
});

test("a URL stream uses the same workflow seam and preserves multiple result order", async () => {
  const harness = createToolWorkflowTestHarness({
    media: {
      urls: {
        "https://media.example/video": {
          name: "video.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          chunks: [
            SAMPLE_MP4_BYTES.subarray(0, 4096),
            SAMPLE_MP4_BYTES.subarray(4096),
          ],
        },
      },
    },
    processors: {
      "video-downloader": {
        support: {
          acquisition: "url",
          inputFormats: ["mp4"],
          outputFormats: ["mp4", "jpg"],
        },
        result: [
          {
            name: "video.mp4",
            format: "mp4",
            mimeType: "video/mp4",
            bytes: SAMPLE_MP4_BYTES,
          },
          {
            name: "poster.jpg",
            format: "jpg",
            mimeType: "image/jpeg",
            bytes: JPEG_BYTES,
          },
        ],
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://media.example/video" },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(
    outcome.results.map(({ name, format, size }) => ({ name, format, size })),
    [
      { name: "video.mp4", format: "mp4", size: 12429 },
      { name: "poster.jpg", format: "jpg", size: 270 },
    ],
  );
});

test("a text/table processor succeeds only with a structurally valid table result", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "json-to-csv": {
        support: {
          acquisition: "file",
          inputFormats: ["txt"],
          outputFormats: ["csv"],
          requestedOperation: "table-convert",
          outputCardinality: { min: 1, max: 1 },
        },
        result: {
          name: "people.csv",
          format: "csv",
          mimeType: "text/csv",
          bytes: CSV_TABLE_BYTES,
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "json-to-csv",
    input: {
      kind: "file",
      media: {
        name: "people.json",
        format: "txt",
        mimeType: "text/plain",
        bytes: JSON_TABLE_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(
    outcome.results.map(({ format, mimeType, size }) => ({
      format,
      mimeType,
      size,
    })),
    [{ format: "csv", mimeType: "text/csv", size: 38 }],
  );
});

test("an empty text/table result is rejected before delivery", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "json-to-csv": {
        support: {
          acquisition: "file",
          inputFormats: ["txt"],
          outputFormats: ["csv"],
        },
        result: {
          name: "people.csv",
          format: "csv",
          mimeType: "text/csv",
          bytes: new Uint8Array(),
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "json-to-csv",
    input: {
      kind: "file",
      media: {
        name: "people.json",
        format: "txt",
        mimeType: "text/plain",
        bytes: JSON_TABLE_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-result");
  assert.equal(harness.events.includes("delivery"), false);
});

test("a malformed table with inconsistent row cardinality is rejected before delivery", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "json-to-csv": {
        support: {
          acquisition: "file",
          inputFormats: ["txt"],
          outputFormats: ["csv"],
        },
        result: {
          name: "people.csv",
          format: "csv",
          mimeType: "text/csv",
          bytes: new TextEncoder().encode("name,language\r\nAda\r\n"),
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "json-to-csv",
    input: {
      kind: "file",
      media: {
        name: "people.json",
        format: "txt",
        mimeType: "text/plain",
        bytes: JSON_TABLE_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-result");
  assert.equal(harness.events.includes("delivery"), false);
});

test("processor-owned semantic validators can enforce transcript invariants", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "audio-to-text": {
        support: {
          acquisition: "file",
          inputFormats: ["mp4"],
          outputFormats: ["txt"],
        },
        validators: {
          output(result) {
            const transcript = new TextDecoder().decode(result.bytes);
            return transcript.includes("[00:00]")
              ? { status: "verified" }
              : {
                  status: "rejected",
                  message: "Transcript is missing timestamped speech",
                };
          },
        },
        result: {
          name: "transcript.txt",
          format: "txt",
          mimeType: "text/plain",
          bytes: new TextEncoder().encode("processor says success"),
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "audio-to-text",
    input: {
      kind: "file",
      media: {
        name: "speech.mp4",
        format: "mp4",
        mimeType: "video/mp4",
        bytes: SAMPLE_MP4_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-result");
  assert.equal(
    outcome.error.message,
    "Transcript is missing timestamped speech",
  );
  assert.equal(harness.events.includes("delivery"), false);
});

test("invalid and unsupported requests fail closed before processor execution", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "fallback.png",
          format: "png",
          mimeType: "image/png",
          bytes: PNG_BYTES,
        },
      },
    },
  });

  const invalid = await harness.workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "spoofed.png",
        format: "png",
        mimeType: "image/png",
        bytes: new TextEncoder().encode("not a png"),
      },
    },
  });
  const unsupportedRequest = await harness.workflow.run({
    toolId: "png-to-jpg",
    input: { kind: "url", url: "https://media.example/photo" },
  });
  const unsupported = await harness.workflow.run({
    toolId: "not-a-tool",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });

  assert.equal(invalid.status, "failed");
  assert.equal(invalid.error.code, "invalid-request");
  assert.equal(unsupportedRequest.status, "failed");
  assert.equal(unsupportedRequest.error.code, "unsupported-request");
  assert.equal(unsupported.status, "failed");
  assert.equal(unsupported.error.code, "unsupported-tool");
  assert.deepEqual(harness.events, []);
});

test("exact processor support rejects an unsupported operation before fallback execution", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-avif": {
        engineId: "browser-raster-worker",
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["avif"],
          requestedOperation: "convert",
          resourceLimits: {
            maxInputBytes: 1_024,
            maxOutputBytes: 1_024,
            maxTotalOutputBytes: 1_024,
          },
          outputCardinality: { min: 1, max: 1 },
        },
        decideSupport(request) {
          assert.deepEqual(request, {
            detectedInput: {
              acquisition: "file",
              format: "png",
              mimeType: "image/png",
              bytes: PNG_BYTES.byteLength,
            },
            requestedOperation: "convert",
            options: { quality: 82 },
            outputs: [{ format: "avif", mimeType: "image/avif" }],
          });
          return {
            supported: false,
            message: "browser raster engine has no verified AVIF encoder",
          };
        },
        parseOptions(value) {
          return { ok: true, value };
        },
        result: {
          name: "generic-fallback.png",
          format: "png",
          mimeType: "image/png",
          bytes: PNG_BYTES,
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "png-to-avif",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
    options: { quality: 82 },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "unsupported-request");
  assert.equal(
    outcome.error.message,
    "browser raster engine has no verified AVIF encoder",
  );
  assert.deepEqual(harness.events, []);
});

test("declared input resource limits reject work before processor execution", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
          resourceLimits: {
            maxInputBytes: PNG_BYTES.byteLength - 1,
            maxOutputBytes: 1_024,
            maxTotalOutputBytes: 1_024,
          },
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "unsupported-request");
  assert.equal(harness.events.length, 0);
});

test("semantic validation rejects wrong-format bytes before delivery", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: PNG_BYTES,
        },
      },
    },
  });
  const phases: string[] = [];

  const outcome = await harness.workflow.run(
    {
      toolId: "png-to-jpg",
      input: {
        kind: "file",
        media: {
          name: "photo.png",
          format: "png",
          mimeType: "image/png",
          bytes: PNG_BYTES,
        },
      },
    },
    { observe: ({ phase }) => phases.push(phase) },
  );

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-result");
  assert.deepEqual(phases, ["acquiring", "processing", "validating", "failed"]);
  assert.deepEqual(harness.events, [
    "telemetry:start",
    "processor:png-to-jpg",
    "telemetry:terminal",
  ]);
});

test("workflow rejects processor output with the wrong declared cardinality", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
          outputCardinality: { min: 1, max: 1 },
        },
        result: [
          {
            name: "photo.jpg",
            format: "jpg",
            mimeType: "image/jpeg",
            bytes: JPEG_BYTES,
          },
          {
            name: "processor-success.jpg",
            format: "jpg",
            mimeType: "image/jpeg",
            bytes: JPEG_BYTES,
          },
        ],
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-result");
  assert.match(outcome.error.message, /Expected 1\.\.1 results, received 2/);
  assert.equal(harness.events.includes("delivery"), false);
});

test("declared output resource limits reject results before delivery", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
          resourceLimits: {
            maxInputBytes: 1_024,
            maxOutputBytes: JPEG_BYTES.byteLength - 1,
            maxTotalOutputBytes: JPEG_BYTES.byteLength - 1,
          },
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-result");
  assert.equal(harness.events.includes("delivery"), false);
});

test("progress is normalized and monotonic while indeterminate phases stay unquantified", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        progress: [0.8, 0.2, 1.5],
        lateProgress: [0.4],
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
    },
  });
  const snapshots: Array<{ phase: string; progress?: number }> = [];

  await harness.workflow.run(
    {
      toolId: "png-to-jpg",
      input: {
        kind: "file",
        media: {
          name: "photo.png",
          format: "png",
          mimeType: "image/png",
          bytes: PNG_BYTES,
        },
      },
    },
    { observe: (snapshot) => snapshots.push(snapshot) },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(
    snapshots.map(({ phase }) => phase),
    [
      "acquiring",
      "processing",
      "processing",
      "processing",
      "validating",
      "delivering",
      "succeeded",
    ],
  );
  assert.deepEqual(
    snapshots.flatMap(({ progress }) =>
      progress === undefined ? [] : [progress],
    ),
    [0.61, 0.7],
  );
  assert.equal(snapshots[0]?.progress, undefined);
  assert.equal(
    snapshots.find(({ phase }) => phase === "validating")?.progress,
    undefined,
  );
});

test("cancellation reaches every phase and releases every acquired resource", async () => {
  for (const cancelledPhase of [
    "acquiring",
    "processing",
    "validating",
    "delivering",
  ] as const) {
    const harness = createToolWorkflowTestHarness({
      resources: {
        acquiring: ["reader", "blob"],
        processing: ["worker"],
        validating: ["subscription"],
        delivering: ["object-url"],
      },
      processors: {
        "png-to-jpg": {
          support: {
            acquisition: "file",
            inputFormats: ["png"],
            outputFormats: ["jpg"],
          },
          result: {
            name: "photo.jpg",
            format: "jpg",
            mimeType: "image/jpeg",
            bytes: JPEG_BYTES,
          },
        },
      },
    });
    const controller = new AbortController();
    const phases: string[] = [];

    const outcome = await harness.workflow.run(
      {
        toolId: "png-to-jpg",
        input: {
          kind: "file",
          media: {
            name: "photo.png",
            format: "png",
            mimeType: "image/png",
            bytes: PNG_BYTES,
          },
        },
      },
      {
        signal: controller.signal,
        observe(snapshot) {
          phases.push(snapshot.phase);
          if (snapshot.phase === cancelledPhase) {
            controller.abort("test cancellation");
          }
        },
      },
    );

    assert.equal(outcome.status, "cancelled", cancelledPhase);
    assert.equal(phases.at(-1), "cancelled", cancelledPhase);
    assert.equal(
      phases.filter((phase) =>
        ["succeeded", "failed", "cancelled"].includes(phase),
      ).length,
      1,
      cancelledPhase,
    );
    assert.deepEqual(harness.activeResources, [], cancelledPhase);
    assert.deepEqual(
      harness.openedResources,
      [...harness.releasedResources].reverse(),
      cancelledPhase,
    );
  }
});

test("processor failure and late callbacks produce one failed terminal outcome", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        error: new Error("codec crashed"),
        lateProgress: [0.5, 1],
        lateResources: ["object-url"],
        lateCleanups: ["subscription"],
        result: {
          name: "must-not-deliver.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
    },
  });
  const phases: string[] = [];

  const outcome = await harness.workflow.run(
    {
      toolId: "png-to-jpg",
      input: {
        kind: "file",
        media: {
          name: "photo.png",
          format: "png",
          mimeType: "image/png",
          bytes: PNG_BYTES,
        },
      },
    },
    { observe: ({ phase }) => phases.push(phase) },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "processor-failed");
  assert.equal(outcome.error.message, "codec crashed");
  assert.deepEqual(phases, ["acquiring", "processing", "failed"]);
  assert.deepEqual(harness.events, [
    "telemetry:start",
    "processor:png-to-jpg",
    "telemetry:terminal",
  ]);
  assert.deepEqual(harness.activeResources, []);
  assert.deepEqual(harness.openedResources, []);
  assert.deepEqual(harness.lateCleanupActive, []);
  assert.deepEqual(harness.lateCleanupReleased, ["subscription"]);
});

test("telemetry transport failure remains evidence without redefining success", async () => {
  const harness = createToolWorkflowTestHarness({
    telemetry: { failStart: true, failTerminal: true },
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(outcome.telemetry, { start: "failed", terminal: "failed" });
  assert.equal(
    harness.events.filter((event) => event === "telemetry:start").length,
    1,
  );
  assert.equal(
    harness.events.filter((event) => event === "telemetry:terminal").length,
    1,
  );
});

test("in-memory clock and id adapters make telemetry identity and ordering deterministic", async () => {
  const harness = createToolWorkflowTestHarness({
    clock: { times: [1_000, 1_250] },
    ids: { run: ["proof-run"], delivery: ["proof-delivery"] },
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });

  assert.equal(outcome.runId, "proof-run");
  assert.equal(outcome.status, "succeeded");
  assert.equal(outcome.results[0]?.deliveryId, "proof-delivery");
  assert.deepEqual(harness.telemetryRecords, [
    { kind: "start", runId: "proof-run", at: 1_000 },
    { kind: "terminal", runId: "proof-run", status: "succeeded", at: 1_250 },
  ]);
});

test("an observer throwing at terminal success cannot create a conflicting outcome", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
    },
  });
  const observedTerminals: string[] = [];

  const outcome = await harness.workflow.run(
    {
      toolId: "png-to-jpg",
      input: {
        kind: "file",
        media: {
          name: "photo.png",
          format: "png",
          mimeType: "image/png",
          bytes: PNG_BYTES,
        },
      },
    },
    {
      observe(snapshot) {
        if (["succeeded", "failed", "cancelled"].includes(snapshot.phase)) {
          observedTerminals.push(snapshot.phase);
        }
        if (snapshot.phase === "succeeded") {
          throw new Error("presentation listener crashed");
        }
      },
    },
  );

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(observedTerminals, ["succeeded"]);
  assert.deepEqual(
    harness.telemetryRecords.filter(({ kind }) => kind === "terminal"),
    [
      {
        kind: "terminal",
        runId: "run-1",
        status: "succeeded",
        at: 0,
      },
    ],
  );
});

test("mid-stream URL cancellation closes the reader before processing or delivery", async () => {
  const harness = createToolWorkflowTestHarness({
    media: {
      urls: {
        "https://media.example/large-video": {
          name: "video.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          chunks: [
            SAMPLE_MP4_BYTES.subarray(0, 4096),
            SAMPLE_MP4_BYTES.subarray(4096, 8192),
            SAMPLE_MP4_BYTES.subarray(8192),
          ],
          totalBytes: SAMPLE_MP4_BYTES.byteLength,
        },
      },
    },
    processors: {
      "video-downloader": {
        support: {
          acquisition: "url",
          inputFormats: ["mp4"],
          outputFormats: ["mp4"],
        },
        result: {
          name: "video.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          bytes: SAMPLE_MP4_BYTES,
        },
      },
    },
  });
  const controller = new AbortController();

  const outcome = await harness.workflow.run(
    {
      toolId: "video-downloader",
      input: { kind: "url", url: "https://media.example/large-video" },
    },
    {
      signal: controller.signal,
      observe(snapshot) {
        if (snapshot.phase === "acquiring" && snapshot.progress !== undefined) {
          controller.abort("stop streaming");
        }
      },
    },
  );

  assert.equal(outcome.status, "cancelled");
  assert.deepEqual(harness.streamRecords, [
    {
      url: "https://media.example/large-video",
      chunksRead: 1,
      cancelled: true,
      readerLockReleased: true,
    },
  ]);
  assert.deepEqual(harness.events, []);
});

test("semantic verification fails closed for malformed MP4 and unknown formats", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "bad-mp4": {
        engineId: "browser-raster-worker",
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["mp4"],
        },
        result: {
          name: "video.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          bytes: new Uint8Array([
            0, 0, 0, 20, 110, 111, 112, 101, 105, 115, 111, 109, 0, 0, 2, 0,
            105, 115, 111, 109,
          ]),
        },
      },
      "unknown-output": {
        engineId: "browser-raster-worker",
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["mystery"],
        },
        result: {
          name: "result.mystery",
          format: "mystery",
          mimeType: "application/x-mystery",
          bytes: new Uint8Array([1, 2, 3]),
        },
      },
    },
  });
  const input = {
    kind: "file" as const,
    media: {
      name: "photo.png",
      format: "png",
      mimeType: "image/png",
      bytes: PNG_BYTES,
    },
  };

  const malformed = await harness.workflow.run({ toolId: "bad-mp4", input });
  const unknown = await harness.workflow.run({
    toolId: "unknown-output",
    input,
  });

  assert.equal(malformed.status, "failed");
  assert.equal(malformed.error.code, "invalid-result");
  assert.equal(unknown.status, "failed");
  assert.equal(unknown.error.code, "invalid-result");
  assert.equal(
    harness.events.filter((event) => event === "delivery").length,
    0,
  );
});

test("an ftyp-only MP4 artifact is rejected before delivery", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "ftyp-only": {
        engineId: "browser-raster-worker",
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["mp4"],
        },
        result: {
          name: "video.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          bytes: MP4_FTYP_BYTES,
        },
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "ftyp-only",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-result");
  assert.equal(
    harness.events.filter((event) => event === "delivery").length,
    0,
  );
});

test("typed options and engine support policy stay behind the run seam", async () => {
  const processor = defineScriptedProcessor<{ quality: number }>({
    engineId: "browser-raster-worker",
    support: {
      acquisition: "file",
      inputFormats: ["png"],
      outputFormats: ["jpg"],
    },
    parseOptions(value) {
      const quality = (value as { quality?: unknown } | undefined)?.quality;
      return typeof quality === "number" && quality >= 1 && quality <= 100
        ? { ok: true, value: { quality } }
        : { ok: false, message: "quality must be between 1 and 100" };
    },
    result: {
      name: "photo.jpg",
      format: "jpg",
      mimeType: "image/jpeg",
      bytes: JPEG_BYTES,
    },
  });
  const harness = createToolWorkflowTestHarness({
    processors: { "png-to-jpg": processor },
  });
  const request = {
    toolId: "png-to-jpg",
    input: {
      kind: "file" as const,
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  };

  const succeeded = await harness.workflow.run({
    ...request,
    options: { quality: 82 },
  });
  const invalid = await harness.workflow.run({
    ...request,
    options: { quality: "maximum" },
  });

  assert.equal(succeeded.status, "succeeded");
  assert.equal(invalid.status, "failed");
  assert.equal(invalid.error.code, "invalid-request");
  assert.deepEqual(harness.processorRecords, [
    {
      toolId: "png-to-jpg",
      engine: {
        id: "browser-raster-worker",
        capability: "raster-conversion",
        owner: "apps/tools/lib/convert/workerClient.ts",
        processingLocation: "browser",
        executionProfile: "client-only",
        implementation: {
          class: "hybrid",
          identity: "@jsquash codecs, UPNG.js, and @imagemagick/magick-wasm",
          rationale:
            "Repository dispatch selects trusted codecs without implementing image codecs.",
        },
      },
      support: {
        acquisition: "file",
        inputs: [{ format: "png", mimeTypes: ["image/png"] }],
        outputs: [{ format: "jpg", mimeType: "image/jpeg" }],
        requestedOperation: "process",
        resourceLimits: {
          maxInputBytes: Number.MAX_SAFE_INTEGER,
          maxOutputBytes: Number.MAX_SAFE_INTEGER,
          maxTotalOutputBytes: Number.MAX_SAFE_INTEGER,
        },
        outputCardinality: { min: 1, max: 1 },
      },
      options: { quality: 82 },
    },
  ]);
});

test("scripted processors use canonical execution provenance records", async () => {
  const harness = createToolWorkflowTestHarness({
    media: {
      urls: {
        "https://media.example/video.mp4": {
          name: "source.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          chunks: [SAMPLE_MP4_BYTES],
        },
      },
    },
    processors: {
      "png-to-jpg": {
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
      "video-downloader": {
        support: {
          acquisition: "url",
          inputFormats: ["mp4"],
          outputFormats: ["mp4"],
        },
        result: {
          name: "video.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          bytes: SAMPLE_MP4_BYTES,
        },
      },
    },
  });

  await harness.workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });
  await harness.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://media.example/video.mp4" },
  });

  assert.deepEqual(
    harness.processorRecords.map(({ engine }) => engine),
    [
      {
        id: "browser-raster-worker",
        capability: "raster-conversion",
        owner: "apps/tools/lib/convert/workerClient.ts",
        processingLocation: "browser",
        executionProfile: "client-only",
        implementation: {
          class: "hybrid",
          identity: "@jsquash codecs, UPNG.js, and @imagemagick/magick-wasm",
          rationale:
            "Repository dispatch selects trusted codecs without implementing image codecs.",
        },
      },
      {
        id: "server-media-fetch",
        capability: "public-media-download",
        owner: "apps/tools/app/api/media-fetch/route.ts",
        processingLocation: "repository-server",
        executionProfile: "server-executed",
        implementation: {
          class: "hybrid",
          identity:
            "youtube-dl-exec, repository extractors, Fetch API, and ReadableStream",
          rationale:
            "Repository dispatch validates public sources, selects extraction or direct streaming, and preserves backpressure through platform streams.",
        },
      },
    ],
  );
});

test("truncated PNG input and JPEG output fail structural verification", async () => {
  const harness = createToolWorkflowTestHarness({
    processors: {
      "truncated-png": {
        engineId: "browser-raster-worker",
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES,
        },
      },
      "truncated-jpeg": {
        engineId: "browser-raster-worker",
        support: {
          acquisition: "file",
          inputFormats: ["png"],
          outputFormats: ["jpg"],
        },
        result: {
          name: "photo.jpg",
          format: "jpg",
          mimeType: "image/jpeg",
          bytes: JPEG_BYTES.subarray(0, JPEG_BYTES.byteLength - 1),
        },
      },
    },
  });

  const truncatedInput = await harness.workflow.run({
    toolId: "truncated-png",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES.subarray(0, PNG_BYTES.byteLength - 4),
      },
    },
  });
  const truncatedOutput = await harness.workflow.run({
    toolId: "truncated-jpeg",
    input: {
      kind: "file",
      media: {
        name: "photo.png",
        format: "png",
        mimeType: "image/png",
        bytes: PNG_BYTES,
      },
    },
  });

  assert.equal(truncatedInput.status, "failed");
  assert.equal(truncatedInput.error.code, "invalid-request");
  assert.equal(truncatedOutput.status, "failed");
  assert.equal(truncatedOutput.error.code, "invalid-result");
  assert.equal(
    harness.events.filter((event) => event === "delivery").length,
    0,
  );
});

test("aborting a stalled URL stream immediately unblocks and releases its reader", async () => {
  const harness = createToolWorkflowTestHarness({
    media: {
      urls: {
        "https://media.example/stalled.mp4": {
          name: "stalled.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          chunks: [],
          totalBytes: SAMPLE_MP4_BYTES.byteLength,
          stallAfterChunks: 0,
        },
      },
    },
    processors: {
      "video-downloader": {
        support: {
          acquisition: "url",
          inputFormats: ["mp4"],
          outputFormats: ["mp4"],
        },
        result: {
          name: "video.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          bytes: SAMPLE_MP4_BYTES,
        },
      },
    },
  });
  const controller = new AbortController();
  const run = harness.workflow.run(
    {
      toolId: "video-downloader",
      input: { kind: "url", url: "https://media.example/stalled.mp4" },
    },
    {
      signal: controller.signal,
      observe(snapshot) {
        if (snapshot.phase === "acquiring") {
          setTimeout(() => controller.abort("cancel stalled reader"), 0);
        }
      },
    },
  );
  const timeout = Symbol("timeout");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    run,
    new Promise<typeof timeout>(
      (resolve) => (timeoutId = setTimeout(() => resolve(timeout), 250)),
    ),
  ]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (settled === timeout) {
    assert.fail("stalled reader did not unblock on abort");
  }
  assert.equal(settled.status, "cancelled");
  assert.deepEqual(harness.streamRecords, [
    {
      url: "https://media.example/stalled.mp4",
      chunksRead: 0,
      cancelled: true,
      readerLockReleased: true,
    },
  ]);
  assert.deepEqual(harness.events, []);
});
