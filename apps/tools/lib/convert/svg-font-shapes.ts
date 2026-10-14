// Reads a visitor's SVG for SVG to TTF (svg-font.ts, issue #251): the filled
// shapes it draws, each as a small SVG of its own for svgicons2svgfont, with
// the transforms that place it and the fill rule it is filled by.
//
// The file is input to a parser, not a page: it is read with sax, nothing in
// it runs or is fetched, and only geometry leaves this module. Each shape's
// SVG is written here from numbers and path data this module has read, so
// svgicons2svgfont never sees the visitor's markup. That also avoids what
// svgicons2svgfont gets wrong on its own: it reads `fill="none"` only from
// the shape's own attribute (not from a group, a style attribute or a
// stylesheet), draws the shapes inside <defs>, <clipPath> and <mask>, and
// stretches the drawing when the root's width and height don't match its
// viewBox.
//
// A font holds filled outlines only. A stroke isn't one, so a shape drawn
// only with a stroke (an outline icon, a <line>) has nothing to give, and
// a filled shape's stroke is left out. Text, embedded pictures, clipping,
// masks, colours and opacity are left out too.

import sax from "sax";
import { SVGPathData } from "svg-pathdata";

// The error codes svg-font.ts throws with: the file is damaged or isn't an
// SVG; it holds a number too large to draw with (damaged, as far as a
// visitor can tell: it gets the same message); it has nothing a font can
// hold; or it is larger or more detailed than this page converts.
export type SvgFontErrorCode = "unreadable_image" | "number_out_of_range" | "nothing_to_draw" | "too_complex";

export function svgFontError(code: SvgFontErrorCode, message: string, cause?: unknown): Error & { code: SvgFontErrorCode } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

export const UNREADABLE_SVG_MESSAGE = "This SVG couldn't be read: it may be damaged, or not an SVG file.";

// `value`, when it is a number no larger than LIMITS.largestNumber either
// way; otherwise (1e400 reads as Infinity) the file is refused as damaged.
function checkNumber(value: number): number {
  if (!(Math.abs(value) <= LIMITS.largestNumber)) throw svgFontError("number_out_of_range", UNREADABLE_SVG_MESSAGE);
  return value;
}
export const TOO_COMPLEX_MESSAGE =
  "This SVG has more detail than a font can hold here. Simplify its paths, or remove shapes, and try again.";

// Bounds on the work one file can cause. A drawing over these is refused
// with TOO_COMPLEX_MESSAGE rather than slowing the page down.
export const LIMITS = {
  // Elements in the file, and how deeply they nest.
  elements: 100_000,
  depth: 128,
  // Shapes drawn, counting each <use> of one, and elements visited.
  shapes: 5_000,
  visits: 200_000,
  // Rules in the file's stylesheets, and rules looked at while matching
  // them to elements (5,000 rules for every element would be 500 million).
  rules: 5_000,
  ruleChecks: 2_000_000,
  // Path commands across all shapes (a TrueType glyph holds at most 65,535
  // points; a curve needs at least two).
  commands: 60_000,
  // <use> inside <use>, as deep as a browser would follow it here.
  useDepth: 16,
  // Characters a file's own entities (<!ENTITY>) may add when expanded.
  entityExpansion: 1_000_000,
  // The largest number, in the file or worked out from it (a coordinate, a
  // length, a transform's scale or offset), that is drawn. No icon needs
  // one past a billion, and with every number under it, sums and products
  // of them can't overflow to Infinity.
  largestNumber: 1e9,
};

export type Artboard = { x: number; y: number; width: number; height: number };

export type SvgShape = {
  // A standalone SVG of the one shape, in the root's user units: its root is
  // 1x1 so svgicons2svgfont neither scales nor offsets it (it only flips y).
  svg: string;
  fillRule: "nonzero" | "evenodd";
  // Path commands, for LIMITS.commands.
  commands: number;
};

// What the file draws that a font can't hold.
export type LeftOut = { strokes: boolean; text: boolean; pictures: boolean };

export type SvgShapes = {
  // The root's viewBox, else its width and height; null when it has neither,
  // and the shapes' own bounds are the drawing's.
  artboard: Artboard | null;
  // The root's own transform, in its user units (rootTransform): it moves
  // the drawing and its artboard together, so it is applied after shapes
  // off the artboard are left out.
  transform: Matrix;
  shapes: SvgShape[];
  leftOut: LeftOut;
  // Visible shapes drawn only with a stroke.
  strokeOnly: number;
};

