import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyRun,
  converterEngine,
  countStatuses,
  ffmpegError,
  hasSignature,
  loadFixtures,
  mergeRows,
  pageComponent,
  parseArgs,
  planTool,
  renderSummary,
  scanPageHandlers,
  selectRuns,
  serializeResults,
  textOutputTimeout,
  thrownError,
  treeIsDirty,
} from "../scripts/lib/tool-sweep.mjs";

const benchmarksDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../benchmarks");
const fixturesDir = path.join(benchmarksDir, "fixtures");
const head = (name) => Array.from(readFileSync(path.join(fixturesDir, name)).subarray(0, 1024));
const output = (name, extra = {}) => ({ name, size: 100, head: head(name), ...extra });

test("a saved file with the promised signature passes, and says it was checked", () => {
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [output("sample.jpg")] }, { to: "jpg" }), {
    status: "pass",
    error: null,
    formatCheck: "signature",
  });
});

test("PNG bytes saved as a GIF are a wrong format, named after the file", () => {
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [output("sample.png")] }, { to: "gif" }), {
    status: "wrong_format",
    error: "saved PNG instead of GIF (sample.png)",
    formatCheck: "signature",
  });
});

test("every page of a multi-file output is checked", () => {
  const result = classifyRun(
    { outcome: "completed", outputs: [output("sample.jpg"), { name: "page2.jpg", size: 9, head: [1, 2, 3] }] },
    { to: "jpg" },
  );
  assert.equal(result.status, "wrong_format");
  assert.equal(result.error, "saved unrecognised bytes instead of JPG (page2.jpg)");
});

test("the page's own wrong-format refusal is a wrong format, not an error", () => {
  const byCode = classifyRun(
    { outcome: "failed", message: "Something odd", errorCode: "wrong_output_format" },
    { to: "bmp" },
  );
  assert.equal(byCode.status, "wrong_format");
  const byMessage = classifyRun(
    { outcome: "failed", message: "The converter produced PNG instead of BMP." },
    { to: "bmp" },
  );
  assert.deepEqual(byMessage, {
    status: "wrong_format",
    error: "The converter produced PNG instead of BMP.",
    formatCheck: "page",
  });
});

test("a failure keeps the message the page showed", () => {
  assert.deepEqual(
    classifyRun({ outcome: "failed", message: " Image decode failed. ", errorCode: "convert_failed" }, { to: "jpg" }),
    { status: "error", error: "Image decode failed." },
  );
  assert.deepEqual(classifyRun({ outcome: "failed", errorCode: "convert_failed" }, { to: "jpg" }), {
    status: "error",
    error: "convert_failed",
  });
});

test("finishing without a file, or with an empty one, is an error", () => {
  assert.equal(classifyRun({ outcome: "completed", outputs: [] }, { to: "png" }).error, "finished without saving a file");
  assert.equal(
    classifyRun({ outcome: "completed", outputs: [{ name: "a_compressed.mp3", size: 0, head: [] }] }, { to: "mp3" })
      .error,
    "saved an empty file (a_compressed.mp3)",
  );
});

test("timeouts and harness errors keep their own status", () => {
  assert.deepEqual(classifyRun({ outcome: "timeout", message: "no result after 60 s" }, { to: "mp4" }), {
    status: "timeout",
    error: "no result after 60 s",
  });
  assert.equal(classifyRun({ outcome: "error", message: "harness: x" }, { to: "mp4" }).status, "error");
});

test("a text output that fills without the fixture's data is a failure, not a timeout", () => {
  const options = { markers: ["Alpha", "Gamma"], timeoutMs: 60_000 };
  const stale = textOutputTimeout("id,name\n1,Sample row", options);
  assert.deepEqual(stale, { outcome: "failed", message: "the output never showed the input's data (Alpha, Gamma)" });
  assert.equal(classifyRun(stale, { to: "csv", markers: options.markers }).status, "error");
  assert.deepEqual(textOutputTimeout(" \n", options), { outcome: "timeout", message: "no output after 60 s" });
});

