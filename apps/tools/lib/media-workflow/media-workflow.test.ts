import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getToolProcessorAvailability } from "../tool-processor-registry.ts";
import {
  getMediaWorkflowAdapterRegistration,
  mediaWorkflowAdapterRegistrations,
} from "./adapter-registration.ts";
import { createBrowserRunOwnership } from "./browser-run-ownership.ts";
import { createMonotonicProgress } from "./monotonic-progress.ts";
import { deliverMediaInBrowser } from "./browser.ts";
import {
  BROWSER_MEDIA_MEMORY_BUDGET,
  createStreamedMediaAcquisition,
  MediaEndpointError,
  type MediaEndpointResponse,
} from "./media-endpoint.ts";
import { createMediaWorkflowTestHarness } from "./testing.ts";
import { projectMediaTransfer } from "./transfer-presentation.ts";
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

test("a finished old browser run cannot clear newer ownership", () => {
  const ownership = createBrowserRunOwnership();
  const first = ownership.begin();
  ownership.abort("first run cancelled");
  const second = ownership.begin();

  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  first.finish();
  assert.equal(second.isCurrent(), true);
  ownership.abort("view unmounted");
  assert.equal(second.signal.aborted, true);
  assert.equal(ownership.isBusy(), false);
});

test("downloader run callbacks cannot outlive replacement or unmount", () => {
  const ownership = createBrowserRunOwnership();
  const writes: string[] = [];
  const first = ownership.begin();
  const firstCallback = () => {
    if (first.isCurrent()) writes.push("first");
  };

  ownership.abort("first downloader run replaced");
  const second = ownership.begin();
  const secondCallback = () => {
    if (second.isCurrent()) writes.push("second");
  };
  firstCallback();
  assert.equal(first.finish(), false);
  secondCallback();

  ownership.abort("Downloader unmounted");
  secondCallback();

  assert.deepEqual(writes, ["second"]);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.equal(ownership.isBusy(), false);
});

test("presentation progress never moves backward when a phase omits or lowers progress", () => {
  const progress = createMonotonicProgress();

  assert.equal(progress.project(50), 50);
  assert.equal(progress.project(100), 100);
  assert.equal(progress.project(undefined), 100);
  assert.equal(progress.project(25), 100);
});

