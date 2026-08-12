import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';

import { executionProvenance } from './tool-execution-provenance.ts';
import {
  createToolWorkflow,
  defineToolSupport,
  type SemanticVerification,
  type ToolProcessor,
  type ToolWorkflow,
  type WorkflowMedia,
  type WorkflowOutcome,
  type WorkflowRequest,
} from './tool-workflow/index.ts';
import { verifyMediaSemantics } from './tool-workflow/semantic-validators.ts';
export {
  getBatchToolContract,
  type BatchToolContract,
} from './batch-tool-contract.ts';

const TOOL_ID = 'batch-compress-png';
const ARCHIVE_NAME = 'compressed_pngs.zip';

export const BATCH_PNG_LIMITS = Object.freeze({
  maxItems: 100,
  maxItemBytes: 16 * 1_024 * 1_024,
  maxInputBytes: 48 * 1_024 * 1_024,
  maxArchiveBytes: 80 * 1_024 * 1_024,
});

/**
 * Bounds bytes returned by the compression port before semantic parsing. This
 * is an internal transient-allocation limit, not accepted input or delivered
 * output support; those public contracts remain BATCH_PNG_LIMITS.
 */
export const BATCH_PNG_IMPLEMENTATION_LIMITS = Object.freeze({
  maxCompressionCandidateBytes: 32 * 1_024 * 1_024,
});

type BatchOptions = Readonly<{
  compressionLevel: 'low' | 'medium' | 'high' | 'extreme';
  /** A failed item fails the run; completed prefixes are never delivered. */
  partialSuccess: 'fail-fast';
}>;

export type BatchCompressionPort = (
  request: Readonly<{
    name: string;
    bytes: Uint8Array;
    quality: number;
    signal: AbortSignal;
    reportProgress(progress: number): void;
    registerCleanup(cleanup: () => Promise<void>): Promise<void>;
  }>,
) => Promise<Uint8Array>;

export type BatchWorkflowPorts = Readonly<{
  compress: BatchCompressionPort;
  deliver(media: WorkflowMedia): Promise<string>;
  telemetry: Readonly<{
    start(runId: string, request: WorkflowRequest, at: number): Promise<void>;
    terminal(
      runId: string,
      status: WorkflowOutcome['status'],
      at: number,
    ): Promise<void>;
  }>;
  nextId(kind: 'run' | 'delivery'): string;
  clock?: Readonly<{ now(): number }>;
}>;

function parseOptions(value: unknown) {
  if (value === undefined) {
    return {
      ok: true as const,
      value: Object.freeze({
        compressionLevel: 'high' as const,
        partialSuccess: 'fail-fast' as const,
      }),
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false as const, message: 'Batch options must be an object' };
  }
  const options = value as Record<string, unknown>;
  const keys = Object.keys(options);
  if (
    keys.some((key) => !['compressionLevel', 'partialSuccess'].includes(key)) ||
    !['low', 'medium', 'high', 'extreme'].includes(
      String(options.compressionLevel),
    ) ||
    options.partialSuccess !== 'fail-fast'
  ) {
    return {
      ok: false as const,
      message:
        'Batch compression requires a known level and partialSuccess="fail-fast"',
    };
  }
  return {
    ok: true as const,
    value: Object.freeze({
      compressionLevel:
        options.compressionLevel as BatchOptions['compressionLevel'],
      partialSuccess: 'fail-fast' as const,
    }),
  };
}

function qualityFor(level: BatchOptions['compressionLevel']): number {
  return { low: 0.85, medium: 0.7, high: 0.5, extreme: 0.3 }[level];
}

function outputName(inputName: string): string {
  const basename = inputName.split(/[\\/]/).at(-1) ?? '';
  if (!/\.png$/i.test(basename)) {
    throw new TypeError(`${inputName} must have a PNG filename`);
  }
  return basename.replace(/\.png$/i, '_compressed.png');
}

