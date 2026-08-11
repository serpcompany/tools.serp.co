import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const presentations = {
  json: readFileSync(new URL("../components/JsonToCsv.tsx", import.meta.url), "utf8"),
  csv: readFileSync(new URL("../components/CsvCombiner.tsx", import.meta.url), "utf8"),
  html: readFileSync(
    new URL("../components/HtmlToMarkdownConverter.tsx", import.meta.url),
    "utf8",
  ),
  character: readFileSync(
    new URL("../components/CharacterCounter.tsx", import.meta.url),
    "utf8",
  ),
  pdf: readFileSync(new URL("../components/PdfTool.tsx", import.meta.url), "utf8"),
};
const pdfViewer = readFileSync(
  new URL("../public/vendor/pdfjs-annotation-extension/web/viewer.mjs", import.meta.url),
  "utf8",
);
const pdfProvider = readFileSync(
  new URL("../public/vendor/pdfjs-annotation-extension/pdf.mjs", import.meta.url),
  "utf8",
);
const pdfWorker = readFileSync(
  new URL("../public/vendor/pdfjs-annotation-extension/pdf.worker.mjs", import.meta.url),
  "utf8",
);
const pdfViewerHtml = readFileSync(
  new URL("../public/vendor/pdfjs-annotation-extension/web/viewer.html", import.meta.url),
  "utf8",
);

test("specialized presentations use the shared React adapter without manual telemetry", () => {
  for (const [name, source] of Object.entries(presentations)) {
    assert.match(source, /useSpecializedToolWorkflow/, name);
    assert.doesNotMatch(source, /beginToolRun|finishSuccess|finishFailure/, name);
  }
  assert.doesNotMatch(presentations.csv, /parseCsvLine|detectDelimiter|mergeCsvFiles/);
  assert.doesNotMatch(presentations.json, /escapeCSV/);
  assert.doesNotMatch(presentations.character, /function computeStats/);
  assert.doesNotMatch(presentations.html, /convertRef|telemetryTimer|lastTelemetryAt/);
});

test("presentations cross the explicit acquisition seams", () => {
  assert.match(presentations.json, /runInteraction\(\{[\s\S]*format: "json"/);
  assert.match(presentations.html, /scheduleInteraction\(\{[\s\S]*format: "html"/);
  assert.match(
    presentations.character,
    /scheduleInteraction\(\{[\s\S]*toolId: "character-counter"[\s\S]*value: text[\s\S]*\}, 250\)/,
  );
  assert.match(presentations.csv, /runFiles\(toolId \?\? "csv-combiner"/);
  assert.match(presentations.pdf, /runFile\(toolId, file\)/);
  assert.match(presentations.pdf, /data-testid="pdf-tool-viewer"/);
});

test("vendored PDF viewer loads a complete version-matched PDF.js runtime", () => {
  assert.match(pdfViewer, /const pdfjsVersion = "4\.3\.136"/);
  assert.match(pdfProvider, /pdfjsVersion\s*=\s*["']4\.3\.136["']/);
  assert.match(pdfProvider, /globalThis\.pdfjsLib\s*=\s*\{\}/);
  assert.match(pdfWorker, /pdfjsVersion\s*=\s*["']4\.3\.136["']/);
  assert.match(
    pdfViewerHtml,
    /src="\/vendor\/pdfjs-annotation-extension\/pdf\.mjs" type="module"/,
  );
  assert.match(
    pdfViewer,
    /value: "\/vendor\/pdfjs-annotation-extension\/pdf\.worker\.mjs"/,
  );
  assert.doesNotMatch(pdfViewerHtml, /\.\.\/build\/pdf\.mjs/);
});