test("browser acquisition accounts for the live stream chunk in its 80 MiB lifecycle peak", async (t) => {
  const cap = BROWSER_MEDIA_MEMORY_BUDGET.maxTransferBytes;

  assert.deepEqual(BROWSER_MEDIA_MEMORY_BUDGET, {
    maxBlobSnapshotBytes: 32 * 1_024 * 1_024,
    maxDeliveryPeakBytes: 64 * 1_024 * 1_024,
    maxGrowthOwnerBytes: 16 * 1_024 * 1_024,
    maxIncomingChunkBytes: 32 * 1_024 * 1_024,
    maxLifecyclePeakBytes: 80 * 1_024 * 1_024,
    maxReplacementBytes: 32 * 1_024 * 1_024,
    maxTransferBytes: 32 * 1_024 * 1_024,
  });

  for (const contentLength of [cap, undefined]) {
    await t.test(
      contentLength ? "declared length" : "indeterminate length",
      async () => {
        const transportChunk = new Uint8Array(cap / 2);
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(transportChunk);
            controller.enqueue(transportChunk);
            controller.close();
          },
        });
        let cancelled = false;
        let released = false;
        const originalGetReader = body.getReader.bind(body);
        body.getReader = (() => {
          const reader = originalGetReader();
          const originalCancel = reader.cancel.bind(reader);
          const originalRelease = reader.releaseLock.bind(reader);
          reader.cancel = async (reason?: unknown) => {
            cancelled = true;
            return originalCancel(reason);
          };
          reader.releaseLock = () => {
            released = true;
            originalRelease();
          };
          return reader;
        }) as typeof body.getReader;
        const allocations: Uint8Array[] = [];
        const cleanups: Array<() => Promise<void>> = [];
        const acquisition = createStreamedMediaAcquisition({
          endpoint: {
            async open(): Promise<MediaEndpointResponse> {
              return {
                body,
                contentLength,
                extension: "mp4",
                fileName: "at-cap.mp4",
                mimeType: "video/mp4",
              };
            },
          },
          allocateBuffer(bytes) {
            const allocation = new Uint8Array(bytes);
            allocations.push(allocation);
            return allocation;
          },
        });

        const media = await acquisition.acquire(
          {
            consumer: "downloader",
            mode: "video",
            url: "https://media.example/at-cap",
          },
          {
            signal: new AbortController().signal,
            budgets: { maxInputBytes: cap },
            async registerCleanup(cleanup) {
              cleanups.push(cleanup);
            },
            reportProgress() {},
          },
        );

        const allocationSizes = allocations.map(({ byteLength }) => byteLength);
        if (contentLength) {
          assert.deepEqual(allocationSizes, [cap]);
        } else {
          assert.deepEqual(allocationSizes, [cap / 2, cap]);
          assert.equal(
            Math.max(
              ...allocationSizes
                .slice(1)
                .map((size, index) => size + allocationSizes[index]!),
            ),
            cap * 1.5,
          );
        }
        assert.equal(
          16 * 1_024 * 1_024 + 32 * 1_024 * 1_024 + 32 * 1_024 * 1_024,
          BROWSER_MEDIA_MEMORY_BUDGET.maxLifecyclePeakBytes,
        );
        assert.equal(media.bytes.buffer, allocations.at(-1)?.buffer);
        assert.equal(media.bytes.byteLength, cap);
        await Promise.all(cleanups.map((cleanup) => cleanup()));
        assert.equal(cancelled, false);
        assert.equal(released, true);
      },
    );
  }
});

test("a tiny indeterminate stream keeps its owned allocation small and reuses it at EOF", async () => {
  const chunk = new Uint8Array([1, 2, 3]);
  const allocations: Uint8Array[] = [];
  const acquisition = createStreamedMediaAcquisition({
    endpoint: {
      async open() {
        return {
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.close();
            },
          }),
          extension: "mp4",
          fileName: "tiny.mp4",
          mimeType: "video/mp4",
        };
      },
    },
    allocateBuffer(bytes) {
      const allocation = new Uint8Array(bytes);
      allocations.push(allocation);
      return allocation;
    },
  });

  const media = await acquisition.acquire(
    {
      consumer: "downloader",
      mode: "video",
      url: "https://media.example/tiny",
    },
    {
      signal: new AbortController().signal,
      budgets: { maxInputBytes: 64 * 1_024 * 1_024 },
      async registerCleanup() {},
      reportProgress() {},
    },
  );

  assert.deepEqual(
    allocations.map(({ byteLength }) => byteLength),
    [64 * 1_024],
  );
  assert.equal(media.bytes.buffer, allocations[0]?.buffer);
  assert.deepEqual(Array.from(media.bytes), [1, 2, 3]);
});

