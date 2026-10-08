import { DOWNLOADER_RATE_LIMIT_WINDOW_MS } from "./downloader-contract.js";

// The visible state of a downloader attempt (ToolProgressFile["status"]).
// Downloaders never set "unsupported", which starts no countdown.
export type DownloaderAttemptStatus = "loading" | "processing" | "completed" | "error" | "unsupported";

type DownloaderCooldownOptions = {
  now: number;
  // The server's remaining wait from a 429 answer; a fresh window would overstate it.
  retryAfterMs?: number | null;
  windowMs?: number;
};

// The serp downloader standard starts the countdown when an attempt succeeds
// or fails, never when processing begins. Null means no countdown: the attempt
// is still running.
export function getDownloaderCooldownEndsAtMs(
  status: DownloaderAttemptStatus,
  { now, retryAfterMs, windowMs = DOWNLOADER_RATE_LIMIT_WINDOW_MS }: DownloaderCooldownOptions,
): number | null {
  if (status !== "completed" && status !== "error") return null;

  const hasServerWait =
    typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0;
  return now + (hasServerWait ? retryAfterMs : windowMs);
}
