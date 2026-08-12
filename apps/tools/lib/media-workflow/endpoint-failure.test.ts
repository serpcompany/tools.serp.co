import assert from "node:assert/strict";
import test from "node:test";

import { createProductionMediaEndpoint } from "./media-endpoint.ts";

test("the endpoint maps only an explicit extensionRequired response to structured recovery", async () => {
  const endpoint = createProductionMediaEndpoint({
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: "This source requires browser integration.",
          extensionRequired: true,
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      ),
  });

  await assert.rejects(
    endpoint.open(
      {
        consumer: "downloader",
        mode: "video",
        url: "https://source.example/watch/1",
      },
      new AbortController().signal,
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Download failed (403): This source requires browser integration.");
      assert.deepEqual(
        (error as Error & { recovery?: unknown }).recovery,
        { kind: "browser-extension-required" },
      );
      return true;
    },
  );
});

test("ordinary endpoint errors make no browser-extension recovery claim", async (t) => {
  for (const response of [
    new Response(JSON.stringify({ error: "Upstream unavailable" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
    new Response("not json", { status: 403 }),
  ]) {
    await t.test(String(response.status), async () => {
      const endpoint = createProductionMediaEndpoint({
        fetch: async () => response,
      });

      await assert.rejects(
        endpoint.open(
          {
            consumer: "downloader",
            mode: "video",
            url: "https://source.example/watch/1",
          },
          new AbortController().signal,
        ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(
            (error as Error & { recovery?: unknown }).recovery,
            undefined,
          );
          return true;
        },
      );
    });
  }
});

test("downloader and transcription clients prefer the encoded Unicode filename", async (t) => {
  for (const consumer of ["downloader", undefined] as const) {
    await t.test(consumer ?? "transcription", async () => {
      const endpoint = createProductionMediaEndpoint({
        fetch: async () =>
          new Response(new Uint8Array([1]), {
            headers: {
              "content-type": "audio/mpeg",
              "x-media-extension": "mp3",
              "x-media-filename": "Tokyo - cafe music.mp3",
              "x-media-filename-encoded":
                "%E6%9D%B1%E4%BA%AC%20%E2%80%94%20caf%C3%A9%20%F0%9F%8E%B5.mp3",
            },
          }),
      });

      const response = await endpoint.open(
        {
          ...(consumer ? { consumer } : {}),
          mode: "audio",
          url: "https://source.example/watch/1",
        },
        new AbortController().signal,
      );

      assert.equal(response.fileName, "東京 — café 🎵.mp3");
    });
  }
});
