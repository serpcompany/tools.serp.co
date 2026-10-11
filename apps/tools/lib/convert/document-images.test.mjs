import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DXF_FONT_URL,
  DXF_LONG_SIDE,
  DXF_MIN_SIDE,
  MAX_IMAGE_SIDE,
  NO_WEBGL_MESSAGE,
  SANDBOX_POLICY,
  buildSrcdoc,
  counterPairs,
  counterText,
  drawingImageSize,
  htmlCharset,
  htmlCutNotice,
  overflowIndex,
  pageScale,
  resolveCounterContent,
} from "./document-images.ts";
import { DOCUMENT_IMAGE_ENGINES, isDocumentImageConversion } from "./image-document-targets.ts";
import { PDF_FONT_URL } from "./table-outputs.ts";
import { convertWithWorker } from "./workerClient.ts";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bytes = (text) => new TextEncoder().encode(text);

test("DOCX, DXF and HTML to an image route to document-images.ts, and nothing else does", () => {
  for (const id of ["docx-to-jpeg", "docx-to-svg", "docx-to-tiff", "dxf-to-jpg", "dxf-to-png", "html-to-gif", "html-to-svg", "html-to-webp"]) {
    const [from, to] = id.split("-to-");
    assert.equal(isDocumentImageConversion(from, to), true, id);
    assert.equal(isDocumentImageConversion(from.toUpperCase(), to.toUpperCase()), true, id);
  }
  for (const [from, to] of [
    ["doc", "jpeg"],
    ["docx", "pdf"],
    ["html", "markdown"],
    ["html", "csv"],
    ["dxf", "dwg"],
    ["pdf", "png"],
    ["svg", "html"],
  ]) {
    assert.equal(isDocumentImageConversion(from, to), false, `${from} to ${to}`);
  }
  assert.deepEqual(DOCUMENT_IMAGE_ENGINES, { docx: "docx-preview", dxf: "dxf-viewer", html: "html-render" });
});

test("the converter sends these files to document-images.ts, not the image decoder", async () => {
  // Node has no DOM, so each run fails inside the renderer, and its error
  // names that renderer's engine; the raster path would name "worker".
  for (const [from, to, engine] of [
    ["html", "webp", "html-render"],
    ["docx", "jpeg", "docx-preview"],
  ]) {
    await assert.rejects(
      convertWithWorker({ worker: undefined, from, to, buf: bytes("<p>x</p>").buffer }),
      (error) => error.telemetryCode === "convert_failed" && error.telemetryMetadata.engine === engine,
      `${from} to ${to}`,
    );
  }
  await assert.rejects(
    convertWithWorker({ worker: undefined, from: "html", to: "gif", buf: bytes("  \n").buffer }),
    (error) => error.message === "This HTML file is empty." && error.telemetryMetadata.engine === "html-render",
  );
});

test("a browser without WebGL is told DXF needs it, under its own error code", async () => {
  // Enough of a document for dxf-viewer to try three.js's WebGL renderer,
  // which fails as it does in a browser with WebGL turned off.
  const element = () => ({ style: {}, append() {}, appendChild() {}, remove() {}, addEventListener() {} });
  const previous = globalThis.document;
  globalThis.document = {
    createElement: element,
    createElementNS: () => {
      throw new Error("no canvas here");
    },
    body: element(),
  };
  const log = console.log;
  console.log = () => {};
  try {
    await assert.rejects(
      convertWithWorker({ worker: undefined, from: "dxf", to: "png", buf: bytes("0\nEOF\n").buffer }),
      (error) =>
        error.telemetryCode === "webgl_unavailable" &&
        error.message === NO_WEBGL_MESSAGE &&
        error.telemetryMetadata.engine === "dxf-viewer",
    );
  } finally {
    console.log = log;
    globalThis.document = previous;
  }
});

