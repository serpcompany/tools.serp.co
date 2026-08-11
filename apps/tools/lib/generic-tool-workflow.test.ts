import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { before } from "node:test";

import { init as initializeJpegDecoder } from "@jsquash/jpeg/decode.js";

import { toolCatalog } from "@serp-tools/app-core/lib/tool-catalog";

import {
  createGenericToolWorkflow,
  getGenericToolContract,
  verifyGenericMediaSemantics,
  type GenericWorkflowAdapters,
} from "./generic-tool-workflow.ts";
import { getToolProcessorAvailability } from "./tool-processor-registry.ts";
import { selectToolRenderer } from "./tool-renderer.ts";

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../benchmarks/fixtures/${name}`, import.meta.url)),
  );

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
