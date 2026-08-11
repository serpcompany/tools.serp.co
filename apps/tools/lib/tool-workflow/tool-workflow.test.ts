import assert from "node:assert/strict";
import test from "node:test";

import { createToolWorkflowTestHarness } from "./testing.ts";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_BYTES = new Uint8Array([255, 216, 255, 217]);

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
        size: 4,
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
          name: "video.source",
          format: "remote-video",
          mimeType: "application/octet-stream",
          chunks: [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
        },
      },
    },
    processors: {
      "video-downloader": {
        support: {
          acquisition: "url",
          inputFormats: ["remote-video"],
          outputFormats: ["mp4", "jpg"],
        },
        result: [
          {
            name: "video.mp4",
            format: "mp4",
            mimeType: "video/mp4",
            bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112]),
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
      { name: "video.mp4", format: "mp4", size: 8 },
      { name: "poster.jpg", format: "jpg", size: 4 },
    ],
  );
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
