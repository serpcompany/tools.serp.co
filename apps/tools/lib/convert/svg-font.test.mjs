import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Worker as NodeWorker } from "node:worker_threads";

import opentype from "opentype.js";

import {
  CROSSINGS_NOTICE,
  FAR_OUTSIDE_MESSAGE,
  OUTSIDE_ARTBOARD_MESSAGE,
  REGIONS_TIMEOUT_MS,
  TOO_DETAILED_MESSAGE,
  UNCHECKED_NOTICE,
  WORKER_FAILED_NOTICE,
  fontFamilyName,
  readGlyph,
  regionsInWorker,
  svgToTtf,
} from "./svg-font.ts";
import { curvePoints } from "./svg-font-ttf.ts";
import { REGIONS_MEMORY, resolveRegions, resolveShape } from "./svg-font-boolean.ts";
import { MAX_GLYPH_POINTS } from "./svg-font-regions.ts";
import { LIMITS, UNREADABLE_SVG_MESSAGE } from "./svg-font-shapes.ts";
import { checkInputFile, convertWithWorker, getOutputMimeType } from "./workerClient.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const encode = (text) => new TextEncoder().encode(text).buffer;
const svg = (body, root = 'viewBox="0 0 24 24"') => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${body}</svg>`;

// The font, read back by a font parser (opentype.js), and its glyph on U+E000.
async function font(text, name = "icon.svg", options) {
  const result = await svgToTtf(typeof text === "string" ? encode(text) : text, name, options);
  const parsed = opentype.parse(result.buffer);
  const glyph = parsed.charToGlyph(String.fromCodePoint(0xe000));
  // opentype.js reads a glyph's points when its path is first asked for.
  void glyph.path;
  return { result, font: parsed, glyph };
}

async function refusal(text, name = "icon.svg", options) {
  try {
    await svgToTtf(typeof text === "string" ? encode(text) : text, name, options);
  } catch (error) {
    return error;
  }
  assert.fail("expected the SVG to be refused");
}

// The glyph's outline as polygons in font units (y up), curves sampled.
function polygons(glyph) {
  const result = [];
  let current = null;
  let at = null;
  for (const command of glyph.path.commands) {
    if (command.type === "M") {
      current = [{ x: command.x, y: command.y }];
      result.push(current);
    } else if (command.type === "L") {
      current.push({ x: command.x, y: command.y });
    } else if (command.type === "Q" || command.type === "C") {
      const [c1, c2] = command.type === "Q" ? [{ x: command.x1, y: command.y1 }] : [{ x: command.x1, y: command.y1 }, { x: command.x2, y: command.y2 }];
      for (let step = 1; step <= 16; step += 1) {
        const t = step / 16;
        const u = 1 - t;
        current.push(
          command.type === "Q"
            ? { x: u * u * at.x + 2 * u * t * c1.x + t * t * command.x, y: u * u * at.y + 2 * u * t * c1.y + t * t * command.y }
            : {
                x: u ** 3 * at.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * command.x,
                y: u ** 3 * at.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * command.y,
              },
        );
      }
    }
    if (command.x !== undefined) at = { x: command.x, y: command.y };
  }
  return result;
}

// Whether a TrueType renderer inks (x, y): its nonzero winding number there.
function inked(glyph, x, y) {
  let winding = 0;
  for (const polygon of polygons(glyph)) {
    for (let index = 0; index < polygon.length; index += 1) {
      const a = polygon[index];
      const b = polygon[(index + 1) % polygon.length];
      const side = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y);
      if (a.y <= y && b.y > y && side > 0) winding += 1;
      else if (a.y > y && b.y <= y && side < 0) winding -= 1;
    }
  }
  return winding !== 0;
}

// A point of a 0 0 24 24 artboard (y down) in font units: the artboard fills
// the em, 1,000 units, from 150 below the baseline.
const at = (x, y, size = 24) => [(x / size) * 1000, ((size - y) / size) * 1000 - 150];
const inkAt = (glyph, x, y, size) => inked(glyph, ...at(x, y, size));
// The glyph's bounds in font units, rounded, and the bounds of artboard
// points (x1, y1) to (x2, y2), y down, as the glyph would have them.
const bounds = (glyph) => Object.values(glyph.getBoundingBox()).map(Math.round);
const artboardBounds = (x1, y1, x2, y2, size) => at(x1, y2, size).concat(at(x2, y1, size)).map(Math.round);
// The glyph's ink within a 24-unit artboard, in its units (y down) to a
// tenth, as a browser shows it: what is off the artboard isn't seen.
const seenBounds = (glyph) => {
  const box = glyph.getBoundingBox();
  const unit = (value) => Math.round(Math.min(24, Math.max(0, value)) * 10) / 10;
  return [unit((box.x1 / 1000) * 24), unit(((850 - box.y2) / 1000) * 24), unit((box.x2 / 1000) * 24), unit(((850 - box.y1) / 1000) * 24)];
};

// The boolean step in a Node worker thread, as the page runs it in a Web
// Worker (svg-font.worker.ts): `code` runs on each job, posting each
// shape's region as it is found and then `done`, as the worker does, unless
// a test gives other code. `exits` collects the threads that ended;
// `heapMb` caps the thread's heap, as a phone's browser would (a thread past
// it stops with an error); `posted` collects the shapes' messages.
const RESOLVE_EACH = "resolveRegions(job, (index, shape) => parentPort.postMessage({ index, shape })); parentPort.postMessage({ done: true });";
function nodeWorker(code = RESOLVE_EACH, exits = [], { heapMb, posted } = {}) {
  const boolean = new URL("./svg-font-boolean.ts", import.meta.url).href;
  const source =
    `import { parentPort } from "node:worker_threads"; import { resolveRegions, resolveShape } from ${JSON.stringify(boolean)};` +
    `parentPort.on("message", (job) => { ${code} });`;
  return () => {
    const worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), heapMb ? { resourceLimits: { maxOldGenerationSizeMb: heapMb } } : {});
    const like = {
      onmessage: null,
      onerror: null,
      postMessage: (message, transfer) => worker.postMessage(message, transfer),
      terminate: () => void worker.terminate(),
    };
    worker.on("message", (data) => {
      if (!("done" in data)) posted?.push(data);
      like.onmessage?.({ data });
    });
    worker.on("error", (error) => like.onerror?.({ message: error.message }));
    worker.on("exit", () => exits.push(worker.threadId));
    return like;
  };
}

// Whether the SVG paints (x, y) of a path's polygons by `rule`, as a browser
// fills it; points this close to an edge are left out (a font's integer
// units move edges by up to half a unit, a fiftieth of a 24-unit artboard).
function paints(polygons, rule, x, y) {
  let winding = 0;
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) {
      const [ax, ay] = polygon[index];
      const [bx, by] = polygon[(index + 1) % polygon.length];
      const side = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (ay <= y && by > y && side > 0) winding += 1;
      else if (ay > y && by <= y && side < 0) winding -= 1;
    }
  }
  return rule === "evenodd" ? winding % 2 !== 0 : winding !== 0;
}
function nearEdge(polygons, x, y) {
  return polygons.some((polygon) =>
    polygon.some(([ax, ay], index) => {
      const [bx, by] = polygon[(index + 1) % polygon.length];
      const [dx, dy] = [bx - ax, by - ay];
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - ax - t * dx, y - ay - t * dy) < 0.05;
    }),
  );
}
// The points of a 24 x 24 grid, off the artboard's lines, the glyph and the
// SVG disagree on.
function disagreements(glyph, polygons, rule, also = () => false) {
  const wrong = [];
  for (let row = 0; row < 24; row += 1) {
    for (let column = 0; column < 24; column += 1) {
      const [x, y] = [column + 0.3137, row + 0.4729];
      if (nearEdge(polygons, x, y)) continue;
      if (inkAt(glyph, x, y) !== (paints(polygons, rule, x, y) || also(x, y))) wrong.push([x, y]);
    }
  }
  return wrong;
}
async function until(done, what) {
  for (let wait = 0; wait < 100 && !done(); wait += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(done(), what);
}
const pathOf = (polygons) => polygons.map((polygon) => `M${polygon.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");

test("an SVG icon becomes one glyph on U+E000, read back by a font parser, in a family named after the file", async () => {
  const bytes = readFileSync(path.join(fixtures, "sample-icon.svg"));
  const { result, font: parsed, glyph } = await font(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "sample-icon.svg");
  assert.equal(parsed.names.fontFamily.en, "sample-icon");
  assert.equal(result.family, "sample-icon");
  assert.equal(parsed.unitsPerEm, 1000);
  assert.deepEqual([parsed.ascender, parsed.descender], [850, -150]);
  assert.notEqual(glyph.index, 0, "U+E000 maps to a glyph, not .notdef");
  assert.equal(glyph.advanceWidth, 1000);
  const contours = glyph.getContours();
  assert.ok(contours.length >= 3 && contours.every((contour) => contour.length >= 3), "the glyph has outlines");
  assert.deepEqual(readGlyph(new Uint8Array(result.buffer)), {
    contours: contours.length,
    points: contours.reduce((sum, contour) => sum + contour.length, 0),
  });
  // The house of sample-icon.svg (viewBox -2 -2 28 28): its walls, roof and
  // chimney are inked; its window (an even-odd hole) and door aren't.
  const house = (x, y) => inkAt(glyph, x + 2, y + 2, 28);
  assert.ok(house(4.5, 20), "wall");
  assert.ok(house(12, 6), "roof");
  assert.ok(house(18, 4.5), "chimney");
  assert.ok(!house(8, 15), "window");
  assert.ok(!house(16, 20), "door");
  assert.ok(!house(1, 20), "outside");
  assert.match(result.notice, /character U\+E000 of the font "sample-icon"/);
});

test("each shape is filled by its own fill rule, and overlapping shapes are all filled", async () => {
  const ring = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0zM7 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z";
  const evenodd = (await font(svg(`<path fill-rule="evenodd" d="${ring}"/>`))).glyph;
  assert.ok(inkAt(evenodd, 4, 12) && !inkAt(evenodd, 12, 12), "even-odd: a ring");
  const sameWay = (await font(svg(`<path d="${ring}"/>`))).glyph;
  assert.ok(inkAt(sameWay, 4, 12) && inkAt(sameWay, 12, 12), "nonzero, both drawn the same way: a disc");
  const opposite = "M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0zM7 12a5 5 0 1 1 10 0a5 5 0 1 1 -10 0z";
  const nonzeroHole = (await font(svg(`<path d="${opposite}"/>`))).glyph;
  assert.ok(inkAt(nonzeroHole, 4, 12) && !inkAt(nonzeroHole, 12, 12), "nonzero, drawn opposite ways: a ring");
  // A mirrored circle runs the other way round from the square under it;
  // in one glyph it would cut a hole, but the SVG paints both.
  const overlap = (await font(svg('<rect x="2" y="2" width="20" height="20"/><circle cx="12" cy="12" r="6" transform="scale(-1 1) translate(-24 0)"/>'))).glyph;
  assert.ok(inkAt(overlap, 12, 12) && inkAt(overlap, 4, 4));
  // A ring's hole over another shape is filled by that shape.
  const filledHole = (await font(svg(`<path fill-rule="evenodd" d="${ring}"/><rect x="10" y="10" width="4" height="4"/>`))).glyph;
  assert.ok(inkAt(filledHole, 12, 12) && !inkAt(filledHole, 8.5, 12));
  // Colours are gone: a white shape over a dark one fills in.
  const white = (await font(svg('<rect width="24" height="24"/><circle cx="12" cy="12" r="4" fill="#fff"/>'))).glyph;
  assert.ok(inkAt(white, 12, 12));
});

test("transforms, viewBox offsets and artboards place the icon as a browser draws it", async () => {
  const square = '<rect x="4" y="4" width="8" height="8"/>';
  const nested = (await font(svg(`<g transform="translate(12 0)"><g transform="rotate(90 8 8)">${square}</g></g>`))).glyph;
  assert.ok(inkAt(nested, 20, 8) && !inkAt(nested, 8, 8));
  // An absolute H and V under a rotation (svg-pathdata 9.0.0 turns them
  // wrongly on its own), a skew, and transforms written as browsers read
  // them: without a space between, or with units.
  const rotated = (await font(svg('<path d="M4 4H12V12H4Z" transform="translate(12 0) rotate(90 8 8)"/>'))).glyph;
  assert.deepEqual(Object.values(rotated.getBoundingBox()).map(Math.round), at(16, 12).concat(at(24, 4)).map(Math.round));
  const skewed = (await font(svg('<rect width="8" height="8" transform="translate(4 4)skewX(45)"/>'))).glyph;
  assert.ok(inkAt(skewed, 15, 11) && inkAt(skewed, 6, 5) && !inkAt(skewed, 5, 11));
  const degrees = (await font(svg(`<g transform="translate(12px, 0px) rotate(90deg, 8, 8)">${square}</g>`))).glyph;
  assert.ok(inkAt(degrees, 20, 8) && !inkAt(degrees, 8, 8));
  // A transform a browser can't read is ignored, as a browser ignores it.
  const ignored = (await font(svg(`<g transform="translate(12 0" >${square}</g>`))).glyph;
  assert.ok(inkAt(ignored, 8, 8));
  // The same drawing with its viewBox moved: the same glyph.
  const offset = (await font(svg('<rect x="104" y="104" width="8" height="8"/>', 'viewBox="100 100 24 24"'))).glyph;
  assert.ok(inkAt(offset, 8, 8) && !inkAt(offset, 2, 2) && !inkAt(offset, 14, 14));
  // A width and height of another shape than the viewBox don't stretch it.
  const sized = (await font(svg('<circle cx="12" cy="12" r="12"/>', 'width="300" height="100" viewBox="0 0 24 24"'))).glyph;
  assert.equal(sized.advanceWidth, 1000);
  const box = sized.getBoundingBox();
  assert.ok(Math.abs(box.x2 - box.x1 - (box.y2 - box.y1)) < 4, "still round");
  // A wide artboard makes a wide glyph, as tall as the em.
  const wide = (await font(svg('<rect width="48" height="24"/>', 'viewBox="0 0 48 24"'))).glyph;
  assert.equal(wide.advanceWidth, 2000);
  assert.deepEqual(Object.values(wide.getBoundingBox()).map(Math.round), [0, -150, 2000, 850]);
  // No viewBox: the root's width and height, in their units.
  const points = (await font(svg('<rect width="9" height="9"/>', 'width="18pt" height="18pt"'))).glyph;
  assert.deepEqual(Object.values(points.getBoundingBox()).map(Math.round), [0, 475, 375, 850]);
  // Neither: the drawing's own bounds.
  const bare = (await font(svg('<rect x="50" y="50" width="10" height="20"/>', ""))).glyph;
  assert.equal(bare.advanceWidth, 500);
  // Shapes wholly off the artboard aren't in the glyph.
  const spare = (await font(svg(`${square}<rect x="400" y="400" width="8" height="8"/>`))).glyph;
  assert.equal(spare.getContours().length, 1);
});

test("a shape is filled as its styles say: inherited, from a stylesheet or a style attribute", async () => {
  const filled = async (body, x = 12, y = 12) => inkAt((await font(svg(body))).glyph, x, y);
  const disc = '<circle cx="12" cy="12" r="10"';
  const square = '<rect x="2" y="2" width="4" height="4"/>';
  assert.equal(await filled(`<g fill="none">${disc}/>${square}</g><rect x="20" y="20" width="2" height="2"/>`), false);
  assert.equal(await filled(`<style>.a{fill:none;stroke:#000}</style>${disc} class="a"/>${square}`), false);
  assert.equal(await filled(`<style>.a{fill:none}</style>${disc} class="a" style="fill:red"/>`), true);
  assert.equal(await filled(`${disc} style="fill: none"/>${square}`), false);
  assert.equal(await filled(`${disc} fill-opacity="0"/>${square}`), false);
  assert.equal(await filled(`<g visibility="hidden">${disc}/><rect x="2" y="2" width="4" height="4" visibility="visible"/></g>`), false);
  assert.equal(await filled(`<g opacity="0">${disc}/></g>${square}`), false);
  assert.equal(await filled(`<g display="none">${disc}/></g>${square}`), false);
  // Shapes inside <defs>, <clipPath>, <mask> and <symbol> aren't drawn,
  // unless a <use> draws them.
  assert.equal(await filled(`<defs>${disc} id="d"/></defs><clipPath>${disc}/></clipPath><mask>${disc}/></mask>${square}`), false);
  assert.equal(await filled(`<defs>${disc} id="d"/></defs><use href="#d"/>`), true);
  assert.equal(await filled(`<defs><rect id="r" width="4" height="4"/></defs><use xlink:href="#r" x="10" y="10" xmlns:xlink="http://www.w3.org/1999/xlink"/>`), true);
  const symbol = '<symbol id="s" viewBox="0 0 2 2"><rect width="2" height="2"/></symbol><use href="#s" x="10" y="10" width="4" height="4"/>';
  assert.deepEqual(bounds((await font(svg(symbol))).glyph), artboardBounds(10, 10, 14, 14));
  // A <use> of itself, or of its own group, is drawn once and stops.
  assert.equal(await filled(`<g id="g">${disc}/><use href="#g"/></g><use href="#u" id="u"/>`), true);
});

test("a <use> of a <symbol> with no width or height fills the viewport it is in, as browsers size it", async () => {
  // A 512-unit icon symbol in a 24-unit file.
  const icon = '<symbol id="i" viewBox="0 0 512 512"><path d="M0 0H512V512H0Z"/></symbol>';
  assert.deepEqual(bounds((await font(svg(`${icon}<use href="#i"/>`))).glyph), [0, -150, 1000, 850]);
  assert.deepEqual(bounds((await font(svg(`${icon}<use href="#i" x="6" y="6" width="12" height="12"/>`))).glyph), artboardBounds(6, 6, 18, 18));
  // The symbol's own width and height, when the <use> has none; and its
  // preserveAspectRatio.
  const sized = '<symbol id="t" viewBox="0 0 512 256" width="12" height="12" preserveAspectRatio="xMinYMin meet"><path d="M0 0H512V256H0Z"/></symbol>';
  assert.deepEqual(bounds((await font(svg(`${sized}<use href="#t"/>`))).glyph), artboardBounds(0, 0, 12, 6));
  // Nested: a <use> inside a symbol fills that symbol's viewport, and one
  // inside a group fills the viewport the group is drawn in.
  const nested = `${icon}<symbol id="o" viewBox="0 0 48 48"><use href="#i"/></symbol><use href="#o" width="12" height="12"/>`;
  assert.deepEqual(bounds((await font(svg(nested))).glyph), artboardBounds(0, 0, 12, 12));
  const inGroup = `<defs>${icon}<g id="g"><use href="#i"/></g></defs><use href="#g" transform="translate(12 12) scale(0.5)"/>`;
  assert.deepEqual(bounds((await font(svg(inGroup))).glyph), artboardBounds(12, 12, 24, 24));
  // A symbol of 1,024 units or more isn't taken as drawn far off the artboard.
  const large = '<symbol id="l" viewBox="0 0 2048 2048"><circle cx="1024" cy="1024" r="1024"/></symbol><use href="#l"/>';
  assert.ok(inkAt((await font(svg(large))).glyph, 12, 12));
  // A width or height of zero draws nothing.
  assert.equal((await refusal(svg(`${icon}<use href="#i" width="0"/>`))).code, "nothing_to_draw");
});

test("a transform on the root <svg> places the icon as a browser does: in CSS pixels, about the artboard's centre", async () => {
  const half = '<rect width="12" height="6"/>';
  // Translated, in pixels: 120 of a 240-pixel box is 12 of its 24 units.
  for (const root of ['viewBox="0 0 24 24" transform="translate(12 0)"', 'width="240" height="240" viewBox="0 0 24 24" transform="translate(120 0)"']) {
    assert.deepEqual(bounds((await font(svg(half, root))).glyph), artboardBounds(12, 0, 24, 6), root);
  }
  // Turned about the centre: the top left corner goes to the top right, as
  // Chromium draws it.
  assert.deepEqual(bounds((await font(svg(half, 'viewBox="0 0 24 24" transform="rotate(90)"'))).glyph), artboardBounds(18, 0, 24, 12));
  // Scaled about the centre.
  const scaled = (await font(svg('<rect width="24" height="24"/>', 'width="48" height="48" viewBox="0 0 24 24" transform="scale(0.5)"'))).glyph;
  assert.deepEqual(bounds(scaled), artboardBounds(6, 6, 18, 18));
  // A mirror keeps the outline clockwise, as TrueType's are.
  const mirrored = (await font(svg(half, 'viewBox="0 0 24 24" transform="scale(-1 1)"'))).glyph;
  assert.deepEqual(bounds(mirrored), artboardBounds(12, 0, 24, 6));
  assert.ok(inkAt(mirrored, 18, 3));
  // With no artboard the drawing's bounds frame it, turned.
  const bare = (await font(svg('<rect width="20" height="10"/>', 'transform="rotate(90)"'))).glyph;
  assert.equal(bare.advanceWidth, 500);
});

test("an even-odd outline that crosses itself or another keeps its holes, as the SVG paints it", async () => {
  // A star drawn as one outline: hollow in the middle by the even-odd rule,
  // filled by the nonzero rule.
  const star = '<polygon points="12,1 18.96,22.6 0.48,9.4 23.52,9.4 5.04,22.6"';
  const evenodd = (await font(svg(`${star} fill-rule="evenodd"/>`))).glyph;
  assert.ok(!inkAt(evenodd, 12, 13), "even-odd: the middle is empty");
  assert.ok(inkAt(evenodd, 12, 4) && inkAt(evenodd, 3, 10) && inkAt(evenodd, 6, 20), "the points are filled");
  const nonzero = (await font(svg(`${star}/>`))).glyph;
  assert.ok(inkAt(nonzero, 12, 13) && inkAt(nonzero, 12, 4), "nonzero: all filled");
  // Two partly overlapping squares in one even-odd path: the overlap is empty.
  const squares = (await font(svg('<path fill-rule="evenodd" d="M2 2H14V14H2Z M10 10H22V22H10Z"/>'))).glyph;
  assert.ok(!inkAt(squares, 12, 12) && inkAt(squares, 4, 4) && inkAt(squares, 20, 20));
  // The same squares by the nonzero rule: filled when drawn the same way
  // round, empty when drawn opposite ways, as a browser fills them.
  const same = (await font(svg('<path d="M2 2H14V14H2Z M10 10H22V22H10Z"/>'))).glyph;
  assert.ok(inkAt(same, 12, 12) && inkAt(same, 4, 4) && inkAt(same, 20, 20));
  const opposite = (await font(svg('<path d="M2 2H14V14H2Z M10 10V22H22V10Z"/>'))).glyph;
  assert.ok(!inkAt(opposite, 12, 12) && inkAt(opposite, 4, 4) && inkAt(opposite, 20, 20));
  // Two overlapping circles: a lens-shaped hole, with the circles' edges
  // within a font unit of where their curves are.
  const circles = 'M2 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0Z M10 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0Z';
  const lens = (await font(svg(`<path fill-rule="evenodd" d="${circles}"/>`))).glyph;
  assert.ok(!inkAt(lens, 12, 12) && inkAt(lens, 4, 12) && inkAt(lens, 20, 12));
  const edges = lens.getBoundingBox();
  assert.ok(Math.abs(edges.x1 - at(2, 0)[0]) < 1 && Math.abs(edges.x2 - at(22, 0)[0]) < 1 && Math.abs(edges.y2 - at(0, 6)[1]) < 1);
  // Another shape over the star's empty middle fills it.
  const covered = (await font(svg(`${star} fill-rule="evenodd"/><rect x="10" y="11" width="4" height="4"/>`))).glyph;
  assert.ok(inkAt(covered, 12, 13));
  // Two outlines exactly on top of each other fill nothing.
  const twice = await refusal(svg('<path fill-rule="evenodd" d="M2 2H22V22H2Z M2 2H22V22H2Z"/>'));
  assert.equal(twice.code, "nothing_to_draw");
  // An outline with no area (it goes out and back along a line) neither.
  assert.equal((await refusal(svg('<path d="M2 2L20 20L11 11Z"/>'))).code, "nothing_to_draw");
});

test("a nonzero shape's parts that wind the other way never cut a hole in another shape", async () => {
  // Two squares drawn opposite ways in one path: their overlap is empty,
  // and a square drawn over either part of them is filled.
  const body = '<path d="M2 2H14V14H2Z M10 10V22H22V10Z"/><rect x="3" y="3" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/>';
  const { glyph } = await font(svg(body));
  assert.ok(inkAt(glyph, 5, 5) && inkAt(glyph, 19, 19), "both small squares");
  assert.ok(inkAt(glyph, 12, 5) && inkAt(glyph, 19, 12), "both large squares");
  assert.ok(!inkAt(glyph, 12, 12), "their overlap");
  // A bow tie, whose two loops wind opposite ways, over a square.
  const crossed = (await font(svg('<path d="M2 2L22 22V2L2 22Z"/><rect x="16" y="10" width="4" height="4"/>'))).glyph;
  assert.ok(inkAt(crossed, 18, 12) && inkAt(crossed, 4, 12) && !inkAt(crossed, 12, 4), "a bow tie over a square");
  // Outlines drawn on top of each other the same way round wind twice, so
  // where one drawn the other way crosses them they still fill.
  const stacked = (await font(svg('<path d="M2 2H14V14H2Z M2 2H14V14H2Z M2 2H8V8H2Z M10 10V22H22V10Z"/><rect x="20" y="0" width="2" height="2"/>'))).glyph;
  assert.ok(inkAt(stacked, 4, 4) && inkAt(stacked, 6, 12) && inkAt(stacked, 12, 12) && inkAt(stacked, 18, 18) && !inkAt(stacked, 6, 18));
});

test("crossing outlines are worked out in a worker with a time limit, in bounded time", async () => {
  const exits = [];
  const regions = regionsInWorker({ createWorker: nodeWorker(undefined, exits) });
  // A 26-point even-odd path that sent martinez-polygon-clipping into an
  // endless loop: its region, exactly as the SVG fills it.
  const star =
    "M10.285714285714285 10.285714285714285L6.857142857142857 3.4285714285714284L0 6.857142857142857L10.285714285714285 17.142857142857142" +
    "L10.285714285714285 0L6.857142857142857 13.714285714285714L20.57142857142857 10.285714285714285Z" +
    "M6.857142857142857 10.285714285714285L20.57142857142857 0L13.714285714285714 10.285714285714285L17.142857142857142 17.142857142857142" +
    "L6.857142857142857 10.285714285714285L17.142857142857142 10.285714285714285L6.857142857142857 3.4285714285714284" +
    "L13.714285714285714 13.714285714285714L10.285714285714285 17.142857142857142L0 6.857142857142857Z" +
    "M17.142857142857142 3.4285714285714284L0 20.57142857142857L17.142857142857142 6.857142857142857L13.714285714285714 17.142857142857142" +
    "L6.857142857142857 13.714285714285714L6.857142857142857 3.4285714285714284L20.57142857142857 10.285714285714285" +
    "L3.4285714285714284 3.4285714285714284L6.857142857142857 6.857142857142857Z";
  const rings = star.split("Z").filter(Boolean).map((ring) => [...ring.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]));
  let started = Date.now();
  const { glyph, result } = await font(svg(`<path fill-rule="evenodd" d="${star}"/>`), "icon.svg", { regions });
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
  assert.doesNotMatch(result.notice, /cross/);
  assert.deepEqual(disagreements(glyph, rings, "evenodd"), []);
  await until(() => exits.length === 1, "the worker ended");
  // Random outlines that cross, touch and run along each other, each rule:
  // the glyph fills what the SVG fills, beside a square of another shape.
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let index = 0; index < 40; index += 1) {
    const grid = 2 + Math.floor(random() * 6);
    const polygons = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
      Array.from({ length: 3 + Math.floor(random() * 8) }, () => [Math.floor(random() * grid) * (24 / grid), Math.floor(random() * grid) * (24 / grid)]),
    );
    for (const rule of ["evenodd", "nonzero"]) {
      const text = svg(`<path fill-rule="${rule}" d="${pathOf(polygons)}"/><rect width="0.5" height="0.5"/>`);
      const made = await svgToTtf(encode(text), "icon.svg").catch((error) => error);
      if (made.code === "nothing_to_draw") continue;
      const drawn = opentype.parse(made.buffer).charToGlyph(String.fromCodePoint(0xe000));
      void drawn.path;
      assert.deepEqual(disagreements(drawn, polygons, rule, (x, y) => x < 0.5 && y < 0.5), [], `${rule} ${pathOf(polygons)}`);
    }
  }
  // A grid of thin bars (a font unit wide) crossing 640,000 and 2,560,000
  // times (17 and 36 KB, which took martinez 7 and 27 seconds) passes
  // MAX_CROSSINGS: taken as drawn, every bar filled, in well under the limit,
  // with the notice that says its holes, if it had any, would fill too.
  for (const bars of [400, 800]) {
    let d = "";
    for (let index = 0; index < bars; index += 1) d += `M0 ${index * (10000 / bars)}H10000V${index * (10000 / bars) + 10}H0Z`;
    for (let index = 0; index < bars; index += 1) d += `M${index * (10000 / bars)} 0V10000H${index * (10000 / bars) + 10}V0Z`;
    started = Date.now();
    const grid = await font(svg(`<path fill-rule="evenodd" d="${d}"/>`, 'viewBox="0 0 10000 10000"'), "icon.svg", { regions });
    assert.ok(Date.now() - started < 3_000, `${bars} bars took ${Date.now() - started} ms`);
    assert.ok(grid.result.notice.endsWith(UNCHECKED_NOTICE));
    // Each bar is a contour of its own, turned clockwise to fill.
    assert.equal(grid.glyph.getContours().length, 2 * bars);
  }
});

