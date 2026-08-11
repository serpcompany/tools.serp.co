import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { decodeHeifToRGBA, verifyHeifIdentity } from "./heif.ts";

const globalHeif = globalThis as typeof globalThis & {
  libheif?: () => unknown;
  HeifContext?: new () => unknown;
  HeifDecoder?: new () => unknown;
};

function loadBundledLibheifFactory(): () => unknown {
  const bundleUrl = new URL(
    "../../public/vendor/libheif/libheif-bundle.js",
    import.meta.url,
  );
  const commonJsModule = { exports: {} as unknown };
  const context = {
    require: createRequire(import.meta.url),
    module: commonJsModule,
    exports: {},
    __filename: bundleUrl.pathname,
    __dirname: new URL(".", bundleUrl).pathname,
    process,
    console,
    Buffer,
    TextDecoder,
    TextEncoder,
    URL,
    WebAssembly,
    Uint8Array,
    Uint8ClampedArray,
    ArrayBuffer,
    SharedArrayBuffer,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
  };
  Object.assign(context, { globalThis: context });
  runInNewContext(readFileSync(bundleUrl, "utf8"), context);
  assert.equal(typeof commonJsModule.exports, "function");
  return commonJsModule.exports as () => unknown;
}

test("repository HEIC fixture decodes to actual non-empty pixels through the bundled callback API", async () => {
  const originalImageData = globalThis.ImageData;
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  } as never;
  globalHeif.HeifContext = undefined;
  globalHeif.HeifDecoder = undefined;
  globalHeif.libheif = loadBundledLibheifFactory();
  const source = readFileSync(
    new URL("../../benchmarks/fixtures/sample.heic", import.meta.url),
  );

  try {
    const decoded = await decodeHeifToRGBA(
      source.buffer.slice(
        source.byteOffset,
        source.byteOffset + source.byteLength,
      ) as ArrayBuffer,
    );
    assert.deepEqual([decoded.width, decoded.height], [96, 96]);
    assert.equal(decoded.data.some((channel) => channel !== 0), true);
  } finally {
    globalThis.ImageData = originalImageData;
  }
});

test("libheif context decoding bounds allocation and releases every handle despite cleanup failure", async () => {
  const freed: string[] = [];
  let displayed = false;
  globalHeif.HeifContext = class {
    read() {}
    getPrimaryImageHandle() {
      return {
        decode() {
          return {
            get_width: () => 100_000,
            get_height: () => 100_000,
            display() {
              displayed = true;
            },
            free() {
              freed.push("image");
              throw new Error("image cleanup failed");
            },
          };
        },
        free() {
          freed.push("handle");
        },
      };
    }
    free() {
      freed.push("context");
    }
  } as never;

  await assert.rejects(decodeHeifToRGBA(new ArrayBuffer(8)), /safety limit/i);
  assert.equal(displayed, false);
  assert.deepEqual(freed, ["image", "handle", "context"]);
});

test("libheif callback failure rejects and still frees context resources", async () => {
  const originalImageData = globalThis.ImageData;
  const freed: string[] = [];
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  } as never;
  globalHeif.HeifContext = class {
    read() {}
    getPrimaryImageHandle() {
      return {
        decode() {
          return {
            get_width: () => 1,
            get_height: () => 1,
            display(_image: ImageData, callback: (result: unknown) => void) {
              callback(null);
            },
            free() {
              freed.push("image");
            },
          };
        },
        free() {
          freed.push("handle");
        },
      };
    }
    free() {
      freed.push("context");
    }
  } as never;
  try {
    await assert.rejects(decodeHeifToRGBA(new ArrayBuffer(8)), /display/i);
  } finally {
    globalThis.ImageData = originalImageData;
  }
  assert.deepEqual(freed, ["image", "handle", "context"]);
});

