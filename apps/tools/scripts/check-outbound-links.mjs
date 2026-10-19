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
// documented exception below exactly. Every link is printed, failures first,
// and the exit code is 1 when any link fails.
//
// Options:
//   --user-agent <ua>  Request outbound URLs as another client, e.g. a
//                      crawler, to see answers that only crawlers get.
//   --failures-only    Print only the links that fail.

import { readFileSync } from "node:fs";

const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EXTRA_PATHS = ["/brands/"];
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 10;
const CONCURRENCY = 8;
const PER_HOST_CONCURRENCY = 2;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 10_000;

// Answers that are known and accepted, so they aren't failures. Each one
// matches a single URL, on one page, with this exact status chain and final
// URL; any other answer from that URL still fails.
const BRANDED_DOMAIN =
  "a branded domain the owner keeps on /brands/ as it is, redirect included (owner, 2026-10-19, #323)";
const EXCEPTIONS = [
  { url: "https://serp.best", page: "/brands/", hops: "301>200", finalUrl: "https://best.serp.co/", reason: BRANDED_DOMAIN },
  { url: "https://serp.games", page: "/brands/", hops: "301>200", finalUrl: "https://games.serp.co/", reason: BRANDED_DOMAIN },
  { url: "https://serp.media", page: "/brands/", hops: "301>200", finalUrl: "https://games.serp.co/", reason: BRANDED_DOMAIN },
  { url: "https://serp.wiki", page: "/brands/", hops: "301>200", finalUrl: "https://serp.co/", reason: BRANDED_DOMAIN },
  {
    url: "https://devinschumacher.com",
    page: "/brands/",
    hops: "403",
    finalUrl: "https://devinschumacher.com",
    reason: "answers 403 only to crawlers such as AhrefsBot; a browser gets the page (#323)",
  },
];

function parseArgs(argv) {
  const args = { baseUrl: "", userAgent: BROWSER_USER_AGENT, failuresOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base-url") args.baseUrl = argv[++i] ?? "";
    else if (argv[i] === "--user-agent") args.userAgent = argv[++i] ?? "";
    else if (argv[i] === "--failures-only") args.failuresOnly = true;
    else if (argv[i] !== "--") throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.baseUrl) throw new Error("--base-url is required");
  if (!args.userAgent) throw new Error("--user-agent needs a value");
  return args;
}

const args = parseArgs(process.argv.slice(2));
const origin = new URL(args.baseUrl).origin;
const siteHost = new URL(origin).host;

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

function decodeHref(href) {
  return href
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function outboundLinks(html) {
  const links = new Set();
  for (const match of html.matchAll(/<a\s[^>]*?href="([^"]+)"/gi)) {
    const href = decodeHref(match[1]);
    if (!/^https?:\/\//i.test(href) || !URL.canParse(href)) continue;
    if (new URL(href).host === siteHost) continue;
    links.add(href);
  }
  return links;
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
    for (const link of outboundLinks(await response.text())) {
      const pages = linkPages.get(link) ?? [];
      pages.push(pathname);
      linkPages.set(link, pages);
    }
  } catch (error) {
    pageProblems.push(`${pathname}: ${error.name === "TimeoutError" ? "timed out" : error.message}`);
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
  const first = hops[0] ?? 0;
  const pages = linkPages.get(url).sort();
  const exception = error
    ? undefined
    : EXCEPTIONS.find((candidate) => (
      candidate.url === url &&
      candidate.hops === hops.join(">") &&
      candidate.finalUrl === finalUrl &&
      pages.every((page) => page === candidate.page)
    ));
  results.push({
    url,
    hops,
    finalUrl,
    error,
    exception,
    failed: !exception && (Boolean(error) || first < 200 || first >= 300),
    pages,
  });
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
const failures = results.filter((result) => result.failed);
const known = results.filter((result) => result.exception);
const shown = args.failuresOnly ? failures : results;
if (shown.length) console.log(shown.map(describe).join("\n"));
if (pageProblems.length) {
  console.log(`\nPages not checked:\n${pageProblems.sort().map((problem) => `  ${problem}`).join("\n")}`);
}

const pagesWithFailures = new Set(failures.flatMap((result) => result.pages));
const byClass = {};
for (const result of failures) {
  const first = result.hops[0] ?? 0;
  const key = first ? `${String(first)[0]}XX` : "no answer";
  byClass[key] = (byClass[key] ?? 0) + 1;
}
console.log(
  `\nChecked ${results.length} outbound links on ${pagePaths.length - pageProblems.length} of ${pagePaths.length} pages (${landerPaths.length} Landers and ${EXTRA_PATHS.join(", ")}) at ${origin}.`,
);
console.log(
  failures.length
    ? `${failures.length} links fail (${Object.entries(byClass).map(([key, count]) => `${count} ${key}`).join(", ")}) on ${pagesWithFailures.size} pages.`
    : "0 links answer 3XX, 4XX or 5XX unexpectedly.",
);
if (known.length) console.log(`${known.length} documented exceptions answered as expected.`);
if (failures.length) process.exit(1);
