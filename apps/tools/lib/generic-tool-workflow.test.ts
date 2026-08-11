import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { before } from "node:test";

import { init as initializeJpegDecoder } from "@jsquash/jpeg/decode.js";

import { toolCatalog } from "@serp-tools/app-core/lib/tool-catalog";

import {
  createGenericToolWorkflow,
  decideGenericBrowserSupport,
  deliverBrowserMedia,
  getGenericAccept,
  genericCompressionNeedsWorker,
  getGenericToolContract,
  runGenericToolFile,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from "./generic-tool-workflow.ts";
import { getToolProcessorAvailability } from "./tool-processor-registry.ts";
import { selectToolRenderer } from "./tool-renderer.ts";
import { resolveConversionCapability } from "./convert/conversion-dispatch.ts";
import { resolveCompressionDispatch } from "./compression-utils.ts";
import { createGenericToolRunController } from "./generic-tool-run-controller.ts";
import { runFfmpegLifecycle } from "./convert/ffmpeg-lifecycle.ts";

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

function mp4WithoutRecognizedAudioTrack(): Uint8Array {
  const bytes = Uint8Array.from(fixture("sample.mp4"));
  const marker = new TextEncoder().encode("mp4a");
  const offset = bytes.findIndex(
    (_byte, index) => marker.every((value, part) => bytes[index + part] === value),
  );
  assert.ok(offset >= 0, "fixture must contain an audio sample entry");
  bytes.set(new TextEncoder().encode("xxxx"), offset);
  return bytes;
}

before(async () => {
  const require = createRequire(import.meta.url);
  const wasm = await WebAssembly.compile(
    Uint8Array.from(
      readFileSync(require.resolve("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm")),
    ),
  );
  await (
    initializeJpegDecoder as unknown as (
      module: WebAssembly.Module,
    ) => Promise<void>
  )(wasm);
});

function adapters(output: Uint8Array): GenericWorkflowAdapters & {
  delivered: string[];
  processed: string[];
} {
  const delivered: string[] = [];
  const processed: string[] = [];
  return {
    delivered,
    processed,
    decideSupport() {
      return { supported: true };
    },
    async convert(request) {
      processed.push(`${request.from}->${request.to}`);
      return [output];
    },
    async compress(request) {
      processed.push(`compress:${request.format}`);
      return output;
    },
    async verify() {
      return { status: "verified" };
    },
    async deliver(result) {
      delivered.push(result.name);
      return `delivery-${delivered.length}`;
    },
    telemetry: {
      async start() {},
      async terminal() {},
    },
  };
}

test("every active generic renderer Tool has an explicit processor contract state", () => {
  const portfolio = toolCatalog.activeTools.filter(
    (tool) => selectToolRenderer(tool) === "generic",
  );
  assert.ok(portfolio.length > 2_000);
  for (const tool of portfolio) {
    const contract = getGenericToolContract(tool.id);
    assert.equal(contract.toolId, tool.id);
    assert.match(contract.state, /^(supported|unsupported)$/);
    if (contract.state === "unsupported") {
      assert.ok(contract.reason.length > 20, tool.id);
      assert.notEqual(getToolProcessorAvailability(tool.id).kind, "wired");
    } else {
      assert.deepEqual(getToolProcessorAvailability(tool.id), {
        kind: "wired",
        toolId: tool.id,
        adapterId: contract.adapterId,
      });
    }
  }
});

test("known production dispatches retain exact generic workflow contracts", () => {
  for (const toolId of [
    "png-to-webp",
    "webp-to-jpg",
    "heic-to-jpg",
    "cr2-to-jpg",
    "mp4-to-mp3",
  ]) {
    assert.equal(getGenericToolContract(toolId).state, "supported", toolId);
  }
  for (const toolId of ["m4a-to-mp4", "mp3-to-mp4"]) {
    assert.equal(getGenericToolContract(toolId).state, "unsupported", toolId);
  }
});

test("generic compression allocates workers from the production dispatch table", () => {
  assert.equal(genericCompressionNeedsWorker("webp"), true);
  assert.equal(genericCompressionNeedsWorker("jpg"), true);
  assert.equal(genericCompressionNeedsWorker("png"), true);
  assert.equal(genericCompressionNeedsWorker("heic"), false);
  assert.equal(genericCompressionNeedsWorker("mp4"), false);
});

test("contract inventory independently audits real dispatches with semantic coverage", () => {
  const verifiedInputs = new Set([
    "cr2",
    "heic",
    "jpeg",
    "jpg",
    "m4a",
    "mp3",
    "mp4",
    "pdf",
    "png",
    "webp",
  ]);
  const verifiedOutputs = new Set([
    "jpeg",
    "jpg",
    "m4a",
    "mp3",
    "mp4",
    "pdf",
    "png",
    "webp",
  ]);
  for (const tool of toolCatalog.activeTools.filter(
    (item) => selectToolRenderer(item) === "generic" && item.operation === "convert",
  )) {
    if (!tool.from || !tool.to) continue;
    const capability = resolveConversionCapability(tool.from, tool.to);
    const expectedSupported =
      capability.supported &&
      verifiedInputs.has(tool.from) &&
      verifiedOutputs.has(tool.to);
    assert.equal(
      getGenericToolContract(tool.id).state === "supported",
      expectedSupported,
      `${tool.id}: ${capability.supported ? capability.dispatch.kind : capability.reason}`,
    );
  }
  for (const tool of toolCatalog.activeTools.filter(
    (item) => selectToolRenderer(item) === "generic" && item.operation === "compress",
  )) {
    if (!tool.from || !tool.to) continue;
    const dispatch = resolveCompressionDispatch(tool.from);
    const expectedSupported =
      tool.from === tool.to &&
      dispatch.target !== "unsupported" &&
      dispatch.target !== "pdf" &&
      verifiedInputs.has(tool.from) &&
      verifiedOutputs.has(tool.to);
    assert.equal(
      getGenericToolContract(tool.id).state === "supported",
      expectedSupported,
      `${tool.id}: ${dispatch.target}`,
    );
  }
});

test("every supported generic contract resolves a processor through workflow.run", async () => {
  const outputFixture = {
    cr2: "sample.cr2",
    heic: "sample.heic",
    jpeg: "sample.jpg",
    jpg: "sample.jpg",
    m4a: "sample.m4a",
    mp3: "sample.mp3",
    mp4: "sample.mp4",
    pdf: "sample.pdf",
    png: "sample.png",
    webp: "sample.webp",
  } as const;
  const baseBoundary = adapters(fixture("sample.png"));
  const boundary: GenericWorkflowAdapters = {
    ...baseBoundary,
    async convert(request) {
      return [
        fixture(outputFixture[request.to as keyof typeof outputFixture]),
      ];
    },
    async compress(request) {
      return fixture(
        outputFixture[request.format as keyof typeof outputFixture],
      );
    },
  };
  const workflow = createGenericToolWorkflow(boundary);
  const inputFixture = {
    cr2: "sample.cr2",
    heic: "sample.heic",
    jpeg: "sample.jpg",
    jpg: "sample.jpg",
    m4a: "sample.m4a",
    mp3: "sample.mp3",
    mp4: "sample.mp4",
    pdf: "sample.pdf",
    png: "sample.png",
    webp: "sample.webp",
  } as const;
  const supported = toolCatalog.activeTools
    .filter((tool) => selectToolRenderer(tool) === "generic")
    .map((tool) => getGenericToolContract(tool.id))
    .filter((contract) => contract.state === "supported");

  for (const contract of supported) {
    const outcome = await workflow.run({
      toolId: contract.toolId,
      input: {
        kind: "file",
        media: {
          name: `invalid.${contract.input.format}`,
          format: contract.input.format,
          mimeType: contract.input.mimeType,
          bytes: fixture(
            inputFixture[contract.input.format as keyof typeof inputFixture],
          ),
        },
      },
    });
    assert.equal(outcome.status, "succeeded", contract.toolId);
  }
});

test("a supported generic conversion crosses workflow.run and delivers verified bytes", async () => {
  const boundary = adapters(fixture("sample.jpg"));
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "sample.png",
        format: "png",
        mimeType: "image/png",
        bytes: fixture("sample.png"),
      },
    },
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(boundary.processed, ["png->jpg"]);
  assert.deepEqual(boundary.delivered, ["sample.jpg"]);
});

