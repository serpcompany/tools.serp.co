import { TIFF_TO_PNG_TOOL_IDS } from '../../apps/tools/lib/convert/tiff-family.mjs';

export const GENERIC_SMOKE_CAPABILITY_VERSION = 'generic-adapters-v7-tiff';

const browserWebmToolIds = new Set([
  'compress-webm',
  'mp4-to-webm',
  'webm-to-m4a',
  'webm-to-mp3',
  'webm-to-mp4',
]);
const browserTiffToolIds = new Set(TIFF_TO_PNG_TOOL_IDS);

const imageInputs = new Set(['bmp', 'heic', 'jpeg', 'jpg', 'png', 'webp']);
const imageOutputs = new Set(['jpeg', 'jpg', 'pdf', 'png', 'webp']);
const compressionFormats = new Set(['jpeg', 'jpg', 'png', 'webp']);
const semanticallyVerifiedInputs = new Set([
  'bmp',
  'heic',
  'jpeg',
  'jpg',
  'm4a',
  'mp3',
  'mp4',
  'pdf',
  'png',
  'webp',
]);
const semanticallyVerifiedOutputs = new Set([
  'jpeg',
  'jpg',
  'm4a',
  'mp3',
  'mp4',
  'pdf',
  'png',
  'webp',
]);
const approvedBmpToolIds = new Set([
  'bmp-to-jpeg',
  'bmp-to-jpg',
  'bmp-to-pdf',
  'bmp-to-png',
  'bmp-to-webp',
]);

// This evidence projection deliberately does not import the UI contract registry.
// It is versioned and derived from the actual server-image, raster-worker, adaptive
// media, and semantic-decoder boundaries exercised by browser smoke.
export function getGenericSmokeExpectation(tool) {
  const from = tool.from?.toLowerCase();
  const to = tool.to?.toLowerCase();
  if (browserWebmToolIds.has(tool.id)) return 'supported';
  if (browserTiffToolIds.has(tool.id)) return 'supported';
  if (
    tool.id === 'compress-svg' &&
    tool.operation === 'compress' &&
    from === 'svg' &&
    to === 'svg'
  ) {
    return 'supported';
  }
  if (
    !from ||
    !to ||
    !semanticallyVerifiedInputs.has(from) ||
    !semanticallyVerifiedOutputs.has(to)
  ) {
    return 'unsupported';
  }
  if (tool.operation === 'compress') {
    return from === to && compressionFormats.has(from)
      ? 'supported'
      : 'unsupported';
  }
  if (tool.operation !== 'convert') return 'unsupported';
  if (from === 'bmp' && !approvedBmpToolIds.has(tool.id)) {
    return 'unsupported';
  }
  const adapterSupported =
    (from === 'pdf' && ['jpeg', 'jpg', 'png', 'webp'].includes(to)) ||
    (imageInputs.has(from) && imageOutputs.has(to));
  return adapterSupported ? 'supported' : 'unsupported';
}
