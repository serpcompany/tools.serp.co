import { recordToolRunInD1, type D1DatabaseLike } from "./d1.ts";
import type { ToolRunEvent } from "./types.ts";

type RecordToolRunResult = {
  status: number;
  body: {
    ok: boolean;
    error?: string;
  };
};

type RecordToolRunOptions = {
  d1?: D1DatabaseLike | null;
  now?: Date;
};

function isToolRunEvent(payload: unknown): payload is ToolRunEvent {
  if (!payload || typeof payload !== "object") return false;
  const data = payload as Record<string, unknown>;
  return (
    typeof data.runId === "string" &&
    typeof data.toolId === "string" &&
    typeof data.event === "string" &&
    typeof data.startedAt === "string"
  );
}

function toDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function recordToolRun(
  payload: unknown,
  options: RecordToolRunOptions = {}
): Promise<RecordToolRunResult> {
  if (!isToolRunEvent(payload)) {
    return { status: 400, body: { ok: false, error: "Missing fields" } };
  }

  const startedAt = toDate(payload.startedAt);
  if (!startedAt) {
    return { status: 400, body: { ok: false, error: "Invalid startedAt" } };
  }

  if (!options.d1) {
    return {
      status: 503,
      body: { ok: false, error: "D1 telemetry binding unavailable" },
    };
  }

  try {
    await recordToolRunInD1(options.d1, payload, { now: options.now });
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "D1 telemetry write failed";
    return { status: 500, body: { ok: false, error: message } };
  }
}