test("a run that threw is the harness's failure unless the page is to blame", () => {
  const timeout = "Timeout 20000ms exceeded.\n=========================== logs ===========================";
  assert.equal(
    thrownError({ message: timeout, step: "file input", hydration: true }),
    "harness: file input: Timeout 20000ms exceeded.",
  );
  // A page that never hydrated after a script error is stuck for a visitor too.
  const unhydrated = thrownError({ message: timeout, step: "file input", hydration: true, pageError: "x is not a function" });
  assert.equal(unhydrated, "the file input never became interactive (page error: x is not a function)");
  assert.deepEqual(
    selectRuns([{ id: "a" }], [{ id: "a", status: "error", error: unhydrated }], { resume: true }),
    [],
    "--resume keeps it as a measurement",
  );
  assert.equal(
    thrownError({ message: timeout, step: "upload", pageError: "x is not a function" }),
    "harness: upload: Timeout 20000ms exceeded. (page error: x is not a function)",
  );
  assert.equal(
    thrownError({ message: "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8811/a/\nCall log:" }),
    "harness: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8811/a/",
  );
  assert.equal(
    thrownError({ message: "Target crashed", step: "file input", hydration: true, crashed: true, pageError: "oom" }),
    "the tab crashed (page error: oom)",
  );
});

test("the tree is dirty when any path but the results file differs", () => {
  const results = "apps/tools/benchmarks/tool-sweep-results.json";
  const status = (...entries) => entries.map((entry) => `${entry}\0`).join("");
  assert.equal(treeIsDirty("", results), false);
  assert.equal(treeIsDirty(status(` M ${results}`, `?? ${results}.tmp`), results), false);
  assert.equal(treeIsDirty(status(` M ${results}`, " M apps/tools/scripts/tool-sweep.mjs"), results), true);
  // Exactly that path: a file whose path ends the same way is another file.
  assert.equal(treeIsDirty(status("?? results.json"), results), true);
  assert.equal(treeIsDirty(status(" M benchmarks/tool-sweep-results.json"), results), true);
  // A rename names the old path in the next entry.
  assert.equal(treeIsDirty(status(`R  ${results}`, "apps/tools/benchmarks/old.json"), results), true);
});

// Extensions for the same format. Any other two ready formats with the same
// bytes mean one fixture is a stand-in, and its Tools are fed the wrong input.
const FIXTURE_ALIASES = [
  ["jpg", "jpeg", "jfif"],
  ["tif", "tiff"],
  ["aif", "aiff"],
  ["mov", "qt"],
  ["m4a", "m4b"],
  ["heic", "heif"],
  ["mpeg", "mpg"],
];

test("two ready formats share a fixture's bytes only if they're aliases", () => {
  const aliasOf = new Map(FIXTURE_ALIASES.flatMap((group) => group.map((format) => [format, group[0]])));
  const byBytes = new Map();
  for (const [format, file] of loadFixtures(benchmarksDir).byFormat) {
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    byBytes.set(hash, [...(byBytes.get(hash) ?? []), format]);
  }
  const shared = [...byBytes.values()].filter(
    (formats) => new Set(formats.map((format) => aliasOf.get(format) ?? format)).size > 1,
  );
  assert.deepEqual(shared, []);
});

test("an output format without a signature passes unchecked, unless text markers apply", () => {
  const bytes = { name: "out.tga", size: 10, head: [0, 1, 2], text: "Alpha,1" };
  assert.equal(classifyRun({ outcome: "completed", outputs: [bytes] }, { to: "tga" }).formatCheck, "none");
  assert.deepEqual(classifyRun({ outcome: "completed", outputs: [bytes] }, { to: "json", markers: ["Alpha"] }), {
    status: "pass",
    error: null,
    formatCheck: "content",
  });
  const lost = classifyRun({ outcome: "completed", outputs: [bytes] }, { to: "json", markers: ["Alpha", "Gamma"] });
  assert.equal(lost.status, "error");
  assert.match(lost.error, /missing Gamma/);
});

test("hasSignature asks the app's check which formats it can verify", () => {
  for (const format of ["png", "jpg", "gif", "pdf", "mp3", "mp4", "svg", "ico", "ktx2", "av1", "hevc"]) {
    assert.equal(hasSignature(format), true, format);
  }
  for (const format of ["tga", "aac", "csv", "json", "mxf", "markdown"]) {
    assert.equal(hasSignature(format), false, format);
  }
});

