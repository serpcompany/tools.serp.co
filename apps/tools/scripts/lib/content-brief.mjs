// The Markdown brief `pnpm content:brief` hands a writer (#356): everything
// needed to write a batch of converter and compressor copy without opening the
// repository. Pure: the command reads the files and writes the brief.

import { toolHref } from "../../lib/catalog/href.ts";
import {
  SEO_TITLE_MAX,
  SITE_TITLE_SUFFIX,
  howToHeading,
  isTranscriptionTool,
  onConverterPage,
  servedTitleLength,
  toolSeo,
} from "../../lib/metadata.ts";
import { buildConverterFaqs } from "../../lib/tool-sections.ts";
import {
  BATCH_DIR,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  FAQS_MIN,
  HOW_TO_HEADING_MAX,
  PAIR_NOTES_MIN,
  isConverter,
  pageFields,
} from "./content.mjs";
import { converterPageFacts, engineFactsFor } from "./engine-facts.mjs";

const SITE = "https://tools.serp.co";

const list = (items) => items.map((item) => `- ${item}`).join("\n");
const json = (value) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
// A doc's text one heading level down, without its title, to sit under a
// brief heading. Fenced code is left alone.
function demote(text) {
  let fenced = false;
  return text
    .replace(/^# .*\n+/, "")
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) fenced = !fenced;
      return !fenced && /^#+ /.test(line) ? `#${line}` : line;
    })
    .join("\n")
    .trimEnd();
}
const number = (value) => (value === "" || value === undefined ? "no data" : Number(value).toLocaleString("en-US"));

// Each live Tool's row in the Tool status view, and the keywords whose page
// is another Tool's (alias rows), by that Tool's id.
export function statusIndex(rows) {
  const tools = new Map();
  const aliases = new Map();
  for (const row of rows) {
    if (row.tool_id) tools.set(row.tool_id, row);
    else if (row.alias_tool_id) {
      if (!aliases.has(row.alias_tool_id)) aliases.set(row.alias_tool_id, []);
      aliases.get(row.alias_tool_id).push(row);
    }
  }
  return { tools, aliases };
}

export const TOP_TERMS = 8;
export const TOP_QUESTIONS = 5;

const byVolume = (items) => [...(items ?? [])].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
const volumeLine = (item) => `- ${item.keyword}: ${number(item.volume)} a month`;

// The Tool's keyword variants and questions from benchmarks/keyword-ideas.json
// (the file may be missing, or lack the Tool).
function variantSection(idea, ideas) {
  const terms = byVolume(idea?.terms).slice(0, TOP_TERMS);
  const questions = byVolume(idea?.questions).slice(0, TOP_QUESTIONS);
  if (!terms.length && !questions.length) {
    return "No variant data for this Tool (benchmarks/keyword-ideas.json has none). Write the title, How-to heading and FAQs as the style guide says without it.";
  }
  const country = (ideas.country ?? "").toUpperCase();
  const lines = [`Source: ${ideas.source ?? "unknown"}${country ? `, ${country} volumes` : ""}.`];
  lines.push("", "Matching terms, biggest first:", "", terms.length ? terms.map(volumeLine).join("\n") : "None.");
  lines.push("", "Questions, biggest first:", "", questions.length ? questions.map(volumeLine).join("\n") : "None.");
  const howTo = questions.find((question) => /^how (to|do|can)\b/i.test(question.keyword));
  lines.push(
    "",
    "How to use them:",
    "",
    list([
      "The title keeps the head keyword and works in the biggest matching term where it fits.",
      howTo
        ? `\`seo.howToHeading\`: use the top "how to" question, "${howTo.keyword}", worded as a heading.`
        : "No \"how to\" question is listed: leave `seo.howToHeading` out.",
      "The FAQs answer the listed questions, not invented ones.",
    ]),
  );
  return lines.join("\n");
}

function keywordSection(row, aliases, idea, ideas) {
  const headVolume = idea?.volume;
  if (!row?.keyword && idea?.keyword) {
    return `- Keyword: **${idea.keyword}**, ${number(headVolume)} searches a month (${ideas.source ?? "keyword-ideas.json"}${ideas.country ? `, ${ideas.country.toUpperCase()}` : ""}). The Tool has no keyword in benchmarks/tool-status.csv.`;
  }
  if (!row?.keyword) return "No keyword is assigned to this Tool in benchmarks/tool-status.csv. Use the H1 pattern as it is.";
  const lines = [
    `- Keyword: **${row.keyword}** (${row.keyword_match} match), ${number(row.global_volume)} searches a month worldwide, ${number(row.us_volume)} in the US, keyword difficulty ${row.kd || "no data"}.`,
    `- Traffic potential: ${number(row.global_traffic_potential)} worldwide, ${number(row.us_traffic_potential)} in the US (${row.keyword_source}).`,
  ];
  for (const alias of aliases) {
    lines.push(`- Also searched as **${alias.keyword}**: ${number(alias.global_volume)} a month worldwide, ${number(alias.us_volume)} in the US.`);
  }
  if (row.alias_keywords && !aliases.length) {
    lines.push(`- Also searched as: ${row.alias_keywords} (${number(row.alias_global_volume)} a month in all).`);
  }
  return lines.join("\n");
}

