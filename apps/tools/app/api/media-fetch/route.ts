import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { extension as extensionForType } from "mime-types";
import { AUDIO_FORMATS, VIDEO_FORMATS } from "../../../lib/capabilities.ts";
import {
  DOWNLOADER_CONSUMER,
  DOWNLOADER_RATE_LIMIT_WINDOW_MS,
} from "../../../lib/downloader-contract.js";
import { extractWithRegisteredExtractor, type ExtractedMediaFormat } from "../../../lib/extractors/index.ts";
import {
  createDownloaderCooldownCookieCodec,
  createDownloaderRateLimiter,
  getDownloaderRateLimitIdentity,
} from "../../../lib/downloader-rate-limit.ts";
import { setMediaFilenameHeaders } from "../../../lib/media-filename-transport";
import { getUnsupportedTranscriptionLink } from "../../../lib/media-workflow/media-link-support.ts";
import { loadServerNativeEngine } from "../../../lib/server-native-capability.ts";

export const runtime = "nodejs";

const SUPPORTED_EXTENSIONS = new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS]);
const DOWNLOADER_RATE_LIMIT_WINDOW_SECONDS = Math.ceil(
  DOWNLOADER_RATE_LIMIT_WINDOW_MS / 1000,
);
type UrlPayload = {
  consumer?: string;
  url?: string;
  mode?: "audio" | "video";
};

const downloaderRateLimiter = createDownloaderRateLimiter();
const downloaderCooldownCookieCodec = createDownloaderCooldownCookieCodec();

function getServerEnv(name: string) {
  return process.env[name] ?? "";
}

const FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY_ENABLED = /^(1|true|yes|on)$/i.test(
  getServerEnv("FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY"),
);

function normalizeContentType(value: string | null) {
  if (!value) return "";
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
}

function getExtensionFromPath(pathname: string) {
  const match = pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function getFileNameFromUrl(url: URL) {
  const raw = url.pathname.split("/").filter(Boolean).pop() || "remote-file";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function getExtensionFromName(name: string) {
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function buildUnsupportedLinkResponse(
  error: Readonly<{ code: string; message: string }>,
) {
  return buildJsonErrorResponse(
    {
      code: error.code,
      error: error.message,
    },
    422,
  );
}

function parseContentDispositionFilename(header: string | null) {
  if (!header) return "";
  const utfMatch = header.match(/filename\\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }
  const asciiMatch = header.match(/filename="([^"]+)"/i);
  if (asciiMatch?.[1]) return asciiMatch[1];
  const fallbackMatch = header.match(/filename=([^;]+)/i);
  if (fallbackMatch?.[1]) return fallbackMatch[1].trim();
  return "";
}

function isBlockedAddress(address: ipaddr.IPv4 | ipaddr.IPv6) {
  let resolved: ipaddr.IPv4 | ipaddr.IPv6 = address;
  if (resolved.kind() === "ipv6") {
    const ipv6 = resolved as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) {
      resolved = ipv6.toIPv4Address();
    }
  }
  return resolved.range() !== "unicast";
}

async function assertPublicUrl(url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new Error("Invalid URL host.");
  }
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Localhost URLs are not supported.");
  }

  if (ipaddr.isValid(hostname)) {
    const parsed = ipaddr.parse(hostname);
    if (isBlockedAddress(parsed)) {
      throw new Error("Private network URLs are not supported.");
    }
    return;
  }

  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length) {
    throw new Error("Unable to resolve the URL host.");
  }
  for (const entry of addresses) {
    if (!ipaddr.isValid(entry.address)) continue;
    const parsed = ipaddr.parse(entry.address);
    if (isBlockedAddress(parsed)) {
      throw new Error("Private network URLs are not supported.");
    }
  }
}

function buildResponseHeaders(args: {
  contentType: string;
  contentLength?: number | null;
  fileName: string;
  extension: string;
}) {
  const headers = new Headers();
  if (args.contentType) {
    headers.set("content-type", args.contentType);
  }
  if (typeof args.contentLength === "number" && Number.isFinite(args.contentLength)) {
    headers.set("content-length", String(args.contentLength));
  }
  setMediaFilenameHeaders(headers, args.fileName);
  headers.set("x-media-extension", args.extension);
  headers.set("cache-control", "no-store");
  return headers;
}

