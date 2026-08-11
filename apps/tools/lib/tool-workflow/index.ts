import type { ExecutionEngine } from "../tool-execution-provenance.ts";

export type WorkflowMedia = {
  name: string;
  format: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type WorkflowInput =
  | { kind: "file"; media: WorkflowMedia }
  | { kind: "url"; url: string }
  | { kind: "files"; media: readonly WorkflowMedia[] }
  | {
      kind: "interaction";
      interaction: Readonly<{
        format: string;
        mimeType: string;
        value: unknown;
        bytes: number;
      }>;
    };

export type WorkflowAcquiredInput =
  | WorkflowMedia
  | readonly WorkflowMedia[]
  | Extract<WorkflowInput, { kind: "interaction" }>["interaction"];

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

export type ToolSupport = Readonly<{
  acquisition: WorkflowInput["kind"];
  inputs: ReadonlyArray<
    Readonly<{ format: string; mimeTypes: readonly string[] }>
  >;
  outputs: ReadonlyArray<Readonly<{ format: string; mimeType: string }>>;
  resourceLimits: Readonly<{
    maxInputBytes: number;
    maxOutputBytes: number;
    maxTotalOutputBytes: number;
  }>;
  outputCardinality: Readonly<{ min: number; max: number }>;
}>;

export type ToolExecutionIntent = Readonly<{
  requestedOperation: string;
  outputs: ReadonlyArray<Readonly<{ format: string; mimeType: string }>>;
}>;

function assertSafeNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function assertNonEmptyString(value: string, name: string): void {
  if (!value.trim()) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

export function defineToolSupport(definition: ToolSupport): ToolSupport {
  const { min, max } = definition.outputCardinality;
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min < 1 ||
    min > max
  ) {
    throw new TypeError("Invalid output cardinality contract");
  }
  const limits = definition.resourceLimits;
  assertSafeNonNegativeInteger(limits.maxInputBytes, "maxInputBytes");
  assertSafeNonNegativeInteger(limits.maxOutputBytes, "maxOutputBytes");
  assertSafeNonNegativeInteger(
    limits.maxTotalOutputBytes,
    "maxTotalOutputBytes",
  );
  if (limits.maxOutputBytes > limits.maxTotalOutputBytes) {
    throw new TypeError(
      "maxOutputBytes cannot exceed maxTotalOutputBytes",
    );
  }
  if (definition.inputs.length === 0 || definition.outputs.length === 0) {
    throw new TypeError("Processor support requires input and output contracts");
  }
  for (const input of definition.inputs) {
    assertNonEmptyString(input.format, "input format");
    if (input.mimeTypes.length === 0) {
      throw new TypeError("Processor input requires at least one MIME type");
    }
    for (const mimeType of input.mimeTypes) {
      assertNonEmptyString(mimeType, "input MIME type");
    }
  }
  for (const output of definition.outputs) {
    assertNonEmptyString(output.format, "output format");
    assertNonEmptyString(output.mimeType, "output MIME type");
  }
  return Object.freeze({
    acquisition: definition.acquisition,
    inputs: Object.freeze(
      definition.inputs.map((input) =>
        Object.freeze({
          format: input.format,
          mimeTypes: Object.freeze([...input.mimeTypes]),
        }),
      ),
    ),
    outputs: Object.freeze(
      definition.outputs.map((output) => Object.freeze({ ...output })),
    ),
    resourceLimits: Object.freeze({ ...limits }),
    outputCardinality: Object.freeze({ min, max }),
  });
}

export function defineToolExecutionIntent(
  definition: ToolExecutionIntent,
): ToolExecutionIntent {
  assertNonEmptyString(definition.requestedOperation, "requested operation");
  if (definition.outputs.length === 0) {
    throw new TypeError("Tool execution intent requires an operation and output");
  }
  for (const output of definition.outputs) {
    assertNonEmptyString(output.format, "intent output format");
    assertNonEmptyString(output.mimeType, "intent output MIME type");
  }
  return Object.freeze({
    requestedOperation: definition.requestedOperation,
    outputs: Object.freeze(
      definition.outputs.map((output) => Object.freeze({ ...output })),
    ),
  });
}

export type ProcessorSupportRequest<Options> = Readonly<{
  detectedInput: Readonly<{
    acquisition: WorkflowInput["kind"];
    format: string;
    mimeType: string;
    bytes: number;
  }>;
  requestedOperation: string;
  options: Options;
  outputs: ToolExecutionIntent["outputs"];
}>;

export type ProcessorSupportDecision =
  | { supported: true }
  | { supported: false; message: string };

export type SemanticVerification =
  | { status: "verified" }
  | { status: "rejected" | "unavailable"; message: string };

export type ProcessorOptions<Options> =
  | { ok: true; value: Options }
  | { ok: false; message: string };

export type ToolProcessor<
  Options = unknown,
  Input extends WorkflowAcquiredInput = WorkflowMedia,
> = {
  engine: ExecutionEngine;
  support: ToolSupport;
  parseOptions(options: unknown): ProcessorOptions<Options>;
  decideSupport(
    request: ProcessorSupportRequest<Options>,
  ): ProcessorSupportDecision;
  verifyInput(
    input: Input,
    context: WorkflowStageContext,
  ): Promise<SemanticVerification>;
  process(
    input: Input,
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
  /** Cooperative limits exposed before work; workflow also enforces byte postconditions. */
  budgets: ToolSupport["resourceLimits"];
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
    files?: {
      acquire(
        input: Extract<WorkflowInput, { kind: "files" }>,
        context: WorkflowStageContext,
      ): Promise<readonly WorkflowMedia[]>;
    };
    interaction?: {
      acquire(
        input: Extract<WorkflowInput, { kind: "interaction" }>,
        context: WorkflowStageContext,
      ): Promise<Extract<WorkflowInput, { kind: "interaction" }>["interaction"]>;
    };
  };
  resolveIntent(toolId: string): ToolExecutionIntent | undefined;
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
      const resolvedIntent = ports.resolveIntent(request.toolId);
      if (!processor || !resolvedIntent) {
        return fail("unsupported-tool", `Unsupported Tool: ${request.toolId}`);
      }
      let support: ToolSupport;
      let intent: ToolExecutionIntent;
      try {
        support = defineToolSupport(processor.support);
        intent = defineToolExecutionIntent(resolvedIntent);
      } catch (error) {
        return fail(
          "unsupported-tool",
          error instanceof Error ? error.message : String(error),
        );
      }
      const unsupportedIntentOutput = intent.outputs.find(
        (requested) =>
          !support.outputs.some(
            (supported) =>
              supported.format === requested.format &&
              supported.mimeType === requested.mimeType,
          ),
      );
      if (unsupportedIntentOutput) {
        return fail(
          "unsupported-request",
          `Unsupported requested output: ${unsupportedIntentOutput.format} (${unsupportedIntentOutput.mimeType})`,
        );
      }
      if (support.acquisition !== request.input.kind) {
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
        budgets: support.resourceLimits,
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
        const input: WorkflowAcquiredInput =
          request.input.kind === "file"
            ? await ports.acquisition.file.acquire(request.input, acquisitionContext)
            : request.input.kind === "url"
              ? await ports.acquisition.url.acquire(request.input, acquisitionContext)
              : request.input.kind === "files"
                ? ports.acquisition.files
                  ? await ports.acquisition.files.acquire(request.input, acquisitionContext)
                  : request.input.media
                : ports.acquisition.interaction
                  ? await ports.acquisition.interaction.acquire(request.input, acquisitionContext)
                  : request.input.interaction;
        signal.throwIfAborted();
        const acquiredInputs = Array.isArray(input) ? input : [input];
        if (acquiredInputs.length === 0) {
          return fail("invalid-request", "Input collection is empty");
        }
        for (const acquired of acquiredInputs) {
          const inputSupport = support.inputs.find(
            ({ format, mimeTypes }) =>
              format === acquired.format && mimeTypes.includes(acquired.mimeType),
          );
          if (!inputSupport) {
            return fail(
              "unsupported-request",
              `Unsupported input format: ${acquired.format}`,
            );
          }
          const byteLength = "bytes" in acquired && acquired.bytes instanceof Uint8Array
            ? acquired.bytes.byteLength
            : acquired.bytes;
          if (byteLength === 0) {
            return fail("invalid-request", `${acquired.format} input is empty`);
          }
        }
        const totalInputBytes = acquiredInputs.reduce((total, acquired) => {
          const bytes = "bytes" in acquired && acquired.bytes instanceof Uint8Array
            ? acquired.bytes.byteLength
            : acquired.bytes;
          return total + bytes;
        }, 0);
        if (totalInputBytes > support.resourceLimits.maxInputBytes) {
          return fail(
            "unsupported-request",
            `Input exceeds ${support.resourceLimits.maxInputBytes} bytes`,
          );
        }
        const supportDecision = processor.decideSupport({
          detectedInput: {
            acquisition: request.input.kind,
            format: acquiredInputs[0]!.format,
            mimeType: acquiredInputs[0]!.mimeType,
            bytes: totalInputBytes,
          },
          requestedOperation: intent.requestedOperation,
          options: parsedOptions.value,
          outputs: intent.outputs,
        });
        if (!supportDecision.supported) {
          return fail("unsupported-request", supportDecision.message);
        }
        const inputVerification = await processor.verifyInput(
          input as never,
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
          input as never,
          parsedOptions.value,
          context("processing", 0.25, 0.45),
        );
        signal.throwIfAborted();
        stage = "validating";
        activePhase = "validating";
        emitSnapshot({ phase: "validating" });
        if (results.length === 0) {
          throw new Error("Processor returned no results");
        }
        const { min, max } = support.outputCardinality;
        if (results.length < min || results.length > max) {
          throw new Error(
            `Expected ${min}..${max} results, received ${results.length}`,
          );
        }
        const totalOutputBytes = results.reduce(
          (total, result) => total + result.bytes.byteLength,
          0,
        );
        if (
          totalOutputBytes >
          support.resourceLimits.maxTotalOutputBytes
        ) {
          throw new Error(
            `Total output exceeds ${support.resourceLimits.maxTotalOutputBytes} bytes`,
          );
        }
        for (const result of results) {
          if (
            result.bytes.byteLength >
            support.resourceLimits.maxOutputBytes
          ) {
            throw new Error(
              `Output exceeds ${support.resourceLimits.maxOutputBytes} bytes`,
            );
          }
          const outputSupport = intent.outputs.find(
            ({ format, mimeType }) =>
              format === result.format && mimeType === result.mimeType,
          );
          if (!outputSupport) {
            throw new Error(
              `Unsupported output: ${result.format} (${result.mimeType})`,
            );
          }
          if (result.bytes.byteLength === 0) {
            throw new Error(`${result.format} result is empty`);
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
