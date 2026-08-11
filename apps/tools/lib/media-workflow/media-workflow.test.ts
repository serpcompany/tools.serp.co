import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getToolProcessorAvailability } from "../tool-processor-registry.ts";
import {
  getMediaWorkflowAdapterRegistration,
  mediaWorkflowAdapterRegistrations,
} from "./adapter-registration.ts";
import {
  BROWSER_MEDIA_MEMORY_BUDGET,
  MediaEndpointError,
} from "./media-endpoint.ts";
import { createMediaWorkflowTestHarness } from "./testing.ts";

const SAMPLE_MP4_BYTES = new Uint8Array(
  readFileSync(
    new URL("../../benchmarks/fixtures/sample.mp4", import.meta.url),
  ),
);
const SAMPLE_MP3_BYTES = new Uint8Array(
  readFileSync(
    new URL("../../benchmarks/fixtures/sample.mp3", import.meta.url),
  ),
);
const SAMPLE_WEBM_BYTES = new Uint8Array(
  readFileSync(
    new URL("../../benchmarks/fixtures/sample.webm", import.meta.url),
  ),
);

test("scoped downloader and transcription Tool ids register the media workflow adapter", () => {
  assert.equal(mediaWorkflowAdapterRegistrations.length, 300);
  for (const [toolId, family] of [
    ["video-downloader", "downloader"],
    ["download-loom-videos", "downloader"],
    ["audio-to-text", "transcription"],
    ["audio-to-transcript", "transcription"],
    ["youtube-to-transcript-generator", "transcription"],
  ] as const) {
    assert.deepEqual(getMediaWorkflowAdapterRegistration(toolId), {
      toolId,
      family,
      adapterId: "streamed-media-workflow",
    });
    assert.deepEqual(getToolProcessorAvailability(toolId), {
      kind: "wired",
      toolId,
      adapterId: "streamed-media-workflow",
    });
  }
  assert.equal(getMediaWorkflowAdapterRegistration("png-to-jpg"), undefined);
});

test("audio-to-text is an explicit TranscribeTool route alias", () => {
  const source = readFileSync(
    new URL("../../app/audio-to-text/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /import TranscribeTool from ['"]@\/components\/TranscribeTool['"]/);
  assert.match(source, /const toolId = ['"]audio-to-text['"]/);
  assert.match(source, /<TranscribeTool[\s\S]*toolId={toolId}/);
});
test("every downloader Tool id attempts its endpoint once and records the actual failure once", async (t) => {
  for (const toolId of [
    "download-ashemaletube-videos",
    "download-beeg-videos",
    "download-boyfriendtv-videos",
    "download-eporner-videos",
    "download-xhamster-videos",
  ]) {
    await t.test(toolId, async () => {
      const harness = createMediaWorkflowTestHarness({});
      const outcome = await harness.workflow.run({
        toolId,
        input: { kind: "url", url: "https://source.invalid/video" },
      });

      assert.equal(outcome.status, "failed");
      assert.equal(outcome.error.code, "acquisition-failed");
      assert.deepEqual(harness.endpoint.requests, [
        {
          consumer: "downloader",
          mode: "video",
          url: "https://source.invalid/video",
        },
      ]);
      assert.deepEqual(harness.deliveries, []);
      assert.deepEqual(harness.telemetry, [
        { kind: "start" },
        { kind: "terminal", status: "failed" },
      ]);
    });
  }
});

test("workflow failure preserves explicit endpoint recovery without inventing it for ordinary failures", async () => {
  const extensionRequired = createMediaWorkflowTestHarness({
    media: {
      "https://source.example/extension": {
        error: new MediaEndpointError("Browser integration required", {
          kind: "browser-extension-required",
        }),
        chunks: [],
      },
    },
  });
  const ordinary = createMediaWorkflowTestHarness({
    media: {
      "https://source.example/unavailable": {
        error: new Error("Source unavailable"),
        chunks: [],
      },
    },
  });

  const extensionOutcome = await extensionRequired.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://source.example/extension" },
  });
  const ordinaryOutcome = await ordinary.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://source.example/unavailable" },
  });

  assert.equal(extensionOutcome.status, "failed");
  assert.deepEqual(
    (extensionOutcome.error as typeof extensionOutcome.error & {
      recovery?: unknown;
    }).recovery,
    { kind: "browser-extension-required" },
  );
  assert.equal(ordinaryOutcome.status, "failed");
  assert.equal(
    (ordinaryOutcome.error as typeof ordinaryOutcome.error & {
      recovery?: unknown;
    }).recovery,
    undefined,
  );
});