test("past the time limit, or when the worker fails, crossing outlines are taken as drawn, with a notice", async () => {
  const exits = [];
  const squares = svg('<path fill-rule="evenodd" d="M2 2H14V14H2Z M10 10H22V22H10Z M4 4H6V6H4Z"/><rect x="20" y="2" width="2" height="2"/>');
  // A worker that never answers is stopped at the limit.
  const started = Date.now();
  const stuck = await font(squares, "icon.svg", { regions: regionsInWorker({ timeoutMs: 300, createWorker: nodeWorker("for (;;);", exits) }) });
  assert.ok(Date.now() - started < 2_000, `took ${Date.now() - started} ms`);
  await until(() => exits.length === 1, "the stuck worker was terminated");
  assert.match(stuck.result.notice, /U\+E000/);
  assert.ok(stuck.result.notice.endsWith(CROSSINGS_NOTICE));
  // The squares that cross both fill, their overlap too; the small square
  // inside one, which crosses nothing, is still a hole; nothing winds below
  // zero, so the other shape is whole.
  assert.ok(inkAt(stuck.glyph, 4, 12) && inkAt(stuck.glyph, 12, 12) && inkAt(stuck.glyph, 20, 20) && inkAt(stuck.glyph, 21, 3));
  assert.ok(!inkAt(stuck.glyph, 5, 5));
  // A worker that fails to start, or crashes, says so.
  for (const createWorker of [() => { throw new Error("no worker"); }, nodeWorker("throw new Error('crash')")]) {
    const failed = await font(squares, "icon.svg", { regions: regionsInWorker({ createWorker }) });
    assert.ok(failed.result.notice.endsWith(WORKER_FAILED_NOTICE) && inkAt(failed.glyph, 12, 12));
    assert.ok(!failed.result.notice.includes(CROSSINGS_NOTICE));
  }
  // A shape found before the time limit is kept; only the one the worker
  // hadn't finished is taken as drawn.
  const two = svg(
    '<path fill-rule="evenodd" d="M2 2H10V10H2Z M6 6H12V12H6Z"/><path fill-rule="evenodd" d="M13 13H21V21H13Z M17 17H23V23H17Z"/>',
  );
  const half = await font(two, "icon.svg", {
    regions: regionsInWorker({ timeoutMs: 300, createWorker: nodeWorker("parentPort.postMessage({ index: 0, shape: resolveShape(job.shapes[0]) }); for (;;);") }),
  });
  assert.ok(!inkAt(half.glyph, 8, 8), "the first shape keeps its even-odd overlap empty");
  assert.ok(inkAt(half.glyph, 19, 19), "the second, taken as drawn, fills its overlap");
  assert.ok(half.result.notice.endsWith(CROSSINGS_NOTICE));
  // Without crossings there is no worker and no notice.
  const plain = await font(svg('<path fill-rule="evenodd" d="M2 2H22V22H2Z M8 8H16V16H8Z"/>'), "icon.svg", {
    regions: () => assert.fail("no shape needs the boolean step"),
  });
  assert.doesNotMatch(plain.result.notice, /cross/);
  assert.equal(REGIONS_TIMEOUT_MS, 5_000);
});

