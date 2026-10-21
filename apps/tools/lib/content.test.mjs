// Converter copy (#356, docs/converter-copy.md): each rule of
// `pnpm content:check`, and `pnpm content:apply` writing only the Tools a
// batch names, once.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyBatch,
  britishSpellings,
  checkContent,
  joinRegistry,
  loadContext,
  pageFields,
  readBatch,
  serializeEntry,
  splitRegistry,
  templateTools,
} from "../scripts/lib/content.mjs";
import { activeTools } from "./catalog/catalog.ts";
import { TOOLS_WITH_OWN_PAGE, isTranscriptionTool, toolSeo } from "./metadata.ts";
import { buildHowToSection } from "./tool-sections.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const converter = (id, from, to, extra = {}) => ({
  id,
  name: `${from.toUpperCase()} to ${to.toUpperCase()}`,
  description: `Convert ${from.toUpperCase()} files to ${to.toUpperCase()}`,
  operation: "convert",
  from,
  to,
  route: `/${id}`,
  isActive: true,
  ...extra,
});
const compressor = (format, extra = {}) => ({
  id: `compress-${format}`,
  name: `${format.toUpperCase()} Compressor`,
  description: `Compress ${format.toUpperCase()} files`,
  operation: "compress",
  from: format,
  to: format,
  route: `/compress-${format}`,
  isActive: true,
  ...extra,
});

// Copy written to the style guide: every required field, nothing shared.
const written = (tool, words) => ({
  ...tool,
  content: {
    tool: { title: tool.name, subtitle: `A subtitle about ${words}.`, from: tool.from, to: tool.to },
    seo: {
      title: `Convert ${tool.name} Online (Free)`,
      h1: `${tool.name} Converter`,
      description: `A description of ${words} that is long enough to pass the minimum length, which is one hundred and ten characters.`,
    },
    faqs: [
      { question: "One?", answer: `Alpha ${words} bravo charlie delta echo.` },
      { question: "Two?", answer: `Foxtrot ${words} golf hotel india juliet.` },
      { question: "Three?", answer: `Kilo ${words} lima mike november oscar.` },
    ],
    aboutSection: {
      fromFormat: { name: tool.from, fullName: tool.from, description: `${words} source.` },
      toFormat: { name: tool.to, fullName: tool.to, description: `${words} target.` },
    },
    pairNotes: { title: `Notes on ${words}`, points: [`First ${words}.`, `Second ${words}.`] },
  },
});

const noKeywords = { keywords: new Map() };
const rules = (failures) => failures.map((failure) => failure.rule);

const catalog = () => [
  written(converter("webp-to-png", "webp", "png"), "webp pictures"),
  converter("mp4-to-mp3", "mp4", "mp3"),
  compressor("m4a"),
  converter("old-to-new", "old", "new", { isActive: false }),
];

test("a catalog that follows the rules passes", () => {
  assert.deepEqual(checkContent(catalog(), noKeywords), []);
});

test("the title and H1 must contain the Tool's keyword", () => {
  const keywords = new Map([["mp4-to-mp3", "mp4 to mp3"], ["compress-m4a", "m4a audio shrinker"]]);
  const failures = checkContent(catalog(), { keywords });
  assert.deepEqual(
    failures.map((failure) => [failure.toolId, failure.rule]),
    [["compress-m4a", "keyword"], ["compress-m4a", "keyword"]],
  );
  assert.match(failures[0].message, /title "Compress M4A Files Online \(Free\)" lacks the keyword "m4a audio shrinker"/);
});

test("the title is at most 60 characters with the layout's suffix, and never names the site", () => {
  const tools = catalog();
  tools[0].content.seo.title = `WebP to PNG ${"x".repeat(35)}`;
  assert.equal(tools[0].content.seo.title.length, 47);
  assert.deepEqual(rules(checkContent(tools, noKeywords)), []);
  tools[0].content.seo.title += "x";
  assert.deepEqual(
    checkContent(tools, noKeywords).map((failure) => failure.message),
    ['title is 61 characters with " | SERP Tools", over 60'],
  );
  tools[0].content.seo.title = "WebP to PNG | SERP Tools";
  assert.deepEqual(rules(checkContent(tools, noKeywords)), ["length"]);
});

