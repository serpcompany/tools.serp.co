import { PDFDocument } from 'pdf-lib';
import { createFile, type MP4BoxBuffer, type Movie } from 'mp4box';
import { parseBuffer as parseMediaBuffer } from 'music-metadata';

import {
  createBrowserWorkflowTelemetry,
  deliverBrowserMedia,
  type BrowserDownloadPorts,
} from './browser-workflow-lifecycle.ts';
import { detectCapabilities } from './capabilities.ts';
import { compressFile, convertWithWorker } from './convert/workerClient.ts';
import {
  createToolWorkflow,
  type SemanticVerification,
  type ToolProcessor,
  type ToolWorkflow,
  type WorkflowMedia,
  type WorkflowOutcome,
  type WorkflowRunOptions,
} from './tool-workflow/index.ts';
import {
  decodedAllocationExceeds,
  verifyMediaSemantics,
} from './tool-workflow/semantic-validators.ts';
import { decodeToRGBA } from './convert/decode.ts';
import { inspectBmp, verifyBmpConversionSemantics } from './convert/bmp.ts';
import {
  genericCompressionNeedsWorker,
  getGenericToolContract,
  mimeTypeForGenericFormat,
  type GenericToolContract,
} from './generic-tool-contract.ts';
import { verifyHeifIdentity } from './convert/heif.ts';
import {
  convertTiffToPngWithWorker,
  inspectTiffHeader,
  verifyTiffDecodedOutput,
} from './convert/tiff.ts';
import { createServerActionRequestHeaders } from './server-action-client.ts';
import { executionProvenance } from './tool-execution-provenance.ts';
import {
  compressSvgWithWorker,
  SVG_COMPRESSION_LIMITS,
  verifySvgBytes,
} from './svg-compression.ts';
import { verifySvgRenderEquivalence } from './svg-render-verification.ts';

const MAX_INPUT_BYTES = 256 * 1_024 * 1_024;
const MAX_IDENTITY_PARSE_BYTES = 64 * 1_024 * 1_024;
const MAX_OUTPUT_BYTES = 512 * 1_024 * 1_024;
const MAX_TOTAL_OUTPUT_BYTES = 1_024 * 1_024 * 1_024;

export {
  BROWSER_WEBM_TOOL_IDS,
  genericCompressionNeedsWorker,
  getGenericToolContract,
  type GenericToolContract,
} from './generic-tool-contract.ts';

type GenericEngineContext = Readonly<{
  signal: AbortSignal;
  reportProgress(progress: number): void;
  registerWorker(worker: Worker): Promise<void>;
}>;

export type GenericWorkflowAdapters = Readonly<{
  decideSupport(
    request: Readonly<{
      operation: 'convert' | 'compress';
      inputFormat: string;
      outputFormat: string;
    }>,
  ): Readonly<{ supported: true } | { supported: false; message: string }>;
  convert(
    request: Readonly<{
      from: string;
      to: string;
      bytes: Uint8Array;
      quality: number;
      context: GenericEngineContext;
    }>,
  ): Promise<readonly Uint8Array[]>;
  compress(
    request: Readonly<{
      format: string;
      bytes: Uint8Array;
      quality: number;
      context: GenericEngineContext;
    }>,
  ): Promise<Uint8Array>;
  verify(
    media: WorkflowMedia,
    context: Readonly<{ signal: AbortSignal }>,
  ): Promise<SemanticVerification>;
  verifySvgEquivalence?(
    input: WorkflowMedia,
    output: WorkflowMedia,
    context: Readonly<{ signal: AbortSignal }>,
  ): Promise<SemanticVerification>;
  verifyTiffEquivalence?(
    output: WorkflowMedia,
    context: Readonly<{ signal: AbortSignal }>,
  ): Promise<SemanticVerification>;
  decodeRaster?(
    media: WorkflowMedia,
    context: Readonly<{ signal: AbortSignal }>,
  ): Promise<
    Readonly<{
      width: number;
      height: number;
      rgba: Uint8Array | Uint8ClampedArray;
    }>
  >;
  deliver(
    result: WorkflowMedia,
    context: Readonly<{ signal: AbortSignal }>,
  ): Promise<string>;
  telemetry: Readonly<{
    start(
      runId: string,
      request: Readonly<{ toolId: string; inputBytes: number }>,
    ): Promise<void>;
    terminal(runId: string, status: WorkflowOutcome['status']): Promise<void>;
  }>;
}>;