test("cancelling a cap-sized indeterminate acquisition releases its reader and sole owned buffer", async () => {
  const cap = BROWSER_MEDIA_MEMORY_BUDGET.maxTransferBytes;
  const controller = new AbortController();
  let streamCancelled = false;
  let readerReleased = false;
  let allocated: Uint8Array | undefined;
  const cleanups: Array<() => Promise<void>> = [];
  const transportChunk = new Uint8Array(cap / 2);
  let chunkIndex = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(stream) {
        if (chunkIndex < 2) {
          chunkIndex += 1;
          stream.enqueue(transportChunk);
        }
      },
      cancel() {
        streamCancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const originalGetReader = body.getReader.bind(body);
  body.getReader = (() => {
    const reader = originalGetReader();
    const originalRelease = reader.releaseLock.bind(reader);
    reader.releaseLock = () => {
      readerReleased = true;
      originalRelease();
    };
    return reader;
  }) as typeof body.getReader;
  const acquisition = createStreamedMediaAcquisition({
    endpoint: {
      async open() {
        return {
          body,
          extension: "mp4",
          fileName: "cancelled.mp4",
          mimeType: "video/mp4",
        };
      },
    },
    allocateBuffer(bytes) {
      allocated = new Uint8Array(bytes);
      return allocated;
    },
    onTransfer(transfer) {
      if (transfer.receivedBytes === cap) {
        controller.abort("cancel cap transfer");
      }
    },
  });

  await assert.rejects(
    acquisition.acquire(
      {
        consumer: "downloader",
        mode: "video",
        url: "https://media.example/cancelled",
      },
      {
        signal: controller.signal,
        budgets: { maxInputBytes: cap },
        async registerCleanup(cleanup) {
          cleanups.push(cleanup);
        },
        reportProgress() {},
      },
    ),
    (error) => error === "cancel cap transfer",
  );
  assert.equal(allocated?.byteLength, cap);
  assert.equal(streamCancelled, true);
  await Promise.all(cleanups.map((cleanup) => cleanup()));
  assert.equal(readerReleased, true);
});

test("video-only WebM provenance records a reproducible recipe and checked-in artifact hash", () => {
  const provenance = JSON.parse(
    readFileSync(
      new URL("../../benchmarks/fixture-provenance.json", import.meta.url),
      "utf8",
    ),
  ) as Record<
    string,
    {
      command: string;
      reproducibility: string;
      sha256: string;
      source: string;
    }
  >;
  const record = provenance["fixtures/sample-video-only.webm"];

  assert.equal(record?.source, "repository-generated");
  assert.match(record?.command ?? "", /ffmpeg[\s\S]*-an[\s\S]*libvpx/);
  assert.equal(
    record?.reproducibility,
    "recipe-only; WebM muxing may vary; sha256 identifies the checked-in artifact",
  );
  assert.equal(
    createHash("sha256").update(SAMPLE_VIDEO_ONLY_WEBM_BYTES).digest("hex"),
    record?.sha256,
  );
});

test("browser delivery snapshots bytes into Blob ownership and immediately releases downloader ownership", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const media = {
    name: "clip.mp4",
    format: "mp4",
    mimeType: "video/mp4",
    bytes,
  };
  const blobParts: BlobPart[][] = [];
  const revoked: string[] = [];
  const scheduled: Array<() => void> = [];
  let createdBlob: Blob | undefined;
  let clicked = false;

  deliverMediaInBrowser(media, {
    releaseOwnership: true,
    createBlob(parts, options) {
      blobParts.push(parts);
      createdBlob = new Blob(parts, options);
      return createdBlob;
    },
    createObjectURL() {
      return "blob:owned-media";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
    createAnchor() {
      return {
        href: "",
        download: "",
        click() {
          clicked = true;
        },
      };
    },
    schedule(cleanup) {
      scheduled.push(cleanup);
    },
  });

  assert.equal(blobParts.length, 1);
  assert.equal(blobParts[0]?.length, 1);
  assert.equal(blobParts[0]?.[0], bytes);
  assert.equal(media.bytes.byteLength, 0);
  assert.ok(createdBlob);
  bytes[0] = 9;
  assert.deepEqual(
    Array.from(new Uint8Array(await createdBlob.arrayBuffer())),
    [1, 2, 3, 4],
  );
  assert.equal(clicked, true);
  assert.deepEqual(revoked, []);
  scheduled[0]?.();
  assert.deepEqual(revoked, ["blob:owned-media"]);
});

test("transfer presentation projects determinate stats and a meaningful indeterminate state", () => {
  assert.deepEqual(
    projectMediaTransfer({
      receivedBytes: 32 * 1_024 * 1_024,
      totalBytes: 64 * 1_024 * 1_024,
      ratio: 0.5,
      bytesPerSecond: 8 * 1_024 * 1_024,
      etaSeconds: 4,
    }),
    {
      progress: 50,
      message: "32 MB of 64 MB • 8 MB/s • 4s remaining",
    },
  );
  assert.deepEqual(
    projectMediaTransfer({
      receivedBytes: 3 * 1_024 * 1_024,
      bytesPerSecond: 1.5 * 1_024 * 1_024,
    }),
    {
      progress: undefined,
      message: "3 MB downloaded • 1.5 MB/s • total size unknown",
    },
  );
  assert.deepEqual(
    projectMediaTransfer({ receivedBytes: 1, bytesPerSecond: 0 }),
    {
      progress: undefined,
      message: "1 B downloaded • calculating speed • total size unknown",
    },
  );
});

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
    if (relativePath.endsWith("TranscribeTool.tsx")) {
      assert.match(source, /VERIFIED_MEDIA_FORMATS/);
      assert.doesNotMatch(source, /AUDIO_FORMATS|VIDEO_FORMATS/);
    }
  }
});

