import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Papa from "papaparse";

import {
  createSpecializedToolWorkflow,
  getSpecializedToolContract,
  type SpecializedWorkflowDeliveryPort,
} from "./specialized-tool-workflow.ts";
import {
  createBrowserSpecializedWorkflow,
  createSpecializedRunController,
} from "./specialized-browser-workflow.ts";
import { getToolProcessorAvailability } from "./tool-processor-registry.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function recorder() {
  const deliveries: Parameters<SpecializedWorkflowDeliveryPort>[0][] = [];
  const workflow = createSpecializedToolWorkflow({
    deliver: async (result) => {
      deliveries.push(result);
      return `delivery-${deliveries.length}`;
    },
    telemetry: { start: async () => {}, terminal: async () => {} },
    nextId: (() => {
      let id = 0;
      return (kind) => `${kind}-${++id}`;
    })(),
  });
  return { deliveries, workflow };
}

test("specialized contracts enumerate the exact migrated Tool ids and ownership", () => {
  const ids = [
    "json-to-csv",
    "csv-combiner",
    "html-to-markdown",
    "character-counter",
    "pdf-editor",
    "pdf-editor-extension",
    "pdf-editor-mac",
    "pdf-editor-windows",
    "pdf-reader",
    "pdf-reader-extension",
    "pdf-reader-mac",
    "pdf-reader-windows",
    "pdf-viewer",
    "pdf-viewer-extension",
    "pdf-viewer-windows",
  ];
  assert.deepEqual(ids.map((id) => getSpecializedToolContract(id).toolId), ids);
  for (const id of ids) {
    const contract = getSpecializedToolContract(id);
    assert.equal(contract.state, "supported");
    if (contract.state !== "supported") throw new Error("unsupported contract");
    assert.match(contract.primaryOperation.class, /^(library|hybrid|repository-authored)$/);
    assert.ok(contract.primaryOperation.identity);
    assert.ok(contract.primaryOperation.rationale.length > 40);
    assert.deepEqual(getToolProcessorAvailability(id), {
      kind: "wired",
      toolId: id,
      adapterId: "browser-specialized-workflow",
    });
  }
  assert.equal(getSpecializedToolContract("not-a-tool").state, "unsupported");
});

test("workflow.run converts JSON interaction to parser-valid CSV", async () => {
  const { workflow, deliveries } = recorder();
  const outcome = await workflow.run({
    toolId: "json-to-csv",
    input: {
      kind: "interaction",
      interaction: {
        format: "json",
        mimeType: "application/json",
        value: String.raw`[{"name":"Ada","note":"comma, quote \" and newline\nkept"}]`,
        bytes: 59,
      },
    },
  });
  assert.equal(outcome.status, "succeeded");
  const parsed = Papa.parse<Record<string, string>>(decoder.decode(deliveries[0]!.bytes), {
    header: true,
  });
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.data[0], {
    name: "Ada",
    note: 'comma, quote " and newline\nkept',
  });
});

test("workflow.run combines two CSV files with multiline fields and aligned schemas", async () => {
  const { workflow, deliveries } = recorder();
  const outcome = await workflow.run({
    toolId: "csv-combiner",
    input: {
      kind: "files",
      media: [
        {
          name: "one.csv",
          format: "csv",
          mimeType: "text/csv",
          bytes: encoder.encode('name,note\nAda,"line one\nline two"\n'),
        },
        {
          name: "two.csv",
          format: "csv",
          mimeType: "text/csv",
          bytes: encoder.encode("name,city\nGrace,Arlington\n"),
        },
      ],
    },
  });
  assert.equal(outcome.status, "succeeded");
  const parsed = Papa.parse<Record<string, string>>(decoder.decode(deliveries[0]!.bytes), {
    header: true,
    skipEmptyLines: true,
  });
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.data, [
    { name: "Ada", note: "line one\nline two", city: "" },
    { name: "Grace", note: "", city: "Arlington" },
  ]);
});

