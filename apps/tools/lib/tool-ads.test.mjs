import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const toolAdsSource = readFileSync(new URL("../components/ToolAds.tsx", import.meta.url), "utf8");
const toolHeroLayoutSource = readFileSync(
  new URL("../components/ToolHeroLayout.tsx", import.meta.url),
  "utf8",
);

// A component compiled and run with its app imports replaced by `stubs`.
function loadComponent(source, stubs) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const componentModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: componentModule,
    exports: componentModule.exports,
    process: { env: {} },
    require: (specifier) => stubs[specifier] ?? require(specifier),
  });
  return componentModule.exports;
}

const render = (element) => renderToStaticMarkup(element);

test("a slot loads AdSense as it mounts, without waiting for the page", () => {
  const effect = toolAdsSource.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[hasAdSense/)[1];
  assert.match(effect, /if \(!hasAdSense\) return;\s*\/\/[\s\S]*loadAdSenseScript\(adsenseScriptSrc\(ADSENSE_CLIENT\)\);/);
});

test("the result panel shows with the progress bar, so the result arriving moves nothing", () => {
  const { ToolHeroLayout } = loadComponent(toolHeroLayoutSource, {
    "@/components/ToolAds": { ToolAdInline: () => null, ToolAdRail: ({ children }) => children },
    "@/components/ToolProgressIndicator": { ToolProgressIndicator: () => null },
  });
  const layout = (currentFile) =>
    render(
      React.createElement(ToolHeroLayout, {
        adsVisible: currentFile !== null,
        adSlotPrefix: "mp4-to-mp3",
        hero: "Tool",
        currentFile,
        resultPanel: React.createElement("aside", { id: "result-panel" }),
      }),
    );

  assert.doesNotMatch(layout(null), /result-panel/, "nothing before the visitor acts");
  for (const status of ["loading", "processing", "completed", "error", "unsupported"]) {
    assert.match(layout({ name: "a.mp4", progress: 0, status }), /<aside id="result-panel">/, status);
  }
});
