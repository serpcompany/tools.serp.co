import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../scripts/lib/csv.mjs";
import { parseKeywordsCsv } from "../scripts/lib/keywords.mjs";
import {
  STATUS_COLUMNS,
  STATUS_INPUTS,
  STATUS_OUTPUTS,
  aliasIds,
  buildStatusRows,
  generateToolStatus,
  isSameFormat,
  joinKeyword,
  keywordId,
  processingLocation,
  renderStatusCsv,
  sweepCommit,
  sweepNote,
} from "../scripts/lib/tool-status.mjs";
import { mergeRows, serializeResults, sweepRow } from "../scripts/lib/tool-sweep.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const tool = (id, isActive = true, extra = {}) => {
  const [from, to] = id.split("-to-");
  return { id, operation: "convert", from, to, isActive, ...extra };
};
const keyword = (text, extra = {}) => {
  const [from = "", to = ""] = text.split(" to ");
  return {
    keyword: text,
    from,
    to,
    operation: "convert",
    global_volume: 100,
    us_volume: 10,
    kd: 1,
    global_traffic_potential: null,
    us_traffic_potential: null,
    source: "ahrefs-test",
    ...extra,
  };
};
const byId = (tools) => new Map(tools.map((entry) => [entry.id, entry]));

test("a keyword joins the Tool whose id is its words joined by hyphens", () => {
  assert.equal(keywordId("heic to jpg"), "heic-to-jpg");
  assert.deepEqual(joinKeyword("heic to jpg", byId([tool("heic-to-jpg")])), { match: "exact", toolId: "heic-to-jpg" });
});

test("a retired Tool with the keyword's id is still its exact page", () => {
  const tools = [tool("eps-to-jpg", false), tool("eps-to-jpeg")];
  assert.deepEqual(joinKeyword("eps to jpg", byId(tools)), { match: "exact", toolId: "eps-to-jpg" });
});

test("alias ids swap any format word for its alias, alone or together", () => {
  assert.deepEqual(aliasIds("word to jpg"), ["docx-to-jpeg", "docx-to-jpg", "word-to-jpeg"]);
  assert.deepEqual(aliasIds("tif to mpeg"), ["tif-to-mpg", "tiff-to-mpeg", "tiff-to-mpg"]);
  assert.deepEqual(aliasIds("htm to text"), ["htm-to-txt", "html-to-text", "html-to-txt"]);
  assert.deepEqual(aliasIds("excel to powerpoint"), ["excel-to-pptx", "xlsx-to-powerpoint", "xlsx-to-pptx"]);
  assert.deepEqual(aliasIds("mp4 to mp3"), []);
});

test("without an exact page, a keyword is covered by live alias Tools only", () => {
  assert.deepEqual(joinKeyword("word to jpg", byId([tool("docx-to-jpeg")])), {
    match: "alias",
    toolId: "docx-to-jpeg",
  });
  assert.deepEqual(joinKeyword("word to jpg", byId([tool("docx-to-jpeg", false)])), { match: "none", toolId: "" });
  assert.deepEqual(joinKeyword("youtube to mp3", byId([tool("mp4-to-mp3")])), { match: "none", toolId: "" });
});

test("same-format keywords are flagged, counting aliases as one format", () => {
  assert.equal(isSameFormat("pdf", "pdf"), true);
  assert.equal(isSameFormat("jpeg", "jpg"), true);
  assert.equal(isSameFormat("tiff", "tif"), true);
  assert.equal(isSameFormat("jpg", "png"), false);
  assert.equal(isSameFormat("", ""), false);
});

test("processing location follows the sweep's engine, and its page for downloaders", () => {
  const row = (engine, handler = "ToolPageRenderer") => ({ engine, handler });
  const clientEngines = ["ffmpeg-wasm", "imagemagick-wasm", "browser-raster", "pdfjs", "heif-decoder", "table-convert"];
  for (const engine of clientEngines) assert.equal(processingLocation(row(engine)), "client-only", engine);
  assert.equal(processingLocation(row("server-image-compress")), "server-executed");
  assert.equal(processingLocation(row("server-pdf-compress")), "server-executed");
  assert.equal(processingLocation(row("server-video, then ffmpeg-wasm")), "server-first-client-fallback");
  assert.equal(processingLocation(row(null, "DownloaderPageRenderer")), "server-assisted-or-extension");
  assert.equal(processingLocation(row(null, "DownloaderPageTemplate")), "server-assisted-or-extension");
  assert.equal(processingLocation(row(null, "TranscribeTool")), "unknown");
  assert.equal(processingLocation(row("some-new-engine")), "unknown");
  assert.equal(processingLocation(row("server-video, then some-new-engine")), "unknown");
  assert.equal(processingLocation(undefined), "unknown");
});

test("the sweep note says why a Tool failed, why it wasn't run, or how a pass was checked", () => {
  assert.equal(
    sweepNote({ status: "error", error: "FFmpeg failed\nwith exit code 1", detail: "Unknown encoder" }),
    "FFmpeg failed with exit code 1 [Unknown encoder]",
  );
  const reason = "coming-soon placeholder: nothing to run";
  assert.equal(sweepNote({ status: "skipped", reason }), reason);
  assert.equal(sweepNote({ status: "pass", formatCheck: "signature" }), "format check: signature");
});

