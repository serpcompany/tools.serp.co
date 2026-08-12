import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CLOUDFLARE_BUILD_PROVENANCE = path.join(
  ".open-next",
  "tools-serp-build-provenance.json",
);

function digestFile(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function generatedChunk(appRoot, marker, label) {
  const assetsRoot = path.join(appRoot, ".open-next", "assets");
  const chunksRoot = path.join(assetsRoot, "_next", "static", "chunks");
  if (!fs.existsSync(chunksRoot)) {
    throw new Error("Generated Cloudflare chunks are missing");
  }
  const matches = fs
    .readdirSync(chunksRoot, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((filePath) => fs.readFileSync(filePath, "utf8").includes(marker));
  if (matches.length !== 1) {
    throw new Error(
      `Expected one generated ${label} Worker chunk; found ${matches.length}`,
    );
  }
  return {
    filePath: matches[0],
    pathname: `/${path.relative(assetsRoot, matches[0]).split(path.sep).join("/")}`,
  };
}

export function writeCloudflareBuildProvenance({ appRoot, revision, clean }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error("Cloudflare build provenance requires a full Git revision");
  }
  const workerPath = path.join(appRoot, ".open-next", "worker.js");
  const transcriptionChunk = generatedChunk(
    appRoot,
    "Xenova/whisper-tiny",
    "transcription",
  );
  const ffmpegChunk = generatedChunk(appRoot, "createFFmpegCore", "FFmpeg");
  const provenance = {
    schemaVersion: 1,
    revision,
    clean,
    worker: digestFile(workerPath),
    transcriptionWorkerChunk: {
      path: transcriptionChunk.pathname,
      ...digestFile(transcriptionChunk.filePath),
    },
    ffmpegWorkerChunk: {
      path: ffmpegChunk.pathname,
      ...digestFile(ffmpegChunk.filePath),
    },
  };
  fs.writeFileSync(
    path.join(appRoot, CLOUDFLARE_BUILD_PROVENANCE),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  return provenance;
}

function requireMatchingDigest(filePath, expected, label) {
  const actual = digestFile(filePath);
  if (actual.bytes !== expected?.bytes || actual.sha256 !== expected?.sha256) {
    throw new Error(`Cloudflare build ${label} digest is stale`);
  }
}

export function validateCloudflareBuildProvenance({
  appRoot,
  revision,
  headRevision,
  clean,
}) {
  if (!clean) {
    throw new Error("Deployed canary requires a clean working tree");
  }
  if (headRevision !== revision) {
    throw new Error("--revision must equal the checked-out HEAD commit");
  }
  const provenancePath = path.join(appRoot, CLOUDFLARE_BUILD_PROVENANCE);
  if (!fs.existsSync(provenancePath)) {
    throw new Error(
      "Missing canonical Cloudflare build provenance; run the exact build first",
    );
  }
  const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8"));
  if (
    provenance.schemaVersion !== 1 ||
    provenance.revision !== revision ||
    provenance.clean !== true
  ) {
    throw new Error(
      "Cloudflare build provenance does not match the clean requested revision",
    );
  }
  requireMatchingDigest(
    path.join(appRoot, ".open-next", "worker.js"),
    provenance.worker,
    "Worker",
  );
  for (const [label, artifact] of [
    ["transcription chunk", provenance.transcriptionWorkerChunk],
    ["FFmpeg chunk", provenance.ffmpegWorkerChunk],
  ]) {
    if (
      !/^\/_next\/static\/chunks\/[a-zA-Z0-9_./-]+\.js$/.test(
        artifact?.path ?? "",
      )
    ) {
      throw new Error(
        `Cloudflare build provenance has an invalid ${label} path`,
      );
    }
    requireMatchingDigest(
      path.join(appRoot, ".open-next", "assets", artifact.path.slice(1)),
      artifact,
      label,
    );
  }
  return {
    ffmpegWorkerChunkPath: provenance.ffmpegWorkerChunk.path,
    transcriptionWorkerChunkPath: provenance.transcriptionWorkerChunk.path,
  };
}
