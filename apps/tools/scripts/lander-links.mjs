// Counts the followed internal links that point at each downloader Lander on a
// running site (issue #349): every page in the sitemap tree is read, and each
// Lander is credited once per other page with a followed <a href> to it.
//
//   node scripts/lander-links.mjs --base-url http://localhost:8787 [--min 3] [--concurrency 8] [--show 10]
//
// A Lander is an active `download` Tool in this checkout's registry, at its
// canonical path. A link is followed unless its `rel` says `nofollow` or the
// page is `nofollow` (robots meta or X-Robots-Tag), so a local `cf:build`,
// which serves every page noindex, nofollow, credits nothing: count against
// `cf:build:production` or a deployed site. Links in scripts (the RSC payload)
// aren't read, as a crawler doesn't.
//
// --min exits 1 when a Lander has fewer followed links than that from other
// pages, or from other Landers.

import { activeTools, toolHref } from "../lib/catalog/catalog.ts";
import { sitemapLocPaths } from "./lib/render-snapshot.mjs";

// Deployed Workers skip their canonical-host redirect for requests with this
// header, so a preview Worker can be read on its own host.
const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
const SITEMAP_INDEX_PATH = "/sitemap-index.xml";
const REQUEST_TIMEOUT_MS = 60_000;
const USAGE =
  "Usage: lander-links.mjs --base-url <url> [--min <n>] [--concurrency <n>] [--show <n>]";

function parseArgs(argv) {
  const args = { baseUrl: "", min: 0, concurrency: 8, show: 10 };
  const number = (value, flag) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} needs a whole number\n${USAGE}`);
    return parsed;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--") continue;
    if (flag === "--base-url") args.baseUrl = argv[++i] ?? "";
    else if (flag === "--min") args.min = number(argv[++i], flag);
    else if (flag === "--concurrency") args.concurrency = Math.max(1, number(argv[++i], flag));
    else if (flag === "--show") args.show = number(argv[++i], flag);
    else throw new Error(`Unknown argument: ${flag}\n${USAGE}`);
  }
  if (!args.baseUrl) throw new Error(`--base-url is required\n${USAGE}`);
  return args;
}

const args = parseArgs(process.argv.slice(2));
const origin = new URL(args.baseUrl).origin;

async function get(pathname) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${origin}${pathname}`, {
        redirect: "manual",
        headers: { [SMOKE_TEST_HEADER]: "1" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return { status: response.status, headers: response.headers, body: await response.text() };
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

// The value of one attribute in a start tag, entities in it decoded.
function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  const value = match ? (match[1] ?? match[2] ?? match[3]) : undefined;
  return value?.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"');
}

// Whether a page tells crawlers not to follow its links.
function pageIsNofollow(headers, html) {
  if (/\bnofollow\b|\bnone\b/i.test(headers.get("x-robots-tag") ?? "")) return true;
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (/^(robots|googlebot)$/i.test(attribute(tag, "name") ?? "") && /\bnofollow\b|\bnone\b/i.test(attribute(tag, "content") ?? "")) {
      return true;
    }
  }
  return false;
}

// The paths on this site that a page's followed <a href> links point at.
function followedLinks(pagePath, html, internalOrigins) {
  const links = new Set();
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  for (const [tag] of markup.matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(tag, "href");
    if (!href || /\bnofollow\b/i.test(attribute(tag, "rel") ?? "")) continue;
    let url;
    try {
      url = new URL(href, `${origin}${pagePath}`);
    } catch {
      continue;
    }
    if (internalOrigins.has(url.origin)) links.add(url.pathname);
  }
  return links;
}

