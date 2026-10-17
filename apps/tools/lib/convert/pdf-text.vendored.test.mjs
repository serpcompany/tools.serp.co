import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

// pdf-text.test.mjs again, on the pdf.js the browser loads (the copy in
// public/vendor/pdfjs) in place of Node's pdfjs-dist, a different version,
// so the converter can't pass on one and break on the other unseen.
const installed = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const vendor = new URL("../../public/vendor/pdfjs/", import.meta.url).href;
// Its Node polyfills (DOMMatrix and others), from where pdfjs-dist has them.
const canvas = pathToFileURL(createRequire(installed).resolve("@napi-rs/canvas")).href;
// Each module whose pdf.js import was redirected to the vendored copy.
const redirected = new Set();
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "pdfjs-dist/legacy/build/pdf.mjs") {
      redirected.add(context.parentURL);
      return { url: `${vendor}pdf.min.mjs`, format: "module", shortCircuit: true };
    }
    if (specifier === "@napi-rs/canvas" && context.parentURL?.startsWith(vendor)) {
      return { url: canvas, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

// In Node, pdf.js runs its worker's code in this thread: the vendored worker's.
globalThis.pdfjsWorker = await import(`${vendor}pdf.worker.min.js`);
const { version } = await import("pdfjs-dist/legacy/build/pdf.mjs");

const tests = new URL("./pdf-text.test.mjs", import.meta.url).href;

describe(`on the browser's pdf.js ${version} (public/vendor/pdfjs)`, async () => {
  // Runs after the import below has loaded pdf-text.test.mjs. If that file
  // imports pdf.js by any other path, nothing redirects it and it would test
  // Node's pdfjs-dist again under this title.
  test("pdf-text.test.mjs imports the vendored pdf.js", () => {
    assert.ok(redirected.has(tests), `pdf-text.test.mjs's pdf.js import wasn't redirected to ${vendor}pdf.min.mjs`);
  });
  await import("./pdf-text.test.mjs");
});