test("a sandboxed page starts with a policy that runs nothing and loads nothing from outside the file", () => {
  const directives = new Map(SANDBOX_POLICY.split("; ").map((directive) => [directive.split(" ")[0], directive]));
  assert.equal(directives.get("default-src"), "default-src 'none'");
  assert.equal(directives.get("style-src"), "style-src 'unsafe-inline'");
  assert.equal(directives.get("img-src"), "img-src data:");
  assert.equal(directives.get("font-src"), "font-src data:");
  assert.equal(directives.get("base-uri"), "base-uri 'none'");
  assert.equal(directives.get("form-action"), "form-action 'none'");
  assert.ok(!directives.has("script-src"), "scripts fall back to default-src 'none'");
});

test("the srcdoc puts the policy before the page, after the page's own doctype", () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_POLICY}">`;
  const page = '<html lang="en"><head><title>x</title></head><body><p>Hi</p></body></html>';
  assert.equal(buildSrcdoc(page), `<!DOCTYPE html>${meta}${page}`);
  // A legacy doctype keeps its mode; no doctype keeps quirks mode.
  const legacy = '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">';
  assert.equal(buildSrcdoc(page, legacy), `${legacy}${meta}${page}`);
  assert.equal(buildSrcdoc(page, ""), `${meta}${page}`);
  // Anything that isn't a lone doctype is replaced, so nothing can come before the policy.
  for (const doctype of ['<!DOCTYPE html><script>alert(1)</script>', "<p>", "<!DOCTYPE <x>>"]) {
    assert.equal(buildSrcdoc(page, doctype), `<!DOCTYPE html>${meta}${page}`, doctype);
  }
});

test("an HTML file's encoding comes from its byte order mark, then its meta charset, else UTF-8", () => {
  assert.equal(htmlCharset(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c])), "utf-8");
  assert.equal(htmlCharset(new Uint8Array([0xff, 0xfe, 0x3c, 0x00])), "utf-16le");
  assert.equal(htmlCharset(new Uint8Array([0xfe, 0xff, 0x00, 0x3c])), "utf-16be");
  assert.equal(htmlCharset(bytes('<meta charset="windows-1252"><p>caf\xe9')), "windows-1252");
  assert.equal(htmlCharset(bytes('<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1">')), "windows-1252");
  assert.equal(htmlCharset(bytes("<meta charset=shift_jis>")), "shift_jis");
  assert.equal(htmlCharset(bytes('<meta charset="no-such-encoding">')), "utf-8");
  // UTF-16 named in a file whose bytes are ASCII can't be right.
  assert.equal(htmlCharset(bytes('<meta charset="utf-16">')), "utf-8");
  assert.equal(htmlCharset(bytes("<p>no charset</p>")), "utf-8");
  // Only the first 1024 bytes are searched, as browsers do.
  assert.equal(htmlCharset(bytes(`${" ".repeat(1024)}<meta charset="windows-1252">`)), "utf-8");
});

test("a DXF drawing keeps its shape, its longer side drawn DXF_LONG_SIDE pixels long", () => {
  assert.deepEqual(drawingImageSize(200, 150), { width: DXF_LONG_SIDE, height: 1536 });
  assert.deepEqual(drawingImageSize(150, 200), { width: 1536, height: DXF_LONG_SIDE });
  assert.deepEqual(drawingImageSize(100, 100), { width: DXF_LONG_SIDE, height: DXF_LONG_SIDE });
  // A line, or a long thin part, still has a short side to draw in.
  assert.deepEqual(drawingImageSize(100, 0), { width: DXF_LONG_SIDE, height: DXF_MIN_SIDE });
  assert.deepEqual(drawingImageSize(1, 1000), { width: DXF_MIN_SIDE, height: DXF_LONG_SIDE });
  // A point, or extents that aren't numbers, is a square.
  assert.deepEqual(drawingImageSize(0, 0), { width: DXF_LONG_SIDE, height: DXF_LONG_SIDE });
  assert.deepEqual(drawingImageSize(Number.NaN, Number.POSITIVE_INFINITY), { width: DXF_LONG_SIDE, height: DXF_LONG_SIDE });
  assert.ok(DXF_LONG_SIDE <= MAX_IMAGE_SIDE);
});

