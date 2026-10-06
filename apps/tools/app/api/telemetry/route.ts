import { NextResponse } from "next/server";
import { recordToolRun } from "@serp-tools/tool-telemetry/server";
import { getSerpToolsD1Binding } from "@/lib/cloudflare-d1";
import { attachRequestMetadata, sentGlobalPrivacyControl } from "@/lib/telemetry-request";

// A tool-run event is a few hundred characters; reject anything far larger
// before parsing it.
const MAX_BODY_CHARS = 16 * 1024;

function errorResponse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request): Promise<Response> {
  if (sentGlobalPrivacyControl(request)) {
    return new Response(null, { status: 204 });
  }
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