test("downloader URL streams cross workflow.run and preserve verified media", async () => {
  const harness = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/watch/unsafe-name": {
        name: "../unsafe-name",
        extension: "mp4",
        mimeType: "video/mp4",
        totalBytes: SAMPLE_MP4_BYTES.byteLength,
        chunks: [
          SAMPLE_MP4_BYTES.subarray(0, 4_096),
          SAMPLE_MP4_BYTES.subarray(4_096),
        ],
      },
    },
  });
  const snapshots: Array<{ phase: string; progress?: number }> = [];

  const outcome = await harness.workflow.run(
    {
      toolId: "video-downloader",
      input: {
        kind: "url",
        url: "https://media.example/watch/unsafe-name",
      },
      options: { mode: "video" },
    },
    { observe: (snapshot) => snapshots.push(snapshot) },
  );

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(outcome.results, [
    {
      name: "unsafe-name.mp4",
      format: "mp4",
      mimeType: "video/mp4",
      size: SAMPLE_MP4_BYTES.byteLength,
      deliveryId: "delivery-1",
    },
  ]);
  assert.deepEqual(harness.endpoint.requests, [
    {
      consumer: "downloader",
      mode: "video",
      url: "https://media.example/watch/unsafe-name",
    },
  ]);
  assert.deepEqual(harness.deliveries[0], {
    name: "unsafe-name.mp4",
    format: "mp4",
    mimeType: "video/mp4",
    bytes: SAMPLE_MP4_BYTES,
  });
  assert.deepEqual(
    snapshots.map(({ phase }) => phase),
    [
      "acquiring",
      "acquiring",
      "acquiring",
      "processing",
      "processing",
      "validating",
      "delivering",
      "succeeded",
    ],
  );
  assert.deepEqual(
    harness.telemetry.map(({ kind, status }) => ({ kind, status })),
    [
      { kind: "start", status: undefined },
      { kind: "terminal", status: "succeeded" },
    ],
  );
  assert.deepEqual(harness.endpoint.streams, [
    { chunksRead: 2, cancelled: false, readerLockReleased: true },
  ]);
  assert.deepEqual(harness.transfers, [
    {
      receivedBytes: 4_096,
      totalBytes: SAMPLE_MP4_BYTES.byteLength,
      ratio: 4_096 / SAMPLE_MP4_BYTES.byteLength,
      bytesPerSecond: 4_096,
      etaSeconds: (SAMPLE_MP4_BYTES.byteLength - 4_096) / 4_096,
    },
    {
      receivedBytes: SAMPLE_MP4_BYTES.byteLength,
      totalBytes: SAMPLE_MP4_BYTES.byteLength,
      ratio: 1,
      bytesPerSecond: SAMPLE_MP4_BYTES.byteLength / 2,
      etaSeconds: 0,
    },
  ]);
});

