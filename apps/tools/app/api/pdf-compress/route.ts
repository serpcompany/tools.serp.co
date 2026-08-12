import { dispatchServerNativeRequest } from "../../../lib/server-native-capability.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return dispatchServerNativeRequest({
    request,
    operation: "pdf-compress",
    loadHandler: async () => (await import("./native")).POST,
  });
}
