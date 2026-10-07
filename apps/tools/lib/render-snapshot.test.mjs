import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  compareEntries,
  describeResponse,
  diffSnapshots,
  hasDifferences,
  normalizeAssetName,
  normalizeBody,
  sitemapLocPaths,
  splitFlightData,
  staticPageRoutes,
  unifiedDiff,
} from "../scripts/lib/render-snapshot.mjs";

const origin = "http://localhost:8787";

// The same page as two builds serve it: hashes, chunk ids, the number of
// shared chunks, module ids and the build id all differ.
function renderPage({ build, title = "PNG to JPG" }) {
  const chunks = build.sharedChunks
    .map((chunk) => `<script src="/_next/static/chunks/${chunk}" async=""></script>`)
    .join("");
  const flightChunks = build.sharedChunks
    .map((chunk) => `\\"${chunk.split("-")[0]}\\",\\"static/chunks/${chunk}\\"`)
    .join(",");
  return [
    "<!DOCTYPE html><html><head>",
    `<link rel="stylesheet" href="/_next/static/css/${build.cssHash}.css" data-precedence="next"/>`,
    `<link rel="preload" as="script" href="/_next/static/chunks/webpack-${build.hash}.js"/>`,
    chunks,
    `<script src="/_next/static/chunks/app/(convert)/png-to-jpg/page-${build.hash}.js?dpl=${build.dpl}" async=""></script>`,
    `<title>${title} | SERP Tools</title>`,
    '<link rel="canonical" href="https://tools.serp.co/png-to-jpg/"/>',
    `<script nonce="${build.nonce}">window.x=1</script>`,
    "</head><body>",
    `<h1>${title}</h1><a href="/png-to-jpg/">PNG to JPG</a>`,
    `<script>self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"${build.id}\\",\\"p\\":\\"\\"}\\n"])</script>`,
    `<script>self.__next_f.push([1,"2:I[${build.moduleId},[${flightChunks}],\\"AppHeader\\"]\\n:HL[\\"/_next/static/css/${build.cssHash}.css\\",\\"style\\"]\\n3:[\\"$\\",\\"link\\",\\"0\\",{\\"nonce\\":\\"${build.nonce}\\"}]\\n"])</script>`,
    "</body></html>",
  ].join("");
}

const buildA = {
  id: "DT1aTJuZhS6g_yw2hTivW",
  hash: "b0619cf79db4805d",
  cssHash: "0af1c51d0cc190ba",
  sharedChunks: ["2089-318971f7172762a7.js", "67e8e8be-9d94273b155755f5.js"],
  moduleId: 75039,
  dpl: "dpl_abc123",
  nonce: "bm9uY2UtYQ==",
};
const buildB = {
  id: "Xq9fLm2Pz8RtYu1Wv3Nk0",
  hash: "f6b6e8894064178b",
  cssHash: "1d2c3b4a59687706",
  sharedChunks: ["2090-5766bd6ea71a1713.js", "8547-69cb364c3a7f0faf.js", "9505-d3b0ac8e953e0d32.js"],
  moduleId: 19709,
  dpl: "dpl_def456",
  nonce: "bm9uY2UtYg==",
};

test("two builds of the same page normalize to the same body", () => {
  const a = normalizeBody(renderPage({ build: buildA }), { origin });
  const b = normalizeBody(renderPage({ build: buildB }), { origin });
  assert.equal(a, b);
  assert.doesNotMatch(a, /DT1aTJuZhS6g_yw2hTivW|b0619cf79db4805d|0af1c51d0cc190ba|75039|dpl_abc123|bm9uY2UtYQ==/);
  assert.match(a, /\/_next\/static\/chunks\/app\/\(convert\)\/png-to-jpg\/page-\[hash\]\.js\?dpl=\[dpl\]/);
  assert.match(a, /\\"b\\":\\"\[build-id\]\\"/);
  assert.match(a, /2:I\[\[module\],\[chunks\]\],\\"AppHeader\\"\]/);
  assert.equal(a.match(/chunks\/\[chunk\]\.js/g).length, 1, "a run of shared chunks becomes one tag");
});

test("the build id is normalized when the root flight row starts mid-chunk", () => {
  const flight = (id) =>
    `<script>self.__next_f.push([1,":HL[\\"/x.css\\",\\"style\\"]\\n0:{\\"P\\":null,\\"b\\":\\"${id}\\",\\"p\\":\\"\\"}\\n"])</script>`;
  assert.equal(
    normalizeBody(flight(buildA.id), { origin }),
    normalizeBody(flight(buildB.id), { origin }),
  );
});

