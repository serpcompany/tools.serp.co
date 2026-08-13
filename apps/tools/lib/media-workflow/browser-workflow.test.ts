import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createBrowserRunOwnership } from "./browser-run-ownership.ts";
import { createMonotonicProgress } from "./monotonic-progress.ts";
import { deliverMediaInBrowser } from "./browser.ts";
import { setMediaFilenameHeaders } from "../media-filename-transport.ts";
import {
  BROWSER_MEDIA_MEMORY_BUDGET,
  createProductionMediaEndpoint,
  createStreamedMediaAcquisition,
  type MediaEndpointResponse,
} from "./media-endpoint.ts";
import { projectMediaTransfer } from "./transfer-presentation.ts";

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

test("endpoint acquisition preserves a long astral Unicode filename without lone surrogates", async () => {
  const fileName = `a${"🎵".repeat(100)}.mp3`;
  const headers = new Headers({
    "content-type": "audio/mpeg",
    "x-media-extension": "mp3",
  });
  setMediaFilenameHeaders(headers, fileName);
  const endpoint = createProductionMediaEndpoint({
    fetch: async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers,
      }),
  });
  const acquisition = createStreamedMediaAcquisition({ endpoint });

  const media = await acquisition.acquire(
    {
      consumer: "downloader",
      mode: "audio",
      url: "https://media.example/long-name",
    },
    {
      signal: new AbortController().signal,
      budgets: { maxInputBytes: 1_024 },
      async registerCleanup() {},
      reportProgress() {},
    },
  );

  assert.equal(media.name, fileName);
  assert.equal(
    Array.from(media.name).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0xd800 && codePoint <= 0xdfff;
    }),
    false,
  );
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

test("browser delivery revokes object URL when starting the download throws", () => {
  const revoked: string[] = [];
  assert.throws(
    () =>
      deliverMediaInBrowser(
        {
          name: "clip.mp4",
          format: "mp4",
          mimeType: "video/mp4",
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
        {
          createObjectURL: () => "blob:failed-download",
          revokeObjectURL: (url) => revoked.push(url),
          createAnchor() {
            throw new Error("anchor unavailable");
          },
        },
      ),
    /anchor unavailable/,
  );
  assert.deepEqual(revoked, ["blob:failed-download"]);
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

test("transcription UI owns one guarded batch run through cancellation and unmount", () => {
  const source = readFileSync(
    new URL("../../components/TranscribeTool.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /createBrowserRunOwnership/);
  assert.match(source, /if \(busy \|\| runOwnership\.isBusy\(\)\) return/);
  assert.match(source, /if \(!lease\.isCurrent\(\)\) break/);
  assert.match(source, /lease\.finish\(\)/);
  assert.match(
    source,
    /runOwnership\.abort\(["']Transcription cancelled by the user["']\)/,
  );
  assert.match(source, /data-testid="tool-cancel"/);
  assert.match(source, /No transcript was delivered/);
  assert.match(
    source,
    /runOwnership\.abort\(["']Transcription view unmounted["']\)/,
  );
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
