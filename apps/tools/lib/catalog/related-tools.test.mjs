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

// The links a Tool page gets, from its registry entry.
const linksFor = (tool) =>
  relatedToolLinks({
    toolId: tool.id,
    route: tool.route,
    from: tool.from,
    to: tool.to,
    curated: tool.content?.relatedTools,
  });

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

  assert.deepEqual(ids(fallbackRelatedTools(current, candidates)), ["3gp-to-avi", "mov-to-mp4", "compress-mp4"]);
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

test("the fallback lists the reverse pair, then the same source, then the same target, then the rest, in registry order within each", () => {
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
    "3gp-to-mov",
    "3gp-to-avi",
    "mov-to-mp4",
    "avi-to-mp4",
    "mp4-to-avi",
    "avi-to-3gp",
  ]);
});

test("the fallback stops at the cap, keeping the closest matches", () => {
  const current = entry("3gp-to-mp4", "convert", "3gp", "mp4");
  const sameTarget = Array.from({ length: 30 }, (_, i) => entry(`f${i}-to-mp4`, "convert", `f${i}`, "mp4"));
  const sameSource = Array.from({ length: 10 }, (_, i) => entry(`3gp-to-g${i}`, "convert", "3gp", `g${i}`));
  const listed = fallbackRelatedTools(current, [...sameTarget, ...sameSource]);

  assert.equal(listed.length, RELATED_TOOLS_LIMIT);
  assert.deepEqual(ids(listed.slice(0, 10)), ids(sameSource));
  assert.deepEqual(ids(listed.slice(10)), ids(sameTarget.slice(0, RELATED_TOOLS_LIMIT - 10)));
  assert.equal(fallbackRelatedTools(current, sameTarget, 5).length, 5);
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
    from: current.from,
    to: current.to,
    curated: [
      { toolId: current.id, title: "Itself" },
      { toolId: inactive.id, title: "Retired" },
      { href: inactive.route, title: "Retired by route" },
      { toolId: "mp4-to-3gp", title: "MP4 to 3GP" },
    ],
  });

  assert.deepEqual(ids(links), ["mp4-to-3gp"]);
});

test("a fallback list is at most 24 links, and no converter or compressor page links a Lander", () => {
  const fallbackPages = everyPageLinks().filter(([tool]) => !isCurated(tool));
  assert.ok(fallbackPages.length > 2000, "most Tool pages use the fallback");

  for (const [tool, links] of fallbackPages) {
    assert.ok(links.length > 0, `${tool.id} has no related Tools`);
    assert.ok(links.length <= RELATED_TOOLS_LIMIT, `${tool.id} lists ${links.length}`);
    for (const link of links) {
      const operation = getToolByRoute(link.href).operation;
      assert.ok(operation === "convert" || operation === "compress", `${tool.id} links ${link.href} (${operation})`);
    }
  }
});

test("/3gp-to-mp4/ lists MP4 to 3GP first, then other 3GP converters, and no Lander", () => {
  const links = linksFor(activeTools().find((tool) => tool.id === "3gp-to-mp4"));

  assert.equal(links.length, RELATED_TOOLS_LIMIT);
  assert.equal(links[0].href, "/mp4-to-3gp/");
  assert.ok(links.slice(1).every((link) => link.href.startsWith("/3gp-to-")));
  assert.ok(links.every((link) => !link.href.startsWith("/download-")));
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
    from: current.from,
    to: current.to,
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
