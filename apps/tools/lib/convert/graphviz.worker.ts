// Lays out a Graphviz DOT graph as SVG (issue #265) with Viz.js, Graphviz
// compiled to WebAssembly, whose module is part of this worker's own script
// (no other file is fetched). It runs in a worker so graphviz-image.ts can
// stop a layout that takes too long by terminating it. Graphviz reads files
// only from the WebAssembly module's in-memory file system, which holds none
// of the visitor's files, and fetches nothing: a file the graph names (an
// image, a shape file) is simply missing. The file system's devices that
// never end (/dev/urandom read as a shape file kept Graphviz reading until
// the tab ran out of memory) are removed before the graph is read.

import { instance } from "@viz-js/viz";

export type GraphvizJob = { dot: string; graphAttributes?: Record<string, string> };
export type GraphvizReply = { ok: true; svg: string; warnings: string[] } | { ok: false; error: string };

// Devices a graph could name as a file and read without end, or wait on.
export const REMOVED_DEVICES = ["/dev/random", "/dev/urandom", "/dev/tty", "/dev/tty1", "/dev/stdin"];

type FileSystem = { unlink: (path: string) => void };

// Viz.js keeps its Emscripten module, and the module its file system, on
// the instance; neither is public API, so a build without them is left as it
// is (the page's time limit still stops the layout).
export function removeDevices(viz: unknown): string[] {
  const fs = (viz as { module?: { FS?: FileSystem } } | null)?.module?.FS;
  if (!fs) return [];
  return REMOVED_DEVICES.filter((path) => {
    try {
      fs.unlink(path);
      return true;
    } catch {
      return false;
    }
  });
}

// Lays one graph out; the worker's answer to each message.
export async function layOutGraph(job: GraphvizJob): Promise<GraphvizReply> {
  try {
    const viz = await instance();
    removeDevices(viz);
    const result = viz.render(job.dot, { format: "svg", graphAttributes: job.graphAttributes });
    const messages = (level: string) => result.errors.filter((error) => error.level === level).map((error) => error.message.trim());
    if (result.status === "success") return { ok: true, svg: result.output, warnings: messages("warning") };
    return { ok: false, error: messages("error")[0] ?? result.errors[0]?.message.trim() ?? "Graphviz couldn't lay it out." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// In a worker (not when a test imports this module).
if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function") {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<GraphvizJob>) => void) | null;
    postMessage: (message: GraphvizReply) => void;
  };
  scope.onmessage = async (event) => scope.postMessage(await layOutGraph(event.data));
}
