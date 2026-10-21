// Tool videos (issue #366): records a ~60 s narrated how-to video of a Tool
// being used, ready for YouTube. Each video is also an end-to-end check: the
// Tool runs for real on a demo file, its output must pass the app's own
// format check (lib/convert/output-format.ts), and no request may carry the
// file off the device. A Tool that fails gets no video.
//
//   node scripts/tool-video.mjs --only jpg-to-png,heic-to-jpg \
//     [--base-url https://staging.tools.serp.co] [--out .videos] \
//     [--voice Samantha] [--rate 180] [--headed]
//
// The page is real; the props around it are drawn: the browser window, the
// cursor, the file dragged in, the download bubble and the window the result
// opens in (scripts/lib/tool-video-stage.mjs). Downloads never reach the disk.
// Requests to other origins (ads, analytics, the placeholder YouTube embed)
// are blocked and the embed's section is hidden. The voice is macOS `say`.
// Every run writes tool runs into the target's D1, so never point it at
// production. Writes, per Tool, into <out>/<tool id>/: video.mp4,
// captions.srt, thumbnail.png, youtube.json and run.json (the evidence).

import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { activeTools } from "../lib/catalog/catalog.ts";
import { checkOutputFormat } from "../lib/convert/output-format.ts";
import { SMOKE_TEST_HEADER } from "../lib/site-environment.ts";
import { buildScript, captionChunks, formatBytes, resolveBeat, toSrt, youtubeMetadata } from "./lib/tool-video.mjs";
import {
  CAPTION,
  CONTENT,
  FRAME,
  captionStrip,
  closingCard,
  demoPhoto,
  thumbnail,
  titleCard,
  windowFrame,
} from "./lib/tool-video-scenes.mjs";
import { installStage } from "./lib/tool-video-stage.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    "base-url": { type: "string", default: "https://staging.tools.serp.co" },
    out: { type: "string", default: ".videos" },
    voice: { type: "string", default: "Samantha" },
    rate: { type: "string", default: "180" },
    headed: { type: "boolean", default: false },
  },
});
if (!args.only) throw new Error("--only <tool id,...> is required");
const baseUrl = args["base-url"].replace(/\/$/, "");
if (new URL(baseUrl).hostname === "tools.serp.co") throw new Error("Never record against production: every run writes telemetry");
const baseOrigin = new URL(baseUrl).origin;
const outRoot = path.resolve(appRoot, args.out);
const formats = JSON.parse(readFileSync(path.join(appRoot, "content/formats.json"), "utf8"));
const tools = activeTools();
const ids = args.only.split(",").map((id) => id.trim());
const unknown = ids.filter((id) => !tools.some((tool) => tool.id === id));
if (unknown.length) throw new Error(`Not active Tool ids: ${unknown.join(", ")}`);