test("interaction processors return Markdown and character statistics without fake files", async () => {
  const markdownRun = recorder();
  const markdown = await markdownRun.workflow.run({
    toolId: "html-to-markdown",
    input: {
      kind: "interaction",
      interaction: {
        format: "html",
        mimeType: "text/html",
        value: "<h1>Title</h1><p>Hello <strong>world</strong>.</p>",
        bytes: 50,
      },
    },
  });
  assert.equal(markdown.status, "succeeded");
  assert.match(decoder.decode(markdownRun.deliveries[0]!.bytes), /^# Title/m);
  assert.match(decoder.decode(markdownRun.deliveries[0]!.bytes), /\*\*world\*\*/);

  const counterRun = recorder();
  const counted = await counterRun.workflow.run({
    toolId: "character-counter",
    input: {
      kind: "interaction",
      interaction: {
        format: "text",
        mimeType: "text/plain",
        value: "Hello world.\n\nSecond paragraph!",
        bytes: 31,
      },
    },
  });
  assert.equal(counted.status, "succeeded");
  assert.deepEqual(JSON.parse(decoder.decode(counterRun.deliveries[0]!.bytes)), {
    characters: 31,
    charactersNoSpaces: 27,
    words: 4,
    sentences: 2,
    paragraphs: 2,
    lines: 3,
    readingTime: 1,
    speakingTime: 1,
  });
});

test("PDF workflow parses a real PDF before making it available to the viewer", async () => {
  const bytes = new Uint8Array(
    readFileSync(new URL("../benchmarks/fixtures/sample.pdf", import.meta.url)),
  );
  const { workflow, deliveries } = recorder();
  const outcome = await workflow.run({
    toolId: "pdf-editor",
    input: {
      kind: "file",
      media: {
        name: "sample.pdf",
        format: "pdf",
        mimeType: "application/pdf",
        bytes,
      },
    },
  });
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(deliveries[0]!.bytes, bytes);

  const invalid = recorder();
  const rejected = await invalid.workflow.run({
    toolId: "pdf-reader",
    input: {
      kind: "file",
      media: {
        name: "fake.pdf",
        format: "pdf",
        mimeType: "application/pdf",
        bytes: encoder.encode("%PDF fake"),
      },
    },
  });
  assert.equal(rejected.status, "failed");
});

test("browser delivery keeps interaction results in memory and owns stable PDF URLs", async () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let sequence = 0;
  URL.createObjectURL = () => `blob:specialized-${++sequence}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const { workflow, deliveries } = createBrowserSpecializedWorkflow();
    const text = "One two.";
    const counted = await workflow.run({
      toolId: "character-counter",
      input: {
        kind: "interaction",
        interaction: {
          format: "text",
          mimeType: "text/plain",
          value: text,
          bytes: encoder.encode(text).byteLength,
        },
      },
    });
    assert.equal(counted.status, "succeeded");
    if (counted.status !== "succeeded") return;
    assert.equal(sequence, 0, "interaction delivery must not allocate a URL");
    assert.equal(
      JSON.parse(deliveries.text(counted.results[0]!.deliveryId)!).words,
      2,
    );

    const pdf = new Uint8Array(
      readFileSync(new URL("../benchmarks/fixtures/sample.pdf", import.meta.url)),
    );
    const viewed = await workflow.run({
      toolId: "pdf-viewer",
      input: {
        kind: "file",
        media: {
          name: "sample.pdf",
          format: "pdf",
          mimeType: "application/pdf",
          bytes: pdf,
        },
      },
    });
    assert.equal(viewed.status, "succeeded");
    if (viewed.status !== "succeeded") return;
    const deliveryId = viewed.results[0]!.deliveryId;
    assert.equal(deliveries.objectUrl(deliveryId), "blob:specialized-1");
    assert.equal(deliveries.objectUrl(deliveryId), "blob:specialized-1");
    deliveries.release(deliveryId);
    assert.deepEqual(revoked, ["blob:specialized-1"]);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("shared run controller suppresses stale file reads and cancels replacement/unmount work", async () => {
  const requests: string[] = [];
  const signals: AbortSignal[] = [];
  const controller = createSpecializedRunController({
    async run(request, options) {
      requests.push(request.toolId);
      signals.push(options?.signal ?? new AbortController().signal);
      return {
        status: "cancelled",
        runId: request.toolId,
        telemetry: { start: "not-attempted", terminal: "not-attempted" },
      };
    },
  });
  let resolveOld!: (value: ArrayBuffer) => void;
  const old = controller.runFiles("csv-combiner", [
    {
      name: "old.csv",
      type: "text/csv",
      size: 4,
      arrayBuffer: () => new Promise((resolve) => { resolveOld = resolve; }),
    },
  ]);
  const latest = controller.runFiles("csv-combiner", [
    {
      name: "new.csv",
      type: "text/csv",
      size: 4,
      arrayBuffer: async () => encoder.encode("a\n1\n").buffer,
    },
  ]);
  resolveOld(encoder.encode("a\n0\n").buffer);
  await Promise.all([old, latest]);
  assert.deepEqual(requests, ["csv-combiner"]);

  await controller.runInteraction("character-counter", "text", "text/plain", "one");
  const activeSignal = signals.at(-1)!;
  await controller.runInteraction("character-counter", "text", "text/plain", "two");
  assert.equal(activeSignal.aborted, true);
  controller.dispose();
  assert.equal(signals.at(-1)!.aborted, true);
});

test("clearing the shared controller cancels a pending interaction", async () => {
  const requests: string[] = [];
  const controller = createSpecializedRunController({
    async run(request) {
      requests.push(request.toolId);
      return {
        status: "cancelled",
        runId: request.toolId,
        telemetry: { start: "not-attempted", terminal: "not-attempted" },
      };
    },
  });

  controller.scheduleInteraction({
    toolId: "html-to-markdown",
    format: "html",
    mimeType: "text/html",
    value: "<p>stale</p>",
  }, 5);
  controller.clear();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(requests, []);
});