test("converterEngine follows workerClient's branch order", () => {
  const engine = (operation, from, to) => converterEngine({ operation, from, to });
  assert.equal(engine("convert", "png", "jpg"), "browser-raster");
  assert.equal(engine("convert", "ai", "png"), "pdfjs");
  assert.equal(engine("convert", "pdf", "jpg"), "pdfjs");
  assert.equal(engine("convert", "dng", "jpg"), "imagemagick-wasm");
  assert.equal(engine("convert", "heic", "png"), "heif-decoder");
  assert.equal(engine("convert", "mp4", "mp3"), "ffmpeg-wasm");
  assert.equal(engine("convert", "gif", "mp4"), "ffmpeg-wasm");
  assert.equal(engine("convert", "mp4", "mxf"), "ffmpeg-wasm");
  assert.equal(engine("convert", "mp4", "rm"), "server-video, then ffmpeg-wasm");
  assert.equal(engine("convert", "amr", "ogg"), "server-video, then ffmpeg-wasm");
  assert.equal(engine("convert", "av1", "mxf"), "ffmpeg-wasm + webcodecs");
  assert.equal(engine("convert", "mp4", "av1"), "ffmpeg-wasm + webcodecs");
  assert.equal(engine("convert", "mov", "hevc"), "ffmpeg-wasm + webcodecs");
  assert.equal(engine("convert", "hevc", "mp4"), "ffmpeg-wasm");
  assert.equal(engine("compress", "png", "png"), "jsquash-worker");
  assert.equal(engine("compress", "gif", "gif"), "server-image-compress");
  assert.equal(engine("compress", "pdf", "pdf"), "server-pdf-compress");
  assert.equal(engine("compress", "mp4", "mp4"), "ffmpeg-wasm");
});

test("pageComponent names the page's first non-section component", () => {
  assert.equal(
    pageComponent('import { FAQSection } from "@/components/sections/FAQSection";\nimport X from "@/components/table-convert/TableConvertLanding";'),
    "TableConvertLanding",
  );
  assert.equal(pageComponent('import { ToolPageRenderer } from "@/components/ToolPageRenderer";'), "ToolPageRenderer");
  assert.equal(pageComponent("export default function Page() {}"), "inline");
});

function appFixture() {
  const appDir = mkdtempSync(path.join(tmpdir(), "tool-sweep-app-"));
  const page = (route, source) => {
    mkdirSync(path.join(appDir, route), { recursive: true });
    writeFileSync(path.join(appDir, route, "page.tsx"), source);
  };
  page("(convert)/csv-to-json", 'import T from "@/components/table-convert/TableConvertLanding";');
  page("(convert)/[tool]", 'import { ToolPageRenderer } from "@/components/ToolPageRenderer";');
  page("mp3-to-transcript", 'import TranscribeTool from "@/components/TranscribeTool";');
  return appDir;
}

