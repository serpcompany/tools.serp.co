export const GENERIC_SMOKE_CAPABILITY_VERSION = "generic-adapters-v2";

const imageInputs = new Set(["heic", "jpeg", "jpg", "png", "webp"]);
const imageOutputs = new Set(["jpeg", "jpg", "pdf", "png", "webp"]);
const compressionFormats = new Set(["jpeg", "jpg", "png", "webp"]);
const semanticallyVerifiedInputs = new Set([
  "heic", "jpeg", "jpg", "m4a", "mp3", "mp4", "pdf", "png", "webp",
]);
const semanticallyVerifiedOutputs = new Set([
  "jpeg", "jpg", "m4a", "mp3", "mp4", "pdf", "png", "webp",
]);

// This evidence projection deliberately does not import the UI contract registry.
// It is versioned and derived from the actual server-image, raster-worker, adaptive
// media, and semantic-decoder boundaries exercised by browser smoke.
export function getGenericSmokeExpectation(tool) {
  const from = tool.from?.toLowerCase();
  const to = tool.to?.toLowerCase();
  if (!from || !to || !semanticallyVerifiedInputs.has(from) || !semanticallyVerifiedOutputs.has(to)) {
    return "unsupported";
  }
  if (tool.operation === "compress") {
    return from === to && compressionFormats.has(from) ? "supported" : "unsupported";
  }
  if (tool.operation !== "convert") return "unsupported";
  const adapterSupported =
    (from === "pdf" && ["jpeg", "jpg", "png", "webp"].includes(to)) ||
    (imageInputs.has(from) && imageOutputs.has(to));
  return adapterSupported ? "supported" : "unsupported";
}
