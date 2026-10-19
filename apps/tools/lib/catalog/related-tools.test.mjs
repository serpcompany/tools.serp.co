import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { activeTools, allTools, getToolByRoute } from "./catalog.ts";
import { toolHref } from "./href.ts";
import { TABLE_CONVERT_PAGES } from "../table-convert-pages.ts";
import {
  LANDER_RELATED_LIMIT,
  RELATED_TOOLS_LIMIT,
  fallbackRelatedTools,
  landerRelatedTools,
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

// Every converter and compressor page (app/(convert)/[tool]/page.tsx and the
// folder routes beside it).
const toolPages = activeTools().filter(
  (tool) => (tool.operation === "convert" || tool.operation === "compress") && tool.from && tool.to,
);

// Each folder route's href and its page.tsx source.
const folderPageSources = () => {
  const sources = new Map();
  const walk = (dir, path) => {
    for (const name of readdirSync(dir)) {
      const child = join(dir, name);
      if (name.startsWith("[") || !statSync(child).isDirectory()) continue;
      const childPath = name.startsWith("(") ? path : `${path}${name}/`;
      try {
        sources.set(childPath, readFileSync(join(child, "page.tsx"), "utf8"));
      } catch {
        // No page here; its subfolders may have one.
      }
      walk(child, childPath);
    }
  };
  walk(fileURLToPath(new URL("../../app/", import.meta.url)), "/");
  return sources;
};
const hrefsWhose = (matches) =>
  new Set([...folderPageSources()].filter(([, source]) => matches(source)).map(([href]) => href));

// The hrefs of folder routes that render a Tool page without ToolPageRenderer,
// and so without a Related Tools section: table converters and transcription.
const otherTemplateHrefs = () => hrefsWhose((source) => !source.includes("ToolPageRenderer"));

// The hrefs of folder routes that render the "More Table Converters" section
// (TableConvertLinksSection), itself or through TableConvertLanding.
const tableLinksHrefs = () => {
  const landing = readFileSync(new URL("../../components/table-convert/TableConvertLanding.tsx", import.meta.url), "utf8");
  assert.ok(landing.includes("<TableConvertLinksSection"), "TableConvertLanding renders TableConvertLinksSection");
  return hrefsWhose((source) => source.includes("<TableConvertLinksSection") || source.includes("<TableConvertLanding"));
};
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

test("every converter and compressor page is on another page's rendered list, but for table converters that link each other", () => {
  const otherTemplates = otherTemplateHrefs();
  assert.ok(otherTemplates.has("/csv-to-json/") && otherTemplates.has("/mp4-to-transcript/"));
  assert.ok(!otherTemplates.has("/mp4-to-mov/"), "a ToolPageRenderer folder route renders the section");

  const linked = new Set();
  for (const [tool, links] of everyPageLinks()) {
    if (otherTemplates.has(toolHref(tool))) continue;
    for (const link of links) if (link.href !== toolHref(tool)) linked.add(link.href);
  }

  // A table converter page that renders "More Table Converters" lists every
  // other one, so a visitor or crawler reaches them all once one is linked. A
  // table converter page without that section gets no exemption.
  const tableLinks = tableLinksHrefs();
  const linkEachOther = new Set(
    TABLE_CONVERT_PAGES.map((page) => `/${page.slug}/`).filter((href) => tableLinks.has(href)),
  );
  assert.ok(tableLinks.has("/csv-to-json/") && tableLinks.has("/json-to-csv/"));

  const unlinked = toolPages.map(toolHref).filter((href) => !linked.has(href));
  assert.deepEqual(unlinked.filter((href) => !linkEachOther.has(href)), []);
  assert.ok(
    [...linkEachOther].some((href) => linked.has(href)),
    "no table converter page with a More Table Converters section is on a rendered list",
  );
});

test("a page's fallback list doesn't depend on registry order", () => {
  const reversed = activeTools().toReversed();
  for (const tool of toolPages.filter((page) => !isCurated(page))) {
    assert.deepEqual(ids(fallbackRelatedTools(tool, reversed)), ids(fallbackRelatedTools(tool, activeTools())), tool.id);
  }
});

// Today these are transcription Tools, whose own pages render no section; the
// rule keeps a ToolPageTemplate page with relabelled formats from losing its list.
test("a Tool whose content names other formats than its registry entry still gets its list", () => {
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

// Landers (issue #349). Every active download Tool's page renders
// DownloaderPageTemplate, and with it a Related Tools section.
const landerPages = activeTools().filter((tool) => tool.operation === "download");
const lander = (id, isActive = true) => entry(`download-${id}-videos`, "download", id, "mp4", isActive);
// A ring of Landers with ids in order: download-s000-videos, download-s001-videos ...
const landerRing = (count) => Array.from({ length: count }, (_, i) => lander(`s${String(i).padStart(3, "0")}`));

test("a Lander lists 8 other Landers, more than the 3 links each needs", () => {
  assert.equal(LANDER_RELATED_LIMIT, 8);
});

test("on any ring of Landers, each lists the limit or all the others, never itself or one twice, and is listed as often", () => {
  for (const count of [1, 2, 3, 8, 9, 10, 17, 50, 291, 292, 293]) {
    for (const limit of [3, LANDER_RELATED_LIMIT]) {
      const ring = landerRing(count);
      const expected = Math.min(limit, count - 1);
      const listedBy = new Map(ring.map((tool) => [tool.id, 0]));
      for (const tool of ring) {
        const listed = ids(landerRelatedTools(tool, ring, limit));
        assert.equal(listed.length, expected, `${tool.id} on a ring of ${count}`);
        assert.equal(new Set(listed).size, listed.length, `${tool.id} lists a Lander twice`);
        assert.ok(!listed.includes(tool.id), `${tool.id} lists itself`);
        for (const id of listed) listedBy.set(id, listedBy.get(id) + 1);
      }
      for (const [id, times] of listedBy) assert.equal(times, expected, `${id} on a ring of ${count}, limit ${limit}`);
    }
  }
});

test("a Lander's list spans the ring, sorted by id, rather than naming its neighbours", () => {
  // 90 Landers, 8 places: a stride of 10.
  const ring = landerRing(90);
  const listed = (index) => ids(landerRelatedTools(ring[index], ring));

  assert.deepEqual(listed(0), [10, 20, 30, 40, 50, 60, 70, 80].map((i) => `download-s0${i}-videos`));
  assert.deepEqual(listed(85), [5, 15, 25, 35, 45, 55, 65, 75].map((i) => `download-s0${String(i).padStart(2, "0")}-videos`));
});

test("a Lander lists only active Landers, the same whatever the registry order", () => {
  const ring = landerRing(20);
  const candidates = [
    ...ring,
    lander("retired", false),
    entry("mov-to-mp4", "convert", "mov", "mp4"),
    entry("compress-mp4", "compress", "mp4", "mp4"),
    entry("mp4-combiner", "combine", "mp4", "mp4"),
  ];

  for (const tool of ring) {
    const listed = landerRelatedTools(tool, candidates);
    assert.equal(listed.length, LANDER_RELATED_LIMIT);
    assert.ok(listed.every((other) => other.operation === "download" && other.isActive), tool.id);
    assert.deepEqual(ids(landerRelatedTools(tool, candidates.toReversed())), ids(listed), tool.id);
  }
});

test("every Lander page lists 8 other active Landers, and every active Lander is on exactly 8 Lander pages' lists", () => {
  assert.ok(landerPages.length > 250, "the registry has its Landers");
  const listedOn = new Map(landerPages.map((tool) => [toolHref(tool), new Set()]));

  for (const tool of landerPages) {
    const links = linksFor(tool);
    assert.equal(links.length, LANDER_RELATED_LIMIT, tool.id);
    for (const link of links) {
      assert.notEqual(link.href, toolHref(tool), `${tool.id} links itself`);
      assert.equal(getToolByRoute(link.href)?.operation, "download", `${tool.id} links ${link.href}`);
      listedOn.get(link.href).add(tool.id);
    }
  }
  for (const [href, listers] of listedOn) {
    assert.equal(listers.size, LANDER_RELATED_LIMIT, `${href} is on ${listers.size} Lander pages' lists`);
  }
});

test("every Lander page renders the Related Tools section for its own Tool", () => {
  const template = readFileSync(new URL("../../components/DownloaderPageTemplate.tsx", import.meta.url), "utf8");
  assert.match(
    template,
    /<RelatedToolsSection\s+currentToolId=\{toolId\}\s+currentRoute=\{content\.tool\.route\}\s+relatedTools=\{content\.relatedTools\}\s*\/>/,
  );

  // A Lander with its own folder renders the template with its own id; the
  // others go through the shared route's DownloaderPageRenderer.
  const shared = readFileSync(new URL("../../app/(convert)/[tool]/page.tsx", import.meta.url), "utf8");
  assert.match(shared, /tool\.operation === "download"\) \{\s*return <DownloaderPageRenderer toolId=\{toolId\} \/>/);
  const renderer = readFileSync(new URL("../../components/DownloaderPageRenderer.tsx", import.meta.url), "utf8");
  assert.match(renderer, /<DownloaderPageTemplate toolId=\{toolId\}/);
  const folders = folderPageSources();
  const ownFolders = landerPages.filter((tool) => folders.has(toolHref(tool)));
  assert.ok(ownFolders.length > 0);
  for (const tool of ownFolders) {
    const source = folders.get(toolHref(tool));
    assert.match(source, /<DownloaderPageTemplate toolId=\{toolId\}/, tool.id);
    assert.ok(source.includes(`const toolId = "${tool.id}";`), tool.id);
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
