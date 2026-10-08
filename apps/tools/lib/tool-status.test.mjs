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
import {
  ENGINE_LOCATIONS,
  engineFor,
  handlerFor,
  mergeRows,
  scanPageHandlers,
  serializeResults,
  sweepRow,
} from "../scripts/lib/tool-sweep.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");

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
  assert.equal(keywordId("zip compressor"), "compress-zip");
  assert.deepEqual(joinKeyword("zip compressor", byId([tool("compress-zip")])), {
    match: "exact",
    toolId: "compress-zip",
    aliasToolIds: [],
  });
  assert.deepEqual(aliasIds("excel compressor"), ["compress-xlsx"]);
  assert.deepEqual(joinKeyword("heic to jpg", byId([tool("heic-to-jpg"), tool("heic-to-jpeg")])), {
    match: "exact",
    toolId: "heic-to-jpg",
    aliasToolIds: [],
  });
});

test("a retired exact Tool is still the keyword's page, and names a live alias Tool", () => {
  assert.deepEqual(joinKeyword("eps to jpg", byId([tool("eps-to-jpg", false), tool("eps-to-jpeg")])), {
    match: "exact",
    toolId: "eps-to-jpg",
    aliasToolIds: ["eps-to-jpeg"],
  });
  assert.deepEqual(joinKeyword("eps to jpg", byId([tool("eps-to-jpg", false), tool("eps-to-jpeg", false)])), {
    match: "exact",
    toolId: "eps-to-jpg",
    aliasToolIds: [],
  });
});

test("alias ids swap any format word for its alias, alone or together", () => {
  assert.deepEqual(aliasIds("word to jpg"), ["docx-to-jpeg", "docx-to-jpg", "word-to-jpeg"]);
  assert.deepEqual(aliasIds("tif to mpeg"), ["tif-to-mpg", "tiff-to-mpeg", "tiff-to-mpg"]);
  assert.deepEqual(aliasIds("htm to text"), ["htm-to-txt", "html-to-text", "html-to-txt"]);
  assert.deepEqual(aliasIds("excel to powerpoint"), ["excel-to-pptx", "xlsx-to-powerpoint", "xlsx-to-pptx"]);
  assert.deepEqual(aliasIds("mp4 to mp3"), []);
});

test("a keyword between a format and itself or its alias has no alias Tools", () => {
  assert.deepEqual(aliasIds("tiff to tif"), []);
  assert.deepEqual(aliasIds("tiff to tiff"), []);
  assert.deepEqual(joinKeyword("tiff to tif", byId([tool("tif-to-tiff")])), {
    match: "none",
    toolId: "",
    aliasToolIds: [],
  });
});

test("without an exact Tool, a keyword is covered by live alias Tools only", () => {
  assert.deepEqual(joinKeyword("word to jpg", byId([tool("docx-to-jpeg")])), {
    match: "alias",
    toolId: "",
    aliasToolIds: ["docx-to-jpeg"],
  });
  const none = { match: "none", toolId: "", aliasToolIds: [] };
  assert.deepEqual(joinKeyword("word to jpg", byId([tool("docx-to-jpeg", false)])), none);
  assert.deepEqual(joinKeyword("youtube to mp3", byId([tool("mp4-to-mp3")])), none);
});

test("only the same format word on both sides is flagged; aliases are real conversions", () => {
  assert.equal(isSameFormat("pdf", "pdf"), true);
  assert.equal(isSameFormat("jpeg", "jpg"), false);
  assert.equal(isSameFormat("tif", "tiff"), false);
  assert.equal(isSameFormat("jpg", "png"), false);
  assert.equal(isSameFormat("", ""), false);
});

test("processing location is looked up from the sweep's engine label", () => {
  const convert = tool("a-to-b");
  const at = (engine) => processingLocation(convert, { engine });
  for (const engine of ["ffmpeg-wasm", "imagemagick-wasm", "browser-raster", "pdfjs", "heif-decoder"]) {
    assert.equal(at(engine), "client-only", engine);
  }
  assert.equal(at("table-convert"), "client-only");
  assert.equal(at("server-image-compress"), "server-executed");
  assert.equal(at("server-pdf-compress"), "server-executed");
  assert.equal(at("server-video, then ffmpeg-wasm"), "server-first-client-fallback");
});

test("an engine label missing from the table stops the view, even with a server- prefix", () => {
  const convert = tool("a-to-b");
  for (const engine of ["some-new-engine", "server-new-route", "unsupported", "constructor"]) {
    assert.throws(() => processingLocation(convert, { engine }), /add it to ENGINE_LOCATIONS/, engine);
  }
});

test("downloaders come from the catalog's operation; unknown is only a missing engine or row", () => {
  const downloader = tool("download-x-videos", true, { operation: "download" });
  assert.equal(processingLocation(downloader, { engine: null, handler: "AnyPage" }), "server-assisted-or-extension");
  assert.equal(processingLocation(downloader, undefined), "server-assisted-or-extension");
  assert.equal(processingLocation(tool("a-to-b"), { engine: null, handler: "TranscribeTool" }), "unknown");
  assert.equal(processingLocation(tool("a-to-b"), undefined), "unknown");
});

