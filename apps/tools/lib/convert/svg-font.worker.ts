// SVG to TTF's crossing outlines (svg-font-boolean.ts) worked out in a
// worker, which svg-font.ts terminates when it runs past its time limit
// (issue #251), so the page's thread is never held by it. Each shape's
// region is posted as soon as it is found, then `done`; the job stops at the
// first region the glyph has no room for (resolveRegions).

import { resolveRegions, type RegionsJob, type RegionsMessage } from "./svg-font-boolean.ts";

// In a worker (not when a test imports this module).
if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function") {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<RegionsJob>) => void) | null;
    postMessage: (message: RegionsMessage, transfer: Transferable[]) => void;
  };
  scope.onmessage = (event) => {
    resolveRegions(event.data, (index, shape) => {
      scope.postMessage({ index, shape }, "contours" in shape ? shape.contours.map((points) => points.buffer) : []);
    });
    scope.postMessage({ done: true }, []);
  };
}