test("runtime capability rejection fails closed before a registered engine runs", async () => {
  const baseBoundary = adapters(fixture("sample.jpg"));
  const boundary: GenericWorkflowAdapters = {
    ...baseBoundary,
    decideSupport() {
      return { supported: false, message: "Runtime adapter unavailable" };
    },
  };
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "sample.png",
        format: "png",
        mimeType: "image/png",
        bytes: fixture("sample.png"),
      },
    },
  });

  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") {
    assert.equal(outcome.error.code, "unsupported-request");
  }
  assert.deepEqual(baseBoundary.processed, []);
  assert.deepEqual(baseBoundary.delivered, []);
});

test("production support retains adaptive server conversion but rejects unavailable browser compression", () => {
  assert.deepEqual(
    decideGenericBrowserSupport(
      { operation: "convert", inputFormat: "mp4", outputFormat: "m4a" },
      false,
    ),
    { supported: true },
  );
  assert.deepEqual(
    decideGenericBrowserSupport(
      { operation: "compress", inputFormat: "mp4", outputFormat: "mp4" },
      false,
    ),
    {
      supported: false,
      message: "Media processing is not available in this browser.",
    },
  );
});

test("a PNG fallback cannot succeed for a requested non-PNG output", async () => {
  const boundary = adapters(fixture("sample.png"));
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: "png-to-jpg",
    input: {
      kind: "file",
      media: {
        name: "sample.png",
        format: "png",
        mimeType: "image/png",
        bytes: fixture("sample.png"),
      },
    },
  });

  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") assert.equal(outcome.error.code, "invalid-result");
  assert.deepEqual(boundary.delivered, []);
});