// The sitemap tree: its pages, and the origins its <loc>s name (the canonical
// origin on a production build), which count as this site in links.
const internalOrigins = new Set([origin]);
const pagePaths = new Set();
const problems = [];
const index = await get(SITEMAP_INDEX_PATH);
if (index.status !== 200) throw new Error(`${SITEMAP_INDEX_PATH} returned ${index.status}`);
for (const urlSetPath of sitemapLocPaths(index.body)) {
  const urlSet = await get(urlSetPath);
  if (urlSet.status !== 200) {
    problems.push(`${urlSetPath}: returned ${urlSet.status}`);
    continue;
  }
  for (const [, loc] of urlSet.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    internalOrigins.add(new URL(loc.replace(/&amp;/g, "&")).origin);
  }
  for (const pagePath of sitemapLocPaths(urlSet.body)) pagePaths.add(pagePath);
}
if (pagePaths.size === 0) throw new Error("The sitemap tree lists no pages");

const landers = activeTools()
  .filter((tool) => tool.operation === "download")
  .map(toolHref)
  .sort();
const isLander = new Set(landers);
const linkedFrom = new Map(landers.map((lander) => [lander, new Set()]));
let nofollowPages = 0;
let read = 0;

const queue = [...pagePaths];
async function worker() {
  for (let pagePath = queue.shift(); pagePath !== undefined; pagePath = queue.shift()) {
    try {
      const page = await get(pagePath);
      if (page.status !== 200) {
        problems.push(`${pagePath}: returned ${page.status}`);
        continue;
      }
      read += 1;
      if (pageIsNofollow(page.headers, page.body)) {
        nofollowPages += 1;
        continue;
      }
      for (const link of followedLinks(pagePath, page.body, internalOrigins)) {
        if (link !== pagePath) linkedFrom.get(link)?.add(pagePath);
      }
    } catch (error) {
      problems.push(`${pagePath}: ${error.name === "TimeoutError" ? "timed out" : error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: args.concurrency }, worker));

const counts = landers.map((lander) => {
  const sources = [...linkedFrom.get(lander)];
  return { lander, all: sources.length, fromLanders: sources.filter((source) => isLander.has(source)).length, sources };
});
const stats = (key) => {
  const values = counts.map((count) => count[key]).sort((a, b) => a - b);
  const median = values[Math.floor((values.length - 1) / 2)];
  return `min ${values[0]}, median ${median}, max ${values.at(-1)}`;
};
const below = (key, n) => counts.filter((count) => count[key] < n);
const threshold = Math.max(args.min, 3);
const missing = landers.filter((lander) => !pagePaths.has(lander));

console.log(`Read ${read} of ${pagePaths.size} sitemap pages at ${origin}; ${nofollowPages} of them are nofollow.`);
console.log(`Landers: ${landers.length} active download Tools; ${missing.length} not in the sitemap${missing.length ? ` (${missing.join(", ")})` : ""}.`);
console.log("Followed incoming links per Lander, counted once per linking page:");
console.log(`  from any other page: ${stats("all")}`);
console.log(`  from other Landers:  ${stats("fromLanders")}`);
console.log(`Landers with fewer than ${threshold}: ${below("all", threshold).length} from any page, ${below("fromLanders", threshold).length} from Landers.`);

// Which pages hold the links of the Landers with fewest.
const weak = below("all", threshold);
if (weak.length) {
  const holders = new Map();
  for (const { sources } of weak) for (const source of sources) holders.set(source, (holders.get(source) ?? 0) + 1);
  console.log(`Pages linking those ${weak.length} Landers (page: Landers it links):`);
  for (const [source, n] of [...holders].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, args.show)) {
    console.log(`  ${source}: ${n}`);
  }
}
const histogram = new Map();
for (const { all } of counts) histogram.set(all, (histogram.get(all) ?? 0) + 1);
console.log(
  `Landers by followed incoming links (links: Landers): ${[...histogram].sort((a, b) => a[0] - b[0]).slice(0, args.show).map(([n, landerCount]) => `${n}: ${landerCount}`).join(", ")}${histogram.size > args.show ? ", ..." : ""}`,
);
if (problems.length) {
  console.log(`Not read (${problems.length}):`);
  console.log(problems.sort().slice(0, args.show).map((problem) => `  ${problem}`).join("\n"));
}

if (args.min > 0 && (below("all", args.min).length || below("fromLanders", args.min).length)) process.exit(1);
