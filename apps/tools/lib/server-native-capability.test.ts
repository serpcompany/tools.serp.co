import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  dispatchServerNativeRequest,
  projectServerNativeCapabilities,
} from "./server-native-capability.ts";

const unavailable = {
  available: false as const,
  reason: "Server-native processing is unavailable in this runtime.",
};

test("an unavailable server-native capability returns the stable contract before loading or invoking an engine", async () => {
  let loads = 0;
  let invocations = 0;
  const response = await dispatchServerNativeRequest({
    request: new Request("https://tools.example/api/video-convert", {
      method: "POST",
      body: new Uint8Array([1, 2, 3]),
    }),
    operation: "video-convert",
    capability: unavailable,
    loadHandler: async () => {
      loads += 1;
      return async () => {
        invocations += 1;
        return new Response("false success");
      };
    },
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), {
    code: "server-native-unavailable",
    error: "Server-native processing is unavailable in this runtime.",
    capability: {
      operation: "video-convert",
      available: false,
    },
  });
  assert.equal(loads, 0);
  assert.equal(invocations, 0);
});

test("a native route import failure is translated to the same stable unavailable response", async () => {
  const response = await dispatchServerNativeRequest({
    request: new Request("https://tools.example/api/pdf-compress", {
      method: "POST",
      body: new Uint8Array([1]),
    }),
    operation: "pdf-compress",
    capability: { available: true },
    loadHandler: async () => {
      throw new Error("node:child_process is not implemented in workerd");
    },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    code: "server-native-unavailable",
    error: "Server-native processing could not start in this runtime.",
    capability: {
      operation: "pdf-compress",
      available: false,
    },
  });
});

test("the Cloudflare projection marks every server-native route unavailable", () => {
  assert.deepEqual(projectServerNativeCapabilities("unavailable"), {
    "image-compress": unavailable,
    "image-convert": unavailable,
    "video-convert": unavailable,
    "pdf-compress": unavailable,
  });

  const wrangler = readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  );
  assert.match(
    wrangler,
    /"TOOLS_SERP_SERVER_NATIVE_PROCESSORS"\s*:\s*"unavailable"/,
  );
});

test("route entrypoints defer unavailable native dependencies and keep pure image compression isolated", () => {
  const route = (name: string) =>
    readFileSync(
      new URL(`../app/api/${name}/route.ts`, import.meta.url),
      "utf8",
    );

  assert.doesNotMatch(route("image-convert"), /from "node:|from "ffmpeg-static"/);
  assert.doesNotMatch(route("video-convert"), /from "node:|from "ffmpeg-static"/);
  assert.doesNotMatch(route("pdf-compress"), /from "ghostscript-node"/);
  assert.doesNotMatch(route("image-compress"), /from "sharp"/);
  assert.match(route("image-compress"), /from "svgo\/browser"/);
  assert.match(route("image-compress"), /case "svg"/);
});

test("all server-native route boundaries return structured 503 responses in the Worker projection", async () => {
  const previous = process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS;
  process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS = "unavailable";
  try {
    const requests = [
      [
        "image-compress",
        "https://tools.example/api/image-compress?format=avif",
        new Uint8Array([1]),
      ],
      [
        "image-convert",
        "https://tools.example/api/image-convert?from=png&to=jpg",
        new Uint8Array([1]),
      ],
      [
        "video-convert",
        "https://tools.example/api/video-convert?from=mp4&to=mp3",
        new Uint8Array([1]),
      ],
      [
        "pdf-compress",
        "https://tools.example/api/pdf-compress",
        new Uint8Array([1]),
      ],
    ] as const;

    for (const [operation, url, body] of requests) {
      const route = await import(`../app/api/${operation}/route.ts`);
      const response = await route.POST(
        new Request(url, { method: "POST", body }),
      );
      assert.equal(response.status, 503, operation);
      const json = await response.json();
      assert.equal(json.code, "server-native-unavailable", operation);
      assert.deepEqual(json.capability, { operation, available: false });
    }
  } finally {
    if (previous === undefined) {
      delete process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS;
    } else {
      process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS = previous;
    }
  }
});

test("Worker-compatible SVG compression succeeds without the server-native capability", async () => {
  const previous = process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS;
  process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS = "unavailable";
  try {
    const { POST } = await import("../app/api/image-compress/route.ts");
    const response = await POST(
      new Request("https://tools.example/api/image-compress?format=svg", {
        method: "POST",
        headers: { "content-type": "image/svg+xml" },
        body: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.match(await response.text(), /^<svg/);
  } finally {
    if (previous === undefined) {
      delete process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS;
    } else {
      process.env.TOOLS_SERP_SERVER_NATIVE_PROCESSORS = previous;
    }
  }
});
