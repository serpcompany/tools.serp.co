import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getToolProcessorAvailability } from "../tool-processor-registry.ts";
import { createMediaWorkflowTestHarness } from "./testing.ts";

const SAMPLE_MP4_BYTES = new Uint8Array(
  readFileSync(new URL("../../benchmarks/fixtures/sample.mp4", import.meta.url)),
);

test("presentation callers delegate stream lifecycle and terminal ownership", () => {
  for (const relativePath of [
    "../../components/VideoDownloaderTool.tsx",
    "../../components/TranscribeTool.tsx",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /createBrowser(?:Media|Transcription)Workflow/);
    assert.match(source, /\.run\(/);
    assert.doesNotMatch(
      source,
      /getReader\(|beginToolRun|finishSuccess|finishFailure|transcribe\.worker|new Worker|formatBytes|etaSeconds|saveBlob/,
    );
  }
});

test("scoped downloader and transcription Tool ids register the media workflow adapter", () => {
  for (const toolId of [
    "video-downloader",
    "download-loom-videos",
    "audio-to-transcript",
    "mp3-to-transcript",
    "mp4-to-transcript",
    "video-to-transcript",
    "youtube-to-transcript",
    "youtube-to-transcript-generator",
    "tiktok-to-transcript",
  ]) {
    assert.deepEqual(getToolProcessorAvailability(toolId), {
      kind: "wired",
      toolId,
      adapterId: "streamed-media-workflow",
    });
  }
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

test("URL and file transcription use workflow.run and enforce transcript semantics", async () => {
  const url = "https://media.example/talk";
  const harness = createMediaWorkflowTestHarness({
    media: {
      [url]: {
        name: "talk.mp4",
        extension: "mp4",
        mimeType: "video/mp4",
        chunks: [SAMPLE_MP4_BYTES],
      },
    },
    transcript: "A deterministic local transcript.",
  });

  const fromUrl = await harness.workflow.run({
    toolId: "youtube-to-transcript",
    input: { kind: "url", url },
  });
  const fromFile = await harness.workflow.run({
    toolId: "mp4-to-transcript",
    input: {
      kind: "file",
      media: {
        name: "upload.mp4",
        format: "mp4",
        mimeType: "video/mp4",
        bytes: SAMPLE_MP4_BYTES,
      },
    },
  });

  assert.equal(fromUrl.status, "succeeded");
  assert.equal(fromFile.status, "succeeded");
  assert.deepEqual(harness.endpoint.requests, [{ mode: "audio", url }]);
  assert.deepEqual(
    harness.deliveries.map(({ name, format, mimeType, bytes }) => ({
      name,
      format,
      mimeType,
      text: new TextDecoder().decode(bytes),
    })),
    [
      {
        name: "talk.txt",
        format: "txt",
        mimeType: "text/plain",
        text: "A deterministic local transcript.",
      },
      {
        name: "upload.txt",
        format: "txt",
        mimeType: "text/plain",
        text: "A deterministic local transcript.",
      },
    ],
  );
});

test("legacy media MIME variants keep their accepted public extensions", async () => {
  const harness = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/mobile": {
        name: "mobile",
        mimeType: "audio/3gpp",
        chunks: [new Uint8Array([1, 2, 3, 4])],
      },
      "https://media.example/archive": {
        name: "archive",
        mimeType: "video/x-ms-asf",
        chunks: [new Uint8Array([5, 6, 7, 8])],
      },
    },
  });

  const transcript = await harness.workflow.run({
    toolId: "audio-to-transcript",
    input: { kind: "url", url: "https://media.example/mobile" },
  });
  const download = await harness.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://media.example/archive" },
  });

  assert.equal(transcript.status, "succeeded");
  assert.equal(download.status, "succeeded");
  assert.deepEqual(
    harness.deliveries.map(({ name, format }) => ({ name, format })),
    [
      { name: "mobile.txt", format: "txt" },
      { name: "archive.asf", format: "asf" },
    ],
  );
});