test("a long name drops the suffix from the title, and an H1 over 60 characters fails", () => {
  const long = converter("markdown-to-pandasdataframe", "markdown", "pandasdataframe", {
    name: "Markdown to Pandas DataFrame",
  });
  // "Convert Markdown to Pandas DataFrame Online (Free) | SERP Tools" would
  // be 63 characters, so the title drops " Online (Free)": 49 served.
  const seo = toolSeo(long);
  assert.equal(seo.h1, "Markdown to Pandas DataFrame Converter");
  assert.equal(seo.title, "Convert Markdown to Pandas DataFrame");
  assert.deepEqual(checkContent([long], noKeywords).filter((failure) => failure.rule === "length"), []);

  long.name = "Pandas DataFrame to reStructuredText Grid Table Markup";
  assert.equal(toolSeo(long).h1.length, 64);
  assert.deepEqual(
    checkContent([long], noKeywords).map((failure) => failure.message),
    ['title is 75 characters with " | SERP Tools", over 60', "H1 is 64 characters, over 60"],
  );
});

test("a written How-to heading has the keyword's words, fits 70 characters, and is shown", () => {
  const keywords = new Map([["webp-to-png", "webp to png"]]);
  const tools = catalog();
  tools[0].content.seo.howToHeading = "How do I convert a WebP to a PNG?";
  assert.deepEqual(checkContent(tools, { keywords }), []);
  assert.equal(
    buildHowToSection(tools[0]).title,
    "How do I convert a WebP to a PNG?",
    "the converter page shows it in place of the generated heading",
  );

  tools[0].content.seo.howToHeading = "How do I convert a WebP image?";
  assert.deepEqual(checkContent(tools, { keywords }).map((failure) => failure.message), [
    'How-to heading "How do I convert a WebP image?" lacks a word of the keyword "webp to png"',
  ]);
  // Without a keyword, it names the Tool's formats.
  assert.deepEqual(rules(checkContent(tools, noKeywords)), ["keyword"]);

  tools[0].content.seo.howToHeading = `How to convert WebP to PNG ${"x".repeat(44)}`;
  assert.deepEqual(checkContent(tools, { keywords }).map((failure) => failure.message), [
    "How-to heading is 71 characters, over 70",
  ]);

  tools[0].content.seo.howToHeading = "How to convert WebP to PNG";
  tools[0].content.howTo = { title: "Steps", intro: "Do this.", steps: ["One."] };
  assert.deepEqual(checkContent(tools, { keywords }).map((failure) => failure.message), [
    "content.seo.howToHeading is set, but content.howTo replaces the How-to section",
  ]);

  const table = written(converter("csv-to-json", "csv", "json"), "csv rows");
  table.content.seo.howToHeading = "How to convert CSV to JSON";
  assert.deepEqual(
    checkContent([table], noKeywords).filter((failure) => failure.rule === "unshown").map((failure) => failure.message),
    ["content.seo.howToHeading is set, but this Tool's page has no generated How-to heading"],
  );
});

test("a title follows the Tool's keyword: Converter isn't required", () => {
  const tools = [written(compressor("png"), "png images")];
  tools[0].content.seo.title = "PNG Optimizer Online (Free)";
  tools[0].content.seo.h1 = "PNG Optimizer";
  delete tools[0].content.aboutSection;
  assert.deepEqual(checkContent(tools, { keywords: new Map([["compress-png", "png optimizer"]]) }), []);

  tools[0].content.seo.title = "Convert WebP to PNG Online, Free";
  tools[0].content.seo.h1 = "Convert WebP to PNG Online";
  assert.deepEqual(checkContent(tools, { keywords: new Map([["compress-png", "webp to png online"]]) }), []);
  assert.deepEqual(rules(checkContent(tools, { keywords: new Map([["compress-png", "png optimizer"]]) })), ["keyword", "keyword"]);
});

