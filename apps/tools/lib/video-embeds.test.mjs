import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const videoEmbedsSource = readFileSync(
  new URL("./video-embeds.ts", import.meta.url),
  "utf8",
);
const toolPageTemplateSource = readFileSync(
  new URL("../components/ToolPageTemplate.tsx", import.meta.url),
  "utf8",
);
const csvCombinerPageSource = readFileSync(
  new URL("../app/csv-combiner/page.tsx", import.meta.url),
  "utf8",
);
const characterCounterPageSource = readFileSync(
  new URL("../app/character-counter/page.tsx", import.meta.url),
  "utf8",
);
const jsonToCsvPageSource = readFileSync(
  new URL("../app/(convert)/json-to-csv/page.tsx", import.meta.url),
  "utf8",
);
const batchCompressPngPageSource = readFileSync(
  new URL("../app/(compress)/(batch)/batch-compress-png/page.tsx", import.meta.url),
  "utf8",
);
const landerHeroSource = readFileSync(
  new URL("../components/LanderHeroTwoColumn.tsx", import.meta.url),
  "utf8",
);
const toolVideoPanelSource = readFileSync(
  new URL("../components/ToolVideoPanel.tsx", import.meta.url),
  "utf8",
);
const videoSectionSource = readFileSync(
  new URL("../components/sections/VideoSection.tsx", import.meta.url),
  "utf8",
);

function loadVideoEmbeds(source) {
  const sourceWithStubbedCoep = source.replace(
    'import { requiresCoepForTool } from "@/lib/coep";',
    "const requiresCoepForTool = (tool?: { requiresCoepForTest?: boolean }) => Boolean(tool?.requiresCoepForTest);",
  );
  const compiled = ts.transpileModule(sourceWithStubbedCoep, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: testModule,
    exports: testModule.exports,
  });
  return testModule.exports;
}

test("YouTube demo embeds are disabled by the shared gate", () => {
  const { getEnabledVideoEmbedId, YOUTUBE_DEMO_EMBEDS_ENABLED } =
    loadVideoEmbeds(videoEmbedsSource);

  assert.equal(YOUTUBE_DEMO_EMBEDS_ENABLED, false);
  assert.equal(
    getEnabledVideoEmbedId({
      tool: { title: "CSV Combiner", from: "csv", to: "csv" },
      videoSection: { embedId: "Yoglg9pNRc8" },
    }),
    undefined,
  );
});

test("COEP-required tools are blocked before receiving enabled YouTube embed IDs", () => {
  const enabledSource = videoEmbedsSource.replace(
    "YOUTUBE_DEMO_EMBEDS_ENABLED = false",
    "YOUTUBE_DEMO_EMBEDS_ENABLED = true",
  );
  const { getEnabledVideoEmbedId } = loadVideoEmbeds(enabledSource);

  assert.equal(
    getEnabledVideoEmbedId({
      tool: {
        title: "Video to Transcript",
        from: "video",
        to: "transcript",
        requiresCoepForTest: true,
      },
      videoSection: { embedId: "GTaOBy7mxF0" },
    }),
    undefined,
  );
  assert.equal(
    getEnabledVideoEmbedId({
      tool: { title: "CSV Combiner", from: "csv", to: "csv" },
      videoSection: { embedId: " Yoglg9pNRc8 " },
    }),
    "Yoglg9pNRc8",
  );
});

test("tool landers route video embeds through the shared gate", () => {
  for (const source of [
    toolPageTemplateSource,
    csvCombinerPageSource,
    characterCounterPageSource,
    jsonToCsvPageSource,
    batchCompressPngPageSource,
  ]) {
    assert.match(source, /getEnabledVideoEmbedId/);
    assert.doesNotMatch(source, /requiresCoepForTool/);
  }

  assert.doesNotMatch(toolPageTemplateSource, /videoSection\.embedId/);
  assert.doesNotMatch(csvCombinerPageSource, /content\.videoSection\.embedId/);
});

test("video components do not create fallback YouTube iframes without IDs", () => {
  assert.doesNotMatch(landerHeroSource, /videoEmbedId\s*=\s*"bbkhxMpIH4w"/);
  assert.match(landerHeroSource, /\{videoEmbedId \? \(/);

  assert.match(toolVideoPanelSource, /embedId\?: string/);
  assert.match(toolVideoPanelSource, /if \(!embedId\) return null;/);

  assert.match(videoSectionSource, /embedId\?: string/);
  assert.match(videoSectionSource, /if \(!embedId\) return null;/);
});
