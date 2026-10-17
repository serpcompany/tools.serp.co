import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { activeTools, allTools, getToolByRoute } from "./catalog.ts";
import { toolHref } from "./href.ts";
import {
  RELATED_TOOLS_LIMIT,
  fallbackRelatedTools,
  relatedToolLinks,
} from "./related-tools.ts";

// A registry entry with only the fields the fallback reads.
const entry = (id, operation, from, to, isActive = true) => ({
  id,
  operation,
  from,
  to,
  route: `/${id}`,
  isActive,
});
const ids = (tools) => tools.map((tool) => tool.id);

// The links a Tool page gets, from what its page passes: ToolPageRenderer
// sets the content's id and route to the registry's (lib/tool-content.ts), and
// RelatedToolsSection forwards those and the curated list.
const linksFor = (tool) =>
  relatedToolLinks({ toolId: tool.id, route: tool.route, curated: tool.content?.relatedTools });

// Every page ToolPageTemplate renders the section on: converters and
// compressors with both formats (app/(convert)/[tool]/page.tsx).
const toolPages = activeTools().filter(
  (tool) => (tool.operation === "convert" || tool.operation === "compress") && tool.from && tool.to,
);
const isCurated = (tool) => (tool.content?.relatedTools?.length ?? 0) > 0;

// Each page's links, worked out once for the tests that check every page.
let everyPage;
const everyPageLinks = () => (everyPage ??= toolPages.map((tool) => [tool, linksFor(tool)]));

test("the fallback cap is 24", () => {
  assert.equal(RELATED_TOOLS_LIMIT, 24);
});

test("a converter's fallback lists converters and compressors, never Landers or other operations", () => {
  const current = entry("3gp-to-mp4", "convert", "3gp", "mp4");
  const candidates = [
    entry("download-vimeo-videos", "download", "Vimeo", "mp4"),
    entry("mov-to-mp4", "convert", "mov", "mp4"),
    entry("compress-mp4", "compress", "mp4", "mp4"),
    entry("mp4-combiner", "combine", "mp4", "mp4"),
    entry("video-editor", "video-editor", "mp4", "mp4"),
    entry("3gp-to-avi", "convert", "3gp", "avi"),
  ];

  assert.deepEqual(ids(fallbackRelatedTools(current, candidates)), ["3gp-to-avi", "compress-mp4", "mov-to-mp4"]);
});

test("a compressor's fallback lists converters too", () => {
  const current = entry("compress-mp4", "compress", "mp4", "mp4");
  const candidates = [
    entry("download-vimeo-videos", "download", "Vimeo", "mp4"),
    entry("mp4-to-mov", "convert", "mp4", "mov"),
  ];

  assert.deepEqual(ids(fallbackRelatedTools(current, candidates)), ["mp4-to-mov"]);
});

test("a Lander's fallback lists Landers only", () => {
  const current = entry("download-vimeo-videos", "download", "Vimeo", "mp4");
  const candidates = [
    entry("mov-to-mp4", "convert", "mov", "mp4"),
    entry("compress-mp4", "compress", "mp4", "mp4"),
    entry("download-loom-videos", "download", "Loom", "mp4"),
    entry("download-wistia-videos", "download", "Wistia", "mp4"),
  ];

  assert.deepEqual(ids(fallbackRelatedTools(current, candidates)), ["download-loom-videos", "download-wistia-videos"]);
});

test("the fallback lists the reverse pair, then the same source, then the same target, then the rest, by id within each", () => {
  const current = entry("3gp-to-mp4", "convert", "3gp", "mp4");
  const candidates = [
    entry("avi-to-3gp", "convert", "avi", "3gp"), // into the source format
    entry("mp4-to-avi", "convert", "mp4", "avi"), // onward from the target format
    entry("mov-to-mp4", "convert", "mov", "mp4"), // same target
    entry("3gp-to-mov", "convert", "3gp", "mov"), // same source
    entry("mov-to-avi", "convert", "mov", "avi"), // no shared format
    entry("mp4-to-3gp", "convert", "mp4", "3gp"), // the reverse pair
    entry("3gp-to-avi", "convert", "3gp", "avi"), // same source
    entry("avi-to-mp4", "convert", "avi", "mp4"), // same target
  ];

  assert.deepEqual(ids(fallbackRelatedTools(current, candidates)), [
    "mp4-to-3gp",
    "3gp-to-avi",
    "3gp-to-mov",
    "avi-to-mp4",
    "mov-to-mp4",
    "mp4-to-avi",
    "avi-to-3gp",
  ]);
});

// Synthetic groups for a 3GP to MP4 page.
const group = (count, make) => Array.from({ length: count }, (_, i) => make(String(i).padStart(2, "0")));
const sameSource = (count) => group(count, (i) => entry(`3gp-to-g${i}`, "convert", "3gp", `g${i}`));
const sameTarget = (count) => group(count, (i) => entry(`f${i}-to-mp4`, "convert", `f${i}`, "mp4"));
const onward = (count) => group(count, (i) => entry(`mp4-to-h${i}`, "convert", "mp4", `h${i}`));
const into = (count) => group(count, (i) => entry(`k${i}-to-3gp`, "convert", `k${i}`, "3gp"));
const countBy = (tools, prefix) => tools.filter((tool) => tool.id.startsWith(prefix)).length;