export async function verifyGenericMediaSemantics(
  media: WorkflowMedia,
  context: Readonly<{
    signal?: AbortSignal;
    requiredMediaTrack?: 'any' | 'audio' | 'video';
  }> = {},
) {
  context.signal?.throwIfAborted();
  const expectedMimeType = mimeTypeForGenericFormat(media.format);
  if (!expectedMimeType || media.mimeType !== expectedMimeType) {
    return {
      status: 'rejected' as const,
      message: `Expected ${expectedMimeType ?? 'a supported MIME'}, received ${media.mimeType}`,
    };
  }
  if (media.format === 'bmp') {
    const inspection = inspectBmp(media.bytes);
    return inspection.status === 'verified'
      ? {
          status: 'unavailable' as const,
          message:
            'BMP structure is valid; a browser pixel decoder is required',
        }
      : inspection;
  }
  if (media.format === 'm4a') {
    const verification = await verifyMediaSemantics(media);
    if (verification.status !== 'verified') return verification;
    const tracks = inspectBmffTrackFamilies(media.bytes);
    return tracks.audio > 0 && tracks.video === 0
      ? verification
      : {
          status: 'rejected' as const,
          message: 'M4A requires complete audio tracks and no video tracks',
        };
  }
  if (media.format === 'pdf') {
    try {
      await PDFDocument.load(media.bytes, {
        ignoreEncryption: false,
        parseSpeed: 0,
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      return { status: 'verified' as const };
    } catch {
      return {
        status: 'rejected' as const,
        message: 'PDF parser rejected the file',
      };
    }
  }
  if (media.format === 'svg') return verifySvgBytes(media.bytes);
  if (media.format === 'tif' || media.format === 'tiff') {
    try {
      inspectTiffHeader(media.bytes);
      return { status: 'verified' as const };
    } catch {
      return {
        status: 'rejected' as const,
        message: 'TIFF parser rejected the file identity',
      };
    }
  }
  if (media.format === 'webp' && !hasWebpIdentity(media.bytes)) {
    return {
      status: 'rejected' as const,
      message: 'WebP container identity is invalid',
    };
  }
  if (media.format === 'mp3') {
    const mp3Verification = await verifyMp3Identity(
      media.bytes,
      context.signal,
    );
    if (mp3Verification.status !== 'verified') return mp3Verification;
  }
  const verification = await verifyMediaSemantics(
    media.format === 'jpeg' ? { ...media, format: 'jpg' } : media,
    undefined,
    context,
  );
  if (media.format === 'mp4' && verification.status === 'verified') {
    const tracks = inspectBmffTrackFamilies(media.bytes);
    if (tracks.video === 0) {
      return {
        status: 'rejected' as const,
        message: 'MP4 video requires at least one complete video track',
      };
    }
  }
  if (
    verification.status === 'rejected' &&
    (verification.message === 'PNG decoder rejected the image data' ||
      verification.message === 'PNG decoder produced inconsistent image data' ||
      verification.message === 'JPEG decoder rejected the image data' ||
      verification.message ===
        'JPEG decoder produced inconsistent image data') &&
    (media.format === 'png' || hasJpegEnvelope(media)) &&
    typeof createImageBitmap === 'function'
  ) {
    try {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(media.bytes)], { type: media.mimeType }),
      );
      const valid = !decodedAllocationExceeds(bitmap.width, bitmap.height);
      bitmap.close();
      return valid ? { status: 'verified' as const } : verification;
    } catch {
      return verification;
    }
  }
  return verification;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function hasWebpIdentity(bytes: Uint8Array): boolean {
  if (
    bytes.byteLength < 20 ||
    ascii(bytes, 0, 4) !== 'RIFF' ||
    ascii(bytes, 8, 4) !== 'WEBP'
  )
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize !== bytes.byteLength - 8) return false;
  let offset = 12;
  let imageChunks = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 8) return false;
    const type = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const paddedSize = size + (size & 1);
    if (
      size > bytes.byteLength - offset - 8 ||
      paddedSize > bytes.byteLength - offset - 8
    ) {
      return false;
    }
    if (type === 'VP8 ' || type === 'VP8L' || type === 'VP8X') imageChunks += 1;
    offset += 8 + paddedSize;
  }
  return offset === bytes.byteLength && imageChunks > 0;
}

