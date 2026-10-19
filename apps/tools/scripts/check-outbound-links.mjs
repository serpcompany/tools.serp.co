// Lists every outbound link on the active downloader Landers and /brands/
// with the status it answers, so no link leans on a redirect or points at a
// site that is down (issue #323).
//
//   node apps/tools/scripts/check-outbound-links.mjs --base-url https://tools.serp.co
//
// It reads the Lander routes from the Tool registry, fetches each page from
// --base-url, collects every link to another host, then requests each URL
// once and follows its redirects to the end. A link passes when its first
// answer is 2XX; it fails on 3XX, 4XX, 5XX or no answer, unless it matches a
// documented exception in lib/outbound-links.mjs exactly. Every link is
// printed, failures first. The exit code is 1 when any link fails or any page
// doesn't load (its links would go unchecked), and 2 for bad arguments.
//
// Options:
//   --user-agent <ua>  Request outbound URLs as another client. With a
//                      crawler's user agent (e.g. AhrefsBot) it shows the
//                      answers only crawlers get, and the crawler-only
//                      exceptions apply.
//   --failures-only    Print only the links that fail.

import { readFileSync } from "node:fs";

import { classify, isCrawlerUserAgent, outboundLinks, parseArgs, summarize } from "./lib/outbound-links.mjs";

const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
const EXTRA_PATHS = ["/brands/"];
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 10;
const CONCURRENCY = 8;
const PER_HOST_CONCURRENCY = 2;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 10_000;

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
const origin = args.baseUrl;
const siteHost = new URL(origin).host;
const crawler = isCrawlerUserAgent(args.userAgent);

const tools = JSON.parse(
  readFileSync(new URL("../lib/catalog/tools.json", import.meta.url), "utf8"),
);
const landerPaths = tools
  .filter((tool) => tool.isActive && tool.operation === "download")
  .map((tool) => `${tool.route.replace(/\/$/, "")}/`);
const pagePaths = [...new Set([...landerPaths, ...EXTRA_PATHS])].sort();

async function runQueue(items, task) {
  const queue = [...items];
  async function next() {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await task(item);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
}

const pageProblems = [];
const linkPages = new Map(); // outbound URL -> pages that link to it

await runQueue(pagePaths, async (pathname) => {
  try {
    const response = await fetch(`${origin}${pathname}`, {
      redirect: "manual",
      headers: { [SMOKE_TEST_HEADER]: "1" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      pageProblems.push(`${pathname}: page returned ${response.status}`);
      return;
    }
    for (const link of outboundLinks(await response.text(), siteHost)) {
      const pages = linkPages.get(link) ?? [];
      pages.push(pathname);
      linkPages.set(link, pages);
    }
  } catch (error) {
    const reason = error.name === "TimeoutError" ? "timed out" : (error.cause?.code ?? error.message);
    pageProblems.push(`${pathname}: ${reason}`);
  }
});

// serp.ly answers 429 to parallel bursts, so each host gets a few requests
// at a time.
const hostRequests = new Map();
async function request(url) {
  const { host } = new URL(url);
  while ((hostRequests.get(host) ?? 0) >= PER_HOST_CONCURRENCY) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  hostRequests.set(host, (hostRequests.get(host) ?? 0) + 1);
  try {
    return await requestOnce(url);
  } finally {
    hostRequests.set(host, hostRequests.get(host) - 1);
  }
}

async function requestOnce(url) {
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      "user-agent": args.userAgent,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel();
  return response;
}

// One answer per hop until a non-redirect, e.g. [301, 200].
async function trace(url) {
  const hops = [];
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await request(current);
    hops.push(response.status);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return { hops, finalUrl: current };
    }
    current = new URL(location, current).toString();
  }
  return { hops, finalUrl: current, error: "too many redirects" };
}

async function check(url) {
  let result;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      result = await trace(url);
    } catch (error) {
      // e.g. ENOTFOUND for a host with no DNS record.
      const reason = error.name === "TimeoutError" ? "timed out" : (error.cause?.code ?? error.message);
      result = { hops: [], finalUrl: url, error: reason };
    }
    const first = result.hops[0] ?? 0;
    // A busy host can rate-limit or fail once; wait and ask again before
    // reporting it.
    if (attempt === MAX_ATTEMPTS || !(first === 0 || first === 429 || first >= 500)) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
  }
  return result;
}

const results = [];
await runQueue([...linkPages.keys()], async (url) => {
  const { hops, finalUrl, error } = await check(url);
  results.push(classify({ url, hops, finalUrl, error, pages: linkPages.get(url).sort() }, { crawler }));
});

function describe(result) {
  const status = result.error ? `${result.hops.join(">") || "---"} (${result.error})` : result.hops.join(">");
  const target = result.finalUrl === result.url ? "" : ` -> ${result.finalUrl}`;
  const pages = result.pages.length === 1
    ? result.pages[0]
    : `${result.pages.length} pages, e.g. ${result.pages[0]}`;
  const label = result.failed ? "FAIL" : result.exception ? "known" : "ok";
  const reason = result.exception ? `  (${result.exception.reason})` : "";
  return `${label.padEnd(5)} ${status.padEnd(8)} ${result.url}${target}  [${pages}]${reason}`;
}

results.sort((a, b) => (
  Number(b.failed) - Number(a.failed) ||
  Number(Boolean(b.exception)) - Number(Boolean(a.exception)) ||
  a.url.localeCompare(b.url)
));
const shown = args.failuresOnly ? results.filter((result) => result.failed) : results;
if (shown.length) console.log(shown.map(describe).join("\n"));
if (pageProblems.length) {
  console.log(`\nPages that didn't load:\n${pageProblems.sort().map((problem) => `  FAIL  ${problem}`).join("\n")}`);
}

const { lines, exitCode } = summarize({
  results,
  pageProblems,
  pageCount: pagePaths.length,
  scope: `${landerPaths.length} Landers and ${EXTRA_PATHS.join(", ")} at ${origin}${crawler ? ", as a crawler" : ""}`,
});
console.log(`\n${lines.join("\n")}`);
process.exitCode = exitCode;