test("the same source and same target groups share the 24 places", () => {
  const current = entry("3gp-to-mp4", "convert", "3gp", "mp4");
  const reverse = entry("mp4-to-3gp", "convert", "mp4", "3gp");
  const listed = fallbackRelatedTools(current, [...sameSource(30), ...sameTarget(30), ...onward(30), reverse]);

  assert.equal(listed.length, RELATED_TOOLS_LIMIT);
  assert.equal(listed[0].id, "mp4-to-3gp");
  assert.equal(countBy(listed, "3gp-to-"), 12);
  assert.equal(countBy(listed, "f"), 11);
  assert.equal(countBy(listed, "mp4-to-h"), 0);
  assert.ok(listed.slice(1, 13).every((tool) => tool.id.startsWith("3gp-to-")));
  assert.equal(fallbackRelatedTools(current, sameTarget(30), 5).length, 5);
});

test("a group short of its share leaves the rest to the others, and the other groups fill only what is left", () => {
  const current = entry("3gp-to-mp4", "convert", "3gp", "mp4");

  const fewSources = fallbackRelatedTools(current, [...sameSource(4), ...sameTarget(30), ...onward(30)]);
  assert.equal(countBy(fewSources, "3gp-to-"), 4);
  assert.equal(countBy(fewSources, "f"), 20);

  const fewBoth = fallbackRelatedTools(current, [...sameSource(3), ...sameTarget(3), ...onward(30), ...into(30)]);
  assert.equal(fewBoth.length, RELATED_TOOLS_LIMIT);
  assert.equal(countBy(fewBoth, "mp4-to-h"), 9);
  assert.equal(countBy(fewBoth, "k"), 9);
  assert.deepEqual(ids(fewBoth.slice(0, 6)), [...ids(sameSource(3)), ...ids(sameTarget(3))]);
});

test("which Tools fill a group's places is fixed per page, varies between pages and ignores registry order", () => {
  const candidates = [...sameSource(30), ...sameTarget(30)];
  const listFor = (id, tools = candidates) => ids(fallbackRelatedTools(entry(id, "convert", "3gp", "mp4"), tools));

  // A pinned list: the same on every run and every machine.
  assert.deepEqual(listFor("3gp-to-mp4"), [
    "3gp-to-g03", "3gp-to-g06", "3gp-to-g07", "3gp-to-g08", "3gp-to-g09", "3gp-to-g15",
    "3gp-to-g16", "3gp-to-g18", "3gp-to-g20", "3gp-to-g21", "3gp-to-g25", "3gp-to-g26",
    "f00-to-mp4", "f03-to-mp4", "f08-to-mp4", "f09-to-mp4", "f13-to-mp4", "f18-to-mp4",
    "f21-to-mp4", "f22-to-mp4", "f23-to-mp4", "f25-to-mp4", "f27-to-mp4", "f28-to-mp4",
  ]);
  assert.deepEqual(listFor("3gp-to-mp4", candidates.toReversed()), listFor("3gp-to-mp4"));
  assert.notDeepEqual(listFor("another-3gp-to-mp4"), listFor("3gp-to-mp4"));
});
test("the fallback never lists the current Tool or an inactive one", () => {
  const current = entry("3gp-to-mp4", "convert", "3gp", "mp4");
  const candidates = [
    entry("3gp-to-mp4", "convert", "3gp", "mp4"),
    entry("mp4-to-3gp", "convert", "mp4", "3gp", false),
    entry("3gp-to-avi", "convert", "3gp", "avi"),
  ];

  assert.deepEqual(ids(fallbackRelatedTools(current, candidates)), ["3gp-to-avi"]);
});

test("no Tool page links itself or a Tool that isn't active", () => {
  for (const [tool, links] of everyPageLinks()) {
    for (const link of links) {
      assert.notEqual(link.id, tool.id, `${tool.id} links itself`);
      assert.notEqual(link.href, toolHref(tool), `${tool.id} links itself`);
      assert.ok(getToolByRoute(link.href), `${tool.id} links ${link.href}, which is no active Tool`);
    }
  }
});

test("a curated list naming the current Tool or an inactive Tool drops them", () => {
  const current = activeTools().find((tool) => tool.id === "3gp-to-mp4");
  const inactive = allTools().find((tool) => !tool.isActive);
  const links = relatedToolLinks({
    toolId: current.id,
    route: current.route,
    curated: [
      { toolId: current.id, title: "Itself" },
      { toolId: inactive.id, title: "Retired" },
      { href: inactive.route, title: "Retired by route" },
      { toolId: "mp4-to-3gp", title: "MP4 to 3GP" },
    ],
  });

  assert.deepEqual(ids(links), ["mp4-to-3gp"]);
});

