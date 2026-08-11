import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMediaWorkflowTestHarness } from "./testing.ts";
import { VERIFIED_MEDIA_FORMATS } from "./verified-formats.ts";

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
const SAMPLE_VIDEO_ONLY_WEBM_BYTES = new Uint8Array(
  readFileSync(
    new URL(
      "../../benchmarks/fixtures/sample-video-only.webm",
      import.meta.url,
    ),
  ),
);

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

test("malformed verified media and unadvertised media both fail closed", async () => {
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

  assert.equal(transcript.status, "failed");
  assert.equal(transcript.error.code, "invalid-request");
  assert.equal(download.status, "failed");
  assert.equal(download.error.code, "acquisition-failed");
  assert.deepEqual(harness.deliveries, []);
});

test("opaque MP4 and fake MP3 bytes fail closed without delivery or success telemetry", async () => {
  const harness = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/opaque-mp4": {
        name: "opaque.mp4",
        extension: "mp4",
        mimeType: "application/octet-stream",
        chunks: [new TextEncoder().encode("not an MP4")],
      },
      "https://media.example/fake-mp3": {
        name: "fake.mp3",
        extension: "mp3",
        mimeType: "audio/mpeg",
        chunks: [new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0])],
      },
    },
  });

  const opaqueMp4 = await harness.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://media.example/opaque-mp4" },
  });
  const fakeMp3 = await harness.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://media.example/fake-mp3" },
    options: { mode: "audio" },
  });

  assert.equal(opaqueMp4.status, "failed");
  assert.equal(opaqueMp4.error.code, "invalid-request");
  assert.equal(fakeMp3.status, "failed");
  assert.equal(fakeMp3.error.code, "invalid-request");
  assert.deepEqual(harness.deliveries, []);
  assert.deepEqual(harness.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
});

test("a real MP3 reaches scoped transcription while an ID3-only lookalike fails closed", async () => {
  for (const [index, mimeType] of [
    "audio/mpeg",
    "application/octet-stream",
  ].entries()) {
    const url = `https://media.example/verified-${index}.mp3`;
    const valid = createMediaWorkflowTestHarness({
      media: {
        [url]: {
          name: "verified.mp3",
          extension: "mp3",
          mimeType,
          chunks: [SAMPLE_MP3_BYTES],
        },
      },
      transcript: "Verified MP3 transcript.",
    });
    const validOutcome = await valid.workflow.run({
      toolId: "mp3-to-transcript",
      input: { kind: "url", url },
    });

    assert.equal(validOutcome.status, "succeeded", mimeType);
    assert.equal(
      new TextDecoder().decode(valid.deliveries[0]?.bytes),
      "Verified MP3 transcript.",
      mimeType,
    );
  }

  const invalid = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/lookalike.mp3": {
        name: "lookalike.mp3",
        extension: "mp3",
        mimeType: "audio/mpeg",
        chunks: [new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0])],
      },
    },
  });
  const invalidOutcome = await invalid.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://media.example/lookalike.mp3" },
    options: { mode: "audio" },
  });

  assert.equal(invalidOutcome.status, "failed");
  assert.deepEqual(invalid.deliveries, []);
  assert.deepEqual(invalid.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
});

test("a real WebM reaches scoped transcription while a truncated EBML lookalike fails closed", async () => {
  for (const [index, mimeType] of [
    "audio/webm",
    "video/webm",
    "application/octet-stream",
  ].entries()) {
    const url = `https://media.example/verified-${index}.webm`;
    const valid = createMediaWorkflowTestHarness({
      media: {
        [url]: {
          name: "verified.webm",
          extension: "webm",
          mimeType,
          chunks: [SAMPLE_WEBM_BYTES],
        },
      },
      transcript: "Verified WebM transcript.",
    });
    const validOutcome = await valid.workflow.run({
      toolId: "video-to-transcript",
      input: { kind: "url", url },
    });

    assert.equal(validOutcome.status, "succeeded", mimeType);
    assert.equal(
      new TextDecoder().decode(valid.deliveries[0]?.bytes),
      "Verified WebM transcript.",
      mimeType,
    );
  }

  const invalid = createMediaWorkflowTestHarness({
    media: {
      "https://media.example/lookalike.webm": {
        name: "lookalike.webm",
        extension: "webm",
        mimeType: "video/webm",
        chunks: [SAMPLE_WEBM_BYTES.subarray(0, 48)],
      },
    },
  });
  const invalidOutcome = await invalid.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url: "https://media.example/lookalike.webm" },
  });

  assert.equal(invalidOutcome.status, "failed");
  assert.deepEqual(invalid.deliveries, []);
  assert.deepEqual(invalid.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
});

