import {
  createToolWorkflow,
  type ProcessorOptions,
  type SemanticVerification,
  type ToolProcessor,
  type RuntimeResourceKind,
  type WorkflowMedia,
} from "./index.ts";

type ProcessorEngine = ToolProcessor["engine"];

type ProcessorScript = {
  engine?: ProcessorEngine;
  support: {
    acquisition: "file" | "url";
    inputFormats: string[];
    outputFormats: string[];
  };
  progress?: number[];
  lateProgress?: number[];
  lateResources?: RuntimeResourceKind[];
  error?: Error;
  parseOptions?(value: unknown): ProcessorOptions<unknown>;
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
};

type StreamRecord = {
  url: string;
  chunksRead: number;
  cancelled: boolean;
  readerLockReleased: boolean;
};

const signatures: Record<string, readonly number[]> = {
  jpg: [255, 216, 255],
  png: [137, 80, 78, 71, 13, 10, 26, 10],
};

const mimeTypes: Record<string, string> = {
  jpg: "image/jpeg",
  mp4: "video/mp4",
  png: "image/png",
  "remote-video": "application/octet-stream",
};

function verifyMedia(
  media: WorkflowMedia,
  role: "input" | "result",
): SemanticVerification {
  if (
    role === "input" &&
    media.format === "remote-video" &&
    media.mimeType === "application/octet-stream" &&
    media.bytes.byteLength > 0
  ) {
    return { status: "verified" };
  }
  const mimeType = mimeTypes[media.format];
  if (!mimeType) {
    return {
      status: "unavailable",
      message: `No semantic verifier for ${media.format}`,
    };
  }
  if (media.mimeType !== mimeType) {
    return {
      status: "rejected",
      message: `Expected MIME ${mimeType}, received ${media.mimeType}`,
    };
  }
  if (media.format === "mp4") {
    if (media.bytes.byteLength < 12) {
      return { status: "rejected", message: "MP4 ftyp box is truncated" };
    }
    const view = new DataView(
      media.bytes.buffer,
      media.bytes.byteOffset,
      media.bytes.byteLength,
    );
    const boxSize = view.getUint32(0, false);
    const boxType = new TextDecoder().decode(media.bytes.subarray(4, 8));
    if (
      boxType !== "ftyp" ||
      boxSize < 12 ||
      boxSize > media.bytes.byteLength
    ) {
      return { status: "rejected", message: "Invalid MP4 ftyp box" };
    }
    return { status: "verified" };
  }
  const signature = signatures[media.format];
  if (!signature) {
    return {
      status: "unavailable",
      message: `No semantic verifier for ${media.format}`,
    };
  }
  if (!signature.every((byte, index) => media.bytes[index] === byte)) {
    return {
      status: "rejected",
      message: `Bytes do not match ${media.format}`,
    };
  }
  return { status: "verified" };
}

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
  const processorRecords: Array<{
    toolId: string;
    engine: ProcessorEngine;
    support: ToolProcessor["support"];
    options: unknown;
  }> = [];
  let runId = 0;
  let deliveryId = 0;
  const processors = new Map<string, ToolProcessor>(
    Object.entries(options.processors).map(([toolId, script]) => {
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
      } as const;
      const engine: ProcessorEngine = script.engine ?? {
        id: `scripted:${toolId}`,
        version: "test",
        execution: "client-only",
      };
      return [
        toolId,
        {
          engine,
          support,
          parseOptions(value): ProcessorOptions<unknown> {
            return script.parseOptions?.(value) ?? { ok: true, value: {} };
          },
          async verifyInput(input): Promise<SemanticVerification> {
            return verifyMedia(input, "input");
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
            if (script.lateProgress || script.lateResources) {
              setTimeout(async () => {
                for (const progress of script.lateProgress ?? []) {
                  context.reportProgress(progress);
                }
                for (const resource of script.lateResources ?? []) {
                  await context.openResource(resource);
                }
              }, 0);
            }
            if (script.error) {
              throw script.error;
            }
            return results;
          },
          async verifyResult(result, context): Promise<SemanticVerification> {
            for (const resource of options.resources?.validating ?? []) {
              await context.openResource(resource);
            }
            context.signal.throwIfAborted();
            return verifyMedia(result, "result");
          },
        },
      ];
    }),
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
            context.registerCleanup(async () => {
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
  };
}
