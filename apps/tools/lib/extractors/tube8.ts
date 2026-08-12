import type { ExtractedMediaFormat, MediaExtractor } from "./types.ts";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36";

type Tube8MediaDefinition = {
  format?: string;
  videoUrl?: string;
};

type Tube8Variant = {
  defaultQuality?: boolean;
  format?: string;
  quality?: string;
  videoUrl?: string;
};

function isTube8Host(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "tube8.com" || host === "www.tube8.com";
}

function isAllowedTube8MediaUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "www.tube8.com" || host === "tube8.com" || host.endsWith(".t8cdn.com"));
  } catch {
    return false;
  }
}

async function fetchAllowedTube8Url(url: string, options: { method?: "GET" | "HEAD"; referer?: string } = {}, redirectCount = 0): Promise<Response> {
  if (redirectCount > 5) {
    throw new Error("Too many Tube8 media redirects.");
  }
  if (!isAllowedTube8MediaUrl(url)) {
    throw new Error("Tube8 extractor rejected an unexpected media URL.");
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      "user-agent": BROWSER_USER_AGENT,
      accept: options.method === "HEAD" ? "*/*" : "text/html,application/xhtml+xml,application/json,*/*",
      ...(options.referer ? { referer: options.referer } : {}),
    },
    redirect: "manual",
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Tube8 redirect had no location.");
    }
    return fetchAllowedTube8Url(new URL(location, url).toString(), options, redirectCount + 1);
  }

  return response;
}

function parseMediaDefinitions(html: string): Tube8MediaDefinition[] {
  const match =
    html.match(/mediaDefinition\s*:\s*(\[[\s\S]*?\])\s*,\s*(?:image_url|video_title)/) ??
    html.match(/mediaDefinition\s*:\s*(\[\{[\s\S]*?videoUrl[\s\S]*?\}\])/);

  if (!match?.[1]) return [];

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return Array.isArray(parsed) ? (parsed as Tube8MediaDefinition[]) : [];
  } catch {
    return [];
  }
}

function parseTitle(html: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = ogTitle ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "tube8-video";
  return title
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .toLowerCase() || "tube8-video";
}

async function fetchText(url: string, referer?: string) {
  const response = await fetchAllowedTube8Url(url, { referer });

  if (!response.ok) {
    throw new Error(`Tube8 fetch failed with HTTP ${response.status}.`);
  }

  return response.text();
}

async function headMedia(url: string, referer: string) {
  const response = await fetchAllowedTube8Url(url, { method: "HEAD", referer });

  if (!response.ok) {
    throw new Error(`Tube8 media HEAD failed with HTTP ${response.status}.`);
  }

  return {
    contentType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "video/mp4",
    contentLength: response.headers.get("content-length") ? Number(response.headers.get("content-length")) : null,
  };
}

function chooseVariant(variants: Tube8Variant[]) {
  return (
    variants.find((variant) => variant.defaultQuality && variant.videoUrl) ??
    variants
      .filter((variant) => variant.videoUrl)
      .sort((a, b) => Number(b.quality || 0) - Number(a.quality || 0))[0]
  );
}

export const tube8Extractor: MediaExtractor = {
  id: "tube8-media-definition",
  canHandle(url) {
    return isTube8Host(url.hostname);
  },
  async extract(url, context) {
    if (context.mode !== "video") return null;

    const pageUrl = url.toString();
    const html = await fetchText(pageUrl);
    const mediaDefinitions = parseMediaDefinitions(html);
    const mp4Definition = mediaDefinitions.find(
      (item) => item.format === "mp4" && item.videoUrl && isAllowedTube8MediaUrl(item.videoUrl),
    );
    const hlsDefinition = mediaDefinitions.find(
      (item) => item.format === "hls" && item.videoUrl && isAllowedTube8MediaUrl(item.videoUrl),
    );
    const definition = mp4Definition ?? hlsDefinition;

    if (!definition?.videoUrl) return null;

    const variantPayload = await fetchText(definition.videoUrl, pageUrl);
    const variants = JSON.parse(variantPayload) as Tube8Variant[];
    if (!Array.isArray(variants)) return null;

    const variant = chooseVariant(variants);
    if (!variant?.videoUrl || !isAllowedTube8MediaUrl(variant.videoUrl)) return null;

    const extension = variant.format === "hls" ? "m3u8" : "mp4";
    const head = await headMedia(variant.videoUrl, pageUrl);
    const title = parseTitle(html);
    const quality = variant.quality ? `${variant.quality}p` : "video";

    return {
      url: variant.videoUrl,
      quality,
      extension,
      contentType: head.contentType,
      contentLength: Number.isFinite(head.contentLength) ? head.contentLength : null,
      fileName: `${title}-${quality}.${extension}`,
      referer: pageUrl,
    } satisfies ExtractedMediaFormat;
  },
};
