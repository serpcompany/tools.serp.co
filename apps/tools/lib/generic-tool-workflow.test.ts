import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { before } from "node:test";

import { init as initializeJpegDecoder } from "@jsquash/jpeg/decode.js";

import { toolCatalog } from "@serp-tools/app-core/lib/tool-catalog";

import {
  createGenericToolWorkflow,
  decideGenericBrowserSupport,
  getGenericAccept,
  getGenericToolContract,
  runGenericToolFile,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from "./generic-tool-workflow.ts";
import { getToolProcessorAvailability } from "./tool-processor-registry.ts";
import { selectToolRenderer } from "./tool-renderer.ts";

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

test("every supported generic contract resolves a processor through workflow.run", async () => {
  const outputFixture = {
    jpeg: "sample.jpg",
    jpg: "sample.jpg",
    m4a: "sample.m4a",
    mp4: "sample.mp4",
    pdf: "sample.pdf",
    png: "sample.png",
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
    jpeg: "sample.jpg",
    jpg: "sample.jpg",
    m4a: "sample.m4a",
    mp4: "sample.mp4",
    pdf: "sample.pdf",
    png: "sample.png",
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
