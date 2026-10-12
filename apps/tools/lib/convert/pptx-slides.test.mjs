import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";

import {
  MAX_PACKAGE_BYTES,
  MAX_SLIDES,
  SLIDES_TIMEOUT_MS,
  defaultFontFamily,
  isHiddenSlide,
  renderSlideSvgsInWorker,
  slideBatches,
  slidesNotice,
  themeBodyFont,
  visibleSlides,
} from "./pptx-slides.ts";
import { renderSlideSvgs } from "./pptx.worker.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const fixture = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

test("text that names no font is drawn in the theme's body font, then sans-serif", () => {
  const theme = '<a:theme xmlns:a="a"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface=""/></a:minorFont></a:fontScheme></a:themeElements></a:theme>';
  assert.equal(themeBodyFont(theme), "Segoe UI");
  assert.equal(defaultFontFamily("Segoe UI"), "'Segoe UI', Calibri, Carlito, Arial, sans-serif");
  assert.equal(defaultFontFamily(null), "Calibri, Carlito, Arial, sans-serif");
  assert.equal(defaultFontFamily("+mn-lt"), "Calibri, Carlito, Arial, sans-serif");
});

test("a slide marked show=0 is hidden", () => {
  assert.equal(isHiddenSlide('<?xml version="1.0"?><p:sld show="0" xmlns:p="x"><p:cSld/></p:sld>'), true);
  assert.equal(isHiddenSlide("<p:sld show='false'><p:cSld/></p:sld>"), true);
  assert.equal(isHiddenSlide('<p:sld xmlns:p="x"><p:cSld show="0"/></p:sld>'), false);
  assert.equal(isHiddenSlide('<sld show="1"/>'), false);
});

test("the slides that show are found in the presentation's order, hidden ones left out", () => {
  assert.deepEqual(visibleSlides(fixture("sample.pptx")), { numbers: [1], total: 1, hidden: 0, bodyFont: "Arial" });
  assert.deepEqual(visibleSlides(fixture("sample-deck.pptx")), { numbers: [1, 3], total: 3, hidden: 1, bodyFont: "Calibri" });
});

test("the slide order follows sldIdLst, not the part names", () => {
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const files = {
    "_rels/.rels": `<Relationships><Relationship Id="r1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    "ppt/presentation.xml": `<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="300" r:id="rB"/><p:sldId id="301" r:id="rA"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rA" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rB" Type="${REL}/slide" Target="slides/slide2.xml"/></Relationships>`,
    "ppt/slides/slide1.xml": '<p:sld show="0"/>',
    "ppt/slides/slide2.xml": "<p:sld/>",
  };
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
  // slide2.xml comes first and shows; slide1.xml second and is hidden.
  assert.deepEqual(visibleSlides(zipped.buffer), { numbers: [1], total: 2, hidden: 1, bodyFont: null });
});

test("old PPT files, other files and packages too large to inflate are refused", () => {
  const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]).buffer;
  assert.throws(() => visibleSlides(ole), /older PowerPoint file \(\.ppt\) or a password-protected one/);
  assert.throws(() => visibleSlides(strToU8("hello").buffer), /isn't a ZIP archive/);
  // A media part whose ZIP entry says it inflates past the limit.
  const bytes = new Uint8Array(fixture("sample.pptx"));
  const view = new DataView(bytes.buffer);
  let patched = false;
  for (let offset = 0; offset < bytes.length - 46 && !patched; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    view.setUint32(offset + 24, MAX_PACKAGE_BYTES + 1, true);
    patched = true;
  }
  assert.ok(patched);
  assert.throws(() => visibleSlides(bytes.buffer), /too large to draw here/);
});

test("pptx-glimpse draws the slides asked for as SVG, with text and no outside links", async () => {
  const reply = await renderSlideSvgs({ bytes: fixture("sample-deck.pptx"), slides: [1, 3] });
  assert.equal(reply.ok, true);
  assert.deepEqual(
    reply.slides.map((slide) => slide.number),
    [1, 3],
  );
  assert.match(reply.slides[0].svg, /Quarterly review/);
  assert.match(reply.slides[1].svg, /Table and chart/);
  assert.doesNotMatch(reply.slides.map((slide) => slide.svg).join(""), /Hidden slide|Speaker notes/);
});

test("a slide's linked pictures and links fetch nothing, and count as not drawn", async () => {
  const reply = await renderSlideSvgs({ bytes: fixture("hostile-links.pptx"), slides: [1] });
  assert.equal(reply.ok, true);
  assert.equal(reply.skipped, 2);
  const svg = reply.slides[0].svg;
  assert.doesNotMatch(svg, /example\.net|\/hostile\//);
});

test("slides go to the worker ten at a time", () => {
  assert.deepEqual(slideBatches([1, 2, 3], 2), [[1, 2], [3]]);
  assert.equal(slideBatches(Array.from({ length: 100 }, (_, index) => index + 1)).length, 10);
  assert.deepEqual(slideBatches([]), []);
});

test("what the page says about the slides saved", () => {
  assert.equal(slidesNotice({ shown: 1, visible: 1, hidden: 0, skipped: 0 }), undefined);
  assert.equal(slidesNotice({ shown: 2, visible: 2, hidden: 1, skipped: 0 }), "One image a slide, in order. 1 hidden slide isn't drawn.");
  assert.equal(
    slidesNotice({ shown: MAX_SLIDES, visible: 250, hidden: 0, skipped: 3 }),
    "One image a slide, in order. The first 100 of 250 slides are saved, the most one presentation gives here. 3 elements this converter can't draw are left out.",
  );
});

test("a presentation that runs past its time is stopped, and the file goes to the worker", async () => {
  const worker = { terminated: false, posted: null, onmessage: null, onerror: null };
  worker.postMessage = (job, transfer) => (worker.posted = { job, transfer });
  worker.terminate = () => (worker.terminated = true);
  const bytes = new ArrayBuffer(8);
  await assert.rejects(
    renderSlideSvgsInWorker({ bytes, slides: [1] }, { timeoutMs: 20, createWorker: () => worker }),
    (error) => error.code === "layout_timeout" && error.message.includes(`more than ${SLIDES_TIMEOUT_MS / 1000} seconds`),
  );
  assert.equal(worker.terminated, true);
  assert.deepEqual(worker.posted.transfer, [bytes]);
});