test("flight text is compared regardless of where React split it", () => {
  const push = (chunk) => `<script>self.__next_f.push([1,"${chunk}"])</script>`;
  const row = '18:I[123,[\\"806\\",\\"static/chunks/806-0123456789abcdef.js\\"],\\"FAQSection\\"]\\n';
  const a = `<p>a</p>${push(row.slice(0, 6))}<p>b</p>${push(row.slice(6))}`;
  const b = `<p>a</p>${push(row.replace("806", "1055").replace("806", "1055"))}<p>b</p>`;
  assert.equal(normalizeBody(a, { origin }), normalizeBody(b, { origin }));
  assert.equal(
    normalizeBody(a, { origin }),
    `<p>a</p>${push('18:I[[module],[chunks]],\\"FAQSection\\"]\\n')}<p>b</p>`,
  );
});

test("a change in text, links or metadata survives normalization", () => {
  const before = normalizeBody(renderPage({ build: buildA }), { origin });
  const after = normalizeBody(renderPage({ build: buildB, title: "PNG to JPEG" }), { origin });
  assert.notEqual(before, after);
});

test("normalization leaves text, links, canonicals, meta tags and JSON-LD alone", () => {
  const page = [
    "<html><head>",
    '<link rel="canonical" href="https://tools.serp.co/png-to-jpg/"/>',
    '<meta name="description" content="Build 0af1c51d0cc190ba of the download page"/>',
    '<script type="application/ld+json">{"@type":"WebPage","dateModified":"2026-01-01T00:00:00Z",',
    '"image":"https://cdn.example.com/static/media/logo-0123456789abcdef0.png","b":"download-videos"}</script>',
    "</head><body>",
    '<a href="/png-to-jpg/">PNG to JPG</a><a href="https://tools.serp.co/static/chunks/">x</a>',
    "<p>Copyright 2026. Chunk 2089-318971f7172762a7 is just text.</p>",
    "</body></html>",
  ].join("");
  assert.equal(normalizeBody(page, { origin }), page);
});

test("the served origin is normalized wherever a page writes it", () => {
  const xml = `<urlset><url><loc>${origin}</loc></url><url><loc>${origin}/png-to-jpg/</loc></url></urlset>`;
  assert.equal(
    normalizeBody(xml, { origin }),
    "<urlset><url><loc>[origin]</loc></url><url><loc>[origin]/png-to-jpg/</loc></url></urlset>",
  );
  assert.equal(
    normalizeBody(`<a href="/share?u=${encodeURIComponent(`${origin}/x/`)}">`, { origin }),
    '<a href="/share?u=%5Borigin%5D%2Fx%2F">',
  );
  // Another origin, such as the canonical host, is content.
  assert.equal(normalizeBody("https://tools.serp.co/", { origin }), "https://tools.serp.co/");
});

test("an unset nonce stays visible", () => {
  const flight = '[\\"$\\",\\"link\\",\\"0\\",{\\"nonce\\":\\"$undefined\\"}]';
  assert.equal(normalizeBody(flight, { origin }), flight);
});

test("hashed asset names lose their hash and chunk id but keep their name", () => {
  assert.equal(normalizeAssetName("page-b0619cf79db4805d.js"), "page-[hash].js");
  assert.equal(normalizeAssetName("main-app-5766bd6ea71a1713.js"), "main-app-[hash].js");
  assert.equal(normalizeAssetName("2089-318971f7172762a7.js"), "[chunk].js");
  assert.equal(normalizeAssetName("67e8e8be-9d94273b155755f5.js"), "[chunk].js");
  assert.equal(normalizeAssetName("0af1c51d0cc190ba.css"), "[hash].css");
});

test("flight data is split from the document", () => {
  const html = '<p>a</p><script>self.__next_f.push([1,"x"])</script><p>b</p>';
  assert.deepEqual(splitFlightData(html), {
    document: "<p>a</p><p>b</p>",
    flight: '<script>self.__next_f.push([1,"x"])</script>',
  });
});

test("a response records status, chosen headers and a normalized body", () => {
  const headers = new Headers({
    location: `${origin}/sitemap-index.xml`,
    "content-type": "application/xml; charset=utf-8",
    "x-robots-tag": "noindex, nofollow",
    date: "Wed, 07 Oct 2026 21:00:00 GMT",
  });
  const { entry, normalizedBody } = describeResponse({
    status: 308,
    headers,
    body: Buffer.from(`<loc>${origin}/</loc>`),
    origin,
  });
  assert.equal(entry.status, 308);
  assert.deepEqual(entry.headers, {
    location: "[origin]/sitemap-index.xml",
    "content-type": "application/xml; charset=utf-8",
    "x-robots-tag": "noindex, nofollow",
    "cross-origin-opener-policy": null,
    "cross-origin-embedder-policy": null,
  });
  assert.equal(normalizedBody, "<loc>[origin]/</loc>");
  assert.equal(typeof entry.bodySha256, "string");

  const image = describeResponse({
    status: 200,
    headers: new Headers({ "content-type": "image/png" }),
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    origin,
  });
  assert.equal(image.entry.documentSha256, undefined);
  assert.ok(Buffer.isBuffer(image.normalizedBody));
});