test("downloader UI consumes shared browser run progress without deriving transport statistics", () => {
  const source = readFileSync(
    new URL("../../components/VideoDownloaderTool.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /createBrowserMediaWorkflow\(\{[\s\S]*onTransfer\(transfer\)/,
  );
  assert.match(source, /createBrowserRunProgress/);
  assert.match(source, /runProgress\.fromTransfer\(transfer\)/);
  assert.match(source, /runProgress\.fromSnapshot\(snapshot\)/);
  assert.match(source, /releaseDeliveredBytes: true/);
  assert.doesNotMatch(
    source,
    /transfer\.(?:receivedBytes|totalBytes|ratio|bytesPerSecond|etaSeconds)/,
  );
});

test("transcription UI owns one guarded batch run through unmount", () => {
  const source = readFileSync(
    new URL("../../components/TranscribeTool.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /createBrowserRunOwnership/);
  assert.match(source, /if \(busy \|\| runOwnership\.isBusy\(\)\) return/);
  assert.match(source, /if \(!lease\.isCurrent\(\)\) break/);
  assert.match(source, /lease\.finish\(\)/);
  assert.match(source, /runOwnership\.abort\("Transcription view unmounted"\)/);
  assert.doesNotMatch(source, /activeRun\.current\s*=\s*null/);
});

test("downloader UI guards every run callback and terminal release with one lease", () => {
  const source = readFileSync(
    new URL("../../components/VideoDownloaderTool.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /createBrowserRunOwnership/);
  assert.match(source, /if \(busy \|\| runOwnership\.isBusy\(\)\) return/);
  assert.match(source, /if \(!lease\.isCurrent\(\)\) return/);
  assert.match(source, /if \(lease\.finish\(\)\) setBusy\(false\)/);
  assert.match(source, /runOwnership\.abort\("Downloader unmounted"\)/);
  assert.doesNotMatch(source, /activeRun\.current/);
});

test("downloader and URL transcription project transfer stats without backward progress", () => {
  for (const relativePath of [
    "../../components/VideoDownloaderTool.tsx",
    "../../components/TranscribeTool.tsx",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /createBrowserRunProgress/);
    assert.match(source, /onTransfer\(transfer\)/);
    assert.match(source, /runProgress\.fromTransfer\(transfer\)/);
    assert.match(source, /runProgress\.fromSnapshot\(snapshot\)/);
    assert.doesNotMatch(source, /createMonotonicProgress|projectMediaTransfer/);
    assert.doesNotMatch(
      source,
      /Math\.round\(\(snapshot\.progress \?\? 0\) \* 100\)/,
    );
  }
});

test("scoped downloader and transcription Tool ids register the media workflow adapter", () => {
  assert.equal(mediaWorkflowAdapterRegistrations.length, 300);
  for (const [toolId, family] of [
    ["video-downloader", "downloader"],
    ["download-loom-videos", "downloader"],
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
