import { PDFDocument } from "pdf-lib";

import { toolCatalog, type CatalogTool } from "@serp-tools/app-core/lib/tool-catalog";

import { beginToolRun } from "./telemetry.ts";
import { detectCapabilities } from "./capabilities.ts";
import {
  compressFile,
  convertWithWorker,
} from "./convert/workerClient.ts";
import {
  createToolWorkflow,
  type ToolProcessor,
  type ToolWorkflow,
  type WorkflowMedia,
  type WorkflowOutcome,
  type WorkflowRunOptions,
} from "./tool-workflow/index.ts";
import { verifyMediaSemantics } from "./tool-workflow/semantic-validators.ts";
import { executionProvenance } from "./tool-execution-provenance.ts";
import { selectToolRenderer } from "./tool-renderer.ts";

const FORMAT_MIME_TYPES = Object.freeze({
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
} satisfies Readonly<Record<string, string>>);

const IMAGE_INPUTS = new Set(["jpeg", "jpg", "png"]);
const IMAGE_OUTPUTS = new Set(["jpeg", "jpg", "pdf", "png"]);
const PDF_OUTPUTS = new Set(["jpeg", "jpg", "png"]);
const MEDIA_CONVERSIONS = new Set([
  "mp4->m4a",
]);
const COMPRESSION_FORMATS = new Set([
  "jpeg",
  "jpg",
  "m4a",
  "mp4",
  "png",
]);
const MAX_INPUT_BYTES = 256 * 1_024 * 1_024;
const MAX_OUTPUT_BYTES = 512 * 1_024 * 1_024;
const MAX_TOTAL_OUTPUT_BYTES = 1_024 * 1_024 * 1_024;

export type GenericToolContract =
  | Readonly<{
      state: "supported";
      toolId: string;
      adapterId: "generic-conversion" | "generic-compression";
      operation: "convert" | "compress";
      input: Readonly<{ format: string; mimeType: string }>;
      output: Readonly<{ format: string; mimeType: string }>;
    }>
  | Readonly<{
      state: "unsupported";
      toolId: string;
      reason: string;
    }>;

type GenericEngineContext = Readonly<{
  signal: AbortSignal;
  reportProgress(progress: number): void;
  registerWorker(worker: Worker): Promise<void>;
}>;

export type GenericWorkflowAdapters = Readonly<{
  decideSupport(request: Readonly<{
    operation: "convert" | "compress";
    inputFormat: string;
    outputFormat: string;
  }>): Readonly<{ supported: true } | { supported: false; message: string }>;
  convert(request: Readonly<{
    from: string;
    to: string;
    bytes: Uint8Array;
    quality: number;
    context: GenericEngineContext;
  }>): Promise<readonly Uint8Array[]>;
  compress(request: Readonly<{
    format: string;
    bytes: Uint8Array;
    quality: number;
    context: GenericEngineContext;
  }>): Promise<Uint8Array>;
  deliver(result: WorkflowMedia): Promise<string>;
  telemetry: Readonly<{
    start(
      runId: string,
      request: Readonly<{ toolId: string; inputBytes: number }>,
    ): Promise<void>;
    terminal(runId: string, status: WorkflowOutcome["status"]): Promise<void>;
  }>;
}>;

function mimeTypeFor(format: string): string | undefined {
  return FORMAT_MIME_TYPES[format as keyof typeof FORMAT_MIME_TYPES];
}