async function verifyMp3Identity(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<SemanticVerification> {
  signal?.throwIfAborted();
  try {
    const { format } = await parseMediaBuffer(
      bytes,
      { size: bytes.byteLength },
      { duration: true, skipCovers: true },
    );
    signal?.throwIfAborted();
    return format.container === 'MPEG' &&
      /(?:^|\s)Layer 3$/i.test(format.codec ?? '') &&
      format.hasAudio === true &&
      format.hasVideo !== true &&
      typeof format.duration === 'number' &&
      Number.isFinite(format.duration) &&
      format.duration > 0 &&
      typeof format.sampleRate === 'number' &&
      format.sampleRate > 0 &&
      typeof format.numberOfChannels === 'number' &&
      format.numberOfChannels > 0
      ? { status: 'verified' }
      : { status: 'rejected', message: 'Trusted parser found non-MP3 media' };
  } catch {
    signal?.throwIfAborted();
    return {
      status: 'rejected',
      message: 'Trusted MP3 parser rejected the file',
    };
  }
}

function hasJpegEnvelope(media: WorkflowMedia): boolean {
  return (
    (media.format === 'jpg' || media.format === 'jpeg') &&
    media.bytes.byteLength >= 4 &&
    media.bytes[0] === 0xff &&
    media.bytes[1] === 0xd8 &&
    media.bytes[media.bytes.byteLength - 2] === 0xff &&
    media.bytes[media.bytes.byteLength - 1] === 0xd9
  );
}

function inspectBmffTrackFamilies(bytes: Uint8Array): {
  audio: number;
  video: number;
} {
  const file = createFile();
  let info: Movie | undefined;
  file.onReady = (movie) => {
    info = movie;
  };
  const buffer = (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
      ? bytes.buffer
      : bytes.slice().buffer
  ) as MP4BoxBuffer;
  buffer.fileStart = 0;
  file.appendBuffer(buffer, true);
  file.flush();
  return {
    audio: info?.audioTracks.length ?? 0,
    video: info?.videoTracks.length ?? 0,
  };
}

type GenericOptions = Readonly<{ quality: number }>;

function parseOptions(options: unknown) {
  if (options === undefined)
    return { ok: true as const, value: { quality: 0.82 } };
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return { ok: false as const, message: 'Options must be an object' };
  }
  const keys = Object.keys(options);
  const quality = (options as { quality?: unknown }).quality;
  if (
    keys.some((key) => key !== 'quality') ||
    typeof quality !== 'number' ||
    !Number.isFinite(quality) ||
    quality < 0.1 ||
    quality > 0.95
  ) {
    return {
      ok: false as const,
      message: 'quality must be between 0.1 and 0.95',
    };
  }
  return { ok: true as const, value: { quality } };
}

