export const DOWNLOADER_EXTENSION_URL = "https://serp.ly/serp-video-tools";
export const DOWNLOADER_EXTENSION_TEXT =
  "Get the browser extension for unlimited downloads.";
export const DOWNLOADER_EXTENSION_LABEL = "Get It Now";

/**
 * Append `?via=tools.serp.co` tracking to any serp.ly URL.
 * Non-serp.ly URLs pass through unchanged.
 */
export function withSerplyTracking(url: string): string {
  if (!url.includes("serp.ly")) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("via")) {
      parsed.searchParams.set("via", "tools.serp.co");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