async function inspectArchive(
  bytes: Uint8Array,
  expectedNames?: readonly string[],
): Promise<SemanticVerification> {
  const reader = new ZipReader(new Uint8ArrayReader(bytes), {
    checkSignature: true,
    useWebWorkers: false,
  });
  try {
    const entries = await reader.getEntries();
    if (entries.length < 1 || entries.length > BATCH_PNG_LIMITS.maxItems) {
      return {
        status: 'rejected',
        message: 'Archive entry cardinality is outside the batch contract',
      };
    }
    const names = entries.map((entry) => entry.filename);
    if (
      expectedNames &&
      (names.length !== expectedNames.length ||
        names.some((name, index) => name !== expectedNames[index]))
    ) {
      return {
        status: 'rejected',
        message: 'Archive entry order or names do not match the input batch',
      };
    }
    if (
      new Set(names).size !== names.length ||
      names.some(
        (name) =>
          name.includes('/') ||
          name.includes('\\') ||
          !/_compressed\.png$/.test(name),
      )
    ) {
      return {
        status: 'rejected',
        message: 'Archive entry names are unsafe or duplicated',
      };
    }
    let totalBytes = 0;
    for (const entry of entries) {
      if (!('getData' in entry) || entry.directory) {
        return {
          status: 'rejected',
          message: 'Archive contains a non-file entry',
        };
      }
      const entryBytes = await entry.getData(new Uint8ArrayWriter());
      totalBytes += entryBytes.byteLength;
      if (
        entryBytes.byteLength > BATCH_PNG_LIMITS.maxItemBytes ||
        totalBytes > BATCH_PNG_LIMITS.maxInputBytes
      ) {
        return {
          status: 'rejected',
          message: 'Archive contents exceed batch resource limits',
        };
      }
      const verification = await verifyMediaSemantics({
        name: entry.filename,
        format: 'png',
        mimeType: 'image/png',
        bytes: entryBytes,
      });
      if (verification.status !== 'verified') return verification;
    }
    return { status: 'verified' };
  } catch (error) {
    return {
      status: 'rejected',
      message:
        error instanceof Error
          ? `Invalid ZIP archive: ${error.message}`
          : 'Invalid ZIP archive',
    };
  } finally {
    await reader.close();
  }
}

