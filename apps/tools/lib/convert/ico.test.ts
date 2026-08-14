import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import sharp from 'sharp';

import {
  ICO_TO_PNG_LIMITS,
  ICO_TO_PNG_TOOL_IDS,
  convertIcoBytesToPng,
  convertIcoToPngWithWorker,
  decodeIcoDibToRgba,
  inspectIco,
  verifyIcoConversionResult,
  verifyIcoDecodedOutput,
} from './ico.ts';
import { ownWorkerTermination } from './owned-worker.ts';

const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`../../benchmarks/fixtures/${name}`, import.meta.url)),
  );

function pngDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false),
  };
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(
    8 + data.byteLength,
    pngCrc32(chunk.subarray(4, 8 + data.byteLength)),
    false,
  );
  return chunk;
}

function insertPngChunkAfterHeader(
  png: Uint8Array,
  chunk: Uint8Array,
): Uint8Array {
  const headerEnd = 33;
  const output = new Uint8Array(png.byteLength + chunk.byteLength);
  output.set(png.subarray(0, headerEnd));
  output.set(chunk, headerEnd);
  output.set(png.subarray(headerEnd), headerEnd + chunk.byteLength);
  return output;
}

function icoWithPngEntries(entries: readonly Uint8Array[]): Uint8Array {
  const directoryBytes = 6 + entries.length * 16;
  const totalBytes =
    directoryBytes +
    entries.reduce((total, entry) => total + entry.byteLength, 0);
  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);
  let payloadOffset = directoryBytes;
  entries.forEach((entry, index) => {
    const { width, height } = pngDimensions(entry);
    const directoryOffset = 6 + index * 16;
    bytes[directoryOffset] = width === 256 ? 0 : width;
    bytes[directoryOffset + 1] = height === 256 ? 0 : height;
    view.setUint16(directoryOffset + 4, 1, true);
    view.setUint16(directoryOffset + 6, 32, true);
    view.setUint32(directoryOffset + 8, entry.byteLength, true);
    view.setUint32(directoryOffset + 12, payloadOffset, true);
    bytes.set(entry, payloadOffset);
    payloadOffset += entry.byteLength;
  });
  return bytes;
}

function dibFixture(bpp: 1 | 4 | 8 | 24 | 32) {
  const width = 3;
  const height = 2;
  const paletteEntries = bpp <= 8 ? 2 ** bpp : 0;
  const xorRowBytes = Math.ceil((width * bpp) / 32) * 4;
  const andRowBytes = Math.ceil(width / 32) * 4;
  const payload = new Uint8Array(
    40 + paletteEntries * 4 + (xorRowBytes + andRowBytes) * height,
  );
  const view = new DataView(payload.buffer);
  view.setUint32(0, 40, true);
  view.setInt32(4, width, true);
  view.setInt32(8, height * 2, true);
  view.setUint16(12, 1, true);
  view.setUint16(14, bpp, true);
  view.setUint32(32, paletteEntries, true);
  if (paletteEntries) {
    payload.set([253, 0, 0, 0], 40);
    payload.set([0, 0, 253, 0], 44);
  }
  const xorOffset = 40 + paletteEntries * 4;
  const expected = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    const row = xorOffset + sourceY * xorRowBytes;
    for (let x = 0; x < width; x += 1) {
      const blue = (x + y) % 2 === 0;
      const target = (y * width + x) * 4;
      expected.set(blue ? [0, 0, 253, 255] : [253, 0, 0, 255], target);
      if (bpp <= 8) {
        const shift = 8 - bpp - ((x * bpp) % 8);
        payload[row + Math.floor((x * bpp) / 8)]! |= (blue ? 0 : 1) << shift;
      } else {
        const pixel = row + x * (bpp / 8);
        payload.set(blue ? [253, 0, 0] : [0, 0, 253], pixel);
        if (bpp === 32) payload[pixel + 3] = 255;
      }
    }
  }
  return { payload, width, height, expected };
}

