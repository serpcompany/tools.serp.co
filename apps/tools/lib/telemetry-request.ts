// Server-side additions to a telemetry event before it is validated and
// stored (docs/telemetry.md).

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

export function attachRequestMetadata(
  payload: unknown,
  request: Request,
  release: string | undefined = process.env.NEXT_PUBLIC_RELEASE,
): unknown {
  if (!isPlainObject(payload)) return payload;

  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent");
  // Server fields come first so the metadata key cap never drops them; a
  // client-sent ip or userAgent still takes precedence, as before. The
  // release always comes from the server.
  const metadata = {
    ...(release ? { release } : {}),
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(isPlainObject(payload.metadata) ? payload.metadata : {}),
    ...(release ? { release } : {}),
  };

  if (Object.keys(metadata).length > 0) {
    return { ...payload, metadata };
  }

  return payload;
}
