import { dispatchServerNativeRequest } from "../../../lib/server-native-capability.ts";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return dispatchServerNativeRequest({
    request,
    operation: "video-convert",
    loadHandler: async () => (await import("./native")).POST,
  });
}