function baseName(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '');
  return withoutExtension || 'result';
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function processorFor(
  contract: Extract<GenericToolContract, { state: 'supported' }>,
  adapters: GenericWorkflowAdapters,
): ToolProcessor<GenericOptions> | undefined {
  const provenance = executionProvenance.getByToolId(contract.toolId);
  const engine =
    provenance.kind === 'mapped'
      ? executionProvenance.getEngine(provenance.engineIds[0] ?? '')
      : undefined;
  if (!engine) return undefined;
  const multiplePages =
    contract.operation === 'convert' && contract.input.format === 'pdf';
  const bmpSourceByResult = new WeakMap<Uint8Array, Uint8Array>();
  const svgSourceByResult = new WeakMap<Uint8Array, WorkflowMedia>();

  return {
    engine,
    support: {
      acquisition: 'file',
      inputs: [
        {
          format: contract.input.format,
          mimeTypes: [contract.input.mimeType],
        },
      ],
      outputs: [contract.output],
      resourceLimits: {
        maxInputBytes:
          contract.input.format === 'svg'
            ? SVG_COMPRESSION_LIMITS.maxBytes
            : MAX_INPUT_BYTES,
        maxOutputBytes:
          contract.output.format === 'svg'
            ? SVG_COMPRESSION_LIMITS.maxBytes
            : MAX_OUTPUT_BYTES,
        maxTotalOutputBytes:
          contract.output.format === 'svg'
            ? SVG_COMPRESSION_LIMITS.maxBytes
            : MAX_TOTAL_OUTPUT_BYTES,
      },
      outputCardinality: { min: 1, max: multiplePages ? 100 : 1 },
    },
    parseOptions,
    decideSupport(request) {
      const exactContract =
        request.detectedInput.format === contract.input.format &&
        request.detectedInput.mimeType === contract.input.mimeType &&
        request.requestedOperation === contract.operation &&
        request.outputs.length === 1 &&
        request.outputs[0]?.format === contract.output.format &&
        request.outputs[0]?.mimeType === contract.output.mimeType;
      if (!exactContract) {
        return {
          supported: false,
          message: `Unsupported ${request.detectedInput.format} ${request.requestedOperation} request`,
        };
      }
      return adapters.decideSupport({
        operation: contract.operation,
        inputFormat: contract.input.format,
        outputFormat: contract.output.format,
      });
    },
    async verifyInput(input, context) {
      const verification = await verifyGenericMediaSemantics(input, {
        signal: context.signal,
        requiredMediaTrack:
          contract.input.format === 'webm'
            ? contract.output.format === 'm4a' ||
              contract.output.format === 'mp3'
              ? 'audio'
              : 'video'
            : contract.input.format === 'mp4' &&
                contract.output.format === 'webm'
              ? 'video'
              : undefined,
      });
      return verification.status === 'unavailable'
        ? adapters.verify(input, { signal: context.signal })
        : verification;
    },
    async process(input, options, context) {
      const engineContext: GenericEngineContext = {
        signal: context.signal,
        reportProgress: context.reportProgress,
        async registerWorker(worker) {
          await context.openResource('worker');
          await context.registerCleanup(async () => worker.terminate());
        },
      };
      const outputBytes =
        contract.operation === 'compress'
          ? [
              await adapters.compress({
                format: contract.input.format,
                bytes: input.bytes,
                quality: options.quality,
                context: engineContext,
              }),
            ]
          : await adapters.convert({
              from: contract.input.format,
              to: contract.output.format,
              bytes: input.bytes,
              quality: options.quality,
              context: engineContext,
            });
      if (
        contract.operation === 'compress' &&
        contract.input.format === 'mp4' &&
        inspectBmffTrackFamilies(input.bytes).audio > 0 &&
        outputBytes.some((bytes) => inspectBmffTrackFamilies(bytes).audio === 0)
      ) {
        throw new Error('MP4 compression discarded the input audio track');
      }
      const stem = baseName(input.name);
      const results = outputBytes.map((bytes, index) => ({
        name:
          contract.operation === 'compress'
            ? contract.input.format === 'svg' && bytesEqual(bytes, input.bytes)
              ? `${stem}_unchanged.${contract.output.format}`
              : `${stem}_compressed.${contract.output.format}`
            : outputBytes.length > 1
              ? `${stem}_page${index + 1}.${contract.output.format}`
              : `${stem}.${contract.output.format}`,
        format: contract.output.format,
        mimeType: contract.output.mimeType,
        bytes,
      }));
      if (contract.input.format === 'bmp') {
        for (const result of results)
          bmpSourceByResult.set(result.bytes, input.bytes);
      }
      if (contract.input.format === 'svg') {
        for (const result of results)
          svgSourceByResult.set(result.bytes, input);
      }
      return results;
    },
    async verifyResult(result, context) {
      const verification = await verifyGenericMediaSemantics(result, {
        signal: context.signal,
        requiredMediaTrack:
          contract.output.format === 'webm' ? 'video' : undefined,
      });
      const formatVerification =
        verification.status === 'unavailable'
          ? await adapters.verify(result, { signal: context.signal })
          : verification;
      if (formatVerification.status !== 'verified') return formatVerification;
      const svgSource = svgSourceByResult.get(result.bytes);
      if (svgSource) {
        return adapters.verifySvgEquivalence
          ? adapters.verifySvgEquivalence(svgSource, result, {
              signal: context.signal,
            })
          : {
              status: 'rejected',
              message: 'SVG render-equivalence verifier is unavailable',
            };
      }
      if (contract.input.format === 'tif' || contract.input.format === 'tiff') {
        return adapters.verifyTiffEquivalence
          ? adapters.verifyTiffEquivalence(result, { signal: context.signal })
          : {
              status: 'rejected',
              message: 'TIFF pixel-equivalence verifier is unavailable',
            };
      }
      const bmpSource = bmpSourceByResult.get(result.bytes);
      if (!bmpSource) return formatVerification;
      return verifyBmpConversionSemantics({
        input: bmpSource,
        output: { format: result.format, bytes: result.bytes },
        signal: context.signal,
        decode: adapters.decodeRaster
          ? async (_bytes, signal) => {
              const decoded = await adapters.decodeRaster!(result, {
                signal: signal ?? context.signal,
              });
              return decoded;
            }
          : undefined,
      });
    },
  };
}