test("transcription Tools are out of content:check and content:apply", () => {
  const transcript = converter("audio-to-text", "mp3", "txt", { name: "Audio to Text" });
  assert.equal(isTranscriptionTool(transcript), true);
  // No keyword in the title, a short description: still not checked.
  assert.deepEqual(checkContent([transcript], { keywords: new Map([["audio-to-text", "speech to text"]]) }), []);
  const { problems } = applyBatch(registryOf([transcript]), { "audio-to-text": { seo: batchFor("x")["mp4-to-mp3"].seo } }, noKeywords);
  assert.deepEqual(problems, ["audio-to-text: a transcription Tool; its copy is named in its own issue"]);
});

test("the description is 110 to 160 characters", () => {
  const tools = catalog();
  tools[0].content.seo.description = "x".repeat(109);
  assert.deepEqual(rules(checkContent(tools, noKeywords)), ["length"]);
  tools[0].content.seo.description = "x".repeat(110);
  assert.deepEqual(rules(checkContent(tools, noKeywords)), []);
  tools[0].content.seo.description = "x".repeat(161);
  assert.deepEqual(rules(checkContent(tools, noKeywords)), ["length"]);
});

test("no two Tools share a title, an H1 or a description", () => {
  const tools = catalog();
  const other = written(converter("avif-to-png", "avif", "png"), "photos from cameras");
  other.content.seo = { ...tools[0].content.seo };
  const failures = checkContent([...tools, other], noKeywords);
  assert.deepEqual(rules(failures), ["duplicate", "duplicate", "duplicate"]);
  assert.match(failures[0].message, /title is the same as webp-to-png's/);
});

test("a written FAQ answer may not repeat another Tool's, format names aside", () => {
  const tools = catalog();
  const legacy = converter("avif-to-jpg", "avif", "jpg");
  legacy.content = {
    tool: { title: "AVIF to JPG", subtitle: "Legacy.", from: "avif", to: "jpg" },
    faqs: [{ question: "?", answer: "Your browser turns the AVIF into a JPG without any upload at all." }],
  };
  tools[0].content.faqs[0].answer = "Your browser turns the WebP into a PNG without any upload at all.";
  const failures = checkContent([...tools, legacy], noKeywords);
  assert.deepEqual(rules(failures), ["faq-duplicate"]);
  assert.match(failures[0].message, /faqs\[0\] repeats avif-to-jpg faqs\[0\] \(similarity 1\.00, limit 0\.6\)/);
});

test("a written FAQ answer may not repeat the template FAQs", () => {
  const tools = catalog();
  tools[0].content.faqs[2].answer = "No. The page works in a current web browser, with nothing to install and no sign-up.";
  const failures = checkContent(tools, noKeywords);
  assert.deepEqual(rules(failures), ["faq-duplicate"]);
  assert.match(failures[0].message, /repeats the template FAQs/);
});

test("written FAQs are compared with the template of each operation and place of conversion", () => {
  const tools = [...catalog(), converter("mp4-to-rm", "mp4", "rm"), compressor("pdf")];
  assert.deepEqual(
    templateTools(tools.filter((tool) => tool.isActive)).map((tool) => tool.id),
    ["webp-to-png", "compress-m4a", "mp4-to-rm", "compress-pdf"],
  );
  tools[0].content.faqs[1].answer =
    "Yes, at first. The page sends the file to the SERP Tools server, and converts it in your browser if the server can't.";
  tools[0].content.faqs[2].answer = "Yes. This one uploads the file to the SERP Tools server, which compresses it.";
  const failures = checkContent(tools, noKeywords);
  assert.deepEqual(rules(failures), ["faq-duplicate", "faq-duplicate"]);
  assert.match(failures[0].message, /repeats the template FAQs \(convert, server first, as on mp4-to-rm\)/);
  assert.match(failures[1].message, /repeats the template FAQs \(compress, server first, as on compress-pdf\)/);
});

test("older curated FAQs may repeat each other until a batch replaces them", () => {
  const tools = catalog();
  const answer = { question: "?", answer: "It runs in your browser so nothing is uploaded anywhere." };
  for (const tool of [tools[1], tools[2]]) {
    tool.content = { tool: { title: tool.name, subtitle: `Legacy ${tool.id}.`, from: tool.from, to: tool.to }, faqs: [answer] };
  }
  assert.deepEqual(checkContent(tools, noKeywords), []);
});

test("links go only to live pages on this site", () => {
  const tools = catalog();
  const content = tools[0].content;
  content.relatedTools = [
    { toolId: "mp4-to-mp3", title: "Live Tool" },
    { href: "/compress-m4a/", title: "Live page" },
    { toolId: "old-to-new", title: "Retired Tool" },
    { href: "#", title: "Placeholder" },
  ];
  content.pairNotes.points.push(
    "See [the category](/category/convert/).",
    "See [a page](/no-such-page/).",
    "See [elsewhere](https://example.com/).",
    'An <a href="">empty link</a>.',
  );
  const failures = checkContent(tools, noKeywords);
  assert.deepEqual(rules(failures), ["link", "link", "link", "link", "link"]);
  assert.deepEqual(
    failures.map((failure) => failure.message),
    [
      "relatedTools[2] names old-to-new, which isn't a live Tool",
      'relatedTools[3] links to "#"',
      "content.pairNotes.points[3] links to /no-such-page/, which isn't a live page",
      "content.pairNotes.points[4] links off the site: https://example.com/",
      'content.pairNotes.points[5] links to ""',
    ],
  );
});

test("converter pages have no changelog or blog posts", () => {
  const tools = catalog();
  tools[0].content.changelog = [{ date: "2025-01-01", changes: ["Invented."] }];
  tools[0].content.blogPosts = [{ title: "Invented", href: "/compress-m4a/" }];
  assert.deepEqual(rules(checkContent(tools, noKeywords)), ["invented", "invented"]);
});

test("written copy has every field its page shows", () => {
  const tools = catalog();
  const content = tools[0].content;
  content.tool.subtitle = " ";
  content.faqs = content.faqs.slice(0, 2);
  content.pairNotes.points = ["Only one."];
  delete content.aboutSection;
  assert.deepEqual(rules(checkContent(tools, noKeywords)), ["required", "required", "required", "required"]);

  // A compressor has one format, so no format cards.
  const m4a = written(compressor("m4a"), "m4a sound");
  m4a.content.seo.title = "Compress M4A Files Online (Free)";
  m4a.content.seo.h1 = "M4A Compressor";
  delete m4a.content.aboutSection;
  assert.deepEqual(checkContent([m4a], noKeywords), []);
});

const registryOf = (tools) => joinRegistry(tools.map(serializeEntry));
const batchFor = (words) => {
  const { content } = written(converter("mp4-to-mp3", "mp4", "mp3"), words);
  return { "mp4-to-mp3": { seo: content.seo, tool: { subtitle: content.tool.subtitle }, faqs: content.faqs, aboutSection: content.aboutSection, pairNotes: content.pairNotes } };
};

test("content:apply rewrites only the Tools a batch names, and only once", () => {
  const registry = registryOf(catalog());
  const first = applyBatch(registry, batchFor("mp4 video — audio"), noKeywords);
  assert.deepEqual(first.problems, []);
  assert.deepEqual(first.changed, ["mp4-to-mp3"]);

  const before = splitRegistry(registry);
  const after = splitRegistry(first.text);
  assert.deepEqual(
    after.map((entry, index) => entry === before[index]),
    [true, false, true, true],
  );
  const written = JSON.parse(after[1]);
  assert.deepEqual(Object.keys(written.content), ["tool", "seo", "faqs", "aboutSection", "pairNotes"]);
  assert.deepEqual(written.content.tool, {
    title: "MP4 to MP3",
    subtitle: "A subtitle about mp4 video — audio.",
    from: "mp4",
    to: "mp3",
    accept: ".mp4",
  });
  assert.match(after[1], /mp4 video \\u2014 audio/, "non-ASCII is written as \\u escapes, as in tools.json");

  const second = applyBatch(first.text, batchFor("mp4 video — audio"), noKeywords);
  assert.deepEqual(second, { text: first.text, changed: [], problems: [] });
});

test("content:apply keeps content a batch doesn't name", () => {
  const tools = catalog();
  tools[1].content = {
    tool: { title: "MP4 to MP3", subtitle: "Old.", from: "mp4", to: "mp3" },
    videoSection: { embedId: "abc" },
    relatedTools: [{ toolId: "compress-m4a", title: "M4A Compressor" }],
  };
  const { text, problems } = applyBatch(registryOf(tools), batchFor("mp4 audio"), noKeywords);
  assert.deepEqual(problems, []);
  const content = JSON.parse(splitRegistry(text)[1]).content;
  assert.deepEqual(Object.keys(content), ["tool", "seo", "videoSection", "faqs", "aboutSection", "pairNotes", "relatedTools"]);
  assert.equal(content.tool.subtitle, "A subtitle about mp4 audio.");
  assert.deepEqual(content.videoSection, { embedId: "abc" });
});

test("content:apply refuses unknown, retired and non-converter Tools, and fields a page doesn't show", () => {
  const tools = [...catalog(), { ...converter("csv-to-json", "csv", "json") }, { ...converter("x-dl", "x", "y"), operation: "download" }];
  const registry = registryOf(tools);
  const entry = batchFor("mp4 audio")["mp4-to-mp3"];
  const { text, changed, problems } = applyBatch(
    registry,
    {
      "no-such-tool": entry,
      "old-to-new": entry,
      "x-dl": entry,
      "csv-to-json": { seo: entry.seo, faqs: entry.faqs },
      "mp4-to-mp3": { ...entry, tool: { title: "MP4 to MP3", accept: ".mp4" }, videoSection: {} },
    },
    noKeywords,
  );
  assert.equal(text, registry);
  assert.deepEqual(changed, []);
  assert.deepEqual(problems, [
    "no-such-tool: no Tool has this id",
    "old-to-new: the Tool is retired",
    "x-dl: not a converter or compressor (operation download)",
    "csv-to-json.faqs: this Tool's page doesn't show it (it shows seo)",
    "mp4-to-mp3.videoSection: not a batch field (seo, tool, faqs, aboutSection, pairNotes, howTo, guide)",
    "mp4-to-mp3.tool.title: a batch sets only tool.subtitle",
    "mp4-to-mp3.tool.accept: a batch sets only tool.subtitle",
  ]);
});

test("content:apply reports a batch that breaks a rule", () => {
  const batch = batchFor("mp4 audio");
  batch["mp4-to-mp3"].seo.description = "Too short.";
  const { problems } = applyBatch(registryOf(catalog()), batch, noKeywords);
  assert.deepEqual(problems, ["mp4-to-mp3 [length] description is 10 characters, outside 110–160"]);
});

// A page written in depth: the catalog's first Tool with eight FAQs and a
// guide with the five sections.
const SECTIONS = [
  "What is a WebP file?",
  "Programs that open WebP files",
  "WebP and PNG compared",
  "Other ways to convert WebP to PNG",
  "Problems with WebP files",
];
const WORDS = ["amber", "basalt", "cobalt", "dune", "ember", "fjord", "garnet", "harbor", "indigo", "jasper"];
function deepCatalog() {
  const tools = catalog();
  const { content } = tools[0];
  content.faqs = WORDS.slice(0, 8).map((word, index) => ({ question: `Question ${index}?`, answer: `The ${word} answer.` }));
  content.guide = { title: "About WebP files", markdown: SECTIONS.map((heading) => `### ${heading}\n\nText with a color cache.`).join("\n\n") };
  return tools;
}

test("a page with a guide has at least 8 FAQs and the guide's five sections in order, with no table", () => {
  assert.deepEqual(checkContent(deepCatalog(), noKeywords), []);

  const tools = deepCatalog();
  tools[0].content.faqs.pop();
  tools[0].content.guide.markdown = tools[0].content.guide.markdown
    .replace("### WebP and PNG compared", "### Problems first")
    .concat("\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  const messages = checkContent(tools, noKeywords).map((failure) => `[${failure.rule}] ${failure.message}`);
  assert.equal(messages.length, 3);
  assert.equal(messages[0], "[depth] content.faqs needs at least 8 questions on a page with a guide");
  assert.match(messages[1], /^\[depth\] content\.guide needs these ### sections, in order: "What is a \{FROM\} file", .* it has "What is a WebP file", "Programs that open WebP files", "Problems first", /);
  assert.equal(messages[2], "[depth] content.guide has a table; write a list instead");

  const missing = deepCatalog();
  missing[0].content.guide.markdown = "No sections at all.";
  assert.match(checkContent(missing, noKeywords)[0].message, /it has none$/);
});

test("copy on a page with a guide is in US spelling", () => {
  assert.deepEqual(
    britishSpellings("Colour, greyscale, a licence, modelled, optimised, centre, behaviour; colors, gray, analysis and analyses").map(({ word }) => word),
    ["Colour", "greyscale", "licence", "modelled", "centre", "behaviour", "optimised"],
  );

  const tools = deepCatalog();
  tools[0].content.guide.markdown += "\n\nIn greyscale or colour.";
  tools[0].content.pairNotes.points[0] = "A licence fee.";
  assert.deepEqual(
    checkContent(tools, noKeywords).map((failure) => `[${failure.rule}] ${failure.message}`),
    [
      '[spelling] content.pairNotes.points[0] spells "licence" the British way (US: license)',
      '[spelling] content.guide.markdown spells "colour" the British way (US: color)',
      '[spelling] content.guide.markdown spells "greyscale" the British way (US: gray)',
    ],
  );

  // A page without a guide isn't held to it yet: older copy is rewritten batch by batch.
  const older = catalog();
  older[0].content.pairNotes.points[0] = "A licence fee.";
  assert.deepEqual(checkContent(older, noKeywords), []);
});

test("a written How-to's title is a How-to heading, over at least three steps", () => {
  const keywords = new Map([["webp-to-png", "webp to png"]]);
  const tools = catalog();
  tools[0].content.howTo = {
    title: "How do I convert a WebP to a PNG?",
    steps: ["Choose the WebP.", "Wait for the PNG.", "Save it."],
  };
  assert.deepEqual(checkContent(tools, { keywords }), []);

  tools[0].content.howTo = { title: "How do I convert a WebP image?", steps: ["Choose it."] };
  assert.deepEqual(checkContent(tools, { keywords }).map((failure) => failure.message), [
    'How-to heading "How do I convert a WebP image?" lacks a word of the keyword "webp to png"',
    "content.howTo needs at least 3 steps",
  ]);
});

test("content:apply writes a batch's How-to and guide", () => {
  const batch = batchFor("mp4 audio");
  batch["mp4-to-mp3"].howTo = { title: "How to convert MP4 to MP3", steps: ["One.", "Two.", "Three."] };
  batch["mp4-to-mp3"].faqs = WORDS.slice(0, 8).map((word, index) => ({ question: `Question ${index}?`, answer: `The ${word} answer.` }));
  batch["mp4-to-mp3"].guide = {
    title: "About MP4 and MP3",
    markdown: ["What is an MP4 file?", "Programs that open MP4 files", "MP4 and MP3 compared", "Other ways to convert MP4 to MP3", "Problems with MP4 files"]
      .map((heading) => `### ${heading}\n\nA container.`)
      .join("\n\n"),
  };
  const { text, problems } = applyBatch(registryOf(catalog()), batch, noKeywords);
  assert.deepEqual(problems, []);
  const written = JSON.parse(splitRegistry(text)[1]).content;
  assert.deepEqual(Object.keys(written), ["tool", "seo", "faqs", "aboutSection", "pairNotes", "guide", "howTo"]);
});

test("content:apply writes a batch's How-to heading", () => {
  const batch = batchFor("mp4 audio");
  batch["mp4-to-mp3"].seo.howToHeading = "How to convert an MP4 to MP3";
  const { text, problems } = applyBatch(registryOf(catalog()), batch, noKeywords);
  assert.deepEqual(problems, []);
  assert.equal(JSON.parse(splitRegistry(text)[1]).content.seo.howToHeading, "How to convert an MP4 to MP3");
});

test("tools.json splits into entries and joins back byte for byte, and holds the examples batch", () => {
  const registry = readFileSync(path.join(appRoot, "lib/catalog/tools.json"), "utf8");
  assert.equal(joinRegistry(splitRegistry(registry)), registry);
  const examples = JSON.parse(readFileSync(path.join(appRoot, "content/batches/examples.json"), "utf8"));
  const { text, changed, problems } = applyBatch(registry, examples, loadContext(appRoot));
  assert.deepEqual(problems, []);
  assert.deepEqual(changed, [], "pnpm content:apply examples has been run");
  assert.equal(text, registry);
});

// pageFields says what each page shows; the pages are the truth.
test("the Tools with pages of their own show the batch fields pageFields lists", () => {
  const transcription = new Set(activeTools().filter(isTranscriptionTool).map((tool) => tool.id));
  for (const id of [...TOOLS_WITH_OWN_PAGE].filter((own) => !transcription.has(own))) {
    const file = [`app/${id}/page.tsx`, `app/(convert)/${id}/page.tsx`]
      .map((candidate) => path.join(appRoot, candidate))
      .find((candidate) => {
        try {
          return readFileSync(candidate);
        } catch {
          return false;
        }
      });
    const source = readFileSync(file, "utf8");
    const fields = pageFields({ id, operation: "convert", from: "a", to: "b" });
    assert.equal(/content\.faqs/.test(source), fields.includes("faqs"), `${id} and content.faqs`);
    assert.equal(/content\.tool\b/.test(source), fields.includes("tool"), `${id} and content.tool`);
    assert.doesNotMatch(source, /content\.(aboutSection|pairNotes)/, `${id} shows a field pageFields leaves out`);
    assert.match(source, /toolHeading\(toolId\)/, `${id}'s H1 follows content.seo.h1`);
  }
});

test("a batch that isn't there, isn't JSON or isn't keyed by Tool id is refused by name", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "content-batch-"));
  const file = (name, text) => {
    writeFileSync(path.join(dir, name), text);
    return path.join(dir, name);
  };
  assert.deepEqual(readBatch(appRoot, "no-such-batch"), {
    error: "No batch file at apps/tools/content/batches/no-such-batch.json.",
  });
  assert.match(readBatch(appRoot, file("broken.json", "{")).error, /isn't valid JSON/);
  assert.match(readBatch(appRoot, file("list.json", "[]")).error, /must be an object keyed by Tool id/);
  assert.deepEqual(readBatch(appRoot, file("ok.json", '{"webp-to-png":{}}')), { batch: { "webp-to-png": {} } });
});
