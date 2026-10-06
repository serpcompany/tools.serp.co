// Crawls sample pages on a running Worker and checks every internal link they
// render: page links must end in a slash and return 200, so no link depends
// on a redirect or leads to a 404 (issue #168, serp url-trailing-slash
// standard).
//
//   node scripts/check-internal-links.mjs --base-url http://localhost:8787
//
// It visits the seed pages below (one per section layout) plus a spread of the
// pages the home page links to. Every link found must be slashed; at most
// MAX_STATUS_CHECKS distinct links (all seed-page links first) are fetched.

const SMOKE_TEST_HEADER = "x-tools-serp-smoke-test";
// Pages that render sections the home page doesn't reach.
const SEED_PATHS = [
  "/",
  "/png-to-jpg/",
  "/json-to-csv/",
  "/batch-compress-png/",
  "/audio-to-text/",
  "/download-loom-videos/",
  "/categories/",
];
const MAX_DEEP_PAGES = 20;
const MAX_STATUS_CHECKS = 400;
// Last path segment with a file extension: never slashed.
const FILE_PATTERN = /\/[^/]+\.[a-z0-9]+$/i;
// Paths that aren't pages.
const SKIP_PATTERN = /^\/(api|_next|cdn-cgi|internal)(\/|$)/;

function parseArgs(argv) {
  const args = { baseUrl: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base-url") args.baseUrl = argv[++i] ?? "";
    else if (argv[i] !== "--") throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.baseUrl) throw new Error("--base-url is required");
  args.baseUrl = args.baseUrl.replace(/\/$/, "");
  return args;
}

const args = parseArgs(process.argv.slice(2));
const origin = new URL(args.baseUrl).origin;

async function get(pathname) {
  return fetch(`${origin}${pathname}`, {
    redirect: "manual",
    headers: { [SMOKE_TEST_HEADER]: "1" },
  });
}

function internalLinks(html) {
  const links = new Set();
  for (const match of html.matchAll(/<a\s[^>]*href="([^"]+)"/gi)) {
    const href = match[1].replace(/&amp;/g, "&");
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const pathname = new URL(href, origin).pathname;
    if (!SKIP_PATTERN.test(pathname)) links.add(pathname);
  }
  return links;
}

const problems = [];
const pages = new Map(); // linked path -> first page that links to it
const visited = new Set();

async function visit(pathname) {
  if (visited.has(pathname)) return;
  visited.add(pathname);
  const response = await get(pathname);
  if (response.status !== 200) {
    problems.push(`${pathname}: seed page returned ${response.status}`);
    return;
  }
  for (const link of internalLinks(await response.text())) {
    if (!pages.has(link)) pages.set(link, pathname);
  }
}

for (const seed of SEED_PATHS) await visit(seed);
// One level deeper: an even spread of the home page's own links.
const fromHome = [...pages].filter(([link, from]) => from === "/" && !FILE_PATTERN.test(link));
const step = Math.max(1, Math.floor(fromHome.length / MAX_DEEP_PAGES));
for (let i = 0; i < fromHome.length; i += step) await visit(fromHome[i][0]);

const seedLinks = new Set([...pages].filter(([, from]) => SEED_PATHS.includes(from)).map(([link]) => link));
for (const [link, from] of pages) {
  if (!FILE_PATTERN.test(link) && !link.endsWith("/")) {
    problems.push(`${link} (on ${from}): page link without a trailing slash`);
  }
}
// Seed-page links first, then the rest, up to the cap.
const queue = [...pages]
  .filter(([link]) => FILE_PATTERN.test(link) || link.endsWith("/"))
  .sort(([a], [b]) => Number(seedLinks.has(b)) - Number(seedLinks.has(a)))
  .slice(0, MAX_STATUS_CHECKS);
const statusChecked = queue.length;
async function checkNext() {
  for (let entry = queue.shift(); entry; entry = queue.shift()) {
    const [link, from] = entry;
    const response = await get(link);
    await response.body?.cancel();
    if (response.status !== 200) {
      problems.push(`${link} (on ${from}): returned ${response.status}`);
    }
  }
}
await Promise.all(Array.from({ length: 8 }, checkNext));
problems.sort();

console.log(
  `Checked ${pages.size} internal links on ${visited.size} pages (${statusChecked} fetched).`,
);
if (problems.length) {
  console.log(problems.map((problem) => `  ${problem}`).join("\n"));
  process.exit(1);
}
