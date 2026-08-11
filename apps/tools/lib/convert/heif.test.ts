import assert from "node:assert/strict";
import test from "node:test";

import { decodeHeifToRGBA } from "./heif.ts";

const globalHeif = globalThis as typeof globalThis & {
  HeifContext?: new () => unknown;
  HeifDecoder?: new () => unknown;
};

test("libheif context decoding bounds allocation and frees every acquired handle", async () => {
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

test("libheif decoder decoding frees every returned image on failure", async () => {
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
