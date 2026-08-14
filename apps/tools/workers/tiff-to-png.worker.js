import { convertTiffBytesToPng } from '../lib/convert/tiff.ts';

self.onmessage = async (event) => {
  if (event.data?.type !== 'convert-tiff-to-png') {
    self.postMessage({ ok: false, error: 'Unknown TIFF Worker request.' });
    return;
  }
  try {
    const result = await convertTiffBytesToPng(
      new Uint8Array(event.data.input),
      undefined,
      (stage) => self.postMessage({ type: 'progress', stage }),
    );
    const png = Uint8Array.from(result.png).buffer;
    self.postMessage(
      {
        ok: true,
        png,
        width: result.width,
        height: result.height,
        sourceRgbaSha256: result.sourceRgbaSha256,
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
