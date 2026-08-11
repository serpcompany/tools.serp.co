import {
  createToolWorkflow,
  type ToolProcessor,
  type ToolSupport,
  type RuntimeResourceKind,
  type WorkflowMedia,
} from "./index.ts";

type ProcessorScript = {
  support: ToolSupport;
  progress?: number[];
  lateProgress?: number[];
  lateResources?: RuntimeResourceKind[];
  error?: Error;
  result: WorkflowMedia | WorkflowMedia[];
};

type UrlFixture = Omit<WorkflowMedia, "bytes"> & {
  chunks: Uint8Array[];
};

const signatures: Record<string, readonly number[]> = {
  jpg: [255, 216, 255],
  mp4: [0, 0, 0],
  png: [137, 80, 78, 71, 13, 10, 26, 10],
};

const mimeTypes: Record<string, string> = {
  jpg: "image/jpeg",
  mp4: "video/mp4",
  png: "image/png",
};

function hasFormatSignature(media: WorkflowMedia) {
  const signature = signatures[media.format];
  return (
    !signature ||
    signature.every((byte, index) => media.bytes[index] === byte)
  );
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
  let runId = 0;
  let deliveryId = 0;
  const processors = new Map<string, ToolProcessor>(
    Object.entries(options.processors).map(([toolId, script]) => [
      toolId,
      {
        support: script.support,
        async process(_input, context) {
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
          return Array.isArray(script.result) ? script.result : [script.result];
        },
      },
    ]),
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
            const size = fixture.chunks.reduce(
              (total, chunk) => total + chunk.byteLength,
              0,
            );
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of fixture.chunks) {
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
      async acceptsInput(input) {
        return hasFormatSignature(input);
      },
      async validate(result, support, context) {
        for (const resource of options.resources?.validating ?? []) {
          await context.openResource(resource);
        }
        context.signal.throwIfAborted();
        if (!support.outputFormats.includes(result.format)) {
          throw new Error(`Unexpected output format: ${result.format}`);
        }
        if (!hasFormatSignature(result)) {
          throw new Error(`Output bytes are not ${result.format}`);
        }
        const mimeType = mimeTypes[result.format];
        if (mimeType && result.mimeType !== mimeType) {
          throw new Error(`Output MIME is not ${mimeType}`);
        }
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
  };
}