// The recorded page: a 1260 x 642 viewport, just under the xl breakpoint
// where the ad rails appear, captured at device-pixel scale so it fills the
// browser window in the 1920 x 1080 frame sharply.
const VIEWPORT = { width: 1260, height: 642 };
const SCALE = CONTENT.width / VIEWPORT.width;
const FPS = 30;
// Silence after each narrated line before the next beat starts.
const GAP = 0.45;

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || "").slice(-2000)}`);
  return result.stdout;
}

function duration(file) {
  return Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: !args.headed });

async function screenshot(html, file, { width, height, transparent = false }) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: file, omitBackground: transparent, type: "png" });
  await page.close();
}

// ---- Demo files ---------------------------------------------------------

const inputsDir = path.join(outRoot, "inputs");

async function demoJpg(name, { width, height, hue, quality }) {
  const file = path.join(inputsDir, name);
  if (existsSync(file)) return file;
  const png = path.join(inputsDir, `${name}.png`);
  await screenshot(demoPhoto({ width, height, hue }), png, { width, height });
  const sharp = (await import("sharp")).default;
  await sharp(png).jpeg({ quality, mozjpeg: false }).toFile(file);
  rmSync(png);
  return file;
}

// The file each Tool converts, by its input format, and what the dragged icon
// shows. Compressors get a large, high-quality photo, so the saving is real.
async function demoInput(tool) {
  mkdirSync(inputsDir, { recursive: true });
  const photo = await demoJpg("lake-sunset.jpg", { width: 2400, height: 1600, hue: 18, quality: 90 });
  const sharp = (await import("sharp")).default;
  const preview = `data:image/jpeg;base64,${(await sharp(photo).resize(192).jpeg({ quality: 80 }).toBuffer()).toString("base64")}`;
  if (tool.operation === "compress" && tool.from === "jpg") {
    const big = await demoJpg("IMG_2048.jpg", { width: 4032, height: 3024, hue: 28, quality: 98 });
    return { file: big, thumbnail: preview };
  }
  switch (tool.from) {
    case "jpg":
      return { file: photo, thumbnail: preview };
    case "heic": {
      const file = path.join(inputsDir, "IMG_4821.HEIC");
      if (!existsSync(file)) run("sips", ["-s", "format", "heic", photo, "--out", file]);
      return { file, thumbnail: preview };
    }
    case "webp":
    case "png": {
      const file = path.join(inputsDir, `lake-sunset.${tool.from}`);
      if (!existsSync(file)) await sharp(photo).resize(1600).toFormat(tool.from).toFile(file);
      return { file, thumbnail: preview };
    }
    case "mp4": {
      const file = path.join(inputsDir, "beach-trip.mp4");
      if (!existsSync(file)) {
        // 12 s of the photo, slowly zooming, over a soft three-note chord.
        run("ffmpeg", [
          "-y", "-loop", "1", "-i", photo,
          "-f", "lavfi", "-i", "sine=f=220:d=12", "-f", "lavfi", "-i", "sine=f=277.18:d=12", "-f", "lavfi", "-i", "sine=f=329.63:d=12",
          "-filter_complex",
          "[0]scale=1920:-2,zoompan=z='1+0.0008*on':d=360:s=1280x720:fps=30[v];[1][2][3]amix=inputs=3,volume=0.6,afade=in:d=1,afade=out:st=11:d=1[a]",
          "-map", "[v]", "-map", "[a]", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file,
        ]);
      }
      return { file, extension: "MP4" };
    }
    default:
      throw new Error(`${tool.id}: no demo file for ${tool.from} yet`);
  }
}

// ---- Voice ---------------------------------------------------------------

function speak(text, file) {
  const aiff = `${file}.aiff`;
  run("say", ["-v", args.voice, "-r", args.rate, "-o", aiff, text]);
  run("ffmpeg", ["-y", "-v", "error", "-i", aiff, "-ar", "48000", "-ac", "2", file]);
  rmSync(aiff);
  return duration(file);
}

// ---- Recording -----------------------------------------------------------

// Installed before the page's scripts: saveBlob() clicks an anchor with a
// download attribute on a blob URL; keep the blob and skip the download (as
// in tool-sweep.mjs).
function installCapture() {
  const state = { outputs: [] };
  globalThis.__video = state;
  const blobs = new Map();
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (object) => {
    const url = createObjectURL(object);
    if (object instanceof Blob) blobs.set(url, object);
    return url;
  };
  const anchor = globalThis.HTMLAnchorElement.prototype;
  const click = anchor.click;
  anchor.click = function captureDownload() {
    const blob = this.hasAttribute("download") ? blobs.get(this.href) : undefined;
    if (blob) {
      state.outputs.push({ name: this.download, blob, url: this.href });
      return undefined;
    }
    return click.call(this);
  };
}

const ffmpegWasm = readFileSync(path.resolve(appRoot, "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm"));

// Records the page beats. `narrate(beat)` returns the beat's resolved line and
// its audio length; each beat lasts at least that long plus GAP.
async function record(tool, input, dir, narrate) {
  const framesDir = path.join(dir, "frames");
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  const uploads = [];
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let handled;
    if (url.pathname === "/vendor/ffmpeg-st/ffmpeg-core.wasm") {
      handled = route.fulfill({ contentType: "application/wasm", headers: { "access-control-allow-origin": "*" }, body: ffmpegWasm });
    } else if (url.origin !== baseOrigin) {
      handled = route.abort();
    } else {
      // A request with a body, other than telemetry and Cloudflare's own
      // bot-check beacon (/cdn-cgi/), could carry the file.
      const carriesBody = request.method() !== "GET" && request.method() !== "HEAD";
      if (carriesBody && url.pathname !== "/api/telemetry" && !url.pathname.startsWith("/cdn-cgi/")) {
        uploads.push({ method: request.method(), path: url.pathname, bytes: request.postDataBuffer()?.length ?? 0 });
      }
      handled = route.continue({ headers: { ...request.headers(), [SMOKE_TEST_HEADER]: "1" } });
    }
    return handled.catch(() => {});
  });
  await context.addInitScript(installCapture);
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Beat times and frame times are both wall-clock seconds.
  const now = () => Date.now() / 1000;
  const timeline = [];

  const response = await page.goto(`${baseUrl}${tool.route}`, { waitUntil: "load", timeout: 60_000 });
  if (!response || response.status() >= 400) throw new Error(`page answered HTTP ${response?.status()}`);
  const fileInput = '[data-testid="tool-file-input"]';
  await page.waitForFunction(
    (selector) => {
      const element = globalThis.document.querySelector(selector);
      return Boolean(element) && Object.keys(element).some((key) => key.startsWith("__reactProps"));
    },
    fileInput,
    { timeout: 30_000 },
  );
  // The placeholder YouTube embed is blocked: hide its section.
  await page.evaluate(() => {
    for (const heading of globalThis.document.querySelectorAll("h2")) {
      if (/^How to /.test(heading.textContent ?? "")) heading.closest("section")?.style.setProperty("display", "none");
    }
  });
  await page.addStyleTag({ content: "[data-ad-slot], ins.adsbygoogle { display: none !important; }" });
  await page.evaluate(installStage);
  await page.waitForTimeout(400);

  // The screencast sends a frame whenever the page repaints, at device
  // pixels, each stamped with the time it was drawn.
  const frames = [];
  const cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = path.join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(data, "base64"));
    frames.push({ file, time: metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: CONTENT.width, maxHeight: CONTENT.height });
  await page.waitForTimeout(300);

  const stage = (method, ...params) => page.evaluate(([name, values]) => globalThis.__stage[name](...values), [method, params]);
  async function moveTo(x, y, ms) {
    await Promise.all([stage("move", x, y, ms), page.mouse.move(x, y, { steps: Math.max(1, Math.round(ms / 40)) })]);
    await sleep(ms);
  }
  // Runs a beat: its action alongside its narration, whichever is longer.
  async function beat(id, action, result) {
    const line = await narrate(id, result);
    const start = now();
    timeline.push({ id, start, line });
    await Promise.all([action(line), sleep((line.duration + GAP) * 1000)]);
  }

  const dropzone = await page.locator(fileInput).locator("xpath=..").boundingBox();
  const target = { x: dropzone.x + dropzone.width / 2, y: dropzone.y + dropzone.height * 0.62 };

  await beat("open", async () => {
    await stage("show", VIEWPORT.width * 0.7, VIEWPORT.height * 0.75);
    await sleep(300);
    await moveTo(VIEWPORT.width * 0.62, VIEWPORT.height * 0.55, 900);
  });

  // The file lands as its line ends, so the conversion starts with the next.
  await beat("upload", async (line) => {
    await moveTo(40, VIEWPORT.height * 0.6, 500);
    await stage("pickUp", { name: path.basename(input.file), extension: input.extension, thumbnail: input.thumbnail });
    await sleep(250);
    await moveTo(target.x, target.y, Math.max(1600, (line.duration - 1.4) * 1000));
    await page.evaluate(() => globalThis.document.querySelector('[data-testid="tool-file-input"]').parentElement.setAttribute("data-video-drop", ""));
    await stage("highlight", "[data-video-drop]", true);
    await sleep(350);
    await stage("drop");
    await stage("highlight", "[data-video-drop]", false);
    await page.locator(fileInput).setInputFiles(input.file);
    await moveTo(target.x + 160, target.y + 120, 700);
  });

  let output;
  await beat("convert", async () => {
    await page.waitForFunction(() => globalThis.__video.outputs.length > 0, null, { timeout: 180_000 });
    output = await page.evaluate(async () => {
      const { name, blob, url } = globalThis.__video.outputs[0];
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { name, size: blob.size, url, base64: globalThis.btoa(binary) };
    });
  });
  const bytes = Buffer.from(output.base64, "base64");
  const check = checkOutputFormat(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), tool.to);
  const result = { inputBytes: statSync(input.file).size, outputBytes: output.size, outputName: output.name, check, uploads };
  if (!check.ok) throw new Error(`the ${tool.to} output failed its format check: ${JSON.stringify(check)}`);
  if (uploads.length) throw new Error(`requests could carry the file off the device: ${JSON.stringify(uploads)}`);
  result.decoded = await decodeOutput(bytes, tool, input.file, dir);

  await beat(
    "download",
    async () => {
      const row = await stage("downloaded", { name: output.name, size: formatBytes(output.size).caption });
      await sleep(500);
      await moveTo(row.x, row.y, 1200);
      await stage("hoverBubble", true);
    },
    result,
  );

  await beat("result", async () => {
    await stage("click");
    await sleep(250);
    await stage("closeBubble");
    await stage("open", { name: output.name, kind: formats[tool.to]?.kind, size: formatBytes(output.size).caption });
    await moveTo(VIEWPORT.width * 0.8, VIEWPORT.height * 0.85, 900);
  });

  // Down to the format comparison, then on to the FAQ, clear of the
  // sticky header.
  const scrollTo = (pattern) =>
    page.evaluate((source) => {
      const doc = globalThis.document;
      const heading = [...doc.querySelectorAll("h2, h3")].find((element) => new RegExp(source).test(element.textContent ?? ""));
      if (!heading) return;
      const top = heading.getBoundingClientRect().top + globalThis.scrollY - 110;
      globalThis.scrollTo({ top, behavior: "smooth" });
    }, pattern.source);
  await beat("more", async (line) => {
    await stage("close");
    await scrollTo(/ Format$/);
    await moveTo(VIEWPORT.width * 0.55, VIEWPORT.height * 0.5, 1200);
    await sleep(Math.max(0, line.duration * 1000 * 0.5 - 1200));
    await scrollTo(/^Frequently Asked Questions$/);
  });
  const end = now();
  await cdp.send("Page.stopScreencast");
  await context.close();
  if (!frames.length) throw new Error("the screencast sent no frames");
  return { frames: concatList(frames, timeline[0].start, end, dir), timeline, end, result, pageErrors };
}

// Beyond the signature: an image output must decode at the input's size, and
// an audio output must last as long as the input.
async function decodeOutput(bytes, tool, inputFile, dir) {
  const kind = formats[tool.to]?.kind;
  if (kind === "image") {
    const sharp = (await import("sharp")).default;
    const out = await sharp(bytes).metadata();
    const source = tool.from === "heic" ? await sharp(path.join(inputsDir, "lake-sunset.jpg")).metadata() : await sharp(inputFile).metadata();
    if (out.width !== source.width || out.height !== source.height) {
      throw new Error(`the output is ${out.width} x ${out.height}; the input is ${source.width} x ${source.height}`);
    }
    return { width: out.width, height: out.height, format: out.format };
  }
  if (kind === "audio") {
    const file = path.join(dir, `output.${tool.to}`);
    writeFileSync(file, bytes);
    const seconds = duration(file);
    const expected = duration(inputFile);
    rmSync(file);
    if (Math.abs(seconds - expected) > 1) throw new Error(`the output lasts ${seconds} s; the input ${expected} s`);
    return { seconds };
  }
  return null;
}

// An ffmpeg concat list showing each frame until the next one, from `start`
// to `end`: the screencast only sends a frame when the page changes.
function concatList(frames, start, end, dir) {
  const first = Math.max(0, frames.findLastIndex((frame) => frame.time <= start));
  const shown = frames.slice(first).filter((frame) => frame.time < end);
  const lines = ["ffconcat version 1.0"];
  shown.forEach((frame, index) => {
    const from = Math.max(frame.time, start);
    const until = index + 1 < shown.length ? shown[index + 1].time : end;
    lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, until - from).toFixed(4)}`);
  });
  lines.push(`file '${shown.at(-1).file}'`);
  const file = path.join(dir, "frames.txt");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

