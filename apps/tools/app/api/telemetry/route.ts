import { NextResponse } from "next/server";
import { recordToolRun } from "@serp-tools/tool-telemetry/server";
import { getSerpToolsD1Binding } from "@/lib/cloudflare-d1";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    null
  );
}

function attachRequestMetadata(payload: unknown, request: Request): unknown {
  if (!isPlainObject(payload)) return payload;

  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent");
  // Server fields come first so the metadata key cap never drops them; a
  // client-sent value for the same key still takes precedence, as before.
  const metadata = {
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(isPlainObject(payload.metadata) ? payload.metadata : {}),
  };

  if (Object.keys(metadata).length > 0) {
    return { ...payload, metadata };
  }

  return payload;
}

// A tool-run event is a few hundred characters; reject anything far larger
// before parsing it.
const MAX_BODY_CHARS = 16 * 1024;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_CHARS) {
    return errorResponse("payload_too_large", 413);
  }
  const body = await request.text();
  if (body.length > MAX_BODY_CHARS) {
    return errorResponse("payload_too_large", 413);
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const enrichedPayload = attachRequestMetadata(payload, request);
  const d1 = await getSerpToolsD1Binding();
  const result = await recordToolRun(enrichedPayload, { d1 });
  return NextResponse.json(result.body, { status: result.status });
}