test("every engine the sweep would assign to a live Tool has a processing location", () => {
  const handlers = scanPageHandlers(path.join(appRoot, "app"));
  const tools = JSON.parse(read(STATUS_INPUTS.catalog)).filter((entry) => entry.isActive);
  const missing = new Set(
    tools.map((entry) => engineFor(entry, handlerFor(entry, handlers))).filter((engine) => engine != null),
  );
  for (const engine of Object.keys(ENGINE_LOCATIONS)) missing.delete(engine);
  assert.deepEqual([...missing], [], "add these engine labels to ENGINE_LOCATIONS in scripts/lib/tool-sweep.mjs");
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
  const tools = JSON.parse(read(STATUS_INPUTS.catalog));
  const sweep = JSON.parse(read(STATUS_INPUTS.sweep));
  const keywords = parseKeywordsCsv(read(STATUS_INPUTS.keywords));
  const touched = ["3g2-to-mp4", "webp-to-png"];

  // What `tool-sweep --only 3g2-to-mp4,webp-to-png` at a new commit writes.
  const newRows = touched.map((id) => {
    const previous = sweep.results.find((row) => row.id === id);
    const plan = { ...previous, fixtures: [path.join(appRoot, "benchmarks/fixtures", previous.fixture)] };
    const result = { status: "pass", durationMs: 1, formatCheck: "signature" };
    return sweepRow(plan, result, { commit: "f".repeat(40), dirty: false });
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
  assert.deepEqual(
    changedLines(view(sweep), view(after), (line) => line.split(",")[0]),
    touched,
  );
  assert.match(view(after), /^webp-to-png,live,.*,pass,format check: signature,ffffffffffff,/m);
});

test("each Tool and each keyword appears exactly once, in id order", () => {
  const tools = [tool("jpg-to-png"), tool("docx-to-jpeg"), tool("eps-to-jpg", false), tool("video-downloader")];
  const sweep = {
    results: [
      { id: "jpg-to-png", engine: "browser-raster", handler: "ToolPageRenderer", status: "pass", commit: "a" },
      { id: "docx-to-jpeg", engine: "ffmpeg-wasm", handler: "ToolPageRenderer", status: "error", commit: "a" },
    ],
  };
  const keywords = [
    keyword("jpg to png"),
    keyword("word to jpg", { global_volume: 423000 }),
    keyword("word to jpeg", { global_volume: 41000 }),
    keyword("eps to jpg"),
    keyword("pdf to pdf"),
    keyword("zip compressor", { global_volume: null, operation: "compress" }),
  ];
  const rows = buildStatusRows({ tools, sweep, keywords });

  assert.deepEqual(
    rows.map((row) => [row.tool_id ?? "", row.keyword ?? "", row.catalog_state, row.keyword_match ?? ""]),
    [
      ["", "zip compressor", "not built", "none"],
      ["docx-to-jpeg", "", "live", ""],
      ["eps-to-jpg", "eps to jpg", "retired", "exact"],
      ["jpg-to-png", "jpg to png", "live", "exact"],
      ["", "pdf to pdf", "not built", "none"],
      ["video-downloader", "", "live", ""],
      ["", "word to jpeg", "alias page", "alias"],
      ["", "word to jpg", "alias page", "alias"],
    ],
  );
  const find = (key, value) => rows.find((row) => row[key] === value);
  assert.equal(find("keyword", "word to jpg").alias_tool_id, "docx-to-jpeg");
  assert.equal(find("tool_id", "docx-to-jpeg").alias_keywords, "word to jpeg; word to jpg");
  assert.equal(find("tool_id", "docx-to-jpeg").alias_global_volume, 464000);
  assert.equal(find("tool_id", "jpg-to-png").alias_keywords, undefined);
  assert.equal(find("keyword", "pdf to pdf").same_format, "yes");
  const retired = find("tool_id", "eps-to-jpg");
  assert.equal(retired.sweep_status, "not swept");
  assert.equal(retired.processing_location, "unknown");
  const unswept = find("tool_id", "video-downloader");
  assert.equal(unswept.sweep_status, "not swept");
  assert.equal(unswept.sweep_note, "no row in tool-sweep-results.json");
});

test("a duplicate Tool id fails the build instead of hiding a row", () => {
  assert.throws(
    () => buildStatusRows({ tools: [tool("a-to-b"), tool("a-to-b")], sweep: { results: [] }, keywords: [] }),
    /Duplicate Tool id/,
  );
});

test("the committed status view and summary match a fresh run of pnpm -C apps/tools tool-status", async () => {
  const { rows, csv, summary } = await generateToolStatus(appRoot);
  const stale = "is stale: run `pnpm -C apps/tools tool-status` and commit the result";
  // Not deepEqual: a diff of a 400 kB file buries the message.
  assert.ok(csv === read(STATUS_OUTPUTS.view), `${STATUS_OUTPUTS.view} ${stale}`);
  assert.equal(read(STATUS_OUTPUTS.summary), summary, `${STATUS_OUTPUTS.summary} ${stale}`);

  assert.deepEqual(Object.keys(parseCsv(csv)[0]), STATUS_COLUMNS);
  assert.equal(rows.filter((row) => row.tool_id).length, JSON.parse(read(STATUS_INPUTS.catalog)).length);
});
