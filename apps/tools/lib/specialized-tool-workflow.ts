import Papa from "papaparse";
import { toolCatalog } from "@serp-tools/app-core/lib/tool-catalog";

import { executionProvenance, type ExecutionEngine } from "./tool-execution-provenance.ts";
import {
  createToolWorkflow,
  defineToolExecutionIntent,
  defineToolSupport,
  type ProcessorSupportRequest,
  type SemanticVerification,
  type ToolProcessor,
  type ToolWorkflow,
  type WorkflowAcquiredInput,
  type WorkflowInput,
  type WorkflowMedia,
  type WorkflowOutcome,
  type WorkflowRequest,
} from "./tool-workflow/index.ts";
import {
  getSpecializedToolDefinition,
  SPECIALIZED_TOOL_IDS,
  type SpecializedToolFamily,
} from "./specialized-tool-policy.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_INPUT_BYTES = 32 * 1_024 * 1_024;
const MAX_OUTPUT_BYTES = 64 * 1_024 * 1_024;
const PDFJS_WORKER_URL = "/vendor/pdfjs/pdf.worker.min.js";

export { SPECIALIZED_TOOL_IDS } from "./specialized-tool-policy.ts";
type PrimaryOperation = Readonly<{
  class: "library" | "hybrid" | "repository-authored";
  identity: string;
  rationale: string;
}>;

export type SpecializedToolContract =
  | Readonly<{
      state: "supported";
      toolId: string;
      adapterId: "browser-specialized-workflow";
      primaryOperation: PrimaryOperation;
    }>
  | Readonly<{
      state: "unsupported";
      toolId: string;
      reason: string;
    }>;

const operations = Object.freeze({
  "json-to-csv": Object.freeze({
    class: "library",
    identity: "Papa Parse 5",
    rationale:
      "Papa Parse owns CSV escaping and serialization after the adapter validates a non-empty JSON object array.",
  }),
  "csv-combiner": Object.freeze({
    class: "hybrid",
    identity: "Papa Parse 5 with bounded schema-union policy",
    rationale:
      "Papa Parse owns CSV grammar including multiline quoted cells; the adapter only unions headers and aligns rows.",
  }),
  "html-to-markdown": Object.freeze({
    class: "library",
    identity: "@kreuzberg/html-to-markdown-wasm 3.1",
    rationale:
      "The pinned Kreuzberg WebAssembly library owns HTML parsing and Markdown conversion in browser and Node verification environments.",
  }),
  "character-counter": Object.freeze({
    class: "repository-authored",
    identity: "bounded character-statistics policy",
    rationale:
      "The transparent operation counts text code units and simple language-independent separators without implementing a file codec.",
  }),
  pdf: Object.freeze({
    class: "hybrid",
    identity: "pdfjs-dist parser plus vendored PDF.js annotation viewer",
    rationale:
      "PDF.js parses the complete input before delivery; the vendored viewer owns rendering, annotations, and export behavior.",
  }),
} satisfies Record<string, PrimaryOperation>);

const contracts = new Map<string, SpecializedToolContract>(
  SPECIALIZED_TOOL_IDS.map((toolId) => [
    toolId,
    Object.freeze({
      state: "supported" as const,
      toolId,
      adapterId: "browser-specialized-workflow" as const,
      primaryOperation: operations[getSpecializedToolDefinition(toolId)!.family],
    }),
  ]),
);

export function getSpecializedToolContract(toolId: string): SpecializedToolContract {
  return (
    contracts.get(toolId) ??
    Object.freeze({
      state: "unsupported" as const,
      toolId,
      reason: "No specialized shared-workflow processor is registered for this Tool id.",
    })
  );
}

type Interaction = Extract<WorkflowInput, { kind: "interaction" }>["interaction"];

function engine(id: string): ExecutionEngine {
  const resolved = executionProvenance.getEngine(id);
  if (!resolved) throw new TypeError(`Missing execution engine: ${id}`);
  return resolved;
}

function support(
  acquisition: WorkflowInput["kind"],
  inputs: readonly Readonly<{ format: string; mimeTypes: readonly string[] }>[],
  output: Readonly<{ format: string; mimeType: string }>,
) {
  return defineToolSupport({
    acquisition,
    inputs,
    outputs: [output],
    resourceLimits: {
      maxInputBytes: MAX_INPUT_BYTES,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxTotalOutputBytes: MAX_OUTPUT_BYTES,
    },
    outputCardinality: { min: 1, max: 1 },
  });
}