// Tall bars, a bar across the first two (so the shape goes to the boolean
// step), and a staircase of `stairs` points at as many heights: the slabs
// times the edges in each grow large while the file stays small. With 400
// bars and 12,000 stairs it is the 198 KB file that took the worker to 3 GB
// in review. `inkAt` reads its glyph in the file's own units (y down).
function barsAndStairs(bars, stairs) {
  let d = "";
  for (let index = 0; index < bars; index += 1) d += `M${index * 10} 0h4v1000h-4z`;
  d += "M-5 500H15V501H-5Z";
  const x0 = bars * 10 + 100;
  d += `M${x0} 0`;
  for (let k = 1; k < stairs; k += 1) d += `L${(x0 + k * 0.5 + (k % 2) * 0.3).toFixed(2)} ${((k * 1000) / stairs).toFixed(3)}`;
  d += `L${x0 + stairs * 0.5 + 10} 1000L${x0 + stairs * 0.5 + 10} 0Z`;
  const width = x0 + stairs * 0.5 + 30;
  const scale = Math.min(1000 / 1020, 16000 / width);
  return {
    text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${width} 1020"><path fill-rule="evenodd" d="${d}"/></svg>`,
    x0,
    inkAt: (glyph, x, y) => inked(glyph, (x + 10) * scale, (1010 - y) * scale - 150),
  };
}