export function createGenericToolWorkflow(
  adapters: GenericWorkflowAdapters,
): ToolWorkflow {
  let nextSequence = 0;
  return createToolWorkflow({
    acquisition: {
      file: {
        async acquire(input, context) {
          context.signal.throwIfAborted();
          context.reportProgress(1);
          return input.media;
        },
      },
      url: {
        async acquire() {
          throw new Error('Generic conversion requires a file');
        },
      },
    },
    resolveIntent(toolId) {
      const contract = getGenericToolContract(toolId);
      return contract.state === 'supported'
        ? {
            requestedOperation: contract.operation,
            outputs: [contract.output],
          }
        : undefined;
    },
    resolveProcessor(toolId) {
      const contract = getGenericToolContract(toolId);
      return contract.state === 'supported'
        ? processorFor(contract, adapters)
        : undefined;
    },
    async deliver(result, context) {
      context.signal.throwIfAborted();
      await context.openResource('blob');
      return adapters.deliver(result, { signal: context.signal });
    },
    runtime: {
      async open() {
        return { async release() {} };
      },
    },
    telemetry: {
      async start(runId, request) {
        const bytes =
          request.input.kind === 'file'
            ? request.input.media.bytes.byteLength
            : 0;
        await adapters.telemetry.start(runId, {
          toolId: request.toolId,
          inputBytes: bytes,
        });
      },
      async terminal(runId, status) {
        await adapters.telemetry.terminal(runId, status);
      },
    },
    clock: { now: () => Date.now() },
    nextId(kind) {
      nextSequence += 1;
      return `${kind}-${nextSequence}`;
    },
  });
}

export { deliverBrowserMedia };
export type BrowserDeliveryPorts = BrowserDownloadPorts;

const browserTiffIdentityByOutput = new WeakMap<
  Uint8Array,
  Readonly<{ width: number; height: number; sourceRgbaSha256: string }>
>();

