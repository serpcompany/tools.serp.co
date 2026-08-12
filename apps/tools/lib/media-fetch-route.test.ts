import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { POST } from "../app/api/media-fetch/route.ts";

const youtubeUrls = [
  "https://www.youtube.com/watch?v=3Is2P90qVa0",
  "https://music.youtube.com/watch?v=3Is2P90qVa0",
  "https://m.youtube.com/watch?v=3Is2P90qVa0",
  "https://youtu.be/3Is2P90qVa0",
  "https://www.youtube-nocookie.com/embed/3Is2P90qVa0",
  "https://subdomain.youtube-nocookie.com/embed/3Is2P90qVa0",
];

test("media-fetch rejects every YouTube-family host at the real route boundary", async () => {
  for (const url of youtubeUrls) {
    const response = await POST(
      new Request("https://tools.example/api/media-fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "audio", url }),
      }),
    );

    assert.equal(response.status, 422, url);
    assert.deepEqual(await response.json(), {
      code: "youtube-unsupported",
      error:
        "YouTube links are not supported right now. Upload the file or use a direct public audio or video file URL.",
    });
  }
});

test("media-fetch leaves YouTube handling to the downloader contract", async (t) => {
  const originalFetch = globalThis.fetch;
  const previousCapability = process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousCapability === undefined) {
      delete process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS;
    } else {
      process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS = previousCapability;
    }
  });
  process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS = "unavailable";
  globalThis.fetch = async () =>
    new Response("<html>not direct media</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  const response = await POST(
    new Request("https://tools.example/api/media-fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        consumer: "downloader",
        mode: "video",
        url: "https://www.youtube.com/watch?v=3Is2P90qVa0",
      }),
    }),
  );

  assert.notEqual(response.status, 422);
  assert.deepEqual(await response.json(), {
    code: "server-native-unavailable",
    error: "Server-native processing is unavailable in this runtime.",
    capability: { operation: "media-extract", available: false },
  });
});

test("media-fetch route defers native yt-dlp loading behind the capability boundary", () => {
  const routeSource = readFileSync(
    new URL("../app/api/media-fetch/route.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(routeSource, /from "youtube-dl-exec"/);
  assert.doesNotMatch(routeSource, /from "node:(?:fs|os|path)"/);
  assert.match(routeSource, /loadServerNativeEngine/);
  assert.match(routeSource, /import\("\.\/native-ytdlp\.ts"\)/);
});

test("media-fetch preserves direct public audio at the real route boundary", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04]), {
      status: 200,
      headers: {
        "content-length": "4",
        "content-type": "audio/mpeg",
      },
    });

  const response = await POST(
    new Request("https://tools.example/api/media-fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "audio",
        url: "https://93.184.216.34/speech.mp3",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "audio/mpeg");
  assert.equal(response.headers.get("x-media-extension"), "mp3");
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    new Uint8Array([0x49, 0x44, 0x33, 0x04]),
  );
});

test("media-fetch refuses native extraction for a non-direct URL in the Worker projection", async (t) => {
  const originalFetch = globalThis.fetch;
  const previousCapability = process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousCapability === undefined) {
      delete process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS;
    } else {
      process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS = previousCapability;
    }
  });
  process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS = "unavailable";
  globalThis.fetch = async () =>
    new Response("<html>not direct media</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

  const response = await POST(
    new Request("https://tools.example/api/media-fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "audio",
        url: "https://93.184.216.34/watch/not-direct",
      }),
    }),
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "server-native-unavailable",
    error: "Server-native processing is unavailable in this runtime.",
    capability: { operation: "media-extract", available: false },
  });
});
