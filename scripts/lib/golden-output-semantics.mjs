import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from '../../apps/tools/node_modules/@zip.js/zip.js/index.js';

export async function extractExactZipEntries(bytes, expectedNames) {
  const reader = new ZipReader(new Uint8ArrayReader(Uint8Array.from(bytes)), {
    useWebWorkers: false,
  });
  try {
    const entries = await reader.getEntries();
    const names = entries.map((entry) => entry.filename);
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
      throw new Error(
        `ZIP entries ${JSON.stringify(names)} did not match ${JSON.stringify(expectedNames)}.`,
      );
    }
    return Promise.all(
      entries.map(async (entry) => ({
        name: entry.filename,
        bytes: [...(await entry.getData(new Uint8ArrayWriter()))],
      })),
    );
  } finally {
    await reader.close();
  }
}

export function assertUniformImageSummary(
  summary,
  { width, height, rgba, label },
) {
  if (!summary || summary.width !== width || summary.height !== height) {
    throw new Error(
      `${label} dimensions did not match ${width}x${height}: ${summary?.width ?? '?'}x${summary?.height ?? '?'}.`,
    );
  }
  if (
    summary.pixelCount !== width * height ||
    JSON.stringify(summary.minimum) !== JSON.stringify(rgba) ||
    JSON.stringify(summary.maximum) !== JSON.stringify(rgba)
  ) {
    throw new Error(`${label} decoded pixels did not match the owned fixture.`);
  }
}

export function assertPdfCanvasSummary(summary) {
  if (!summary || summary.pageCount !== 1) {
    throw new Error('PDF viewer did not render the owned one-page fixture.');
  }
  if (summary.width < 90 || summary.height < 90) {
    throw new Error(
      'PDF viewer canvas dimensions were smaller than the fixture.',
    );
  }
  if (summary.nonWhitePixels < 2_000 || summary.bluePixels < 2_000) {
    throw new Error(
      'PDF viewer canvas was blank or did not contain the blue fixture.',
    );
  }
}