function processor(
  ports: BatchWorkflowPorts,
): ToolProcessor<BatchOptions, readonly WorkflowMedia[]> {
  const engine = executionProvenance.getEngine('browser-batch-png-compression');
  if (!engine) throw new TypeError('Missing batch PNG execution engine');
  return {
    engine,
    support: defineToolSupport({
      acquisition: 'batch',
      inputs: [{ format: 'png', mimeTypes: ['image/png'] }],
      outputs: [{ format: 'zip', mimeType: 'application/zip' }],
      resourceLimits: {
        maxInputBytes: BATCH_PNG_LIMITS.maxInputBytes,
        maxOutputBytes: BATCH_PNG_LIMITS.maxArchiveBytes,
        maxTotalOutputBytes: BATCH_PNG_LIMITS.maxArchiveBytes,
      },
      outputCardinality: { min: 1, max: 1 },
    }),
    parseOptions,
    decideSupport(request) {
      return request.detectedInput.acquisition === 'batch' &&
        request.requestedOperation === 'bulk' &&
        request.outputs.length === 1 &&
        request.outputs[0]?.format === 'zip'
        ? { supported: true }
        : {
            supported: false,
            message: 'Unsupported batch PNG operation contract',
          };
    },
    async verifyInput(input, context) {
      if (input.length < 1 || input.length > BATCH_PNG_LIMITS.maxItems) {
        return {
          status: 'rejected',
          message: `Batch requires 1..${BATCH_PNG_LIMITS.maxItems} files`,
        };
      }
      const names: string[] = [];
      for (const media of input) {
        context.signal.throwIfAborted();
        if (media.bytes.byteLength > BATCH_PNG_LIMITS.maxItemBytes) {
          return {
            status: 'rejected',
            message: `${media.name} exceeds the per-item byte limit`,
          };
        }
        try {
          names.push(outputName(media.name));
        } catch (error) {
          return {
            status: 'rejected',
            message: error instanceof Error ? error.message : String(error),
          };
        }
        const verification = await verifyMediaSemantics(media, undefined, {
          maxBytes: BATCH_PNG_LIMITS.maxItemBytes,
          signal: context.signal,
        });
        if (verification.status !== 'verified') return verification;
      }
      return new Set(names).size === names.length
        ? { status: 'verified' }
        : {
            status: 'rejected',
            message: 'Batch output filenames must be unique',
          };
    },
    async process(input, options, context) {
      const names = input.map(({ name }) => outputName(name));
      const compressed: Uint8Array[] = [];
      let retainedBytes = 0;
      for (let index = 0; index < input.length; index += 1) {
        context.signal.throwIfAborted();
        const media = input[index]!;
        context.reportProgress(index / input.length, {
          index,
          total: input.length,
          name: media.name,
        });
        const bytes = await ports.compress({
          name: media.name,
          bytes: media.bytes,
          quality: qualityFor(options.compressionLevel),
          signal: context.signal,
          registerCleanup: context.registerCleanup,
          reportProgress(progress) {
            const normalized = Math.min(1, Math.max(0, progress));
            context.reportProgress((index + normalized) / input.length, {
              index,
              total: input.length,
              name: media.name,
              progress: normalized,
            });
          },
        });
        context.signal.throwIfAborted();
        if (
          bytes.byteLength >
          BATCH_PNG_IMPLEMENTATION_LIMITS.maxCompressionCandidateBytes
        ) {
          throw new Error(
            'Intermediate compressor candidate exceeds the implementation byte limit',
          );
        }
        const candidateVerification = await verifyMediaSemantics(
          {
            name: names[index]!,
            format: 'png',
            mimeType: 'image/png',
            bytes,
          },
          undefined,
          { signal: context.signal },
        );
        if (candidateVerification.status !== 'verified')
          throw new Error(candidateVerification.message);
        const retained =
          bytes.byteLength < media.bytes.byteLength ? bytes : media.bytes;
        retainedBytes += retained.byteLength;
        if (
          retained.byteLength > BATCH_PNG_LIMITS.maxItemBytes ||
          retainedBytes > BATCH_PNG_LIMITS.maxInputBytes
        ) {
          throw new Error('Compressed batch exceeds the retained-byte limit');
        }
        const retainedVerification = await verifyMediaSemantics(
          {
            name: names[index]!,
            format: 'png',
            mimeType: 'image/png',
            bytes: retained,
          },
          undefined,
          { maxBytes: BATCH_PNG_LIMITS.maxItemBytes, signal: context.signal },
        );
        if (retainedVerification.status !== 'verified')
          throw new Error(retainedVerification.message);
        compressed.push(retained);
      }

      const writer = new Uint8ArrayWriter();
      const archive = new ZipWriter(writer);
      try {
        for (let index = 0; index < compressed.length; index += 1) {
          context.signal.throwIfAborted();
          await archive.add(
            names[index]!,
            new Uint8ArrayReader(compressed[index]!),
            {
              level: 0,
              useWebWorkers: false,
            },
          );
        }
        await archive.close();
      } catch (error) {
        await archive.close().catch(() => {});
        throw error;
      }
      const archiveBytes = await writer.getData();
      if (archiveBytes.byteLength > BATCH_PNG_LIMITS.maxArchiveBytes) {
        throw new Error('ZIP archive exceeds the batch output byte limit');
      }
      const verification = await inspectArchive(archiveBytes, names);
      if (verification.status !== 'verified')
        throw new Error(verification.message);
      return [
        {
          name: ARCHIVE_NAME,
          format: 'zip',
          mimeType: 'application/zip',
          bytes: archiveBytes,
        },
      ];
    },
    async verifyResult(result, context) {
      context.signal.throwIfAborted();
      if (result.name !== ARCHIVE_NAME) {
        return {
          status: 'rejected',
          message: 'Batch archive name does not match the delivery contract',
        };
      }
      return inspectArchive(result.bytes);
    },
  };
}