function supportedContract(tool: CatalogTool): GenericToolContract | undefined {
  if (
    selectToolRenderer(tool) !== "generic" ||
    !tool.from ||
    !tool.to ||
    (tool.operation !== "convert" && tool.operation !== "compress")
  ) {
    return undefined;
  }
  const from = tool.from.toLowerCase();
  const to = tool.to.toLowerCase();
  const inputMimeType = mimeTypeFor(from);
  const outputMimeType = mimeTypeFor(to);
  if (!inputMimeType || !outputMimeType) return undefined;

  const exactConversion =
    (IMAGE_INPUTS.has(from) && IMAGE_OUTPUTS.has(to)) ||
    (from === "pdf" && PDF_OUTPUTS.has(to)) ||
    MEDIA_CONVERSIONS.has(`${from}->${to}`);
  const exactCompression =
    tool.operation === "compress" && from === to && COMPRESSION_FORMATS.has(from);
  if (tool.operation === "convert" ? !exactConversion : !exactCompression) {
    return undefined;
  }

  return Object.freeze({
    state: "supported",
    toolId: tool.id,
    adapterId:
      tool.operation === "compress"
        ? "generic-compression"
        : "generic-conversion",
    operation: tool.operation,
    input: Object.freeze({ format: from, mimeType: inputMimeType }),
    output: Object.freeze({ format: to, mimeType: outputMimeType }),
  });
}

function unsupportedContract(toolId: string): GenericToolContract {
  return Object.freeze({
    state: "unsupported",
    toolId,
    reason:
      "This published route has no exact generic processor and semantic verifier contract; it is unavailable instead of returning renamed fallback bytes.",
  });
}

const contractByToolId = new Map<string, GenericToolContract>(
  toolCatalog.activeTools
    .filter((tool) => selectToolRenderer(tool) === "generic")
    .map((tool) => [tool.id, supportedContract(tool) ?? unsupportedContract(tool.id)]),
);

export function getGenericToolContract(toolId: string): GenericToolContract {
  return contractByToolId.get(toolId) ?? unsupportedContract(toolId);
}

export async function verifyGenericMediaSemantics(media: WorkflowMedia) {
  const expectedMimeType = mimeTypeFor(media.format);
  if (!expectedMimeType || media.mimeType !== expectedMimeType) {
    return {
      status: "rejected" as const,
      message: `Expected ${expectedMimeType ?? "a supported MIME"}, received ${media.mimeType}`,
    };
  }
  if (media.format === "m4a") {
    return verifyMediaSemantics({
      ...media,
      format: "mp4",
      mimeType: "video/mp4",
    });
  }
  if (media.format === "pdf") {
    try {
      await PDFDocument.load(media.bytes, {
        ignoreEncryption: false,
        parseSpeed: 0,
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      return { status: "verified" as const };
    } catch {
      return { status: "rejected" as const, message: "PDF parser rejected the file" };
    }
  }
  const verification = await verifyMediaSemantics(
    media.format === "jpeg" ? { ...media, format: "jpg" } : media,
  );
  if (
    verification.status === "rejected" &&
    (verification.message === "PNG decoder rejected the image data" ||
      verification.message === "JPEG decoder rejected the image data") &&
    typeof createImageBitmap === "function"
  ) {
    try {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(media.bytes)], { type: media.mimeType }),
      );
      const valid = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close();
      return valid
        ? { status: "verified" as const }
        : verification;
    } catch {
      return verification;
    }
  }
  return verification;
}

type GenericOptions = Readonly<{ quality: number }>;

function parseOptions(options: unknown) {
  if (options === undefined) return { ok: true as const, value: { quality: 0.82 } };
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return { ok: false as const, message: "Options must be an object" };
  }
  const keys = Object.keys(options);
  const quality = (options as { quality?: unknown }).quality;
  if (
    keys.some((key) => key !== "quality") ||
    typeof quality !== "number" ||
    !Number.isFinite(quality) ||
    quality < 0.1 ||
    quality > 0.95
  ) {
    return { ok: false as const, message: "quality must be between 0.1 and 0.95" };
  }
  return { ok: true as const, value: { quality } };
}

function baseName(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  return withoutExtension || "result";
}

