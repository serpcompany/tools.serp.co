"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@serp-tools/ui/components/button";
import { saveBlob } from "@/components/saveAs";
import { toolColor } from "@/components/toolColor";
import { ToolHeroLayout } from "@/components/ToolHeroLayout";
import type { ToolProgressFile } from "@/components/ToolProgressIndicator";
import { ToolResultMonetizationPanel } from "@/components/ToolResultMonetizationPanel";
import { beginToolRun, getTelemetryFailure } from "@/lib/telemetry";
import {
  IMAGE_PDF_ACCEPT,
  IMAGE_PDF_MAX_IMAGES,
  imageFormatOf,
  imagePdfName,
} from "@/lib/convert/image-pdf-inputs";
import { checkOutputFormat } from "@/lib/convert/output-format";

// Image to PDF (image-to-pdf): HeroConverter's drop zone, where one image
// becomes one PDF at once, and several are listed to put in order before
// they become one PDF, a page each (lib/convert/image-pdf.ts).
type Props = {
  toolId?: string;
  title: string;
  subtitle?: string;
  note?: string;
  from: string;
  to: string;
};

type Queued = { id: number; file: File };
type RowAction = "up" | "down" | "remove";

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const nameList = (files: File[]) =>
  files.length <= 3
    ? files.map((file) => file.name).join(", ")
    : `${files.slice(0, 2).map((file) => file.name).join(", ")} and ${files.length - 2} more`;

