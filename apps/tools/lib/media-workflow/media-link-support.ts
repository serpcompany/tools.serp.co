import { DOWNLOADER_CONSUMER } from "../downloader-contract.js";

export const YOUTUBE_UNSUPPORTED_ERROR = Object.freeze({
  code: "youtube-unsupported",
  message:
    "YouTube links are not supported right now. Upload the file or use a direct public audio or video file URL.",
});

function isYouTubeFamilyHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "youtu.be" ||
    normalized === "youtube.com" ||
    normalized.endsWith(".youtube.com") ||
    normalized === "youtube-nocookie.com" ||
    normalized.endsWith(".youtube-nocookie.com")
  );
}

export function getUnsupportedTranscriptionLink(
  url: URL,
  consumer?: string,
): typeof YOUTUBE_UNSUPPORTED_ERROR | null {
  if (consumer === DOWNLOADER_CONSUMER) return null;
  return isYouTubeFamilyHost(url.hostname) ? YOUTUBE_UNSUPPORTED_ERROR : null;
}