function buildJsonErrorResponse(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: HeadersInit,
) {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function shouldRateLimitDownloader(payload: UrlPayload | null) {
  return payload?.consumer === DOWNLOADER_CONSUMER;
}

function buildDownloaderExtensionOnlyResponse() {
  return buildJsonErrorResponse(
    {
      error: "This website requires a browser extension to download from.",
      extensionRequired: true,
    },
    403,
  );
}

function getRateLimitMessage(retryAfterMs: number) {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `You can only download 1 video every ${DOWNLOADER_RATE_LIMIT_WINDOW_SECONDS} seconds. Try again in ${retryAfterSeconds}s.`;
}

function buildDownloaderRateLimitResponse(args: {
  blockedBy: "browser" | "client" | "cookie" | "ip";
  retryAfterMs: number;
}) {
  const retryAfterSeconds = Math.max(1, Math.ceil(args.retryAfterMs / 1000));
  return buildJsonErrorResponse(
    {
      blockedBy: args.blockedBy,
      error: getRateLimitMessage(args.retryAfterMs),
      retryAfterMs: args.retryAfterMs,
    },
    429,
    { "retry-after": String(retryAfterSeconds) },
  );
}

function isSecureRequest(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }

  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function withResponseHeaders(response: Response, extraHeaders: HeadersInit) {
  const headers = new Headers(response.headers);
  const nextHeaders = new Headers(extraHeaders);

  nextHeaders.forEach((value, key) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function tryDirectFetch(targetUrl: URL) {
  const response = await fetchPublicMediaUrl(targetUrl.toString());

  const contentType = normalizeContentType(response.headers.get("content-type"));
  const extFromUrl = getExtensionFromPath(targetUrl.pathname);
  const extFromType =
    contentType && typeof extensionForType(contentType) === "string"
      ? String(extensionForType(contentType))
      : "";

  const isMediaType =
    contentType.startsWith("audio/") || contentType.startsWith("video/");
  const hasSupportedExt =
    (extFromUrl && SUPPORTED_EXTENSIONS.has(extFromUrl)) ||
    (extFromType && SUPPORTED_EXTENSIONS.has(extFromType));

  if (!response.ok || (!isMediaType && !hasSupportedExt)) {
    response.body?.cancel();
    return null;
  }

  const dispositionName = parseContentDispositionFilename(
    response.headers.get("content-disposition")
  );
  const fallbackName = dispositionName || getFileNameFromUrl(targetUrl);
  const extension =
    (extFromUrl && SUPPORTED_EXTENSIONS.has(extFromUrl) ? extFromUrl : "") ||
    (extFromType && SUPPORTED_EXTENSIONS.has(extFromType) ? extFromType : "");

  if (!extension) {
    response.body?.cancel();
    return null;
  }

  const fileName = getExtensionFromName(fallbackName)
    ? fallbackName
    : `${fallbackName}.${extension}`;

  const headers = buildResponseHeaders({
    contentType: contentType || "application/octet-stream",
    contentLength: response.headers.get("content-length")
      ? Number(response.headers.get("content-length"))
      : null,
    fileName,
    extension,
  });

  return new Response(response.body, { status: 200, headers });
}

async function fetchPublicMediaUrl(
  url: string,
  referer?: string,
  redirectCount = 0,
): Promise<Response> {
  if (redirectCount > 5) {
    throw new Error("Too many media redirects.");
  }

  const mediaUrl = new URL(url);
  if (mediaUrl.protocol !== "http:" && mediaUrl.protocol !== "https:") {
    throw new Error("Extracted media URL protocol is not supported.");
  }
  await assertPublicUrl(mediaUrl);

  const response = await fetch(mediaUrl.toString(), {
    method: "GET",
    redirect: "manual",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; SerpToolsBot/1.0)",
      accept: "*/*",
      ...(referer ? { referer } : {}),
    },
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Extractor media redirect had no location.");
    }
    return fetchPublicMediaUrl(new URL(location, mediaUrl).toString(), referer, redirectCount + 1);
  }

  return response;
}

async function streamExtractedMedia(format: ExtractedMediaFormat) {
  const response = await fetchPublicMediaUrl(format.url, format.referer);

  if (!response.ok || !response.body) {
    response.body?.cancel();
    throw new Error(`Extractor media fetch failed with HTTP ${response.status}.`);
  }

  const contentType = normalizeContentType(response.headers.get("content-type")) || format.contentType;
  const extension = format.extension.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    response.body.cancel();
    throw new Error("Extracted media type is not supported.");
  }

  const headers = buildResponseHeaders({
    contentType: contentType || "application/octet-stream",
    contentLength: response.headers.get("content-length")
      ? Number(response.headers.get("content-length"))
      : format.contentLength,
    fileName: format.fileName,
    extension,
  });

  return new Response(response.body, { status: 200, headers });
}

