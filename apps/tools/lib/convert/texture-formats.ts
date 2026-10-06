// Readers and writers for formats no browser or ImageMagick build handles:
// Apple ICNS icons and Khronos KTX / KTX2 textures. Everything here runs in
// the browser; the byte-level parts are pure so they can be unit tested.
import {
  createDefaultContainer,
  KHR_DF_CHANNEL_RGBSDA_ALPHA,
  KHR_DF_CHANNEL_RGBSDA_BLUE,
  KHR_DF_CHANNEL_RGBSDA_GREEN,
  KHR_DF_CHANNEL_RGBSDA_RED,
  KHR_DF_MODEL_RGBSDA,
  KHR_DF_SAMPLE_DATATYPE_LINEAR,
  KHR_DF_TRANSFER_SRGB,
  KHR_SUPERCOMPRESSION_NONE,
  read as readKtx2,
  VK_FORMAT_R8G8B8_SRGB,
  VK_FORMAT_R8G8B8_UNORM,
  VK_FORMAT_R8G8B8A8_SRGB,
  VK_FORMAT_R8G8B8A8_UNORM,
  write as writeKtx2,
} from 'ktx-parse';

import type { RGBA } from './heif.ts';

// --- ICNS -------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

// PNG-backed ICNS entry types and their pixel size, largest first.
export const ICNS_PNG_TYPES: ReadonlyArray<[type: string, size: number]> = [
  ['ic10', 1024],
  ['ic09', 512],
  ['ic14', 512],
  ['ic08', 256],
  ['ic13', 256],
  ['ic07', 128],
  ['icp6', 64],
  ['ic12', 64],
  ['icp5', 32],
  ['ic11', 32],
  ['icp4', 16],
];

// The sizes written: one PNG per type, which every macOS since 10.7 reads.
export const ICNS_WRITE_TYPES: ReadonlyArray<[type: string, size: number]> = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
];

const fourCC = (bytes: Uint8Array, offset: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + 4));