test("sitemap locs become paths", () => {
  const xml = `<sitemapindex><sitemap><loc>${origin}/sitemap-tools.xml</loc></sitemap></sitemapindex>
<urlset><url><loc>${origin}</loc></url><url><loc> ${origin}/a/?q=1&amp;r=2 </loc></url></urlset>`;
  assert.deepEqual(sitemapLocPaths(xml), ["/sitemap-tools.xml", "/", "/a/?q=1&r=2"]);
});

test("static page routes skip groups, dynamic, private, api and internal segments", (t) => {
  const appDir = mkdtempSync(path.join(tmpdir(), "render-snapshot-app-"));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));
  for (const file of [
    "page.tsx",
    "brands/page.tsx",
    "(convert)/png-to-jpg/page.tsx",
    "(convert)/[tool]/page.tsx",
    "(compress)/(batch)/batch-compress-png/page.tsx",
    "category/[categoryName]/page.tsx",
    "internal/tools/page.tsx",
    "api/telemetry/route.ts",
    "robots.txt/route.ts",
    "_components/page.tsx",
    "@modal/page.tsx",
    "docs/layout.tsx",
  ]) {
    const filePath = path.join(appDir, file);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "");
  }
  assert.deepEqual(staticPageRoutes(appDir), [
    "/",
    "/batch-compress-png/",
    "/brands/",
    "/png-to-jpg/",
  ]);
});

const entry = (overrides = {}) => ({
  status: 200,
  headers: { location: null, "content-type": "text/html", "x-robots-tag": null },
  bodySha256: "body",
  documentSha256: "document",
  flightSha256: "flight",
  ...overrides,
});

test("diff lists added, removed and changed URLs", () => {
  const result = diffSnapshots(
    { "/a/": entry(), "/b/": entry(), "/c/": entry(), "/same/": entry() },
    {
      "/a/": entry({ status: 404 }),
      "/b/": entry({ headers: { location: null, "content-type": "text/html", "x-robots-tag": "noindex" } }),
      "/d/": entry(),
      "/same/": entry(),
    },
  );
  assert.deepEqual(result, {
    added: ["/d/"],
    removed: ["/c/"],
    changed: [
      { path: "/a/", changes: ["status 200 -> 404"] },
      { path: "/b/", changes: ['x-robots-tag (none) -> "noindex"'] },
    ],
  });
  assert.equal(hasDifferences(result), true);
  assert.equal(hasDifferences(diffSnapshots({ "/a/": entry() }, { "/a/": entry() })), false);
});

test("a body change says whether the document or only the flight data changed", () => {
  assert.deepEqual(
    compareEntries(entry(), entry({ bodySha256: "x", flightSha256: "y" })),
    ["body (flight data)"],
  );
  assert.deepEqual(
    compareEntries(entry(), entry({ bodySha256: "x", documentSha256: "y" })),
    ["body (document)"],
  );
  assert.deepEqual(compareEntries({ error: "timed out" }, entry()).slice(0, 2), [
    'error "timed out" -> (none)',
    "status undefined -> 200",
  ]);
});

test("the unified diff shows the changed tags with context", () => {
  const before = "<html><head><title>PNG to JPG</title></head><body><h1>PNG to JPG</h1><p>a</p><p>b</p></body></html>";
  const after = before.replace("<h1>PNG to JPG</h1>", "<h1>PNG to JPEG</h1>");
  assert.equal(
    unifiedDiff(before, after, { labelA: "a/png-to-jpg/", labelB: "b/png-to-jpg/", context: 1 }),
    [
      "--- a/png-to-jpg/",
      "+++ b/png-to-jpg/",
      "@@ -5,3 +5,3 @@",
      " <body>",
      "-<h1>PNG to JPG</h1>",
      "+<h1>PNG to JPEG</h1>",
      " <p>a</p>",
    ].join("\n"),
  );
  assert.equal(unifiedDiff(before, before), "");
  const long = unifiedDiff("<a>".repeat(10), "<b>".repeat(10), { maxLines: 4 });
  assert.match(long, /\.\.\. 16 more lines$/);
});

test("long changed lines are cut around the first difference", () => {
  const before = `<p>${"x".repeat(500)}old${"y".repeat(500)}</p>`;
  const after = before.replace("old", "new");
  const [, , , removed, added] = unifiedDiff(before, after).split("\n");
  assert.ok(removed.length < 220, "the line is clipped");
  assert.match(removed, /^-\.\.\.x+oldy+\.\.\.$/);
  assert.match(added, /^\+\.\.\.x+newy+\.\.\.$/);
});