test("the boolean step keeps to its memory and work: the 198 KB file that took 3 GB is worked out in a capped thread, a larger one taken as drawn", async () => {
  // The thread's heap is capped at 64 MB, as a phone's browser caps a
  // worker's: past it the thread stops, and the notice would say the step
  // didn't run. (Measured in review's file: 14 MB at its peak, against 3 GB
  // before the step charged what it keeps to REGIONS_MEMORY.)
  const regions = regionsInWorker({ createWorker: nodeWorker(undefined, [], { heapMb: 64 }) });
  const review = barsAndStairs(400, 12_000);
  assert.equal(review.text.length, 198_107);
  let started = Date.now();
  const exact = await font(review.text, "icon.svg", { regions });
  assert.ok(Date.now() - started < 4_000, `took ${Date.now() - started} ms`);
  assert.doesNotMatch(exact.result.notice, /cross|couldn't run/);
  const { inkAt: at400 } = review;
  assert.ok(at400(exact.glyph, 32, 250) && !at400(exact.glyph, 37, 250), "a bar, and the gap beside it");
  assert.ok(at400(exact.glyph, 7, 500.5) && !at400(exact.glyph, 2, 500.5), "the bar across: filled between the bars, empty where it crosses one");
  assert.ok(at400(exact.glyph, review.x0 + 4500, 500) && !at400(exact.glyph, review.x0 + 1500, 500), "the staircase");
  // Four times the bars: past REGIONS_WORK, so taken as drawn (every bar
  // filled, where they cross too), in about a second, in the same 64 MB.
  const larger = barsAndStairs(1_600, 12_000);
  started = Date.now();
  const drawn = await font(larger.text, "icon.svg", { regions });
  assert.ok(Date.now() - started < 4_000, `took ${Date.now() - started} ms`);
  assert.ok(drawn.result.notice.endsWith(CROSSINGS_NOTICE));
  assert.ok(larger.inkAt(drawn.glyph, 2, 500.5) && larger.inkAt(drawn.glyph, 32, 250) && larger.inkAt(drawn.glyph, larger.x0 + 4500, 500));
  // What the step keeps is charged to REGIONS_MEMORY as it grows: past it,
  // the shape is taken as drawn.
  const square = (x, y, size) => Float64Array.from([x, y, x + size, y, x + size, y + size, x, y + size, x, y]);
  const crossing = { fillRule: "evenodd", rings: [square(0, 0, 10), square(5, 5, 10)] };
  assert.deepEqual(resolveShape(crossing, { memory: 1_000 }), { fallback: "memory" });
  // Two L shapes, which touch at two corners.
  assert.equal(resolveShape(crossing).contours.length, 2);
  assert.equal(REGIONS_MEMORY, 64 * 1024 * 1024);
});

test("each shape is checked for crossings with its own allowance: one that runs out is filled as drawn on its own", async () => {
  // 3,200 thin bars in one path, apart but side by side, so finding that
  // they don't cross means comparing about 80 million pairs of edges: more
  // than that shape's allowance. A ring with a hole after it (or before it)
  // still keeps its hole, and the notice says what happened.
  const bars = (count) => {
    let d = "";
    for (let index = 0; index < count; index += 1) d += `M200 ${200 + index * 0.3125}H1200V${200 + index * 0.3125 + 0.094}H200Z`;
    return d;
  };
  const many = `<g transform="scale(.01)"><path d="${bars(3_200)}"/></g>`;
  const ring = '<path fill-rule="evenodd" d="M14 14H22V22H14Z M16 16H20V20H16Z"/>';
  for (const body of [many + ring, ring + many]) {
    const started = Date.now();
    const { glyph, result } = await font(svg(body), "icon.svg", { regions: () => assert.fail("no shape needs the boolean step") });
    assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
    assert.ok(!inkAt(glyph, 18, 18) && inkAt(glyph, 15, 15), "the ring keeps its hole");
    assert.ok(result.notice.endsWith(UNCHECKED_NOTICE));
    assert.ok(!result.notice.includes(CROSSINGS_NOTICE));
  }
  // The same ring in the bars' own even-odd path (review's repro): the
  // whole shape is filled as drawn, every contour clockwise, so the ring's
  // hole fills though nothing crosses it, and the notice says holes may
  // fill. With 100 bars the shape is checked: the hole stays, no notice.
  const ringPath = "M1400 1400H2200V2200H1400Z M1600 1600H2000V2000H1600Z";
  for (const count of [3_200, 100]) {
    const body = `<g transform="scale(.01)"><path fill-rule="evenodd" d="${bars(count)}${ringPath}"/></g>`;
    const { glyph, result } = await font(svg(body), "icon.svg", { regions: () => assert.fail("no shape needs the boolean step") });
    assert.ok(inkAt(glyph, 15, 15));
    if (count === 3_200) {
      assert.ok(inkAt(glyph, 18, 18), "the hole fills");
      assert.ok(result.notice.endsWith(UNCHECKED_NOTICE));
      assert.match(UNCHECKED_NOTICE, /their holes, and gaps where their outlines cross, may fill in/);
    } else {
      assert.ok(!inkAt(glyph, 18, 18), "the hole stays");
      assert.doesNotMatch(result.notice, /fill/);
    }
  }
});

// The round-4 review's drawing: `shapes` copies of one even-odd path of
// `loops` tightly bent curves, each of which the boolean step makes 256
// lines (ringOf's most), round a square that crosses the first, so each
// copy goes to the boolean step (without the square nothing crosses, and
// the curves stay curves). Its 225 copies of 254 loops are 1.76 MB, each
// copy under every limit of its own.
function bentLoops(shapes, loops, { square = true } = {}) {
  const step = Math.min(24, 6096 / loops);
  let d = "M0 0";
  for (let index = 0; index < loops; index += 1) d += `C7300 ${-index * step} -7300 ${-(index + 1) * step} 0 ${-(index + 1) * step}`;
  d += `L3000 ${-loops * step}L3000 0Z${square ? " M-50 -5H50V5H-50Z" : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-500 -900 1000 1000">${`<path fill-rule="evenodd" d="${d}"/>`.repeat(shapes)}</svg>`;
}

// svgToTtf on a Node worker thread whose heap is capped at `heapMb`, as a
// phone's browser caps a page's (a thread past it stops with an error): the
// glyph's points, or the refusal's code and message, and how long it took.
// The boolean step isn't run there: nothing in the tests' files needs it.
function inCappedThread(text, heapMb) {
  const svgFont = new URL("./svg-font.ts", import.meta.url).href;
  const source =
    `import { parentPort } from "node:worker_threads"; import { svgToTtf, readGlyph } from ${JSON.stringify(svgFont)};` +
    `parentPort.on("message", async (text) => { const started = Date.now();` +
    `try { const { buffer } = await svgToTtf(new TextEncoder().encode(text).buffer, "icon.svg", { regions: () => { throw new Error("the boolean step ran"); } });` +
    ` parentPort.postMessage({ points: readGlyph(new Uint8Array(buffer)).points, ms: Date.now() - started }); }` +
    `catch (error) { parentPort.postMessage({ code: error.code, message: error.message, ms: Date.now() - started }); } });`;
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(new URL(`data:text/javascript,${encodeURIComponent(source)}`), { resourceLimits: { maxOldGenerationSizeMb: heapMb } });
    worker.on("message", (message) => {
      resolve(message);
      void worker.terminate();
    });
    worker.on("error", reject);
    worker.postMessage(text);
  });
}