test("a DOCX page is pictured at twice its size in points, never past 4096 pixels a side", () => {
  // US Letter is 816x1056 CSS pixels: 1224x1584, as pdf.js renders a Letter PDF page.
  assert.equal(pageScale(816, 1056, 1.5), 1.5);
  assert.equal(Math.floor(816 * pageScale(816, 1056, 1.5)), 1224);
  // A page as tall as a long banner is scaled down to fit.
  const scale = pageScale(816, 8000, 1.5);
  assert.ok(8000 * scale <= MAX_IMAGE_SIDE && 8000 * scale > MAX_IMAGE_SIDE - 1);
  assert.ok(3000 * pageScale(3000, 500, 1.5) <= MAX_IMAGE_SIDE);
});

test("a page that runs past its end continues from the first block below it", () => {
  assert.equal(overflowIndex([100, 200, 300], 350), null);
  assert.equal(overflowIndex([100, 200, 300], 250), 2);
  // Sub-pixel rounding isn't overflow.
  assert.equal(overflowIndex([100, 250.4], 250), null);
  // The first block alone is too tall: 0, so only its own rows can split.
  assert.equal(overflowIndex([900, 950], 800), 0);
  assert.equal(overflowIndex([], 800), null);
});

test("list numbers are worked out from the counters docx-preview sets", () => {
  assert.deepEqual(counterPairs("docx-num-1-0 0 docx-num-1-1 4", 0), [["docx-num-1-0", 0], ["docx-num-1-1", 4]]);
  assert.deepEqual(counterPairs("docx-num-1-0", 1), [["docx-num-1-0", 1]]);
  assert.deepEqual(counterPairs("none", 0), []);
  assert.deepEqual(counterPairs("", 0), []);
  assert.deepEqual(
    [1, 4, 9, 12, 2024].map((value) => counterText(value, "lower-roman")),
    ["i", "iv", "ix", "xii", "mmxxiv"],
  );
  assert.equal(counterText(14, "upper-roman"), "XIV");
  assert.deepEqual([1, 26, 27, 52].map((value) => counterText(value, "lower-alpha")), ["a", "z", "aa", "az"]);
  assert.equal(counterText(3, "upper-alpha"), "C");
  assert.equal(counterText(7, "decimal-leading-zero"), "07");
  assert.equal(counterText(7, "none"), "");
  assert.equal(counterText(7, "simp-chinese-informal"), "7");
  const counters = new Map([
    ["docx-num-1-0", 2],
    ["docx-num-1-1", 3],
  ]);
  // How Chrome serializes docx-preview's "%1.%2." with a tab after it.
  assert.equal(
    resolveCounterContent('counter(docx-num-1-0, decimal) "." counter(docx-num-1-1, lower-alpha) ".\\9 "', counters),
    "2.c.\t",
  );
  assert.equal(resolveCounterContent('"" counter(docx-num-1-0) "\\a0"', counters), "2 ");
  assert.equal(resolveCounterContent("counters(docx-num-1-1, '-', upper-roman) ')'", counters), "III)");
  assert.equal(resolveCounterContent('counter(unknown) "."', counters), "0.");
});

test("a page taller than an image can be says what the image leaves out", () => {
  assert.equal(
    htmlCutNotice(21630, 4096),
    "The page is 21,630 px tall: the image shows its first 4,096 px, the most an image can be.",
  );
});

test("DXF text is drawn with the DejaVu Sans the table PDFs self-host", () => {
  assert.equal(DXF_FONT_URL, PDF_FONT_URL);
  assert.ok(existsSync(path.join(appRoot, "public", DXF_FONT_URL)));
});
