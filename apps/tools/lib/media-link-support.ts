import { DOWNLOADER_CONSUMER } from "./downloader-contract.js";

// What /api/media-fetch can honestly do on Cloudflare Workers: stream a direct
// public audio or video file, or a page one of our registered extractors
// understands. The yt-dlp fallback needs a native binary, which Workers can't
// run, so YouTube and other webpage links fail there (issue #97).

export const YOUTUBE_LINK_UNSUPPORTED = Object.freeze({
  code: "youtube-unsupported",
  message:
    "YouTube links can't be transcribed right now. Upload the audio or video file, or paste a direct link to one.",
});

export const MEDIA_LINK_UNAVAILABLE = Object.freeze({
  code: "media-link-unavailable",
  message:
    "We couldn't get audio or video from that link. Paste a direct link to an audio or video file, or upload the file.",
});

export function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "youtu.be" ||
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com")
  );
}

// The message talks about transcription, so only transcription requests are
// turned away up front. Downloader requests for YouTube still reach the
// generic MEDIA_LINK_UNAVAILABLE failure.
export function getUnsupportedTranscriptionLink(
  url: URL,
  consumer: string | undefined,
): typeof YOUTUBE_LINK_UNSUPPORTED | null {
  if (consumer === DOWNLOADER_CONSUMER) return null;
  return isYouTubeHost(url.hostname) ? YOUTUBE_LINK_UNSUPPORTED : null;
}
