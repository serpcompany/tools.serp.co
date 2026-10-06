import { recordToolRunInD1, type D1DatabaseLike } from "./d1.ts";
import { parseToolRunEvent, type TelemetryErrorCode } from "./validate.ts";

type RecordToolRunResult = {
  status: number;
  body: {
    ok: boolean;
    error?: TelemetryErrorCode | "d1_unavailable" | "d1_write_failed";
  };
};

type RecordToolRunOptions = {
  d1?: D1DatabaseLike | null;
  now?: Date;
};

export async function recordToolRun(
  payload: unknown,
  options: RecordToolRunOptions = {}
): Promise<RecordToolRunResult> {
  const now = options.now ?? new Date();
  const parsed = parseToolRunEvent(payload, now);
  if (!parsed.ok) {
    return { status: 400, body: { ok: false, error: parsed.code } };
  }

  if (!options.d1) {
    return { status: 503, body: { ok: false, error: "d1_unavailable" } };
  }

  try {
    await recordToolRunInD1(options.d1, parsed.event, { now });
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    // Log the code and error class only; D1 messages can echo SQL and values.
    console.error("telemetry d1_write_failed", err instanceof Error ? err.name : typeof err);
    return { status: 500, body: { ok: false, error: "d1_write_failed" } };
  }
}