async function fetchViaYtDlp(targetUrl: URL, mode: "audio" | "video") {
  const loaded = await loadServerNativeEngine({
    operation: "media-extract",
    loadEngine: async () => (await import("./native-ytdlp.ts")).resolveYtDlpMediaFormat,
  });
  if (!loaded.available) return loaded.response;
  return streamExtractedMedia(await loaded.engine(targetUrl, mode));
}

export async function POST(request: Request) {
  let payload: UrlPayload | null = null;
  try {
    payload = (await request.json()) as UrlPayload;
  } catch {
    return buildJsonErrorResponse({ error: "Invalid JSON." }, 400);
  }

  if (!payload?.url) {
    return buildJsonErrorResponse({ error: "Missing url." }, 400);
  }

  if (payload.mode && payload.mode !== "audio" && payload.mode !== "video") {
    return buildJsonErrorResponse({ error: "Invalid mode." }, 400);
  }

  if (shouldRateLimitDownloader(payload) && FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY_ENABLED) {
    return buildDownloaderExtensionOnlyResponse();
  }

  const downloaderIdentity = shouldRateLimitDownloader(payload)
    ? getDownloaderRateLimitIdentity(request.headers)
    : null;

  if (downloaderIdentity) {
    const cookieBlock = downloaderCooldownCookieCodec.readBlock(
      request.headers,
      downloaderIdentity,
    );
    if (cookieBlock) {
      return buildDownloaderRateLimitResponse(cookieBlock);
    }

    const inMemoryBlock = downloaderRateLimiter.check(downloaderIdentity, {
      record: false,
    });
    if (!inMemoryBlock.allowed) {
      return buildDownloaderRateLimitResponse(inMemoryBlock);
    }
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(payload.url);
  } catch {
    return buildJsonErrorResponse({ error: "Invalid url." }, 400);
  }

  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return buildJsonErrorResponse(
      { error: "Only http(s) URLs are supported." },
      400,
    );
  }

  const unsupportedLink = getUnsupportedTranscriptionLink(
    targetUrl,
    payload.consumer,
  );
  if (unsupportedLink) {
    return buildUnsupportedLinkResponse(unsupportedLink);
  }

  try {
    await assertPublicUrl(targetUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "URL is not allowed.";
    return buildJsonErrorResponse({ error: message }, 400);
  }

  const mode = payload.mode ?? "audio";

  try {
    const extractedMedia = await extractWithRegisteredExtractor(targetUrl, { mode });
    const directResponse = extractedMedia
      ? await streamExtractedMedia(extractedMedia)
      : await tryDirectFetch(targetUrl);
    let response = directResponse ?? (await fetchViaYtDlp(targetUrl, mode));
    if (!response.ok) return response;

    if (downloaderIdentity) {
      downloaderRateLimiter.check(downloaderIdentity);
      const cooldownCookie = downloaderCooldownCookieCodec.createSetCookie(
        downloaderIdentity,
        { secure: isSecureRequest(request) },
      );
      response = withResponseHeaders(response, {
        "set-cookie": cooldownCookie.headerValue,
      });
    }

    return response;
  } catch (err) {
    console.error("Media fetch failed", {
      errorType: err instanceof Error ? err.name : "unknown",
      sourceHost: targetUrl.hostname,
    });
    return buildJsonErrorResponse(
      {
        error:
          "This public media link could not be opened. Try a direct audio or video file URL instead.",
      },
      422,
    );
  }
}
