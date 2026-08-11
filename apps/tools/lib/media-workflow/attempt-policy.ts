const KNOWN_UNRELIABLE_DOWNLOADER_TOOL_IDS = new Set([
  "download-ashemaletube-videos",
  "download-beeg-videos",
  "download-boyfriendtv-videos",
  "download-eporner-videos",
  "download-xhamster-videos",
]);

export type DownloaderAttemptPolicy = Readonly<
  | { kind: "allow" }
  | { kind: "reject"; message: string }
>;

export function getDownloaderAttemptPolicy(
  toolId: string,
): DownloaderAttemptPolicy {
  return KNOWN_UNRELIABLE_DOWNLOADER_TOOL_IDS.has(toolId)
    ? {
        kind: "reject",
        message:
          "This website is not reliably downloadable from the web form. Use the browser extension for this site.",
      }
    : { kind: "allow" };
}