test("the boolean step keeps to the room the glyph has: a shape past it is taken as drawn, and the file is refused only for its exact points", async () => {
  assert.equal(MAX_GLYPH_POINTS, 65_535);
  // The round-4 review's 1.76 MB file: each copy's curves as lines are
  // 65,031 points, past the room the glyph has beside the other copies'
  // 259 segments, so every copy is taken as drawn, before its rings are
  // made and without the boolean step. Its curves then make more points
  // than a glyph holds (each copy about 1,500), so the file is refused as
  // too detailed: in 0.8 s, with the page's heap capped at 128 MB (it fails
  // at 96 MB, as at f80448e). At 10d79a7 it took 11.9 s, the worker posted
  // 2.93 million points, and the page peaked at 2.0 to 2.5 GB. Here the
  // thread's heap is capped at 256 MB, half the 512 MB of a phone with 2 GB.
  const review = bentLoops(225, 254);
  assert.equal(review.length, 1_756_876);
  const refused = await inCappedThread(review, 256);
  assert.equal(refused.code, "too_complex");
  assert.equal(refused.message, TOO_DETAILED_MESSAGE);
  assert.ok(refused.ms < 3_000, `took ${refused.ms} ms`);

  // Just under: two copies of 127 loops, 65,038 points as lines, are worked
  // out in the worker (65,046 points as found) and make a glyph (12,204
  // points once rounded to whole units), in about a third of a second, with
  // the page's heap capped at 32 MB.
  const exits = [];
  const posted = [];
  const regions = regionsInWorker({ createWorker: nodeWorker(undefined, exits, { posted }) });
  let started = Date.now();
  const under = await font(bentLoops(2, 127), "icon.svg", { regions });
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
  assert.equal(posted.length, 2);
  const { points } = readGlyph(new Uint8Array(under.result.buffer));
  assert.ok(points > 10_000, `${points} points`);
  assert.doesNotMatch(under.result.notice, /fill/);

  // The regions found are counted in the worker as each is found: crossings
  // add points, so grids of bars that cross (16,200 points each as found,
  // 270 as drawn) fit four to the room the glyph has beside five, and three
  // beside forty. The worker stops at the first that doesn't fit, which and
  // the rest are taken as drawn, each bar filled where they cross, with a
  // notice; the glyph holds them all.
  const grid = (count) => {
    const step = 1000 / 45;
    let d = "";
    for (let index = 0; index < 45; index += 1) d += `M0 ${index * step}H1000V${index * step + step / 3}H0Z`;
    for (let index = 0; index < 45; index += 1) d += `M${index * step} 0V1000H${index * step + step / 3}V0Z`;
    const paths = Array.from({ length: count }, (_, index) => `<path fill-rule="evenodd" transform="translate(${index * 3} ${index * 3})" d="${d}"/>`);
    return svg(paths.join(""), 'viewBox="0 0 1020 1020"');
  };
  // Where the first grid's first bars cross, and the last grid's last
  // (the grids are 3 units apart, so no other grid's bars are there; of
  // forty, the last's are off the artboard): a hole when worked out, filled
  // when taken as drawn.
  const firstCrossing = at(1.5, 1.5, 1020);
  const lastCrossing = (count) => at((count - 1) * 3 + 983.7, (count - 1) * 3 + 983.7, 1020);
  for (const [count, worked] of [[5, 5], [40, 4]]) {
    posted.length = 0;
    started = Date.now();
    const { glyph, result } = await font(grid(count), "icon.svg", { regions });
    assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
    assert.equal(posted.length, worked);
    assert.deepEqual(posted.at(-1).shape, { fallback: "glyph" });
    assert.ok(result.notice.endsWith(CROSSINGS_NOTICE));
    assert.ok(!inked(glyph, ...firstCrossing), "the first grid's crossings are holes");
    if (count === 5) assert.ok(inked(glyph, ...lastCrossing(count)), "the last grid's crossings are filled");
    assert.ok(readGlyph(new Uint8Array(result.buffer)).points <= MAX_GLYPH_POINTS);
  }
  const four = await font(grid(4), "icon.svg", { regions });
  assert.ok(four.glyph.getContours().length > 4 * 1_000);
  assert.ok(!inked(four.glyph, ...lastCrossing(4)));
  assert.doesNotMatch(four.result.notice, /fill/);
  // And again on the page's thread, whatever the worker sent: the fifth
  // grid, past the room, is taken as drawn.
  const unbounded = regionsInWorker({ createWorker: nodeWorker("job.shapes.forEach((shape, index) => parentPort.postMessage({ index, shape: resolveShape(shape) })); parentPort.postMessage({ done: true });") });
  const fifth = await font(grid(5), "icon.svg", { regions: unbounded });
  assert.ok(fifth.result.notice.endsWith(CROSSINGS_NOTICE));
  assert.ok(!inked(fifth.glyph, ...firstCrossing) && inked(fifth.glyph, ...lastCrossing(5)));
  // In the job, a region with no room left stops it.
  const square = (x, y, size) => Float64Array.from([x, y, x + size, y, x + size, y + size, x, y + size, x, y]);
  const squares = { fillRule: "evenodd", rings: [square(0, 0, 10), square(5, 5, 10)], drawn: 8 };
  assert.deepEqual(resolveRegions({ shapes: [squares, squares, squares], room: 4 }).map((shape) => "contours" in shape || shape.fallback), [true, "glyph"]);
  assert.equal(resolveRegions({ shapes: [squares, squares, squares], room: 12 }).length, 3);
  await until(() => exits.length === 4, "the workers ended");
});

test("a shape too detailed for the room the glyph has is taken as drawn, so a less detailed one is never refused where a more detailed one converts", async () => {
  // The review's repro: a path of tightly bent loops round a square that
  // crosses it (bentLoops), beside a zigzag of 2,000 points that crosses
  // nothing. With 250 loops, its curves as lines (64,000 points) don't fit
  // beside the zigzag, and with 262 they are more than a glyph holds on
  // their own: either way the loops are taken as drawn, their curves kept,
  // and the font is made, with a notice. (At f80448e the 250 loops were
  // refused, though 262 converted.)
  const zigzag = () => {
    let d = "M-400 90";
    for (let index = 0; index < 2_000; index += 1) d += `L${(-400 + (800 * index) / 2_000).toFixed(2)} ${index % 2 ? 50 : 60}`;
    return `<path d="${d}L400 90Z"/>`;
  };
  for (const loops of [250, 262]) {
    const text = bentLoops(1, loops).replace("</svg>", `${zigzag()}</svg>`);
    const started = Date.now();
    const { glyph, result } = await font(text, "icon.svg", { regions: () => assert.fail("the loops don't fit the room left") });
    assert.ok(Date.now() - started < 3_000, `${loops} took ${Date.now() - started} ms`);
    assert.ok(result.notice.endsWith(CROSSINGS_NOTICE), `${loops}: ${result.notice}`);
    // The zigzag (y 60 to 90 in the artboard, -900 to 100: 125 to 140 units
    // below the baseline) and the loops' far side (x 2,800, past the
    // artboard's right edge, where only the path's last lines are) are drawn.
    assert.ok(inked(glyph, 500, -125) && inked(glyph, 3300, 600), `${loops}`);
  }
  // Alone, the 250 loops fit, and are worked out.
  const alone = await font(bentLoops(1, 250), "icon.svg", { regions: regionsInWorker({ createWorker: nodeWorker() }) });
  assert.doesNotMatch(alone.result.notice, /fill/);
});

test("the glyph's points are counted as svg2ttf writes them: smooth curves keep about one point a quadratic, and the cap is exact", async () => {
  const noRegions = () => assert.fail("nothing crosses");
  // The review's 4,000 circles (r 5 in a 1,000-unit artboard, 0.16 MB): at
  // f80448e refused as needing over 65,535 points, as each of svg2ttf's
  // quadratics was counted as two; svg2ttf writes 37,410, as at 10d79a7.
  const circles = (count) =>
    svg(Array.from({ length: count }, (_, index) => `<circle cx="${(index % 70) * 14 + 7}" cy="${Math.floor(index / 70) * 13.5 + 7}" r="5"/>`).join(""), 'viewBox="0 0 1000 1000"');
  for (const [count, expected] of [[4_000, 37_410], [4_999, 46_700]]) {
    const started = Date.now();
    const { result } = await font(circles(count), "icon.svg", { regions: noRegions });
    assert.ok(Date.now() - started < 3_000, `${count} took ${Date.now() - started} ms`);
    assert.equal(readGlyph(new Uint8Array(result.buffer)).points, expected);
  }
  // At the cap and one over: 6,800 dots in one path (63,716 points) and a
  // zigzag below them, each of whose corners is a point.
  const capped = (corners) => {
    let dots = "";
    for (let index = 0; index < 6_800; index += 1) {
      const [x, y] = [(index % 85) * 11.7 + 6, Math.floor(index / 85) * 11.5 + 6];
      dots +=
        `M${x + 5} ${y}C${x + 5} ${y + 2.76} ${x + 2.76} ${y + 5} ${x} ${y + 5}C${x - 2.76} ${y + 5} ${x - 5} ${y + 2.76} ${x - 5} ${y}` +
        `C${x - 5} ${y - 2.76} ${x - 2.76} ${y - 5} ${x} ${y - 5}C${x + 2.76} ${y - 5} ${x + 5} ${y - 2.76} ${x + 5} ${y}Z`;
    }
    let zigzag = "M0 990";
    for (let index = 1; index < corners - 1; index += 1) zigzag += `L${index} ${index % 2 ? 960 : 970}`;
    return svg(`<path d="${dots}"/><path d="${zigzag}L${corners - 2} 990Z"/>`, 'viewBox="0 0 1000 1000"');
  };
  let started = Date.now();
  const { result } = await font(capped(1_819), "icon.svg", { regions: noRegions });
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
  assert.equal(readGlyph(new Uint8Array(result.buffer)).points, MAX_GLYPH_POINTS);
  started = Date.now();
  const error = await refusal(capped(1_820), "icon.svg", { regions: noRegions });
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
  assert.equal(error.code, "too_complex");
  assert.equal(error.message, TOO_DETAILED_MESSAGE);
});