test("a row's commit is its own, shortened, with -dirty for a run with uncommitted changes", () => {
  const commit = "ca5b9a53e93aad8dc434c0955bc8d75f466416b6";
  assert.equal(sweepCommit({ commit, dirty: false }), "ca5b9a53e93a");
  assert.equal(sweepCommit({ commit, dirty: true }), "ca5b9a53e93a-dirty");
  assert.equal(sweepCommit({ commit, dirty: null }), "ca5b9a53e93a");
  assert.equal(sweepCommit({}), "unknown");
});

test("a targeted sweep run changes only the rows it measured, in the results and in the view", () => {
  const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");
  const tools = JSON.parse(read(STATUS_INPUTS.catalog));
  const sweep = JSON.parse(read(STATUS_INPUTS.sweep));
  const keywords = parseKeywordsCsv(read(STATUS_INPUTS.keywords));
  const touched = ["3g2-to-mp4", "webp-to-png"];
  const newCommit = "f".repeat(40);

  // What `tool-sweep --only 3g2-to-mp4,webp-to-png` at a new commit writes.
  const newRows = touched.map((id) => {
    const previous = sweep.results.find((row) => row.id === id);
    const plan = { ...previous, fixtures: [path.join(appRoot, "benchmarks/fixtures", previous.fixture)] };
    return sweepRow(plan, { status: "pass", durationMs: 1, formatCheck: "signature" }, { commit: newCommit, dirty: false });
  });
  const activeIds = tools.filter((entry) => entry.isActive).map((entry) => entry.id);
  const after = { meta: sweep.meta, results: mergeRows(activeIds, sweep.results, newRows) };

  const changedLines = (before, next, idOf) => {
    const a = before.split("\n");
    const b = next.split("\n");
    assert.equal(a.length, b.length);
    return a.flatMap((line, index) => (line === b[index] ? [] : [idOf(b[index])]));
  };
  const resultId = (line) => JSON.parse(line.trim().replace(/,$/, "")).id;
  assert.deepEqual(changedLines(serializeResults(sweep), serializeResults(after), resultId), touched);

  const view = (data) => renderStatusCsv(buildStatusRows({ tools, sweep: data, keywords }));
  const csvId = (line) => line.split(",")[0];
  assert.deepEqual(changedLines(view(sweep), view(after), csvId), touched);
  assert.ok(view(after).includes("webp-to-png,live,convert,webp,png,client-only,browser-raster,pass,format check: signature,ffffffffffff,"));
});

test("each Tool and each keyword appears exactly once, in id order", () => {
  const tools = [tool("jpg-to-png"), tool("docx-to-jpeg"), tool("eps-to-jpg", false), tool("video-downloader")];
  const sweep = {
    meta: { runs: [{ commit: "abc", dirty: false }] },
    results: [
      { id: "jpg-to-png", engine: "browser-raster", handler: "ToolPageRenderer", status: "pass" },
      { id: "docx-to-jpeg", engine: "ffmpeg-wasm", handler: "ToolPageRenderer", status: "error" },
    ],
  };
  const keywords = [keyword("jpg to png"), keyword("word to jpg"), keyword("eps to jpg"), keyword("pdf to pdf")];
  const rows = buildStatusRows({ tools, sweep, keywords });

  assert.deepEqual(
    rows.map((row) => [row.tool_id ?? "", row.keyword ?? "", row.catalog_state, row.keyword_match ?? ""]),
    [
      ["docx-to-jpeg", "", "live", ""],
      ["eps-to-jpg", "eps to jpg", "retired", "exact"],
      ["jpg-to-png", "jpg to png", "live", "exact"],
      ["", "pdf to pdf", "not built", "none"],
      ["video-downloader", "", "live", ""],
      ["", "word to jpg", "not built", "alias"],
    ],
  );
  const alias = rows.find((row) => row.keyword === "word to jpg");
  assert.equal(alias.alias_tool_id, "docx-to-jpeg");
  assert.equal(rows.find((row) => row.keyword === "pdf to pdf").same_format, "yes");
  const retired = rows.find((row) => row.tool_id === "eps-to-jpg");
  assert.equal(retired.sweep_status, "not swept");
  assert.equal(retired.processing_location, "unknown");
  const unswept = rows.find((row) => row.tool_id === "video-downloader");
  assert.equal(unswept.sweep_status, "not swept");
  assert.equal(unswept.sweep_note, "no row in tool-sweep-results.json");
});

test("a duplicate Tool id fails the build instead of hiding a row", () => {
  assert.throws(
    () => buildStatusRows({ tools: [tool("a-to-b"), tool("a-to-b")], sweep: { results: [] }, keywords: [] }),
    /Duplicate Tool id/,
  );
});

test("the committed status view and summary match a fresh run of pnpm -C apps/tools tool-status", () => {
  const { rows, csv, summary } = generateToolStatus(appRoot);
  const stale = "is stale: run `pnpm -C apps/tools tool-status` and commit the result";
  const committed = (relative) => readFileSync(path.join(appRoot, relative), "utf8");
  // Not deepEqual: a diff of a 400 kB file buries the message.
  assert.ok(csv === committed(STATUS_OUTPUTS.view), `${STATUS_OUTPUTS.view} ${stale}`);
  assert.equal(committed(STATUS_OUTPUTS.summary), summary, `${STATUS_OUTPUTS.summary} ${stale}`);

  assert.deepEqual(Object.keys(parseCsv(csv)[0]), STATUS_COLUMNS);
  const catalog = JSON.parse(readFileSync(path.join(appRoot, "lib/catalog/tools.json"), "utf8"));
  assert.equal(rows.filter((row) => row.tool_id).length, catalog.length);
});
