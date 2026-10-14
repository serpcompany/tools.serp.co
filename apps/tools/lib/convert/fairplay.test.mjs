import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copyProtectedMessage, isCopyProtected } from "./fairplay.ts";
import { convertWithWorker } from "./workerClient.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const bytes = (name) => new Uint8Array(readFileSync(path.join(fixtures, name)));

// An ISO box: a 32-bit size, a type and its body.
function box(type, ...parts) {
  const body = concat(...parts);
  const out = new Uint8Array(8 + body.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const zeros = (length) => new Uint8Array(length);
// An audio sample entry's fixed fields (version 0): 28 bytes before its boxes.
const AUDIO_FIELDS = zeros(28);
// An MP4 with one track whose sample descriptions hold `entries`.
function mp4(...entries) {
  const stsd = box("stsd", zeros(4), new Uint8Array([0, 0, 0, entries.length]), ...entries);
  const moov = box("moov", box("mvhd", zeros(100)), box("trak", box("mdia", box("minf", box("stbl", stsd)))));
  return { ftyp: box("ftyp", new TextEncoder().encode("M4A \0\0\0\0M4A mp42")), moov };
}
const sinf = box("sinf", box("frma", new TextEncoder().encode("mp4a")), box("schm", zeros(4), new TextEncoder().encode("itun"), zeros(4)));

test("Tika's FairPlay test file is protected: a drms entry with a sinf box", () => {
  const tika = bytes("tika-drm.m4p");
  assert.equal(tika.length, 664);
  assert.equal(isCopyProtected(tika), true);
});

test("unprotected MP4 audio and video aren't", () => {
  for (const name of ["sample.m4p", "sample.m4a", "sample.m4b", "sample.m4r", "sample.mp4", "sample.mov", "sample.3gp"]) {
    assert.equal(isCopyProtected(bytes(name)), false, name);
  }
  for (const name of ["sample.mp3", "sample.wav", "not-an-image.bin"]) assert.equal(isCopyProtected(bytes(name)), false, name);
  assert.equal(isCopyProtected(new Uint8Array()), false);
});

test("any protection scheme in a sample entry counts: drms, drmi, enca, encv, or a sinf box", () => {
  const protectedFile = (entry) => {
    const { ftyp, moov } = mp4(entry);
    return isCopyProtected(concat(ftyp, moov));
  };
  assert.equal(protectedFile(box("mp4a", AUDIO_FIELDS, box("esds", zeros(30)))), false);
  assert.equal(protectedFile(box("mp4a", AUDIO_FIELDS, box("esds", zeros(30)), sinf)), true, "an mp4a entry holding a sinf box");
  // A QuickTime version 1 sound entry has 16 more bytes of fields.
  assert.equal(protectedFile(box("mp4a", AUDIO_FIELDS, zeros(16), sinf)), true);
  for (const type of ["drms", "drmi", "enca", "encv"]) assert.equal(protectedFile(box(type, AUDIO_FIELDS)), true, type);
  // "sinf" in the entry's bytes that can't be a box inside it isn't one.
  const fake = box("mp4a", AUDIO_FIELDS, new Uint8Array([0, 0, 0x10, 0, ...new TextEncoder().encode("sinf")]));
  assert.equal(protectedFile(fake), false);
});

test("the sample descriptions are found after the media data, and past 64-bit and open-ended boxes", () => {
  const { ftyp, moov } = mp4(box("drms", AUDIO_FIELDS));
  const mdat = box("mdat", zeros(5000));
  assert.equal(isCopyProtected(concat(ftyp, mdat, moov)), true, "moov after mdat");
  // A 64-bit size: 1, then the size in the 8 bytes after the type.
  const large = concat(new Uint8Array([0, 0, 0, 1]), new TextEncoder().encode("mdat"), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 16 + 40]), zeros(40));
  assert.equal(isCopyProtected(concat(ftyp, large, moov)), true, "after a 64-bit mdat");
  // Size 0: the box runs to the end of the file, so nothing follows it.
  const open = concat(new Uint8Array([0, 0, 0, 0]), new TextEncoder().encode("mdat"), zeros(40));
  assert.equal(isCopyProtected(concat(ftyp, moov, open)), true, "before an open-ended mdat");
  assert.equal(isCopyProtected(concat(ftyp, open, moov)), false, "inside an open-ended mdat is media data");
});

test("a file cut short anywhere is read as far as it goes, without an error", () => {
  const tika = bytes("tika-drm.m4p");
  // The drms entry's header (size and type) ends at byte 368.
  for (let length = 0; length <= tika.length; length += 1) {
    assert.equal(isCopyProtected(tika.subarray(0, length)), length >= 368, `cut at ${length}`);
  }
  // A size smaller than its header ends the walk instead of looping.
  const broken = concat(box("ftyp", zeros(8)), new Uint8Array([0, 0, 0, 4]), new TextEncoder().encode("moov"), zeros(64));
  assert.equal(isCopyProtected(broken), false);
});

test("a huge crafted sample entry is scanned quickly", () => {
  const { ftyp, moov } = mp4(box("mp4a", AUDIO_FIELDS, zeros(32 * 1024 * 1024)));
  const started = performance.now();
  assert.equal(isCopyProtected(concat(ftyp, moov)), false);
  const ms = performance.now() - started;
  assert.ok(ms < 2000, `took ${Math.round(ms)} ms`);
});

test("M4P to MP3 refuses a protected file before FFmpeg loads, and says why", async () => {
  const worker = { postMessage: () => assert.fail("no engine should run") };
  const tika = bytes("tika-drm.m4p");
  await assert.rejects(convertWithWorker({ worker, from: "m4p", to: "mp3", buf: tika.slice().buffer }), {
    telemetryCode: "copy_protected",
    message: copyProtectedMessage("mp3"),
    telemetryMetadata: { from: "m4p", to: "mp3", engine: "ffmpeg-wasm" },
  });
  assert.match(copyProtectedMessage("mp3"), /copy-protected .*can't be converted to MP3\. Only unprotected M4P files convert\.$/);
});