// A format's entry, following `aliasOf` (jpeg is jpg, tif is tiff...) to the
// entry that holds the facts: { key, entry }, or null when there is none.
export function resolveAlias(format, formats) {
  let key = format;
  for (let hops = 0; hops < 5; hops++) {
    const entry = formats[key];
    if (!entry) return null;
    if (!entry.aliasOf) return { key, entry };
    key = entry.aliasOf;
  }
  return null;
}

function formatSection(tool, formats) {
  if (!formats) {
    return "The shared format reference (apps/tools/content/formats.json, #357) doesn't exist yet. Say nothing about a format that you can't source; don't write format history or trivia.";
  }
  return [...new Set([tool.from, tool.to])]
    .map((format) => {
      const target = resolveAlias(format, formats);
      if (!target) return `**${format}** has no entry in apps/tools/content/formats.json: say nothing about it beyond the engine facts.`;
      if (target.key === format) {
        return `**${format}** (apps/tools/content/formats.json, the only source for format facts):\n\n${json(target.entry)}`;
      }
      // The Tool's own format is an alias: show the target's facts under the
      // alias's name (the card stays "JPEG", not "JPG").
      const name = format.toUpperCase();
      return `**${name}** (apps/tools/content/formats.json, the only source for format facts; ${name} is another name for ${target.entry.name ?? target.key}, so these are its facts):\n\n${json({ ...target.entry, name })}`;
    })
    .join("\n\n");
}

function currentCopy(tool) {
  const seo = toolSeo(tool);
  const content = tool.content;
  const parts = [
    `- Title: ${seo.title} (${servedTitleLength(seo.title)} characters with the "${SITE_TITLE_SUFFIX}" the layout adds)`,
    `- H1: ${seo.h1}`,
    ...(onConverterPage(tool) ? [`- How-to heading: ${content?.howTo?.title ?? howToHeading(tool)}`] : []),
    `- Description: ${seo.description} (${seo.description.length} characters)`,
    `- Subtitle: ${content?.tool.subtitle ?? tool.description}`,
  ];
  if (!content) {
    parts.push("", "The page has no copy of its own: it shows the template How-to, About and these template FAQs.", "");
    parts.push(json(buildConverterFaqs(tool)));
    return parts.join("\n");
  }
  parts.push("", content.seo ? "The page's copy was written to the style guide." : "The page's copy predates the style guide: replace it.");
  for (const field of ["faqs", "aboutSection", "pairNotes"]) {
    if (content[field]) parts.push("", `${field}:`, "", json(content[field]));
  }
  return parts.join("\n");
}

// An entry to fill in, with only the fields the Tool's page shows.
function skeleton(tool) {
  const fields = pageFields(tool);
  const seo = toolSeo(tool);
  const entry = { seo: { title: seo.title, h1: seo.h1, description: "" } };
  if (fields.includes("tool")) entry.tool = { subtitle: "" };
  if (fields.includes("faqs")) entry.faqs = Array.from({ length: FAQS_MIN }, () => ({ question: "", answer: "" }));
  if (fields.includes("aboutSection") && tool.from !== tool.to) {
    const format = { name: "", fullName: "", description: "", details: [""] };
    entry.aboutSection = { title: "", fromFormat: format, toFormat: format };
  }
  if (fields.includes("pairNotes")) entry.pairNotes = { title: "", points: Array.from({ length: PAIR_NOTES_MIN }, () => "") };
  return { [tool.id]: entry };
}

function toolSection(tool, status, formats, ideas) {
  const row = status.tools.get(tool.id);
  const engine = row?.engine || null;
  const facts = engineFactsFor(tool, engine);
  const idea = ideas?.tools?.[tool.id];
  const lines = [
    `## ${tool.id}`,
    "",
    `${tool.operation === "compress" ? "Compressor" : "Converter"}, ${tool.from} to ${tool.to}. Live page: ${SITE}${toolHref(tool)}`,
    "",
    "### Keyword",
    "",
    keywordSection(row, status.aliases.get(tool.id) ?? [], idea, ideas),
    "",
    "### Variants and questions",
    "",
    variantSection(idea, ideas),
    "",
    "### Engine and execution path",
    "",
    `- Engine: ${engine ?? "not in the Tool status view"}; runs ${row?.processing_location || "unknown"}.`,
    `- Last sweep: ${row?.sweep_status || "not run"}${row?.sweep_note ? ` (${row.sweep_note})` : ""}.${row?.sweep_status && row.sweep_status !== "pass" ? " **The Tool doesn't pass its sweep: write nothing that promises it works, and tell the owner.**" : ""}`,
    `- ${facts.where}`,
  ];
  const pageFacts = onConverterPage(tool) ? converterPageFacts(tool) : [];
  if (pageFacts.length || facts.facts.length) {
    lines.push("", "What the code does (state only these, in your own words):", "", list([...pageFacts, ...facts.facts]));
  }
  if (!onConverterPage(tool)) {
    lines.push("", `This Tool has its own page, not the converter page: a batch sets only ${pageFields(tool).join(", ")} for it.`);
  }
  if (facts.command) lines.push("", "The FFmpeg command, built by lib/convert/ffmpeg-args.ts:", "", "```", facts.command, "```");
  if (facts.unsettled.length) {
    lines.push("", "Not settled by the code (don't claim any of these):", "", list(facts.unsettled));
  }
  lines.push(
    "",
    "### Format reference",
    "",
    formatSection(tool, formats),
    "",
    "### Current copy",
    "",
    currentCopy(tool),
    "",
    "### Your entry",
    "",
    "Fill in every empty field. The title (a verb phrase) and H1 (a noun phrase) below are the default: keep them, or rewrite both in the same shape when the keyword or an alias has a noun the default lacks (optimizer, generator, \"to X online\"):",
    "",
    json(skeleton(tool)),
  );
  return lines.join("\n");
}

