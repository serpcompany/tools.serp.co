// A PowerPoint (PPTX) file drawn as images (issue #265), one a slide, in the
// visitor's browser. pptx-glimpse 5.3.1 (MIT) draws each slide as SVG in a
// worker (pptx.worker.ts), stopped after SLIDES_TIMEOUT_MS; each SVG is then
// drawn through an <img> (svg-image.ts), which runs nothing and loads
// nothing, at twice the slide's size in points (1920x1080 for a 13.33-inch
// widescreen slide). Hidden slides are left out, as a slide show leaves them
// out; so are speaker notes and comments. Each image is named after its
// slide's number, hidden slides counted, as PowerPoint numbers them.
// document-images.ts loads this module only when a PPTX file is converted.

import type { RGBA } from "./heif.ts";
import {
  isOleFile,
  isZipFile,
  listParts,
  mainPartPath,
  parseRelationships,
  partText,
  readParts,
  relationEndingIn,
  relationshipId,
  relationshipsPath,
  rootElement,
  scanXml,
  type ReadOptions,
  type Relationship,
} from "./ooxml.ts";
import type { PptxJob, PptxReply } from "./pptx.worker.ts";
import { prepareSvgForImage, rasterizeSvg, svgImageSize, svgSize } from "./svg-image.ts";
import { runInWorker, type WorkerLike } from "./worker-run.ts";

// Pixels a point, as PDF and DOCX pages are drawn.
export const SLIDE_SCALE = 2;
// The most images one presentation becomes.
export const MAX_SLIDES = 100;
// pptx-glimpse inflates the whole package: a file whose parts declare more
// than this, inflated, isn't read.
export const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
export const SLIDES_TIMEOUT_MS = 90_000;

const READ: ReadOptions = {
  maxBytes: MAX_PACKAGE_BYTES,
  tooBig: `This presentation is too large to draw here: its parts hold more than ${MAX_PACKAGE_BYTES / 1024 / 1024} MB.`,
  kind: "PowerPoint file",
};

export const SLIDES_TIMEOUT_MESSAGE = `This presentation took more than ${SLIDES_TIMEOUT_MS / 1000} seconds to draw in the browser, so it was stopped. Try saving fewer slides in a copy of it.`;

// The relationship type pptx-glimpse takes as a slide (Transitional OOXML,
// which PowerPoint writes).
export const SLIDE_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

// The slide parts in the presentation's order, read as pptx-glimpse reads
// them, so a slide's place here is the number pptx-glimpse gives it: each
// <p:sldId> of the presentation's first <p:sldIdLst>, by its r:id
// (relationshipId), when that names an internal relationship of the slide
// type; any other entry is skipped and not numbered.
export function slideTargets(presentationXml: string, relationships: Map<string, Relationship>): string[] {
  const targets: string[] = [];
  let depth = 0;
  let list: "before" | "in" | "after" = "before";
  scanXml(presentationXml, {
    open(name, attributes) {
      depth += 1;
      if (depth === 2 && name === "sldIdLst" && list === "before") list = "in";
      else if (depth === 3 && name === "sldId" && list === "in") {
        const relation = relationships.get(relationshipId(attributes) ?? "");
        if (relation && !relation.external && relation.type === SLIDE_RELATIONSHIP) targets.push(relation.target);
      }
    },
    close(name) {
      if (depth === 2 && name === "sldIdLst" && list === "in") list = "after";
      depth -= 1;
    },
  });
  return targets;
}

// The theme's body font (its minor Latin typeface), which PowerPoint gives
// text that names no font, such as a table's.
export function themeBodyFont(themeXml: string): string | null {
  let font: string | null = null;
  let inMinor = false;
  scanXml(themeXml, {
    open(name, attributes) {
      if (name === "minorFont") inMinor = true;
      else if (inMinor && name === "latin" && attributes.typeface && !font) font = attributes.typeface;
    },
    close(name) {
      if (name === "minorFont") inMinor = false;
    },
  });
  return font;
}

// The font family drawn for text that names none: the theme's body font,
// then fonts with its widths and the browser's sans-serif.
export function defaultFontFamily(bodyFont: string | null): string {
  const fonts = [bodyFont && !/^\+/.test(bodyFont) ? `'${bodyFont.replace(/'/g, "")}'` : null, "Calibri", "Carlito", "Arial", "sans-serif"];
  return [...new Set(fonts.filter(Boolean))].join(", ");
}

// A slide marked hidden (<p:sld show="0">), which a slide show skips.
export function isHiddenSlide(slideXml: string): boolean {
  const root = rootElement(slideXml);
  const show = root?.name === "sld" ? root.attributes.show?.trim() : undefined;
  return show === "0" || show === "false";
}

// A slide: its number (its place in the presentation, hidden slides
// counted, from 1) and its part.
export type SlideRef = { number: number; part: string };

