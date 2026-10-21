// Converter and compressor copy (#356, docs/converter-copy.md): the checks
// every live converter and compressor passes (`pnpm content:check`), and
// writing a writer's batch file into tools.json (`pnpm content:apply`).
//
// A Tool's title, H1 and description are what its page renders: content.seo
// when the Tool has it, else the generated pattern (toolSeo in
// lib/metadata.ts). The rules on FAQs and required fields hold for Tools with
// content.seo, the ones written to the style guide; older curated copy repeats
// itself across Tools and is replaced batch by batch (#355).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { canonicalPath } from "../../lib/trailing-slash.ts";
import { toolHref } from "../../lib/catalog/href.ts";
import { operationsUsedBy } from "../../lib/catalog/operations.ts";
import { validateCatalog } from "../../lib/catalog/validate.ts";
import {
  TOOLS_WITH_OWN_PAGE,
  hasToolSeo,
  isTranscriptionTool,
  onConverterPage,
  runsInBrowser,
  toolSeo,
  SEO_TITLE_MAX,
  SITE_TITLE_SUFFIX,
  servedTitleLength,
} from "../../lib/metadata.ts";
import { buildConverterFaqs, converterAccept } from "../../lib/tool-sections.ts";
import { parseCsv } from "./csv.mjs";

export const REGISTRY_PATH = "lib/catalog/tools.json";
export const STATUS_PATH = "benchmarks/tool-status.csv";
export const BATCH_DIR = "content/batches";

// The issue (#356) asked for 70; lib/metadata.test.mjs already holds every
// served description to 110, the length under which Ahrefs reports one as too
// short, so a batch that passes this check also passes `pnpm test`.
export const DESCRIPTION_MIN = 110;
export const DESCRIPTION_MAX = 160;
// Two FAQ answers are near-duplicates when this share of their three-word
// phrases (Jaccard similarity) is the same, once each Tool's own format names
// are blanked: "Your browser turns the WebP into a PNG" and "Your browser
// turns the AVIF into a JPG" are one answer. Of the 551 curated converter
// answers in October 2026, 200 were word-for-word copies (1.0), 291 scored
// under 0.3 against every other Tool's, and 60 fell between; the two examples'
// answers score 0.04 at most.
export const FAQ_SIMILARITY_MAX = 0.6;
export const FAQS_MIN = 3;
// A written How-to heading (content.seo.howToHeading): a question, as long as
// people search one.
export const HOW_TO_HEADING_MAX = 70;
export const PAIR_NOTES_MIN = 2;
// A written How-to (content.howTo) lists the steps on this site.
export const HOW_TO_STEPS_MIN = 3;
// A page written in depth (a Tool with content.guide; "Writing in depth" in
// docs/converter-copy.md): at least this many FAQs, so the page covers what
// the ranking pages answer, and the guide's `###` sections, in this order.
// Each heading names the pair in its own words ("What is a JFIF file?",
// "Lossy and lossless JPEG compression compared"), so a section is known by
// how its heading starts or ends.
export const DEPTH_FAQS_MIN = 8;
export const GUIDE_SECTIONS = [
  { name: "What is a {FROM} file", pattern: /^What is /i },
  { name: "Programs that open {FROM} files", pattern: /^Programs that /i },
  { name: "{FROM} and {TO} compared", pattern: / compared$/i },
  { name: "Other ways to convert {FROM} to {TO}", pattern: /^Other ways to /i },
  { name: "Problems with {FROM} files", pattern: /^Problems with /i },
];
// British spellings writers fall into, with the US spelling the style guide
// asks for ("plain US English"). A word is matched whole, in any case, with
// these endings.
const BRITISH_SPELLINGS = [
  [/\bcolour(s|ed|ful|ing|less)?\b/gi, "color"],
  [/\bgrey(s|scale)?\b/gi, "gray"],
  [/\blicence(s|d)?\b/gi, "license"],
  [/\b(model|label|travel|cancel|signal|channel|level)l(ed|ing)\b/gi, "one l"],
  [/\bcentre(s|d)?\b/gi, "center"],
  [/\bbehaviour(s|al)?\b/gi, "behavior"],
  [/\bfavour(s|ed|ite|ites)?\b/gi, "favor"],
  [/\bflavour(s)?\b/gi, "flavor"],
  [/\b(optimi|organi|recogni|customi|minimi|maximi|normali|standardi|synchroni|summari|visuali|categori|prioriti|authori|initiali|finali|utili|reali)s(e|ed|es|ing|ation|ations)\b/gi, "-ize"],
  [/\banalys(e|ed|ing)\b/gi, "analyze"],
  [/\bcatalogue(s|d)?\b/gi, "catalog"],
  [/\bartefact(s)?\b/gi, "artifact"],
  [/\b(whilst|amongst)\b/gi, "while, among"],
];

