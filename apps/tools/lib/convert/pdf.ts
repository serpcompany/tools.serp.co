// lib/convert/pdf.ts
// PDF → PNG using the legacy pdfjs bundle for worker compatibility.

const workerPublicUrl = "/vendor/pdfjs/pdf.worker.min.js";
type PdfCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

type PdfjsPage = {
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvasContext: PdfCanvasContext; viewport: { width: number; height: number } }) => {
    promise: Promise<void>;
    cancel: () => void;
  };
};

type PdfjsDocument = {
  numPages: number;
  getPage: (page: number) => Promise<PdfjsPage>;
  destroy: () => void | Promise<void>;
};

type PdfjsLoadingTask = {
  promise: Promise<PdfjsDocument>;
  destroy: () => void | Promise<void>;
};

type PdfjsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (options: { data: ArrayBuffer }) => PdfjsLoadingTask;
};

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* webpackIgnore: true */ "/vendor/pdfjs/pdf.min.mjs")
      .then((mod) => mod as unknown as PdfjsModule)
      .catch(async () => {
        const mod = await import("pdfjs-dist/legacy/build/pdf");
        return mod as unknown as PdfjsModule;
      });
  }
  return pdfjsPromise;
}

type PdfPageRendererPorts = Readonly<{
  loadPdfjs(): Promise<PdfjsModule>;
  createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas;
}>;

async function awaitWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let rejectAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    onAbort?.();
    rejectAbort?.(
      signal.reason ?? new DOMException("The operation was aborted", "AbortError"),
    );
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

const defaultPdfPageRendererPorts: PdfPageRendererPorts = {
  loadPdfjs: getPdfjs,
  createCanvas(width, height) {
    return typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement("canvas"), { width, height });
  },
};

export function createPdfPageRenderer(
  ports: PdfPageRendererPorts = defaultPdfPageRendererPorts,
) {
  return async function render(
    buf: ArrayBuffer,
    page?: number,
    format?: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const pdfjsLib = await awaitWithSignal(ports.loadPdfjs(), signal);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerPublicUrl;
    let loadingTask: PdfjsLoadingTask | undefined;
    let doc: PdfjsDocument | undefined;
    try {
      loadingTask = pdfjsLib.getDocument({ data: buf });
      const documentPromise = loadingTask.promise;
      const loadedDocument = await awaitWithSignal(
        documentPromise.then(async (loaded) => {
          if (signal?.aborted) {
            await loaded.destroy();
            signal.throwIfAborted();
          }
          return loaded;
        }),
        signal,
      );
      doc = loadedDocument;
      const out: Array<ArrayBuffer> = [];
      const pages = page
        ? [page]
        : Array.from(
            { length: loadedDocument.numPages },
            (_, index) => index + 1,
          );
      const mimeType =
        format === "jpg" || format === "jpeg" ? "image/jpeg" : "image/png";
      const quality = mimeType === "image/jpeg" ? 0.9 : undefined;

      for (const pageNumber of pages) {
        signal?.throwIfAborted();
        const pdfPage = await awaitWithSignal(
          loadedDocument.getPage(pageNumber),
          signal,
        );
        const viewport = pdfPage.getViewport({ scale: 2 });
        const canvas = ports.createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Failed to create 2D canvas context.");
        const canvasContext = context as PdfCanvasContext;
        if (mimeType === "image/jpeg") {
          canvasContext.fillStyle = "white";
          canvasContext.fillRect(0, 0, viewport.width, viewport.height);
        }
        const renderTask = pdfPage.render({ canvasContext, viewport });
        await awaitWithSignal(renderTask.promise, signal, () => renderTask.cancel());
        const blob =
          "convertToBlob" in canvas
            ? await awaitWithSignal(
                (canvas as OffscreenCanvas).convertToBlob({
                  type: mimeType,
                  quality,
                }),
                signal,
              )
            : await awaitWithSignal(
                new Promise<Blob>((resolve, reject) =>
                  (canvas as HTMLCanvasElement).toBlob(
                    (value) =>
                      value ? resolve(value) : reject(new Error("toBlob failed")),
                    mimeType,
                    quality,
                  ),
                ),
                signal,
              );
        out.push(await awaitWithSignal(blob.arrayBuffer(), signal));
      }
      return out;
    } finally {
      if (doc) {
        await doc.destroy();
      } else {
        await loadingTask?.destroy();
      }
    }
  };
}

export const renderPdfPages = createPdfPageRenderer();
