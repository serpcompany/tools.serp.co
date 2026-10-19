import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  attribute,
  followedLinks,
  pageIsNofollow,
  parseArgs,
  sitemapLocOrigins,
} from "../scripts/lib/lander-links.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/lander-links.mjs", import.meta.url));

test("parseArgs reads the flags, keeps the base URL's origin and refuses what it can't use", () => {
  assert.deepEqual(parseArgs(["--base-url", "http://localhost:8787/x"]), {
    baseUrl: "http://localhost:8787",
    min: 0,
    concurrency: 8,
    show: 10,
  });
  assert.deepEqual(
    parseArgs(["--", "--base-url", "https://tools.serp.co", "--min", "3", "--concurrency", "0", "--show", "5"]),
    { baseUrl: "https://tools.serp.co", min: 3, concurrency: 1, show: 5 },
  );
  assert.throws(() => parseArgs([]), /--base-url is required/);
  assert.throws(() => parseArgs(["--base-url", "x", "--min", "two"]), /--min needs a whole number/);
  assert.throws(() => parseArgs(["--base-url", "x", "--min"]), /--min needs a whole number/);
  assert.throws(() => parseArgs(["--base-url", "http://a", "--max", "3"]), /Unknown argument: --max/);
});

test("attribute reads double-quoted, single-quoted and bare values, and decodes entities once", () => {
  assert.equal(attribute('<a class="x" href="/a/?b=1&amp;c=2">', "href"), "/a/?b=1&c=2");
  assert.equal(attribute("<a href='/b/'>", "href"), "/b/");
  assert.equal(attribute("<a href=/c/ rel=nofollow>", "rel"), "nofollow");
  assert.equal(attribute('<a data-href="/d/">', "href"), undefined);
  assert.equal(attribute('<a title="&amp;quot;">', "title"), "&quot;");
  assert.equal(attribute('<a href="&#x2F;e&#x2F;">', "href"), "/e/");
});

test("a page is nofollow by its X-Robots-Tag or a robots or googlebot meta tag", () => {
  const page = (meta) => `<html><head>${meta}</head><body><a href="/x/">x</a></body></html>`;

  assert.equal(pageIsNofollow(null, page('<meta name="robots" content="index, follow">')), false);
  assert.equal(pageIsNofollow("noindex, nofollow", page("")), true);
  assert.equal(pageIsNofollow("none", page("")), true);
  assert.equal(pageIsNofollow(undefined, page('<meta name="robots" content="noindex, nofollow"/>')), true);
  assert.equal(pageIsNofollow(undefined, page('<meta content="nofollow" name="googlebot">')), true);
  assert.equal(pageIsNofollow(undefined, page('<meta name="description" content="none of these">')), false);
});

test("followedLinks keeps this site's followed links as paths and skips the rest", () => {
  const html = `
    <a href="/download-a-videos/">A</a>
    <a class="card" href="https://tools.serp.co/download-b-videos/?ref=x#top">B</a>
    <a href="/download-c-videos/" rel="nofollow">C</a>
    <a href="/download-d-videos/" rel="noopener noreferrer">D</a>
    <a href="https://example.com/download-e-videos/">E</a>
    <a href='relative/'>F</a>
    <a href="http://[">broken</a>
    <a name="anchor">no href</a>
    <script>self.__next_f.push([1,"<a href=\\"/download-g-videos/\\">"])</script>
    <A HREF="/download-h-videos/">H</A>`;
  const links = followedLinks("http://localhost:8822/page/", html, new Set(["http://localhost:8822", "https://tools.serp.co"]));

  assert.deepEqual([...links].sort(), [
    "/download-a-videos/",
    "/download-b-videos/",
    "/download-d-videos/",
    "/download-h-videos/",
    "/page/relative/",
  ]);
});

test("sitemapLocOrigins names each origin the sitemap's <loc>s use", () => {
  const xml = `<urlset><url><loc>https://tools.serp.co/</loc></url><url><loc> https://tools.serp.co/a/?x=1&amp;y=2 </loc></url><url><loc>http://localhost:8787/b/</loc></url></urlset>`;
  assert.deepEqual([...sitemapLocOrigins(xml)].sort(), ["http://localhost:8787", "https://tools.serp.co"]);
});

// Runs the script against a tiny site and returns its exit code and output.
async function runAgainst(routes, extraArgs = []) {
  const server = createServer((request, response) => {
    const body = routes[request.url];
    response.writeHead(body === undefined ? 404 : 200, { "content-type": "text/html" });
    response.end(body ?? "not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, "--base-url", base, ...extraArgs], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.on("close", (code) => resolve({ code, output }));
    });
  } finally {
    server.close();
  }
}

test("the script exits 2 when it can't count and 1 when a Lander is below --min", async () => {
  const noArgs = await new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stderr }));
  });
  assert.equal(noArgs.code, 2);
  assert.match(noArgs.stderr, /--base-url is required/);

  const noSitemap = await runAgainst({});
  assert.equal(noSitemap.code, 2, noSitemap.output);
  assert.match(noSitemap.output, /sitemap-index\.xml returned 404/);

  const site = {
    "/sitemap-index.xml": "<sitemapindex><sitemap><loc>https://tools.serp.co/sitemap-pages.xml</loc></sitemap></sitemapindex>",
    "/sitemap-pages.xml": "<urlset><url><loc>https://tools.serp.co/</loc></url></urlset>",
    "/": '<a href="/download-vimeo-videos/">Vimeo</a>',
  };
  const short = await runAgainst(site, ["--min", "1"]);
  assert.equal(short.code, 1, short.output);
  assert.match(short.output, /Read 1 of 1 sitemap pages/);
  assert.match(short.output, /from any other page: min 0, median 0, max 1/);

  const counted = await runAgainst(site);
  assert.equal(counted.code, 0, counted.output);
});