export default function ImagesToPdfConverter({
  toolId = "image-to-pdf",
  title,
  subtitle = "Fast, private, in-browser conversion.",
  note,
  from,
  to,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  // Where keyboard focus goes once the list has changed: a row's button, or
  // the add button when the list empties. Otherwise a removed row's button,
  // or an arrow that can't go further, would leave focus on the page itself.
  const focusNext = useRef<{ id: number; action: RowAction } | "add" | null>(null);
  const nextId = useRef(0);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [adsVisible, setAdsVisible] = useState(false);
  const [currentFile, setCurrentFile] = useState<ToolProgressFile | null>(null);
  const [completedLabel, setCompletedLabel] = useState<string | undefined>(undefined);
  const color = toolColor(from, to);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const button =
      target === "add"
        ? addRef.current
        : listRef.current?.querySelector<HTMLButtonElement>(`[data-row="${target.id}"][data-action="${target.action}"]`);
    button?.focus();
  }, [queue]);

  function onPick() {
    inputRef.current?.click();
  }

  // Makes the PDF and saves it; false when it failed (the card says why).
  async function makePdf(files: File[]): Promise<boolean> {
    const label = files.length === 1 ? files[0]!.name : `${files.length} images`;
    const run = beginToolRun({
      toolId,
      from,
      to,
      inputBytes: files.reduce((sum, file) => sum + file.size, 0),
      metadata: { fileCount: files.length, engine: "image-pdf" },
    });
    setBusy(true);
    setCompletedLabel(undefined);
    setCurrentFile({ name: label, progress: 0, status: "processing" });
    try {
      const { imagesToPdf } = await import("@/lib/convert/image-pdf");
      const bytes = await imagesToPdf(files, {
        onProgress: (done, total) =>
          setCurrentFile({
            name: label,
            progress: Math.round((done / total) * 95),
            status: "processing",
            message: total > 1 && done < total ? `Adding image ${done + 1} of ${total}` : undefined,
          }),
      });
      if (!checkOutputFormat(bytes.slice(0, 16).buffer, "pdf").ok) {
        throw Object.assign(new Error("The converter didn't produce a PDF."), {
          telemetryCode: "wrong_output_format",
        });
      }
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
      saveBlob(blob, imagePdfName(files.map((file) => file.name)));
      setCompletedLabel(files.length === 1 ? "PDF saved" : `${files.length}-page PDF saved`);
      setCurrentFile({ name: label, progress: 100, status: "completed" });
      run.finishSuccess({ outputBytes: blob.size });
      return true;
    } catch (error) {
      const failure = getTelemetryFailure(error, "convert_failed");
      console.error("Image to PDF failed:", error);
      setCurrentFile({ name: label, progress: 0, status: "error", message: failure.message });
      run.finishFailure({ errorCode: failure.errorCode, metadata: failure.metadata });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleFiles(chosen: File[]) {
    if (!chosen.length || busy) return;
    setAdsVisible(true);
    const readable: File[] = [];
    const refused: File[] = [];
    for (const file of chosen) {
      const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
      (imageFormatOf(file.name, head) ? readable : refused).push(file);
    }
    const notices: string[] = [];
    if (refused.length) {
      notices.push(`${nameList(refused)} ${refused.length === 1 ? "isn't an image" : "aren't images"} this page can read.`);
    }

    // One image on its own becomes a PDF straight away, as on every converter.
    if (!queue.length && readable.length === 1) {
      setNotice(notices.join(" ") || null);
      await makePdf(readable);
      return;
    }
    const room = IMAGE_PDF_MAX_IMAGES - queue.length;
    const added = readable.slice(0, Math.max(0, room));
    if (readable.length > added.length) {
      const left = readable.length - added.length;
      notices.push(`A PDF made here holds up to ${IMAGE_PDF_MAX_IMAGES} images, so ${left} ${left === 1 ? "wasn't" : "weren't"} added.`);
    }
    setNotice(notices.join(" ") || null);
    if (added.length) {
      const items = added.map((file) => ({ id: nextId.current++, file }));
      setCurrentFile(null);
      setQueue((listedItems) => [...listedItems, ...items]);
    }
  }

  function move(index: number, by: number) {
    const target = index + by;
    const moved = queue[index];
    if (!moved || target < 0 || target >= queue.length) return;
    // Focus stays with the moved row: on the arrow pressed, or on its other
    // arrow once it reaches the top or bottom.
    const [pressed, other]: [RowAction, RowAction] = by < 0 ? ["up", "down"] : ["down", "up"];
    const atEnd = by < 0 ? target === 0 : target === queue.length - 1;
    focusNext.current = { id: moved.id, action: atEnd ? other : pressed };
    setQueue((items) => {
      if (target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  // Focus moves to the Remove button now in this place (the next row's), or
  // the previous row's when this was last, or the add button.
  function remove(index: number) {
    const removed = queue[index];
    if (!removed) return;
    const next = queue[index + 1] ?? queue[index - 1];
    focusNext.current = next ? { id: next.id, action: "remove" } : "add";
    setQueue((items) => items.filter((item) => item.id !== removed.id));
  }

  async function combine() {
    const files = queue.map((item) => item.file);
    setNotice(null);
    if (files.length && (await makePdf(files))) setQueue([]);
  }

  function onDrag(e: React.DragEvent) {
    e.preventDefault();
    setDragging(e.type === "dragenter" || e.type === "dragover");
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFiles(Array.from(e.dataTransfer.files));
  }

  const listed = queue.length > 0;

  return (
    <ToolHeroLayout
      adsVisible={adsVisible}
      adSlotPrefix={toolId}
      currentFile={currentFile}
      progressCompletedLabel={completedLabel}
      contentClassName="text-center"
      resultPanel={<ToolResultMonetizationPanel slotPrefix={toolId} />}
      hero={
        <>
          <div
            onDragEnter={onDrag}
            onDragOver={onDrag}
            onDragLeave={onDrag}
            onDrop={onDrop}
            data-testid="tool-dropzone"
            className="mt-8 mx-auto max-w-6xl border-2 border-dashed rounded-2xl p-12 hover:border-opacity-80 transition-colors cursor-pointer"
            style={{ backgroundColor: color + "15", borderColor: color }}
            onClick={onPick}
          >
            <div className="flex flex-col items-center space-y-6">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">{title}</h1>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
              {note && <p className="text-xs text-muted-foreground">{note}</p>}

              <svg className="w-12 h-12" fill="none" stroke="currentColor" style={{ color }} viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>

              <Button
                ref={addRef}
                size="lg"
                className="h-12 px-8 rounded-xl text-white shadow-lg"
                style={{ backgroundColor: color, borderColor: color }}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick();
                }}
                disabled={busy}
              >
                {busy ? "Working…" : listed ? "ADD IMAGES" : "CHOOSE IMAGES"}
              </Button>

              <div className="text-sm" style={{ color }}>
                <p className="font-medium">
                  {dragging ? "Drop to add" : listed ? "or drop more here" : "or drop images here"}
                </p>
                {!listed && <p className="mt-1 text-xs text-muted-foreground">Choose several at once to combine them into one PDF.</p>}
              </div>
            </div>

            <input
              ref={inputRef}
              type="file"
              multiple
              accept={IMAGE_PDF_ACCEPT}
              className="hidden"
              data-testid="tool-file-input"
              onChange={(e) => {
                // Copied first: clearing the input lets the same file be chosen again.
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                void handleFiles(files);
              }}
            />
          </div>

          {notice && (
            <p className="mt-4 text-sm text-amber-700 dark:text-amber-400" role="status">
              {notice}
            </p>
          )}

          {listed && (
            <div className="mt-6 mx-auto max-w-2xl text-left" data-testid="image-pdf-list">
              <div className="mb-2 flex items-center justify-between gap-4">
                <p className="text-sm font-medium">
                  {queue.length} {queue.length === 1 ? "image" : "images"}: one page each, in this order
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    focusNext.current = "add";
                    setQueue([]);
                    setNotice(null);
                  }}
                  disabled={busy}
                >
                  Clear
                </Button>
              </div>
              <ol ref={listRef} className="divide-y rounded-xl border bg-white dark:bg-transparent">
                {queue.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate" title={item.file.name}>
                      {item.file.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{sizeLabel(item.file.size)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Move ${item.file.name} up`}
                      data-row={item.id}
                      data-action="up"
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Move ${item.file.name} down`}
                      data-row={item.id}
                      data-action="down"
                      disabled={busy || index === queue.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Remove ${item.file.name}`}
                      data-row={item.id}
                      data-action="remove"
                      disabled={busy}
                      onClick={() => remove(index)}
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex justify-center">
                <Button
                  size="lg"
                  className="h-12 px-8 rounded-xl text-white shadow-lg"
                  style={{ backgroundColor: color, borderColor: color }}
                  onClick={() => void combine()}
                  disabled={busy}
                  data-testid="image-pdf-combine"
                >
                  {busy ? "Working…" : `Combine into one PDF`}
                </Button>
              </div>
            </div>
          )}
        </>
      }
    />
  );
}