// The British spellings in a text, each as the word found and its US form.
export function britishSpellings(text) {
  const found = [];
  for (const [pattern, us] of BRITISH_SPELLINGS) {
    for (const match of text.matchAll(pattern)) found.push({ word: match[0], us });
  }
  return found;
}

// The fields a batch may set on a Tool, and the order content keys are
// written in. Keys this list doesn't name keep their order after these.
export const BATCH_FIELDS = ["seo", "tool", "faqs", "aboutSection", "pairNotes", "howTo", "guide"];
const CONTENT_KEY_ORDER = [
  "tool",
  "seo",
  "videoSection",
  "faqs",
  "aboutSection",
  "pairNotes",
  "guide",
  "howTo",
  "infoArticle",
  "relatedTools",
];
// content.tool.title is shown by no page (the H1 is content.seo.h1, else the
// pattern), so a batch sets only the subtitle.
const BATCH_TOOL_FIELDS = new Set(["subtitle"]);

export const isConverter = (tool) => tool.isActive && hasToolSeo(tool);

// The batch fields a Tool's page shows. The converter page shows them all.
// Character Counter and JSON to CSV show the subtitle and FAQs; table converter pages and HTML to Markdown build their
// copy in code and take only content.seo. content.test.mjs reads the pages
// to keep this true.
export const OWN_PAGE_FIELDS = ["seo", "tool", "faqs"];
export const OWN_PAGES_WITHOUT_COPY = new Set(["html-to-markdown"]);
export function pageFields(tool) {
  if (onConverterPage(tool)) return BATCH_FIELDS;
  if (TOOLS_WITH_OWN_PAGE.has(tool.id) && !OWN_PAGES_WITHOUT_COPY.has(tool.id)) return OWN_PAGE_FIELDS;
  return ["seo"];
}

// Lower case letters and digits only: "WebP to PNG" contains "webp to png",
// and "CSV to Pandas DataFrame" contains "csv to pandasdataframe".
const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

// Whether text has each word of the keyword, in any order and with other
// words between: "How do I convert a WebP to a PNG?" has "webp to png".
const hasKeywordWords = (text, keyword) =>
  keyword
    .split(/\s+/)
    .map(squash)
    .filter(Boolean)
    .every((word) => squash(text).includes(word));

// The keyword each live Tool's row names in the Tool status view.
export function keywordsFromStatus(csvText) {
  const keywords = new Map();
  for (const row of parseCsv(csvText)) {
    if (row.catalog_state === "live" && row.keyword) keywords.set(row.tool_id, row.keyword);
  }
  return keywords;
}

// The paths a link in Tool copy may point at: every active Tool's page, the
// homepage, the category pages and the two index pages.
export function liveRoutes(tools) {
  const active = tools.filter((tool) => tool.isActive);
  return new Set([
    "/",
    "/categories/",
    "/brands/",
    ...operationsUsedBy(active).map((operation) => `/category/${operation}/`),
    ...active.map((tool) => toolHref(tool)),
  ]);
}

export function loadContext(appRoot) {
  return {
    keywords: keywordsFromStatus(readFileSync(path.join(appRoot, STATUS_PATH), "utf8")),
  };
}