test("libheif callback decoding aborts promptly and frees context resources", async () => {
  const originalImageData = globalThis.ImageData;
  const freed: string[] = [];
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  } as never;
  let callbackAfterFree = false;
  globalHeif.HeifContext = class {
    read() {}
    getPrimaryImageHandle() {
      return {
        decode() {
          return {
            get_width: () => 1,
            get_height: () => 1,
            display(_image: ImageData, callback: (result: unknown) => void) {
              setTimeout(() => {
                callbackAfterFree = freed.length > 0;
                callback(_image);
              }, 30);
            },
            free() {
              freed.push("image");
            },
          };
        },
        free() {
          freed.push("handle");
        },
      };
    }
    free() {
      freed.push("context");
    }
  } as never;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const started = performance.now();
  try {
    await assert.rejects(
      decodeHeifToRGBA(new ArrayBuffer(8), controller.signal),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
  } finally {
    globalThis.ImageData = originalImageData;
  }
  assert.ok(performance.now() - started < 150);
  assert.deepEqual(freed, []);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(callbackAfterFree, false);
  assert.deepEqual(freed, ["image", "handle", "context"]);
});

test("libheif callback decoding eventually frees context resources when a decoder omits its callback", async () => {
  const originalImageData = globalThis.ImageData;
  const freed: string[] = [];
  globalThis.ImageData = class {
    constructor() {}
  } as never;
  globalHeif.HeifContext = class {
    read() {}
    getPrimaryImageHandle() {
      return {
        decode() {
          return {
            get_width: () => 1,
            get_height: () => 1,
            display() {},
            free() {
              freed.push("image");
            },
          };
        },
        free() {
          freed.push("handle");
        },
      };
    }
    free() {
      freed.push("context");
    }
  } as never;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5);

  try {
    await assert.rejects(
      decodeHeifToRGBA(new ArrayBuffer(8), controller.signal),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError",
    );
    assert.deepEqual(freed, []);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(freed, ["image", "handle", "context"]);
  } finally {
    globalThis.ImageData = originalImageData;
  }
});

test("libheif decoder decoding releases every returned image when display and cleanup fail", async () => {
  const freed: string[] = [];
  globalHeif.HeifContext = undefined;
  globalHeif.HeifDecoder = class {
    decode() {
      return [
        {
          get_width: () => 1,
          get_height: () => 1,
          display(
            rgba: Uint8ClampedArray,
            width: number,
            height: number,
            options: unknown,
          ) {
            assert.equal(rgba.byteLength, width * height * 4);
            assert.ok(options);
            throw new Error("display failed");
          },
          free() {
            freed.push("primary");
            throw new Error("primary cleanup failed");
          },
        },
        {
          get_width: () => 1,
          get_height: () => 1,
          display() {},
          free() {
            freed.push("secondary");
          },
        },
      ];
    }
  } as never;

  await assert.rejects(decodeHeifToRGBA(new ArrayBuffer(8)), /display failed/);
  assert.deepEqual(freed, ["primary", "secondary"]);
});

test("libheif context identity rejection attempts every release when image cleanup throws", async () => {
  const freed: string[] = [];
  globalHeif.HeifContext = class {
    read() {}
    getPrimaryImageHandle() {
      return {
        decode() {
          return {
            get_width: () => 100_000,
            get_height: () => 100_000,
            display() {},
            free() {
              freed.push("image");
              throw new Error("image cleanup failed");
            },
          };
        },
        free() {
          freed.push("handle");
        },
      };
    }
    free() {
      freed.push("context");
    }
  } as never;

  assert.equal(await verifyHeifIdentity(new ArrayBuffer(8)), false);
  assert.deepEqual(freed, ["image", "handle", "context"]);
});

test("libheif decoder identity rejection attempts every image release when cleanup throws", async () => {
  const freed: string[] = [];
  globalHeif.HeifContext = undefined;
  globalHeif.HeifDecoder = class {
    decode() {
      return [
        {
          get_width: () => 100_000,
          get_height: () => 100_000,
          display() {},
          free() {
            freed.push("primary");
            throw new Error("primary cleanup failed");
          },
        },
        {
          get_width: () => 1,
          get_height: () => 1,
          display() {},
          free() {
            freed.push("secondary");
          },
        },
      ];
    }
  } as never;

  assert.equal(await verifyHeifIdentity(new ArrayBuffer(8)), false);
  assert.deepEqual(freed, ["primary", "secondary"]);
});
