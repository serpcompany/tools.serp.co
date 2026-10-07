// Pure helpers for scripts/render-snapshot.mjs: build-noise normalization,
// route discovery and snapshot comparison. The command does the I/O.

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Response headers a crawler or visitor depends on. cache-control also shows
// whether a page is prerendered or rendered per request. Everything else
// (Date, Age, cache hit or miss, the release id) changes per build or request.
export const RECORDED_HEADERS = [
  "location",
  "content-type",
  "cache-control",
  "x-robots-tag",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
];

const ORIGIN_TOKEN = "[origin]";
const BUILD_ID_TOKEN = "[build-id]";
const TEXT_CONTENT_TYPE = /^(?:text\/|application\/(?:xml|json|javascript|xhtml\+xml|rss\+xml)|[^;]*\+xml)/i;
// React Server Components (flight) data that Next.js streams into the HTML.
const FLIGHT_SCRIPT = /<script>self\.__next_f\.push\(.*?\)<\/script>/gs;
// One flight text chunk; React escapes each chunk on its own.
const FLIGHT_TEXT_SCRIPT = /<script>self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)<\/script>/g;

function replaceEvery(text, search, replacement) {
  return search ? text.split(search).join(replacement) : text;
}

export function isTextContentType(contentType) {
  return TEXT_CONTENT_TYPE.test(contentType ?? "");
}

// The served origin, wherever a page writes it: sitemap entries, redirect
// targets, and URL-encoded in query strings.
export function normalizeOrigin(text, origin) {
  if (!text || !origin) return text;
  return replaceEvery(
    replaceEvery(text, origin, ORIGIN_TOKEN),
    encodeURIComponent(origin),
    encodeURIComponent(ORIGIN_TOKEN),
  );
}

// A hashed build asset name, without its content hash or chunk id:
// "page-b0619cf79db4805d.js" -> "page-[hash].js", "2089-318971f7172762a7.js"
// and "67e8e8be-9d94273b155755f5.js" -> "[chunk].js",
// "0af1c51d0cc190ba.css" -> "[hash].css".
export function normalizeAssetName(fileName) {
  return fileName
    .replace(/[0-9a-f]{16,}/g, "[hash]")
    .replace(/^(?:\d+|[0-9a-f]{8})-\[hash\]/, "[chunk]");
}

