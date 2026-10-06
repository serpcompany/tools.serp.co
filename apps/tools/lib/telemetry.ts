export { beginToolRun } from "@serp-tools/tool-telemetry/client";
export type { ToolRunEvent, ToolRunMetadata } from "@serp-tools/tool-telemetry";
import type { ToolRunMetadata } from "@serp-tools/tool-telemetry";

export type TelemetryFailure = {
  errorCode: string;
  metadata?: ToolRunMetadata;
  message: string;
};

type TelemetryErrorShape = {
  telemetryCode?: string;
  telemetryMetadata?: ToolRunMetadata;
};

function isTelemetryError(value: unknown): value is TelemetryErrorShape {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as TelemetryErrorShape).telemetryCode === "string"
  );
}

export function getTelemetryFailure(error: unknown, fallbackCode: string): TelemetryFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (isTelemetryError(error)) {
    return {
      errorCode: error.telemetryCode ?? fallbackCode,
      metadata: error.telemetryMetadata,
      message,
    };
  }
  return { errorCode: fallbackCode, message };
}
