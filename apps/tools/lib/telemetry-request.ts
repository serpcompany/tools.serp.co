// Server-side additions to a telemetry event before it is validated and
// stored (docs/telemetry.md).

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Fields only the server sets. A client-sent value for any of them is dropped.
const SERVER_KEYS = new Set(["release", "ip", "userAgent"]);

// Cloudflare sets cf-connecting-ip to the real client address; the first
// x-forwarded-for entry is whatever the client sent, so it comes last.
function getClientIp(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    (request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null)
  );
}

export function attachRequestMetadata(
  payload: unknown,
  request: Request,
  release: string | undefined = process.env.NEXT_PUBLIC_RELEASE,
): unknown {
  if (!isPlainObject(payload)) return payload;

  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent");
  const clientMetadata = Object.fromEntries(
    Object.entries(isPlainObject(payload.metadata) ? payload.metadata : {}).filter(
      ([key]) => !SERVER_KEYS.has(key),
    ),
  );
  // Server fields come first so the metadata key cap never drops them.
  const metadata = {
    ...(release ? { release } : {}),
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...clientMetadata,
  };

  return { ...payload, metadata };
}

// Browsers with Global Privacy Control send `Sec-GPC: 1`. The client already
// sends nothing in that case; this also covers pages cached before it did.
export function sentGlobalPrivacyControl(request: Request) {
  return request.headers.get("sec-gpc") === "1";
}
