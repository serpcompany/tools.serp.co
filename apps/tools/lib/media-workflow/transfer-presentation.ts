import type { MediaTransferProgress } from "./media-endpoint.ts";

export type MediaTransferPresentation = Readonly<{
  progress?: number;
  message: string;
}>;

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1_024 && unit < units.length - 1) {
    value /= 1_024;
    unit += 1;
  }
  const digits = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function projectMediaTransfer(
  transfer: MediaTransferProgress,
): MediaTransferPresentation {
  const speed =
    transfer.bytesPerSecond > 0
      ? `${formatBytes(transfer.bytesPerSecond)}/s`
      : "calculating speed";
  if (transfer.totalBytes === undefined || transfer.ratio === undefined) {
    return {
      progress: undefined,
      message: `${formatBytes(transfer.receivedBytes)} downloaded • ${speed} • total size unknown`,
    };
  }

  const eta =
    transfer.etaSeconds === undefined
      ? "estimating time remaining"
      : `${Math.ceil(transfer.etaSeconds)}s remaining`;
  return {
    progress: Math.round(Math.min(1, Math.max(0, transfer.ratio)) * 100),
    message: `${formatBytes(transfer.receivedBytes)} of ${formatBytes(transfer.totalBytes)} • ${speed} • ${eta}`,
  };
}