function processorFor(
  contract: Extract<GenericToolContract, { state: "supported" }>,
  adapters: GenericWorkflowAdapters,
): ToolProcessor<GenericOptions> | undefined {
  const provenance = executionProvenance.getByToolId(contract.toolId);
  const engine =
    provenance.kind === "mapped"
      ? executionProvenance.getEngine(provenance.engineIds[0] ?? "")
      : undefined;
  if (!engine) return undefined;
  const multiplePages =
    contract.operation === "convert" && contract.input.format === "pdf";

  return {
    engine,
    support: {
      acquisition: "file",
      inputs: [
        {
          format: contract.input.format,
          mimeTypes: [contract.input.mimeType],
        },
      ],
      outputs: [contract.output],
      resourceLimits: {
        maxInputBytes: MAX_INPUT_BYTES,
        maxOutputBytes: MAX_OUTPUT_BYTES,
        maxTotalOutputBytes: MAX_TOTAL_OUTPUT_BYTES,
      },
      outputCardinality: { min: 1, max: multiplePages ? 100 : 1 },
    },
    parseOptions,
    decideSupport(request) {
      const exactContract = request.detectedInput.format === contract.input.format &&
        request.detectedInput.mimeType === contract.input.mimeType &&
        request.requestedOperation === contract.operation &&
        request.outputs.length === 1 &&
        request.outputs[0]?.format === contract.output.format &&
        request.outputs[0]?.mimeType === contract.output.mimeType;
      if (!exactContract) {
        return {
          supported: false,
          message: `Unsupported ${request.detectedInput.format} ${request.requestedOperation} request`,
        };
      }
      return adapters.decideSupport({
        operation: contract.operation,
        inputFormat: contract.input.format,
        outputFormat: contract.output.format,
      });
    },
    async verifyInput(input) {
      return verifyGenericMediaSemantics(input);
    },
    async process(input, options, context) {
      const engineContext: GenericEngineContext = {
        signal: context.signal,
        reportProgress: context.reportProgress,
        async registerWorker(worker) {
          await context.openResource("worker");
          await context.registerCleanup(async () => worker.terminate());
        },
      };
      const outputBytes =
        contract.operation === "compress"
          ? [
              await adapters.compress({
                format: contract.input.format,
                bytes: input.bytes,
                quality: options.quality,
                context: engineContext,
              }),
            ]
          : await adapters.convert({
              from: contract.input.format,
              to: contract.output.format,
              bytes: input.bytes,
              quality: options.quality,
              context: engineContext,
            });
      const stem = baseName(input.name);
      return outputBytes.map((bytes, index) => ({
        name:
          contract.operation === "compress"
            ? `${stem}_compressed.${contract.output.format}`
            : outputBytes.length > 1
              ? `${stem}_page${index + 1}.${contract.output.format}`
              : `${stem}.${contract.output.format}`,
        format: contract.output.format,
        mimeType: contract.output.mimeType,
        bytes,
      }));
    },
    async verifyResult(result) {
      return verifyGenericMediaSemantics(result);
    },
  };
}

export function createGenericToolWorkflow(
  adapters: GenericWorkflowAdapters,
): ToolWorkflow {
  let nextSequence = 0;
  return createToolWorkflow({
    acquisition: {
      file: {
        async acquire(input, context) {
          context.signal.throwIfAborted();
          context.reportProgress(1);
          return input.media;
        },
      },
      url: {
        async acquire() {
          throw new Error("Generic conversion requires a file");
        },
      },
    },
    resolveIntent(toolId) {
      const contract = getGenericToolContract(toolId);
      return contract.state === "supported"
        ? {
            requestedOperation: contract.operation,
            outputs: [contract.output],
          }
        : undefined;
    },
    resolveProcessor(toolId) {
      const contract = getGenericToolContract(toolId);
      return contract.state === "supported"
        ? processorFor(contract, adapters)
        : undefined;
    },
    async deliver(result, context) {
      context.signal.throwIfAborted();
      await context.openResource("blob");
      return adapters.deliver(result);
    },
    runtime: {
      async open() {
        return { async release() {} };
      },
    },
    telemetry: {
      async start(runId, request) {
        const bytes =
          request.input.kind === "file" ? request.input.media.bytes.byteLength : 0;
        await adapters.telemetry.start(runId, {
          toolId: request.toolId,
          inputBytes: bytes,
        });
      },
      async terminal(runId, status) {
        await adapters.telemetry.terminal(runId, status);
      },
    },
    clock: { now: () => Date.now() },
    nextId(kind) {
      nextSequence += 1;
      return `${kind}-${nextSequence}`;
    },
  });
}

