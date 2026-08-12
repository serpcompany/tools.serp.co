import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateCloudflareBuildProvenance,
  writeCloudflareBuildProvenance,
} from "./lib/cloudflare-build-provenance.mjs";

const REVISION = "a".repeat(40);

function fixtureApp(t) {
  const appRoot = mkdtempSync(path.join(tmpdir(), "tools-cloudflare-build-"));
  t.after(() => rmSync(appRoot, { recursive: true, force: true }));
  const chunks = path.join(
    appRoot,
    ".open-next",
    "assets",
    "_next",
    "static",
    "chunks",
  );
  mkdirSync(chunks, { recursive: true });
  writeFileSync(
    path.join(appRoot, ".open-next", "worker.js"),
    "generated Cloudflare worker",
  );
  const chunkPath = path.join(chunks, "transcription.1234567890abcdef.js");
  writeFileSync(chunkPath, 'model = "Xenova/whisper-tiny"');
  writeFileSync(
    path.join(chunks, "ffmpeg-fedcba0987654321.js"),
    "self.createFFmpegCore = factory",
  );
  return { appRoot, chunkPath };
}

test("canonical build provenance binds the exact transcription chunk to its clean revision", (t) => {
  const { appRoot } = fixtureApp(t);
  writeCloudflareBuildProvenance({ appRoot, revision: REVISION, clean: true });

  assert.deepEqual(
    validateCloudflareBuildProvenance({
      appRoot,
      revision: REVISION,
      headRevision: REVISION,
      clean: true,
    }),
    {
      ffmpegWorkerChunkPath: "/_next/static/chunks/ffmpeg-fedcba0987654321.js",
      transcriptionWorkerChunkPath:
        "/_next/static/chunks/transcription.1234567890abcdef.js",
    },
  );
});

test("canary provenance fails closed for a stale or mismatched build", (t) => {
  const { appRoot, chunkPath } = fixtureApp(t);
  writeCloudflareBuildProvenance({ appRoot, revision: REVISION, clean: true });

  writeFileSync(chunkPath, 'model = "Xenova/whisper-tiny"; stale = true');
  assert.throws(
    () =>
      validateCloudflareBuildProvenance({
        appRoot,
        revision: REVISION,
        headRevision: REVISION,
        clean: true,
      }),
    /digest|stale/i,
  );
  assert.throws(
    () =>
      validateCloudflareBuildProvenance({
        appRoot,
        revision: "b".repeat(40),
        headRevision: "b".repeat(40),
        clean: true,
      }),
    /revision/i,
  );
  assert.throws(
    () =>
      validateCloudflareBuildProvenance({
        appRoot,
        revision: REVISION,
        headRevision: REVISION,
        clean: false,
      }),
    /clean/i,
  );
});
