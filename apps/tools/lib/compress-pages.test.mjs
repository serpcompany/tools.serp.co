import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tools = JSON.parse(
  readFileSync(
    new URL("./catalog/tools.json", import.meta.url),
    "utf8",
  ),
);

// compress-heic and compress-heif were retired (#147): no browser encoder
// writes HEIC or HEIF.
const requestedCompressors = [
  { id: "png-to-png", format: "png", route: "/compress-png" },
  { id: "compress-pdf", format: "pdf", route: "/compress-pdf" },
  { id: "compress-mp3", format: "mp3", route: "/compress-mp3" },
  { id: "compress-jpg", format: "jpg", route: "/compress-jpg" },
  { id: "compress-wav", format: "wav", route: "/compress-wav" },
  { id: "compress-gif", format: "gif", route: "/compress-gif" },
  { id: "compress-svg", format: "svg", route: "/compress-svg" },
  { id: "compress-avif", format: "avif", route: "/compress-avif" },
  { id: "compress-tiff", format: "tiff", route: "/compress-tiff" },
  { id: "compress-bmp", format: "bmp", route: "/compress-bmp" },
  { id: "compress-jpeg", format: "jpeg", route: "/compress-jpeg" },
  { id: "compress-webp", format: "webp", route: "/compress-webp" },
  { id: "compress-mp4", format: "mp4", route: "/compress-mp4" },
  { id: "compress-mov", format: "mov", route: "/compress-mov" },
  { id: "compress-mkv", format: "mkv", route: "/compress-mkv" },
  { id: "compress-avi", format: "avi", route: "/compress-avi" },
  { id: "compress-webm", format: "webm", route: "/compress-webm" },
  { id: "compress-flv", format: "flv", route: "/compress-flv" },
  { id: "compress-aac", format: "aac", route: "/compress-aac" },
  { id: "compress-m4a", format: "m4a", route: "/compress-m4a" },
  { id: "compress-ogg", format: "ogg", route: "/compress-ogg" },
  { id: "compress-flac", format: "flac", route: "/compress-flac" },
];

test("requested compressor keyword landers exist in the registry", () => {
  for (const entry of requestedCompressors) {
    const tool = tools.find((candidate) => candidate.id === entry.id);

    assert.ok(tool, `expected ${entry.id} to exist in tools.json`);
    assert.equal(tool.operation, "compress", `expected ${entry.id} to be a compress tool`);
    assert.equal(tool.isActive, true, `expected ${entry.id} to be active`);
    assert.equal(tool.route, entry.route, `expected ${entry.id} route to match slug`);
    assert.equal(tool.from, entry.format, `expected ${entry.id} from format`);
    assert.equal(tool.to, entry.format, `expected ${entry.id} to format`);
  }
});