test("scanPageHandlers maps routes without groups and leaves dynamic routes out", () => {
  const appDir = appFixture();
  try {
    assert.deepEqual(
      [...scanPageHandlers(appDir).entries()].sort(),
      [
        ["/csv-to-json", "TableConvertLanding"],
        ["/mp3-to-transcript", "TranscribeTool"],
      ],
    );
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test("planTool picks a driver and fixture, or says why a Tool isn't run", () => {
  const handlers = new Map([
    ["/csv-to-json", "TableConvertLanding"],
    ["/mp3-to-transcript", "TranscribeTool"],
  ]);
  const fixtures = {
    byFormat: new Map([
      ["png", "/f/sample.png"],
      ["csv", "/f/sample.csv"],
      ["mp4", "/f/sample.mp4"],
    ]),
    byTool: new Map([["batch-compress-png", ["/f/sample.png", "/f/sample-2.png"]]]),
  };
  const options = { handlers, fixtures, timeoutMs: 60, ffmpegTimeoutMs: 180 };
  const plan = (tool) => planTool({ isActive: true, ...tool }, options);

  const png = plan({ id: "png-to-jpg", route: "/png-to-jpg", operation: "convert", from: "png", to: "jpg" });
  assert.deepEqual(
    [png.handler, png.engine, png.driver, png.fixtures, png.timeoutMs, png.status],
    ["ToolPageRenderer", "browser-raster", "file", ["/f/sample.png"], 60, undefined],
  );
  const video = plan({ id: "mp4-to-mp3", route: "/mp4-to-mp3", operation: "convert", from: "mp4", to: "mp3" });
  assert.equal(video.timeoutMs, 180);
  assert.equal(plan({ id: "mp4-to-mxf", route: "/mp4-to-mxf", operation: "convert", from: "mp4", to: "mxf" }).timeoutMs, 180);
  const table = plan({ id: "csv-to-json", route: "/csv-to-json", operation: "convert", from: "csv", to: "json" });
  assert.deepEqual([table.driver, table.markers, table.compress], ["table", ["Alpha"], false]);
  const compress = plan({ id: "compress-png", route: "/compress-png", operation: "compress", from: "png", to: "png" });
  assert.equal(compress.compress, true);
  // A text converter whose fixture has no known data marker can't be checked.
  const markerless = planTool(
    { id: "csv-to-xml", route: "/csv-to-xml", operation: "convert", from: "csv", to: "xml" },
    { ...options, handlers: new Map([["/csv-to-xml", "TableConvertLanding"]]), fixtures: { ...fixtures, byFormat: new Map([["csv", "/f/other.csv"]]) } },
  );
  assert.equal(markerless.status, "no_fixture");
  const batch = plan({ id: "batch-compress-png", route: "/batch-compress-png", operation: "bulk", from: "png", to: "png" });
  assert.equal(batch.status, "skipped", "bulk without its own page has no driver");

  assert.deepEqual(
    plan({ id: "icns-to-png", route: "/icns-to-png", operation: "convert", from: "icns", to: "png" }).status,
    "no_fixture",
  );
  const skipped = (tool) => plan(tool).reason;
  assert.match(skipped({ id: "download-x", route: "/download-x", operation: "download" }), /downloader/);
  assert.match(skipped({ id: "mp3-to-transcript", route: "/mp3-to-transcript", operation: "convert", from: "mp3", to: "txt" }), /transcription/);
  assert.match(skipped({ id: "video-editor", route: "/video-editor", operation: "video-editor" }), /placeholder/);
  assert.match(skipped({ id: "pdf-reader", route: "/pdf-reader", operation: "view", from: "pdf", to: "pdf" }), /viewer/);
});

test("parseArgs takes defaults, validates numbers and refuses non-local targets", () => {
  const args = parseArgs(["--base-url", "http://localhost:8787/"]);
  assert.deepEqual(
    [args.baseUrl, args.concurrency, args.timeoutMs, args.ffmpegTimeoutMs, args.resume, args.only],
    ["http://localhost:8787", 4, 60_000, 180_000, false, null],
  );
  const custom = parseArgs([
    "--base-url", "http://127.0.0.1:8787", "--concurrency", "8", "--only", "a, b", "--limit", "5",
    "--resume", "--retry", "error,timeout",
  ]);
  assert.deepEqual([custom.concurrency, custom.only, custom.limit, [...custom.retry]], [8, ["a", "b"], 5, ["error", "timeout"]]);
  assert.throws(() => parseArgs([]), /--base-url is required/);
  assert.throws(() => parseArgs(["--base-url", "https://staging.tools.serp.co"]), /local Worker/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--concurrency", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--retry", "error"]), /only applies with --resume/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--resume", "--retry", "skipped"]), /measured statuses/);
  assert.equal(parseArgs(["--summary"]).summary, true);
});

test("parseArgs runs Playwright's Chromium unless --channel names an installed browser", () => {
  assert.equal(parseArgs(["--base-url", "http://localhost:1"]).channel, "chromium");
  assert.equal(parseArgs(["--base-url", "http://localhost:1", "--channel", "chrome"]).channel, "chrome");
  assert.equal(parseArgs(["--base-url", "http://localhost:1", "--channel", "msedge"]).channel, "msedge");
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--channel", "firefox"]), /--channel takes/);
  assert.throws(() => parseArgs(["--base-url", "http://localhost:1", "--channel"]), /needs a value/);
});

test("a resumed run skips measured Tools, re-runs --retry statuses and unmeasured rows", () => {
  const plans = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  const previous = [
    { id: "a", status: "pass" },
    { id: "b", status: "error" },
    { id: "c", status: "timeout" },
    { id: "d", status: "no_fixture" },
  ];
  const ids = (runs) => runs.map((plan) => plan.id);
  assert.deepEqual(ids(selectRuns(plans, previous, { resume: false })), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids(selectRuns(plans, previous, { resume: true })), ["d", "e"]);
  assert.deepEqual(ids(selectRuns(plans, previous, { resume: true, retry: new Set(["timeout"]) })), ["c", "d", "e"]);
  assert.deepEqual(ids(selectRuns(plans, previous, { resume: true, limit: 1 })), ["d"]);
  // A harness failure was never a measurement of the Tool.
  const harness = [...previous.slice(1), { id: "a", status: "error", error: "harness: file input: Timeout" }];
  assert.deepEqual(ids(selectRuns(plans, harness, { resume: true })), ["a", "d", "e"]);
});

test("new rows replace old ones in registry order, and retired Tools drop out", () => {
  const merged = mergeRows(
    ["a", "b", "c"],
    [
      { id: "c", status: "pass" },
      { id: "a", status: "error" },
      { id: "gone", status: "pass" },
    ],
    [{ id: "a", status: "pass" }, { id: "b", status: "timeout" }],
  );
  assert.deepEqual(merged, [
    { id: "a", status: "pass" },
    { id: "b", status: "timeout" },
    { id: "c", status: "pass" },
  ]);
});

test("results serialize one row per line and parse back unchanged", () => {
  const data = {
    meta: { commit: "abc", runs: [{ concurrency: 4, wallMs: 1 }] },
    results: [
      { id: "a", status: "pass" },
      { id: "b", status: "error", error: "x" },
    ],
  };
  const text = serializeResults(data);
  assert.deepEqual(JSON.parse(text), data);
  assert.ok(text.includes('\n    {"id":"a","status":"pass"},\n    {"id":"b"'));
});

test("ffmpegError names the encoder that refused, not the exit code", () => {
  const log = [
    "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'input.mp4':",
    "Stream mapping:",
    "  Stream #0:0 -> #0:0 (h264 (native) -> h263 (native))",
    "[h263 @ 0xdf1b00] The specified picture size of 320x240 is not valid for the H.263 codec.",
    "Error initializing output stream 0:0 -- Error while opening encoder",
    "Conversion failed!",
    "Aborted()",
  ];
  assert.equal(ffmpegError(log), "[h263] The specified picture size of 320x240 is not valid for the H.263 codec.");
  assert.equal(
    ffmpegError(["input.rm: Invalid data found when processing input", "Aborted()"]),
    "input.rm: Invalid data found when processing input",
  );
  // A video without audio converted to MP3: the stream line mentions "unknown".
  assert.equal(
    ffmpegError([
      "Input #0, mjpeg, from 'input.mjpeg':",
      "  Duration: N/A, bitrate: N/A",
      "  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 320x240",
      "Output #0, mp3, to 'output.mp3':",
      "  Metadata:",
      "    encoder         : Lavf59.27.100",
      "Output file #0 does not contain any stream",
      "Aborted()",
    ]),
    "Output file #0 does not contain any stream",
  );
  assert.equal(ffmpegError([]), undefined);
});

test("the summary counts statuses, splits passes by check and lists failing ids", () => {
  const results = [
    { id: "a", from: "png", engine: "browser-raster", status: "pass", formatCheck: "signature" },
    { id: "b", from: "png", engine: "browser-raster", status: "pass", formatCheck: "none" },
    { id: "c", from: "mp4", engine: "ffmpeg-wasm", status: "error", error: "FFmpeg failed", detail: "[h263] size" },
    { id: "d", from: "icns", status: "no_fixture" },
    { id: "e", status: "skipped", reason: "downloader: needs a real third-party media URL" },
  ];
  assert.deepEqual(countStatuses(results), {
    pass: 2, wrong_format: 0, error: 1, timeout: 0, no_fixture: 1, skipped: 1,
  });
  const summary = renderSummary(
    { meta: { commit: "0123456789", runs: [{ concurrency: 4, wallMs: 90 * 60_000 }] }, results },
    { activeCount: 6 },
  );
  assert.match(summary, /`0123456`.*concurrency 4, 1 h 30 min/);
  assert.match(summary, /\| pass \| 2 \(file signature checked: 1, text content checked: 0, no check for the output format: 1\) \|/);
  assert.match(summary, /\| \*\*run \/ active\*\* \| 3 \/ 6 \|/);
  assert.match(summary, /Non-passing Tools by engine\n\n\| +\| wrong_format/);
  assert.match(summary, /\| ffmpeg-wasm \| 0 \| 1 \| 0 \|/);
  assert.match(summary, /error: FFmpeg failed \[\[h263\] size\] \| 1 \|/);
  assert.match(summary, /no fixture for the input format: icns 1 \| 1 \|/);
  assert.match(summary, /<summary>error Tool ids \(1\)<\/summary>\n\n- `c`: FFmpeg failed/);
});
