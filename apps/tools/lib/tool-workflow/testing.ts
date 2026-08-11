import sharp from "sharp";

import {
  createToolWorkflow,
  type ProcessorOptions,
  type ProcessorSupportDecision,
  type ProcessorSupportRequest,
  type SemanticVerification,
  type ToolProcessor,
  type RuntimeResourceKind,
  type WorkflowMedia,
  type ToolExecutionIntent,
} from "./index.ts";
import {
  executionProvenance,
  getToolExecutionProvenance,
} from "../tool-execution-provenance.ts";
import { verifyMediaSemantics as verifyMedia } from "./semantic-validators.ts";

const testSemanticDecoderAdapters = Object.freeze({
  async decodeJpeg(bytes: Uint8Array) {
    const image = sharp(bytes);
    const metadata = await image.metadata();
    if (metadata.format !== "jpeg") {
      throw new Error("Sharp did not identify a JPEG image");
    }
    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data, format: "jpeg" as const, width: info.width, height: info.height };
  },
});

type ProcessorEngine = ToolProcessor["engine"];

type ProcessorScript = {
  engineId?: string;
  intent?: ToolExecutionIntent;
  support: {
    acquisition: "file" | "url";
    inputFormats: string[];
    outputFormats: string[];
    resourceLimits?: {
      maxInputBytes: number;
      maxOutputBytes: number;
      maxTotalOutputBytes: number;
    };
    outputCardinality?: { min: number; max: number };
  };
  progress?: number[];
  lateProgress?: number[];
  lateResources?: RuntimeResourceKind[];
  lateCleanups?: RuntimeResourceKind[];
  error?: Error;
  parseOptions?(value: unknown): ProcessorOptions<unknown>;
  decideSupport?(
    request: ProcessorSupportRequest<unknown>,
  ): ProcessorSupportDecision;
  process?: ToolProcessor["process"];
  validators?: {
    input?(
      media: WorkflowMedia,
    ): SemanticVerification | Promise<SemanticVerification>;
    output?(
      media: WorkflowMedia,
    ): SemanticVerification | Promise<SemanticVerification>;
  };
  result: WorkflowMedia | WorkflowMedia[];
};

type TypedProcessorScript<Options> = Omit<ProcessorScript, "parseOptions"> & {
  parseOptions(value: unknown): ProcessorOptions<Options>;
};

export function defineScriptedProcessor<Options>(
  script: TypedProcessorScript<Options>,
): ProcessorScript {
  return script as unknown as ProcessorScript;
}

type UrlFixture = Omit<WorkflowMedia, "bytes"> & {
  chunks: Uint8Array[];
  totalBytes?: number | null;
  stallAfterChunks?: number;
};

type StreamRecord = {
  url: string;
  chunksRead: number;
  cancelled: boolean;
  readerLockReleased: boolean;
};

