import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { SemanticVerification } from './tool-workflow/index.ts';

export const SVG_COMPRESSION_LIMITS = Object.freeze({
  maxBytes: 1_024 * 1_024,
  maxElements: 10_000,
  maxDepth: 64,
  maxAttributes: 50_000,
  executionTimeoutMs: 10_000,
});

const ACTIVE_ELEMENTS = new Set([
  'animate',
  'animatemotion',
  'animatetransform',
  'audio',
  'embed',
  'foreignobject',
  'iframe',
  'object',
  'script',
  'set',
  'style',
  'video',
]);
const URL_ATTRIBUTE_LOCAL_NAMES = new Set(['href', 'src']);
const decoder = new TextDecoder('utf-8', { fatal: true });
const parser = new XMLParser({
  allowBooleanAttributes: false,
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: true,
  processEntities: false,
});

type ParsedNode = Record<string, unknown>;

function rejected(message: string): SemanticVerification {
  return { status: 'rejected', message };
}

function localName(name: string): string {
  return (name.split(':').at(-1) ?? name).toLowerCase();
}

function hasUnsafeUrl(value: string): boolean {
  const normalized = [...value]
    .filter((character) => character.charCodeAt(0) > 0x20)
    .join('')
    .toLowerCase();
  if (normalized.includes('javascript:')) return true;
  for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/giu)) {
    if (!match[2]?.trim().startsWith('#')) return true;
  }
  return false;
}

function verifyAttribute(name: string, value: unknown): SemanticVerification {
  const normalizedName = name.toLowerCase();
  const normalizedLocalName = localName(name);
  const text = String(value ?? '').trim();
  if (normalizedName.startsWith('on')) {
    return rejected('SVG event-handler attributes are not allowed');
  }
  if (normalizedName === 'xml:base') {
    return rejected('SVG external resource bases are not allowed');
  }
  if (hasUnsafeUrl(text)) {
    return rejected(
      'SVG JavaScript and external resource URLs are not allowed',
    );
  }
  if (
    URL_ATTRIBUTE_LOCAL_NAMES.has(normalizedLocalName) &&
    !text.startsWith('#')
  ) {
    return rejected('SVG external resource references are not allowed');
  }
  return { status: 'verified' };
}

function inspectParsedSvg(nodes: readonly unknown[]): SemanticVerification {
  let elements = 0;
  let attributes = 0;
  let rootName: string | undefined;
  let rootNamespace: string | undefined;

  const visit = (
    entries: readonly unknown[],
    depth: number,
  ): SemanticVerification => {
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const node = entry as ParsedNode;
      const elementNames = Object.keys(node).filter(
        (name) =>
          name !== ':@' && !name.startsWith('#') && !name.startsWith('?'),
      );
      for (const elementName of elementNames) {
        elements += 1;
        if (!rootName) rootName = localName(elementName);
        if (elements > SVG_COMPRESSION_LIMITS.maxElements) {
          return rejected('SVG element limit exceeded');
        }
        if (depth > SVG_COMPRESSION_LIMITS.maxDepth) {
          return rejected('SVG nesting depth limit exceeded');
        }
        if (ACTIVE_ELEMENTS.has(localName(elementName))) {
          return rejected(`SVG ${elementName} elements are not allowed`);
        }
        const attributesValue = node[':@'];
        if (
          attributesValue &&
          typeof attributesValue === 'object' &&
          !Array.isArray(attributesValue)
        ) {
          const entries = Object.entries(
            attributesValue as Record<string, unknown>,
          );
          attributes += entries.length;
          if (attributes > SVG_COMPRESSION_LIMITS.maxAttributes) {
            return rejected('SVG attribute limit exceeded');
          }
          if (elements === 1) {
            rootNamespace = String(
              (attributesValue as Record<string, unknown>).xmlns ?? '',
            );
          }
          for (const [name, value] of entries) {
            const verification = verifyAttribute(name, value);
            if (verification.status !== 'verified') return verification;
          }
        }
        const children = node[elementName];
        if (Array.isArray(children)) {
          const verification = visit(children, depth + 1);
          if (verification.status !== 'verified') return verification;
        }
      }
    }
    return { status: 'verified' };
  };

  const verification = visit(nodes, 1);
  if (verification.status !== 'verified') return verification;
  if (rootName !== 'svg') return rejected('SVG document requires an svg root');
  if (rootNamespace !== 'http://www.w3.org/2000/svg') {
    return rejected('SVG document requires the SVG namespace');
  }
  return { status: 'verified' };
}

export function verifySvgBytes(bytes: Uint8Array): SemanticVerification {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > SVG_COMPRESSION_LIMITS.maxBytes
  ) {
    return rejected(
      `SVG must contain 1-${SVG_COMPRESSION_LIMITS.maxBytes} bytes`,
    );
  }
  let source: string;
  try {
    source = decoder.decode(bytes);
  } catch {
    return rejected('SVG must be valid UTF-8');
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(source)) {
    return rejected('SVG DOCTYPE and entity declarations are not allowed');
  }
  if (/<\?(?!xml(?:\s|\?>))/iu.test(source)) {
    return rejected('SVG processing instructions are not allowed');
  }
  const validation = XMLValidator.validate(source, {
    allowBooleanAttributes: false,
    unpairedTags: [],
  });
  if (validation !== true) return rejected('SVG XML is malformed');
  try {
    const parsed = parser.parse(source) as unknown;
    return Array.isArray(parsed)
      ? inspectParsedSvg(parsed)
      : rejected('SVG XML did not produce a document');
  } catch {
    return rejected('SVG XML could not be parsed safely');
  }
}

type SvgWorkerResponse = Readonly<{
  ok?: boolean;
  error?: string;
  blob?: ArrayBuffer;
}>;

export async function compressSvgWithWorker(
  args: Readonly<{
    worker: Worker;
    bytes: Uint8Array;
    signal: AbortSignal;
    timeoutMs?: number;
  }>,
): Promise<Uint8Array> {
  args.signal.throwIfAborted();
  const input = Uint8Array.from(args.bytes);
  return await new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      args.signal.removeEventListener('abort', onAbort);
      args.worker.onmessage = null;
      args.worker.onerror = null;
      operation();
    };
    const onAbort = () =>
      finish(() =>
        reject(
          args.signal.reason ??
            new DOMException('The operation was aborted', 'AbortError'),
        ),
      );
    const timeout = setTimeout(
      () => finish(() => reject(new Error('SVG compression timed out'))),
      args.timeoutMs ?? SVG_COMPRESSION_LIMITS.executionTimeoutMs,
    );
    args.signal.addEventListener('abort', onAbort, { once: true });
    args.worker.onmessage = (event: MessageEvent<SvgWorkerResponse>) => {
      const response = event.data;
      if (!response?.ok || !(response.blob instanceof ArrayBuffer)) {
        finish(() =>
          reject(new Error(response?.error || 'SVG compression failed')),
        );
        return;
      }
      finish(() => resolve(new Uint8Array(response.blob!)));
    };
    args.worker.onerror = () =>
      finish(() => reject(new Error('SVG compression Worker failed')));
    const transferable = input.buffer.slice(
      input.byteOffset,
      input.byteOffset + input.byteLength,
    );
    args.worker.postMessage({ op: 'compress-svg', buf: transferable }, [
      transferable,
    ]);
  });
}
