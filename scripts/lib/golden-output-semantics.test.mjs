import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BlobWriter,
  TextReader,
  ZipWriter,
} from '../../apps/tools/node_modules/@zip.js/zip.js/index.js';

import {
  assertPdfCanvasSummary,
  assertUniformImageSummary,
  extractExactZipEntries,
} from './golden-output-semantics.mjs';

async function zip(entries) {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, value] of entries) {
    await writer.add(name, new TextReader(value));
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer());
}

test('ZIP verification retains exact entry order and content', async () => {
  const bytes = await zip([
    ['sample.png', 'blue'],
    ['sample-2.png', 'orange'],
  ]);
  const entries = await extractExactZipEntries(bytes, [
    'sample.png',
    'sample-2.png',
  ]);
  assert.deepEqual(
    entries.map(({ name, bytes: value }) => [
      name,
      new TextDecoder().decode(Uint8Array.from(value)),
    ]),
    [
      ['sample.png', 'blue'],
      ['sample-2.png', 'orange'],
    ],
  );
  await assert.rejects(
    extractExactZipEntries(bytes, ['sample-2.png', 'sample.png']),
    /did not match/,
  );
  await assert.rejects(extractExactZipEntries([1, 2, 3], []));
});

test('image verification rejects wrong pixels and dimensions', () => {
  const expected = {
    width: 2,
    height: 1,
    rgba: [0, 0, 253, 255],
    label: 'BMP output',
  };
  assert.doesNotThrow(() =>
    assertUniformImageSummary(
      {
        width: 2,
        height: 1,
        pixelCount: 2,
        minimum: expected.rgba,
        maximum: expected.rgba,
      },
      expected,
    ),
  );
  assert.throws(
    () =>
      assertUniformImageSummary(
        {
          width: 2,
          height: 1,
          pixelCount: 2,
          minimum: [1, 0, 253, 255],
          maximum: [1, 0, 253, 255],
        },
        expected,
      ),
    /pixels/,
  );
  assert.throws(
    () =>
      assertUniformImageSummary(
        {
          width: 3,
          height: 1,
          pixelCount: 3,
          minimum: expected.rgba,
          maximum: expected.rgba,
        },
        expected,
      ),
    /dimensions/,
  );
});

test('PDF canvas verification rejects blank, wrong-color, and multi-page renders', () => {
  assert.doesNotThrow(() =>
    assertPdfCanvasSummary({
      pageCount: 1,
      width: 96,
      height: 96,
      nonWhitePixels: 9_000,
      bluePixels: 9_000,
    }),
  );
  assert.throws(() =>
    assertPdfCanvasSummary({
      pageCount: 1,
      width: 96,
      height: 96,
      nonWhitePixels: 0,
      bluePixels: 0,
    }),
  );
  assert.throws(() =>
    assertPdfCanvasSummary({
      pageCount: 2,
      width: 96,
      height: 96,
      nonWhitePixels: 9_000,
      bluePixels: 9_000,
    }),
  );
});
