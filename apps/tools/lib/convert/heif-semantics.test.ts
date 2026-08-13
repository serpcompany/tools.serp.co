import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PDFDocument } from 'pdf-lib';
import UPNGModule from 'upng-js';

import {
  inspectHeifContainer,
  verifyHeifConversionSemantics,
  type DecodedHeifRaster,
} from './heif-semantics.ts';

const fixture = new Uint8Array(
  readFileSync(
    new URL('../../benchmarks/fixtures/sample.heif', import.meta.url),
  ),
);
const width = 2;
const height = 2;
const source = Object.freeze({
  width,
  height,
  rgba: new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
  ]),
});

async function sourceDecoder(): Promise<DecodedHeifRaster> {
  return source;
}

test('HEIF identity is byte-derived from a bounded ftyp brand', () => {
  assert.deepEqual(inspectHeifContainer(fixture), { status: 'verified' });
  assert.equal(
    inspectHeifContainer(fixture.subarray(0, 12)).status,
    'rejected',
  );
  const spoof = Uint8Array.from(fixture);
  const boxSize = new DataView(spoof.buffer).getUint32(0, false);
  for (let offset = 8; offset + 4 <= boxSize; offset += offset === 8 ? 8 : 4) {
    spoof.set(new TextEncoder().encode('xxxx'), offset);
  }
  assert.equal(inspectHeifContainer(spoof).status, 'rejected');
  const polyglot = new Uint8Array(fixture.byteLength + 4);
  polyglot.set(fixture);
  polyglot.set(new TextEncoder().encode('HTML'), fixture.byteLength);
  assert.equal(inspectHeifContainer(polyglot).status, 'rejected');
});

test('HEIF raster semantics reject wrong dimensions and changed pixels', async () => {
  const correct = await verifyHeifConversionSemantics({
    input: fixture,
    output: { format: 'png', bytes: new Uint8Array([1]) },
    decodeInput: sourceDecoder,
    async decodeOutput() {
      return source;
    },
  });
  assert.deepEqual(correct, { status: 'verified' });

  const wrongDimensions = await verifyHeifConversionSemantics({
    input: fixture,
    output: { format: 'png', bytes: new Uint8Array([1]) },
    decodeInput: sourceDecoder,
    async decodeOutput() {
      return { ...source, width: 1 };
    },
  });
  assert.equal(wrongDimensions.status, 'rejected');

  const changed = Uint8Array.from(source.rgba);
  changed.fill(0);
  const wrongPixels = await verifyHeifConversionSemantics({
    input: fixture,
    output: { format: 'webp', bytes: new Uint8Array([1]) },
    decodeInput: sourceDecoder,
    async decodeOutput() {
      return { ...source, rgba: changed };
    },
  });
  assert.equal(wrongPixels.status, 'rejected');
});

test('HEIF PDF semantics require one source-sized image page', async () => {
  const UPNG = UPNGModule as {
    encode(
      buffers: ArrayBuffer[],
      width: number,
      height: number,
      colors: number,
    ): ArrayBuffer;
  };
  const png = new Uint8Array(
    UPNG.encode([source.rgba.slice().buffer], width, height, 0),
  );
  const document = await PDFDocument.create();
  const image = await document.embedPng(png);
  const page = document.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  const verified = await verifyHeifConversionSemantics({
    input: fixture,
    output: { format: 'pdf', bytes: await document.save() },
    decodeInput: sourceDecoder,
  });
  assert.deepEqual(verified, { status: 'verified' });

  const empty = await PDFDocument.create();
  empty.addPage([width, height]);
  const rejected = await verifyHeifConversionSemantics({
    input: fixture,
    output: { format: 'pdf', bytes: await empty.save() },
    decodeInput: sourceDecoder,
  });
  assert.equal(rejected.status, 'rejected');
});
