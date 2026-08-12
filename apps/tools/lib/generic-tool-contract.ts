import {
  toolCatalog,
  type CatalogTool,
} from '@serp-tools/app-core/lib/tool-catalog';

import { resolveCompressionDispatch } from './compression-utils.ts';
import { BMP_CONVERSION_TOOL_IDS } from './convert/bmp-contract.ts';
import { resolveConversionCapability } from './convert/conversion-dispatch.ts';
import { selectToolRenderer } from './tool-renderer.ts';

const FORMAT_MIME_TYPES = Object.freeze({
  bmp: 'image/bmp',
  cr2: 'image/x-canon-cr2',
  heic: 'image/heic',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  webp: 'image/webp',
  webm: 'video/webm',
} satisfies Readonly<Record<string, string>>);

export const BROWSER_WEBM_TOOL_IDS = Object.freeze([
  'compress-webm',
  'webm-to-m4a',
  'webm-to-mp3',
  'webm-to-mp4',
] as const);
const BROWSER_WEBM_TOOL_ID_SET = new Set<string>(BROWSER_WEBM_TOOL_IDS);

const SEMANTIC_INPUT_FORMATS = new Set([
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
  'webm',
]);
const SEMANTIC_OUTPUT_FORMATS = new Set([
  'jpeg',
  'jpg',
  'm4a',
  'mp3',
  'mp4',
  'pdf',
  'png',
  'webp',
  'webm',
]);
const BMP_CONVERSION_TOOL_ID_SET = new Set<string>(BMP_CONVERSION_TOOL_IDS);
const CLOUDFLARE_UNSUPPORTED_CONVERSIONS = new Set([
  'm4a->mp3',
  'mp3->m4a',
  'mp4->m4a',
  'mp4->mp3',
]);
const CLOUDFLARE_UNSUPPORTED_COMPRESSIONS = new Set(['m4a', 'mp3', 'mp4']);

export type GenericToolContract =
  | Readonly<{
      state: 'supported';
      toolId: string;
      adapterId: 'generic-conversion' | 'generic-compression';
      operation: 'convert' | 'compress';
      input: Readonly<{ format: string; mimeType: string }>;
      output: Readonly<{ format: string; mimeType: string }>;
    }>
  | Readonly<{
      state: 'unsupported';
      toolId: string;
      reason: string;
    }>;

export function mimeTypeForGenericFormat(format: string): string | undefined {
  return FORMAT_MIME_TYPES[format as keyof typeof FORMAT_MIME_TYPES];
}

export function genericCompressionNeedsWorker(format: string): boolean {
  return resolveCompressionDispatch(format).target === 'image-worker';
}

function supportedContract(tool: CatalogTool): GenericToolContract | undefined {
  if (
    selectToolRenderer(tool) !== 'generic' ||
    !tool.from ||
    !tool.to ||
    (tool.operation !== 'convert' && tool.operation !== 'compress')
  ) {
    return undefined;
  }
  const from = tool.from.toLowerCase();
  const to = tool.to.toLowerCase();
  if (from === 'bmp' && !BMP_CONVERSION_TOOL_ID_SET.has(tool.id)) {
    return undefined;
  }
  const inputMimeType = mimeTypeForGenericFormat(from);
  const outputMimeType = mimeTypeForGenericFormat(to);
  if (!inputMimeType || !outputMimeType) return undefined;

  const exactConversion =
    resolveConversionCapability(from, to).supported &&
    SEMANTIC_INPUT_FORMATS.has(from) &&
    SEMANTIC_OUTPUT_FORMATS.has(to) &&
    ((from !== 'webm' && to !== 'webm') ||
      BROWSER_WEBM_TOOL_ID_SET.has(tool.id)) &&
    !CLOUDFLARE_UNSUPPORTED_CONVERSIONS.has(`${from}->${to}`);
  const compression = resolveCompressionDispatch(from);
  const exactCompression =
    tool.operation === 'compress' &&
    from === to &&
    compression.target !== 'unsupported' &&
    compression.target !== 'pdf' &&
    SEMANTIC_INPUT_FORMATS.has(from) &&
    SEMANTIC_OUTPUT_FORMATS.has(to) &&
    (from !== 'webm' || BROWSER_WEBM_TOOL_ID_SET.has(tool.id)) &&
    !CLOUDFLARE_UNSUPPORTED_COMPRESSIONS.has(from);
  if (tool.operation === 'convert' ? !exactConversion : !exactCompression) {
    return undefined;
  }

  return Object.freeze({
    state: 'supported',
    toolId: tool.id,
    adapterId:
      tool.operation === 'compress'
        ? 'generic-compression'
        : 'generic-conversion',
    operation: tool.operation,
    input: Object.freeze({ format: from, mimeType: inputMimeType }),
    output: Object.freeze({ format: to, mimeType: outputMimeType }),
  });
}

function unsupportedContract(toolId: string): GenericToolContract {
  return Object.freeze({
    state: 'unsupported',
    toolId,
    reason:
      'This published route has no exact generic processor and semantic verifier contract; it is unavailable instead of returning renamed fallback bytes.',
  });
}

const contractByToolId = new Map<string, GenericToolContract>(
  toolCatalog.activeTools
    .filter((tool) => selectToolRenderer(tool) === 'generic')
    .map((tool) => [
      tool.id,
      supportedContract(tool) ?? unsupportedContract(tool.id),
    ]),
);

export function getGenericToolContract(toolId: string): GenericToolContract {
  return contractByToolId.get(toolId) ?? unsupportedContract(toolId);
}
