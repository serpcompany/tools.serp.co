import type { SemanticVerification } from './tool-workflow/index.ts';

export const SVG_RENDER_VERIFICATION_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 320, height: 180 }),
  Object.freeze({ width: 640, height: 360 }),
]);

type SvgDocumentIdentity = Readonly<{
  width: number;
  height: number;
  viewBox: string;
  referenceCount: number;
}>;

type SvgRenderVerificationPorts = Readonly<{
  inspect(bytes: Uint8Array): SvgDocumentIdentity;
  rasterize(
    bytes: Uint8Array,
    viewport: Readonly<{ width: number; height: number }>,
    signal: AbortSignal,
  ): Promise<Uint8ClampedArray>;
}>;

function inspectBrowserSvg(bytes: Uint8Array): SvgDocumentIdentity {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (document.querySelector('parsererror')) {
    throw new TypeError('SVG browser parser rejected the document.');
  }
  const root = document.documentElement;
  const ids = new Set(
    [...document.querySelectorAll('[id]')]
      .map((element) => element.id)
      .filter(Boolean),
  );
  const references: string[] = [];
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of element.attributes) {
      const value = attribute.value.trim();
      for (const match of value.matchAll(
        /url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/giu,
      )) {
        if (match[1]) references.push(match[1]);
      }
      if (
        (attribute.name === 'href' || attribute.name === 'xlink:href') &&
        value.startsWith('#')
      ) {
        references.push(value.slice(1));
      }
      if (
        attribute.name === 'aria-labelledby' ||
        attribute.name === 'aria-describedby'
      ) {
        references.push(...value.split(/\s+/u).filter(Boolean));
      }
    }
  }
  if (references.some((reference) => !ids.has(reference))) {
    throw new TypeError('SVG contains an unresolved identifier reference.');
  }
  return {
    width: Number(root.getAttribute('width')),
    height: Number(root.getAttribute('height')),
    viewBox: root.getAttribute('viewBox') ?? '',
    referenceCount: references.length,
  };
}

async function rasterizeBrowserSvg(
  bytes: Uint8Array,
  viewport: Readonly<{ width: number; height: number }>,
  signal: AbortSignal,
): Promise<Uint8ClampedArray> {
  signal.throwIfAborted();
  const pending = createImageBitmap(
    new Blob([Uint8Array.from(bytes)], { type: 'image/svg+xml' }),
    {
      resizeWidth: viewport.width,
      resizeHeight: viewport.height,
      resizeQuality: 'high',
    },
  );
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    rejectAbort?.(
      signal.reason ??
        new DOMException('The operation was aborted', 'AbortError'),
    );
    void pending.then(
      (lateBitmap) => lateBitmap.close(),
      () => undefined,
    );
  };
  signal.addEventListener('abort', onAbort, { once: true });
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await Promise.race([pending, aborted]);
    signal.throwIfAborted();
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new TypeError('SVG canvas context is unavailable.');
    context.drawImage(bitmap, 0, 0, viewport.width, viewport.height);
    return context.getImageData(0, 0, viewport.width, viewport.height).data;
  } finally {
    signal.removeEventListener('abort', onAbort);
    bitmap?.close();
  }
}

const browserPorts: SvgRenderVerificationPorts = {
  inspect: inspectBrowserSvg,
  rasterize: rasterizeBrowserSvg,
};

export async function verifySvgRenderEquivalence(
  args: Readonly<{
    input: Uint8Array;
    output: Uint8Array;
    signal: AbortSignal;
    ports?: SvgRenderVerificationPorts;
  }>,
): Promise<SemanticVerification> {
  args.signal.throwIfAborted();
  if (args.output.byteLength > args.input.byteLength) {
    return {
      status: 'rejected',
      message: 'SVG optimization output is larger than its input',
    };
  }
  const ports = args.ports ?? browserPorts;
  let inputIdentity: SvgDocumentIdentity;
  let outputIdentity: SvgDocumentIdentity;
  try {
    inputIdentity = ports.inspect(args.input);
    outputIdentity = ports.inspect(args.output);
  } catch {
    return { status: 'rejected', message: 'SVG browser parsing failed' };
  }
  if (
    inputIdentity.width !== outputIdentity.width ||
    inputIdentity.height !== outputIdentity.height ||
    inputIdentity.viewBox !== outputIdentity.viewBox ||
    inputIdentity.referenceCount !== outputIdentity.referenceCount
  ) {
    return {
      status: 'rejected',
      message: 'SVG intrinsic dimensions or viewBox changed',
    };
  }
  try {
    for (const viewport of SVG_RENDER_VERIFICATION_VIEWPORTS) {
      const before = await ports.rasterize(args.input, viewport, args.signal);
      const after = await ports.rasterize(args.output, viewport, args.signal);
      args.signal.throwIfAborted();
      if (before.length !== after.length || before.length === 0) {
        return { status: 'rejected', message: 'SVG raster size changed' };
      }
      let changedPixels = 0;
      let maximumDelta = 0;
      let totalDelta = 0;
      let visiblePixels = 0;
      for (let index = 0; index < before.length; index += 4) {
        if ((before[index + 3] ?? 0) > 0) visiblePixels += 1;
        let changed = false;
        for (let channel = 0; channel < 4; channel += 1) {
          const delta = Math.abs(
            (before[index + channel] ?? 0) - (after[index + channel] ?? 0),
          );
          if (delta > 0) changed = true;
          maximumDelta = Math.max(maximumDelta, delta);
          totalDelta += delta;
        }
        if (changed) changedPixels += 1;
      }
      const pixelCount = before.length / 4;
      if (
        visiblePixels === 0 ||
        changedPixels / pixelCount > 0.0005 ||
        maximumDelta > 4 ||
        totalDelta / before.length > 0.01
      ) {
        return { status: 'rejected', message: 'SVG visible pixels changed' };
      }
    }
    return { status: 'verified' };
  } catch (error) {
    args.signal.throwIfAborted();
    return {
      status: 'rejected',
      message:
        error instanceof Error
          ? `SVG rendering failed: ${error.message}`
          : 'SVG rendering failed',
    };
  }
}
