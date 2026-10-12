// A Graphviz DOT file drawn as an image (issue #265), in the visitor's
// browser. Viz.js 3.31.0 (Graphviz 16.1.0 in WebAssembly, MIT) lays the graph
// out as SVG in a worker (graphviz.worker.ts), which is stopped when it runs
// past LAYOUT_TIMEOUT_MS; the SVG is then drawn on a canvas through an
// <img> (svg-image.ts), which runs nothing and loads nothing, at twice its
// size in points, at most MAX_IMAGE_SIDE pixels a side. document-images.ts loads this
// module only when a DOT file is converted; the worker and its WebAssembly
// load only then too, from this site.

import { MAX_IMAGE_SIDE } from "./document-images.ts";
import type { RGBA } from "./heif.ts";
import type { GraphvizJob, GraphvizReply } from "./graphviz.worker.ts";
import { prepareSvgForImage, rasterizeSvg, svgImageSize, svgSize } from "./svg-image.ts";
import { runInWorker, type WorkerLike } from "./worker-run.ts";

// A DOT file is code: anything bigger than this isn't a graph a picture of
// could show.
export const MAX_DOT_BYTES = 2 * 1024 * 1024;
// A layout still running after this long is stopped. A 2,000-node tree takes
// a fraction of a second; dense graphs can take minutes.
export const LAYOUT_TIMEOUT_MS = 60_000;
// Pixels a point, as PDF pages are drawn.
export const GRAPH_SCALE = 2;
// A graph with more edges than this is laid out with Graphviz's own limits
// on its slowest steps (crossing reduction and rank assignment), unless the
// file sets them: a random 2,000-node graph with 3,000 edges took 150 s
// without them and 21 s with them.
export const LARGE_GRAPH_EDGES = 1000;
export const LARGE_GRAPH_ATTRIBUTES: Record<string, string> = { mclimit: "0.1", nslimit: "1", nslimit1: "1" };

export const LAYOUT_TIMEOUT_MESSAGE = `This graph took more than ${LAYOUT_TIMEOUT_MS / 1000} seconds to lay out in the browser, so it was stopped. Try a smaller graph, or another layout engine (layout=sfdp is fast for large graphs).`;

// The edges in a DOT file, roughly: its "->" and "--" operators.
export function countEdges(dot: string): number {
  return dot.match(/->|--/g)?.length ?? 0;
}

// What the page says about a graph's warnings: the pictures and shape files
// it names aren't drawn, since only the DOT file is uploaded.
export function graphWarningsNotice(warnings: string[]): string | undefined {
  return warnings.some((warning) => /image|shapefile|epsf/i.test(warning))
    ? "Pictures and shape files the graph names aren't drawn: only the DOT file itself is uploaded."
    : undefined;
}

export function graphScaleNotice(size: { width: number; height: number }, image: { width: number; height: number; scale: number }): string | undefined {
  if (image.scale >= 1) return undefined;
  const count = (value: number) => Math.round(value).toLocaleString("en-US");
  return `The graph is ${count(size.width)} x ${count(size.height)} pt, so it's drawn smaller to fit a ${count(MAX_IMAGE_SIDE)} px image (${count(image.width)} x ${count(image.height)} px): small text may be hard to read.`;
}

// ------------------------------------------------------------- browser --

const startWorker = (): WorkerLike<GraphvizReply> =>
  new Worker(new URL("./graphviz.worker.ts", import.meta.url), { type: "module" });

// Lays the graph out in a new worker, which is terminated when it answers,
// fails, or runs past `timeoutMs` (an Error with code "layout_timeout").
export async function layoutGraph(
  job: GraphvizJob,
  { timeoutMs = LAYOUT_TIMEOUT_MS, createWorker = startWorker }: { timeoutMs?: number; createWorker?: () => WorkerLike<GraphvizReply> } = {},
): Promise<{ svg: string; warnings: string[] }> {
  const reply = await runInWorker(createWorker(), job, {
    timeoutMs,
    timedOut: () => Object.assign(new Error(LAYOUT_TIMEOUT_MESSAGE), { code: "layout_timeout" }),
    crashed: (event) => new Error(`Graphviz stopped while laying out this graph (${event.message || "out of memory"}).`),
  });
  if (!reply.ok) throw new Error(`This DOT file couldn't be laid out (${reply.error}).`);
  return { svg: reply.svg, warnings: reply.warnings };
}

export async function renderGraph(buf: ArrayBuffer): Promise<{ rgba: RGBA; notice?: string }> {
  if (buf.byteLength > MAX_DOT_BYTES) {
    throw new Error(`This DOT file is ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB: graphs up to ${MAX_DOT_BYTES / 1024 / 1024} MB are drawn here.`);
  }
  const dot = new TextDecoder().decode(buf);
  if (!dot.trim()) throw new Error("This DOT file is empty.");
  const { svg, warnings } = await layoutGraph({
    dot,
    graphAttributes: countEdges(dot) > LARGE_GRAPH_EDGES ? LARGE_GRAPH_ATTRIBUTES : undefined,
  });
  const size = svgSize(svg);
  if (!size) throw new Error("This graph has nothing to draw.");
  const image = svgImageSize(size.width, size.height, GRAPH_SCALE);
  const rgba = await rasterizeSvg(prepareSvgForImage(svg, image.width, image.height), image.width, image.height);
  const notices = [graphScaleNotice(size, image), graphWarningsNotice(warnings)].filter(Boolean);
  return { rgba, notice: notices.length ? notices.join(" ") : undefined };
}