test("every Tool page lists 1 to 24 links and no Lander, and a fallback lists only converters and compressors", () => {
  const fallbackPages = everyPageLinks().filter(([tool]) => !isCurated(tool));
  assert.ok(fallbackPages.length > 2000, "most Tool pages use the fallback");

  for (const [tool, links] of everyPageLinks()) {
    assert.ok(links.length > 0, `${tool.id} has no related Tools`);
    assert.ok(links.length <= RELATED_TOOLS_LIMIT, `${tool.id} lists ${links.length}`);
    for (const link of links) {
      const operation = getToolByRoute(link.href).operation;
      assert.notEqual(operation, "download", `${tool.id} links the Lander ${link.href}`);
      if (isCurated(tool)) continue;
      assert.ok(operation === "convert" || operation === "compress", `${tool.id} links ${link.href} (${operation})`);
    }
  }
});

test("every converter and compressor page is linked from another page's list", () => {
  const linked = new Set();
  for (const [tool, links] of everyPageLinks()) {
    for (const link of links) if (link.href !== toolHref(tool)) linked.add(link.href);
  }
  const unlinked = toolPages.filter((tool) => !linked.has(toolHref(tool))).map((tool) => tool.id);

  assert.deepEqual(unlinked, []);
});

test("a page's fallback list doesn't depend on registry order", () => {
  const reversed = activeTools().toReversed();
  for (const tool of toolPages.filter((page) => !isCurated(page))) {
    assert.deepEqual(ids(fallbackRelatedTools(tool, reversed)), ids(fallbackRelatedTools(tool, activeTools())), tool.id);
  }
});

test("a page whose content names other formats than its registry entry still gets its list", () => {
  const relabelled = toolPages.filter(
    (tool) => tool.content?.tool && (tool.content.tool.from !== tool.from || tool.content.tool.to !== tool.to),
  );
  assert.ok(relabelled.some((tool) => tool.id === "mp4-to-transcript"));

  for (const tool of relabelled) {
    const links = linksFor(tool);
    assert.ok(links.length > 0, `${tool.id} has no related Tools`);
    assert.ok(
      links.some((link) => link.href.startsWith(`/${tool.from}-to-`) || link.href.endsWith(`-to-${tool.to}/`)),
      `${tool.id} lists nothing that shares ${tool.from} or ${tool.to}`,
    );
  }
});

test("/3gp-to-mp4/ lists MP4 to 3GP first, then 3GP converters, then MP4 converters, and no Lander", () => {
  const links = linksFor(activeTools().find((tool) => tool.id === "3gp-to-mp4"));

  assert.equal(links.length, RELATED_TOOLS_LIMIT);
  assert.equal(links[0].href, "/mp4-to-3gp/");
  assert.ok(links.slice(1, 13).every((link) => link.href.startsWith("/3gp-to-")));
  assert.ok(links.slice(13).every((link) => link.href.endsWith("-to-mp4/")));
});

test("a Lander's list is other Landers", () => {
  const lander = activeTools().find((tool) => tool.id === "download-vimeo-videos");
  const links = linksFor(lander);

  assert.equal(links.length, RELATED_TOOLS_LIMIT);
  for (const link of links) {
    assert.notEqual(link.id, lander.id);
    assert.equal(getToolByRoute(link.href).operation, "download", link.href);
  }
});

test("a curated list renders as written: in order, with its titles, and uncapped", () => {
  const activeById = new Map(activeTools().map((tool) => [tool.id, tool]));
  const curatedPages = toolPages.filter(isCurated);
  assert.ok(curatedPages.length > 0);

  for (const tool of curatedPages) {
    const expected = tool.content.relatedTools
      .filter((related) => related.toolId !== tool.id && activeById.has(related.toolId))
      .map((related) => {
        const linked = activeById.get(related.toolId);
        return {
          id: linked.id,
          name: related.title || linked.name,
          description: related.description ?? linked.description,
          href: toolHref(linked),
        };
      });
    assert.deepEqual(linksFor(tool), expected, tool.id);
  }

  const many = toolPages.slice(0, RELATED_TOOLS_LIMIT + 6);
  const current = activeTools().find((tool) => tool.id === "mp4-to-mp3");
  const links = relatedToolLinks({
    toolId: current.id,
    route: current.route,
    curated: many.map((tool) => ({ toolId: tool.id, title: tool.name })),
  });
  assert.deepEqual(ids(links), ids(many.filter((tool) => tool.id !== current.id)));
});

test("RelatedToolsSection renders the links relatedToolLinks returns", () => {
  const source = readFileSync(new URL("../../components/sections/RelatedToolsSection.tsx", import.meta.url), "utf8");

  assert.match(source, /relatedToolLinks\(\{/);
  assert.match(source, /href=\{tool\.href\}/);
  assert.doesNotMatch(source, /activeTools/);
});
