// One canonical form per URL (serp url-trailing-slash standard, issue #165):
// pages end in a slash, files never do, and /api, /.well-known and framework
// paths are served exactly as requested. Next.js's own trailing-slash
// redirect is off (skipTrailingSlashRedirect) because it has no /api
// exception and OpenNext's version never strips a file's slash.

// Extensions that make a path a file. Keep top-level domains such as .app,
// .zip, .mov or .md out of this list: no page slug may end in one of these.
const FILE_EXTENSIONS = new Set([
  "avif", "css", "gif", "html", "ico", "jpeg", "jpg", "js", "json", "map", "mjs",
  "mp3", "mp4", "ogg", "otf", "pdf", "png", "svg", "ttf", "txt", "wasm", "wav",
  "webm", "webmanifest", "webp", "woff", "woff2", "xml",
]);

// Paths that aren't pages and are never redirected: /api (first segment
// only, any case), /.well-known, and anything starting with `_` (/_next/).
function isExempt(pathname: string) {
  return /^\/(api(\/|$)|\.well-known\/|_|cdn-cgi\/)/i.test(pathname);
}

export function isFilePath(pathname: string) {
  const last = pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  return dot > 0 && FILE_EXTENSIONS.has(last.slice(dot + 1).toLowerCase());
}

// The canonical spelling of `pathname`, or the same string when it already
// is canonical or is exempt.
export function canonicalPath(pathname: string): string {
  if (pathname === "/" || isExempt(pathname)) return pathname;
  if (isFilePath(pathname)) return pathname.replace(/\/+$/, "");
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}
