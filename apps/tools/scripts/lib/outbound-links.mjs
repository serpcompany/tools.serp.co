// Pure helpers for scripts/check-outbound-links.mjs: arguments, which links a
// page gives to other hosts, the documented exceptions, and the verdict. The
// command does the I/O.

export const USAGE =
  "Usage: check-outbound-links.mjs --base-url <url> [--user-agent <ua>] [--failures-only]";

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

// Answers that are known and accepted, so they aren't failures. Each one
// matches a single URL, on one page, with this exact status chain and final
// URL; any other answer from that URL still fails. A crawlerOnly exception
// applies only to a run with a crawler's user agent: a browser must get 2XX.
const BRANDED_DOMAIN =
  "a branded domain the owner keeps on /brands/ as it is, redirect included (owner, 2026-10-19, #323)";
export const EXCEPTIONS = [
  { url: "https://serp.best", page: "/brands/", hops: "301>200", finalUrl: "https://best.serp.co/", reason: BRANDED_DOMAIN },
  { url: "https://serp.games", page: "/brands/", hops: "301>200", finalUrl: "https://games.serp.co/", reason: BRANDED_DOMAIN },
  { url: "https://serp.media", page: "/brands/", hops: "301>200", finalUrl: "https://games.serp.co/", reason: BRANDED_DOMAIN },
  { url: "https://serp.wiki", page: "/brands/", hops: "301>200", finalUrl: "https://serp.co/", reason: BRANDED_DOMAIN },
  {
    url: "https://devinschumacher.com",
    page: "/brands/",
    hops: "403",
    finalUrl: "https://devinschumacher.com",
    crawlerOnly: true,
    reason: "answers 403 only to crawlers such as AhrefsBot; a browser gets the page (#323)",
  },
];

export function parseArgs(argv) {
  const args = { baseUrl: "", userAgent: BROWSER_USER_AGENT, failuresOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--") continue;
    if (flag === "--base-url") args.baseUrl = argv[++i] ?? "";
    else if (flag === "--user-agent") args.userAgent = argv[++i] ?? "";
    else if (flag === "--failures-only") args.failuresOnly = true;
    else throw new Error(`Unknown argument: ${flag}\n${USAGE}`);
  }
  if (!args.baseUrl) throw new Error(`--base-url is required\n${USAGE}`);
  if (!args.userAgent) throw new Error(`--user-agent needs a value\n${USAGE}`);
  args.baseUrl = new URL(args.baseUrl).origin;
  return args;
}

export function isCrawlerUserAgent(userAgent) {
  return /bot|crawl|spider|slurp/i.test(userAgent);
}

function decodeHref(href) {
  return href
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

// Every absolute http(s) link in the page's <a href>s to a host other than
// siteHost.
export function outboundLinks(html, siteHost) {
  const links = new Set();
  for (const match of html.matchAll(/<a\s[^>]*?href="([^"]+)"/gi)) {
    const href = decodeHref(match[1]);
    if (!/^https?:\/\//i.test(href) || !URL.canParse(href)) continue;
    if (new URL(href).host === siteHost) continue;
    links.add(href);
  }
  return links;
}

// The documented exception a traced link matches, if any.
export function findException({ url, hops, finalUrl, error, pages }, { crawler }) {
  if (error) return undefined;
  return EXCEPTIONS.find((candidate) => (
    candidate.url === url &&
    candidate.hops === hops.join(">") &&
    candidate.finalUrl === finalUrl &&
    pages.every((page) => page === candidate.page) &&
    (!candidate.crawlerOnly || crawler)
  ));
}

// A link passes when its first answer is 2XX or it matches an exception.
export function classify(link, options) {
  const first = link.hops[0] ?? 0;
  const exception = findException(link, options);
  const failed = !exception && (Boolean(link.error) || first < 200 || first >= 300);
  return { ...link, exception, failed };
}

// The closing lines and exit code. A page that didn't load fails the run, as
// its links went unchecked.
export function summarize({ results, pageProblems, pageCount, scope }) {
  const failures = results.filter((result) => result.failed);
  const known = results.filter((result) => result.exception);
  const byClass = {};
  for (const result of failures) {
    const first = result.hops[0] ?? 0;
    const key = first ? `${String(first)[0]}XX` : "no answer";
    byClass[key] = (byClass[key] ?? 0) + 1;
  }
  const pagesWithFailures = new Set(failures.flatMap((result) => result.pages));
  const lines = [
    `Checked ${results.length} outbound links on ${pageCount - pageProblems.length} of ${pageCount} pages (${scope}).`,
  ];
  if (pageProblems.length) {
    const pages = pageProblems.length === 1 ? "page didn't load, so its links weren't" : "pages didn't load, so their links weren't";
    lines.push(`${pageProblems.length} ${pages} checked.`);
  }
  if (failures.length) {
    const classes = Object.entries(byClass).map(([key, count]) => `${count} ${key}`).join(", ");
    lines.push(`${failures.length} links fail (${classes}) on ${pagesWithFailures.size} pages.`);
  } else if (!pageProblems.length) {
    lines.push("0 links answer 3XX, 4XX or 5XX unexpectedly.");
  }
  if (known.length) lines.push(`${known.length} documented exceptions answered as expected.`);
  return { lines, exitCode: failures.length || pageProblems.length ? 1 : 0 };
}
