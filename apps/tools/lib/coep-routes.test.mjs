import assert from "node:assert/strict";
import process from "node:process";
import test from "node:test";

const TRANSCRIPTION_ROUTES = [
  "/audio-to-text",
  "/audio-to-transcript",
  "/mp3-to-transcript",
  "/mp4-to-transcript",
  "/tiktok-to-transcript",
  "/video-to-transcript",
  "/youtube-to-transcript",
  "/youtube-to-transcript-generator",
];

async function isolatedRoutes(singleThread) {
  const previous = process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD;
  process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD = singleThread;
  try {
    const url = new URL("../next.config.mjs", import.meta.url);
    url.search = `single-thread=${singleThread}`;
    const { default: config } = await import(url.href);
    const rules = await config.headers();
    return new Set(
      rules
        .filter((rule) =>
          rule.headers.some(
            (header) =>
              header.key === "Cross-Origin-Embedder-Policy" &&
              header.value === "require-corp",
          ),
        )
        .map((rule) => rule.source.replace(/\/:path\*$/, "")),
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD;
    else process.env.NEXT_PUBLIC_FFMPEG_SINGLE_THREAD = previous;
  }
}

// Chrome refuses a dedicated Worker script without a COEP header when the
// page sends COEP: require-corp. The transcription and FFmpeg Worker scripts
// carry no COEP header, so isolating these pages hangs transcription.
test("single-threaded builds leave transcription pages unisolated", async () => {
  const routes = await isolatedRoutes("true");
  for (const route of TRANSCRIPTION_ROUTES) {
    assert.equal(routes.has(route), false, `${route} must not send COEP`);
  }
});

test("multi-threaded builds still isolate transcription pages with FFmpeg pages", async () => {
  const routes = await isolatedRoutes("false");
  for (const route of TRANSCRIPTION_ROUTES) {
    assert.equal(routes.has(route), true, `${route} must send COEP`);
  }
});