// Every string in a value, with where it is.
function* strings(value, where) {
  if (typeof value === "string") yield [where, value];
  else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) yield* strings(item, `${where}[${index}]`);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) yield* strings(item, `${where}.${key}`);
  }
}

// The links in a Tool's content: related Tools, blog posts, and Markdown or
// HTML links in any text.
function contentLinks(content) {
  const links = [];
  for (const [index, related] of (content.relatedTools ?? []).entries()) {
    if (related.toolId !== undefined) links.push({ where: `relatedTools[${index}]`, toolId: related.toolId });
    if (related.href !== undefined) links.push({ where: `relatedTools[${index}]`, href: related.href });
  }
  for (const [index, post] of (content.blogPosts ?? []).entries()) {
    links.push({ where: `blogPosts[${index}]`, href: post.href });
  }
  for (const [where, text] of strings({ ...content, relatedTools: undefined, blogPosts: undefined }, "content")) {
    for (const match of text.matchAll(/\]\(([^)\s]*)\)|href=["']([^"']*)["']/g)) {
      links.push({ where, href: match[1] ?? match[2] });
    }
  }
  return links;
}

// An answer as its three-word phrases, with the Tool's format names blanked.
export function phrases(tool, text) {
  let normalized = text.toLowerCase();
  const names = [tool.from, tool.to].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of names) {
    normalized = normalized.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " fmt ");
  }
  const words = normalized.replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  const set = new Set();
  for (let index = 0; index + 3 <= words.length; index += 1) set.add(words.slice(index, index + 3).join(" "));
  if (words.length < 3 && words.length) set.add(words.join(" "));
  return set;
}