const mimeTypes: Record<string, string> = {
  avif: "image/avif",
  csv: "text/csv",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  png: "image/png",
  txt: "text/plain",
};
export function createToolWorkflowTestHarness(options: {
  media?: { urls?: Record<string, UrlFixture> };
  resources?: Partial<
    Record<
      "acquiring" | "processing" | "validating" | "delivering",
      RuntimeResourceKind[]
    >
  >;
  telemetry?: { failStart?: boolean; failTerminal?: boolean };
  clock?: { times: number[] };
  ids?: { run?: string[]; delivery?: string[] };
  processors: Record<string, ProcessorScript>;
}) {
  const events: string[] = [];
  const activeResources: RuntimeResourceKind[] = [];
  const openedResources: RuntimeResourceKind[] = [];
  const releasedResources: RuntimeResourceKind[] = [];
  const telemetryRecords: Array<
    | { kind: "start"; runId: string; at: number }
    | {
        kind: "terminal";
        runId: string;
        status: "succeeded" | "failed" | "cancelled";
        at: number;
      }
  > = [];
  const times = [...(options.clock?.times ?? [])];
  const runIds = [...(options.ids?.run ?? [])];
  const deliveryIds = [...(options.ids?.delivery ?? [])];
  const streamRecords: StreamRecord[] = [];
  const lateCleanupActive: RuntimeResourceKind[] = [];
  const lateCleanupReleased: RuntimeResourceKind[] = [];
  const processorRecords: Array<{
    toolId: string;
    engine: ProcessorEngine;
    support: ToolProcessor["support"];
    options: unknown;
  }> = [];
  let runId = 0;
  let deliveryId = 0;
  const processorDefinitions = Object.entries(options.processors).map(
    ([toolId, script]) => {
      const results = Array.isArray(script.result)
        ? script.result
        : [script.result];
      const support = {
        acquisition: script.support.acquisition,
        inputs: script.support.inputFormats.map((format) => ({
          format,
          mimeTypes: mimeTypes[format] ? [mimeTypes[format]] : [],
        })),
        outputs: script.support.outputFormats.map((format) => ({
          format,
          mimeType:
            mimeTypes[format] ??
            results.find((result) => result.format === format)?.mimeType ??
            "application/octet-stream",
        })),
        resourceLimits: script.support.resourceLimits ?? {
          maxInputBytes: Number.MAX_SAFE_INTEGER,
          maxOutputBytes: Number.MAX_SAFE_INTEGER,
          maxTotalOutputBytes: Number.MAX_SAFE_INTEGER,
        },
        outputCardinality: script.support.outputCardinality ?? {
          min: results.length,
          max: results.length,
        },
      } as const;
      const intent = script.intent ?? {
        requestedOperation: "process",
        outputs: support.outputs,
      };
      const provenance = getToolExecutionProvenance(toolId);
      const engineId =
        script.engineId ??
        (provenance.kind === "mapped" ? provenance.engineIds[0] : undefined);
      const engine = engineId
        ? executionProvenance.getEngine(engineId)
        : undefined;
      if (!engine) {
        throw new TypeError(`No canonical execution engine for ${toolId}`);
      }
      return {
        toolId,
        processor: {
          engine,
          support,
          parseOptions(value): ProcessorOptions<unknown> {
            return script.parseOptions?.(value) ?? { ok: true, value: {} };
          },
          decideSupport(request): ProcessorSupportDecision {
            return script.decideSupport?.(request) ?? { supported: true };
          },
          async verifyInput(input): Promise<SemanticVerification> {
            return (
              (await script.validators?.input?.(input)) ??
              verifyMedia(input, testSemanticDecoderAdapters)
            );
          },
          async process(_input, processorOptions, context) {
            processorRecords.push({
              toolId,
              engine,
              support,
              options: processorOptions,
            });
            events.push(`processor:${toolId}`);
            for (const resource of options.resources?.processing ?? []) {
              await context.openResource(resource);
            }
            context.signal.throwIfAborted();
            for (const progress of script.progress ?? []) {
              context.reportProgress(progress);
            }
            if (
              script.lateProgress ||
              script.lateResources ||
              script.lateCleanups
            ) {
              setTimeout(async () => {
                for (const progress of script.lateProgress ?? []) {
                  context.reportProgress(progress);
                }
                for (const resource of script.lateResources ?? []) {
                  await context.openResource(resource);
                }
                for (const resource of script.lateCleanups ?? []) {
                  lateCleanupActive.push(resource);
                  await context.registerCleanup(async () => {
                    const index = lateCleanupActive.lastIndexOf(resource);
                    if (index !== -1) {
                      lateCleanupActive.splice(index, 1);
                    }
                    lateCleanupReleased.push(resource);
                  });
                }
              }, 0);
            }
            if (script.error) {
              throw script.error;
            }
            if (script.process) {
              return script.process(_input, processorOptions, context);
            }
            return results;
          },
          async verifyResult(result, context): Promise<SemanticVerification> {
            for (const resource of options.resources?.validating ?? []) {
              await context.openResource(resource);
            }
            context.signal.throwIfAborted();
            return (
              (await script.validators?.output?.(result)) ??
              verifyMedia(result, testSemanticDecoderAdapters)
            );
          },
        } satisfies ToolProcessor,
        intent,
      };
    },
  );
  const processors = new Map<string, ToolProcessor>(
    processorDefinitions.map(({ toolId, processor }) => [toolId, processor]),
  );
  const intents = new Map<string, ToolExecutionIntent>(
    processorDefinitions.map(({ toolId, intent }) => [toolId, intent]),
  );

  return {
    workflow: createToolWorkflow({
      acquisition: {
        file: {
          async acquire(input, context) {
            for (const resource of options.resources?.acquiring ?? []) {
              await context.openResource(resource);
            }
            context.signal.throwIfAborted();
            return input.media;
          },
        },
        url: {
          async acquire(input, context) {
            for (const resource of options.resources?.acquiring ?? []) {
              await context.openResource(resource);
            }
            context.signal.throwIfAborted();
            const fixture = options.media?.urls?.[input.url];
            if (!fixture) {
              throw new Error(`No URL fixture configured: ${input.url}`);
            }
            const record: StreamRecord = {
              url: input.url,
              chunksRead: 0,
              cancelled: false,
              readerLockReleased: false,
            };
            streamRecords.push(record);
            let chunkIndex = 0;
            const stream = new ReadableStream<Uint8Array>({
              pull(controller) {
                if (chunkIndex === fixture.stallAfterChunks) {
                  return;
                }
                const chunk = fixture.chunks[chunkIndex];
                chunkIndex += 1;
                if (chunk) {
                  controller.enqueue(chunk);
                } else {
                  controller.close();
                }
              },
              cancel() {
                record.cancelled = true;
              },
            });
            const reader = stream.getReader();
            let complete = false;
            const cancelReader = () => {
              void reader.cancel(context.signal.reason).catch(() => {});
            };
            if (context.signal.aborted) {
              cancelReader();
            } else {
              context.signal.addEventListener("abort", cancelReader, {
                once: true,
              });
            }
            await context.registerCleanup(async () => {
              context.signal.removeEventListener("abort", cancelReader);
              if (!complete) {
                await reader.cancel();
              }
              reader.releaseLock();
              record.readerLockReleased = true;
            });

            const chunks: Uint8Array[] = [];
            let bytesRead = 0;
            while (true) {
              const next = await reader.read();
              if (next.done) {
                complete = true;
                break;
              }
              if (
                bytesRead + next.value.byteLength >
                context.budgets.maxInputBytes
              ) {
                await reader.cancel("Input byte budget exceeded");
                throw new Error(
                  `Input exceeds ${context.budgets.maxInputBytes} bytes`,
                );
              }
              chunks.push(next.value);
              record.chunksRead += 1;
              bytesRead += next.value.byteLength;
              if (fixture.totalBytes != null) {
                context.reportProgress(bytesRead / fixture.totalBytes);
              }
              context.signal.throwIfAborted();
            }

            const bytes = new Uint8Array(bytesRead);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return {
              name: fixture.name,
              format: fixture.format,
              mimeType: fixture.mimeType,
              bytes,
            };
          },
        },
      },
      resolveIntent(toolId) {
        return intents.get(toolId);
      },
      resolveProcessor(toolId) {
        return processors.get(toolId);
      },
      async deliver(_result, context) {
        for (const resource of options.resources?.delivering ?? []) {
          await context.openResource(resource);
        }
        context.signal.throwIfAborted();
        events.push("delivery");
        return deliveryIds.shift() ?? `delivery-${++deliveryId}`;
      },
      telemetry: {
        async start(recordRunId, _request, at) {
          events.push("telemetry:start");
          telemetryRecords.push({ kind: "start", runId: recordRunId, at });
          if (options.telemetry?.failStart) {
            throw new Error("telemetry start unavailable");
          }
        },
        async terminal(recordRunId, status, at) {
          events.push("telemetry:terminal");
          telemetryRecords.push({
            kind: "terminal",
            runId: recordRunId,
            status,
            at,
          });
          if (options.telemetry?.failTerminal) {
            throw new Error("telemetry terminal unavailable");
          }
        },
      },
      runtime: {
        async open(kind) {
          activeResources.push(kind);
          openedResources.push(kind);
          return {
            async release() {
              const index = activeResources.lastIndexOf(kind);
              if (index !== -1) {
                activeResources.splice(index, 1);
              }
              releasedResources.push(kind);
            },
          };
        },
      },
      clock: {
        now() {
          return times.shift() ?? 0;
        },
      },
      nextId(kind) {
        if (kind === "run") {
          return runIds.shift() ?? `run-${++runId}`;
        }
        return deliveryIds.shift() ?? `delivery-${++deliveryId}`;
      },
    }),
    events,
    activeResources,
    openedResources,
    releasedResources,
    telemetryRecords,
    streamRecords,
    processorRecords,
    lateCleanupActive,
    lateCleanupReleased,
  };
}
