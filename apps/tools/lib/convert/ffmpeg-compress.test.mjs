import test from "node:test";
import assert from "node:assert/strict";

import { compressWithFFmpeg } from "./ffmpeg-compress.ts";

// Stands in for @ffmpeg/ffmpeg: writeFile posts the bytes to FFmpeg's worker
// with their buffer in the transfer list, which detaches the caller's buffer.
function fakeFFmpeg({ outputBytes }) {
  const files = new Map();
  return {
    files,
    async writeFile(name, data) {
      files.set(name, structuredClone(data, { transfer: [data.buffer] }));
      return true;
    },
    async readFile(name) {
      if (!files.has(name)) throw new Error(`no such file: ${name}`);
      return files.get(name).slice();
    },
    async deleteFile(name) {
      files.delete(name);
      return true;
    },
    async exec(args) {
      files.set(args.at(-1), new Uint8Array(outputBytes).fill(7));
      return 0;
    },
    on() {},
    off() {},
  };
}

const bytes = (length) => new Uint8Array(length).map((_, i) => i % 251).buffer;

test("a compressor that can't shrink the file returns the original bytes, not an empty file", async () => {
  const input = bytes(1000);
  const expected = new Uint8Array(input.slice(0));
  const ff = fakeFFmpeg({ outputBytes: 1200 });

  const result = await compressWithFFmpeg(ff, input, "mp3", { quality: 0.7 });

  assert.equal(result.byteLength, 1000);
  assert.deepEqual(new Uint8Array(result), expected);
});

test("a compressor returns the smaller output and cleans up FFmpeg's files", async () => {
  const ff = fakeFFmpeg({ outputBytes: 400 });

  const result = await compressWithFFmpeg(ff, bytes(1000), "mp4", { quality: 0.7 });

  assert.equal(result.byteLength, 400);
  assert.deepEqual(new Uint8Array(result), new Uint8Array(400).fill(7));
  assert.equal(ff.files.size, 0);
});

test("a failed FFmpeg run is an error, not a saved file", async () => {
  const ff = fakeFFmpeg({ outputBytes: 10 });
  ff.exec = async () => 1;

  await assert.rejects(compressWithFFmpeg(ff, bytes(100), "wav", {}), /exit code 1/);
});
