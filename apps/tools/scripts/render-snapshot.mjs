// Records what crawlers and visitors get from a running Worker, so a refactor
// can prove it changes nothing: snapshot the base build and the head build,
// then diff the two (issue #148).
//
//   node scripts/render-snapshot.mjs snapshot --base-url http://localhost:8787 --out <dir>
//     [--concurrency 8] [--app-dir app] [--path /extra/path/ ...] [--paths-from <dir>]
//   node scripts/render-snapshot.mjs diff <dirA> <dirB> [--max-diffs 5] [--max-lines 60]
//
// A snapshot covers every URL in the sitemap tree, every static page route
// under the app directory that the sitemap leaves out, /robots.txt, /ads.txt,
// the sitemap files themselves and a few redirect and not-found probes.
// --paths-from adds every URL another snapshot recorded, so a head snapshot
// also requests pages that only the base had. Each URL records its status, the
// headers in RECORDED_HEADERS and its body with build noise normalized away
// (lib/render-snapshot.mjs). The sitemap files, robots.txt and ads.txt are
// also kept byte for byte under raw/.
//
// Snapshot base and head built the same way. A local `cf:build` serves every
// page noindex with ads off; `cf:build:production` covers those too.
//
// diff exits 1 on any added, removed or changed URL.

import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bodyFileName,
  describeResponse,
  diffSnapshots,
  hasDifferences,
  sitemapLocPaths,
  staticPageRoutes,
  unifiedDiff,
} from "./lib/render-snapshot.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Deployed Workers skip their canonical-host redirect for requests with this
// header, so a preview Worker can be crawled on its own host.
const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
const SITEMAP_INDEX_PATH = "/sitemap-index.xml";
const REQUEST_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 1_000;
// Redirects and not-found answers a refactor must keep: the sitemap aliases,
// unslashed page and tool URLs, and an unknown category and tool.
const PROBE_PATHS = [
  "/sitemap.xml",
  "/sitemap-0.xml",
  "/tools-0.xml",
  "/categories",
  "/png-to-jpg",
  "/category/not-a-category/",
  "/not-a-tool/",
];
const USAGE = `Usage:
  render-snapshot.mjs snapshot --base-url <url> --out <dir> [--concurrency <n>] [--app-dir <dir>] [--path <path> ...] [--paths-from <dir>]
  render-snapshot.mjs diff <dirA> <dirB> [--max-diffs <n>] [--max-lines <n>]`;

function parsePositiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${flag} needs a positive integer`);
  return number;
}

function parseArgs(argv) {
  const [command, ...rest] = argv.filter((arg) => arg !== "--");
  const args = {
    command,
    baseUrl: "",
    out: "",
    appDir: path.join(appRoot, "app"),
    concurrency: 8,
    extraPaths: [],
    pathsFrom: [],
    dirs: [],
    maxDiffs: 5,
    maxLines: 60,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const value = () => {
      const next = rest[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--base-url") args.baseUrl = value();
    else if (arg === "--out") args.out = path.resolve(value());
    else if (arg === "--app-dir") args.appDir = path.resolve(value());
    else if (arg === "--concurrency") args.concurrency = parsePositiveInteger(value(), arg);
    else if (arg === "--path") args.extraPaths.push(value());
    else if (arg === "--paths-from") args.pathsFrom.push(path.resolve(value()));
    else if (arg === "--max-diffs") args.maxDiffs = parsePositiveInteger(value(), arg);
    else if (arg === "--max-lines") args.maxLines = parsePositiveInteger(value(), arg);
    else if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    else args.dirs.push(path.resolve(arg));
  }
  if (command === "snapshot") {
    if (!args.baseUrl || !args.out) throw new Error(`snapshot needs --base-url and --out\n${USAGE}`);
    if (args.dirs.length) throw new Error(`snapshot takes no positional arguments\n${USAGE}`);
  } else if (command === "diff") {
    if (args.dirs.length !== 2) throw new Error(`diff needs two snapshot directories\n${USAGE}`);
  } else {
    throw new Error(USAGE);
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One GET without following redirects. A network error or timeout is retried
// once; HTTP error statuses are answers and are recorded as they are.
async function fetchWithRetry(origin, urlPath) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${origin}${urlPath}`, {
        redirect: "manual",
        headers: { [SMOKE_TEST_HEADER]: "1" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = Buffer.from(await response.arrayBuffer());
      return { status: response.status, headers: response.headers, body };
    } catch (error) {
      if (attempt >= 2) throw error;
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function snapshot(args) {
  const startedAt = Date.now();
  const origin = new URL(args.baseUrl).origin;
  const otherPaths = args.pathsFrom.flatMap((dir) => Object.keys(readSnapshot(dir).entries));
  if (existsSync(args.out) && readdirSync(args.out).length) {
    throw new Error(`${args.out} is not empty; snapshot into a new directory`);
  }
  mkdirSync(path.join(args.out, "bodies"), { recursive: true });
  mkdirSync(path.join(args.out, "raw"), { recursive: true });

  const entries = {};
  const sources = {};
  const errors = [];

  async function capture(urlPath, { keepRaw = false } = {}) {
    if (urlPath in entries) return null;
    entries[urlPath] = null; // claimed
    try {
      const response = await fetchWithRetry(origin, urlPath);
      const { entry, normalizedBody } = describeResponse({ ...response, origin });
      entries[urlPath] = entry;
      writeFileSync(path.join(args.out, "bodies", bodyFileName(urlPath)), normalizedBody);
      if (keepRaw) {
        writeFileSync(path.join(args.out, "raw", bodyFileName(urlPath)), response.body);
      }
      return response;
    } catch (error) {
      const cause = error.cause?.code ? ` (${error.cause.code})` : "";
      const message = error.name === "TimeoutError" ? "timed out" : `${error.message}${cause}`;
      entries[urlPath] = { error: message };
      errors.push(`${urlPath}: ${message}`);
      return null;
    }
  }

  // The sitemap tree first: it names the pages.
  const pagePaths = new Set();
  const index = await capture(SITEMAP_INDEX_PATH, { keepRaw: true });
  sources[SITEMAP_INDEX_PATH] = "sitemap-file";
  const urlSetPaths = index?.status === 200 ? sitemapLocPaths(index.body.toString("utf8")) : [];
  for (const urlSetPath of urlSetPaths) {
    const urlSet = await capture(urlSetPath, { keepRaw: true });
    sources[urlSetPath] = "sitemap-file";
    if (urlSet?.status !== 200) continue;
    for (const pagePath of sitemapLocPaths(urlSet.body.toString("utf8"))) {
      pagePaths.add(pagePath);
      sources[pagePath] ??= "sitemap";
    }
  }
  if (urlSetPaths.length === 0 || pagePaths.size === 0) {
    errors.push(`${SITEMAP_INDEX_PATH}: no sitemap pages found`);
  }
  for (const filePath of ["/robots.txt", "/ads.txt"]) {
    await capture(filePath, { keepRaw: true });
    sources[filePath] = "crawler-file";
  }

  const routePaths = staticPageRoutes(args.appDir).filter((route) => !pagePaths.has(route));
  for (const route of routePaths) sources[route] ??= "app-route";
  for (const probe of [...PROBE_PATHS, ...args.extraPaths]) sources[probe] ??= "probe";
  for (const otherPath of otherPaths) sources[otherPath] ??= "other-snapshot";

  const queue = [
    ...new Set([...pagePaths, ...routePaths, ...PROBE_PATHS, ...args.extraPaths, ...otherPaths]),
  ].filter((urlPath) => !(urlPath in entries));
  let done = 0;
  const total = queue.length;
  async function worker() {
    for (let urlPath = queue.shift(); urlPath !== undefined; urlPath = queue.shift()) {
      await capture(urlPath);
      done += 1;
      if (done % 250 === 0) process.stderr.write(`  ${done}/${total}\n`);
    }
  }
  await Promise.all(Array.from({ length: args.concurrency }, worker));

  const sortedEntries = Object.fromEntries(
    Object.keys(entries)
      .sort()
      .map((urlPath) => [urlPath, { source: sources[urlPath], ...entries[urlPath] }]),
  );
  const durationMs = Date.now() - startedAt;
  const counts = {};
  for (const { source } of Object.values(sortedEntries)) counts[source] = (counts[source] ?? 0) + 1;
  writeFileSync(
    path.join(args.out, "snapshot.json"),
    `${JSON.stringify(
      {
        baseUrl: args.baseUrl,
        origin,
        startedAt: new Date(startedAt).toISOString(),
        durationMs,
        counts,
        entries: sortedEntries,
      },
      null,
      2,
    )}\n`,
  );

  const countList = Object.entries(counts).map(([source, count]) => `${count} ${source}`);
  console.log(
    `Captured ${Object.keys(sortedEntries).length} URLs from ${origin} in ${(durationMs / 1000).toFixed(1)}s ` +
      `(${countList.join(", ")}).`,
  );
  console.log(`Snapshot: ${args.out}`);
  if (errors.length) {
    console.log(`${errors.length} requests failed:\n${errors.map((line) => `  ${line}`).join("\n")}`);
    process.exitCode = 1;
  }
}

function readSnapshot(dir) {
  const file = path.join(dir, "snapshot.json");
  if (!existsSync(file)) throw new Error(`${dir} has no snapshot.json`);
  return JSON.parse(readFileSync(file, "utf8"));
}

// Where a URL came from (sitemap, app route, probe) isn't part of what is
// served.
function entriesWithoutSource(entries) {
  return Object.fromEntries(
    Object.entries(entries).map(([urlPath, entry]) => {
      const served = { ...entry };
      delete served.source;
      return [urlPath, served];
    }),
  );
}

// The sitemap files, robots.txt and ads.txt byte for byte. Sitemaps carry the
// origin, so this only says something when both snapshots used the same one.
function compareRaw(dirA, dirB, a, b) {
  if (a.origin !== b.origin) return { compared: false };
  const names = new Set([...readdirSync(path.join(dirA, "raw")), ...readdirSync(path.join(dirB, "raw"))]);
  const different = [...names].sort().filter((name) => {
    const fileA = path.join(dirA, "raw", name);
    const fileB = path.join(dirB, "raw", name);
    return !existsSync(fileA) || !existsSync(fileB) || !readFileSync(fileA).equals(readFileSync(fileB));
  });
  return { compared: true, count: names.size, different: different.map(decodeURIComponent) };
}

function diff(args) {
  const [dirA, dirB] = args.dirs;
  const a = readSnapshot(dirA);
  const b = readSnapshot(dirB);
  const result = diffSnapshots(entriesWithoutSource(a.entries), entriesWithoutSource(b.entries));
  const raw = compareRaw(dirA, dirB, a, b);
  const countA = Object.keys(a.entries).length;
  const countB = Object.keys(b.entries).length;

  console.log(`A: ${dirA} (${countA} URLs from ${a.origin})`);
  console.log(`B: ${dirB} (${countB} URLs from ${b.origin})`);
  const list = (label, items) => {
    console.log(`${label}: ${items.length}`);
    for (const item of items) console.log(`  ${item}`);
  };
  list("Added", result.added);
  list("Removed", result.removed);
  list(
    "Changed",
    result.changed.map(({ path: urlPath, changes }) => `${urlPath}: ${changes.join("; ")}`),
  );
  if (raw.compared) {
    console.log(
      raw.different.length
        ? `Raw sitemap, robots.txt and ads.txt bytes differ: ${raw.different.join(", ")}`
        : `Raw sitemap, robots.txt and ads.txt bytes: identical (${raw.count} files)`,
    );
  } else {
    console.log("Raw sitemap, robots.txt and ads.txt bytes: not compared (different origins)");
  }

  // A failed request has no body file; its error is already listed.
  const bodyChanges = result.changed.filter(({ changes }) => changes.some((change) => change.startsWith("body")));
  for (const { path: urlPath } of bodyChanges.slice(0, args.maxDiffs)) {
    const name = bodyFileName(urlPath);
    console.log(
      `\n${unifiedDiff(
        readFileSync(path.join(dirA, "bodies", name), "utf8"),
        readFileSync(path.join(dirB, "bodies", name), "utf8"),
        { labelA: `a${urlPath}`, labelB: `b${urlPath}`, maxLines: args.maxLines },
      )}`,
    );
  }
  if (bodyChanges.length > args.maxDiffs) {
    console.log(`\n${bodyChanges.length - args.maxDiffs} more body diffs not shown (--max-diffs).`);
  }

  if (hasDifferences(result) || (raw.compared && raw.different.length)) {
    process.exitCode = 1;
  } else {
    console.log(`No differences across ${countA} URLs.`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.command === "snapshot") await snapshot(args);
else diff(args);