test("browser image decoding cannot legitimize wrong-format bytes", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () =>
    ({ width: 1, height: 1, close() {} }) as ImageBitmap;
  try {
    const verification = await verifyGenericMediaSemantics({
      name: "renamed.jpg",
      format: "jpg",
      mimeType: "image/jpeg",
      bytes: fixture("sample.png"),
    });
    assert.equal(verification.status, "rejected");
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test("native JPEG fallback reapplies dimension and aggregate RGBA limits", async () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const jpegEnvelope = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  try {
    for (const [width, height] of [
      [100_000, 100_000],
      [8_192, 2_049],
    ]) {
      let closed = false;
      globalThis.createImageBitmap = async () =>
        ({ width, height, close() { closed = true; } }) as ImageBitmap;
      const verification = await verifyGenericMediaSemantics({
        name: "bomb.jpg",
        format: "jpg",
        mimeType: "image/jpeg",
        bytes: jpegEnvelope,
      });
      assert.equal(verification.status, "rejected", `${width}x${height}`);
      assert.equal(closed, true, `${width}x${height} bitmap was not closed`);
    }
  } finally {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  }
});

test("browser delivery delays Blob URL revocation until the download has started", async () => {
  const revoked: string[] = [];
  const clicks: string[] = [];
  let cleanup: (() => void) | undefined;
  let delay = 0;
  const deliveryId = await deliverBrowserMedia(
    {
      name: "result.png",
      format: "png",
      mimeType: "image/png",
      bytes: fixture("sample.png"),
    },
    {
      createObjectUrl: () => "blob:result",
      revokeObjectUrl: (url) => revoked.push(url),
      clickDownload: (url, name) => clicks.push(`${url}:${name}`),
      scheduleCleanup(callback, delayMs) {
        cleanup = callback;
        delay = delayMs;
      },
      nextId: () => "delivery-1",
    },
  );
  assert.equal(deliveryId, "delivery-1");
  assert.deepEqual(clicks, ["blob:result:result.png"]);
  assert.deepEqual(revoked, []);
  assert.equal(delay, 1_000);
  cleanup?.();
  assert.deepEqual(revoked, ["blob:result"]);
});

test("a superseded run cannot clear or overwrite its active replacement", async () => {
  type Resolve = (outcome: Awaited<ReturnType<typeof runGenericToolFile>>) => void;
  const pending = new Map<string, Resolve>();
  const states: Array<Record<string, unknown>> = [];
  let state: Record<string, unknown> = {};
  const controller = createGenericToolRunController({
    runFile(_toolId, file) {
      return new Promise((resolve) => pending.set(file.name, resolve));
    },
    publish(patch) {
      state = { ...state, ...patch };
      states.push(state);
    },
    failureMessage: () => "failed",
    completionMessage: () => "complete",
  });
  const first = controller.run({
    toolId: "png-to-jpg",
    files: [{ name: "slow.png" } as File],
  });
  const second = controller.run({
    toolId: "png-to-jpg",
    files: [{ name: "active.png" } as File],
  });
  pending.get("active.png")?.({
    status: "succeeded",
    runId: "active",
    results: [],
    telemetry: { start: "submitted", terminal: "submitted" },
  });
  await second;
  const settledReplacement = { ...state };
  pending.get("slow.png")?.({
    status: "cancelled",
    runId: "slow",
    telemetry: { start: "submitted", terminal: "submitted" },
  });
  await first;
  assert.deepEqual(state, settledReplacement);
  assert.equal(state.busy, false);
  assert.equal((state.currentFile as { name: string }).name, "active.png");
  assert.equal(states.at(-1)?.busy, false);
});

test("FFmpeg production lifecycle releases listeners and files after every failure stage", async () => {
  for (const stage of ["write", "exec", "read"] as const) {
    const deleted: string[] = [];
    let attached = 0;
    let detached = 0;
    let terminated = 0;
    const controller = new AbortController();
    const progress = () => {};
    const adapter = {
      async writeFile() {
        if (stage === "write") throw new Error("write failed");
      },
      async deleteFile(name: string) { deleted.push(name); },
      on() { attached += 1; },
      off() { detached += 1; },
      terminate() { terminated += 1; },
    };
    await assert.rejects(
      runFfmpegLifecycle(
        adapter,
        {
          inputs: [{ name: "input.mp4", data: new Uint8Array([1]) }],
          cleanupFiles: ["output.mp3", "palette.png"],
          signal: controller.signal,
          progress,
        },
        async () => {
          if (stage === "exec") throw new Error("exec failed");
          throw new Error("read failed");
        },
      ),
      new RegExp(`${stage} failed`),
    );
    assert.equal(attached, 1, stage);
    assert.equal(detached, 1, stage);
    assert.deepEqual(deleted, ["input.mp4", "output.mp3", "palette.png"], stage);
    controller.abort();
    assert.equal(terminated, 0, `${stage} retained abort listener`);
  }
});

test("an unsupported generic route fails closed before its legacy raster fallback", async () => {
  const boundary = adapters(fixture("sample.png"));
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: "3g2-to-mp4",
    input: {
      kind: "file",
      media: {
        name: "sample.3g2",
        format: "3g2",
        mimeType: "video/3gpp2",
        bytes: fixture("sample.3g2"),
      },
    },
  });

  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") assert.equal(outcome.error.code, "unsupported-tool");
  assert.deepEqual(boundary.processed, []);
  assert.deepEqual(boundary.delivered, []);
});