test("curves taken as drawn are made into the glyph's points one contour at a time, and a file of too many is refused before svg2ttf runs", async () => {
  // Tightly bent curves, which cross nothing (no square), so they stay
  // curves. 5,000 are 99,000 points as svg2ttf's quadratics, and svg2ttf
  // keeps 30,008: the font is made, as at 10d79a7, which took 2.4 s
  // (svg2ttf's own simplify took time as the square of the points).
  let started = Date.now();
  const { result } = await font(bentLoops(1, 5_000, { square: false }), "icon.svg", { regions: () => assert.fail("nothing crosses") });
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
  assert.deepEqual(readGlyph(new Uint8Array(result.buffer)), { contours: 1, points: 30_008 });
  // 20,000 (1.07 MB) keep about 120,000: refused as soon as 65,535 are
  // made. At 10d79a7 svg2ttf ran 20 s into a stack overflow (a "try
  // again").
  started = Date.now();
  const error = await refusal(bentLoops(1, 20_000, { square: false }), "icon.svg", { regions: () => assert.fail("nothing crosses") });
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started} ms`);
  assert.equal(error.message, TOO_DETAILED_MESSAGE);
  // A curve that runs back along a line makes many quadratics and may keep
  // few points; they are never held at once. 20,000 of them in one contour
  // (0.55 MB) are 320,000 points as svg2ttf's quadratics, and keep 40,006:
  // the font is made, with the page's heap capped at 64 MB (f80448e refused
  // it, counting the quadratics). 59,990 (1.63 MB, under 60,000 path
  // commands) are 960,000 points as quadratics: refused once 65,535 are
  // kept, with the page's heap capped at 256 MB, as for the review's file
  // above (reading and flattening 60,000 curves takes most of it).
  const back = (count) => {
    let d = "M0 0";
    for (let index = 0; index < count; index += 1) d += `C${(index * 0.05 + 400).toFixed(2)} 0 ${(index * 0.05 - 300).toFixed(2)} 0 ${((index + 1) * 0.05).toFixed(2)} 0`;
    const width = (count * 0.05).toFixed(2);
    return svg(`<path d="${d}L${width} 500L0 500Z"/>`, `viewBox="0 -500 ${Math.ceil(count * 0.05)} 1000"`);
  };
  const kept = await inCappedThread(back(20_000), 64);
  assert.equal(kept.points, 40_006);
  assert.ok(kept.ms < 3_000, `took ${kept.ms} ms`);
  const refused = await inCappedThread(back(59_990), 256);
  assert.equal(refused.message, TOO_DETAILED_MESSAGE);
  assert.ok(refused.ms < 5_000, `took ${refused.ms} ms`);
});

test("the glyph's points are svg2ttf's own: its quadratics, simplify, interpolate and rounding, made from the end of each contour", async () => {
  // svg2ttf 6.1.0's steps, as svg-font.ts had svg2ttf run them before this
  // module made the points: path data to a hundredth, svgpath and
  // cubicToQuad at 0.3, toSfntCoutours, `simplify` twice (skipped for a
  // contour all on the curve in whole units), `interpolate`, `roundPoints`,
  // repeated points merged, removeClosingReturnPoints.
  const require = createRequire(import.meta.url);
  const SvgPath = createRequire(require.resolve("svg2ttf"))("svgpath");
  const svgSteps = require("svg2ttf/lib/svg.js");
  const steps = require("svg2ttf/lib/ttf/utils.js");
  const hundredth = (value) => Math.round(value * 100) / 100;
  const whole = (contour) => contour.every((point) => point.onCurve && Number.isInteger(point.x) && Number.isInteger(point.y));
  const counts = { skipped: 0, simplified: 0, interpolated: 0 };
  const svg2ttfPoints = ({ start, segments }) => {
    const xy = (point) => `${hundredth(point.x)} ${hundredth(point.y)}`;
    const d = `M${xy(start)}${segments.map(({ c1, c2, to }) => (c1 ? `C${xy(c1)} ${xy(c2)} ${xy(to)}` : `L${xy(to)}`)).join("")}Z`;
    const path = new SvgPath(d).abs().unshort().unarc().iterate((segment, index, x, y) => svgSteps.cubicToQuad(segment, index, x, y, 0.3));
    let [contour] = svgSteps.toSfntCoutours(path).map((points) => points.map(({ x, y, onCurve }) => ({ x, y, onCurve })));
    for (let pass = 0; pass < 2; pass += 1) {
      if (whole(contour)) counts.skipped += 1;
      else [contour] = steps.simplify([contour], 0.3);
    }
    const simplified = contour.length;
    [contour] = steps.interpolate([contour], 1.1);
    counts.interpolated += simplified - contour.length;
    [contour] = steps.roundPoints([contour]);
    const kept = [];
    for (const point of contour) {
      const last = kept.at(-1);
      if (last && last.x === point.x && last.y === point.y) kept[kept.length - 1] = { ...last, onCurve: last.onCurve || point.onCurve };
      else kept.push(point);
    }
    while (kept.length > 1 && kept[0].x === kept.at(-1).x && kept[0].y === kept.at(-1).y) {
      const last = kept.pop();
      kept[0] = { ...kept[0], onCurve: kept[0].onCurve || last.onCurve };
    }
    return steps.removeClosingReturnPoints([kept])[0];
  };
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (...values) => values[Math.floor(random() * values.length)];
  for (let index = 0; index < 3_000; index += 1) {
    // Curves of every size, some under a unit, some running back along a
    // line, some straight, in whole units or not, between lines.
    const kind = pick("float", "whole", "tiny", "straight");
    let at = { x: Math.round(random() * 1000 - 500) + (kind === "float" ? random() : 0), y: Math.round(random() * 1000 - 500) };
    const start = { ...at };
    const segments = [];
    for (let count = 1 + Math.floor(random() * 25); segments.length < count; ) {
      if (kind === "straight") {
        // Straight curves a third and two thirds along, or with their
        // controls on their ends: simplify may keep only whole points.
        const [dx, dy] = [3 * Math.round((random() - 0.5) * 20), 3 * Math.round((random() - 0.5) * 20)];
        const to = { x: at.x + dx, y: at.y + dy };
        const shape = segments.length && random() > 0.3 ? pick("thirds", "ends") : "line";
        if (shape === "line") segments.push({ to });
        else if (shape === "thirds") segments.push({ c1: { x: at.x + dx / 3, y: at.y + dy / 3 }, c2: { x: at.x + (2 * dx) / 3, y: at.y + (2 * dy) / 3 }, to });
        else segments.push({ c1: { ...at }, c2: { ...to }, to });
        at = to;
        continue;
      }
      const size = kind === "tiny" ? 0.6 : kind === "whole" ? Math.round(random() * 40) : random() * 200;
      let to = { x: at.x + (random() - 0.5) * size, y: at.y + (random() - 0.5) * size };
      if (kind === "whole") to = { x: Math.round(to.x), y: Math.round(to.y) };
      const shape = pick("line", "curve", "curve", "back", "small", "same");
      if (shape === "same") to = { ...at };
      if (shape === "line" || shape === "same") segments.push({ to });
      else if (shape === "back") {
        const along = (t) => ({ x: at.x + (to.x - at.x) * t, y: at.y + (to.y - at.y) * t });
        segments.push({ c1: along(pick(0.3, -0.5, 1.4)), c2: along(pick(0.7, 1.5, -0.4)), to });
      } else {
        const spread = shape === "small" ? 0.8 : size * 2;
        const near = (point) => ({ x: point.x + (random() - 0.5) * spread, y: point.y + (random() - 0.5) * spread });
        segments.push({ c1: near(at), c2: near(to), to });
      }
      at = to;
    }
    if (!segments.some((segment) => segment.c1)) segments.push({ c1: { x: at.x + 30, y: at.y + 40 }, c2: { x: start.x - 20, y: start.y + 10 }, to: { ...start } });
    const expected = svg2ttfPoints({ start, segments });
    assert.deepEqual(curvePoints({ start, segments }, MAX_GLYPH_POINTS), expected);
    // Exactly as many as they are fit; one fewer doesn't.
    assert.equal(curvePoints({ start, segments }, expected.length).length, expected.length);
    assert.equal(curvePoints({ start, segments }, expected.length - 1), null);
  }
  assert.ok(counts.skipped > 300 && counts.interpolated > 10_000, JSON.stringify(counts));
});

// The glyph's contours as TrueType stores them: whole-unit points, x, y.
function glyphContours(glyph) {
  const contours = [];
  let start = 0;
  for (const end of glyph.endPointIndices) {
    contours.push(glyph.points.slice(start, end + 1).map((point) => [point.x, point.y]));
    start = end + 1;
  }
  return contours;
}
const turn = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
// Whether segments ab and cd cross at a point inside both.
function crossInside(a, b, c, d) {
  const [d1, d2, d3, d4] = [turn(c, d, a), turn(c, d, b), turn(a, b, c), turn(a, b, d)];
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// Whether a contour passes through one of its points twice, crossing
// itself there: the two passes' ways in and out alternate round the point.
function crossesAtAPoint(points) {
  const visits = new Map();
  points.forEach(([x, y], index) => visits.set(`${x},${y}`, [...(visits.get(`${x},${y}`) ?? []), index]));
  const angle = (from, to) => Math.atan2(points[to][1] - points[from][1], points[to][0] - points[from][0]);
  const around = (value, from) => (value - from + 4 * Math.PI) % (2 * Math.PI);
  for (const indices of visits.values()) {
    const passes = indices.map((index) => [angle(index, (index - 1 + points.length) % points.length), angle(index, (index + 1) % points.length)]);
    for (let a = 0; a < passes.length; a += 1) {
      for (let b = a + 1; b < passes.length; b += 1) {
        const [in1, out1] = passes[a];
        const inside = (value) => around(value, in1) > 0 && around(value, in1) < around(out1, in1);
        if (passes[b].every((value) => value !== in1 && value !== out1) && inside(passes[b][0]) !== inside(passes[b][1])) return true;
      }
    }
  }
  return false;
}

test("the font's outlines have no zero-length segments and don't cross themselves, after rounding to whole units", async () => {
  // Random outlines that cross: one even-odd shape, a nonzero shape beside a
  // square (so it goes to the boolean step too), and two or three even-odd
  // shapes; corners anywhere, and on a grid (where crossings meet at
  // corners). Before snap rounding, two thirds of such fonts had repeated
  // points and some a contour crossing itself.
  let seed = 11;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const path = (onGrid) => {
    const coordinate = () => (onGrid ? 1 + Math.floor(random() * 7) * 3.6 : 1 + random() * 22).toFixed(6);
    let d = "";
    for (let ring = 0; ring < 1 + Math.floor(random() * 3); ring += 1) {
      const corners = 3 + Math.floor(random() * 9);
      for (let corner = 0; corner < corners; corner += 1) d += `${corner ? "L" : "M"}${coordinate()} ${coordinate()}`;
      d += "Z";
    }
    return d;
  };
  let checked = 0;
  for (let index = 0; index < 240; index += 1) {
    const onGrid = index % 2 === 1;
    const kind = index % 3;
    const shapes =
      kind === 0 ? [["evenodd", path(onGrid)]] : kind === 1 ? [["nonzero", path(onGrid)], ["nonzero", "M0 0H0.5V0.5H0Z"]] : [["evenodd", path(onGrid)], ["evenodd", path(onGrid)]];
    const text = svg(shapes.map(([rule, d]) => `<path fill-rule="${rule}" d="${d}"/>`).join(""));
    const made = await svgToTtf(encode(text), "icon.svg").catch((error) => error);
    if (made.code === "nothing_to_draw") continue;
    checked += 1;
    const glyph = opentype.parse(made.buffer).charToGlyph(String.fromCodePoint(0xe000));
    void glyph.path;
    const contours = glyphContours(glyph);
    for (const points of contours) {
      const segments = points.map((point, at) => [point, points[(at + 1) % points.length]]);
      assert.ok(!segments.some(([a, b]) => a[0] === b[0] && a[1] === b[1]), `a zero-length segment: ${text}`);
      for (let i = 0; i < segments.length; i += 1) {
        for (let j = i + 2; j < segments.length; j += 1) {
          if (i === 0 && j === segments.length - 1) continue;
          assert.ok(!crossInside(...segments[i], ...segments[j]), `a contour crosses itself: ${text}`);
        }
      }
      assert.ok(!crossesAtAPoint(points), `a contour crosses itself at a corner: ${text}`);
    }
    // One shape's contours don't cross one another either.
    if (shapes.length === 1) {
      for (let u = 0; u < contours.length; u += 1) {
        for (let v = u + 1; v < contours.length; v += 1) {
          const [first, second] = [contours[u], contours[v]];
          for (const [i, a] of first.entries()) {
            for (const [j, c] of second.entries()) {
              assert.ok(!crossInside(a, first[(i + 1) % first.length], c, second[(j + 1) % second.length]), `two contours cross: ${text}`);
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 200);
  // Curves: svg2ttf rounds them to TrueType's; a curve under a unit long
  // leaves no point twice.
  const tiny = await font(svg('<path d="M2 2H22V22H2Z"/><circle cx="12" cy="12" r="0.01"/><path d="M5 5c0.001 0.002 0.003 0.001 0.004 0L9 9L5 9Z"/>'));
  for (const points of glyphContours(tiny.glyph)) {
    assert.ok(points.every((point, at) => String(point) !== String(points[(at + 1) % points.length])));
  }
});

test("a root transform-origin and CSS transform place the icon as Chromium draws them", async () => {
  const half = '<rect width="12" height="6"/>';
  const box = 'viewBox="0 0 24 24"';
  // Ink within the artboard, measured in Chromium 143 (an <img> at the
  // SVG's own size): x1, y1, x2, y2 in user units, y down.
  const cases = [
    [`${box} transform="rotate(90)" transform-origin="12 6"`, half, [12, 0, 18, 6]],
    [`${box} transform="rotate(90)" style="transform-origin:12px 6px"`, half, [12, 0, 18, 6]],
    // A bare number isn't a CSS length: the origin stays the centre.
    [`${box} transform="rotate(90)" style="transform-origin:12 6"`, half, [18, 0, 24, 12]],
    [`${box} transform="rotate(90)" transform-origin="25% 0"`, half, [0, 0, 6, 6]],
    [`${box} transform="rotate(90)" transform-origin="0"`, half, [6, 12, 12, 24]],
    [`${box} transform="rotate(90)" style="transform-origin:0 left"`, half, [18, 0, 24, 12]],
    [`${box} transform="rotate(90)" style="transform-origin:2pt 0"`, half, [0, 0, 2.7, 9.3]],
    [`width="240" height="240" ${box} transform="rotate(90)" transform-origin="120 60"`, half, [12, 0, 18, 6]],
    [`${box} style="transform:rotate(90deg)"`, half, [18, 0, 24, 12]],
    // A CSS angle needs its unit; the attribute is used instead.
    [`${box} style="transform:rotate(90)"`, half, [0, 0, 12, 6]],
    [`${box} transform="translate(12 0)" style="transform:rotate(90)"`, half, [12, 0, 24, 6]],
    [`${box} transform="translate(12 0)" style="transform:rotate(90deg)"`, half, [18, 0, 24, 12]],
    [`${box} style="transform:none" transform="rotate(90)"`, half, [0, 0, 12, 6]],
    [`${box} style="transform:translate(50%, 0)"`, half, [12, 0, 24, 6]],
    [`${box} style="transform:ROTATE(90DEG) translate(6px, 0)"`, half, [18, 6, 24, 18]],
    [`${box} style="transform:scale(0.5, 1)"`, '<rect width="24" height="6"/>', [6, 0, 18, 6]],
    [`${box} style="transform:scale(0.5 1)"`, '<rect width="24" height="6"/>', [0, 0, 24, 6]],
    [`${box} style="transform:translate3d(12px, 0, 0)"`, half, [12, 0, 24, 6]],
    [`${box}`, `<style>svg{transform:translate(12px,0)}</style>${half}`, [12, 0, 24, 6]],
    [`${box}`, `<style>svg{transform:translate(12,0)}</style>${half}`, [0, 0, 12, 6]],
    [`${box} transform="rotate(90)" style="transform-origin:center center"`, half, [18, 0, 24, 12]],
  ];
  for (const [root, body, expected] of cases) {
    const seen = seenBounds((await font(svg(body, root))).glyph);
    assert.ok(seen.every((value, index) => Math.abs(value - expected[index]) <= 0.2), `${root}: ${seen} vs ${expected}`);
  }
  // Turned about the top left corner, the drawing leaves the artboard, and
  // a browser shows nothing: as the attribute, a style, a stylesheet, or
  // with keywords.
  for (const [root, body] of [
    [`${box} transform="rotate(90)" transform-origin="0 0"`, half],
    [`${box} transform="rotate(90)" style="transform-origin:left top"`, half],
    [`${box} transform="rotate(90)" transform-origin="0 0 5"`, half],
    [`${box} transform="rotate(90)"`, `<style>svg{transform-origin:0 0}</style>${half}`],
    [`${box} style="transform:rotate(90deg); transform-origin:0 0"`, half],
  ]) {
    const error = await refusal(svg(body, root));
    assert.equal(error.code, "nothing_to_draw", root);
    assert.equal(error.message, OUTSIDE_ARTBOARD_MESSAGE);
  }
});

test("a number too large to draw with is refused as damaged, with its own code", async () => {
  const huge = [
    '<polygon points="0,0 1e400,0 0,1"/>',
    '<rect x="1e308" width="1e308" height="1"/>',
    '<path d="M0 0L1e400 0L0 1Z"/>',
    '<path d="M0 0H1e308V1e308H0Z" transform="translate(1e308 0)"/>',
    '<path d="M0 0h9e8h9e8v1Z"/>',
    `${'<g transform="scale(1e5)">'.repeat(2)}<rect width="1" height="1"/>${"</g>".repeat(2)}`,
    '<svg viewBox="0 0 1e-300 1e-300" width="24" height="24"><rect width="1" height="1"/></svg>',
  ];
  for (const body of [...huge.map((shape) => svg(shape)), svg('<rect width="24" height="24"/>', 'viewBox="0 0 1e400 24"')]) {
    const error = await refusal(body);
    assert.equal(error.code, "number_out_of_range", body);
    assert.equal(error.message, UNREADABLE_SVG_MESSAGE);
  }
  await assert.rejects(
    convertWithWorker({ worker: undefined, from: "svg", to: "ttf", buf: encode(svg(huge[0])), fileName: "a.svg" }),
    (error) => error.telemetryCode === "number_out_of_range" && error.message === UNREADABLE_SVG_MESSAGE,
  );
  // A shape partly on the artboard that reaches farther than a glyph can.
  const far = await refusal(svg('<rect width="24000" height="24"/>'));
  assert.equal(far.code, "too_complex");
  assert.equal(far.message, FAR_OUTSIDE_MESSAGE);
});

test("a font holds no strokes: a stroke-only icon is refused with a way out, and a filled shape's stroke is left out", async () => {
  const outline = svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/>', 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"');
  const error = await refusal(outline);
  assert.equal(error.code, "nothing_to_draw");
  assert.match(error.message, /only with strokes.*Outline Stroke/);
  const { result } = await font(svg('<rect x="2" y="2" width="20" height="20" stroke="#000" stroke-width="2"/><line x1="0" y1="0" x2="24" y2="24" stroke="#000"/>'));
  assert.match(result.notice, /Left out, as a font holds filled shapes only: strokes\./);
});

test("text, a picture, or nothing at all gets a plain message", async () => {
  assert.match((await refusal(svg('<text x="2" y="12">Hi</text>'))).message, /only text/);
  assert.match((await refusal(svg('<image href="data:image/png;base64,iVBORw0KGgo=" width="24" height="24"/>'))).message, /only a picture/);
  for (const empty of [svg(""), svg('<rect width="0" height="10"/><path d=""/><polygon points="1 1"/>'), svg('<path d="M2 2L20 2"/>')]) {
    const error = await refusal(empty);
    assert.equal(error.code, "nothing_to_draw");
    assert.equal(error.message, "This SVG has no filled shapes to make a font from.");
  }
  const outside = await refusal(svg('<rect x="40" y="40" width="8" height="8"/>'));
  assert.equal(outside.code, "nothing_to_draw");
  assert.match(outside.message, /all outside its artboard/);
  const { result } = await font(svg('<rect width="24" height="24"/><text>Hi</text><image href="x.png" width="4" height="4"/>'));
  assert.match(result.notice, /filled shapes only: text and embedded pictures\./);
});

test("a hostile SVG runs nothing, fetches nothing, and takes bounded time", async () => {
  const originalFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    throw new Error("no network");
  };
  try {
    const { glyph } = await font(
      svg(
        '<script>globalThis.svgFontRan = true</script><rect width="24" height="24"/>' +
          '<image href="https://example.com/x.png" width="4" height="4"/><use href="https://example.com/x.svg#a"/>' +
          '<use href="other.svg#a"/><foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://example.com"/></foreignObject>',
      ),
    );
    assert.ok(inkAt(glyph, 12, 12));
    assert.equal(globalThis.svgFontRan, undefined);
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const started = Date.now();
  // Billion laughs: entities of entities aren't expanded, so its use fails.
  const laughs =
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY lol "lol">' +
    Array.from({ length: 9 }, (_, index) => `<!ENTITY lol${index + 1} "${`&lol${index || ""};`.repeat(10)}">`).join("") +
    `]>${svg('<rect width="24" height="24"/><text>&lol9;</text>')}`;
  assert.equal((await refusal(laughs)).code, "unreadable_image");
  // An entity from another file is never read.
  const outside = `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg('<rect width="24" height="24" id="&x;"/>')}`;
  assert.equal((await refusal(outside)).code, "unreadable_image");
  // Many uses of a literal entity are bounded too.
  const wide = `<!DOCTYPE svg [<!ENTITY a "${"a".repeat(1000)}">]>${svg(`<rect width="24" height="24" class="${"&a;".repeat(1100)}"/>`)}`;
  assert.equal((await refusal(wide)).code, "too_complex");
  // Path data past what a glyph can hold.
  const huge = `M0 0${"L1 1L2 0".repeat(LIMITS.commands / 2)}Z`;
  assert.equal((await refusal(svg(`<path d="${huge}"/>`))).code, "too_complex");
  // Groups nested past the limit, and a <use> chain past its depth.
  assert.equal((await refusal(svg(`${"<g>".repeat(200)}<rect width="2" height="2"/>${"</g>".repeat(200)}`))).code, "too_complex");
  const chain = Array.from({ length: 40 }, (_, index) => `<g id="u${index}"><use href="#u${index + 1}"/><use href="#u${index + 1}"/></g>`).join("");
  const chained = await refusal(svg(`<defs>${chain}<rect id="u40" width="1" height="1"/></defs><use href="#u0"/>`));
  assert.equal(chained.code, "too_complex");
  // Fan-out through <use>, and text built to make a parser backtrack.
  const fan = Array.from({ length: 12 }, (_, index) => `<g id="f${index}">${`<use href="#f${index + 1}"/>`.repeat(20)}</g>`).join("");
  assert.equal((await refusal(svg(`<defs>${fan}<g id="f12"/></defs><use href="#f0"/>`))).code, "too_complex");
  // Stylesheet matching: 5,000 rules for every element, on nearly 100,000
  // elements, is refused as soon as it passes LIMITS.ruleChecks.
  const sheet = `<style>${"*{fill:#000}".repeat(LIMITS.rules)}</style>`;
  const before = Date.now();
  assert.equal((await refusal(svg(`${sheet}${'<rect width="1" height="1"/>'.repeat(LIMITS.elements - 10)}`))).code, "too_complex");
  assert.ok(Date.now() - before < 2_000, `stylesheet matching took ${Date.now() - before} ms`);
  const slow = [
    svg(`<style>${"/*".repeat(200_000)}</style><rect width="24" height="24"/>`),
    svg(`<style>${"@import x;".repeat(100_000)}</style><rect width="24" height="24"/>`),
    svg(`<rect width="24" height="24" fill="rgba(,${"0".repeat(200_000)}x)"/>`),
    svg(`<rect width="${"1".repeat(200_000)}x" height="24"/><rect width="24" height="24"/>`),
    `${"<!DOCTYPE svg [".repeat(50_000)}${svg('<rect width="24" height="24"/>')}`,
  ];
  for (const text of slow) {
    const before = Date.now();
    await svgToTtf(encode(text), "slow.svg").catch(() => null);
    assert.ok(Date.now() - before < 1_000, `${text.slice(0, 60)}… took ${Date.now() - before} ms`);
  }
  // Over 10 MB is refused unread.
  assert.equal((await refusal(new Uint8Array(10 * 1024 * 1024 + 1).buffer)).code, "too_complex");
  assert.ok(Date.now() - started < 5_000, `refusals took ${Date.now() - started} ms`);
  // Damaged XML, or another kind of file.
  for (const damaged of [svg("<rect>"), "<html><body/></html>", "\x89PNG\r\n\x1a\n", ""]) {
    const error = await refusal(damaged);
    assert.equal(error.code, "unreadable_image", damaged);
    assert.equal(error.message, "This SVG couldn't be read: it may be damaged, or not an SVG file.");
  }
});

test("a 2 MB SVG converts, or is refused as too detailed for a glyph, in seconds", async () => {
  // An icon beside a 2 MB embedded picture.
  const picture = `<image width="24" height="24" href="data:image/png;base64,${"A".repeat(2_000_000)}"/>`;
  let started = Date.now();
  const { glyph, result } = await font(svg(`${picture}<rect x="2" y="2" width="20" height="20"/>`));
  assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started} ms`);
  assert.ok(inkAt(glyph, 12, 12));
  assert.match(result.notice, /filled shapes only: embedded pictures\./);
  // An illustration of 2 MB of curves: more points than one TrueType glyph
  // holds (65,535), so too detailed to become one character.
  const paths = [];
  for (let index = 0; paths.join("").length < 2_000_000; index += 1) {
    const x = (index % 40) * 25;
    const y = Math.floor(index / 40) * 25;
    let d = `M${x + 12.5} ${y + 1.5}`;
    for (let step = 1; step <= 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      const r = step % 2 ? 11 : 7.25;
      const point = (offset) =>
        `${(x + 12.5 + r * Math.sin(angle - offset)).toFixed(3)} ${(y + 12.5 - r * Math.cos(angle - offset)).toFixed(3)}`;
      d += `C${point(0.1)} ${point(0.05)} ${point(0)}`;
    }
    paths.push(`<path fill="#${((index * 2654435761) % 0xffffff).toString(16).padStart(6, "0")}" d="${d}Z"/>`);
  }
  started = Date.now();
  const error = await refusal(svg(paths.join("\n"), 'viewBox="0 0 1000 1000"'));
  assert.ok(Date.now() - started < 10_000, `took ${Date.now() - started} ms`);
  assert.equal(error.code, "too_complex");
  assert.equal(error.message, TOO_DETAILED_MESSAGE);
});

