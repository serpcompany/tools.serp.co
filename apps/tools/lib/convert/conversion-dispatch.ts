import {
  AUDIO_FORMATS,
  VIDEO_FORMATS,
  requiresVideoConversion,
} from '../capabilities.ts';

export type ConversionOp = 'raster' | 'pdf-pages' | 'video';

export type ConversionDispatchKind =
  | 'adaptive-video'
  | 'browser-webm-ffmpeg'
  | 'browser-pdf-pages'
  | 'browser-raster'
  | 'browser-tiff-worker'
  | 'server-assisted-image'
  | 'server-image';

type ConversionDispatch = Readonly<{
  kind: ConversionDispatchKind;
  engineIds: readonly string[];
}>;

const SERVER_IMAGE_INPUTS = new Set([
  'tiff',
  'tif',
  'cr2',
  'cr3',
  'dng',
  'arw',
  'psd',
  'tga',
  'dds',
  'xcf',
  'apng',
]);

const SERVER_IMAGE_OUTPUTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'tif',
  'svg',
  'ico',
  'cur',
  'tga',
  'dds',
]);
const BROWSER_RASTER_INPUTS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'tif',
  'tiff',
  'webp',
]);
const BROWSER_RASTER_OUTPUTS = new Set([
  'avif',
  'jpeg',
  'jpg',
  'pdf',
  'png',
  'svg',
  'webp',
]);
const PDF_OUTPUTS = new Set(['jpeg', 'jpg', 'png', 'webp']);
const ADAPTIVE_INPUTS = new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS, 'gif']);
const ADAPTIVE_OUTPUTS = new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS, 'gif']);
const AUDIO_INPUTS = new Set(AUDIO_FORMATS);
const VIDEO_INPUTS = new Set([...VIDEO_FORMATS, 'gif']);

export type ConversionCapability = Readonly<
  | { supported: true; dispatch: ConversionDispatch }
  | { supported: false; reason: string }
>;

export function resolveConversionCapability(
  from: string,
  to: string,
): ConversionCapability {
  const input = from.toLowerCase();
  const output = to.toLowerCase();
  const dispatch = resolveConversionDispatch(input, output);
  const supported =
    input === 'pdf'
      ? PDF_OUTPUTS.has(output)
      : SERVER_IMAGE_INPUTS.has(input)
        ? SERVER_IMAGE_OUTPUTS.has(output) || BROWSER_RASTER_OUTPUTS.has(output)
        : ADAPTIVE_INPUTS.has(input) || ADAPTIVE_OUTPUTS.has(output)
          ? (VIDEO_INPUTS.has(input) && ADAPTIVE_OUTPUTS.has(output)) ||
            (AUDIO_INPUTS.has(input) && AUDIO_INPUTS.has(output))
          : BROWSER_RASTER_INPUTS.has(input) &&
            BROWSER_RASTER_OUTPUTS.has(output);
  return supported
    ? { supported: true, dispatch }
    : {
        supported: false,
        reason: `No exact production adapter for ${input}->${output}`,
      };
}

export function resolveConversionOp(from: string, to: string): ConversionOp {
  const dispatch = resolveConversionDispatch(from, to);
  if (dispatch.kind === 'browser-pdf-pages') return 'pdf-pages';
  if (
    dispatch.kind === 'adaptive-video' ||
    dispatch.kind === 'browser-webm-ffmpeg'
  ) {
    return 'video';
  }
  return 'raster';
}

const dispatchByKind = Object.freeze({
  'adaptive-video': Object.freeze({
    kind: 'adaptive-video',
    engineIds: Object.freeze([
      'adaptive-media-conversion',
      'browser-ffmpeg-wasm',
      'server-video-convert',
    ]),
  }),
  'browser-pdf-pages': Object.freeze({
    kind: 'browser-pdf-pages',
    engineIds: Object.freeze(['browser-pdf-pages']),
  }),
  'browser-webm-ffmpeg': Object.freeze({
    kind: 'browser-webm-ffmpeg',
    engineIds: Object.freeze(['browser-ffmpeg-wasm']),
  }),
  'browser-raster': Object.freeze({
    kind: 'browser-raster',
    engineIds: Object.freeze(['browser-raster-worker']),
  }),
  'browser-tiff-worker': Object.freeze({
    kind: 'browser-tiff-worker',
    engineIds: Object.freeze(['browser-tiff-png-worker']),
  }),
  'server-assisted-image': Object.freeze({
    kind: 'server-assisted-image',
    engineIds: Object.freeze(['browser-raster-with-server-image-decode']),
  }),
  'server-image': Object.freeze({
    kind: 'server-image',
    engineIds: Object.freeze(['server-image-convert']),
  }),
} satisfies Record<ConversionDispatchKind, ConversionDispatch>);

export function resolveConversionDispatch(
  from: string,
  to: string,
): ConversionDispatch {
  const fromExt = from.toLowerCase();
  const toExt = to.toLowerCase();
  if (fromExt === 'ai' || fromExt === 'pdf') {
    return dispatchByKind['browser-pdf-pages'];
  }
  if ((fromExt === 'tif' || fromExt === 'tiff') && toExt === 'png') {
    return dispatchByKind['browser-tiff-worker'];
  }
  if (SERVER_IMAGE_INPUTS.has(fromExt)) {
    return SERVER_IMAGE_OUTPUTS.has(toExt)
      ? dispatchByKind['server-image']
      : dispatchByKind['server-assisted-image'];
  }
  if (
    (fromExt === 'webm' && ['m4a', 'mp3', 'mp4'].includes(toExt)) ||
    (fromExt === 'mp4' && toExt === 'webm')
  ) {
    return dispatchByKind['browser-webm-ffmpeg'];
  }
  if (requiresVideoConversion(fromExt, toExt)) {
    return dispatchByKind['adaptive-video'];
  }
  return dispatchByKind['browser-raster'];
}
