import { AUDIO_FORMATS, VIDEO_FORMATS } from './capabilities.ts';

export type CompressionTarget =
  | 'audio'
  | 'image-server'
  | 'image-worker'
  | 'pdf'
  | 'svg-worker'
  | 'unsupported'
  | 'video';

export type CompressionDispatch = Readonly<{
  target: CompressionTarget;
  engineIds: readonly string[];
}>;

const IMAGE_WORKER_FORMATS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const IMAGE_SERVER_FORMATS = new Set([
  'gif',
  'heic',
  'heif',
  'avif',
  'tiff',
  'tif',
  'bmp',
]);
const AUDIO_FORMAT_SET = new Set(AUDIO_FORMATS);
const VIDEO_FORMAT_SET = new Set(VIDEO_FORMATS);

function normalizeQuality(
  quality: number | undefined,
  fallback: number,
): number {
  if (typeof quality !== 'number' || Number.isNaN(quality)) {
    return fallback;
  }
  return Math.min(0.95, Math.max(0.1, quality));
}

export function resolveCompressionTarget(format: string): CompressionTarget {
  const normalized = format.toLowerCase();
  if (normalized === 'pdf') return 'pdf';
  if (normalized === 'svg') return 'svg-worker';
  if (IMAGE_WORKER_FORMATS.has(normalized)) return 'image-worker';
  if (IMAGE_SERVER_FORMATS.has(normalized)) return 'image-server';
  if (AUDIO_FORMAT_SET.has(normalized)) return 'audio';
  if (VIDEO_FORMAT_SET.has(normalized)) return 'video';
  return 'unsupported';
}

const compressionDispatchByTarget = Object.freeze({
  audio: Object.freeze({
    target: 'audio',
    engineIds: Object.freeze(['browser-ffmpeg-compression']),
  }),
  'image-server': Object.freeze({
    target: 'image-server',
    engineIds: Object.freeze(['server-image-compression']),
  }),
  'image-worker': Object.freeze({
    target: 'image-worker',
    engineIds: Object.freeze(['browser-image-compression-worker']),
  }),
  pdf: Object.freeze({
    target: 'pdf',
    engineIds: Object.freeze(['server-pdf-compression']),
  }),
  'svg-worker': Object.freeze({
    target: 'svg-worker',
    engineIds: Object.freeze(['browser-svg-optimization-worker']),
  }),
  unsupported: Object.freeze({
    target: 'unsupported',
    engineIds: Object.freeze([]),
  }),
  video: Object.freeze({
    target: 'video',
    engineIds: Object.freeze(['browser-ffmpeg-compression']),
  }),
} satisfies Record<CompressionTarget, CompressionDispatch>);

export function resolveCompressionDispatch(
  format: string,
): CompressionDispatch {
  return compressionDispatchByTarget[resolveCompressionTarget(format)];
}

export function mapQualityToPngLevel(quality?: number): number {
  const normalized = normalizeQuality(quality, 0.8);
  const level = Math.round((1 - normalized) * 6);
  return Math.min(6, Math.max(0, level));
}

export function mapQualityToImageQuality(quality?: number): number {
  const normalized = normalizeQuality(quality, 0.82);
  return Math.round(normalized * 100);
}

export function mapQualityToAudioBitrate(quality?: number): string {
  const normalized = normalizeQuality(quality, 0.7);
  if (normalized >= 0.85) return '192k';
  if (normalized >= 0.7) return '160k';
  if (normalized >= 0.55) return '128k';
  if (normalized >= 0.4) return '96k';
  return '64k';
}

export function mapQualityToVideoCrf(quality?: number): number {
  const normalized = normalizeQuality(quality, 0.7);
  const crf = Math.round(32 - normalized * 10);
  return Math.min(34, Math.max(18, crf));
}

export function isImageCompressionFormat(format: string): boolean {
  const normalized = format.toLowerCase();
  return (
    IMAGE_WORKER_FORMATS.has(normalized) || IMAGE_SERVER_FORMATS.has(normalized)
  );
}