function noOptions(value: unknown) {
  return value === undefined
    ? ({ ok: true, value: Object.freeze({}) } as const)
    : ({ ok: false, message: "This operation does not accept options" } as const);
}

function exactSupport(request: ProcessorSupportRequest<Readonly<object>>) {
  return request.outputs.length === 1
    ? ({ supported: true } as const)
    : ({ supported: false, message: "Exactly one output is required" } as const);
}

function interactionText(
  input: Interaction,
  expectedFormat: string,
  expectedMimeType: string,
): string {
  if (
    input.format !== expectedFormat ||
    input.mimeType !== expectedMimeType ||
    typeof input.value !== "string"
  ) {
    throw new TypeError(`Expected ${expectedFormat} text interaction`);
  }
  const actualBytes = encoder.encode(input.value).byteLength;
  if (input.bytes !== actualBytes) {
    throw new TypeError("Interaction byte count does not match its text value");
  }
  return input.value;
}

function verified(): SemanticVerification {
  return { status: "verified" };
}

function rejected(error: unknown): SemanticVerification {
  return {
    status: "rejected",
    message: error instanceof Error ? error.message : String(error),
  };
}

function interactionProcessor(args: {
  engineId: string;
  input: { format: string; mimeType: string };
  output: { format: string; mimeType: string; name: string };
  convert(value: string, signal: AbortSignal): Promise<string> | string;
  verifyOutput(value: string): void;
}): ToolProcessor<Readonly<object>, Interaction> {
  return {
    engine: engine(args.engineId),
    support: support("interaction", [
      { format: args.input.format, mimeTypes: [args.input.mimeType] },
    ], args.output),
    parseOptions: noOptions,
    decideSupport: exactSupport,
    async verifyInput(input) {
      try {
        interactionText(input, args.input.format, args.input.mimeType);
        return verified();
      } catch (error) {
        return rejected(error);
      }
    },
    async process(input, _options, context) {
      context.signal.throwIfAborted();
      const value = interactionText(input, args.input.format, args.input.mimeType);
      const converted = await args.convert(value, context.signal);
      context.signal.throwIfAborted();
      context.reportProgress(1);
      return [{
        name: args.output.name,
        format: args.output.format,
        mimeType: args.output.mimeType,
        bytes: encoder.encode(converted),
      }];
    },
    async verifyResult(result, context) {
      try {
        args.verifyOutput(decoder.decode(result.bytes));
        context.reportProgress(1);
        return verified();
      } catch (error) {
        return rejected(error);
      }
    },
  };
}

function parseJsonRecords(text: string): Record<string, unknown>[] {
  const value = JSON.parse(text) as unknown;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))
  ) {
    throw new TypeError("JSON must be a non-empty array of objects");
  }
  return value as Record<string, unknown>[];
}

function parseCsv(text: string): { fields: string[]; rows: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  const fatalErrors = parsed.errors.filter(
    ({ code }) => code !== "UndetectableDelimiter",
  );
  if (fatalErrors.length > 0) {
    throw new TypeError(fatalErrors[0]?.message ?? "CSV parser rejected input");
  }
  const fields = parsed.meta.fields ?? [];
  if (fields.length === 0 || fields.some((field) => !field.trim())) {
    throw new TypeError("CSV requires non-empty headers");
  }
  if (new Set(fields).size !== fields.length) {
    throw new TypeError("CSV headers must be unique");
  }
  if (parsed.data.length === 0) throw new TypeError("CSV requires a data row");
  return { fields, rows: parsed.data };
}

const jsonProcessor = interactionProcessor({
  engineId: "browser-json-to-csv",
  input: { format: "json", mimeType: "application/json" },
  output: { format: "csv", mimeType: "text/csv", name: "data.csv" },
  convert(value) {
    return Papa.unparse(parseJsonRecords(value), { newline: "\n" });
  },
  verifyOutput(value) {
    parseCsv(value);
  },
});

type HtmlModule = Readonly<{
  convert(html: string, options?: null): Readonly<{ content: string | null }>;
  default?: () => Promise<void>;
}>;

