// SVG to TTF's crossing outlines (svg-font-boolean.ts) worked out in a
// worker, which svg-font.ts terminates when it runs past its time limit
// (issue #251), so the page's thread is never held by it.

import { resolveRegions, type RegionsJob, type RegionsReply } from "./svg-font-boolean.ts";

// In a worker (not when a test imports this module).
if (typeof self !== "undefined" && typeof (self as { postMessage?: unknown }).postMessage === "function") {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<RegionsJob>) => void) | null;
    postMessage: (message: RegionsReply, transfer: Transferable[]) => void;
  };
  scope.onmessage = (event) => {
    const reply = resolveRegions(event.data);
    const transfer = reply.ok ? reply.shapes.flatMap((shape) => ("contours" in shape ? shape.contours.map((points) => points.buffer) : [])) : [];
    scope.postMessage(reply, transfer);
  };
}