test("Illustrator's entity namespaces, a UTF-16 file and a stylesheet with at-rules are read", async () => {
  const illustrator =
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
    '\t<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">\n\t<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">\n]>\n' +
    '<svg version="1.1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<switch><foreignObject requiredExtensions="&ns_ai;" x="0" y="0" width="1" height="1"><i:pgfRef xlink:href="#a"/></foreignObject>' +
    '<g i:extraneous="self"><style>@media print{.st0{fill:none}} @import url(x.css); .st0{fill:#231F20;}</style><rect class="st0" width="24" height="24"/></g></switch></svg>';
  const { glyph, result } = await font(illustrator);
  assert.ok(inkAt(glyph, 12, 12));
  assert.doesNotMatch(result.notice, /left out/);
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...svg('<rect width="24" height="24"/>')].flatMap((c) => [c.charCodeAt(0), 0])]);
  assert.ok(inkAt((await font(utf16.buffer)).glyph, 12, 12));
});

test("the family is the file's name in plain ASCII, or Icon", () => {
  assert.equal(fontFamilyName("sample-icon.svg"), "sample-icon");
  assert.equal(fontFamilyName("Café Logo (final).svg"), "Cafe Logo final");
  assert.equal(fontFamilyName("アイコン.svg"), "Icon");
  assert.equal(fontFamilyName("🙂 smile.svg"), "smile");
  assert.equal(fontFamilyName("a".repeat(40) + ".svg"), "a".repeat(31));
  assert.equal(fontFamilyName("C:\\icons\\home.SVG"), "home");
});