type ToolRunHandle = ReturnType<typeof beginToolRun>;
const browserTelemetryHandles = new Map<string, ToolRunHandle>();

const browserAdapters: GenericWorkflowAdapters = {
  decideSupport(request) {
    const needsMediaRuntime =
      (["m4a", "mp4"].includes(request.inputFormat) ||
        ["m4a", "mp4"].includes(request.outputFormat));
    if (needsMediaRuntime && !detectCapabilities().supportsVideoConversion) {
      return {
        supported: false,
        message: "Media processing is not available in this browser.",
      };
    }
    return { supported: true };
  },
  async convert({ from, to, bytes, quality, context }) {
    context.signal.throwIfAborted();
    const worker = new Worker(
      new URL("../workers/convert.worker.js", import.meta.url),
      { type: "module" },
    );
    await context.registerWorker(worker);
    const result = await convertWithWorker({
      worker,
      from,
      to,
      buf: Uint8Array.from(bytes).buffer,
      quality,
      onProgress: ({ progress }) => context.reportProgress((progress ?? 0) / 100),
    });
    return (result.kind === "multiple" ? result.buffers : [result.buffer]).map(
      (buffer) => new Uint8Array(buffer),
    );
  },
  async compress({ format, bytes, quality, context }) {
    context.signal.throwIfAborted();
    let worker: Worker | undefined;
    if (["jpeg", "jpg", "png"].includes(format)) {
      worker = new Worker(
        new URL("../workers/compress.worker.js", import.meta.url),
        { type: "module" },
      );
      await context.registerWorker(worker);
    }
    const result = await compressFile({
      worker,
      format,
      buf: Uint8Array.from(bytes).buffer,
      quality,
      onProgress: ({ progress }) => context.reportProgress((progress ?? 0) / 100),
    });
    return new Uint8Array(result);
  },
  async deliver(result) {
    const objectUrl = URL.createObjectURL(
      new Blob([Uint8Array.from(result.bytes)], { type: result.mimeType }),
    );
    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = result.name;
      anchor.click();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
    return crypto.randomUUID();
  },
  telemetry: {
    async start(runId, request) {
      const contract = getGenericToolContract(request.toolId);
      browserTelemetryHandles.set(
        runId,
        beginToolRun({
          toolId: request.toolId,
          inputBytes: request.inputBytes,
          from: contract.state === "supported" ? contract.input.format : undefined,
          to: contract.state === "supported" ? contract.output.format : undefined,
        }),
      );
    },
    async terminal(runId, status) {
      const handle = browserTelemetryHandles.get(runId);
      browserTelemetryHandles.delete(runId);
      if (!handle) return;
      if (status === "succeeded") {
        handle.finishSuccess({});
      } else {
        handle.finishFailure({ errorCode: status });
      }
    },
  },
};

export const genericToolWorkflow = createGenericToolWorkflow(browserAdapters);

export async function runGenericToolFile(
  toolId: string,
  file: File,
  options?: WorkflowRunOptions,
) {
  const contract = getGenericToolContract(toolId);
  if (contract.state === "unsupported") {
    return genericToolWorkflow.run(
      {
        toolId,
        input: {
          kind: "file",
          media: {
            name: file.name,
            format: "unsupported",
            mimeType: file.type || "application/octet-stream",
            bytes: new Uint8Array(),
          },
        },
      },
      options,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return genericToolWorkflow.run(
    {
      toolId,
      input: {
        kind: "file",
        media: {
          name: file.name,
          format: contract.input.format,
          mimeType: file.type || contract.input.mimeType,
          bytes,
        },
      },
    },
    options,
  );
}

export function getGenericAccept(from: string): string {
  if (from === "jpg" || from === "jpeg") return ".jpg,.jpeg";
  return `.${from}`;
}