function icoWithDib(
  payload: Uint8Array,
  width: number,
  height: number,
  bpp: number,
) {
  const bytes = new Uint8Array(22 + payload.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  bytes[6] = width;
  bytes[7] = height;
  view.setUint16(10, 1, true);
  view.setUint16(12, bpp, true);
  view.setUint32(14, payload.byteLength, true);
  view.setUint32(18, 22, true);
  bytes.set(payload, 22);
  return bytes;
}

test('ICO-to-PNG owns one exact Tool and bounded client-only contract', () => {
  assert.deepEqual(ICO_TO_PNG_TOOL_IDS, ['ico-to-png']);
  assert.equal(
    `sha256:${createHash('sha256')
      .update(JSON.stringify([...ICO_TO_PNG_TOOL_IDS].sort()))
      .digest('hex')}`,
    'sha256:2e8404b30c9b954d51d697be77e5e3bc6faf8c9b3a5e942cfb75e56e86d4986e',
  );
  assert.deepEqual(ICO_TO_PNG_LIMITS, {
    maxInputBytes: 16 * 1_024 * 1_024,
    maxEntries: 64,
    maxDimension: 256,
    maxDecodedRgbaBytes: 16 * 1_024 * 1_024,
    maxOutputBytes: 4 * 1_024 * 1_024,
    executionTimeoutMs: 10_000,
  });
});

test('ICO conversion validates every entry and deterministically selects the greatest pixels', async () => {
  const small = fixture('sample-2.png');
  const large = fixture('sample.png');
  const input = icoWithPngEntries([small, large]);
  let decodedInput: Uint8Array | undefined;

  const result = await convertIcoBytesToPng(input, {
    async decode(bytes) {
      decodedInput = bytes;
      return [
        { width: 128, height: 80, bpp: 32, png: small },
        { width: 96, height: 96, bpp: 32, png: large },
      ];
    },
  });

  assert.deepEqual(decodedInput, input);
  assert.equal(result.selectedIndex, 0);
  assert.equal(result.width, 128);
  assert.equal(result.height, 80);
  assert.deepEqual(result.png, small);
});

test('ICO conversion breaks equal-area ties by bit depth then directory order', async () => {
  const png = fixture('sample.png');
  const input = icoWithPngEntries([png, png, png]);
  const result = await convertIcoBytesToPng(input, {
    async decode() {
      return [
        { width: 96, height: 96, bpp: 8, png },
        { width: 96, height: 96, bpp: 32, png },
        { width: 96, height: 96, bpp: 32, png },
      ];
    },
  });
  assert.equal(result.selectedIndex, 1);
});

test('ICO conversion rejects structurally corrupt decoder PNG output', async () => {
  const png = fixture('sample.png');
  const input = icoWithPngEntries([png]);
  const badCrc = Uint8Array.from(png);
  const crcByte = badCrc.byteLength - 5;
  badCrc[crcByte] = badCrc[crcByte]! ^ 0xff;
  const trailingByte = new Uint8Array(png.byteLength + 1);
  trailingByte.set(png);
  const duplicateHeader = insertPngChunkAfterHeader(png, png.subarray(8, 33));

  for (const [name, output] of [
    ['bad CRC', badCrc],
    ['trailing byte', trailingByte],
    ['duplicate IHDR', duplicateHeader],
  ] as const) {
    await assert.rejects(
      convertIcoBytesToPng(input, {
        async decode() {
          return [{ width: 96, height: 96, bpp: 32, png: output }];
        },
      }),
      /PNG.*CRC|PNG.*IEND|PNG.*terminal|PNG.*duplicate IHDR/i,
      name,
    );
  }
});

test('ICO conversion rejects a structurally valid decoder PNG over the output limit', async () => {
  const png = fixture('sample.png');
  const input = icoWithPngEntries([png]);
  const oversized = insertPngChunkAfterHeader(
    png,
    pngChunk('tEXt', new Uint8Array(ICO_TO_PNG_LIMITS.maxOutputBytes)),
  );

  await assert.rejects(
    convertIcoBytesToPng(input, {
      async decode() {
        return [{ width: 96, height: 96, bpp: 32, png: oversized }];
      },
    }),
    /inconsistent image data/i,
  );
});

test('ICO preflight rejects a truncated DIB before invoking the decoder', async () => {
  const source = fixture('sample.ico');
  const view = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  );
  const payloadOffset = view.getUint32(18, true);
  const truncated = source.slice(0, payloadOffset + 40);
  new DataView(truncated.buffer).setUint32(14, 40, true);
  let decoded = false;

  await assert.rejects(
    convertIcoBytesToPng(truncated, {
      async decode() {
        decoded = true;
        return [];
      },
    }),
    /DIB.*truncated|payload.*truncated/i,
  );
  assert.equal(decoded, false);
});