const browserAdapters: GenericWorkflowAdapters = {
  decideSupport(request) {
    return decideGenericBrowserSupport(
      request,
      detectCapabilities().supportsVideoConversion,
      supportsBmpRasterRuntime(),
    );
  },
  async convert({ from, to, bytes, quality, context }) {
    context.signal.throwIfAborted();
    if ((from === 'tif' || from === 'tiff') && to === 'png') {
      const worker = new Worker(
        new URL('../workers/tiff-to-png.worker.js', import.meta.url),
        { type: 'module' },
      );
      await context.registerWorker(worker);
      const result = await convertTiffToPngWithWorker({
        worker,
        bytes,
        signal: context.signal,
      });
      browserTiffIdentityByOutput.set(result.png, {
        width: result.width,
        height: result.height,
        sourceRgbaSha256: result.sourceRgbaSha256,
      });
      context.reportProgress(1);
      return [result.png];
    }
    const worker = new Worker(
      new URL('../workers/convert.worker.js', import.meta.url),
      { type: 'module' },
    );
    await context.registerWorker(worker);
    const result = await convertWithWorker({
      worker,
      from,
      to,
      buf: Uint8Array.from(bytes).buffer,
      quality,
      onProgress: ({ progress }) =>
        context.reportProgress((progress ?? 0) / 100),
      signal: context.signal,
    });
    return (result.kind === 'multiple' ? result.buffers : [result.buffer]).map(
      (buffer) => new Uint8Array(buffer),
    );
  },
  async compress({ format, bytes, quality, context }) {
    context.signal.throwIfAborted();
    if (format === 'svg') {
      const worker = new Worker(
        new URL('../workers/svg-compress.worker.js', import.meta.url),
        { type: 'module' },
      );
      await context.registerWorker(worker);
      return compressSvgWithWorker({
        worker,
        bytes,
        signal: context.signal,
      });
    }
    let worker: Worker | undefined;
    if (genericCompressionNeedsWorker(format)) {
      worker = new Worker(
        new URL('../workers/compress.worker.js', import.meta.url),
        { type: 'module' },
      );
      await context.registerWorker(worker);
    }
    const result = await compressFile({
      worker,
      format,
      buf: Uint8Array.from(bytes).buffer,
      quality,
      onProgress: ({ progress }) =>
        context.reportProgress((progress ?? 0) / 100),
      signal: context.signal,
    });
    return new Uint8Array(result);
  },
  async verify(media, { signal }) {
    signal.throwIfAborted();
    if (media.format === 'cr2') {
      const response = await fetch('/api/image-convert?from=cr2&to=png', {
        method: 'POST',
        headers: createServerActionRequestHeaders({
          'Content-Type': 'application/octet-stream',
        }),
        body: Uint8Array.from(media.bytes),
        signal,
      });
      if (!response.ok) {
        return { status: 'rejected', message: 'CR2 decoder rejected the file' };
      }
      const decoded = new Uint8Array(await response.arrayBuffer());
      return verifyMediaSemantics({
        name: `${media.name}.png`,
        format: 'png',
        mimeType: 'image/png',
        bytes: decoded,
      });
    }
    if (['bmp', 'heic', 'webp'].includes(media.format)) {
      try {
        const decoded = await decodeToRGBA(
          media.format,
          Uint8Array.from(media.bytes).buffer,
          signal,
        );
        signal.throwIfAborted();
        const expectedBytes = decoded.width * decoded.height * 4;
        return decodedAllocationExceeds(decoded.width, decoded.height) ||
          decoded.data.byteLength !== expectedBytes
          ? {
              status: 'rejected',
              message: 'Decoded image is inconsistent or exceeds safety limits',
            }
          : { status: 'verified' };
      } catch {
        signal.throwIfAborted();
        return {
          status: 'rejected',
          message: 'Image decoder rejected the file',
        };
      }
    }
    if (media.format === 'mp3') {
      const AudioContextConstructor = globalThis.AudioContext;
      if (!AudioContextConstructor) {
        return {
          status: 'unavailable',
          message: 'Audio decoder is unavailable',
        };
      }
      const context = new AudioContextConstructor();
      let closePromise: Promise<void> | undefined;
      const closeContext = () => (closePromise ??= context.close());
      const onAbort = () => {
        void closeContext();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        let rejectAbort: ((reason: unknown) => void) | undefined;
        const aborted = new Promise<never>((_resolve, reject) => {
          rejectAbort = reject;
        });
        const rejectOnAbort = () =>
          rejectAbort?.(
            signal.reason ??
              new DOMException('The operation was aborted', 'AbortError'),
          );
        signal.addEventListener('abort', rejectOnAbort, { once: true });
        let decoded;
        try {
          decoded = await Promise.race([
            context.decodeAudioData(Uint8Array.from(media.bytes).buffer),
            aborted,
          ]);
        } finally {
          signal.removeEventListener('abort', rejectOnAbort);
        }
        signal.throwIfAborted();
        const samples = decoded.length * decoded.numberOfChannels;
        return decoded.duration > 0 &&
          Number.isSafeInteger(samples) &&
          samples <= (64 * 1_024 * 1_024) / 4
          ? { status: 'verified' }
          : {
              status: 'rejected',
              message: 'Decoded audio exceeds safety limits',
            };
      } catch {
        signal.throwIfAborted();
        return {
          status: 'rejected',
          message: 'Audio decoder rejected the file',
        };
      } finally {
        signal.removeEventListener('abort', onAbort);
        await closeContext();
      }
    }
    return {
      status: 'unavailable',
      message: `No semantic verifier for ${media.format}`,
    };
  },
  async verifySvgEquivalence(input, output, { signal }) {
    return verifySvgRenderEquivalence({
      input: input.bytes,
      output: output.bytes,
      signal,
    });
  },
  async verifyTiffEquivalence(output, { signal }) {
    const expected = browserTiffIdentityByOutput.get(output.bytes);
    if (!expected) {
      return {
        status: 'rejected',
        message: 'TIFF source pixel identity is unavailable',
      };
    }
    try {
      const decoded = await decodeToRGBA(
        'png',
        Uint8Array.from(output.bytes).buffer,
        signal,
      );
      await verifyTiffDecodedOutput({
        expected,
        actual: {
          width: decoded.width,
          height: decoded.height,
          rgba: decoded.data,
        },
      });
      return { status: 'verified' };
    } catch {
      signal.throwIfAborted();
      return {
        status: 'rejected',
        message: 'Delivered PNG does not preserve the TIFF source pixels',
      };
    }
  },
  async decodeRaster(media, { signal }) {
    const decoded = await decodeToRGBA(
      media.format,
      Uint8Array.from(media.bytes).buffer,
      signal,
    );
    return { width: decoded.width, height: decoded.height, rgba: decoded.data };
  },
  deliver: (result, { signal }) =>
    deliverBrowserMedia(result, undefined, signal),
  telemetry: createBrowserWorkflowTelemetry(
    (request) => {
      const contract = getGenericToolContract(request.toolId);
      return {
        toolId: request.toolId,
        inputBytes: request.inputBytes,
        from:
          contract.state === 'supported' ? contract.input.format : undefined,
        to: contract.state === 'supported' ? contract.output.format : undefined,
      };
    },
    (status) => status,
  ),
};

