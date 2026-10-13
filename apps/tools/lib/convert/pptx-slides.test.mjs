import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  MAX_PACKAGE_BYTES,
  MAX_SLIDES,
  SLIDES_TIMEOUT_MS,
  defaultFontFamily,
  isHiddenSlide,
  renderSlideSvgsInWorker,
  slideBatches,
  slideTargets,
  slidesNotice,
  themeBodyFont,
  visibleSlides,
} from "./pptx-slides.ts";
import { parseRelationships } from "./ooxml.ts";
import { renderSlideSvgs } from "./pptx.worker.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const fixture = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

// sample-deck.pptx with the slides `hidden` names (1-based) marked
// show="0" and the others not, and the sldId entries `swapped` names written
// r:id first.
const deck = ({ hidden = [2], swapped = [] } = {}) => {
  const files = unzipSync(new Uint8Array(fixture("sample-deck.pptx")));
  for (const number of [1, 2, 3]) {
    const name = `ppt/slides/slide${number}.xml`;
    let xml = strFromU8(files[name]).replace('<p:sld show="0" ', "<p:sld ");
    if (hidden.includes(number)) xml = xml.replace("<p:sld ", '<p:sld show="0" ');
    files[name] = strToU8(xml);
  }
  let presentation = strFromU8(files["ppt/presentation.xml"]);
  for (const number of swapped) {
    const entry = new RegExp(`<p:sldId id="(\\d+)" r:id="rId${number + 1}"/>`);
    assert.match(presentation, entry);
    presentation = presentation.replace(entry, `<p:sldId r:id="rId${number + 1}" id="$1"/>`);
  }
  files["ppt/presentation.xml"] = strToU8(presentation);
  return zipSync(files).buffer;
};
const SLIDE_TEXT = { 1: /Quarterly review/, 2: /Hidden slide: not for the audience/, 3: /Table and chart/ };
const part = (number) => `ppt/slides/slide${number}.xml`;

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
  // A ">" inside an earlier attribute's value doesn't end the element.
  assert.equal(isHiddenSlide('<p:sld name="a > b" show="0"><p:cSld/></p:sld>'), true);
  // A prefixed show is another attribute.
  assert.equal(isHiddenSlide('<p:sld x:show="0"><p:cSld/></p:sld>'), false);
});

test("the slides that show are found in the presentation's order, hidden ones left out", () => {
  assert.deepEqual(visibleSlides(fixture("sample.pptx")), { slides: [{ number: 1, part: part(1) }], total: 1, hidden: 0, bodyFont: "Arial" });
  assert.deepEqual(visibleSlides(fixture("sample-deck.pptx")), {
    slides: [
      { number: 1, part: part(1) },
      { number: 3, part: part(3) },
    ],
    total: 3,
    hidden: 1,
    bodyFont: "Calibri",
  });
});

test("a slide's r:id and id are told apart in either order, so the hidden slide stays hidden", async () => {
  for (const swapped of [[2], [1, 2, 3]]) {
    const bytes = deck({ hidden: [2], swapped });
    const { slides, total, hidden } = visibleSlides(bytes);
    assert.deepEqual({ slides, total, hidden }, { slides: [{ number: 1, part: part(1) }, { number: 3, part: part(3) }], total: 3, hidden: 1 }, `${swapped}`);
    const reply = await renderSlideSvgs({ bytes, parts: slides.map((slide) => slide.part) });
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.slides.map((slide) => [slide.number, slide.part]), [[1, part(1)], [3, part(3)]]);
    assert.match(reply.slides[0].svg, SLIDE_TEXT[1]);
    assert.match(reply.slides[1].svg, SLIDE_TEXT[3]);
    assert.doesNotMatch(reply.slides.map((slide) => slide.svg).join(""), SLIDE_TEXT[2]);
  }
});