test('ICO preflight rejects a structurally truncated embedded PNG before decoding', async () => {
  const png = fixture('sample.png');
  const truncatedPng = png.subarray(0, 33);
  const input = icoWithPngEntries([truncatedPng]);
  let decoded = false;

  await assert.rejects(
    convertIcoBytesToPng(input, {
      async decode() {
        decoded = true;
        return [];
      },
    }),
    /PNG.*truncated|PNG.*image data|PNG.*IEND/i,
  );
  assert.equal(decoded, false);
});

test('ICO preflight rejects cursor, overlap, metadata, codec, and resource violations', () => {
  const source = fixture('sample.ico');
  const payloadOffset = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  ).getUint32(18, true);
  const cases: Array<readonly [string, Uint8Array, RegExp]> = [];

  const cursor = Uint8Array.from(source);
  new DataView(cursor.buffer).setUint16(2, 2, true);
  cases.push(['cursor', cursor, /not an ICO/i]);

  const wrongDimension = Uint8Array.from(source);
  wrongDimension[6] = 95;
  cases.push(['dimension', wrongDimension, /metadata.*inconsistent/i]);

  const wrongDepth = Uint8Array.from(source);
  new DataView(wrongDepth.buffer).setUint16(payloadOffset + 14, 16, true);
  cases.push(['depth', wrongDepth, /metadata.*inconsistent/i]);

  const compressed = Uint8Array.from(source);
  new DataView(compressed.buffer).setUint32(payloadOffset + 16, 1, true);
  cases.push(['compression', compressed, /metadata.*inconsistent/i]);

  const twoPng = icoWithPngEntries([
    fixture('sample.png'),
    fixture('sample.png'),
  ]);
  const overlapping = Uint8Array.from(twoPng);
  const overlapView = new DataView(overlapping.buffer);
  overlapView.setUint32(34, overlapView.getUint32(18, true), true);
  cases.push(['overlap', overlapping, /overlapping/i]);

  const tooMany = Uint8Array.from(source);
  new DataView(tooMany.buffer).setUint16(4, 65, true);
  cases.push(['entry count', tooMany, /entry count/i]);

  const empty = Uint8Array.from(source);
  new DataView(empty.buffer).setUint16(4, 0, true);
  cases.push(['zero entries', empty, /entry count/i]);

  const outOfRange = Uint8Array.from(source);
  new DataView(outOfRange.buffer).setUint32(18, 0xfffffff0, true);
  cases.push(['payload offset', outOfRange, /payload range/i]);

  for (const [name, input, expected] of cases) {
    assert.throws(() => inspectIco(input), expected, name);
  }
  assert.throws(
    () => inspectIco(new Uint8Array(ICO_TO_PNG_LIMITS.maxInputBytes + 1)),
    /input exceeds/i,
  );
});

