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
  assert.match(presentations.json, /runInteraction\([\s\S]*"json"/);
  assert.match(presentations.html, /scheduleInteraction\(TOOL_ID, "html"/);
  assert.match(presentations.character, /runInteraction\("character-counter", "text"/);
  assert.match(presentations.csv, /runFiles\(toolId \?\? "csv-combiner"/);
  assert.match(presentations.pdf, /runFile\(toolId, file\)/);
  assert.match(presentations.pdf, /data-testid="pdf-tool-viewer"/);
});