// The Next.js build id, a new random value per build: the "b" field of the
// root flight row, and any /_next/static/<id>/ directory.
function normalizeBuildId(text) {
  const ids = new Set();
  for (const match of text.matchAll(/(?:^|"|\\n)0:\{\\?"P\\?":[^,]*,\\?"b\\?":\\?"([\w-]{10,})\\?"/g)) {
    ids.add(match[1]);
  }
  for (const match of text.matchAll(/\/_next\/static\/([\w-]{21})\//g)) ids.add(match[1]);
  let normalized = text;
  for (const id of ids) normalized = replaceEvery(normalized, id, BUILD_ID_TOKEN);
  return normalized;
}

// Where React cuts the flight text into chunks, and where those land in the
// streamed HTML, follow byte counts that change with asset names: join the
// chunks into one script where the first one was.
function joinFlightText(html) {
  const chunks = [];
  let firstIndex = -1;
  const rest = html.replace(FLIGHT_TEXT_SCRIPT, (_, chunk, offset) => {
    if (firstIndex === -1) firstIndex = offset;
    chunks.push(chunk);
    return "";
  });
  if (firstIndex === -1) return html;
  const joined = `<script>self.__next_f.push([1,"${chunks.join("")}"])</script>`;
  return `${rest.slice(0, firstIndex)}${joined}${rest.slice(firstIndex)}`;
}

// Removes build noise and nothing else: text, links, canonicals, meta tags
// and JSON-LD are compared as served.
export function normalizeBody(text, { origin } = {}) {
  let normalized = normalizeOrigin(text, origin);
  normalized = joinFlightText(normalized);
  normalized = normalizeBuildId(normalized);
  // Client component references in flight data: I[<module id>,[<chunk id>,
  // <chunk file>, ...],"<export>"] keep only the export name.
  normalized = normalized.replace(
    /:I\[(?:\d+|\\?"[^"\\]*\\?"),\[[^\]]*\]/g,
    ":I[[module],[chunks]]",
  );
  // Hashed asset paths, in HTML ("/_next/static/chunks/...") and in flight
  // data ("static/chunks/..." as a quoted string).
  normalized = normalized.replace(
    /(\/_next\/static\/(?:chunks|css|media)\/|(?<=")static\/chunks\/)((?:[^"'\\\s?/]+\/)*)([^"'\\\s)?/]+)/g,
    (_, prefix, directories, fileName) => `${prefix}${directories}${normalizeAssetName(fileName)}`,
  );
  // Shared chunks are named by number, and how many a page loads depends on
  // how webpack splits the bundle: keep one tag per run of them.
  normalized = normalized.replace(
    /(<script src="\/_next\/static\/chunks\/\[chunk\]\.js" async=""><\/script>)+/g,
    "$1",
  );
  // Skew-protection deployment ids and CSP nonces.
  normalized = normalized.replace(/((?:[?&]|&amp;)dpl=)[\w.-]+/g, "$1[dpl]");
  normalized = normalized.replace(/\bnonce="[^"]+"/g, 'nonce="[nonce]"');
  normalized = normalized.replace(
    /(\\?"nonce\\?":\\?")(?!\$undefined)[^"\\]+/g,
    "$1[nonce]",
  );
  return normalized;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// The page without its flight data, so a diff can say whether the HTML a
// crawler reads changed or only the data the client hydrates from.
export function splitFlightData(html) {
  const flight = [];
  const document = html.replace(FLIGHT_SCRIPT, (script) => {
    flight.push(script);
    return "";
  });
  return { document, flight: flight.join("\n") };
}

// What gets recorded for one URL. `body` is a Buffer or string.
export function describeResponse({ status, headers, body, origin }) {
  const recordedHeaders = {};
  for (const name of RECORDED_HEADERS) {
    const value = headers.get(name);
    recordedHeaders[name] = value === null ? null : normalizeOrigin(value, origin);
  }
  const contentType = headers.get("content-type") ?? "";
  if (!isTextContentType(contentType)) {
    return {
      entry: { status, headers: recordedHeaders, bodySha256: sha256(body) },
      normalizedBody: body,
    };
  }
  const normalizedBody = normalizeBody(Buffer.from(body).toString("utf8"), { origin });
  const { document, flight } = splitFlightData(normalizedBody);
  return {
    entry: {
      status,
      headers: recordedHeaders,
      bodySha256: sha256(normalizedBody),
      documentSha256: sha256(document),
      flightSha256: sha256(flight),
    },
    normalizedBody,
  };
}

export function decodeXmlText(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// The <loc> values of a sitemap index or URL set, as path + query.
export function sitemapLocPaths(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => {
    const url = new URL(decodeXmlText(match[1]));
    return `${url.pathname}${url.search}`;
  });
}

// Top-level route segments that aren't public pages.
const SKIPPED_SEGMENTS = new Set(["api", "internal"]);

// Every static page route under a Next.js app directory, slashed: route
// groups are dropped, and dynamic ([x]), private (_x), parallel (@x) and
// intercepting ((.)x) segments are skipped.
export function staticPageRoutes(appDir) {
  const routes = [];
  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (entry.isFile()) {
        if (/^page\.(?:tsx|ts|jsx|js|mdx)$/.test(name)) {
          routes.push(segments.length ? `/${segments.join("/")}/` : "/");
        }
        continue;
      }
      if (!entry.isDirectory() || /^(?:\[|_|@|\(\.)/.test(name)) continue;
      if (segments.length === 0 && SKIPPED_SEGMENTS.has(name)) continue;
      const isGroup = /^\(.+\)$/.test(name);
      walk(path.join(dir, name), isGroup ? segments : [...segments, name]);
    }
  };
  walk(appDir, []);
  return [...new Set(routes)].sort();
}

// A stable, reversible file name for a URL path.
export function bodyFileName(urlPath) {
  return encodeURIComponent(urlPath);
}

function describeValue(value) {
  return value === null || value === undefined ? "(none)" : JSON.stringify(value);
}

// Field-level differences between two recorded entries.
export function compareEntries(a, b) {
  const changes = [];
  // A failed request recorded nothing else to compare.
  if (a.error || b.error) {
    if (a.error !== b.error) changes.push(`error ${describeValue(a.error)} -> ${describeValue(b.error)}`);
    return changes;
  }
  if (a.status !== b.status) changes.push(`status ${a.status} -> ${b.status}`);
  const headerNames = new Set([...Object.keys(a.headers ?? {}), ...Object.keys(b.headers ?? {})]);
  for (const name of headerNames) {
    const before = a.headers?.[name] ?? null;
    const after = b.headers?.[name] ?? null;
    if (before !== after) {
      changes.push(`${name} ${describeValue(before)} -> ${describeValue(after)}`);
    }
  }
  if (a.bodySha256 !== b.bodySha256) {
    const parts = [];
    if (a.documentSha256 !== b.documentSha256) parts.push("document");
    if (a.flightSha256 !== b.flightSha256) parts.push("flight data");
    changes.push(parts.length ? `body (${parts.join(", ")})` : "body");
  }
  return changes;
}

// Added, removed and changed URLs between two snapshots' entries.
export function diffSnapshots(before, after) {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const result = { added: [], removed: [], changed: [] };
  for (const urlPath of paths) {
    if (!(urlPath in before)) result.added.push(urlPath);
    else if (!(urlPath in after)) result.removed.push(urlPath);
    else {
      const changes = compareEntries(before[urlPath], after[urlPath]);
      if (changes.length) result.changed.push({ path: urlPath, changes });
    }
  }
  return result;
}

export function hasDifferences(result) {
  return result.added.length + result.removed.length + result.changed.length > 0;
}

// Minified HTML and flight data are a few very long lines: break them at
// tags and flight rows so a diff points at the change.
export function toDisplayLines(text) {
  return text.replace(/></g, ">\n<").replace(/\\n/g, "\\n\n").split("\n");
}

const MAX_LINE_WIDTH = 200;

function firstDifference(a, b) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

// A long line cut to MAX_LINE_WIDTH around `focus`, the first changed
// character.
function clipLine(line, focus = 0) {
  if (line.length <= MAX_LINE_WIDTH) return line;
  const start = Math.max(0, Math.min(focus - 60, line.length - MAX_LINE_WIDTH));
  const end = start + MAX_LINE_WIDTH;
  return `${start > 0 ? "..." : ""}${line.slice(start, end)}${end < line.length ? "..." : ""}`;
}

// Pairs each removed line with the added line in the same position of the
// same change block, so a long line is clipped around its first difference.
function clipHunkLines(lines) {
  const clipped = [];
  let index = 0;
  while (index < lines.length) {
    if (!lines[index].startsWith("-")) {
      clipped.push(lines[index][0] === "@" ? lines[index] : `${lines[index][0]}${clipLine(lines[index].slice(1))}`);
      index += 1;
      continue;
    }
    const removed = [];
    const added = [];
    while (index < lines.length && lines[index].startsWith("-")) removed.push(lines[index++].slice(1));
    while (index < lines.length && lines[index].startsWith("+")) added.push(lines[index++].slice(1));
    clipped.push(
      ...removed.map((line, at) => `-${clipLine(line, firstDifference(line, added[at] ?? ""))}`),
      ...added.map((line, at) => `+${clipLine(line, firstDifference(line, removed[at] ?? ""))}`),
    );
  }
  return clipped;
}

// A short unified diff of two bodies split into display lines, from
// `git diff --no-index`, cut to maxLines lines of at most MAX_LINE_WIDTH
// characters.
export function unifiedDiff(before, after, { labelA = "a", labelB = "b", context = 3, maxLines = 60 } = {}) {
  if (before === after) return "";
  const dir = mkdtempSync(path.join(tmpdir(), "render-snapshot-diff-"));
  try {
    writeFileSync(path.join(dir, "a"), `${toDisplayLines(before).join("\n")}\n`);
    writeFileSync(path.join(dir, "b"), `${toDisplayLines(after).join("\n")}\n`);
    const result = spawnSync(
      "git",
      ["diff", "--no-index", "--no-color", "--no-ext-diff", "--text", `-U${context}`, "a", "b"],
      { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`git diff failed: ${result.error?.message ?? result.stderr}`);
    }
    const output = result.stdout.split("\n");
    const firstHunk = output.findIndex((line) => line.startsWith("@@"));
    if (firstHunk === -1) return `--- ${labelA}\n+++ ${labelB}\n(the bodies differ only in line breaks)`;
    const hunks = output.slice(firstHunk);
    const body = clipHunkLines(hunks.filter((line) => line !== "" && !line.startsWith("\\")));
    const lines = [`--- ${labelA}`, `+++ ${labelB}`, ...body.slice(0, maxLines)];
    if (body.length > maxLines) lines.push(`... ${body.length - maxLines} more lines`);
    return lines.join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