export function createBatchToolWorkflow(
  ports: BatchWorkflowPorts,
): ToolWorkflow {
  const batchProcessor = processor(ports);
  return createToolWorkflow({
    acquisition: {
      file: {
        async acquire() {
          throw new TypeError('Batch Tools require files');
        },
      },
      url: {
        async acquire() {
          throw new TypeError('Batch Tools do not accept URLs');
        },
      },
      batch: {
        async acquire(input, context) {
          if (
            input.items.length < 1 ||
            input.items.length > BATCH_PNG_LIMITS.maxItems
          ) {
            throw new TypeError(
              `Batch requires 1..${BATCH_PNG_LIMITS.maxItems} files`,
            );
          }
          const declaredBytes = input.items.reduce((total, item) => {
            if (
              !Number.isSafeInteger(item.size) ||
              item.size < 1 ||
              item.size > BATCH_PNG_LIMITS.maxItemBytes ||
              item.format !== 'png' ||
              item.mimeType !== 'image/png'
            ) {
              throw new TypeError(`Unsupported batch item: ${item.name}`);
            }
            outputName(item.name);
            return total + item.size;
          }, 0);
          if (declaredBytes > BATCH_PNG_LIMITS.maxInputBytes) {
            throw new TypeError('Batch exceeds the aggregate input byte limit');
          }

          const media: WorkflowMedia[] = [];
          let actualTotalBytes = 0;
          for (let index = 0; index < input.items.length; index += 1) {
            context.signal.throwIfAborted();
            const item = input.items[index]!;
            const reader = item.stream().getReader();
            const chunks: Uint8Array[] = [];
            let itemBytes = 0;
            let complete = false;
            const cancelReader = () => {
              void reader.cancel(context.signal.reason).catch(() => {});
            };
            context.signal.addEventListener('abort', cancelReader, {
              once: true,
            });
            try {
              while (true) {
                const next = await reader.read();
                if (next.done) {
                  complete = true;
                  break;
                }
                itemBytes += next.value.byteLength;
                actualTotalBytes += next.value.byteLength;
                if (
                  itemBytes > BATCH_PNG_LIMITS.maxItemBytes ||
                  actualTotalBytes > BATCH_PNG_LIMITS.maxInputBytes
                ) {
                  throw new TypeError('Batch stream exceeds its byte contract');
                }
                chunks.push(next.value);
                const itemProgress = Math.min(1, itemBytes / item.size);
                context.reportProgress(
                  (index + itemProgress) / input.items.length,
                  {
                    index,
                    total: input.items.length,
                    name: item.name,
                    progress: itemProgress,
                  },
                );
                context.signal.throwIfAborted();
              }
            } finally {
              context.signal.removeEventListener('abort', cancelReader);
              if (!complete) await reader.cancel().catch(() => {});
              reader.releaseLock();
            }
            if (itemBytes !== item.size) {
              throw new TypeError(
                `${item.name} size changed during acquisition`,
              );
            }
            const bytes = new Uint8Array(itemBytes);
            let offset = 0;
            for (const chunk of chunks) {
              bytes.set(chunk, offset);
              offset += chunk.byteLength;
            }
            media.push({
              name: item.name,
              format: item.format,
              mimeType: item.mimeType,
              bytes,
            });
          }
          return media;
        },
      },
    },
    resolveIntent(toolId) {
      return toolId === TOOL_ID
        ? {
            requestedOperation: 'bulk',
            outputs: [{ format: 'zip', mimeType: 'application/zip' }],
          }
        : undefined;
    },
    resolveProcessor(toolId) {
      return toolId === TOOL_ID
        ? (batchProcessor as unknown as ToolProcessor)
        : undefined;
    },
    async deliver(media, context) {
      context.signal.throwIfAborted();
      const deliveryId = await ports.deliver(media);
      context.reportProgress(1);
      return deliveryId;
    },
    runtime: {
      async open() {
        return { async release() {} };
      },
    },
    telemetry: ports.telemetry,
    clock: ports.clock ?? { now: () => Date.now() },
    nextId: ports.nextId,
  });
}
