import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  BlobWriter,
  TextReader,
  ZipWriter,
} from '../../apps/tools/node_modules/@zip.js/zip.js/index.js';
const requireFromTools = createRequire(
  new URL('../../apps/tools/package.json', import.meta.url),
);
const { PDFDocument } = requireFromTools('pdf-lib');
const UPNG = requireFromTools('upng-js');

import {
  assertExactFixtureBytes,
  assertHeifPdfBytes,
  assertLossyUniformImageSummary,
  assertPdfCanvasSummary,
  assertUniformImageSummary,
  extractExactZipEntries,
} from './golden-output-semantics.mjs';

test('exact fixture verification rejects altered or truncated delivery bytes', () => {
  const fixture = [0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 3];
  assert.match(
    assertExactFixtureBytes(fixture, fixture, 'Downloaded MP4'),
    /^[a-f0-9]{64}$/,
  );
  assert.throws(
    () =>
      assertExactFixtureBytes(
        [0, 0, 0, 24, 102, 116, 121, 112, 1, 2, 4],
        fixture,
        'Downloaded MP4',
      ),
    /owned fixture/,
  );
  assert.throws(
    () =>
      assertExactFixtureBytes(fixture.slice(0, -1), fixture, 'Downloaded MP4'),
    /owned fixture/,
  );
});

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

test('lossy image verification accepts bounded drift and rejects changed content', () => {
  const expected = {
    width: 2,
    height: 1,
    rgba: [0, 0, 253, 255],
    tolerance: 8,
    label: 'PNG to WebP output',
  };
  assert.doesNotThrow(() =>
    assertLossyUniformImageSummary(
      {
        width: 2,
        height: 1,
        pixelCount: 2,
        minimum: [0, 0, 251, 255],
        maximum: [3, 1, 255, 255],
      },
      expected,
    ),
  );
  assert.throws(
    () =>
      assertLossyUniformImageSummary(
        {
          width: 2,
          height: 1,
          pixelCount: 2,
          minimum: [0, 0, 253, 255],
          maximum: [40, 0, 253, 255],
        },
        expected,
      ),
    /lossy tolerance/,
  );
  assert.throws(
    () =>
      assertLossyUniformImageSummary(
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

test('HEIF PDF verification inspects exact page bounds and embedded pixels', async () => {
  const rgba = new Uint8Array(128 * 80 * 4);
  for (let index = 0; index < rgba.byteLength; index += 4) {
    rgba.set([253, 165, 0, 255], index);
  }
  const png = new Uint8Array(UPNG.encode([rgba.buffer], 128, 80, 0));
  const document = await PDFDocument.create();
  const image = await document.embedPng(png);
  const page = document.addPage([128, 80]);
  page.drawImage(image, { x: 0, y: 0, width: 128, height: 80 });
  const summary = await assertHeifPdfBytes(await document.save());
  assert.equal(summary.pageCount, 1);
  assert.deepEqual(summary.minimum, [253, 165, 0]);

  const blank = await PDFDocument.create();
  blank.addPage([128, 80]);
  const blankBytes = await blank.save();
  await assert.rejects(() => assertHeifPdfBytes(blankBytes), /one source/);
});
