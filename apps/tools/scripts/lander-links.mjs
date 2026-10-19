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
// aren't read, as a crawler doesn't. The parsing is in lib/lander-links.mjs.
//
// Exit codes: 0 counted; 1 counted, and a Lander has fewer followed links than
// --min from other pages or from other Landers; 2 couldn't count (bad
// arguments, or no sitemap pages).

import { activeTools, toolHref } from "../lib/catalog/catalog.ts";
import { SMOKE_TEST_HEADER } from "../lib/site-environment.ts";
import { followedLinks, pageIsNofollow, parseArgs, sitemapLocOrigins } from "./lib/lander-links.mjs";
import { sitemapLocPaths } from "./lib/render-snapshot.mjs";

const SITEMAP_INDEX_PATH = "/sitemap-index.xml";
const REQUEST_TIMEOUT_MS = 60_000;

// One GET, retried once on a network error. The header lets a deployed
// preview Worker be read on its own host.
async function get(origin, pathname) {
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

// Each Lander's followed incoming links, and the pages that couldn't be read.
async function count(args) {
  const origin = args.baseUrl;
  const internalOrigins = new Set([origin]);
  const pagePaths = new Set();
  const problems = [];

  const index = await get(origin, SITEMAP_INDEX_PATH);
  if (index.status !== 200) throw new Error(`${SITEMAP_INDEX_PATH} returned ${index.status}`);
  for (const urlSetPath of sitemapLocPaths(index.body)) {
    const urlSet = await get(origin, urlSetPath);
    if (urlSet.status !== 200) {
      problems.push(`${urlSetPath}: returned ${urlSet.status}`);
      continue;
    }
    for (const sitemapOrigin of sitemapLocOrigins(urlSet.body)) internalOrigins.add(sitemapOrigin);
    for (const pagePath of sitemapLocPaths(urlSet.body)) pagePaths.add(pagePath);
  }
  if (pagePaths.size === 0) throw new Error("The sitemap tree lists no pages");

  const landers = activeTools()
    .filter((tool) => tool.operation === "download")
    .map(toolHref)
    .sort();
  const linkedFrom = new Map(landers.map((lander) => [lander, new Set()]));
  let nofollowPages = 0;
  let read = 0;

  const queue = [...pagePaths];
  async function worker() {
    for (let pagePath = queue.shift(); pagePath !== undefined; pagePath = queue.shift()) {
      try {
        const page = await get(origin, pagePath);
        if (page.status !== 200) {
          problems.push(`${pagePath}: returned ${page.status}`);
          continue;
        }
        read += 1;
        if (pageIsNofollow(page.headers.get("x-robots-tag"), page.body)) {
          nofollowPages += 1;
          continue;
        }
        for (const link of followedLinks(`${origin}${pagePath}`, page.body, internalOrigins)) {
          if (link !== pagePath) linkedFrom.get(link)?.add(pagePath);
        }
      } catch (error) {
        problems.push(`${pagePath}: ${error.name === "TimeoutError" ? "timed out" : error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: args.concurrency }, worker));

  const isLander = new Set(landers);
  const counts = landers.map((lander) => {
    const sources = [...linkedFrom.get(lander)];
    return { lander, all: sources.length, fromLanders: sources.filter((source) => isLander.has(source)).length, sources };
  });
  const missing = landers.filter((lander) => !pagePaths.has(lander));
  return { origin, pages: pagePaths.size, read, nofollowPages, counts, missing, problems };
}

function report(args, { origin, pages, read, nofollowPages, counts, missing, problems }) {
  const stats = (key) => {
    const values = counts.map((entry) => entry[key]).sort((a, b) => a - b);
    const median = values[Math.floor((values.length - 1) / 2)];
    return `min ${values[0]}, median ${median}, max ${values.at(-1)}`;
  };
  const below = (key, n) => counts.filter((entry) => entry[key] < n);
  const threshold = Math.max(args.min, 3);

  console.log(`Read ${read} of ${pages} sitemap pages at ${origin}; ${nofollowPages} of them are nofollow.`);
  console.log(`Landers: ${counts.length} active download Tools; ${missing.length} not in the sitemap${missing.length ? ` (${missing.join(", ")})` : ""}.`);
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
  const buckets = [...histogram].sort((a, b) => a[0] - b[0]);
  console.log(
    `Landers by followed incoming links (links: Landers): ${buckets.slice(0, args.show).map(([n, landerCount]) => `${n}: ${landerCount}`).join(", ")}${buckets.length > args.show ? ", ..." : ""}`,
  );
  if (problems.length) {
    console.log(`Not read (${problems.length}):`);
    console.log(problems.sort().slice(0, args.show).map((problem) => `  ${problem}`).join("\n"));
  }

  return args.min > 0 && (below("all", args.min).length > 0 || below("fromLanders", args.min).length > 0);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const short = report(args, await count(args));
  process.exitCode = short ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
