import { optimize } from "svgo/browser";
import type { ServerNativeImageCompressFormat } from "./native";
import { loadServerNativeEngine } from "../../../lib/server-native-capability.ts";
import {
  buildServerActionRateLimitResponse,
  createServerActionCooldownCookieCodec,
  createServerActionRateLimiter,
  getServerActionRateLimitIdentity,
  isSecureRequest,
  type ServerActionRateLimitIdentity,
} from "../../../lib/server-action-rate-limit.ts";

export const runtime = "nodejs";

type ImageCompressFormat =
  | "bmp"
  | "svg"
  | ServerNativeImageCompressFormat;

const IMAGE_COMPRESS_FORMATS = new Set<ImageCompressFormat>([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "svg",
  "tif",
  "tiff",
]);
const OUTPUT_MIME_MAP: Record<ImageCompressFormat, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const serverActionRateLimiter = createServerActionRateLimiter();
const serverActionCooldownCookieCodec = createServerActionCooldownCookieCodec();

function isImageCompressFormat(value: string): value is ImageCompressFormat {
  return IMAGE_COMPRESS_FORMATS.has(value as ImageCompressFormat);
}

function buildSuccessResponse(args: {
  buffer: Buffer;
  contentType: string;
  identity: ServerActionRateLimitIdentity;
  request: Request;
}): Response {
  serverActionRateLimiter.check(args.identity);
  const cooldownCookie = serverActionCooldownCookieCodec.createSetCookie(args.identity, {
    secure: isSecureRequest(args.request),
  });
  const headers = new Headers();
  headers.set("Content-Type", args.contentType);
  headers.set("Content-Length", args.buffer.length.toString());
  headers.set("set-cookie", cooldownCookie.headerValue);
  const body = new Uint8Array(args.buffer);
  return new Response(body, { headers });
}

async function compressSvg(buffer: Buffer): Promise<Buffer> {
  const svgSource = buffer.toString("utf8");
  const result = optimize(svgSource, { multipass: true });
  return Buffer.from(result.data);
}

async function compressWorkerCompatibleImage(
  format: ImageCompressFormat,
  buffer: Buffer,
): Promise<Buffer> {
  switch (format) {
    case "svg":
      return compressSvg(buffer);
    case "bmp":
      return buffer;
    default:
      throw new Error(`Unsupported Worker-compatible image format: ${format}`);
  }
}

async function compressImageByFormat(
  format: ImageCompressFormat,
  buffer: Buffer,
): Promise<Buffer | Response> {
  if (format === "svg" || format === "bmp") {
    return compressWorkerCompatibleImage(format, buffer);
  }

  const loaded = await loadServerNativeEngine({
    operation: "image-compress",
    loadEngine: async () =>
      (await import("./native")).compressServerNativeImage,
  });
  if (!loaded.available) return loaded.response;
  return loaded.engine(format, buffer);
}

export async function POST(request: Request): Promise<Response> {
  const serverActionIdentity = getServerActionRateLimitIdentity(request.headers);
  const cookieBlock = serverActionCooldownCookieCodec.readBlock(
    request.headers,
    serverActionIdentity,
  );
  if (cookieBlock) {
    return buildServerActionRateLimitResponse(cookieBlock);
  }

  const inMemoryBlock = serverActionRateLimiter.check(serverActionIdentity, {
    record: false,
  });
  if (!inMemoryBlock.allowed) {
    return buildServerActionRateLimitResponse(inMemoryBlock);
  }

  const url = new URL(request.url);
  const rawFormat = url.searchParams.get("format");
  if (!rawFormat) {
    return Response.json({ error: "Missing image format." }, { status: 400 });
  }
  const format = rawFormat.toLowerCase();
  if (!isImageCompressFormat(format)) {
    return Response.json({ error: `Unsupported image format: ${rawFormat}.` }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await request.arrayBuffer());
  } catch {
    return Response.json({ error: "Invalid image payload." }, { status: 400 });
  }

  if (!buffer.length) {
    return Response.json({ error: "Empty image payload." }, { status: 400 });
  }

  try {
    const result = await compressImageByFormat(format, buffer);
    if (result instanceof Response) return result;
    return buildSuccessResponse({
      buffer: result,
      contentType: OUTPUT_MIME_MAP[format],
      identity: serverActionIdentity,
      request,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image compression failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
