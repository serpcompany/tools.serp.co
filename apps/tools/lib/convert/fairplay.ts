// Copy-protected M4P files (#267). Apple sold most iTunes Store songs as M4P
// files protected by FairPlay until 2009, and Apple Music downloads still
// are: their audio is encrypted for the account that has them. FFmpeg
// can't decrypt it, so M4P to MP3 refuses a protected file before FFmpeg
// loads, with a message that says why. An unprotected M4P is an M4A under
// another name, and converts.
//
// An MP4 declares protection in its sample descriptions
// (moov/trak/mdia/minf/stbl/stsd): FairPlay audio is a `drms` sample entry
// (`drmi` for video), and any protection scheme puts a `sinf` box inside the
// entry, as Common Encryption's `enca` and `encv` entries do.

const PROTECTED_ENTRIES = new Set(["drms", "drmi", "enca", "encv"]);
// The boxes on the way from the top of the file to the sample descriptions.
const PATH = ["moov", "trak", "mdia", "minf", "stbl", "stsd"];

export function copyProtectedMessage(to: string): string {
  return (
    "This M4P file is copy-protected (Apple's FairPlay, used on Apple Music downloads and older iTunes Store " +
    `songs), so it can't be converted to ${to.toUpperCase()}. Only unprotected M4P files convert.`
  );
}

type Box = { type: string; body: number; end: number };

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function typeAt(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

// The boxes between `start` and `end`, in order. A box that runs past `end`
// (a file cut short) is given up to `end`, and the walk stops after it; a
// size smaller than its own header stops the walk.
function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const found: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = uint32(bytes, offset);
    let body = offset + 8;
    if (size === 1) {
      if (offset + 16 > end) break;
      size = uint32(bytes, offset + 8) * 2 ** 32 + uint32(bytes, offset + 12);
      body = offset + 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < body - offset) break;
    found.push({ type: typeAt(bytes, offset + 4), body, end: Math.min(offset + size, end) });
    offset += size;
  }
  return found;
}

// Whether a sample entry holds a `sinf` box. Its children follow fields
// whose length depends on the kind of track and the entry's version, so
// every offset is tried, and a match must fit inside the entry.
function holdsSinf(bytes: Uint8Array, entry: Box): boolean {
  for (let offset = entry.body; offset + 8 <= entry.end; offset += 1) {
    // "sinf", compared byte by byte: a crafted entry can be the whole file.
    if (bytes[offset + 4] !== 0x73 || bytes[offset + 5] !== 0x69 || bytes[offset + 6] !== 0x6e || bytes[offset + 7] !== 0x66) {
      continue;
    }
    const size = uint32(bytes, offset);
    if (size >= 8 && offset + size <= entry.end) return true;
  }
  return false;
}

// Whether an MP4 file's tracks are copy-protected. A file that isn't an MP4,
// or is cut short before its sample descriptions, isn't: FFmpeg says what
// is wrong with it.
export function isCopyProtected(bytes: Uint8Array): boolean {
  let level = [{ type: "", body: 0, end: bytes.length }];
  for (const type of PATH) {
    level = level.flatMap((parent) => boxes(bytes, parent.body, parent.end).filter((box) => box.type === type));
  }
  // stsd: version and flags, an entry count, then the entries.
  return level.some((stsd) =>
    boxes(bytes, stsd.body + 8, stsd.end).some((entry) => PROTECTED_ENTRIES.has(entry.type) || holdsSinf(bytes, entry)),
  );
}
