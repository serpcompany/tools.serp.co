// Seattle FilmWorks SFW: a JPEG with its markers renumbered and its Huffman
// tables left out. ImageMagick's own SFW reader writes the repaired JPEG to a
// temporary file, which fails in the WASM build ("Empty input file"), so this
// repairs it in memory the same way (ImageMagick's coders/sfw.c), and
// ImageMagick reads the result as a JPEG. Its libjpeg-turbo supplies the
// standard Huffman tables for a JPEG without any. The image is stored bottom
// up: the caller flips it.

// SFW marker -> JPEG marker: SOI, APP0, DQT, SOF0, DHT, SOS, EOI.
const MARKERS: Record<number, number> = {
  0xc8: 0xd8, 0xd0: 0xe0, 0xcb: 0xdb, 0xa0: 0xc0, 0xa4: 0xc4, 0xca: 0xda, 0xc9: 0xd9,
};

function indexOf(bytes: Uint8Array, sequence: number[], from: number): number {
  search: for (let index = from; index + sequence.length <= bytes.length; index += 1) {
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (bytes[index + offset] !== sequence[offset]) continue search;
    }
    return index;
  }
  return -1;
}

const NOT_SFW = "This isn't a Seattle FilmWorks image the converter can read.";

// The first image in an SFW file (a later one is its thumbnail), as a JPEG.
export function sfwToJpeg(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(input);
  const renumber = (at: number) => {
    const marker = MARKERS[bytes[at + 1]!];
    if (bytes[at] === 0xff && marker !== undefined) bytes[at + 1] = marker;
  };
  const segmentEnd = (at: number) => at + ((bytes[at + 2]! << 8) | bytes[at + 3]!) + 2;

  const start = indexOf(bytes, [0xff, 0xc8, 0xff, 0xd0], 0);
  if (start < 0) throw new Error(NOT_SFW);
  renumber(start);
  renumber(start + 2);
  bytes.set([0x4a, 0x46, 0x49, 0x46, 0, 1, 0], start + 6); // "JFIF\0", version 1.0
  // Renumber each segment up to the start of scan.
  let at = segmentEnd(start + 2);
  for (;;) {
    if (at + 4 > bytes.length - 1) throw new Error(NOT_SFW);
    renumber(at);
    if (bytes[at + 1] === 0xda) break;
    at = segmentEnd(at);
  }
  const end = indexOf(bytes, [0xff, 0xc9], at);
  if (end < 0) throw new Error(NOT_SFW);
  renumber(end);
  return bytes.slice(start, end + 2);
}
