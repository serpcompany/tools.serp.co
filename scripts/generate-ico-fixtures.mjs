import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fixtures = path.join(root, 'apps/tools/benchmarks/fixtures');
const outputDirectory = path.join(fixtures, 'ico');

function icoPayload(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(14, true);
  const offset = view.getUint32(18, true);
  return bytes.slice(offset, offset + size);
}

function writeDirectoryEntry(view, offset, entry) {
  view.setUint8(offset, entry.width === 256 ? 0 : entry.width);
  view.setUint8(offset + 1, entry.height === 256 ? 0 : entry.height);
  view.setUint8(offset + 2, 0);
  view.setUint8(offset + 3, 0);
  view.setUint16(offset + 4, 1, true);
  view.setUint16(offset + 6, entry.bitsPerPixel, true);
  view.setUint32(offset + 8, entry.bytes.byteLength, true);
  view.setUint32(offset + 12, entry.payloadOffset, true);
}

const dib = icoPayload(
  new Uint8Array(readFileSync(path.join(fixtures, 'sample.ico'))),
);
const png = new Uint8Array(readFileSync(path.join(fixtures, 'sample-2.png')));
const directoryBytes = 6 + 2 * 16;
const entries = [
  {
    width: 96,
    height: 96,
    bitsPerPixel: 24,
    bytes: dib,
    payloadOffset: directoryBytes,
  },
  {
    width: 128,
    height: 80,
    bitsPerPixel: 32,
    bytes: png,
    payloadOffset: directoryBytes + dib.byteLength,
  },
];
const output = new Uint8Array(directoryBytes + dib.byteLength + png.byteLength);
const view = new DataView(output.buffer);
view.setUint16(0, 0, true);
view.setUint16(2, 1, true);
view.setUint16(4, entries.length, true);
entries.forEach((entry, index) =>
  writeDirectoryEntry(view, 6 + index * 16, entry),
);
output.set(dib, entries[0].payloadOffset);
output.set(png, entries[1].payloadOffset);

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(path.join(outputDirectory, 'selection.ico'), output);
