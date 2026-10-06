import type { ToolRunEvent } from "./types.ts";
import type { ToolRunMetadata } from "./validate.ts";

type ToolRunHandle = {
  runId: string;
  finishSuccess: (args: { outputBytes?: number; metadata?: ToolRunMetadata }) => void;
  finishFailure: (args: { errorCode?: string; metadata?: ToolRunMetadata }) => void;
  // The tool sent the visitor elsewhere (the browser extension) instead of
  // attempting the job.
  finishHandoff: (args: { reason: string; metadata?: ToolRunMetadata }) => void;
};

const TELEMETRY_ENDPOINT = "/api/telemetry";
const DEVICE_ID_KEY = "serp_tools_device_id";

// Global Privacy Control (https://globalprivacycontrol.org): a browser that
// sends it gets no telemetry at all and no device id (docs/telemetry.md).
export function isTelemetryOptedOut(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

function getDeviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

function mergeMetadata(
  base?: Record<string, unknown>,
  extra?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!base && !extra) return undefined;
  return {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
}

function sendTelemetry(event: ToolRunEvent) {
  if (typeof window === "undefined") return;

  const body = JSON.stringify(event);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(TELEMETRY_ENDPOINT, new Blob([body], { type: "application/json" }));
    return;
  }

  fetch(TELEMETRY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => {});
}

export function beginToolRun(args: {
  toolId: string;
  from?: string;
  to?: string;
  inputBytes?: number;
  metadata?: ToolRunMetadata;
}): ToolRunHandle {
  if (typeof window === "undefined" || isTelemetryOptedOut()) {
    return {
      runId: "server",
      finishSuccess: () => {},
      finishFailure: () => {},
      finishHandoff: () => {},
    };
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const startTime = performance.now();
  const deviceId = getDeviceId();
  const baseMetadata = mergeMetadata(args.metadata, deviceId ? { deviceId } : undefined);

  sendTelemetry({
    event: "tool_run_started",
    runId,
    toolId: args.toolId,
    from: args.from,
    to: args.to,
    startedAt,
    inputBytes: args.inputBytes,
    metadata: baseMetadata,
  });

  // Each run ends exactly once: the first finish wins, and a run still open
  // when the page goes away is recorded as abandoned.
  let finished = false;
  const finish = (
    event: "tool_run_succeeded" | "tool_run_failed" | "tool_run_handed_off" | "tool_run_abandoned",
    fields: { outputBytes?: number; errorCode?: string; metadata?: ToolRunMetadata } = {},
  ) => {
    if (finished) return;
    finished = true;
    window.removeEventListener("pagehide", onPageHide);
    sendTelemetry({
      event,
      runId,
      toolId: args.toolId,
      from: args.from,
      to: args.to,
      startedAt,
      durationMs: Math.round(performance.now() - startTime),
      inputBytes: args.inputBytes,
      outputBytes: fields.outputBytes,
      errorCode: fields.errorCode,
      metadata: mergeMetadata(baseMetadata, fields.metadata),
    });
  };
  const onPageHide = () => finish("tool_run_abandoned");
  window.addEventListener("pagehide", onPageHide);

  return {
    runId,
    finishSuccess: ({ outputBytes, metadata }) =>
      finish("tool_run_succeeded", { outputBytes, metadata }),
    finishFailure: ({ errorCode, metadata }) => finish("tool_run_failed", { errorCode, metadata }),
    finishHandoff: ({ reason, metadata }) =>
      finish("tool_run_handed_off", { errorCode: reason, metadata }),
  };
}