test("a glyph whose flags don't match its points is caught before it is saved", async () => {
  const { result } = await font(svg('<rect x="2" y="2" width="20" height="20"/>'));
  const bytes = new Uint8Array(result.buffer);
  const glyph = readGlyph(bytes);
  assert.deepEqual(glyph, { contours: 1, points: 4 });
  // Set the repeat bit on the first flag, as svg2ttf's overflowing repeat
  // count leaves a run of more than 255 points.
  const view = new DataView(bytes.buffer);
  const tables = new Map();
  for (let index = 0; index < view.getUint16(4); index += 1) {
    tables.set(String.fromCharCode(...bytes.subarray(12 + index * 16, 16 + index * 16)), view.getUint32(20 + index * 16));
  }
  const long = view.getInt16(tables.get("head") + 50) === 1;
  const start = tables.get("glyf") + (long ? view.getUint32(tables.get("loca") + 4) : view.getUint16(tables.get("loca") + 2) * 2);
  const flags = start + 10 + 2 + 2;
  bytes[flags] |= 8;
  assert.throws(() => readGlyph(bytes), /flags/);
});

test("convertWithWorker makes the font and names it after the upload; a refusal keeps its code", async () => {
  const result = await convertWithWorker({
    worker: undefined,
    from: "svg",
    to: "ttf",
    buf: encode(svg('<rect width="24" height="24"/>')),
    fileName: "my icon.svg",
  });
  assert.equal(result.kind, "single");
  assert.deepEqual([...new Uint8Array(result.buffer, 0, 4)], [0, 1, 0, 0]);
  assert.equal(opentype.parse(result.buffer).names.fontFamily.en, "my icon");
  assert.match(result.notice, /U\+E000/);
  await assert.rejects(
    convertWithWorker({ worker: undefined, from: "svg", to: "ttf", buf: encode(svg('<line x2="9" stroke="red"/>')), fileName: "a.svg" }),
    (error) => error.telemetryCode === "nothing_to_draw" && error.telemetryMetadata.engine === "svg-font" && /strokes/.test(error.message),
  );
});

test("an SVG over 10 MB is refused before the page reads it, and the font is saved as font/ttf", async () => {
  const large = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)]);
  await assert.rejects(checkInputFile(large, "svg", "ttf"), (error) => error.telemetryCode === "too_complex" && /over 10 MB/.test(error.message));
  await checkInputFile(large, "svg", "png");
  await checkInputFile(new Blob([svg('<rect width="24" height="24"/>')]), "svg", "ttf");
  assert.equal(getOutputMimeType("ttf"), "font/ttf");
});
