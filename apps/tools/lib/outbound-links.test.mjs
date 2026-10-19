import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  BROWSER_USER_AGENT,
  classify,
  isCrawlerUserAgent,
  outboundLinks,
  parseArgs,
  summarize,
} from "../scripts/lib/outbound-links.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/check-outbound-links.mjs", import.meta.url));
const AHREFS_BOT = "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)";

test("parseArgs keeps the base URL's origin, defaults to a browser and refuses what it can't use", () => {
  assert.deepEqual(parseArgs(["--base-url", "https://tools.serp.co/x"]), {
    baseUrl: "https://tools.serp.co",
    userAgent: BROWSER_USER_AGENT,
    failuresOnly: false,
  });
  assert.equal(parseArgs(["--base-url", "http://localhost:8823", "--user-agent", AHREFS_BOT]).userAgent, AHREFS_BOT);
  assert.equal(parseArgs(["--", "--base-url", "http://localhost:8823", "--failures-only"]).failuresOnly, true);
  assert.throws(() => parseArgs([]), /--base-url is required/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:8823", "--user-agent"]), /--user-agent needs a value/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:8823", "--nope"]), /Unknown argument: --nope/);
});

test("a crawler is told apart from a browser by its user agent", () => {
  assert.equal(isCrawlerUserAgent(AHREFS_BOT), true);
  assert.equal(isCrawlerUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  assert.equal(isCrawlerUserAgent(BROWSER_USER_AGENT), false);
});

test("outboundLinks keeps absolute links to other hosts, decoded", () => {
  const html = [
    '<a href="https://serp.ly/x?a=1&amp;via=tools.serp.co">x</a>',
    '<a class="c" href="https://tools.serp.co/png-to-jpg/">same host</a>',
    '<a href="/brands/">relative</a>',
    '<a href="mailto:hi@serp.co">mail</a>',
    '<link href="https://fonts.example/a.css">',
    '<a href="http://www.example.com">bare</a>',
  ].join("");
  assert.deepEqual([...outboundLinks(html, "tools.serp.co")], [
    "https://serp.ly/x?a=1&via=tools.serp.co",
    "http://www.example.com",
  ]);
});

test("a link passes on 2XX and fails on a redirect, 4XX, 5XX or no answer", () => {
  const link = (hops, extra = {}) => ({ url: "https://example.com/a", hops, finalUrl: "https://example.com/a", pages: ["/download-x-videos/"], ...extra });
  assert.equal(classify(link([200]), { crawler: false }).failed, false);
  assert.equal(classify(link([308, 200], { finalUrl: "https://example.com/b" }), { crawler: false }).failed, true);
  assert.equal(classify(link([404]), { crawler: false }).failed, true);
  assert.equal(classify(link([503]), { crawler: false }).failed, true);
  assert.equal(classify(link([], { error: "ENOTFOUND" }), { crawler: false }).failed, true);
});

test("a branded-domain redirect on /brands/ is a documented exception only with its exact answer", () => {
  const serpBest = { url: "https://serp.best", hops: [301, 200], finalUrl: "https://best.serp.co/", pages: ["/brands/"] };
  for (const crawler of [false, true]) {
    const result = classify(serpBest, { crawler });
    assert.equal(result.failed, false);
    assert.match(result.exception.reason, /branded domain/);
  }
  assert.equal(classify({ ...serpBest, finalUrl: "https://example.com/" }, { crawler: false }).failed, true);
  assert.equal(classify({ ...serpBest, hops: [301, 404] }, { crawler: false }).failed, true);
  assert.equal(classify({ ...serpBest, pages: ["/brands/", "/download-x-videos/"] }, { crawler: false }).failed, true);
});

test("a crawler-only 403 is an exception for a crawler's run and a failure for a browser's", () => {
  const devin = { url: "https://devinschumacher.com", hops: [403], finalUrl: "https://devinschumacher.com", pages: ["/brands/"] };
  const asBrowser = classify(devin, { crawler: false });
  assert.equal(asBrowser.failed, true);
  assert.equal(asBrowser.exception, undefined);
  const asCrawler = classify(devin, { crawler: true });
  assert.equal(asCrawler.failed, false);
  assert.match(asCrawler.exception.reason, /only to crawlers/);
});

test("summarize fails the run when a page didn't load, even with no failing link", () => {
  const ok = { url: "https://example.com", hops: [200], finalUrl: "https://example.com", pages: ["/brands/"], failed: false };
  const clean = summarize({ results: [ok], pageProblems: [], pageCount: 2, scope: "test" });
  assert.equal(clean.exitCode, 0);
  assert.match(clean.lines.join("\n"), /0 links answer 3XX, 4XX or 5XX unexpectedly/);

  const pageDown = summarize({ results: [ok], pageProblems: ["/download-x-videos/: page returned 451"], pageCount: 2, scope: "test" });
  assert.equal(pageDown.exitCode, 1);
  assert.match(pageDown.lines.join("\n"), /on 1 of 2 pages/);
  assert.match(pageDown.lines.join("\n"), /1 page didn't load/);
  assert.doesNotMatch(pageDown.lines.join("\n"), /0 links answer/);
});

function run(baseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, "--base-url", baseUrl, "--failures-only"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

// Every page links one outbound URL on another host name; `brandsStatus`
// is what /brands/ answers.
async function withSite(brandsStatus, callback) {
  const server = createServer((request, response) => {
    if (request.url === "/target") {
      response.writeHead(200).end("ok");
      return;
    }
    if (request.url === "/brands/" && brandsStatus !== 200) {
      response.writeHead(brandsStatus).end();
      return;
    }
    const { port } = server.address();
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<a href="http://localhost:${port}/target">target</a>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test("the script exits 0 when every page loads and every link answers 2XX", async () => {
  const { code, output } = await withSite(200, run);
  assert.equal(code, 0, output);
  assert.match(output, /Checked 1 outbound links on (\d+) of \1 pages/);
  assert.match(output, /0 links answer 3XX, 4XX or 5XX unexpectedly/);
});

test("the script exits 1 and lists the page when a page doesn't load", async () => {
  const { code, output } = await withSite(451, run);
  assert.equal(code, 1, output);
  assert.match(output, /FAIL {2}\/brands\/: page returned 451/);
  assert.match(output, /1 page didn't load, so its links weren't checked/);
  assert.doesNotMatch(output, /0 links answer/);
});

test("the script exits 1 when no page loads at all", async () => {
  const closed = createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address();
  await new Promise((resolve) => closed.close(resolve));
  const { code, output } = await run(`http://127.0.0.1:${port}`);
  assert.equal(code, 1, output);
  assert.match(output, /Checked 0 outbound links on 0 of (\d+) pages/);
  assert.match(output, /pages didn't load, so their links weren't checked/);
  assert.doesNotMatch(output, /0 links answer/);
});