// Problems with the ids asked for: unknown, retired, or not on the converter
// page.
export function briefProblems(ids, tools) {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  return ids.flatMap((id) => {
    const tool = byId.get(id);
    if (!tool) return [`${id}: no Tool has this id`];
    if (!tool.isActive) return [`${id}: the Tool is retired`];
    if (isTranscriptionTool(tool)) return [`${id}: a transcription Tool; its copy is named in its own issue`];
    if (!isConverter(tool)) return [`${id}: not a converter or compressor (operation ${tool.operation})`];
    return [];
  });
}

// The whole brief: what to deliver, the style guide, one finished example,
// then a section per Tool.
export function buildBrief({ name, ids, tools, statusRows, formats, styleGuide, examples, readDoc, keywordIdeas = null }) {
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const selected = ids.map((id) => byId.get(id));
  const status = statusIndex(statusRows);
  const usesFfmpeg = selected.some((tool) => (status.tools.get(tool.id)?.engine ?? "").includes("ffmpeg"));
  const exampleId = usesFfmpeg && examples["mp4-to-mp3"] ? "mp4-to-mp3" : Object.keys(examples)[0];
  const docs = [
    ...new Set(selected.map((tool) => engineFactsFor(tool, status.tools.get(tool.id)?.engine || null).doc).filter(Boolean)),
  ];
  const appendix = docs.flatMap((doc) => [
    `## Appendix: ${doc}`,
    "",
    "The engine's behaviour as the repository documents it from the code:",
    "",
    demote(readDoc(doc)),
    "",
  ]);
  return [
    `# Converter copy brief: ${name}`,
    "",
    `${selected.length} Tool(s): ${ids.join(", ")}.`,
    "",
    "## What to deliver",
    "",
    list([
      `One JSON file, \`apps/tools/${BATCH_DIR}/${name}.json\`, holding an entry for each Tool below, shaped like the example and the "Your entry" skeletons.`,
      `Title and H1 must contain the Tool's keyword, and take their noun from it (see "Titles, H1s and descriptions" in the style guide); the title is at most ${SEO_TITLE_MAX} characters with the "${SITE_TITLE_SUFFIX}" the layout adds, so ${SEO_TITLE_MAX - SITE_TITLE_SUFFIX.length} of your own, and never names the site. The description is ${DESCRIPTION_MIN}–${DESCRIPTION_MAX} characters.`,
      `The title keeps the Tool's head keyword and works in the biggest matching term from its "Variants and questions" where it fits. FAQs answer the listed questions, not invented ones. A Tool with "No variant data" follows the style guide alone.`,
      `\`seo.howToHeading\` is optional and replaces a converter page's generated How-to heading: use the top "how to" question from the Tool's "Variants and questions" when there is one (else a "how to" keyword or alias keyword above), worded as a heading, else leave it out. It contains each word of the keyword and is at most ${HOW_TO_HEADING_MAX} characters.`,
      `At least ${FAQS_MIN} FAQs and ${PAIR_NOTES_MIN} pair notes, each specific to its Tool: an answer that could sit on another Tool's page fails the check.`,
      "Every claim comes from this brief's engine facts or format reference. Nothing else: no dates, versions, statistics, or links off the site.",
      `Check it with \`pnpm content:check --batch ${name}\`, which writes nothing. The owner's side applies it with \`pnpm content:apply ${name}\`.`,
    ]),
    "",
    "## Style guide",
    "",
    demote(styleGuide),
    "",
    `## Example: ${exampleId}`,
    "",
    "A finished entry, already on the live page:",
    "",
    json({ [exampleId]: examples[exampleId] }),
    "",
    ...selected.map((tool) => toolSection(tool, status, formats, keywordIdeas)),
    "",
    ...appendix,
  ].join("\n");
}