test("a hidden first, middle or last slide is left out, and the others keep their numbers", async () => {
  for (const hiddenSlide of [1, 2, 3]) {
    const bytes = deck({ hidden: [hiddenSlide] });
    const shown = [1, 2, 3].filter((number) => number !== hiddenSlide);
    const { slides } = visibleSlides(bytes);
    assert.deepEqual(slides, shown.map((number) => ({ number, part: part(number) })), `slide ${hiddenSlide} hidden`);
    const reply = await renderSlideSvgs({ bytes, parts: slides.map((slide) => slide.part) });
    assert.deepEqual(reply.slides.map((slide) => slide.number), shown);
    reply.slides.forEach((slide, index) => assert.match(slide.svg, SLIDE_TEXT[shown[index]]));
    assert.doesNotMatch(reply.slides.map((slide) => slide.svg).join(""), SLIDE_TEXT[hiddenSlide]);
  }
});

test("the worker draws only the parts asked for, and refuses a part pptx-glimpse doesn't list", async () => {
  const reply = await renderSlideSvgs({ bytes: deck(), parts: [part(3)] });
  assert.deepEqual(reply.slides.map((slide) => [slide.number, slide.part]), [[3, part(3)]]);
  const missing = await renderSlideSvgs({ bytes: deck(), parts: [part(1), "ppt/slides/slide9.xml"] });
  assert.equal(missing.ok, false);
});

test("only the presentation's own slide list counts, by slide relationships inside the package", () => {
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const relationships = parseRelationships(
    `<Relationships><Relationship Id="rA" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rB" Type="${REL}/slide" Target="slides/slide2.xml"/><Relationship Id="rX" Type="${REL}/slide" Target="https://example.net/s.xml" TargetMode="External"/><Relationship Id="rL" Type="${REL}/slideLayout" Target="slideLayouts/slideLayout1.xml"/><Relationship Id="rA" Type="${REL}/slide" Target="slides/slide3.xml"/></Relationships>`,
    "ppt/presentation.xml",
  );
  const presentation = `<p:presentation xmlns:p="p" xmlns:r="r" xmlns:p14="p14"><p:sldIdLst><p:sldId id="256" r:id="rA"/><p:sldId id="257" r:id="rX"/><p:sldId id="258" r:id="rL"/><p:sldId r:id="rB" id="259"/><p:sldId id="260"/></p:sldIdLst><p:extLst><p:ext><p14:sectionLst><p14:section><p14:sldIdLst><p14:sldId id="256"/><p14:sldId r:id="rB"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst><p:sldIdLst><p:sldId r:id="rB"/></p:sldIdLst></p:presentation>`;
  // The first rA wins; the external, layout and id-only entries are skipped;
  // the sections' list and a second list aren't the slide list.
  assert.deepEqual(slideTargets(presentation, relationships), ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
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
  assert.deepEqual(visibleSlides(zipped.buffer), { slides: [{ number: 1, part: "ppt/slides/slide2.xml" }], total: 2, hidden: 1, bodyFont: null });
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
  const reply = await renderSlideSvgs({ bytes: fixture("sample-deck.pptx"), parts: [part(1), part(3)] });
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
  const reply = await renderSlideSvgs({ bytes: fixture("hostile-links.pptx"), parts: visibleSlides(fixture("hostile-links.pptx")).slides.map((slide) => slide.part) });
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
  assert.equal(
    slidesNotice({ shown: 2, visible: 2, hidden: 1, skipped: 0 }),
    "One image a slide, in order, each named after its slide's number. 1 hidden slide isn't drawn.",
  );
  assert.equal(
    slidesNotice({ shown: MAX_SLIDES, visible: 250, hidden: 0, skipped: 3 }),
    "One image a slide, in order, each named after its slide's number. The first 100 of 250 slides are saved, the most one presentation gives here. 3 elements this converter can't draw are left out.",
  );
});

test("a presentation that runs past its time is stopped, and the file goes to the worker", async () => {
  const worker = { terminated: false, posted: null, onmessage: null, onerror: null };
  worker.postMessage = (job, transfer) => (worker.posted = { job, transfer });
  worker.terminate = () => (worker.terminated = true);
  const bytes = new ArrayBuffer(8);
  await assert.rejects(
    renderSlideSvgsInWorker({ bytes, parts: [part(1)] }, { timeoutMs: 20, createWorker: () => worker }),
    (error) => error.code === "layout_timeout" && error.message.includes(`more than ${SLIDES_TIMEOUT_MS / 1000} seconds`),
  );
  assert.equal(worker.terminated, true);
  assert.deepEqual(worker.posted.transfer, [bytes]);
});
