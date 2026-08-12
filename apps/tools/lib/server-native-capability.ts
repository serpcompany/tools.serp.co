export const SERVER_NATIVE_OPERATIONS = [
  "image-compress",
  "image-convert",
  "video-convert",
  "pdf-compress",
  "media-extract",
] as const;

export type ServerNativeOperation = (typeof SERVER_NATIVE_OPERATIONS)[number];
export type ServerNativeAvailability = "available" | "unavailable";

export type ServerNativeCapability = Readonly<
  | { available: true }
  | { available: false; reason: string }
>;

const CONFIGURED_UNAVAILABLE_REASON =
  "Server-native processing is unavailable in this runtime.";
const LOAD_FAILURE_REASON =
  "Server-native processing could not start in this runtime.";

export function parseServerNativeAvailability(
  value: unknown,
): ServerNativeAvailability {
  return value === "available" ? "available" : "unavailable";
}

export function projectServerNativeCapabilities(
  configuredAvailability: unknown =
    process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS,
): Readonly<Record<ServerNativeOperation, ServerNativeCapability>> {
  const availability = parseServerNativeAvailability(configuredAvailability);
  const capability: ServerNativeCapability =
    availability === "unavailable"
      ? Object.freeze({
          available: false,
          reason: CONFIGURED_UNAVAILABLE_REASON,
        })
      : Object.freeze({ available: true });

  return Object.freeze(
    Object.fromEntries(
      SERVER_NATIVE_OPERATIONS.map((operation) => [operation, capability]),
    ) as Record<ServerNativeOperation, ServerNativeCapability>,
  );
}

export function getServerNativeCapability(
  operation: ServerNativeOperation,
): ServerNativeCapability {
  return projectServerNativeCapabilities()[operation];
}

function unavailableResponse(
  operation: ServerNativeOperation,
  reason: string,
): Response {
  return Response.json(
    {
      code: "server-native-unavailable",
      error: reason,
      capability: {
        operation,
        available: false,
      },
    },
    { status: 503 },
  );
}

export async function dispatchServerNativeRequest(args: {
  request: Request;
  operation: ServerNativeOperation;
  capability?: ServerNativeCapability;
  loadHandler(): Promise<(request: Request) => Promise<Response>>;
}): Promise<Response> {
  const loaded = await loadServerNativeEngine({
    operation: args.operation,
    capability: args.capability,
    loadEngine: args.loadHandler,
  });
  if (!loaded.available) return loaded.response;
  return loaded.engine(args.request);
}

export async function loadServerNativeEngine<Engine>(args: {
  operation: ServerNativeOperation;
  capability?: ServerNativeCapability;
  loadEngine(): Promise<Engine>;
}): Promise<
  | Readonly<{ available: true; engine: Engine }>
  | Readonly<{ available: false; response: Response }>
> {
  const capability =
    args.capability ?? getServerNativeCapability(args.operation);
  if (!capability.available) {
    return {
      available: false,
      response: unavailableResponse(args.operation, capability.reason),
    };
  }

  try {
    return { available: true, engine: await args.loadEngine() };
  } catch {
    return {
      available: false,
      response: unavailableResponse(args.operation, LOAD_FAILURE_REASON),
    };
  }
}
