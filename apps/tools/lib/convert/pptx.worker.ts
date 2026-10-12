// Draws PowerPoint slides as SVG (issue #265) with pptx-glimpse, in a
// worker so pptx-slides.ts can stop a presentation that takes too long. Text
// is written as SVG text in the slide's own fonts, which the browser draws
// with the visitor's fonts when the SVG becomes an image, so no font file is
// fetched; pictures the file holds are inlined as data: URLs.

import { convertPptxToSvg } from "pptx-glimpse";

export type PptxJob = { bytes: ArrayBuffer; slides: number[] };
export type PptxReply =
  | { ok: true; slides: { number: number; svg: string }[]; skipped: number }
  | { ok: false; error: string };

// The slides `job.slides` names (1-based, in the presentation's order) as
// SVG, and how many elements pptx-glimpse couldn't draw.
export async function renderSlideSvgs(job: PptxJob): Promise<PptxReply> {
  try {
    const report = await convertPptxToSvg(new Uint8Array(job.bytes), {
      slides: job.slides,
      textOutput: "text",
      logLevel: "off",
      // Node only (tests): no scan of the machine's fonts.
      skipSystemFonts: true,
    });
    return {
      ok: true,
      slides: report.slides.map((slide) => ({ number: slide.slideNumber, svg: slide.svg })),
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
