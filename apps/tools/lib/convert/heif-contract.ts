export const HEIF_CONVERSION_TOOL_IDS = Object.freeze([
  'heif-to-jpg',
  'heif-to-pdf',
  'heif-to-png',
  'heif-to-webp',
] as const);

export const HEIF_CONVERSION_TOOL_IDS_SHA256 =
  'sha256:419375ce2943b3ee923647f15901613eadb87e17e7e5df6f13d93af02dbf1d2b';

export const HEIF_ENGINE_CONTRACT = Object.freeze({
  decode: 'libheif-js@1.19.8',
  encode: 'browser-canvas-codec',
  pdf: 'pdf-lib',
  execution: 'browser-only',
  fallback: 'fail-closed',
} as const);