test('ICO preflight accepts a bounded PNG-backed 256px transparent entry', async () => {
  const png = new Uint8Array(
    await sharp({
      create: {
        width: 256,
        height: 1,
        channels: 4,
        background: { r: 12, g: 34, b: 56, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer(),
  );
  const input = icoWithPngEntries([png]);
  const entries = inspectIco(input);
  assert.equal(entries[0]?.width, 256);
  assert.equal(entries[0]?.height, 1);
  assert.equal(entries[0]?.sourceKind, 'png');

  const result = await convertIcoBytesToPng(input, {
    async decode() {
      return [{ width: 256, height: 1, bpp: 32, png }];
    },
  });
  assert.equal(result.width, 256);
  assert.equal(result.height, 1);
});

test('ICO Worker cancellation terminates exactly once and ignores late output', async () => {
  let terminations = 0;
  let posted = false;
  const rawWorker = {
    onmessage: null,
    onerror: null,
    postMessage() {
      posted = true;
    },
    terminate() {
      terminations += 1;
    },
  } as unknown as Worker;
  const worker = ownWorkerTermination(rawWorker);
  const controller = new AbortController();
  const pending = convertIcoToPngWithWorker({
    worker,
    bytes: fixture('sample.ico'),
    signal: controller.signal,
  });
  const lateMessage = rawWorker.onmessage;
  assert.equal(posted, true);
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, /cancelled/i);
  lateMessage?.call(rawWorker, {
    data: {
      ok: true,
      png: fixture('sample.png').buffer,
      width: 96,
      height: 96,
      selectedIndex: 0,
      sourceKind: 'dib',
      pixelVerified: true,
    },
  } as MessageEvent);
  worker.terminate();
  assert.equal(terminations, 1);
});

test('ICO Worker honours cancellation before import without posting input', async () => {
  let terminations = 0;
  let posts = 0;
  const rawWorker = {
    onmessage: null,
    onerror: null,
    postMessage() {
      posts += 1;
    },
    terminate() {
      terminations += 1;
    },
  } as unknown as Worker;
  const worker = ownWorkerTermination(rawWorker);
  const controller = new AbortController();
  controller.abort(new DOMException('cancelled', 'AbortError'));

  await assert.rejects(
    convertIcoToPngWithWorker({
      worker,
      bytes: fixture('sample.ico'),
      signal: controller.signal,
    }),
    /cancelled/i,
  );
  assert.equal(posts, 0);
  assert.equal(terminations, 1);
});

test('ICO Worker aborts during decode and suppresses the late terminal result', async () => {
  let terminations = 0;
  const rawWorker = {
    onmessage: null,
    onerror: null,
    postMessage() {
      queueMicrotask(() =>
        rawWorker.onmessage?.call(rawWorker, {
          data: { type: 'progress', stage: 'decode' },
        } as MessageEvent),
      );
    },
    terminate() {
      terminations += 1;
    },
  } as unknown as Worker;
  const worker = ownWorkerTermination(rawWorker);
  const controller = new AbortController();
  const pending = convertIcoToPngWithWorker({
    worker,
    bytes: fixture('sample.ico'),
    signal: controller.signal,
    onStage(stage) {
      if (stage === 'decode')
        controller.abort(new DOMException('cancelled', 'AbortError'));
    },
  });
  const lateMessage = rawWorker.onmessage;

  await assert.rejects(pending, /cancelled/i);
  lateMessage?.call(rawWorker, {
    data: {
      ok: true,
      png: fixture('sample.png').buffer,
      width: 96,
      height: 96,
      selectedIndex: 0,
      sourceKind: 'dib',
      pixelVerified: true,
    },
  } as MessageEvent);
  assert.equal(terminations, 1);
});

test('ICO Worker timeout terminates exactly once without accepting a late result', async () => {
  let terminations = 0;
  const rawWorker = {
    onmessage: null,
    onerror: null,
    postMessage() {},
    terminate() {
      terminations += 1;
    },
  } as unknown as Worker;
  const worker = ownWorkerTermination(rawWorker);

  await assert.rejects(
    convertIcoToPngWithWorker({
      worker,
      bytes: fixture('sample.ico'),
      timeoutMs: 5,
    }),
    /execution timeout/i,
  );
  worker.terminate();
  assert.equal(terminations, 1);
});

test('ICO DIB oracle independently reproduces the owned fixture pixels', async () => {
  const ico = fixture('sample.ico');
  const png = fixture('sample.png');
  const selected = await convertIcoBytesToPng(ico, {
    async decode() {
      return [{ width: 96, height: 96, bpp: 24, png }];
    },
  });
  assert.equal(selected.sourceKind, 'dib');
  const actual = decodeIcoDibToRgba(
    selected.sourceBytes,
    selected.width,
    selected.height,
  );
  const expected = new Uint8Array(
    await sharp(png).ensureAlpha().raw().toBuffer(),
  );
  assert.deepEqual(actual, expected);
});

test('ICO preflight and independent sharp PNG oracle cover bounded 1/4/8/24/32-bit DIBs', async () => {
  for (const bpp of [1, 4, 8, 24, 32] as const) {
    const generated = dibFixture(bpp);
    const ico = icoWithDib(
      generated.payload,
      generated.width,
      generated.height,
      bpp,
    );
    assert.equal(inspectIco(ico)[0]?.sourceKind, 'dib');
    const expectedPng = await sharp(generated.expected, {
      raw: { width: generated.width, height: generated.height, channels: 4 },
    })
      .png()
      .toBuffer();
    assert.equal(
      createHash('sha256').update(expectedPng).digest('hex'),
      'ef7740ec3c755334dfae49aa2d1d86a5e01dbad4ea5a3d3e46fd84cc8bfca2a6',
      `${bpp}-bit fixed expected PNG`,
    );
    const expectedRgba = new Uint8Array(
      await sharp(expectedPng).ensureAlpha().raw().toBuffer(),
    );
    assert.deepEqual(
      decodeIcoDibToRgba(generated.payload, generated.width, generated.height),
      expectedRgba,
      `${bpp}-bit DIB`,
    );
  }
});

test('ICO 32-bit DIB oracle applies a valid transparency mask and rejects a truncated mask', () => {
  const generated = dibFixture(32);
  const masked = Uint8Array.from(generated.payload);
  const xorRowBytes = Math.ceil((generated.width * 32) / 32) * 4;
  const andRowBytes = Math.ceil(generated.width / 32) * 4;
  const andOffset = 40 + xorRowBytes * generated.height;
  const topMaskRow = andOffset + andRowBytes * (generated.height - 1);
  masked[topMaskRow] = 0x80;

  const rgba = decodeIcoDibToRgba(masked, generated.width, generated.height);
  assert.equal(rgba[3], 0);
  assert.equal(rgba[7], 255);
  assert.throws(
    () =>
      decodeIcoDibToRgba(
        masked.subarray(0, masked.byteLength - 1),
        generated.width,
        generated.height,
      ),
    /pixel payload is truncated/i,
  );
});

test('ICO output verifier rejects same-size changed pixels', () => {
  assert.throws(
    () =>
      verifyIcoDecodedOutput({
        expected: {
          width: 1,
          height: 1,
          rgba: Uint8Array.of(0, 0, 253, 255),
        },
        actual: {
          width: 1,
          height: 1,
          rgba: Uint8Array.of(253, 0, 0, 255),
        },
      }),
    /pixels differ/i,
  );
});

test('ICO Worker verification compares selected source and output before returning', async () => {
  const source = Uint8Array.of(1);
  const output = Uint8Array.of(2);
  const decoded = new Map<Uint8Array, Uint8Array>([
    [source, Uint8Array.of(0, 0, 253, 255)],
    [output, Uint8Array.of(0, 0, 253, 255)],
  ]);
  await verifyIcoConversionResult(
    {
      png: output,
      width: 1,
      height: 1,
      selectedIndex: 0,
      sourceKind: 'png',
      sourceBytes: source,
    },
    async (bytes) => ({ width: 1, height: 1, rgba: decoded.get(bytes)! }),
  );
  decoded.set(output, Uint8Array.of(253, 0, 0, 255));
  await assert.rejects(
    verifyIcoConversionResult(
      {
        png: output,
        width: 1,
        height: 1,
        selectedIndex: 0,
        sourceKind: 'png',
        sourceBytes: source,
      },
      async (bytes) => ({ width: 1, height: 1, rgba: decoded.get(bytes)! }),
    ),
    /pixels differ/i,
  );
});