test("video-only WebM downloads but cannot enter transcription processing", async () => {
  for (const [index, mimeType] of [
    "video/webm",
    "application/octet-stream",
  ].entries()) {
    const downloadUrl = `https://media.example/video-only-${index}.webm`;
    const downloader = createMediaWorkflowTestHarness({
      media: {
        [downloadUrl]: {
          name: "video-only.webm",
          extension: "webm",
          mimeType,
          chunks: [SAMPLE_VIDEO_ONLY_WEBM_BYTES],
        },
      },
    });
    const download = await downloader.workflow.run({
      toolId: "video-downloader",
      input: { kind: "url", url: downloadUrl },
    });

    assert.equal(download.status, "succeeded", mimeType);
    assert.equal(downloader.deliveries[0]?.format, "webm", mimeType);
  }

  const transcriptUrl = "https://media.example/video-only-transcript.webm";
  const transcription = createMediaWorkflowTestHarness({
    media: {
      [transcriptUrl]: {
        name: "video-only-transcript.webm",
        extension: "webm",
        mimeType: "video/webm",
        chunks: [SAMPLE_VIDEO_ONLY_WEBM_BYTES],
      },
    },
  });
  const transcript = await transcription.workflow.run({
    toolId: "video-to-transcript",
    input: { kind: "url", url: transcriptUrl },
  });

  assert.equal(transcript.status, "failed");
  assert.equal(transcript.error.code, "invalid-request");
  assert.equal(transcription.transcriptionRecords.cleanupReleased, false);
  assert.deepEqual(transcription.deliveries, []);
  assert.deepEqual(transcription.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
});

test("an audio-mode downloader rejects video-only media before delivery", async () => {
  const url = "https://media.example/video-only-audio-download.webm";
  const harness = createMediaWorkflowTestHarness({
    media: {
      [url]: {
        name: "video-only.webm",
        extension: "webm",
        mimeType: "video/webm",
        chunks: [SAMPLE_VIDEO_ONLY_WEBM_BYTES],
      },
    },
  });

  const outcome = await harness.workflow.run({
    toolId: "video-downloader",
    input: { kind: "url", url },
    options: { mode: "audio" },
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error.code, "invalid-request");
  assert.deepEqual(harness.deliveries, []);
  assert.deepEqual(harness.telemetry, [
    { kind: "start" },
    { kind: "terminal", status: "failed" },
  ]);
});

test("real ISO media variants pass bounded parsing while ftyp-only lookalikes fail", async (t) => {
  const formats = [
    { format: "mp4", mimeTypes: ["video/mp4", "application/octet-stream"] },
    {
      format: "mov",
      mimeTypes: ["video/quicktime", "application/octet-stream"],
    },
    { format: "m4a", mimeTypes: ["audio/mp4", "application/octet-stream"] },
    {
      format: "m4v",
      mimeTypes: ["video/mp4", "video/x-m4v", "application/octet-stream"],
    },
    {
      format: "3gp",
      mimeTypes: ["audio/3gpp", "video/3gpp", "application/octet-stream"],
    },
  ];
  assert.deepEqual(
    [...VERIFIED_MEDIA_FORMATS].sort(),
    [...formats.map(({ format }) => format), "mp3", "webm"].sort(),
  );
  const ftypOnly = SAMPLE_MP4_BYTES.subarray(0, 32);
  const wrongFixtureByFormat: Readonly<Record<string, string>> = {
    "3gp": "mp4",
    m4a: "mp4",
    m4v: "m4a",
    mov: "mp4",
    mp4: "mov",
  };

  for (const media of formats) {
    await t.test(media.format, async () => {
      const realBytes = new Uint8Array(
        readFileSync(
          new URL(
            `../../benchmarks/fixtures/sample.${media.format}`,
            import.meta.url,
          ),
        ),
      );
      for (const [mimeIndex, mimeType] of media.mimeTypes.entries()) {
        const validUrl = `https://media.example/verified-${mimeIndex}.${media.format}`;
        const valid = createMediaWorkflowTestHarness({
          media: {
            [validUrl]: {
              name: `verified.${media.format}`,
              extension: media.format,
              mimeType,
              chunks: [realBytes],
            },
          },
        });
        const validOutcome = await valid.workflow.run({
          toolId: "video-downloader",
          input: { kind: "url", url: validUrl },
        });

        assert.equal(validOutcome.status, "succeeded", mimeType);
        assert.equal(valid.deliveries[0]?.format, media.format, mimeType);
      }

      const invalidUrl = `https://media.example/lookalike.${media.format}`;
      const invalid = createMediaWorkflowTestHarness({
        media: {
          [invalidUrl]: {
            name: `lookalike.${media.format}`,
            extension: media.format,
            mimeType: media.mimeTypes[0],
            chunks: [ftypOnly],
          },
        },
      });
      const invalidOutcome = await invalid.workflow.run({
        toolId: "video-downloader",
        input: { kind: "url", url: invalidUrl },
      });

      assert.equal(invalidOutcome.status, "failed");
      assert.deepEqual(invalid.deliveries, []);
      assert.deepEqual(invalid.telemetry, [
        { kind: "start" },
        { kind: "terminal", status: "failed" },
      ]);

      const wrongContainerUrl = `https://media.example/wrong-container.${media.format}`;
      const wrongContainer = createMediaWorkflowTestHarness({
        media: {
          [wrongContainerUrl]: {
            name: `wrong-container.${media.format}`,
            extension: media.format,
            mimeType: media.mimeTypes[0],
            chunks: [
              new Uint8Array(
                readFileSync(
                  new URL(
                    `../../benchmarks/fixtures/sample.${wrongFixtureByFormat[media.format]}`,
                    import.meta.url,
                  ),
                ),
              ),
            ],
          },
        },
      });
      const wrongContainerOutcome = await wrongContainer.workflow.run({
        toolId: "video-downloader",
        input: { kind: "url", url: wrongContainerUrl },
      });

      assert.equal(wrongContainerOutcome.status, "failed");
      assert.deepEqual(wrongContainer.deliveries, []);
      assert.deepEqual(wrongContainer.telemetry, [
        { kind: "start" },
        { kind: "terminal", status: "failed" },
      ]);
    });
  }
});

test("endpoint identity rejection cancels and releases the unread response body", async (t) => {
  const cases = [
    {
      name: "unsupported metadata",
      url: "https://media.example/unsupported-metadata",
      fixture: {
        name: "media",
        mimeType: "application/json",
        chunks: [new TextEncoder().encode("not media")],
      },
    },
    {
      name: "conflicting MIME and extension",
      url: "https://media.example/conflicting-metadata",
      fixture: {
        name: "video.mp4",
        extension: "mp3",
        mimeType: "video/mp4",
        chunks: [SAMPLE_MP4_BYTES],
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const harness = createMediaWorkflowTestHarness({
        media: { [fixture.url]: fixture.fixture },
      });

      const outcome = await harness.workflow.run({
        toolId: "video-downloader",
        input: { kind: "url", url: fixture.url },
      });

      assert.equal(outcome.status, "failed");
      assert.equal(outcome.error.code, "acquisition-failed");
      assert.deepEqual(harness.deliveries, []);
      assert.deepEqual(harness.endpoint.streams, [
        { chunksRead: 0, cancelled: true, readerLockReleased: true },
      ]);
      assert.deepEqual(harness.telemetry, [
        { kind: "start" },
        { kind: "terminal", status: "failed" },
      ]);
    });
  }
});

test("empty transcript and mismatched downloader media fail before delivery", async () => {
  const emptyTranscript = createMediaWorkflowTestHarness({
    transcript: "   ",
  });
  const transcriptOutcome = await emptyTranscript.workflow.run({
    toolId: "mp4-to-transcript",
    input: {
      kind: "file",
      media: {
        name: "voice.mp4",
        format: "mp4",
        mimeType: "video/mp4",
        bytes: SAMPLE_MP4_BYTES,
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
