import assert from "node:assert/strict";
import test from "node:test";

import { createPdfPageRenderer } from "./pdf.ts";

test("PDF rendering cancellation stops the active render and destroys the document", async () => {
  let renderCancelled = 0;
  let destroyed = 0;
  const renderPages = createPdfPageRenderer({
    async loadPdfjs() {
      return {
        GlobalWorkerOptions: { workerSrc: "" },
        getDocument() {
          return {
            promise: Promise.resolve({
              numPages: 1,
              async getPage() {
                return {
                  getViewport: () => ({ width: 1, height: 1 }),
                  render() {
                    return {
                      promise: new Promise<void>(() => {}),
                      cancel() {
                        renderCancelled += 1;
                      },
                    };
                  },
                };
              },
              async destroy() {
                destroyed += 1;
              },
            }),
          };
        },
      };
    },
    createCanvas() {
      return {
        getContext() {
          return {
            fillStyle: "",
            fillRect() {},
          };
        },
        async convertToBlob() {
          return new Blob([new Uint8Array([1])], { type: "image/png" });
        },
      } as unknown as OffscreenCanvas;
    },
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  const started = performance.now();

  await assert.rejects(
    renderPages(new ArrayBuffer(8), undefined, "png", controller.signal),
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );

  assert.ok(performance.now() - started < 150);
  assert.equal(renderCancelled, 1);
  assert.equal(destroyed, 1);
});

test("PDF rendering destroys the document when page acquisition fails", async () => {
  let destroyed = 0;
  const renderPages = createPdfPageRenderer({
    async loadPdfjs() {
      return {
        GlobalWorkerOptions: { workerSrc: "" },
        getDocument() {
          return {
            promise: Promise.resolve({
              numPages: 1,
              async getPage() {
                throw new Error("page failed");
              },
              async destroy() {
                destroyed += 1;
              },
            }),
          };
        },
      };
    },
    createCanvas() {
      throw new Error("canvas should not be created");
    },
  });

  await assert.rejects(renderPages(new ArrayBuffer(8)), /page failed/);
  assert.equal(destroyed, 1);
});