type Element = {
  name: string;
  attrs: Record<string, string>;
  children: Element[];
  // The text of a <style> element.
  text: string;
};

const SVG_NS = "http://www.w3.org/2000/svg";

// ---- Parsing ----

// A file's internal DTD subset may declare entities, as Illustrator's SVG
// exports do (`<!ENTITY ns_ai "http://...">`). Only a literal value is
// expanded: one that refers to another entity (the "billion laughs" file)
// or to an outside file (SYSTEM, PUBLIC) is not, and its use fails the
// parse. Expanded text is bounded by LIMITS.entityExpansion.
function declaredEntities(text: string): Map<string, string> {
  const entities = new Map<string, string>();
  // The DOCTYPE comes before the root element, or not at all.
  const start = text.search(/<!DOCTYPE\b/i);
  const root = text.search(/<svg\b/i);
  if (start === -1 || (root !== -1 && root < start)) return entities;
  const doctype = /<!DOCTYPE\b[^[>]*\[([\s\S]*?)\]\s*>/iy;
  doctype.lastIndex = start;
  const subset = doctype.exec(text)?.[1];
  if (!subset) return entities;
  for (const match of subset.matchAll(/<!ENTITY\s+([A-Za-z_][\w.-]*)\s+(["'])([^"'&%<]*)\2\s*>/g)) {
    const [, name, , value] = match;
    if (Object.hasOwn(Object.prototype, name!) || entities.has(name!)) continue;
    entities.set(name!, value!);
  }
  // sax also finds an entity by its name in lower case, so uses are
  // counted regardless of case.
  const lower = entities.size ? text.toLowerCase() : "";
  let added = 0;
  for (const [name, value] of entities) {
    const use = `&${name.toLowerCase()};`;
    for (let at = lower.indexOf(use); at !== -1; at = lower.indexOf(use, at + use.length)) {
      added += value.length;
      if (added > LIMITS.entityExpansion) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
    }
  }
  return entities;
}

// Elements whose content is never drawn, and isn't kept: what they hold
// can't be a shape the file draws.
const SKIPPED = new Set([
  "script", "foreignObject", "metadata", "title", "desc", "image", "text",
  "linearGradient", "radialGradient", "pattern", "filter", "clipPath", "mask", "marker",
]);

function parseSvg(text: string): Element {
  const entities = declaredEntities(text);
  const parser = sax.parser(true, { trim: false, normalize: false });
  for (const [name, value] of entities) parser.ENTITIES[name] = value;
  const stack: Element[] = [];
  let root: Element | null = null;
  let count = 0;
  // Depth inside an element whose content isn't kept, if any.
  let skipping = 0;
  parser.onerror = (error) => {
    throw svgFontError("unreadable_image", UNREADABLE_SVG_MESSAGE, error);
  };
  parser.onopentag = (tag) => {
    count += 1;
    if (count > LIMITS.elements || stack.length >= LIMITS.depth) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
    const attrs: Record<string, string> = Object.create(null);
    for (const [name, value] of Object.entries(tag.attributes)) attrs[name] = String(value);
    const element: Element = { name: tag.name, attrs, children: [], text: "" };
    if (!root) {
      if (tag.name !== "svg" || (attrs.xmlns !== undefined && attrs.xmlns !== SVG_NS)) {
        throw svgFontError("unreadable_image", UNREADABLE_SVG_MESSAGE);
      }
      root = element;
    } else if (!skipping) {
      stack.at(-1)?.children.push(element);
    }
    // A skipped element is still noted, so a page can say text or a picture
    // was left out; its children aren't.
    if (skipping) skipping += 1;
    else if (SKIPPED.has(tag.name)) skipping = 1;
    stack.push(element);
  };
  parser.onclosetag = () => {
    stack.pop();
    if (skipping) skipping -= 1;
  };
  const addText = (value: string) => {
    const element = stack.at(-1);
    if (element?.name === "style" && !skipping) element.text += value;
  };
  parser.ontext = addText;
  parser.oncdata = addText;
  parser.write(text).close();
  if (!root) throw svgFontError("unreadable_image", UNREADABLE_SVG_MESSAGE);
  return root;
}

// ---- Styles ----

// The properties that decide whether, and how, a shape is filled.
const PROPERTIES = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "opacity", "display", "visibility",
] as const;
type Property = (typeof PROPERTIES)[number];
type Declarations = Partial<Record<Property, string>>;
const INHERITED = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "visibility"] as const;

type Style = {
  fill: string;
  fillOpacity: string;
  fillRule: string;
  stroke: string;
  strokeWidth: string;
  strokeOpacity: string;
  visibility: string;
};
const INITIAL_STYLE: Style = {
  fill: "black",
  fillOpacity: "1",
  fillRule: "nonzero",
  stroke: "none",
  strokeWidth: "1",
  strokeOpacity: "1",
  visibility: "visible",
};
const STYLE_KEYS: Record<(typeof INHERITED)[number], keyof Style> = {
  fill: "fill",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  stroke: "stroke",
  "stroke-width": "strokeWidth",
  "stroke-opacity": "strokeOpacity",
  visibility: "visibility",
};

function declarations(text: string): Declarations {
  const result: Declarations = {};
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const name = part.slice(0, colon).trim().toLowerCase() as Property;
    if (!(PROPERTIES as readonly string[]).includes(name)) continue;
    result[name] = part.slice(colon + 1).replace(/!\s*important\s*$/i, "").trim();
  }
  return result;
}

// A rule of a <style> sheet with a simple selector: a tag, classes and an
// id (`path`, `.cls-1`, `#a`, `g.b`), as Illustrator and other editors
// write them. A selector with a combinator, an attribute or a pseudo-class
// isn't matched.
type Rule = { tag: string | null; id: string | null; classes: string[]; specificity: number; order: number; decls: Declarations };

function withoutComments(css: string): string {
  let text = "";
  let at = 0;
  for (let open = css.indexOf("/*"); open !== -1; open = css.indexOf("/*", at)) {
    text += css.slice(at, open);
    const close = css.indexOf("*/", open + 2);
    if (close === -1) return text;
    at = close + 2;
  }
  return text + css.slice(at);
}

function parseStyleSheet(css: string, rules: Rule[]): void {
  const text = withoutComments(css);
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("{", at);
    if (open === -1) return;
    let prelude = text.slice(at, open);
    // A statement such as @import ends at its semicolon, and so does any
    // stray text before a rule.
    const semicolon = prelude.lastIndexOf(";");
    if (semicolon !== -1) {
      at += semicolon + 1;
      prelude = prelude.slice(semicolon + 1);
    }
    prelude = prelude.trim();
    // An at-rule's block (@media, @font-face...) is skipped whole.
    if (prelude.startsWith("@")) {
      let depth = 0;
      let index = open;
      for (; index < text.length; index += 1) {
        if (text[index] === "{") depth += 1;
        else if (text[index] === "}" && --depth === 0) break;
      }
      at = index + 1;
      continue;
    }
    const close = text.indexOf("}", open);
    if (close === -1) return;
    const decls = declarations(text.slice(open + 1, close));
    for (const selector of prelude.split(",")) {
      const match = /^(\*|[A-Za-z][\w-]*)?((?:[.#][\w-]+)*)$/.exec(selector.trim());
      if (!match || (!match[1] && !match[2])) continue;
      const parts = match[2]!.match(/[.#][\w-]+/g) ?? [];
      const ids = parts.filter((part) => part.startsWith("#")).map((part) => part.slice(1));
      if (ids.length > 1) continue;
      const classes = parts.filter((part) => part.startsWith(".")).map((part) => part.slice(1));
      const tag = match[1] && match[1] !== "*" ? match[1] : null;
      if (rules.length >= LIMITS.rules) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
      rules.push({
        tag,
        id: ids[0] ?? null,
        classes,
        specificity: ids.length * 10_000 + classes.length * 100 + (tag ? 1 : 0),
        order: rules.length,
        decls,
      });
    }
    at = close + 1;
  }
}

function collectStyleSheets(element: Element, rules: Rule[]): void {
  if (element.name === "style") parseStyleSheet(element.text, rules);
  for (const child of element.children) collectStyleSheets(child, rules);
}

// The file's rules by the one part of their selector an element must have:
// its id, else its first class, else its tag, else "*". `checks` counts the
// rules looked at while matching, against LIMITS.ruleChecks.
type StyleSheets = { index: Map<string, Rule[]>; checks: number };

function indexRules(rules: Rule[]): StyleSheets {
  const index = new Map<string, Rule[]>();
  for (const rule of rules) {
    const key = rule.id !== null ? `#${rule.id}` : rule.classes.length ? `.${rule.classes[0]}` : (rule.tag ?? "*");
    const list = index.get(key);
    if (list) list.push(rule);
    else index.set(key, [rule]);
  }
  return { index, checks: 0 };
}

// The element's own declarations: presentation attributes, then matching
// rules by specificity and order, then its style attribute.
function specified(element: Element, sheets: StyleSheets): Declarations {
  const result: Declarations = {};
  for (const name of PROPERTIES) {
    const value = element.attrs[name];
    if (value !== undefined) result[name] = value.trim();
  }
  if (sheets.index.size) {
    const classes = new Set((element.attrs.class ?? "").split(/\s+/).filter(Boolean));
    const keys = ["*", element.name, ...[...classes].map((name) => `.${name}`)];
    if (element.attrs.id) keys.push(`#${element.attrs.id}`);
    const matching: Rule[] = [];
    const charge = (checks: number) => {
      sheets.checks += checks;
      if (sheets.checks > LIMITS.ruleChecks) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
    };
    for (const key of keys) {
      charge(1);
      for (const rule of sheets.index.get(key) ?? []) {
        // A rule costs a look at each class its selector names.
        charge(1 + rule.classes.length);
        if (
          (!rule.tag || rule.tag === element.name) &&
          (!rule.id || rule.id === element.attrs.id) &&
          rule.classes.every((name) => classes.has(name))
        ) {
          matching.push(rule);
        }
      }
    }
    matching.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
    for (const rule of matching) Object.assign(result, rule.decls);
  }
  if (element.attrs.style) Object.assign(result, declarations(element.attrs.style));
  return result;
}

function inherit(parent: Style, own: Declarations): Style {
  const style = { ...parent };
  for (const name of INHERITED) {
    const value = own[name];
    if (value === undefined || value === "inherit" || value === "") continue;
    style[STYLE_KEYS[name]] = value;
  }
  return style;
}

// Whether a paint (fill or stroke) puts nothing on the page: none, or a
// transparent colour.
function paintsNothing(paint: string): boolean {
  const value = paint.trim().toLowerCase();
  if (value === "none" || value === "transparent") return true;
  if (/^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/.test(value)) return true;
  // rgba(0, 0, 0, 0), rgb(0 0 0 / 0%), hsla(...): a fourth value of zero.
  const open = value.indexOf("(");
  if (open === -1 || !value.endsWith(")") || !/^(?:rgba?|hsla?)$/.test(value.slice(0, open).trim())) return false;
  const values = value.slice(open + 1, -1).split(/[\s,/]+/).filter(Boolean);
  return values.length === 4 && Number.parseFloat(values[3]!) === 0;
}

function zero(value: string): boolean {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number <= 0;
}

function fills(style: Style): boolean {
  return !paintsNothing(style.fill) && !zero(style.fillOpacity);
}

function strokes(style: Style): boolean {
  return !paintsNothing(style.stroke) && !zero(style.strokeWidth) && !zero(style.strokeOpacity);
}

// ---- Geometry ----

const NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/gi;
const UNITS: Record<string, number> = { "": 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };

// A length in user units; a percentage of `reference`, the viewport's width,
// height or diagonal. Null when it isn't one; refused (checkNumber) when it
// is too large.
function length(value: string | undefined, reference: number): number | null {
  if (value === undefined) return null;
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|ex|%)?\s*$/i.exec(value);
  if (!match) return null;
  const number = checkNumber(Number(match[1]));
  const unit = (match[2] ?? "").toLowerCase();
  return checkNumber(unit === "%" ? (number / 100) * reference : number * UNITS[unit]!);
}

function numbers(value: string | undefined): number[] {
  return (value?.match(NUMBER) ?? []).map((token) => checkNumber(Number(token)));
}

function viewBox(value: string | undefined): Artboard | null {
  const box = numbers(value);
  if (box.length !== 4 || !box.every(Number.isFinite) || !(box[2]! > 0 && box[3]! > 0)) return null;
  return { x: box[0]!, y: box[1]!, width: box[2]!, height: box[3]! };
}

// A number as svgicons2svgfont reads it, to 12 significant digits.
function num(value: number): string {
  return String(Number(value.toPrecision(12)));
}

// An affine transform, as SVG's matrix(a b c d e f).
export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const ANGLE_UNITS: Record<string, number> = { "": 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360, px: 1 };

// A transform attribute as one matrix. One a browser can't read is ignored,
// as browsers ignore it: the identity. (svgicons2svgfont is given only the
// matrix: its parser refuses some that browsers read, such as
// "translate(1 2)scale(2)".)
export function parseTransform(value: string | undefined): Matrix {
  const list = value?.trim() ?? "";
  if (!list || list === "none") return IDENTITY;
  const item = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*,?/y;
  let matrix = IDENTITY;
  for (let at = 0; at < list.length; ) {
    item.lastIndex = at;
    const match = item.exec(list);
    if (!match) return IDENTITY;
    at = item.lastIndex;
    const args: number[] = [];
    for (const token of match[2]!.trim().split(/[\s,]+/).filter(Boolean)) {
      const number = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn|px)?$/i.exec(token);
      if (!number) return IDENTITY;
      args.push(checkNumber(Number(number[1]) * ANGLE_UNITS[(number[2] ?? "").toLowerCase()]!));
    }
    const [a = 0, b, c, d, e, f] = args;
    const radians = (a * Math.PI) / 180;
    let step: Matrix | null = null;
    switch (match[1]) {
      case "matrix":
        if (args.length === 6) step = [a, b!, c!, d!, e!, f!];
        break;
      case "translate":
        if (args.length === 1 || args.length === 2) step = translation(a, b ?? 0);
        break;
      case "scale":
        if (args.length === 1 || args.length === 2) step = [a, 0, 0, b ?? a, 0, 0];
        break;
      case "rotate":
        if (args.length === 1 || args.length === 3) {
          const turn: Matrix = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
          step = multiply(multiply(translation(b ?? 0, c ?? 0), turn), translation(-(b ?? 0), -(c ?? 0)));
        }
        break;
      case "skewX":
        if (args.length === 1) step = [1, 0, Math.tan(radians), 1, 0, 0];
        break;
      case "skewY":
        if (args.length === 1) step = [1, Math.tan(radians), 0, 1, 0, 0];
        break;
    }
    if (!step || !step.every(Number.isFinite)) return IDENTITY;
    matrix = checkMatrix(multiply(matrix, step));
  }
  return matrix;
}

// `matrix`, when its scales and offsets are all within LIMITS.largestNumber,
// as a drawing placed by it is; otherwise the file is refused (a transform
// that overflows, or a viewBox scaled past any screen).
function checkMatrix(matrix: Matrix): Matrix {
  for (const value of matrix) checkNumber(value);
  return matrix;
}

function invert([a, b, c, d, e, f]: Matrix): Matrix {
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

// The transform that fits a viewBox into a viewport of `width` x `height` at
// (x, y), by preserveAspectRatio (xMidYMid meet unless it says otherwise).
function viewportTransform(box: Artboard, x: number, y: number, width: number, height: number, align = ""): Matrix {
  const words = align.trim().split(/\s+/);
  const mode = words[0] === "defer" ? words[1] : words[0];
  let sx = width / box.width;
  let sy = height / box.height;
  if (mode !== "none") {
    const scale = words.includes("slice") ? Math.max(sx, sy) : Math.min(sx, sy);
    sx = scale;
    sy = scale;
  }
  const fraction = (axis: "x" | "y") => {
    const found = /x(Min|Mid|Max)Y(Min|Mid|Max)/.exec(mode ?? "");
    const part = found ? found[axis === "x" ? 1 : 2] : "Mid";
    return part === "Min" ? 0 : part === "Max" ? 1 : 0.5;
  };
  const tx = x + (width - box.width * sx) * fraction("x") - box.x * sx;
  const ty = y + (height - box.height * sy) * fraction("y") - box.y * sy;
  return [sx, 0, 0, sy, tx, ty];
}

type Viewport = { width: number; height: number };

// `path`, when every number in it is within LIMITS.largestNumber (checkNumber).
function checkPath(path: SVGPathData): SVGPathData {
  for (const command of path.commands) {
    for (const [name, value] of Object.entries(command)) {
      if (name !== "type" && typeof value === "number") checkNumber(value);
    }
  }
  return path;
}

// The shape as path data in its own user units, or null when it draws
// nothing (a zero size, no points). Throws on path data that can't be read.
function shapePath(element: Element, viewport: Viewport): SVGPathData | null {
  const { attrs } = element;
  const diagonal = Math.hypot(viewport.width, viewport.height) / Math.SQRT2;
  const x = (name: string) => length(attrs[name], viewport.width);
  const y = (name: string) => length(attrs[name], viewport.height);
  switch (element.name) {
    case "path": {
      const d = attrs.d?.trim();
      if (!d) return null;
      let path: SVGPathData;
      try {
        path = new SVGPathData(d);
      } catch (error) {
        throw svgFontError("unreadable_image", UNREADABLE_SVG_MESSAGE, error);
      }
      checkPath(path);
      // Path data must start with a move; a browser draws nothing otherwise.
      return path.commands[0]?.type === SVGPathData.MOVE_TO ? path : null;
    }
    case "rect": {
      const width = x("width") ?? 0;
      const height = y("height") ?? 0;
      if (!(width > 0 && height > 0)) return null;
      let rx = attrs.rx === "auto" ? null : x("rx");
      let ry = attrs.ry === "auto" ? null : y("ry");
      rx ??= ry ?? 0;
      ry ??= rx;
      rx = Math.min(Math.max(rx, 0), width / 2);
      ry = Math.min(Math.max(ry, 0), height / 2);
      // A corner is rounded only when both radii are.
      if (!(rx > 0 && ry > 0)) rx = ry = 0;
      const left = x("x") ?? 0;
      const top = y("y") ?? 0;
      const corner = (toX: number, toY: number) => (rx ? `A${num(rx)} ${num(ry)} 0 0 1 ${num(toX)} ${num(toY)}` : "");
      return new SVGPathData(
        `M${num(left + rx)} ${num(top)}H${num(left + width - rx)}${corner(left + width, top + ry)}` +
          `V${num(top + height - ry)}${corner(left + width - rx, top + height)}` +
          `H${num(left + rx)}${corner(left, top + height - ry)}V${num(top + ry)}${corner(left + rx, top)}Z`,
      );
    }
    case "circle":
    case "ellipse": {
      const r = element.name === "circle" ? length(attrs.r, diagonal) : null;
      let rx = element.name === "circle" ? r : attrs.rx === "auto" ? null : x("rx");
      let ry = element.name === "circle" ? r : attrs.ry === "auto" ? null : y("ry");
      rx ??= ry;
      ry ??= rx;
      if (!(rx && ry && rx > 0 && ry > 0)) return null;
      const cx = x("cx") ?? 0;
      const cy = y("cy") ?? 0;
      return new SVGPathData(
        `M${num(cx + rx)} ${num(cy)}A${num(rx)} ${num(ry)} 0 0 1 ${num(cx - rx)} ${num(cy)}` +
          `A${num(rx)} ${num(ry)} 0 0 1 ${num(cx + rx)} ${num(cy)}Z`,
      );
    }
    case "polygon":
    case "polyline": {
      const points = numbers(attrs.points);
      // An odd number drops the last, as browsers do.
      if (points.length < 6) return null;
      const pairs = [];
      for (let index = 0; index + 1 < points.length; index += 2) pairs.push(`${num(points[index]!)} ${num(points[index + 1]!)}`);
      return new SVGPathData(`M${pairs.join("L")}Z`);
    }
    default:
      return null;
  }
}

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line"]);

// ---- Walking the drawing ----

type Context = {
  sheets: StyleSheets;
  visits: number;
  ids: Map<string, Element>;
  result: SvgShapes;
  commands: number;
};

function indexIds(element: Element, ids: Map<string, Element>): void {
  const id = element.attrs.id;
  if (id && !ids.has(id)) ids.set(id, element);
  for (const child of element.children) indexIds(child, ids);
}

function hrefOf(element: Element): string | undefined {
  return element.attrs.href ?? element.attrs["xlink:href"];
}

// Draws `element` (and what it holds) with the style it inherits, placed
// by `transform`. `uses`: the ids of the <use> references being followed,
// against a reference to itself.
function walk(element: Element, parent: Style, transform: Matrix, viewport: Viewport, context: Context, uses: string[]): void {
  if ((context.visits += 1) > LIMITS.visits) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
  const own = specified(element, context.sheets);
  if (own.display?.trim().toLowerCase() === "none") return;
  if (own.opacity !== undefined && zero(own.opacity)) return;
  const style = inherit(parent, own);
  const visible = !["hidden", "collapse"].includes(style.visibility.trim().toLowerCase());
  const placed =
    element.attrs.transform === undefined ? transform : checkMatrix(multiply(transform, parseTransform(element.attrs.transform)));

  switch (element.name) {
    case "g":
    case "a":
      for (const child of element.children) walk(child, style, placed, viewport, context, uses);
      return;
    case "switch": {
      // Its first child a browser can draw: one that requires no extension
      // (Illustrator puts its own data in a <foreignObject> that does).
      const chosen = element.children.find((child) => !child.attrs.requiredExtensions?.trim());
      if (chosen) walk(chosen, style, placed, viewport, context, uses);
      return;
    }
    case "svg": {
      // A nested <svg>: a viewport of its own at (x, y).
      const width = length(element.attrs.width, viewport.width) ?? viewport.width;
      const height = length(element.attrs.height, viewport.height) ?? viewport.height;
      // A viewport of no size draws nothing.
      if (!(width > 0 && height > 0)) return;
      const box = viewBox(element.attrs.viewBox);
      const x = length(element.attrs.x, viewport.width) ?? 0;
      const y = length(element.attrs.y, viewport.height) ?? 0;
      const fit = box ? viewportTransform(box, x, y, width, height, element.attrs.preserveAspectRatio) : translation(x, y);
      const inner = box ? { width: box.width, height: box.height } : { width, height };
      for (const child of element.children) walk(child, style, checkMatrix(multiply(placed, fit)), inner, context, uses);
      return;
    }
    case "use": {
      const href = hrefOf(element)?.trim();
      // Only a shape in this file: a reference to another file isn't loaded.
      if (!href?.startsWith("#")) return;
      const id = href.slice(1);
      const target = context.ids.get(id);
      if (!target || uses.includes(id)) return;
      if (uses.length >= LIMITS.useDepth) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
      const x = length(element.attrs.x, viewport.width) ?? 0;
      const y = length(element.attrs.y, viewport.height) ?? 0;
      const at = checkMatrix(multiply(placed, translation(x, y)));
      if (target.name === "symbol" || target.name === "svg") {
        const targetOwn = specified(target, context.sheets);
        if (targetOwn.display?.trim().toLowerCase() === "none") return;
        if (targetOwn.opacity !== undefined && zero(targetOwn.opacity)) return;
        const targetStyle = inherit(style, targetOwn);
        // Its viewport: the <use>'s width and height, else the symbol's (or
        // the <svg>'s), else all of the viewport the <use> is in (100%, as
        // browsers size it), into which its viewBox is fitted.
        const width = length(element.attrs.width ?? target.attrs.width, viewport.width) ?? viewport.width;
        const height = length(element.attrs.height ?? target.attrs.height, viewport.height) ?? viewport.height;
        if (!(width > 0 && height > 0)) return;
        const box = viewBox(target.attrs.viewBox);
        const fit = box
          ? checkMatrix(multiply(at, viewportTransform(box, 0, 0, width, height, target.attrs.preserveAspectRatio)))
          : at;
        const inner = box ? { width: box.width, height: box.height } : { width, height };
        for (const child of target.children) walk(child, targetStyle, fit, inner, context, [...uses, id]);
        return;
      }
      walk(target, style, at, viewport, context, [...uses, id]);
      return;
    }
    case "text":
      if (visible && (fills(style) || strokes(style))) context.result.leftOut.text = true;
      return;
    case "image":
    case "foreignObject":
      if (visible) context.result.leftOut.pictures = true;
      return;
    default:
      break;
  }
  if (!SHAPES.has(element.name) || !visible) return;

  const filled = fills(style) && element.name !== "line";
  const stroked = strokes(style);
  if (!filled) {
    if (stroked) context.result.strokeOnly += 1;
    return;
  }
  const shape = shapePath(element, viewport);
  if (!shape || !shape.commands.length) return;
  if (stroked) context.result.leftOut.strokes = true;
  if (context.result.shapes.length >= LIMITS.shapes) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
  if (context.commands + shape.commands.length > LIMITS.commands) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
  // Absolute lines and cubic curves only: svg-pathdata 9.0.0, which
  // svgicons2svgfont transforms paths with, turns an absolute H or V the
  // wrong way under a rotation or skew (it reads the turned point before
  // it), and arcs and smooth curves are simplest turned as curves.
  // Relative steps add up: the absolute path is checked too.
  const path = checkPath(shape.toAbs().normalizeHVZ(false).normalizeST().qtToC().aToC());
  context.commands += path.commands.length;
  if (context.commands > LIMITS.commands) throw svgFontError("too_complex", TOO_COMPLEX_MESSAGE);
  const moved = placed.some((value, index) => value !== IDENTITY[index]);
  context.result.shapes.push({
    svg:
      `<svg xmlns="${SVG_NS}" width="1" height="1" viewBox="0 0 1 1">` +
      (moved ? `<g transform="matrix(${placed.map(num).join(" ")})">` : "") +
      `<path d="${path.encode()}"/>` +
      (moved ? "</g>" : "") +
      "</svg>",
    fillRule: style.fillRule.trim().toLowerCase() === "evenodd" ? "evenodd" : "nonzero",
    commands: path.commands.length,
  });
}

// The root's artboard: its viewBox, else its width and height.
function rootArtboard(root: Element): Artboard | null {
  const box = viewBox(root.attrs.viewBox);
  if (box) return box;
  const width = length(root.attrs.width, 0);
  const height = length(root.attrs.height, 0);
  return width && height && width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null;
}

// The root <svg>'s transform attribute (SVG 2), in its user units. A browser
// applies it as a CSS transform of the root's box: in CSS pixels (the
// root's width and height; its viewBox's units when it has none), about the
// box's centre, to the drawing and the artboard together.
function rootTransform(root: Element, artboard: Artboard | null): Matrix {
  const transform = parseTransform(root.attrs.transform);
  // Without an artboard the drawing's own bounds frame it: where it turns
  // or how far it moves changes nothing.
  if (transform === IDENTITY || !artboard) return transform;
  const ratio = artboard.width / artboard.height;
  const width = length(root.attrs.width, 0);
  const height = length(root.attrs.height, 0);
  // One of width and height alone: the other keeps the artboard's shape.
  const boxWidth = width && width > 0 ? width : height && height > 0 ? height * ratio : artboard.width;
  const boxHeight = height && height > 0 ? height : boxWidth / ratio;
  const box = viewBox(root.attrs.viewBox);
  const fit = box ? viewportTransform(box, 0, 0, boxWidth, boxHeight, root.attrs.preserveAspectRatio) : IDENTITY;
  const centre = translation(boxWidth / 2, boxHeight / 2);
  const about = multiply(multiply(centre, transform), translation(-boxWidth / 2, -boxHeight / 2));
  return checkMatrix(multiply(multiply(invert(fit), about), fit));
}

// The filled shapes `text` (an SVG file's text) draws. Throws an Error with
// a `code` (svgFontError) when it can't be read or is over LIMITS.
export function readSvgShapes(text: string): SvgShapes {
  const root = parseSvg(text);
  const rules: Rule[] = [];
  collectStyleSheets(root, rules);
  const ids = new Map<string, Element>();
  indexIds(root, ids);
  const artboard = rootArtboard(root);
  const result: SvgShapes = {
    artboard,
    transform: rootTransform(root, artboard),
    shapes: [],
    leftOut: { strokes: false, text: false, pictures: false },
    strokeOnly: 0,
  };
  const context: Context = { sheets: indexRules(rules), visits: 0, ids, result, commands: 0 };
  const own = specified(root, context.sheets);
  if (own.display?.trim().toLowerCase() === "none" || (own.opacity !== undefined && zero(own.opacity))) return result;
  const style = inherit(INITIAL_STYLE, own);
  const viewport = artboard ? { width: artboard.width, height: artboard.height } : { width: 100, height: 100 };
  for (const child of root.children) walk(child, style, IDENTITY, viewport, context, []);
  return result;
}