test("generic family semantic validation accepts real image, media, audio, and PDF fixtures", async () => {
  const cases = [
    ["png", "image/png", "sample.png"],
    ["jpg", "image/jpeg", "sample.jpg"],
    ["mp4", "video/mp4", "sample.mp4"],
    ["m4a", "audio/mp4", "sample.m4a"],
    ["pdf", "application/pdf", "sample.pdf"],
  ] as const;

  for (const [format, mimeType, name] of cases) {
    assert.deepEqual(
      await verifyGenericMediaSemantics({
        name,
        format,
        mimeType,
        bytes: fixture(name),
      }),
      { status: "verified" },
      format,
    );
  }
});

test("trusted media parsers reject truncated and fabricated BMFF audio", async () => {
  const source = fixture("sample.m4a");
  for (const bytes of [
    source.subarray(0, Math.min(32, source.byteLength)),
    new Uint8Array([
      0, 0, 0, 16, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0,
      0, 0, 0, 8, 109, 111, 111, 118,
    ]),
  ]) {
    const result = await verifyGenericMediaSemantics({
      name: "fake.m4a",
      format: "m4a",
      mimeType: "audio/mp4",
      bytes,
    });
    assert.equal(result.status, "rejected");
  }
});

test("BMFF contracts reject a valid container from the wrong media family without delivery", async () => {
  const cases = [
    {
      toolId: "mp4-to-m4a",
      input: "sample.mp4",
      output: "sample.mp4",
      expectedProcessed: true,
    },
    {
      toolId: "mp4-to-m4a",
      input: "sample.m4a",
      output: "sample.m4a",
      expectedProcessed: false,
    },
    {
      toolId: "compress-mp4",
      input: "sample.m4a",
      output: "sample.m4a",
      expectedProcessed: false,
    },
    {
      toolId: "compress-m4a",
      input: "sample.m4a",
      output: "sample.mp4",
      expectedProcessed: true,
    },
  ] as const;

  for (const testCase of cases) {
    const boundary = adapters(fixture(testCase.output));
    const workflow = createGenericToolWorkflow(boundary);
    const contract = getGenericToolContract(testCase.toolId);
    assert.equal(contract.state, "supported");
    if (contract.state !== "supported") continue;
    const outcome = await workflow.run({
      toolId: testCase.toolId,
      input: {
        kind: "file",
        media: {
          name: testCase.input,
          format: contract.input.format,
          mimeType: contract.input.mimeType,
          bytes: fixture(testCase.input),
        },
      },
    });

    assert.equal(outcome.status, "failed", testCase.toolId);
    assert.equal(boundary.processed.length > 0, testCase.expectedProcessed);
    assert.deepEqual(boundary.delivered, []);
  }
});

