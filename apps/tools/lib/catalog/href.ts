import { canonicalPath } from "../trailing-slash.ts";

// A Tool's public URL path, with its trailing slash: with
// skipTrailingSlashRedirect on, <Link> doesn't add it. No registry import, so
// client components can use it without shipping the registry.
export function toolHref(tool: { route: string }): string {
  return canonicalPath(tool.route);
}
