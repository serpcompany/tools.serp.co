import type { ExecutionEngine } from "../tool-execution-provenance.ts";

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
  options?: unknown;
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
  inputs: ReadonlyArray<{ format: string; mimeTypes: readonly string[] }>;
  outputs: ReadonlyArray<{ format: string; mimeType: string }>;
};

export type SemanticVerification =
  | { status: "verified" }
  | { status: "rejected" | "unavailable"; message: string };

export type ProcessorOptions<Options> =
  | { ok: true; value: Options }
  | { ok: false; message: string };

export type ToolProcessor<Options = unknown> = {
  engine: ExecutionEngine;
  support: ToolSupport;
  parseOptions(options: unknown): ProcessorOptions<Options>;
  verifyInput(
    input: WorkflowMedia,
    context: WorkflowStageContext,
  ): Promise<SemanticVerification>;
  process(
    input: WorkflowMedia,
    options: Options,
    context: WorkflowStageContext,
  ): Promise<WorkflowMedia[]>;
  verifyResult(
    result: WorkflowMedia,
    context: WorkflowStageContext,
  ): Promise<SemanticVerification>;
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
  registerCleanup(cleanup: () => Promise<void>): Promise<void>;
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
      const emitSnapshot = (snapshot: WorkflowSnapshot) => {
        try {
          options.observe?.(snapshot);
        } catch {
          // Presentation observers cannot redefine Tool execution correctness.
        }
      };
      let telemetryEligible = false;
      let terminalOutcomeCommitted = false;
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
      const commitTerminal = async (
        status: WorkflowOutcome["status"],
      ): Promise<TelemetryEvidence> => {
        if (terminalOutcomeCommitted) {
          return telemetry;
        }
        terminalOutcomeCommitted = true;
        if (telemetryEligible) {
          telemetry = { ...telemetry, terminal: "submitted" };
          try {
            await ports.telemetry.terminal(runId, status, ports.clock.now());
          } catch {
            telemetry = { ...telemetry, terminal: "failed" };
          }
        }
        emitSnapshot({ phase: status });
        return telemetry;
      };
      const fail = async (
        code: WorkflowFailure["code"],
        message: string,
      ): Promise<Extract<WorkflowOutcome, { status: "failed" }>> => {
        await commitTerminal("failed");
        return {
          status: "failed",
          runId,
          error: { code, message },
          telemetry,
        };
      };

      const processor = ports.resolveProcessor(request.toolId);
      if (!processor) {
        return fail("unsupported-tool", `Unsupported Tool: ${request.toolId}`);
      }
      if (processor.support.acquisition !== request.input.kind) {
        return fail(
          "unsupported-request",
          `Unsupported acquisition: ${request.input.kind}`,
        );
      }
      const parsedOptions = processor.parseOptions(request.options);
      if (!parsedOptions.ok) {
        return fail("invalid-request", parsedOptions.message);
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
        emitSnapshot({ phase, progress: overall });
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
          if (activePhase !== phase || terminalOutcomeCommitted) {
            return;
          }
          const resource = await ports.runtime.open(kind, signal);
          if (activePhase !== phase || terminalOutcomeCommitted) {
            await resource.release();
            return;
          }
          cleanups.push(() => resource.release());
        },
        async registerCleanup(cleanup) {
          if (activePhase === phase && !terminalOutcomeCommitted) {
            cleanups.push(cleanup);
            return;
          }
          await cleanup();
        },
      });

      try {
        activePhase = "acquiring";
        emitSnapshot({ phase: "acquiring" });
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
        const inputSupport = processor.support.inputs.find(
          ({ format, mimeTypes }) =>
            format === input.format && mimeTypes.includes(input.mimeType),
        );
        if (!inputSupport) {
          return fail(
            "unsupported-request",
            `Unsupported input format: ${input.format}`,
          );
        }
        const inputVerification = await processor.verifyInput(
          input,
          acquisitionContext,
        );
        if (inputVerification.status !== "verified") {
          return fail("invalid-request", inputVerification.message);
        }
        signal.throwIfAborted();

        telemetryEligible = true;
        telemetry = { ...telemetry, start: "submitted" };
        try {
          await ports.telemetry.start(runId, request, ports.clock.now());
        } catch {
          telemetry = { ...telemetry, start: "failed" };
        }
        signal.throwIfAborted();

        stage = "processing";
        activePhase = "processing";
        emitSnapshot({ phase: "processing" });
        const results = await processor.process(
          input,
          parsedOptions.value,
          context("processing", 0.25, 0.45),
        );
        signal.throwIfAborted();
        if (results.length === 0) {
          throw new Error("Processor returned no results");
        }
        stage = "validating";
        activePhase = "validating";
        emitSnapshot({ phase: "validating" });
        for (const result of results) {
          const outputSupport = processor.support.outputs.find(
            ({ format, mimeType }) =>
              format === result.format && mimeType === result.mimeType,
          );
          if (!outputSupport) {
            throw new Error(
              `Unsupported output: ${result.format} (${result.mimeType})`,
            );
          }
          const verification = await processor.verifyResult(
            result,
            context("validating", 0.7, 0.15),
          );
          if (verification.status !== "verified") {
            throw new Error(verification.message);
          }
          signal.throwIfAborted();
        }
        stage = "delivering";
        activePhase = "delivering";
        emitSnapshot({ phase: "delivering" });
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
        await commitTerminal("succeeded");

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
          await commitTerminal("cancelled");
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
        return fail(
          code,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        await releaseResources();
      }
    },
  };
}
