export type WorkflowMedia = {
  name: string;
  format: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type WorkflowInput =
  | { kind: "file"; media: WorkflowMedia }
  | { kind: "url"; url: string };

export type WorkflowRequest = {
  toolId: string;
  input: WorkflowInput;
};

export type WorkflowPhase =
  | "acquiring"
  | "processing"
  | "validating"
  | "delivering"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowSnapshot = {
  phase: WorkflowPhase;
  progress?: number;
};

export type WorkflowDelivery = {
  name: string;
  format: string;
  mimeType: string;
  size: number;
  deliveryId: string;
};

export type TelemetryEvidence = {
  start: "not-attempted" | "submitted" | "failed";
  terminal: "not-attempted" | "submitted" | "failed";
};

export type WorkflowFailure = {
  code:
    | "unsupported-tool"
    | "unsupported-request"
    | "invalid-request"
    | "acquisition-failed"
    | "processor-failed"
    | "invalid-result"
    | "delivery-failed";
  message: string;
};

export type WorkflowOutcome =
  | {
      status: "succeeded";
      runId: string;
      results: WorkflowDelivery[];
      telemetry: TelemetryEvidence;
    }
  | {
      status: "failed";
      runId: string;
      error: WorkflowFailure;
      telemetry: TelemetryEvidence;
    }
  | {
      status: "cancelled";
      runId: string;
      telemetry: TelemetryEvidence;
    };

export type WorkflowRunOptions = {
  signal?: AbortSignal;
  observe?: (snapshot: WorkflowSnapshot) => void;
};

export type ToolWorkflow = {
  run(
    request: WorkflowRequest,
    options?: WorkflowRunOptions,
  ): Promise<WorkflowOutcome>;
};

export type ToolSupport = {
  acquisition: WorkflowInput["kind"];
  inputFormats: readonly string[];
  outputFormats: readonly string[];
};

export type ToolProcessor = {
  support: ToolSupport;
  process(
    input: WorkflowMedia,
    context: {
      signal: AbortSignal;
      reportProgress(progress: number): void;
      openResource(kind: RuntimeResourceKind): Promise<void>;
    },
  ): Promise<WorkflowMedia[]>;
};

export type RuntimeResourceKind =
  | "reader"
  | "worker"
  | "blob"
  | "object-url"
  | "subscription";

type WorkflowStageContext = {
  signal: AbortSignal;
  openResource(kind: RuntimeResourceKind): Promise<void>;
  reportProgress(progress: number): void;
};

type WorkflowPorts = {
  acquisition: {
    file: {
      acquire(
        input: Extract<WorkflowInput, { kind: "file" }>,
        context: WorkflowStageContext,
      ): Promise<WorkflowMedia>;
    };
    url: {
      acquire(
        input: Extract<WorkflowInput, { kind: "url" }>,
        context: WorkflowStageContext,
      ): Promise<WorkflowMedia>;
    };
  };
  resolveProcessor(toolId: string): ToolProcessor | undefined;
  acceptsInput(input: WorkflowMedia, support: ToolSupport): Promise<boolean>;
  validate(
    result: WorkflowMedia,
    support: ToolSupport,
    context: WorkflowStageContext,
  ): Promise<void>;
  deliver(
    result: WorkflowMedia,
    context: WorkflowStageContext,
  ): Promise<string>;
  runtime: {
    open(
      kind: RuntimeResourceKind,
      signal: AbortSignal,
    ): Promise<{ release(): Promise<void> }>;
  };
  telemetry: {
    start(runId: string, request: WorkflowRequest, at: number): Promise<void>;
    terminal(
      runId: string,
      status: WorkflowOutcome["status"] | "cancelled",
      at: number,
    ): Promise<void>;
  };
  clock: { now(): number };
  nextId(kind: "run" | "delivery"): string;
};

export function createToolWorkflow(ports: WorkflowPorts): ToolWorkflow {
  return {
    async run(request, options = {}) {
      const signal = options.signal ?? new AbortController().signal;
      const runId = ports.nextId("run");
      let telemetry: TelemetryEvidence = {
        start: "not-attempted",
        terminal: "not-attempted",
      };
      let accepted = false;
      let terminal = false;
      const cleanups: Array<() => Promise<void>> = [];
      const releaseResources = async () => {
        for (const cleanup of [...cleanups].reverse()) {
          try {
            await cleanup();
          } catch {
            // Cleanup is best-effort and must not replace the Tool outcome.
          }
        }
      };
      const finish = async (
        status: WorkflowOutcome["status"],
      ): Promise<TelemetryEvidence> => {
        if (terminal) {
          return telemetry;
        }
        terminal = true;
        if (accepted) {
          telemetry = { ...telemetry, terminal: "submitted" };
          try {
            await ports.telemetry.terminal(runId, status, ports.clock.now());
          } catch {
            telemetry = { ...telemetry, terminal: "failed" };
          }
        }
        options.observe?.({ phase: status });
        return telemetry;
      };

      const processor = ports.resolveProcessor(request.toolId);
      if (!processor) {
        await finish("failed");
        return {
          status: "failed",
          runId,
          error: {
            code: "unsupported-tool",
            message: `Unsupported Tool: ${request.toolId}`,
          },
          telemetry,
        };
      }
      if (processor.support.acquisition !== request.input.kind) {
        await finish("failed");
        return {
          status: "failed",
          runId,
          error: {
            code: "unsupported-request",
            message: `Unsupported acquisition: ${request.input.kind}`,
          },
          telemetry,
        };
      }

      let stage: "acquiring" | "processing" | "validating" | "delivering" =
        "acquiring";
      let activePhase: WorkflowPhase | undefined;
      let lastProgress = 0;
      const reportProgress = (
        phase: WorkflowPhase,
        start: number,
        span: number,
        progress: number,
      ) => {
        if (activePhase !== phase || !Number.isFinite(progress)) {
          return;
        }
        const normalized = Math.min(1, Math.max(0, progress));
        const overall = Number((start + span * normalized).toFixed(6));
        if (overall <= lastProgress) {
          return;
        }
        lastProgress = overall;
        options.observe?.({ phase, progress: overall });
      };
      const context = (
        phase: typeof stage,
        start: number,
        span: number,
      ): WorkflowStageContext => ({
        signal,
        reportProgress: (progress) =>
          reportProgress(phase, start, span, progress),
        async openResource(kind) {
          if (activePhase !== phase || terminal) {
            return;
          }
          const resource = await ports.runtime.open(kind, signal);
          if (activePhase !== phase || terminal) {
            await resource.release();
            return;
          }
          cleanups.push(() => resource.release());
        },
      });

      try {
        activePhase = "acquiring";
        options.observe?.({ phase: "acquiring" });
        const acquisitionContext = context("acquiring", 0, 0.25);
        const input =
          request.input.kind === "file"
            ? await ports.acquisition.file.acquire(
                request.input,
                acquisitionContext,
              )
            : await ports.acquisition.url.acquire(
                request.input,
                acquisitionContext,
              );
        signal.throwIfAborted();
        if (!processor.support.inputFormats.includes(input.format)) {
          await finish("failed");
          return {
            status: "failed",
            runId,
            error: {
              code: "unsupported-request",
              message: `Unsupported input format: ${input.format}`,
            },
            telemetry,
          };
        }
        if (!(await ports.acceptsInput(input, processor.support))) {
          await finish("failed");
          return {
            status: "failed",
            runId,
            error: {
              code: "invalid-request",
              message: `Input bytes do not match ${input.format}`,
            },
            telemetry,
          };
        }
        signal.throwIfAborted();

        accepted = true;
        telemetry = { ...telemetry, start: "submitted" };
        try {
          await ports.telemetry.start(runId, request, ports.clock.now());
        } catch {
          telemetry = { ...telemetry, start: "failed" };
        }
        signal.throwIfAborted();

        stage = "processing";
        activePhase = "processing";
        options.observe?.({ phase: "processing" });
        const results = await processor.process(input, {
          ...context("processing", 0.25, 0.45),
        });
        signal.throwIfAborted();
        if (results.length === 0) {
          throw new Error("Processor returned no results");
        }
        stage = "validating";
        activePhase = "validating";
        options.observe?.({ phase: "validating" });
        for (const result of results) {
          await ports.validate(
            result,
            processor.support,
            context("validating", 0.7, 0.15),
          );
          signal.throwIfAborted();
        }
        stage = "delivering";
        activePhase = "delivering";
        options.observe?.({ phase: "delivering" });
        const deliveries: WorkflowDelivery[] = [];
        for (const result of results) {
          deliveries.push({
            name: result.name,
            format: result.format,
            mimeType: result.mimeType,
            size: result.bytes.byteLength,
            deliveryId: await ports.deliver(
              result,
              context("delivering", 0.85, 0.15),
            ),
          });
          signal.throwIfAborted();
        }
        activePhase = undefined;
        await finish("succeeded");

        return {
          status: "succeeded",
          runId,
          results: deliveries,
          telemetry,
        };
      } catch (error) {
        activePhase = undefined;
        if (
          signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          await finish("cancelled");
          return { status: "cancelled", runId, telemetry };
        }
        const code =
          stage === "acquiring"
            ? "acquisition-failed"
            : stage === "processing"
              ? "processor-failed"
              : stage === "validating"
                ? "invalid-result"
                : "delivery-failed";
        await finish("failed");
        return {
          status: "failed",
          runId,
          error: {
            code,
            message: error instanceof Error ? error.message : String(error),
          },
          telemetry,
        };
      } finally {
        await releaseResources();
      }
    },
  };
}