export function decideGenericBrowserSupport(
  request: Readonly<{
    operation: 'convert' | 'compress';
    inputFormat: string;
    outputFormat: string;
  }>,
  supportsBrowserMedia: boolean,
  supportsBmpRaster = true,
) {
  if (request.inputFormat === 'bmp' && !supportsBmpRaster) {
    return {
      supported: false as const,
      message: 'BMP conversion is not available in this browser.',
    };
  }
  const mediaFormats = ['m4a', 'mp3', 'mp4'];
  const needsMediaRuntime =
    mediaFormats.includes(request.inputFormat) ||
    mediaFormats.includes(request.outputFormat);
  if (needsMediaRuntime && !supportsBrowserMedia) {
    return {
      supported: false as const,
      message: 'Media processing is not available in this browser.',
    };
  }
  return { supported: true as const };
}

function supportsBmpRasterRuntime(): boolean {
  const hasDecoder =
    typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder ===
      'function' || typeof createImageBitmap === 'function';
  const hasCanvas =
    typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined';
  return hasDecoder && hasCanvas;
}

export const genericToolWorkflow = createGenericToolWorkflow(browserAdapters);

export async function runGenericToolFile(
  toolId: string,
  file: File,
  options?: WorkflowRunOptions,
) {
  const contract = getGenericToolContract(toolId);
  if (contract.state === 'unsupported') {
    return genericToolWorkflow.run(
      {
        toolId,
        input: {
          kind: 'file',
          media: {
            name: file.name,
            format: 'unsupported',
            mimeType: file.type || 'application/octet-stream',
            bytes: new Uint8Array(),
          },
        },
      },
      options,
    );
  }
  if (options?.signal?.aborted) return cancelledFileOutcome();
  const maxInputBytes =
    contract.input.format === 'svg'
      ? SVG_COMPRESSION_LIMITS.maxBytes
      : MAX_INPUT_BYTES;
  if (file.size > maxInputBytes) {
    return failedFileOutcome(
      'invalid-request',
      `Input exceeds ${maxInputBytes} bytes`,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readFileWithSignal(file, options?.signal, maxInputBytes);
  } catch (error) {
    if (options?.signal?.aborted || isAbortError(error)) {
      return cancelledFileOutcome();
    }
    return failedFileOutcome('acquisition-failed', 'File acquisition failed');
  }
  let mimeType: string;
  try {
    mimeType = await resolveFileMimeType(file.type, bytes, options?.signal);
  } catch (error) {
    if (options?.signal?.aborted || isAbortError(error)) {
      return cancelledFileOutcome();
    }
    return failedFileOutcome(
      'acquisition-failed',
      'File identity detection failed',
    );
  }
  if (contract.input.format === 'bmp' && mimeType === 'image/bmp') {
    try {
      await decodeToRGBA('bmp', Uint8Array.from(bytes).buffer, options?.signal);
    } catch (error) {
      if (options?.signal?.aborted || isAbortError(error)) {
        return cancelledFileOutcome();
      }
      return failedFileOutcome(
        'unsupported-request',
        'BMP conversion is not available in this browser.',
      );
    }
  }
  return genericToolWorkflow.run(
    {
      toolId,
      input: {
        kind: 'file',
        media: {
          name: file.name,
          format: contract.input.format,
          mimeType,
          bytes,
        },
      },
    },
    options,
  );
}

const SAFE_MIME_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'audio/mp3': 'audio/mpeg',
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
});

function bmffBrands(bytes: Uint8Array): readonly string[] | undefined {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 4) !== 'ftyp') return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxSize = view.getUint32(0, false);
  if (boxSize < 16 || boxSize > bytes.byteLength || boxSize > 4_096) {
    return undefined;
  }
  const brands = [ascii(bytes, 8, 4)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    brands.push(ascii(bytes, offset, 4));
  }
  return brands;
}

