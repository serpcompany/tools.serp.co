import type { ToolRunEvent, ToolRunEventType } from "./types.ts";

// Every value from /api/telemetry is untrusted. Normalize and cap it before it
// reaches SQL so row size and D1 cost stay bounded.

export const TOOL_RUN_EVENTS: readonly ToolRunEventType[] = [
  "tool_run_started",
  "tool_run_succeeded",
  "tool_run_failed",
  "tool_run_handed_off",
  "tool_run_abandoned",
];

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const FORMAT_PATTERN = /^[A-Za-z0-9.+_-]{1,32}$/;
// Every metadata key the app may store, and why (docs/telemetry.md). Anything
// else is dropped: never file names, file or page contents, free-form error
// text, or other user input.
const METADATA_KEY_LIST = [
  // Added by the server: request origin, reviewed and kept (issue #161).
  "ip",
  "userAgent",
  "release",
  // Added by the client: a random per-browser id in localStorage.
  "deviceId",
  // How a tool ran.
  "engine",
  "route",
  "op",
  "from",
  "to",
  "format",
  "status",
  "source",
  "mode",
  "urlHost",
  "failFast",
  "failFastReason",
  "compressionLevel",
  // Sizes and counts of the input or output, never the content itself.
  "fileCount",
  "rows",
  "columns",
  "htmlLength",
  "audioSeconds",
  "characters",
  "words",
  "sentences",
  "paragraphs",
  "lines",
  "readingTime",
  "speakingTime",
] as const;

export type MetadataKey = (typeof METADATA_KEY_LIST)[number];
// What a browser may send: every allowlisted key except the ones only the
// server sets.
export type ClientMetadataKey = Exclude<MetadataKey, "ip" | "userAgent" | "release">;
export type ToolRunMetadata = Partial<Record<ClientMetadataKey, unknown>>;
export const METADATA_KEYS: ReadonlySet<string> = new Set(METADATA_KEY_LIST);
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_STRING = 256;
const MAX_METADATA_JSON_BYTES = 4096;
const MAX_COUNTER = 1e12;
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export type TelemetryErrorCode =
  | "invalid_payload"
  | "invalid_event"
  | "invalid_run_id"
  | "invalid_tool_id"
  | "invalid_started_at"
  | "invalid_number"
  | "invalid_error_code";

export type ParsedToolRunEvent =
  | { ok: true; event: ToolRunEvent }
  | { ok: false; code: TelemetryErrorCode };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalCounter(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_COUNTER) {
    return null;
  }
  return Math.trunc(value);
}

function optionalMatch(value: unknown, pattern: RegExp): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function truncate(value: string): string {
  return value.length > MAX_METADATA_STRING ? value.slice(0, MAX_METADATA_STRING) : value;
}

// Flat, primitive-only metadata: keys outside METADATA_KEYS are dropped,
// nested values are stringified and truncated, and the whole object is capped
// in size.
export function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(value)) return undefined;
  const result: Record<string, unknown> = {};
  let bytes = 2;
  for (const [key, raw] of Object.entries(value)) {
    if (Object.keys(result).length >= MAX_METADATA_KEYS) break;
    if (!METADATA_KEYS.has(key)) continue;
    let clean: unknown;
    if (raw === null || typeof raw === "boolean") clean = raw;
    else if (typeof raw === "number") clean = Number.isFinite(raw) ? raw : null;
    else if (typeof raw === "string") clean = truncate(raw);
    else if (raw === undefined) continue;
    else clean = truncate(JSON.stringify(raw) ?? "");
    const entryBytes = new TextEncoder().encode(JSON.stringify({ [key]: clean })).length;
    if (bytes + entryBytes > MAX_METADATA_JSON_BYTES) break;
    bytes += entryBytes;
    result[key] = clean;
  }
  return Object.keys(result).length ? result : undefined;
}

export function parseToolRunEvent(payload: unknown, now: Date = new Date()): ParsedToolRunEvent {
  if (!isPlainObject(payload)) return { ok: false, code: "invalid_payload" };

  const event = payload.event;
  if (typeof event !== "string" || !TOOL_RUN_EVENTS.includes(event as ToolRunEventType)) {
    return { ok: false, code: "invalid_event" };
  }
  if (typeof payload.runId !== "string" || !ID_PATTERN.test(payload.runId)) {
    return { ok: false, code: "invalid_run_id" };
  }
  if (typeof payload.toolId !== "string" || !ID_PATTERN.test(payload.toolId)) {
    return { ok: false, code: "invalid_tool_id" };
  }

  const startedAt = typeof payload.startedAt === "string" ? new Date(payload.startedAt) : null;
  if (
    !startedAt ||
    Number.isNaN(startedAt.getTime()) ||
    Math.abs(startedAt.getTime() - now.getTime()) > MAX_CLOCK_SKEW_MS
  ) {
    return { ok: false, code: "invalid_started_at" };
  }

  const durationMs = optionalCounter(payload.durationMs);
  const inputBytes = optionalCounter(payload.inputBytes);
  const outputBytes = optionalCounter(payload.outputBytes);
  if (durationMs === null || inputBytes === null || outputBytes === null) {
    return { ok: false, code: "invalid_number" };
  }

  const errorCode = optionalMatch(payload.errorCode, ERROR_CODE_PATTERN);
  if (errorCode === null) return { ok: false, code: "invalid_error_code" };

  // from/to are display labels that aren't stored, and some catalog values
  // (for example "Twitter/X") don't fit the pattern, so drop them, not the event.
  const from = optionalMatch(payload.from, FORMAT_PATTERN) ?? undefined;
  const to = optionalMatch(payload.to, FORMAT_PATTERN) ?? undefined;

  return {
    ok: true,
    event: {
      event: event as ToolRunEventType,
      runId: payload.runId,
      toolId: payload.toolId,
      startedAt: startedAt.toISOString(),
      ...(from !== undefined && { from }),
      ...(to !== undefined && { to }),
      ...(durationMs !== undefined && { durationMs }),
      ...(inputBytes !== undefined && { inputBytes }),
      ...(outputBytes !== undefined && { outputBytes }),
      ...(errorCode !== undefined && { errorCode }),
      ...(() => {
        const metadata = sanitizeMetadata(payload.metadata);
        return metadata ? { metadata } : {};
      })(),
    },
  };
}