// ---- Composition ---------------------------------------------------------

async function compose(tool, dir, { intro, outro, recording }) {
  const from = formats[tool.from];
  const to = formats[tool.to];
  const compress = tool.operation === "compress";
  const url = `tools.serp.co${tool.route.replace(/\/$/, "")}`;
  const stills = path.join(dir, "stills");
  mkdirSync(stills, { recursive: true });
  const heading = compress ? `How to Compress ${from.name} Files` : `How to Convert ${from.name} to ${to.name}`;
  await screenshot(titleCard({ heading, fromName: from.name, toName: compress ? null : to.name, subline: "Free · In your browser · No upload" }), path.join(stills, "intro.png"), FRAME);
  await screenshot(closingCard({ url, line: compress ? `Compress ${from.name} files free at` : `Convert ${from.name} to ${to.name} free at` }), path.join(stills, "outro.png"), FRAME);
  await screenshot(windowFrame({ url }), path.join(stills, "frame.png"), FRAME);
  await screenshot(thumbnail({ fromName: from.name, toName: compress ? null : to.name, verb: compress ? `Compress ${from.name}` : "Convert" }), path.join(dir, "thumbnail.png"), { width: 1280, height: 720 });

  // The final timeline: the title card, the page from the first page beat to
  // the end of the last, then the closing card.
  const introLength = intro.duration + 1.0;
  const pageStart = recording.timeline[0].start;
  const pageLength = recording.end - pageStart;
  const outroLength = outro.duration + 1.5;
  const total = introLength + pageLength + outroLength;
  const beats = [
    { id: "intro", chapter: intro.chapter, start: 0.4, line: intro },
    ...recording.timeline.map((item) => ({ id: item.id, chapter: item.line.chapter, start: introLength + item.start - pageStart, line: item.line })),
    { id: "outro", chapter: outro.chapter, start: introLength + pageLength + 0.4, line: outro },
  ];

  const captions = beats.flatMap((item) => captionChunks(item.line.caption, item.start, item.start + item.line.duration));
  writeFileSync(path.join(dir, "captions.srt"), toSrt(captions));
  const captionFiles = [];
  for (const [index, chunk] of captions.entries()) {
    const file = path.join(stills, `caption-${index}.png`);
    await screenshot(captionStrip(chunk.text), file, { width: CAPTION.width, height: CAPTION.height, transparent: true });
    captionFiles.push(file);
  }

  const inputs = [
    "-loop", "1", "-framerate", String(FPS), "-t", String(introLength), "-i", path.join(stills, "intro.png"),
    "-loop", "1", "-framerate", String(FPS), "-t", String(pageLength), "-i", path.join(stills, "frame.png"),
    "-f", "concat", "-safe", "0", "-i", recording.frames,
    "-loop", "1", "-framerate", String(FPS), "-t", String(outroLength), "-i", path.join(stills, "outro.png"),
  ];
  const audioBase = 4;
  for (const item of beats) inputs.push("-i", item.line.audio);
  const captionBase = audioBase + beats.length;
  for (const file of captionFiles) inputs.push("-i", file);

  const filters = [
    `[0]format=yuv420p,fade=t=in:d=0.4,fade=t=out:st=${introLength - 0.35}:d=0.35[intro]`,
    `[2]fps=${FPS},scale=${CONTENT.width}:${CONTENT.height},setpts=PTS-STARTPTS[rec]`,
    `[1][rec]overlay=${CONTENT.x}:${CONTENT.y}:eof_action=repeat,format=yuv420p,fade=t=in:d=0.35[page]`,
    `[3]format=yuv420p,fade=t=in:d=0.35,fade=t=out:st=${outroLength - 0.6}:d=0.6[outro]`,
    `[intro][page][outro]concat=n=3:v=1:a=0[v0]`,
  ];
  let last = "v0";
  captions.forEach((chunk, index) => {
    const next = `v${index + 1}`;
    filters.push(`[${last}][${captionBase + index}]overlay=0:${CAPTION.y}:enable='between(t,${chunk.start.toFixed(3)},${chunk.end.toFixed(3)})'[${next}]`);
    last = next;
  });
  beats.forEach((item, index) => {
    const ms = Math.round(item.start * 1000);
    filters.push(`[${audioBase + index}]adelay=${ms}|${ms}[a${index}]`);
  });
  filters.push(`${beats.map((_, index) => `[a${index}]`).join("")}amix=inputs=${beats.length}:normalize=0,apad,atrim=0:${total.toFixed(3)}[aout]`);

  const out = path.join(dir, "video.mp4");
  run("ffmpeg", [
    "-y", "-v", "error", ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", `[${last}]`, "-map", "[aout]",
    "-t", total.toFixed(3), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  ]);
  return { out, total, beats };
}

