import type { ToolRunEvent } from "./types.ts";
import type { ToolRunMetadata } from "./validate.ts";

type ToolRunHandle = {
  runId: string;
  finishSuccess: (args: { outputBytes?: number; metadata?: ToolRunMetadata }) => void;
  finishFailure: (args: { errorCode?: string; metadata?: ToolRunMetadata }) => void;
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

  return {
    runId,
    finishSuccess: ({ outputBytes, metadata }) => {
      const durationMs = Math.round(performance.now() - startTime);
      sendTelemetry({
        event: "tool_run_succeeded",
        runId,
        toolId: args.toolId,
        from: args.from,
        to: args.to,
        startedAt,
        durationMs,
        inputBytes: args.inputBytes,
        outputBytes,
        metadata: mergeMetadata(baseMetadata, metadata),
      });
    },
    finishFailure: ({ errorCode, metadata }) => {
      const durationMs = Math.round(performance.now() - startTime);
      sendTelemetry({
        event: "tool_run_failed",
        runId,
        toolId: args.toolId,
        from: args.from,
        to: args.to,
        startedAt,
        durationMs,
        inputBytes: args.inputBytes,
        errorCode,
        metadata: mergeMetadata(baseMetadata, metadata),
      });
    },
  };
}