test("declared media length must match stream EOF before processing or delivery", async (t) => {
  for (const media of [
    {
      bytes: SAMPLE_MP3_BYTES,
      format: "mp3",
      mimeType: "audio/mpeg",
      toolId: "mp3-to-transcript",
    },
    {
      bytes: SAMPLE_WEBM_BYTES,
      format: "webm",
      mimeType: "video/webm",
      toolId: "video-downloader",
    },
  ]) {
    await t.test(media.format, async () => {
      const url = `https://media.example/truncated.${media.format}`;
      const harness = createMediaWorkflowTestHarness({
        media: {
          [url]: {
            name: `truncated.${media.format}`,
            extension: media.format,
            mimeType: media.mimeType,
            totalBytes: media.bytes.byteLength,
            chunks: [
              media.bytes.subarray(
                0,
                Math.floor(media.bytes.byteLength * 0.75),
              ),
            ],
          },
        },
      });

      const outcome = await harness.workflow.run({
        toolId: media.toolId,
        input: { kind: "url", url },
      });

      assert.equal(outcome.status, "failed");
      assert.equal(outcome.error.code, "acquisition-failed");
      assert.deepEqual(harness.deliveries, []);
      assert.deepEqual(harness.endpoint.streams, [
        { chunksRead: 1, cancelled: false, readerLockReleased: true },
      ]);
      assert.deepEqual(harness.telemetry, [
        { kind: "start" },
        { kind: "terminal", status: "failed" },
      ]);
    });
  }

  await t.test("omitted length", async () => {
    const url = "https://media.example/chunked.mp3";
    const harness = createMediaWorkflowTestHarness({
      media: {
        [url]: {
          name: "chunked.mp3",
          extension: "mp3",
          mimeType: "audio/mpeg",
          chunks: [
            SAMPLE_MP3_BYTES.subarray(0, 2_000),
            SAMPLE_MP3_BYTES.subarray(2_000),
          ],
        },
      },
    });

    const outcome = await harness.workflow.run({
      toolId: "mp3-to-transcript",
      input: { kind: "url", url },
    });

    assert.equal(outcome.status, "succeeded");
    assert.equal(harness.deliveries[0]?.format, "txt");
  });

  await t.test("stream exceeds declared length", async () => {
    const url = "https://media.example/underdeclared.webm";
    const harness = createMediaWorkflowTestHarness({
      media: {
        [url]: {
          name: "underdeclared.webm",
          extension: "webm",
          mimeType: "video/webm",
          totalBytes: SAMPLE_WEBM_BYTES.byteLength - 1,
          chunks: [SAMPLE_WEBM_BYTES],
        },
      },
    });

    const outcome = await harness.workflow.run({
      toolId: "video-downloader",
      input: { kind: "url", url },
    });

    assert.equal(outcome.status, "failed");
    assert.equal(outcome.error.code, "acquisition-failed");
    assert.deepEqual(harness.transfers, []);
    assert.deepEqual(harness.endpoint.streams, [
      { chunksRead: 1, cancelled: true, readerLockReleased: true },
    ]);
    assert.deepEqual(harness.deliveries, []);
  });
});

test("browser transfer cap rejects declared and streamed excess during acquisition", async (t) => {
  const parserLimit = BROWSER_MEDIA_MEMORY_BUDGET.maxTransferBytes;

  await t.test("declared excess", async () => {
    const url = "https://media.example/declared-too-large.mp4";
    const harness = createMediaWorkflowTestHarness({
      media: {
        [url]: {
          name: "declared-too-large.mp4",
          extension: "mp4",
          mimeType: "video/mp4",
          totalBytes: parserLimit + 1,
          chunks: [new Uint8Array([0])],
        },
      },
    });

    const outcome = await harness.workflow.run({
      toolId: "video-downloader",
      input: { kind: "url", url },
    });

    assert.equal(outcome.status, "failed");
    assert.equal(outcome.error.code, "acquisition-failed");
    assert.deepEqual(harness.transfers, []);
    assert.deepEqual(harness.deliveries, []);
    assert.deepEqual(harness.endpoint.streams, [
      { chunksRead: 0, cancelled: true, readerLockReleased: true },
    ]);
  });

  await t.test("streamed excess", async () => {
    const url = "https://media.example/streamed-too-large.mp4";
    const halfLimit = new Uint8Array(parserLimit / 2);
    const harness = createMediaWorkflowTestHarness({
      media: {
        [url]: {
          name: "streamed-too-large.mp4",
          extension: "mp4",
          mimeType: "video/mp4",
          chunks: [
            halfLimit,
            halfLimit,
            new Uint8Array([1]),
            new Uint8Array([2]),
          ],
        },
      },
    });

    const outcome = await harness.workflow.run({
      toolId: "video-downloader",
      input: { kind: "url", url },
    });

    assert.equal(outcome.status, "failed");
    assert.equal(outcome.error.code, "acquisition-failed");
    assert.equal(harness.transfers.length, 2);
    assert.deepEqual(harness.deliveries, []);
    assert.deepEqual(harness.endpoint.streams, [
      { chunksRead: 3, cancelled: true, readerLockReleased: true },
    ]);
  });
});

test("cancelling from the delivering snapshot prevents every delivery side effect", async () => {
  const harness = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/cancel-before-delivery": {
        name: "cancel-before-delivery.mp4",
        extension: "mp4",
        mimeType: "video/mp4",
        chunks: [SAMPLE_MP4_BYTES],
      },
    },
  });
  const controller = new AbortController();

  const outcome = await harness.workflow.run(
    {
      toolId: "video-downloader",
      input: {
        kind: "url",
        url: "https://media.example/cancel-before-delivery",
      },
    },
    {
      signal: controller.signal,
      observe({ phase }) {
        if (phase === "delivering") controller.abort("cancel before delivery");
      },
    },
  );

  assert.equal(outcome.status, "cancelled");
  assert.deepEqual(harness.deliveries, []);
  assert.deepEqual(harness.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "cancelled" },
  ]);
});