test("MP4 compression cannot silently discard a valid input audio track", async () => {
  const boundary = adapters(mp4WithoutRecognizedAudioTrack());
  const workflow = createGenericToolWorkflow(boundary);
  const outcome = await workflow.run({
    toolId: "compress-mp4",
    input: {
      kind: "file",
      media: {
        name: "sample.mp4",
        format: "mp4",
        mimeType: "video/mp4",
        bytes: fixture("sample.mp4"),
      },
    },
  });

  assert.equal(outcome.status, "failed");
  assert.deepEqual(boundary.delivered, []);
});

test("file preflight rejects oversized input without reading it", async () => {
  let reads = 0;
  const file = {
    name: "oversized.png",
    type: "image/png",
    size: 256 * 1_024 * 1_024 + 1,
    async arrayBuffer() {
      reads += 1;
      throw new Error("must not read");
    },
  } as unknown as File;

  const outcome = await runGenericToolFile("png-to-jpg", file);
  assert.equal(outcome.status, "failed");
  if (outcome.status === "failed") assert.equal(outcome.error.code, "invalid-request");
  assert.equal(reads, 0);
});

test("file acquisition cancellation returns promptly and cancels its reader", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const file = {
    name: "slow.png",
    type: "image/png",
    size: 8,
    stream() {
      return new ReadableStream<Uint8Array>({
        async pull(streamController) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          streamController.enqueue(new Uint8Array(8));
          streamController.close();
        },
        cancel() {
          cancelled = true;
        },
      });
    },
  } as unknown as File;
  setTimeout(() => controller.abort(), 10);
  const started = performance.now();

  const outcome = await runGenericToolFile("png-to-jpg", file, {
    signal: controller.signal,
  });

  assert.equal(outcome.status, "cancelled");
  assert.ok(performance.now() - started < 150, "cancellation waited for the delayed read");
  assert.equal(cancelled, true);
});

test("TIFF picker accepts both conventional extensions", () => {
  assert.equal(getGenericAccept("tiff"), ".tif,.tiff");
  assert.equal(getGenericAccept("tif"), ".tif,.tiff");
});
