import { requiresVideoConversion } from '../capabilities.ts';

export type ConversionOp = 'raster' | 'pdf-pages' | 'video';

export type ConversionDispatchKind =
  | 'adaptive-video'
  | 'browser-pdf-pages'
  | 'browser-raster'
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

export function resolveConversionOp(from: string, to: string): ConversionOp {
  const dispatch = resolveConversionDispatch(from, to);
  if (dispatch.kind === 'browser-pdf-pages') return 'pdf-pages';
  if (dispatch.kind === 'adaptive-video') {
    return 'video';
  }
  return 'raster';
}

const dispatchByKind = Object.freeze({
  'adaptive-video': Object.freeze({
    kind: 'adaptive-video',
    engineIds: Object.freeze([
      'browser-ffmpeg-wasm',
      'server-video-convert',
    ]),
  }),
  'browser-pdf-pages': Object.freeze({
    kind: 'browser-pdf-pages',
    engineIds: Object.freeze(['browser-pdf-pages']),
  }),
  'browser-raster': Object.freeze({
    kind: 'browser-raster',
    engineIds: Object.freeze(['browser-raster-worker']),
  }),
  'server-assisted-image': Object.freeze({
    kind: 'server-assisted-image',
    engineIds: Object.freeze([
      'browser-raster-with-server-image-decode',
    ]),
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
  if (SERVER_IMAGE_INPUTS.has(fromExt)) {
    return SERVER_IMAGE_OUTPUTS.has(toExt)
      ? dispatchByKind['server-image']
      : dispatchByKind['server-assisted-image'];
  }
  if (requiresVideoConversion(fromExt, toExt)) {
    return dispatchByKind['adaptive-video'];
  }
  return dispatchByKind['browser-raster'];
}