export function buildIcns(
  entries: ReadonlyArray<{ type: string; png: Uint8Array }>,
): Uint8Array<ArrayBuffer> {
  const total =
    8 + entries.reduce((sum, entry) => sum + 8 + entry.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set([0x69, 0x63, 0x6e, 0x73]); // "icns"
  view.setUint32(4, total);
  let offset = 8;
  for (const { type, png } of entries) {
    out.set(
      [...type].map((char) => char.charCodeAt(0)),
      offset,
    );
    view.setUint32(offset + 4, 8 + png.length);
    out.set(png, offset + 8);
    offset += 8 + png.length;
  }
  return out;
}

// Returns the largest PNG image stored in an ICNS file.
export function largestIcnsPng(bytes: Uint8Array): Uint8Array {
  if (fourCC(bytes, 0) !== 'icns') throw new Error("This isn't an ICNS file.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pngs = new Map<string, Uint8Array>();
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const type = fourCC(bytes, offset);
    const length = view.getUint32(offset + 4);
    if (length < 8 || offset + length > bytes.length) break;
    const data = bytes.subarray(offset + 8, offset + length);
    if (PNG_SIGNATURE.every((byte, i) => data[i] === byte))
      pngs.set(type, data);
    offset += length;
  }
  for (const [type] of ICNS_PNG_TYPES) {
    const png = pngs.get(type);
    if (png) return png;
  }
  throw new Error(
    "This ICNS file only has legacy (pre-PNG) icon images, which aren't supported.",
  );
}

// --- KTX 1 ------------------------------------------------------------------

const KTX1_IDENTIFIER = [
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
];
const GL_UNSIGNED_BYTE = 0x1401;
const GL_RGB = 0x1907;
const GL_RGBA = 0x1908;
const GL_RGBA8 = 0x8058;

// An uncompressed RGBA8 KTX 1.1 texture with one mip level.
export function encodeKtx1(rgba: RGBA): Uint8Array<ArrayBuffer> {
  const imageSize = rgba.width * rgba.height * 4;
  const out = new Uint8Array(64 + 4 + imageSize);
  const view = new DataView(out.buffer);
  out.set(KTX1_IDENTIFIER);
  const header = [
    0x04030201, // endianness
    GL_UNSIGNED_BYTE, // glType
    1, // glTypeSize
    GL_RGBA, // glFormat
    GL_RGBA8, // glInternalFormat
    GL_RGBA, // glBaseInternalFormat
    rgba.width,
    rgba.height,
    0, // pixelDepth
    0, // numberOfArrayElements
    1, // numberOfFaces
    1, // numberOfMipmapLevels
    0, // bytesOfKeyValueData
  ];
  header.forEach((value, i) => view.setUint32(12 + i * 4, value, true));
  view.setUint32(64, imageSize, true);
  out.set(rgba.data, 68);
  return out;
}

export function decodeKtx1(bytes: Uint8Array): RGBA {
  if (!KTX1_IDENTIFIER.every((byte, i) => bytes[i] === byte)) {
    throw new Error("This isn't a KTX file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = view.getUint32(12, true) === 0x04030201;
  const u32 = (offset: number) => view.getUint32(offset, little);
  const glType = u32(16);
  const glFormat = u32(24);
  const width = u32(36);
  const height = Math.max(1, u32(40));
  if (
    glType !== GL_UNSIGNED_BYTE ||
    (glFormat !== GL_RGBA && glFormat !== GL_RGB)
  ) {
    throw new Error("Compressed or non-8-bit KTX textures aren't supported.");
  }
  const dataOffset = 64 + u32(60) + 4;
  const channels = glFormat === GL_RGBA ? 4 : 3;
  // Rows are padded to 4 bytes.
  const rowBytes = Math.ceil((width * channels) / 4) * 4;
  return toRGBA(bytes.subarray(dataOffset), width, height, channels, rowBytes);
}

// --- KTX 2 ------------------------------------------------------------------

// An uncompressed sRGB RGBA8 KTX 2.0 texture with one mip level.
export function encodeKtx2(rgba: RGBA): Uint8Array<ArrayBuffer> {
  const container = createDefaultContainer();
  container.vkFormat = VK_FORMAT_R8G8B8A8_SRGB;
  container.typeSize = 1;
  container.pixelWidth = rgba.width;
  container.pixelHeight = rgba.height;
  container.levelCount = 1;
  container.supercompressionScheme = KHR_SUPERCOMPRESSION_NONE;
  const levelData = new Uint8Array(rgba.data);
  container.levels = [
    { levelData, uncompressedByteLength: levelData.byteLength },
  ];
  const dfd = container.dataFormatDescriptor[0]!;
  dfd.colorModel = KHR_DF_MODEL_RGBSDA;
  dfd.transferFunction = KHR_DF_TRANSFER_SRGB;
  dfd.bytesPlane = [4, 0, 0, 0, 0, 0, 0, 0];
  dfd.samples = [
    KHR_DF_CHANNEL_RGBSDA_RED,
    KHR_DF_CHANNEL_RGBSDA_GREEN,
    KHR_DF_CHANNEL_RGBSDA_BLUE,
    // Alpha is linear even in an sRGB texture.
    KHR_DF_CHANNEL_RGBSDA_ALPHA | KHR_DF_SAMPLE_DATATYPE_LINEAR,
  ].map((channelType, i) => ({
    bitOffset: i * 8,
    bitLength: 7,
    channelType,
    samplePosition: [0, 0, 0, 0],
    sampleLower: 0,
    sampleUpper: 255,
  }));
  return writeKtx2(container);
}

export function decodeKtx2(bytes: Uint8Array): RGBA {
  const container = readKtx2(bytes);
  const channels =
    container.vkFormat === VK_FORMAT_R8G8B8A8_SRGB ||
    container.vkFormat === VK_FORMAT_R8G8B8A8_UNORM
      ? 4
      : container.vkFormat === VK_FORMAT_R8G8B8_SRGB ||
          container.vkFormat === VK_FORMAT_R8G8B8_UNORM
        ? 3
        : 0;
  if (
    !channels ||
    container.supercompressionScheme !== KHR_SUPERCOMPRESSION_NONE
  ) {
    throw new Error(
      "Compressed KTX2 textures (Basis, BCn, ETC, ASTC) aren't supported yet.",
    );
  }
  const level = container.levels[0];
  if (!level) throw new Error('This KTX2 file has no image data.');
  const width = container.pixelWidth;
  const height = Math.max(1, container.pixelHeight);
  return toRGBA(level.levelData, width, height, channels, width * channels);
}

function toRGBA(
  source: Uint8Array,
  width: number,
  height: number,
  channels: 3 | 4 | number,
  rowBytes: number,
): RGBA {
  if (!width || source.length < rowBytes * (height - 1) + width * channels) {
    throw new Error('The texture data is truncated.');
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = y * rowBytes + x * channels;
      const to = (y * width + x) * 4;
      data[to] = source[from]!;
      data[to + 1] = source[from + 1]!;
      data[to + 2] = source[from + 2]!;
      data[to + 3] = channels === 4 ? source[from + 3]! : 255;
    }
  }
  return { data, width, height };
}