// ---- One Tool ------------------------------------------------------------

async function makeVideo(tool) {
  const dir = path.join(outRoot, tool.id);
  rmSync(dir, { recursive: true, force: true });
  const voiceDir = path.join(dir, "voice");
  mkdirSync(voiceDir, { recursive: true });
  const script = buildScript(tool, formats);
  const lines = new Map();
  function narrate(id, result) {
    const beat = resolveBeat(script.find((item) => item.id === id), result);
    const audio = path.join(voiceDir, `${id}.wav`);
    const line = { ...beat, audio, duration: speak(beat.say, audio) };
    lines.set(id, line);
    return line;
  }
  // Lines that don't depend on the run are spoken before it starts.
  for (const beat of script) if (typeof beat.say === "string") narrate(beat.id);
  const cached = (id, result) => (typeof script.find((item) => item.id === id).say === "string" ? lines.get(id) : narrate(id, result));

  const input = await demoInput(tool);
  const started = Date.now();
  const recording = await record(tool, input, dir, async (id, result) => cached(id, result));
  const { out, total, beats } = await compose(tool, dir, { intro: lines.get("intro"), outro: lines.get("outro"), recording });
  rmSync(path.join(dir, "frames"), { recursive: true, force: true });
  const metadata = youtubeMetadata(tool, formats, { timeline: beats, duration: total });
  writeFileSync(path.join(dir, "youtube.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  const evidence = {
    tool: tool.id,
    baseUrl,
    recordedAt: new Date().toISOString(),
    input: { file: path.basename(input.file), bytes: recording.result.inputBytes },
    output: { file: recording.result.outputName, bytes: recording.result.outputBytes, formatCheck: recording.result.check },
    uploads: recording.result.uploads,
    pageErrors: recording.pageErrors,
    seconds: Number(total.toFixed(2)),
    script: beats.map((item) => ({ id: item.id, start: Number(item.start.toFixed(2)), say: item.line.say })),
    wallSeconds: Math.round((Date.now() - started) / 1000),
  };
  writeFileSync(path.join(dir, "run.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  return { out, total };
}

let failures = 0;
for (const id of ids) {
  const tool = tools.find((item) => item.id === id);
  try {
    const { out, total } = await makeVideo(tool);
    console.log(`ok    ${id}  ${total.toFixed(1)} s  ${path.relative(process.cwd(), out)}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${id}  ${error.message}`);
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
