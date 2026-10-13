// Draws PowerPoint slides as SVG (issue #265) with pptx-glimpse, in a
// worker so pptx-slides.ts can stop a presentation that takes too long. Text
// is written as SVG text in the slide's own fonts, which the browser draws
// with the visitor's fonts when the SVG becomes an image, so no font file is
// fetched; pictures the file holds are inlined as data: URLs.

import { readPptx } from "@pptx-glimpse/document";
import { renderPptxSourceModelToSvg } from "pptx-glimpse";

// The slide parts to draw (pptx-slides.ts chose them: the ones not hidden).
export type PptxJob = { bytes: ArrayBuffer; parts: string[] };
export type PptxReply =
  | { ok: true; slides: { number: number; part: string; svg: string }[]; skipped: number }
  | { ok: false; error: string };

// The slides at `job.parts` as SVG, each with the number pptx-glimpse gives
// it (its place in pptx-glimpse's own slide list, from 1) and its part, and
// how many elements pptx-glimpse couldn't draw. The numbers come from
// pptx-glimpse's list, not the page's, so the slide drawn is always the part
// asked for; a part it doesn't list fails the job rather than drawing
// another slide.
export async function renderSlideSvgs(job: PptxJob): Promise<PptxReply> {
  try {
    const source = readPptx(new Uint8Array(job.bytes));
    const order = source.presentation.slidePartPaths as readonly string[];
    const wanted = new Set(job.parts);
    if (job.parts.some((part) => !order.includes(part))) {
      return { ok: false, error: "its slides aren't all where its slide list says" };
    }
    const numbers = order.flatMap((part, index) => (wanted.has(part) ? [index + 1] : []));
    const report = await renderPptxSourceModelToSvg(source, {
      slides: numbers,
      textOutput: "text",
      logLevel: "off",
      // Node only (tests): no scan of the machine's fonts.
      skipSystemFonts: true,
    });
    return {
      ok: true,
      slides: report.slides
        .filter((slide) => wanted.has(order[slide.slideNumber - 1] ?? ""))
        .map((slide) => ({ number: slide.slideNumber, part: order[slide.slideNumber - 1]!, svg: slide.svg })),
      skipped: report.supportCoverage.overall.skippedElements + report.supportCoverage.overall.unresolvedElements,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// In a worker (not when a test imports this module).
if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function") {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<PptxJob>) => void) | null;
    postMessage: (message: PptxReply) => void;
  };
  scope.onmessage = async (event) => scope.postMessage(await renderSlideSvgs(event.data));
}
