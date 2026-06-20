import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isD1DatabaseLike, type D1DatabaseLike } from "@serp-tools/tool-telemetry/d1";

export async function getSerpToolsD1Binding(): Promise<D1DatabaseLike | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const binding = (env as Record<string, unknown>).SERP_TOOLS_DB;
    return isD1DatabaseLike(binding) ? binding : null;
  } catch {
    return null;
  }
}