// The slides that show, in the presentation's order; how many slides it
// has, how many are hidden, and the theme's body font.
export function visibleSlides(buf: ArrayBuffer): { slides: SlideRef[]; total: number; hidden: number; bodyFont: string | null } {
  const bytes = new Uint8Array(buf);
  if (isOleFile(bytes)) {
    throw new Error(
      "This is an older PowerPoint file (.ppt) or a password-protected one: open it in PowerPoint and save it as an unprotected .pptx first.",
    );
  }
  if (!isZipFile(bytes)) throw new Error("This file isn't a PowerPoint (.pptx) file: it isn't a ZIP archive.");
  let declared = 0;
  try {
    for (const part of listParts(bytes)) declared += part.size;
  } catch {
    throw new Error(`This ${READ.kind} couldn't be read: it isn't a complete ZIP archive.`);
  }
  if (declared > MAX_PACKAGE_BYTES) throw new Error(READ.tooBig);

  const presentationPath = mainPartPath(bytes, "ppt/presentation.xml", READ);
  const relsPath = relationshipsPath(presentationPath);
  const head = readParts(bytes, (name) => name === presentationPath || name === relsPath, READ);
  if (!head[presentationPath]) throw new Error("This file isn't a PowerPoint (.pptx) file: it has no presentation part.");
  const relationships = parseRelationships(partText(head[relsPath]), presentationPath);
  const targets = slideTargets(partText(head[presentationPath]), relationships);
  const themePath = relationEndingIn(relationships, "/theme")?.target;
  const wanted = new Set([...targets, themePath]);
  const parts = readParts(bytes, (name) => wanted.has(name), READ);
  const slides: SlideRef[] = [];
  targets.forEach((part, index) => {
    const xml = partText(parts[part]);
    if (xml && !isHiddenSlide(xml)) slides.push({ number: index + 1, part });
  });
  const bodyFont = themePath ? themeBodyFont(partText(parts[themePath])) : null;
  return { slides, total: targets.length, hidden: targets.length - slides.length, bodyFont };
}

// What the page says about the slides saved: the hidden ones left out, the
// ones past MAX_SLIDES, and elements pptx-glimpse couldn't draw.
export function slidesNotice({ shown, visible, hidden, skipped }: { shown: number; visible: number; hidden: number; skipped: number }): string | undefined {
  const parts: string[] = [];
  if (shown > 1) parts.push(`One image a slide, in order, each named after its slide's number.`);
  if (visible > shown) parts.push(`The first ${shown} of ${visible} slides are saved, the most one presentation gives here.`);
  if (hidden) parts.push(`${hidden} hidden ${hidden === 1 ? "slide isn't" : "slides aren't"} drawn.`);
  if (skipped) parts.push(`${skipped} ${skipped === 1 ? "element" : "elements"} this converter can't draw ${skipped === 1 ? "is" : "are"} left out.`);
  return parts.length ? parts.join(" ") : undefined;
}

// ------------------------------------------------------------- browser --

const startWorker = (): WorkerLike<PptxReply> => new Worker(new URL("./pptx.worker.ts", import.meta.url), { type: "module" });

export async function renderSlideSvgsInWorker(
  job: PptxJob,
  { timeoutMs = SLIDES_TIMEOUT_MS, createWorker = startWorker }: { timeoutMs?: number; createWorker?: () => WorkerLike<PptxReply> } = {},
): Promise<{ slides: { number: number; part: string; svg: string }[]; skipped: number }> {
  const reply = await runInWorker(createWorker(), job, {
    timeoutMs,
    timedOut: () => Object.assign(new Error(SLIDES_TIMEOUT_MESSAGE), { code: "layout_timeout" }),
    crashed: (event) => new Error(`The presentation stopped drawing (${event.message || "out of memory"}).`),
    transfer: [job.bytes],
  });
  if (!reply.ok) throw new Error(`This PowerPoint file couldn't be drawn (${reply.error}).`);
  return reply;
}

// The slides asked of each worker: a few at a time, so the SVGs of a long
// presentation, each with its pictures inlined, aren't all held at once.
export const SLIDES_PER_WORKER = 10;

export function slideBatches<T>(slides: T[], size = SLIDES_PER_WORKER): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < slides.length; index += size) batches.push(slides.slice(index, index + size));
  return batches;
}

// Each slide that shows as an image, encoded by `encode` as soon as it's
// drawn, so only one slide's pixels are held at a time, and named after its
// number ("slide3"). The worker is asked for slide parts, not numbers: it
// draws the slides pptx-glimpse finds at those parts, so a hidden slide is
// never drawn in a visible one's place, and each image it returns is checked
// against the parts asked for. SLIDES_TIMEOUT_MS bounds the whole
// presentation, not each batch.
export async function renderSlides(
  buf: ArrayBuffer,
  encode: (rgba: RGBA) => Promise<ArrayBuffer>,
  onSlide?: (done: number, count: number) => void,
): Promise<{ buffers: ArrayBuffer[]; names: string[]; notice?: string }> {
  const { slides, total, hidden, bodyFont } = visibleSlides(buf);
  if (!total) throw new Error("This presentation has no slides.");
  if (!slides.length) throw new Error("Every slide in this presentation is hidden: there's no slide to draw.");
  const shown = slides.slice(0, MAX_SLIDES);
  const deadline = Date.now() + SLIDES_TIMEOUT_MS;
  const font = defaultFontFamily(bodyFont);
  const buffers: ArrayBuffer[] = [];
  const names: string[] = [];
  let skipped = 0;
  for (const batch of slideBatches([...new Set(shown.map((slide) => slide.part))])) {
    const reply = await renderSlideSvgsInWorker({ bytes: buf.slice(0), parts: batch }, { timeoutMs: Math.max(1, deadline - Date.now()) });
    skipped += reply.skipped;
    for (const slide of reply.slides) {
      if (!batch.includes(slide.part)) throw new Error("This presentation's slides couldn't be told apart, so none were saved.");
      if (buffers.length >= MAX_SLIDES) break;
      const size = svgSize(slide.svg);
      if (!size) throw new Error(`Slide ${slide.number} couldn't be drawn.`);
      const image = svgImageSize(size.width, size.height, SLIDE_SCALE);
      const svg = prepareSvgForImage(slide.svg, image.width, image.height, font);
      buffers.push(await encode(await rasterizeSvg(svg, image.width, image.height)));
      names.push(`slide${slide.number}`);
      onSlide?.(buffers.length, shown.length);
    }
  }
  if (!buffers.length) throw new Error("This presentation's slides couldn't be drawn.");
  return { buffers, names, notice: slidesNotice({ shown: buffers.length, visible: slides.length, hidden, skipped }) };
}