async function convertHtml(html: string, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const converter = (typeof window === "undefined"
    ? await import("@kreuzberg/html-to-markdown-wasm/dist-node")
    : await import("@kreuzberg/html-to-markdown-wasm/dist-web")) as HtmlModule;
  if (typeof window !== "undefined" && converter.default) await converter.default();
  signal.throwIfAborted();
  const content = converter.convert(html, null).content;
  if (!content?.trim()) throw new TypeError("HTML conversion produced no Markdown");
  return content;
}

const htmlProcessor = interactionProcessor({
  engineId: "browser-html-to-markdown",
  input: { format: "html", mimeType: "text/html" },
  output: { format: "markdown", mimeType: "text/markdown", name: "converted.md" },
  convert: convertHtml,
  verifyOutput(value) {
    if (!value.trim()) throw new TypeError("Markdown result is empty");
  },
});

export type CharacterStatistics = Readonly<{
  characters: number;
  charactersNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  readingTime: number;
  speakingTime: number;
}>;

export function computeCharacterStatistics(text: string): CharacterStatistics {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return Object.freeze({
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, "").length,
    words,
    sentences: text.split(/[.!?]+/).filter((sentence) => sentence.trim()).length,
    paragraphs: text.split(/\n\n+/).filter((paragraph) => paragraph.trim()).length,
    lines: text.split(/\n/).length,
    readingTime: Math.ceil(words / 200),
    speakingTime: Math.ceil(words / 150),
  });
}

const characterProcessor = interactionProcessor({
  engineId: "browser-character-counter",
  input: { format: "text", mimeType: "text/plain" },
  output: {
    format: "stats",
    mimeType: "application/json",
    name: "character-statistics.json",
  },
  convert(value) {
    return JSON.stringify(computeCharacterStatistics(value));
  },
  verifyOutput(value) {
    const parsed = JSON.parse(value) as Partial<CharacterStatistics>;
    for (const key of [
      "characters", "charactersNoSpaces", "words", "sentences", "paragraphs",
      "lines", "readingTime", "speakingTime",
    ] as const) {
      if (!Number.isSafeInteger(parsed[key]) || (parsed[key] ?? -1) < 0) {
        throw new TypeError("Character statistics result is invalid");
      }
    }
  },
});

const csvProcessor: ToolProcessor<Readonly<object>, readonly WorkflowMedia[]> = {
  engine: engine("browser-csv-combiner"),
  support: support("files", [{ format: "csv", mimeTypes: ["text/csv"] }], {
    format: "csv",
    mimeType: "text/csv",
  }),
  parseOptions: noOptions,
  decideSupport(request) {
    return request.detectedInput.bytes > 0
      ? { supported: true }
      : { supported: false, message: "CSV input is empty" };
  },
  async verifyInput(inputs) {
    try {
      if (inputs.length < 2) throw new TypeError("At least two CSV files are required");
      for (const input of inputs) parseCsv(decoder.decode(input.bytes));
      return verified();
    } catch (error) {
      return rejected(error);
    }
  },
  async process(inputs, _options, context) {
    context.signal.throwIfAborted();
    const parsed = inputs.map((input) => parseCsv(decoder.decode(input.bytes)));
    const headers = [...new Set(parsed.flatMap(({ fields }) => fields))];
    const rows = parsed.flatMap(({ rows }) =>
      rows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? ""]))),
    );
    context.reportProgress(1);
    return [{
      name: "combined.csv",
      format: "csv",
      mimeType: "text/csv",
      bytes: encoder.encode(Papa.unparse(rows, { columns: headers, newline: "\n" })),
    }];
  },
  async verifyResult(result, context) {
    try {
      parseCsv(decoder.decode(result.bytes));
      context.reportProgress(1);
      return verified();
    } catch (error) {
      return rejected(error);
    }
  },
};

type PdfModule = Readonly<{
  GlobalWorkerOptions?: { workerSrc: string };
  getDocument(options: Readonly<{ data: Uint8Array; isEvalSupported: boolean; useWorkerFetch: boolean }> ):
    Readonly<{ promise: Promise<Readonly<{ numPages: number }>>; destroy(): Promise<void> }>;
}>;