test("empty transcript and mismatched downloader media fail before delivery", async () => {
  const emptyTranscript = createMediaWorkflowTestHarness({
    transcript: "   ",
  });
  const transcriptOutcome = await emptyTranscript.workflow.run({
    toolId: "audio-to-transcript",
    input: {
      kind: "file",
      media: {
        name: "voice.mp3",
        format: "mp3",
        mimeType: "audio/mpeg",
        bytes: new Uint8Array([0x49, 0x44, 0x33, 4]),
      },
    },
  });

  const mismatchedMedia = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/mismatch": {
        name: "track.mp3",
        extension: "mp3",
        mimeType: "video/mp4",
        chunks: [SAMPLE_MP4_BYTES],
      },
    },
  });
  const downloaderOutcome = await mismatchedMedia.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://media.example/mismatch" },
    options: { mode: "video" },
  });

  assert.equal(transcriptOutcome.status, "failed");
  assert.equal(transcriptOutcome.error.code, "invalid-result");
  assert.deepEqual(emptyTranscript.deliveries, []);
  assert.deepEqual(emptyTranscript.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
  assert.equal(downloaderOutcome.status, "failed");
  assert.equal(downloaderOutcome.error.code, "acquisition-failed");
  assert.deepEqual(mismatchedMedia.deliveries, []);
  assert.deepEqual(mismatchedMedia.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
});

test("source failure and cancellation each commit one terminal without late delivery", async () => {
  const sourceFailure = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/failure": {
        error: new Error("Repository media endpoint unavailable"),
        chunks: [],
      },
    },
  });
  const failed = await sourceFailure.workflow.run({
    toolId: "download-loom-videos",
    input: { kind: "url", url: "https://media.example/failure" },
    options: { mode: "video" },
  });

  const cancelledHarness = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/stalled": {
        name: "stalled.mp4",
        extension: "mp4",
        mimeType: "video/mp4",
        chunks: [],
        stallAfterChunks: 0,
      },
    },
  });
  const controller = new AbortController();
  const cancelled = await cancelledHarness.workflow.run(
    {
      toolId: "video-downloader",
      input: { kind: "url", url: "https://media.example/stalled" },
      options: { mode: "video" },
    },
    {
      signal: controller.signal,
      observe({ phase }) {
        if (phase === "acquiring") {
          setTimeout(() => controller.abort("cancel stalled source"), 0);
        }
      },
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(failed.status, "failed");
  assert.equal(failed.error.code, "acquisition-failed");
  assert.deepEqual(sourceFailure.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
  assert.equal(cancelled.status, "cancelled");
  assert.deepEqual(cancelledHarness.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "cancelled" },
  ]);
  assert.deepEqual(cancelledHarness.deliveries, []);
  assert.deepEqual(cancelledHarness.endpoint.streams, [
    { chunksRead: 0, cancelled: true, readerLockReleased: true },
  ]);
});

test("transcription cancellation aborts processor work and releases cleanup", async () => {
  const harness = createMediaWorkflowTestHarness({ stallTranscription: true });
  const controller = new AbortController();
  const outcome = await harness.workflow.run(
    {
      toolId: "mp4-to-transcript",
      input: {
        kind: "file",
        media: {
          name: "talk.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          bytes: SAMPLE_MP4_BYTES,
        },
      },
    },
    {
      signal: controller.signal,
      observe({ phase, progress }) {
        if (phase === "processing" && progress !== undefined) {
          setTimeout(() => controller.abort("cancel processor"), 0);
        }
      },
    },
  );

  assert.equal(outcome.status, "cancelled");
  assert.deepEqual(harness.transcriptionRecords, {
    aborted: true,
    cleanupReleased: true,
  });
  assert.deepEqual(harness.deliveries, []);
  assert.deepEqual(harness.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "cancelled" },
  ]);
});
