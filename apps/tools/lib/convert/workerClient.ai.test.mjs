import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertWithWorker } from "./workerClient.ts";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../benchmarks/fixtures");
const read = (name) => {
  const bytes = readFileSync(path.join(fixtures, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

test("AI to PDF saves the PDF that a PDF-compatible AI file already is", async () => {
  const ai = read("sample.ai");
  const expected = new Uint8Array(ai.slice(0));

  const result = await convertWithWorker({ worker: undefined, from: "ai", to: "pdf", buf: ai });

  assert.equal(result.kind, "single");
  assert.deepEqual(new Uint8Array(result.buffer), expected);
});

test("AI to PDF explains when the AI file has no PDF inside", async () => {
  const legacy = new TextEncoder().encode("%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator(R) 8.0\n").buffer;

  await assert.rejects(
    convertWithWorker({ worker: undefined, from: "ai", to: "pdf", buf: legacy }),
    /PDF Compatible/,
  );
});
