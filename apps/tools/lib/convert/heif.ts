// lib/convert/heif.ts
// HEIC/HEIF → RGBA using a self-hosted bundle that works in both window + worker.

import { decodedAllocationExceeds } from "../tool-workflow/image-allocation-limits.ts";

export type RGBA = { data: Uint8ClampedArray; width: number; height: number };

type HeifImage = {
  get_width: () => number;
  get_height: () => number;
  display: (...args: unknown[]) => void;
  free?: () => void;
};

type HeifContext = {
  read: (bytes: Uint8Array) => void;
  getPrimaryImageHandle: () => { decode: () => HeifImage; free?: () => void };
  free?: () => void;
};

type HeifDecoder = {
  decode: (bytes: Uint8Array) => HeifImage[];
};

type HeifModule = {
  HeifContext?: new () => HeifContext;
  HeifDecoder?: new () => HeifDecoder;
  HeifImage?: unknown;
};

type HeifGlobal = typeof globalThis & {
  libheif?: () => Promise<HeifModule>;
  HeifContext?: new () => HeifContext;
  HeifDecoder?: new () => HeifDecoder;
  HeifImage?: unknown;
};

// Where you put the bundle file (see step below)
const BUNDLE_URL = "/vendor/libheif/libheif-bundle.js";

let inited = false;
let g: HeifGlobal | null = null; // global

function hasDocument(): boolean {
  return typeof document !== "undefined" && "createElement" in document;
}
function getGlobal(): HeifGlobal {
  return globalThis as HeifGlobal;
}

function loadScriptInWindow(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (!hasDocument()) return reject(new Error("No document"));
    if ([...document.scripts].some((s) => s.src.endsWith(src)))
      return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadScriptInWorker(src: string): Promise<void> {
  // Module workers don't have importScripts; eval the UMD safely.
  const code = await fetch(src, { cache: "force-cache" }).then((r) => {
    if (!r.ok) throw new Error(`Fetch failed ${r.status} ${src}`);
    return r.text();
  });
  // Executes in worker scope; attaches factory to globalThis.libheif
  (0, eval)(code);
}

async function ensureHeif() {
  if (inited) return;
  g = getGlobal();
  if (!g) {
    throw new Error("Global scope unavailable for libheif.");
  }

  if (!g.HeifContext && !g.HeifDecoder && !g.libheif) {
    if (hasDocument()) {
      await loadScriptInWindow(BUNDLE_URL);
    } else {
      await loadScriptInWorker(BUNDLE_URL);
    }
  }

  // Some builds expose a factory on g.libheif(), others attach classes directly.
  if (typeof g.libheif === "function") {
    const mod = await g.libheif();
    // Prefer classes from module; fall back to globals.
    g.HeifContext = g.HeifContext || mod.HeifContext;
    g.HeifDecoder = g.HeifDecoder || mod.HeifDecoder;
    g.HeifImage = g.HeifImage || mod.HeifImage;
  }

  if (!g.HeifContext && !g.HeifDecoder) {
    throw new Error("libheif classes not found after loading bundle");
  }

  inited = true;
}

function checkedRgbaLength(width: number, height: number): number {
  if (decodedAllocationExceeds(width, height)) {
    throw new Error("HEIF decoded RGBA size exceeds the safety limit");
  }
  return width * height * 4;
}

async function displayImage(
  img: HeifImage,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (img.display.length >= 4) {
    img.display(rgba, width, height, { colorSpace: "rgb", bitDepth: 8 });
    signal?.throwIfAborted();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    try {
      const imageData = new ImageData(
        Uint8ClampedArray.from(rgba),
        width,
        height,
      );
      img.display(imageData, (result: unknown) => {
        if (result === null || result instanceof Error) {
          reject(
            result instanceof Error
              ? result
              : new Error("HEIF display callback failed"),
          );
        } else {
          try {
            signal?.throwIfAborted();
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/** Unified decode: prefers HeifContext if present; otherwise uses HeifDecoder */
export async function decodeHeifToRGBA(
  buf: ArrayBuffer,
  signal?: AbortSignal,
): Promise<RGBA> {
  signal?.throwIfAborted();
  await ensureHeif();
  if (!g) {
    throw new Error("libheif not initialized.");
  }

  const bytes = new Uint8Array(buf);

  // Path A: HeifContext API
  if (typeof g.HeifContext === "function") {
    const ctx = new g.HeifContext();
    let handle: ReturnType<HeifContext["getPrimaryImageHandle"]> | undefined;
    let img: HeifImage | undefined;
    try {
      ctx.read(bytes);
      signal?.throwIfAborted();
      handle = ctx.getPrimaryImageHandle();
      img = handle.decode();
      const width = img.get_width();
      const height = img.get_height();
      const rgba = new Uint8ClampedArray(checkedRgbaLength(width, height));
      await displayImage(img, rgba, width, height, signal);
      return { data: rgba, width, height };
    } finally {
      img?.free?.();
      handle?.free?.();
      ctx.free?.();
    }
  }

  // Path B: HeifDecoder API (images array)
  if (typeof g.HeifDecoder === "function") {
    const dec = new g.HeifDecoder();
    const images = dec.decode(bytes);
    const [img] = images ?? [];
    try {
      if (!img) throw new Error("No images in HEIF");
      const width = img.get_width();
      const height = img.get_height();
      const rgba = new Uint8ClampedArray(checkedRgbaLength(width, height));
      await displayImage(img, rgba, width, height, signal);
      return { data: rgba, width, height };
    } finally {
      for (const image of images ?? []) image.free?.();
    }
  }

  throw new Error("No compatible libheif API found");
}
