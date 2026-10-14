// Checks what lib/convert/decode.ts assumes about browsers' image decoders,
// in each Playwright engine (issue #267):
// - each sampled format's 1 x 1 sample decodes in the engines pinned below,
//   and only those, so a browser that has the decoder calls a damaged file
//   damaged, and one without it says it can't open the format;
// - each format decode.ts takes every current browser to decode (it has no
//   sample) decodes in every engine, from its fixture;
// - a damaged file (its first bytes) is called damaged where the engine
//   decodes its format, and "can't open" where it doesn't.
// It runs decode.ts itself, transpiled, in a page on a secure origin, as the
// site's pages are, so ImageDecoder is there in the engines that have it. It
// needs no Worker.
//
//   node scripts/check-browser-decoders.mjs [--engines chromium,firefox,webkit]
//
// Every engine named must be installed (`playwright install`).

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { DECODE_INPUTS, SAMPLED_FORMATS, browserSample } from "../lib/convert/decode.ts";

const playwright = await import("playwright");

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(appRoot, "benchmarks/fixtures");
const ENGINES = ["chromium", "firefox", "webkit"];

// The engines that decode each sampled format, as Playwright 1.57 ships them
// (Chromium 143, Firefox 144, WebKit 26). A Playwright update that changes
// one fails here: update the pin, and decode.ts if every engine now decodes
// the format.
const SAMPLED = {
  avif: ["chromium", "firefox", "webkit"],
  tiff: ["webkit"],
};

// The formats every current browser decodes, by a fixture of each.
const EVERY_BROWSER = {
  jpg: "sample.jpg",
  jpeg: "sample.jpg",
  png: "sample.png",
  gif: "sample.gif",
  webp: "sample.webp",
  bmp: "sample.bmp",
  ico: "sample.ico",
  cur: "sample.cur",
  svg: "sample.svg",
};

// decodeToRGBA reads these with libheif or its own decoders, not the browser.
const NOT_THE_BROWSERS = new Set(["heic", "heif", "ktx", "ktx2", "icns"]);

// A damaged file: the first bytes of a whole one, too few to hold a picture.
const DAMAGED_BYTES = 16;

const ORIGIN = "https://decoders.test";

function parseArgs(argv) {
  const args = { engines: ENGINES };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--engines") args.engines = (argv[++index] ?? "").split(",").filter(Boolean);
    else if (arg !== "--") throw new Error(`Unknown argument: ${arg}`);
  }
  const unknown = args.engines.filter((engine) => !ENGINES.includes(engine));
  if (unknown.length || !args.engines.length) throw new Error(`--engines takes ${ENGINES.join(", ")}`);
  return args;
}

// Every format the browser decodes for decode.ts is sampled or pinned here
// as decoded by every browser, not both.
function checkLists() {
  const problems = [];
  const sampled = [...SAMPLED_FORMATS].sort();
  if (sampled.join() !== Object.keys(SAMPLED).sort().join()) {
    problems.push(`decode.ts samples ${sampled.join(", ")}; this check pins ${Object.keys(SAMPLED).join(", ")}`);
  }
  for (const format of [...DECODE_INPUTS, "cur"].filter((format) => !NOT_THE_BROWSERS.has(format))) {
    if (Boolean(SAMPLED[format]) === Boolean(EVERY_BROWSER[format])) {
      problems.push(`${format}: needs a sample in decode.ts or an EVERY_BROWSER fixture here, not both`);
    }
  }
  return problems;
}

// decode.ts and the modules it imports, transpiled, at their paths under /lib/.
function moduleSource(pathname) {
  const file = path.join(appRoot, pathname);
  if (!pathname.startsWith("/lib/") || !file.startsWith(path.join(appRoot, "lib")) || !file.endsWith(".ts")) return null;
  return ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

// What decodeToRGBA does with `bytes` read as `format`, in `page`: decoded
// (with its size), damaged, or no decoder in this browser.
async function decodeIn(page, format, bytes) {
  return page.evaluate(
    async ({ format, base64 }) => {
      const { decodeToRGBA } = await import("/lib/convert/decode.ts");
      const { isDecodeFailure, noBrowserDecoderFormat } = await import("/lib/convert/decode-failure.ts");
      const data = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      try {
        const { width, height } = await decodeToRGBA(format, data.buffer);
        return `decoded ${width} x ${height}`;
      } catch (error) {
        if (isDecodeFailure(error)) return "damaged";
        if (noBrowserDecoderFormat(error)) return "no decoder";
        return `failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    { format, base64: Buffer.from(bytes).toString("base64") },
  );
}

function size(name) {
  return name === "sample.svg" ? "120 x 120" : "96 x 96";
}

async function checkEngine(name) {
  const problems = [];
  const browser = await playwright[name].launch();
  try {
    const page = await browser.newPage();
    // Only the page's own origin: a route for every URL would catch the
    // blob: URLs an <img> loads the files from, in WebKit.
    await page.route(`${ORIGIN}/**`, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") {
        return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Browser decoders</title>" });
      }
      const source = moduleSource(url.pathname);
      return source === null ? route.fulfill({ status: 404 }) : route.fulfill({ contentType: "text/javascript", body: source });
    });
    await page.goto(`${ORIGIN}/`);
    const cases = [];
    for (const [format, engines] of Object.entries(SAMPLED)) {
      const supported = engines.includes(name);
      const sample = browserSample(format);
      cases.push([format, `${format} sample`, sample, supported ? "decoded 1 x 1" : "no decoder"]);
      cases.push([format, `damaged ${format}`, sample.slice(0, DAMAGED_BYTES), supported ? "damaged" : "no decoder"]);
    }
    for (const [format, fixture] of Object.entries(EVERY_BROWSER)) {
      const bytes = readFileSync(path.join(fixtures, fixture));
      cases.push([format, fixture, bytes, `decoded ${size(fixture)}`]);
      cases.push([format, `damaged ${format}`, bytes.subarray(0, DAMAGED_BYTES), "damaged"]);
    }
    for (const [format, label, bytes, expected] of cases) {
      const actual = await decodeIn(page, format, bytes);
      const line = `${name} ${label}: ${actual}`;
      if (actual === expected) console.log(`ok ${line}`);
      else problems.push(`${line}, expected ${expected}`);
    }
  } finally {
    await browser.close();
  }
  return problems;
}

const args = parseArgs(process.argv.slice(2));
const problems = checkLists();
for (const engine of args.engines) problems.push(...(await checkEngine(engine)));
if (problems.length) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  process.exit(1);
}
console.log(`Browser decoders: as decode.ts assumes in ${args.engines.join(", ")}.`);