export async function detectGenericMediaMimeType(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (inspectBmp(bytes).status === 'verified') return 'image/bmp';
  if (ascii(bytes, 0, 8) === '\u0089PNG\r\n\u001a\n') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (hasWebpIdentity(bytes)) return 'image/webp';
  if (ascii(bytes, 0, 4) === '%PDF') return 'application/pdf';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE')
    return 'audio/wav';
  const looksLikeMp3 =
    ascii(bytes, 0, 3) === 'ID3' ||
    bytes
      .subarray(0, 4_096)
      .some(
        (byte, index, prefix) =>
          byte === 0xff && (prefix[index + 1] ?? 0) >> 5 === 0x7,
      );
  if (
    looksLikeMp3 &&
    (await verifyMp3Identity(bytes, signal)).status === 'verified'
  )
    return 'audio/mpeg';
  const brands = bmffBrands(bytes);
  const heicBrands = new Set([
    'heic',
    'heix',
    'hevc',
    'hevx',
    'heim',
    'heis',
    'hevm',
    'hevs',
  ]);
  if (
    bytes.byteLength <= MAX_IDENTITY_PARSE_BYTES &&
    brands?.some((brand) => heicBrands.has(brand)) &&
    (await verifyHeifIdentity(
      bytes.byteOffset === 0 &&
        bytes.byteLength === bytes.buffer.byteLength &&
        bytes.buffer instanceof ArrayBuffer
        ? bytes.buffer
        : bytes.slice().buffer,
      signal,
    ))
  ) {
    return 'image/heic';
  }
  if (brands && bytes.byteLength <= MAX_IDENTITY_PARSE_BYTES) {
    const tracks = inspectBmffTrackFamilies(bytes);
    const candidate =
      tracks.video > 0
        ? { format: 'mp4', mimeType: 'video/mp4' }
        : tracks.audio > 0
          ? { format: 'm4a', mimeType: 'audio/mp4' }
          : undefined;
    if (!candidate) return undefined;
    const verification = await verifyMediaSemantics(
      {
        name: `detected.${candidate.format}`,
        format: candidate.format,
        mimeType: candidate.mimeType,
        bytes,
      },
      undefined,
      { maxBytes: MAX_IDENTITY_PARSE_BYTES, signal },
    );
    if (verification.status === 'verified') {
      if (tracks.video > 0) return 'video/mp4';
      if (tracks.audio > 0) return 'audio/mp4';
    }
  }
  return undefined;
}

async function resolveFileMimeType(
  declared: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<string> {
  const normalized =
    SAFE_MIME_ALIASES[declared.toLowerCase()] ?? declared.toLowerCase();
  if (!normalized || normalized === 'application/octet-stream') {
    return (
      (await detectGenericMediaMimeType(bytes, signal)) ??
      'application/octet-stream'
    );
  }
  return normalized;
}

export function getGenericAccept(from: string): string {
  if (from === 'jpg' || from === 'jpeg') return '.jpg,.jpeg';
  if (from === 'tif' || from === 'tiff') return '.tif,.tiff';
  return `.${from}`;
}

let fileBoundarySequence = 0;

function fileBoundaryRunId(): string {
  fileBoundarySequence += 1;
  return `generic-file-${fileBoundarySequence}`;
}

function cancelledFileOutcome(): WorkflowOutcome {
  return {
    status: 'cancelled',
    runId: fileBoundaryRunId(),
    telemetry: { start: 'not-attempted', terminal: 'not-attempted' },
  };
}

function failedFileOutcome(
  code: 'invalid-request' | 'acquisition-failed' | 'unsupported-request',
  message: string,
): WorkflowOutcome {
  return {
    status: 'failed',
    runId: fileBoundaryRunId(),
    error: { code, message },
    telemetry: { start: 'not-attempted', terminal: 'not-attempted' },
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function readFileWithSignal(
  file: File,
  signal?: AbortSignal,
  maxBytes = MAX_INPUT_BYTES,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    void reader.cancel(signal?.reason).catch(() => {});
    rejectAbort?.(
      signal?.reason ??
        new DOMException('The operation was aborted', 'AbortError'),
    );
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      signal?.throwIfAborted();
      total += part.value.byteLength;
      if (total > maxBytes || total > file.size) {
        throw new Error('File stream exceeded its declared size');
      }
      chunks.push(part.value);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
