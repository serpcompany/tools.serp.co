import {
  createToolWorkflow,
  type ProcessorOptions,
  type SemanticVerification,
  type ToolProcessor,
  type RuntimeResourceKind,
  type WorkflowMedia,
} from "./index.ts";
import {
  executionProvenance,
  getToolExecutionProvenance,
} from "../tool-execution-provenance.ts";

type ProcessorEngine = ToolProcessor["engine"];

type ProcessorScript = {
  engineId?: string;
  support: {
    acquisition: "file" | "url";
    inputFormats: string[];
    outputFormats: string[];
  };
  progress?: number[];
  lateProgress?: number[];
  lateResources?: RuntimeResourceKind[];
  lateCleanups?: RuntimeResourceKind[];
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
  stallAfterChunks?: number;
};

type StreamRecord = {
  url: string;
  chunksRead: number;
  cancelled: boolean;
  readerLockReleased: boolean;
};

const mimeTypes: Record<string, string> = {
  jpg: "image/jpeg",
  mp4: "video/mp4",
  png: "image/png",
};

function pngStructureError(bytes: Uint8Array): string | undefined {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) {
    return "Invalid PNG signature";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = signature.length;
  let chunkCount = 0;
  let sawImageData = false;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) {
      return "PNG chunk is truncated";
    }
    const length = view.getUint32(offset, false);
    const type = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    if (length > bytes.byteLength - offset - 12) {
      return `PNG ${type} chunk exceeds the input`;
    }
    if (chunkCount === 0 && (type !== "IHDR" || length !== 13)) {
      return "PNG must begin with a 13-byte IHDR chunk";
    }
    if (type === "IDAT") {
      sawImageData = true;
    }
    const nextOffset = offset + 12 + length;
    if (type === "IEND") {
      return length === 0 && sawImageData && nextOffset === bytes.byteLength
        ? undefined
        : "PNG IEND chunk is invalid or not terminal";
    }
    offset = nextOffset;
    chunkCount += 1;
  }
  return "PNG is missing its IEND chunk";
}

function jpegStructureError(bytes: Uint8Array): string | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return "JPEG is missing its SOI marker";
  }
  let offset = 2;
  let sawFrame = false;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      return "JPEG segment does not begin with a marker";
    }
    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined) {
      return "JPEG marker is truncated";
    }
    if (marker === 0xd9) {
      return sawFrame && offset === bytes.byteLength
        ? undefined
        : "JPEG EOI marker is invalid or not terminal";
    }
    if (offset + 2 > bytes.byteLength) {
      return "JPEG segment length is truncated";
    }
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || length > bytes.byteLength - offset) {
      return "JPEG segment exceeds the input";
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      sawFrame = true;
    }
    offset += length;
    if (marker !== 0xda) {
      continue;
    }
    if (!sawFrame) {
      return "JPEG scan appears before a frame header";
    }
    while (offset < bytes.byteLength) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const next = bytes[offset + 1];
      if (
        next === 0x00 ||
        (next !== undefined && next >= 0xd0 && next <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      if (next === 0xd9) {
        return offset + 2 === bytes.byteLength
          ? undefined
          : "JPEG EOI marker is not terminal";
      }
      return "JPEG scan contains an invalid marker";
    }
    return "JPEG scan is missing its EOI marker";
  }
  return "JPEG is missing its EOI marker";
}

function bmffStructureError(bytes: Uint8Array): string | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const requiredPayloadSizes = new Map([
    ["ftyp", 8],
    ["mdat", 1],
    ["moov", 1],
  ]);
  const found = new Set<string>();
  let offset = 0;

  while (offset < bytes.byteLength) {
    const remaining = bytes.byteLength - offset;
    if (remaining < 8) {
      return "MP4 top-level box header is truncated";
    }

    const size32 = view.getUint32(offset, false);
    const type = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    let headerSize = 8;
    let boxSize: number;

    if (size32 === 1) {
      if (remaining < 16) {
        return `MP4 ${type} extended-size header is truncated`;
      }
      const extendedSize = view.getBigUint64(offset + 8, false);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        return `MP4 ${type} box size is not safely representable`;
      }
      headerSize = 16;
      boxSize = Number(extendedSize);
    } else if (size32 === 0) {
      boxSize = remaining;
    } else {
      boxSize = size32;
    }

    if (boxSize < headerSize) {
      return `MP4 ${type} box is smaller than its header`;
    }
    if (boxSize > remaining) {
      return `MP4 ${type} box exceeds the input`;
    }

    const requiredPayloadSize = requiredPayloadSizes.get(type);
    if (requiredPayloadSize !== undefined) {
      if (boxSize - headerSize < requiredPayloadSize) {
        return `MP4 ${type} box has no valid payload`;
      }
      found.add(type);
    }

    offset += boxSize;
  }

  for (const type of requiredPayloadSizes.keys()) {
    if (!found.has(type)) {
      return `MP4 is missing its ${type} box`;
    }
  }
  return undefined;
}

function verifyMedia(media: WorkflowMedia): SemanticVerification {
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
  if (media.format === "png") {
    const error = pngStructureError(media.bytes);
    return error
      ? { status: "rejected", message: error }
      : { status: "verified" };
  }
  if (media.format === "jpg") {
    const error = jpegStructureError(media.bytes);
    return error
      ? { status: "rejected", message: error }
      : { status: "verified" };
  }
  if (media.format === "mp4") {
    const error = bmffStructureError(media.bytes);
    return error
      ? { status: "rejected", message: error }
      : { status: "verified" };
  }
  return {
    status: "unavailable",
    message: `No semantic verifier for ${media.format}`,
  };
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
      return [
        toolId,
        {
          engine,
          support,
          parseOptions(value): ProcessorOptions<unknown> {
            return script.parseOptions?.(value) ?? { ok: true, value: {} };
          },
          async verifyInput(input): Promise<SemanticVerification> {
            return verifyMedia(input);
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
            return results;
          },
          async verifyResult(result, context): Promise<SemanticVerification> {
            for (const resource of options.resources?.validating ?? []) {
              await context.openResource(resource);
            }
            context.signal.throwIfAborted();
            return verifyMedia(result);
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
    lateCleanupActive,
    lateCleanupReleased,
  };
}
