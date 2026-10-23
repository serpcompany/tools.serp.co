// Pure helpers for scripts/lander-links.mjs: arguments, the sitemap's origins,
// and which links a page gives crawlers to follow. The command does the I/O.

export const USAGE =
  "Usage: lander-links.mjs --base-url <url> [--min <n>] [--concurrency <n>] [--show <n>]";

export function parseArgs(argv) {
  const args = { baseUrl: "", min: 0, concurrency: 8, show: 10 };
  const number = (value, flag) => {
    const parsed = Number(value);
    if (value === undefined || !Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${flag} needs a whole number\n${USAGE}`);
    }
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
  args.baseUrl = new URL(args.baseUrl).origin;
  return args;
}

// The value of one attribute in a start tag, its entities decoded.
export function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  const value = match ? (match[1] ?? match[2] ?? match[3]) : undefined;
  return value
    ?.replace(/&#x2F;|&#47;/gi, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&amp;/g, "&");
}

const NOFOLLOW = /\bnofollow\b|\bnone\b/i;

// Whether a page tells crawlers not to follow its links: its X-Robots-Tag
// header or a robots (or googlebot) meta tag says nofollow or none.
export function pageIsNofollow(robotsHeader, html) {
  if (NOFOLLOW.test(robotsHeader ?? "")) return true;
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (/^(robots|googlebot)$/i.test(attribute(tag, "name") ?? "") && NOFOLLOW.test(attribute(tag, "content") ?? "")) {
      return true;
    }
  }
  return false;
}

// The paths on this site that a page's followed <a href> links point at,
// without query or fragment. Links in scripts (the RSC payload) are skipped,
// as a crawler skips them, and so are links with rel="nofollow" and links to
// other origins.
export function followedLinks(pageUrl, html, internalOrigins) {
  const links = new Set();
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  for (const [tag] of markup.matchAll(/<a\b[^>]*>/gi)) {
    const href = attribute(tag, "href");
    if (!href || /\bnofollow\b/i.test(attribute(tag, "rel") ?? "")) continue;
    let url;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (internalOrigins.has(url.origin)) links.add(url.pathname);
  }
  return links;
}

// The origins a sitemap's <loc>s name: the canonical origin on a production
// build, which counts as this site in absolute links.
export function sitemapLocOrigins(xml) {
  const origins = new Set();
  for (const [, loc] of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
    origins.add(new URL(loc.replace(/&amp;/g, "&")).origin);
  }
  return origins;
}