export function similarity(a, b) {
  let shared = 0;
  for (const phrase of a) if (b.has(phrase)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

// The fields a Tool written to the style guide needs, of those its page shows.
function requiredFields(tool, content, fail) {
  const fields = pageFields(tool);
  if (fields.includes("tool") && !content.tool?.subtitle?.trim()) fail("required", "content.tool.subtitle is missing");
  if (fields.includes("faqs") && (content.faqs?.length ?? 0) < FAQS_MIN) {
    fail("required", `content.faqs needs at least ${FAQS_MIN} questions`);
  }
  if (fields.includes("pairNotes") && (content.pairNotes?.points?.length ?? 0) < PAIR_NOTES_MIN) {
    fail("required", `content.pairNotes needs a title and at least ${PAIR_NOTES_MIN} points`);
  }
  if (fields.includes("aboutSection") && tool.from !== tool.to && !content.aboutSection) {
    fail("required", "content.aboutSection is missing (a converter describes both formats)");
  }
}

// A written How-to heading: shown on the converter page, in place of the
// generated one, so it holds the keyword's words (or, without a keyword, the
// Tool's formats) and fits HOW_TO_HEADING_MAX.
function checkHowToHeading(tool, content, keyword, fail) {
  const heading = content.seo.howToHeading;
  if (typeof heading !== "string" || !heading.trim()) {
    fail("required", "content.seo.howToHeading is empty");
    return;
  }
  if (!onConverterPage(tool)) {
    fail("unshown", "content.seo.howToHeading is set, but this Tool's page has no generated How-to heading");
  } else if (content.howTo) {
    fail("unshown", "content.seo.howToHeading is set, but content.howTo replaces the How-to section");
  }
  headingRules(tool, heading, keyword, fail);
}

function headingRules(tool, heading, keyword, fail) {
  if (heading.length > HOW_TO_HEADING_MAX) {
    fail("length", `How-to heading is ${heading.length} characters, over ${HOW_TO_HEADING_MAX}`);
  }
  const words = keyword ?? [tool.from, tool.to].filter(Boolean).join(" ");
  if (!hasKeywordWords(heading, words)) {
    fail("keyword", `How-to heading "${heading}" lacks a word of ${keyword ? `the keyword "${keyword}"` : `the formats "${words}"`}`);
  }
}

// A written How-to (content.howTo), on a Tool written to the style guide:
// its title is the How-to heading, held to the same rules, over at least
// HOW_TO_STEPS_MIN steps.
function checkWrittenHowTo(tool, content, keyword, fail) {
  const { title, steps } = content.howTo;
  if (!title?.trim()) fail("required", "content.howTo.title is empty");
  else headingRules(tool, title, keyword, fail);
  if ((steps?.length ?? 0) < HOW_TO_STEPS_MIN) fail("required", `content.howTo needs at least ${HOW_TO_STEPS_MIN} steps`);
}

// A page written in depth: at least DEPTH_FAQS_MIN FAQs, a guide with the
// GUIDE_SECTIONS and no other `###` sections, no table (the guide renders
// without GFM, so a table would show as pipes), and US spelling in every
// field of its copy.
function checkDepth(content, fail) {
  if ((content.faqs?.length ?? 0) < DEPTH_FAQS_MIN) {
    fail("depth", `content.faqs needs at least ${DEPTH_FAQS_MIN} questions on a page with a guide`);
  }
  const markdown = content.guide.markdown ?? "";
  const headings = [...markdown.matchAll(/^###\s+(.+?)\s*$/gm)].map((match) => match[1].replace(/[?:.]+$/, ""));
  const matches = headings.length === GUIDE_SECTIONS.length && GUIDE_SECTIONS.every((section, index) => section.pattern.test(headings[index]));
  if (!matches) {
    fail(
      "depth",
      `content.guide needs these ### sections, in order: ${GUIDE_SECTIONS.map((section) => `"${section.name}"`).join(", ")}; it has ${headings.length ? headings.map((heading) => `"${heading}"`).join(", ") : "none"}`,
    );
  }
  if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(markdown)) fail("depth", "content.guide has a table; write a list instead");
  for (const [where, text] of strings(content, "content")) {
    for (const { word, us } of britishSpellings(text)) fail("spelling", `${where} spells "${word}" the British way (US: ${us})`);
  }
}

// A converter page's template FAQs vary by operation and by where the file
// is converted: in-browser and server-first converters, and in-browser and
// server compressors.
export const templateKey = (tool) => `${tool.operation}, ${runsInBrowser(tool) ? "in the browser" : "server first"}`;
export function templateTools(tools) {
  const byKey = new Map();
  for (const tool of tools.filter(onConverterPage)) if (!byKey.has(templateKey(tool))) byKey.set(templateKey(tool), tool);
  return [...byKey.values()];
}

// Every rule broken by the live converters and compressors in `tools`, as
// { toolId, rule, message }. An empty list passes.
export function checkContent(tools, { keywords }) {
  const failures = [];
  const converters = tools.filter(isConverter);
  const activeIds = new Set(tools.filter((tool) => tool.isActive).map((tool) => tool.id));
  const routes = liveRoutes(tools);
  const seen = { title: new Map(), h1: new Map(), description: new Map() };
  const answers = [];

  for (const tool of converters) {
    const fail = (rule, message) => failures.push({ toolId: tool.id, rule, message });
    const seo = toolSeo(tool);
    const keyword = keywords.get(tool.id);
    if (keyword) {
      if (!squash(seo.title).includes(squash(keyword))) fail("keyword", `title "${seo.title}" lacks the keyword "${keyword}"`);
      if (!squash(seo.h1).includes(squash(keyword))) fail("keyword", `H1 "${seo.h1}" lacks the keyword "${keyword}"`);
    }
    if (servedTitleLength(seo.title) > SEO_TITLE_MAX) {
      fail("length", `title is ${servedTitleLength(seo.title)} characters with "${SITE_TITLE_SUFFIX}", over ${SEO_TITLE_MAX}`);
    }
    if (seo.h1.length > SEO_TITLE_MAX) fail("length", `H1 is ${seo.h1.length} characters, over ${SEO_TITLE_MAX}`);
    if (/SERP Tools/i.test(seo.title)) fail("length", 'title names the site; the layout adds " | SERP Tools"');
    if (seo.description.length < DESCRIPTION_MIN || seo.description.length > DESCRIPTION_MAX) {
      fail("length", `description is ${seo.description.length} characters, outside ${DESCRIPTION_MIN}–${DESCRIPTION_MAX}`);
    }
    for (const field of ["title", "h1", "description"]) {
      const other = seen[field].get(seo[field]);
      if (other) fail("duplicate", `${field} is the same as ${other}'s: "${seo[field]}"`);
      else seen[field].set(seo[field], tool.id);
    }

    const content = tool.content;
    if (!content) continue;
    if (content.changelog) fail("invented", "content.changelog is present; converter pages have none");
    if (content.blogPosts) fail("invented", "content.blogPosts is present; converter pages have none");
    for (const link of contentLinks(content)) {
      if (link.toolId !== undefined) {
        if (!activeIds.has(link.toolId)) fail("link", `${link.where} names ${link.toolId}, which isn't a live Tool`);
        continue;
      }
      const href = (link.href ?? "").trim();
      if (!href || href.startsWith("#")) fail("link", `${link.where} links to "${href}"`);
      else if (!href.startsWith("/") || href.startsWith("//")) fail("link", `${link.where} links off the site: ${href}`);
      else if (!routes.has(canonicalPath(href.split(/[?#]/)[0]))) fail("link", `${link.where} links to ${href}, which isn't a live page`);
    }
    for (const [index, faq] of (content.faqs ?? []).entries()) {
      answers.push({ tool, where: `faqs[${index}]`, phrases: phrases(tool, faq.answer), checked: Boolean(content.seo) });
    }
    if (content.seo) requiredFields(tool, content, fail);
    if (content.seo?.howToHeading !== undefined) checkHowToHeading(tool, content, keyword, fail);
    else if (content.seo && content.howTo) checkWrittenHowTo(tool, content, keyword, fail);
    if (content.guide) checkDepth(content, fail);
  }

  // The template FAQs a page without curated FAQs shows, as another Tool's
  // would be: one Tool for each operation and each place the file is
  // converted (locationFacts in lib/tool-sections.ts), since each words its
  // answers differently.
  // An answer the templates share is compared once.
  const templateAnswers = new Set();
  for (const template of templateTools(converters)) {
    const label = `the template FAQs (${templateKey(template)}, as on ${template.id})`;
    for (const [index, faq] of buildConverterFaqs(template).entries()) {
      if (templateAnswers.has(faq.answer)) continue;
      templateAnswers.add(faq.answer);
      answers.push({ tool: { id: label }, where: `[${index}]`, phrases: phrases(template, faq.answer), checked: false });
    }
  }
  for (const answer of answers.filter((candidate) => candidate.checked)) {
    for (const other of answers) {
      if (other.tool.id === answer.tool.id) continue;
      const score = similarity(answer.phrases, other.phrases);
      if (score >= FAQ_SIMILARITY_MAX) {
        failures.push({
          toolId: answer.tool.id,
          rule: "faq-duplicate",
          message: `${answer.where} repeats ${other.tool.id} ${other.where} (similarity ${score.toFixed(2)}, limit ${FAQ_SIMILARITY_MAX})`,
        });
      }
    }
  }
  return failures;
}

// tools.json as text: each top-level entry's own text, so a write changes
// only the entries it means to. JSON strings hold no raw newline, so the
// boundary between two entries can't occur inside one.
const ENTRY_BOUNDARY = "\n  },\n  {\n";

export function splitRegistry(text) {
  if (!text.startsWith("[\n  {\n") || !text.endsWith("\n  }\n]\n")) {
    throw new Error("tools.json isn't in its usual layout: an array of 2-space indented objects");
  }
  const body = text.slice("[\n  {\n".length, -"\n  }\n]\n".length);
  return body.split(ENTRY_BOUNDARY).map((inner) => `  {\n${inner}\n  }`);
}

export function joinRegistry(entries) {
  return `[\n${entries.join(",\n")}\n]\n`;
}

// One entry as tools.json writes it: 2-space indent inside the array, and
// ASCII only, every other character as a lower-case \u escape.
export const serializeEntry = (entry) =>
  JSON.stringify(entry, null, 2)
    .replace(/[\u0080-￿]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function orderContent(content) {
  const ordered = {};
  for (const key of CONTENT_KEY_ORDER) if (content[key] !== undefined) ordered[key] = content[key];
  for (const [key, value] of Object.entries(content)) if (!(key in ordered) && value !== undefined) ordered[key] = value;
  return ordered;
}

// A Tool's content with a batch entry's fields written in.
function withBatchEntry(tool, entry) {
  const content = tool.content
    ? { ...tool.content }
    : {
        // The page a Tool without content showed, kept: its name stays the
        // fallback title, its file filter the same (converterAccept).
        tool: { title: tool.name, subtitle: tool.description, from: tool.from, to: tool.to, accept: converterAccept(tool.from) },
      };
  for (const field of BATCH_FIELDS) {
    if (entry[field] === undefined) continue;
    content[field] = field === "tool" ? { ...content.tool, ...entry.tool } : entry[field];
  }
  return { ...tool, content: orderContent(content) };
}

// Problems with a batch's shape: unknown or retired Tool ids, unknown fields.
export function batchProblems(batch, tools) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) return ["a batch is an object of Tool ids"];
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const problems = [];
  for (const [id, entry] of Object.entries(batch)) {
    const known = byId.get(id);
    if (!known) problems.push(`${id}: no Tool has this id`);
    else if (!known.isActive) problems.push(`${id}: the Tool is retired`);
    else if (isTranscriptionTool(known)) problems.push(`${id}: a transcription Tool; its copy is named in its own issue`);
    else if (!hasToolSeo(known)) problems.push(`${id}: not a converter or compressor (operation ${known.operation})`);
    const tool = known && isConverter(known) ? known : null;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push(`${id}: its entry must be an object`);
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!BATCH_FIELDS.includes(key)) problems.push(`${id}.${key}: not a batch field (${BATCH_FIELDS.join(", ")})`);
      else if (tool && !pageFields(tool).includes(key)) {
        problems.push(`${id}.${key}: this Tool's page doesn't show it (it shows ${pageFields(tool).join(", ")})`);
      }
    }
    for (const key of Object.keys(entry.tool ?? {})) {
      if (!BATCH_TOOL_FIELDS.has(key)) problems.push(`${id}.tool.${key}: a batch sets only tool.subtitle`);
    }
  }
  return problems;
}

// The registry text with a batch written in, the Tools it changed, and every
// problem: the batch's shape, the registry's shape, then checkContent over
// the whole catalog. `content:apply` writes the text only when there are none.
export function applyBatch(registryText, batch, context) {
  const entries = splitRegistry(registryText);
  const tools = entries.map((entry) => JSON.parse(entry));
  const problems = batchProblems(batch, tools);
  if (problems.length) return { text: registryText, changed: [], problems };

  const changed = [];
  const next = tools.map((tool, index) => {
    const entry = batch[tool.id];
    if (!entry) return tool;
    const updated = withBatchEntry(tool, entry);
    if (!deepEqual(updated, tool)) {
      entries[index] = serializeEntry(updated);
      changed.push(tool.id);
    }
    return updated;
  });
  const shape = validateCatalog(next);
  const failures = checkContent(next, context).map(({ toolId, rule, message }) => `${toolId} [${rule}] ${message}`);
  return { text: joinRegistry(entries), changed, problems: [...shape, ...failures] };
}

// A batch file's path: a name in content/batches, or a path to a .json file.
export function batchPath(appRoot, name) {
  if (name.endsWith(".json")) return path.resolve(name);
  return path.join(appRoot, BATCH_DIR, `${name}.json`);
}

// A batch read from disk, or the reason it can't be: no such file, not JSON,
// or not an object of Tool ids.
export function readBatch(appRoot, name) {
  const file = batchPath(appRoot, name);
  const shown = path.relative(appRoot, file);
  if (!existsSync(file)) return { error: `No batch file at apps/tools/${shown}.` };
  let batch;
  try {
    batch = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { error: `apps/tools/${shown} isn't valid JSON: ${error.message}` };
  }
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) {
    return { error: `apps/tools/${shown} must be an object keyed by Tool id.` };
  }
  return { batch };
}
