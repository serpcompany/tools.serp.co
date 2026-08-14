import {
  convertIcoBytesToPng,
  verifyIcoConversionResult,
} from '../lib/convert/ico.ts';

async function decodePng(bytes) {
  const bitmap = await createImageBitmap(
    new Blob([bytes], { type: 'image/png' }),
  );
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('ICO verification canvas is unavailable.');
    context.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      rgba: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
    };
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event) => {
  if (event.data?.type !== 'convert-ico-to-png') {
    self.postMessage({ ok: false, error: 'Unknown ICO Worker request.' });
    return;
  }
  try {
    self.postMessage({ type: 'progress', stage: 'decode' });
    const result = await convertIcoBytesToPng(
      new Uint8Array(event.data.input),
      {
        async decode(bytes) {
          const { decodeIco } = await import('icojs/browser');
          const decoded = await decodeIco(
            Uint8Array.from(bytes).buffer,
            'image/png',
          );
          return decoded.map((image) => ({
            width: image.width,
            height: image.height,
            bpp: image.bpp,
            png: new Uint8Array(image.buffer),
          }));
        },
      },
    );
    self.postMessage({ type: 'progress', stage: 'select' });
    self.postMessage({ type: 'progress', stage: 'verify' });
    await verifyIcoConversionResult(result, decodePng);
    const png = Uint8Array.from(result.png).buffer;
    self.postMessage(
      {
        ok: true,
        png,
        width: result.width,
        height: result.height,
        selectedIndex: result.selectedIndex,
        sourceKind: result.sourceKind,
        pixelVerified: true,
      },
      [png],
    );
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
