// `pnpm content:brief` (#356): a self-contained brief per batch, from the
// registry, the Tool status view, the engine facts and the style guide.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { briefProblems, buildBrief } from "../scripts/lib/content-brief.mjs";
import { splitRegistry } from "../scripts/lib/content.mjs";
import { parseCsv } from "../scripts/lib/csv.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "../..");
const read = (file) => readFileSync(file, "utf8");
const tools = splitRegistry(read(path.join(appRoot, "lib/catalog/tools.json"))).map((entry) => JSON.parse(entry));
const statusRows = parseCsv(read(path.join(appRoot, "benchmarks/tool-status.csv")));
const examples = JSON.parse(read(path.join(appRoot, "content/batches/examples.json")));
const styleGuide = read(path.join(repoRoot, "docs/converter-copy.md"));
const readDoc = (doc) => read(path.join(repoRoot, doc));

const brief = (ids, formats = null) =>
  buildBrief({ name: "test", ids, tools, statusRows, formats, styleGuide, examples, readDoc });

const section = (text, id) => text.slice(text.indexOf(`## ${id}\n`)).split(/\n## (?!#)/)[0];

test("a brief gives each Tool its keyword, engine facts, current copy and an entry to fill", () => {
  const text = brief(["webp-to-png", "compress-m4a", "csv-to-json"]);
  assert.match(text, /^# Converter copy brief: test\n/);
  assert.match(text, /`apps\/tools\/content\/batches\/test\.json`/);
  assert.match(text, /## Style guide\n\nHow the copy on converter and compressor pages/);
  assert.match(text, /## Example: mp4-to-mp3\n/, "an FFmpeg Tool in the batch picks the FFmpeg example");

  const webp = section(text, "webp-to-png");
  assert.match(webp, /Keyword: \*\*webp to png\*\* \(exact match\), [\d,]+ searches a month worldwide/);
  assert.match(webp, /Engine: browser-raster; runs client-only\./);
  assert.match(webp, /An animated input gives its first frame only/);
  assert.match(webp, /Not settled by the code[^]*What colour fills transparent areas in a JPG output/);
  assert.match(webp, /formats\.json, #357\) doesn't exist yet/);
  assert.match(webp, /The page's copy was written to the style guide\./);
  assert.match(webp, /- How-to heading: How to convert WebP to PNG\n/);
  assert.match(text, /`seo\.howToHeading` is optional[^\n]*use the top "how to" question from the Tool's "Variants and questions" when there is one/);
  assert.match(text, /at most 60 characters with the " \| SERP Tools" the layout adds, so 47 of your own/);

  const m4a = section(text, "compress-m4a");
  assert.match(m4a, /The compressor asks for quality 0\.82/);
  assert.match(m4a, /ffmpeg -y -nostdin -i input\.m4a -vn -acodec aac -b:a 160k output\.m4a/);
  assert.doesNotMatch(m4a, /"aboutSection"/, "a compressor has one format");

  const table = section(text, "csv-to-json");
  assert.match(table, /a batch sets only seo for it/);
  assert.doesNotMatch(table, /"faqs"/);
  assert.match(text, /## Appendix: docs\/table-converters\.md\n/);
});

test("a brief carries the format reference once it exists", () => {
  const formats = { webp: { name: "WebP", summary: "An image format." } };
  const webp = section(brief(["webp-to-png"], formats), "webp-to-png");
  assert.match(webp, /\*\*webp\*\* \(apps\/tools\/content\/formats\.json[^]*"summary": "An image format\."/);
  assert.match(webp, /\*\*png\*\* has no entry in apps\/tools\/content\/formats\.json/);
});

test("a brief's example is the FFmpeg one only when a Tool needs FFmpeg", () => {
  assert.match(brief(["mov-to-mp4"]), /## Example: mp4-to-mp3\n/);
  assert.match(brief(["heic-to-jpg"]), /## Example: webp-to-png\n/);
});

test("a brief refuses Tools that aren't live converters or compressors", () => {
  const retired = tools.find((tool) => !tool.isActive && tool.operation === "convert");
  assert.deepEqual(briefProblems(["webp-to-png", "no-such-tool", retired.id, "download-loom-videos", "youtube-to-transcript"], tools), [
    "no-such-tool: no Tool has this id",
    `${retired.id}: the Tool is retired`,
    "download-loom-videos: not a converter or compressor (operation download)",
    "youtube-to-transcript: a transcription Tool; its copy is named in its own issue",
  ]);
});

test("an alias format shows its target's facts under the alias's own name", () => {
  const formats = { jpeg: { aliasOf: "jpg" }, jpg: { name: "JPG", fullName: "JPEG image", summary: "A lossy format." }, png: { name: "PNG", summary: "Lossless." } };
  const text = buildBrief({
    name: "test",
    ids: ["jpeg-to-png"],
    tools,
    statusRows,
    formats,
    styleGuide,
    examples,
    readDoc,
  });
  assert.match(text, /\*\*JPEG\*\* \(.*another name for JPG/);
  assert.match(text, /"name": "JPEG"/);
  assert.match(text, /"summary": "A lossy format\."/);
  assert.doesNotMatch(text, /aliasOf/);
  assert.match(text, /\*\*png\*\* \(/);
});

test("a brief carries the facts for its Tool's target and engine only", () => {
  const pdf = brief(["png-to-pdf"]);
  assert.match(pdf, /1 pixel is 1 point/);
  const svg = brief(["png-to-svg"]);
  assert.match(svg, /not traced/);
  assert.doesNotMatch(svg, /1 pixel is 1 point/);
  assert.match(brief(["mkv-to-mp4"]), /cap doesn't apply/);
  assert.match(brief(["mp3-to-mp4"]), /audio only, as AAC/);
});

test("a brief asks for a How-to heading only where the page shows one", () => {
  const idea = { keyword: "x", volume: 1, terms: [{ keyword: "x", volume: 1 }], questions: [{ keyword: "how to convert x", volume: 1 }] };
  const keywordIdeas = { source: "test", tools: { "csv-to-pdf": idea, "pdf-to-txt": idea, "webp-to-png": idea } };
  const text = buildBrief({ name: "test", ids: ["csv-to-pdf", "pdf-to-txt", "webp-to-png"], tools, statusRows, formats: null, styleGuide, examples, readDoc, keywordIdeas });
  assert.match(section(text, "csv-to-pdf"), /no generated How-to heading to replace: leave `seo\.howToHeading` out/);
  assert.match(section(text, "pdf-to-txt"), /no generated How-to heading to replace: leave `seo\.howToHeading` out/);
  assert.match(section(text, "webp-to-png"), /`seo\.howToHeading`: use the top "how to" question, "how to convert x"/);
});

test("a brief names several outputs' files only for Tools that can make several", () => {
  const text = brief(["png-to-pdf", "pdf-to-png"]);
  assert.doesNotMatch(section(text, "png-to-pdf"), /_page1/);
  assert.match(section(text, "pdf-to-png"), /"<name>_page1"/);
});

test("a Tool in the topics file gets a brief in depth: competing pages, guide facts and a guide, with no written How-to", () => {
  const depth = {
    topics: {
      tools: {
        "webp-to-png": {
          serpDate: "2026-10-21",
          targetWords: 1200,
          topics: [{ topic: "WebP vs PNG", description: "Lossy and lossless.", avgScore: 50, ourScore: 0 }],
          competitors: [{ url: "https://example.com/", position: 1, words: 1200 }],
        },
      },
    },
    guides: {
      formats: { webp: { background: [{ fact: "Google announced WebP in 2010.", source: "https://developers.google.com/speed/webp" }] } },
      tools: { "webp-to-png": { methods: [{ app: "Preview (macOS)", steps: "File > Export.", source: "https://support.apple.com/" }] } },
    },
  };
  const text = buildBrief({ name: "test", ids: ["webp-to-png", "compress-m4a"], tools, statusRows, formats: null, styleGuide, examples, readDoc, depth });
  assert.match(text, /## Writing in depth\n/);
  const webp = section(text, "webp-to-png");
  assert.match(webp, /median of 1,200 words in their static HTML \(1 measured\)/);
  assert.match(webp, /\*\*WebP vs PNG\*\* \(theirs 50, ours 0\)/);
  assert.match(webp, /Google announced WebP in 2010\. \(https:\/\/developers\.google\.com\/speed\/webp\)/);
  assert.match(webp, /Preview \(macOS\): File > Export\./);
  assert.doesNotMatch(webp, /"howTo"/, "a page in depth keeps the generated How-to");
  assert.match(webp, /"guide": \{/);
  assert.match(text, /programs that open it, grouped by Windows, Mac, Linux, web and mobile/);
  assert.equal(webp.match(/"question": ""/g).length, 8);
  const m4a = section(text, "compress-m4a");
  assert.doesNotMatch(m4a, /### Competing pages|"guide"/, "a Tool without topics gets the usual brief");
});