async function verifyPdf(bytes: Uint8Array, signal: AbortSignal): Promise<SemanticVerification> {
  let task: ReturnType<PdfModule["getDocument"]> | undefined;
  try {
    signal.throwIfAborted();
    const pdfjs = (typeof window === "undefined"
      ? await import("pdfjs-dist/legacy/build/pdf.mjs")
      : await import(/* webpackIgnore: true */ "/vendor/pdfjs/pdf.min.mjs")) as unknown as PdfModule;
    if (typeof window !== "undefined" && pdfjs.GlobalWorkerOptions) {
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
    }
    task = pdfjs.getDocument({ data: Uint8Array.from(bytes), isEvalSupported: false, useWorkerFetch: false });
    const document = await task.promise;
    signal.throwIfAborted();
    return document.numPages > 0 ? verified() : rejected("PDF has no pages");
  } catch (error) {
    return rejected(error);
  } finally {
    await task?.destroy().catch(() => {});
  }
}

const pdfProcessor: ToolProcessor<Readonly<object>> = {
  engine: engine("browser-pdf-viewer"),
  support: support("file", [{ format: "pdf", mimeTypes: ["application/pdf"] }], {
    format: "pdf", mimeType: "application/pdf",
  }),
  parseOptions: noOptions,
  decideSupport: exactSupport,
  async verifyInput(input, context) {
    return verifyPdf(input.bytes, context.signal);
  },
  async process(input, _options, context) {
    context.signal.throwIfAborted();
    context.reportProgress(1);
    return [{ ...input, bytes: Uint8Array.from(input.bytes) }];
  },
  async verifyResult(result, context) {
    const verification = await verifyPdf(result.bytes, context.signal);
    if (verification.status === "verified") context.reportProgress(1);
    return verification;
  },
};

function processorForFamily(
  family: SpecializedToolFamily | undefined,
): ToolProcessor<unknown, WorkflowAcquiredInput> | undefined {
  const processor = family === "json-to-csv"
    ? jsonProcessor
    : family === "csv-combiner"
      ? csvProcessor
      : family === "html-to-markdown"
        ? htmlProcessor
        : family === "character-counter"
          ? characterProcessor
          : family === "pdf"
            ? pdfProcessor
            : undefined;
  return processor as unknown as ToolProcessor<unknown, WorkflowAcquiredInput> | undefined;
}

function resolveProcessor(toolId: string): ToolProcessor<unknown, WorkflowAcquiredInput> | undefined {
  return processorForFamily(getSpecializedToolDefinition(toolId)?.family);
}

const canonicalOutputMimeType = Object.freeze({
  csv: "text/csv",
  markdown: "text/markdown",
  pdf: "application/pdf",
  stats: "application/json",
} satisfies Record<string, string>);

export function getSpecializedToolIntent(toolId: string) {
  if (!getSpecializedToolDefinition(toolId)) return undefined;
  const tool = toolCatalog.getById(toolId);
  const format = tool?.to ?? tool?.content?.tool.to;
  const mimeType = format
    ? canonicalOutputMimeType[format as keyof typeof canonicalOutputMimeType]
    : undefined;
  return tool && format && mimeType
    ? defineToolExecutionIntent({
        requestedOperation: tool.operation,
        outputs: [{ format, mimeType }],
      })
    : undefined;
}

export type SpecializedWorkflowDeliveryPort = (media: WorkflowMedia) => Promise<string>;
export type SpecializedWorkflowPorts = Readonly<{
  deliver: SpecializedWorkflowDeliveryPort;
  telemetry: Readonly<{
    start(runId: string, request: WorkflowRequest, at: number): Promise<void>;
    terminal(runId: string, status: WorkflowOutcome["status"], at: number): Promise<void>;
  }>;
  nextId(kind: "run" | "delivery"): string;
  clock?: Readonly<{ now(): number }>;
}>;

export function createSpecializedToolWorkflow(ports: SpecializedWorkflowPorts): ToolWorkflow {
  return createToolWorkflow({
    acquisition: {
      file: { async acquire(input, context) { context.reportProgress(1); return input.media; } },
      url: { async acquire() { throw new TypeError("Specialized Tools do not accept URLs"); } },
      files: { async acquire(input, context) { context.reportProgress(1); return input.media; } },
      interaction: { async acquire(input, context) { context.reportProgress(1); return input.interaction; } },
    },
    resolveIntent(toolId) {
      return getSpecializedToolIntent(toolId);
    },
    resolveProcessor,
    async deliver(result, context) {
      const deliveryId = await ports.deliver(result);
      context.reportProgress(1);
      return deliveryId;
    },
    runtime: { async open() { return { release: async () => {} }; } },
    telemetry: ports.telemetry,
    clock: ports.clock ?? { now: () => Date.now() },
    nextId: ports.nextId,
  });
}
