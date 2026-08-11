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
  getPrimaryImageHandle: () => {
    decode: () => HeifImage;
    get_width?: () => number;
    get_height?: () => number;
    free?: () => void;
  };
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
// The bundled callback API schedules display work for the next task and offers
// no cancellation primitive. On abort, retain native ownership for a grace
// task so its callback can settle before falling back to bounded cleanup.
const CALLBACK_CLEANUP_GRACE_MS = 50;

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

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () =>
    rejectAbort?.(
      signal.reason ?? new DOMException("The operation was aborted", "AbortError"),
    );
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

type DisplayOperation = Readonly<{
  outcome: Promise<void>;
  callbackSettled(): boolean;
  waitUntilSafeToRelease(): Promise<void>;
}>;

function displayImage(
  img: HeifImage,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  signal?: AbortSignal,
): DisplayOperation {
  signal?.throwIfAborted();
  if (img.display.length >= 4) {
    img.display(rgba, width, height, { colorSpace: "rgb", bitDepth: 8 });
    signal?.throwIfAborted();
    return {
      outcome: Promise.resolve(),
      callbackSettled: () => true,
      waitUntilSafeToRelease: async () => {},
    };
  }
  let settled = false;
  const callback = new Promise<void>((resolve, reject) => {
    try {
      // libheif writes into ImageData.data. It must share the exact returned
      // RGBA allocation; copying here silently produces an all-zero result.
      if (!(rgba.buffer instanceof ArrayBuffer)) {
        throw new Error("HEIF RGBA allocation must use an ArrayBuffer");
      }
      const sharedRgba = new Uint8ClampedArray(
        rgba.buffer,
        rgba.byteOffset,
        rgba.byteLength,
      );
      const imageData = new ImageData(sharedRgba, width, height);
      img.display(imageData, (result: unknown) => {
        settled = true;
        if (result === null || result instanceof Error) {
          reject(
            result instanceof Error
              ? result
              : new Error("HEIF display callback failed"),
          );
        } else {
          resolve();
        }
      });
    } catch (error) {
      settled = true;
      reject(error);
    }
  });
  const callbackCompletion = callback.then(
    () => undefined,
    () => undefined,
  );
  return {
    outcome: awaitWithSignal(callback, signal),
    callbackSettled: () => settled,
    async waitUntilSafeToRelease() {
      if (settled) return;
      await Promise.race([
        callbackCompletion,
        new Promise<void>((resolve) =>
          setTimeout(resolve, CALLBACK_CLEANUP_GRACE_MS),
        ),
      ]);
    },
  };
}

function once(cleanup: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    cleanup();
  };
}

function releaseAll(cleanups: readonly (() => void)[]): void {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      // Every independently acquired native handle still gets its release.
    }
  }
}

async function releaseAfterDisplay(
  display: DisplayOperation | undefined,
  signal: AbortSignal | undefined,
  release: () => void,
): Promise<void> {
  if (signal?.aborted && display && !display.callbackSettled()) {
    await display.waitUntilSafeToRelease();
  }
  release();
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
    let display: DisplayOperation | undefined;
    const release = once(() => {
      releaseAll([
        () => img?.free?.(),
        () => handle?.free?.(),
        () => ctx.free?.(),
      ]);
    });
    try {
      ctx.read(bytes);
      signal?.throwIfAborted();
      handle = ctx.getPrimaryImageHandle();
      img = handle.decode();
      const width = img.get_width();
      const height = img.get_height();
      const rgba = new Uint8ClampedArray(checkedRgbaLength(width, height));
      display = displayImage(img, rgba, width, height, signal);
      await display.outcome;
      return { data: rgba, width, height };
    } finally {
      if (signal?.aborted && display && !display.callbackSettled()) {
        void releaseAfterDisplay(display, signal, release);
      } else {
        release();
      }
    }
  }

  // Path B: HeifDecoder API (images array)
  if (typeof g.HeifDecoder === "function") {
    const dec = new g.HeifDecoder();
    const images = dec.decode(bytes);
    const [img] = images ?? [];
    let display: DisplayOperation | undefined;
    const release = once(() => {
      releaseAll((images ?? []).map((image) => () => image.free?.()));
    });
    try {
      if (!img) throw new Error("No images in HEIF");
      const width = img.get_width();
      const height = img.get_height();
      const rgba = new Uint8ClampedArray(checkedRgbaLength(width, height));
      display = displayImage(img, rgba, width, height, signal);
      await display.outcome;
      return { data: rgba, width, height };
    } finally {
      if (signal?.aborted && display && !display.callbackSettled()) {
        void releaseAfterDisplay(display, signal, release);
      } else {
        release();
      }
    }
  }

  throw new Error("No compatible libheif API found");
}

export async function verifyHeifIdentity(
  buf: ArrayBuffer,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    await ensureHeif();
    if (!g) return false;
    const bytes = new Uint8Array(buf);
    if (typeof g.HeifContext === "function") {
      const context = new g.HeifContext();
      let handle: ReturnType<HeifContext["getPrimaryImageHandle"]> | undefined;
      let image: HeifImage | undefined;
      try {
        context.read(bytes);
        signal?.throwIfAborted();
        handle = context.getPrimaryImageHandle();
        const width = handle.get_width?.();
        const height = handle.get_height?.();
        if (width !== undefined && height !== undefined) {
          checkedRgbaLength(width, height);
          return true;
        }
        image = handle.decode();
        checkedRgbaLength(image.get_width(), image.get_height());
        signal?.throwIfAborted();
        return true;
      } finally {
        image?.free?.();
        handle?.free?.();
        context.free?.();
      }
    }
    if (typeof g.HeifDecoder === "function") {
      const images = new g.HeifDecoder().decode(bytes);
      try {
        const image = images[0];
        if (!image) return false;
        checkedRgbaLength(image.get_width(), image.get_height());
        signal?.throwIfAborted();
        return true;
      } finally {
        for (const image of images) image.free?.();
      }
    }
    return false;
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}
