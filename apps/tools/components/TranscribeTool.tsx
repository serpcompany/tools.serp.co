"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@serp-tools/ui/components/button";
import { Card } from "@serp-tools/ui/components/card";
import { ToolHeroLayout } from "@/components/ToolHeroLayout";
import type { ToolProgressFile } from "@/components/ToolProgressIndicator";
import {
  deliverMediaInBrowser,
  workflowMediaFromFile,
} from "@/lib/media-workflow/browser";
import {
  createBrowserRunOwnership,
  type BrowserRunLease,
} from "@/lib/media-workflow/browser-run-ownership";
import { createMonotonicProgress } from "@/lib/media-workflow/monotonic-progress";
import { createBrowserTranscriptionWorkflow } from "@/lib/media-workflow/transcription-browser";
import { projectMediaTransfer } from "@/lib/media-workflow/transfer-presentation";
import { VERIFIED_MEDIA_FORMATS } from "@/lib/media-workflow/verified-formats";
import type { WorkflowMedia } from "@/lib/tool-workflow";

type Props = {
  toolId: string;
  title: string;
  subtitle?: string;
};

const SUPPORTED_EXTENSIONS: readonly string[] = VERIFIED_MEDIA_FORMATS;
const ACCEPT_ATTR = SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

function parseUrlInput(value: string) {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export default function TranscribeTool({ toolId, title, subtitle }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [runOwnership] = useState(createBrowserRunOwnership);

  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("or drop files here");
  const [dropEffect, setDropEffect] = useState<string>("");
  const [currentFile, setCurrentFile] = useState<ToolProgressFile | null>(null);
  const [transcript, setTranscript] = useState("");
  const [transcriptMedia, setTranscriptMedia] = useState<WorkflowMedia | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [adsVisible, setAdsVisible] = useState(false);

  const colors = [
    "#ef4444",
    "#f59e0b",
    "#22c55e",
    "#3b82f6",
    "#a855f7",
    "#ec4899",
    "#14b8a6",
    "#f97316",
    "#6366f1",
    "#f43f5e",
    "#0ea5e9",
    "#84cc16",
  ];

  const hashCode = toolId.split("").reduce((hash, char) => {
    return char.charCodeAt(0) + ((hash << 5) - hash);
  }, 0);
  const randomColor = colors[Math.abs(hashCode) % colors.length];

  function onPick() {
    inputRef.current?.click();
  }

  function observeRun(
    name: string,
    lease: BrowserRunLease,
    progress: ReturnType<typeof createMonotonicProgress>,
  ) {
    return (snapshot: { phase: string; progress?: number }) => {
      if (!lease.isCurrent()) return;
      if (["succeeded", "failed", "cancelled"].includes(snapshot.phase)) return;
      setCurrentFile({
        name,
        progress: progress.project(
          snapshot.progress === undefined ? undefined : snapshot.progress * 100,
        ),
        status: snapshot.phase === "acquiring" ? "loading" : "processing",
        message:
          snapshot.phase === "acquiring"
            ? "Downloading..."
            : snapshot.phase === "delivering"
              ? "Preparing transcript..."
              : "Transcribing...",
      });
    };
  }

  async function runTranscription(
    input:
      | { kind: "url"; url: string }
      | { kind: "file"; media: WorkflowMedia },
    name: string,
    lease: BrowserRunLease,
  ): Promise<"completed" | "cancelled" | "failed"> {
    const progress = createMonotonicProgress();
    setErrorMessage(null);
    setTranscript("");
    setTranscriptMedia(null);
    setCurrentFile({
      name,
      progress: 0,
      status: "processing",
      message: "Preparing transcript...",
    });
    try {
      const workflow = createBrowserTranscriptionWorkflow({
        onTransfer(transfer) {
          if (!lease.isCurrent()) return;
          const presentation = projectMediaTransfer(transfer);
          setCurrentFile({
            name,
            progress: progress.project(presentation.progress),
            status: "loading",
            message: presentation.message,
          });
        },
        onDelivered(media) {
          if (!lease.isCurrent()) return;
          setTranscriptMedia(media);
          setTranscript(new TextDecoder().decode(media.bytes));
        },
      });
      const outcome = await workflow.run(
        { toolId, input },
        { signal: lease.signal, observe: observeRun(name, lease, progress) },
      );
      if (outcome.status === "failed") throw new Error(outcome.error.message);
      if (outcome.status === "cancelled" || !lease.isCurrent()) {
        return "cancelled";
      }
      setCurrentFile({
        name: outcome.results[0]?.name ?? name,
        progress: 100,
        status: "completed",
        message: "Transcription complete!",
      });
      return "completed";
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Transcription failed";
      if (lease.isCurrent()) {
        setCurrentFile({
          name,
          progress: progress.project(undefined),
          status: "error",
          message,
        });
      }
      return "failed";
    }
  }

  async function handleUrlSubmit() {
    if (busy || runOwnership.isBusy()) return;
    const parsedUrl = parseUrlInput(urlInput);
    if (!parsedUrl) {
      setErrorMessage("Paste a valid public URL first.");
      return;
    }

    if (!adsVisible) setAdsVisible(true);
    setErrorMessage(null);
    setTranscript("");

    const nameHint = "Remote media";

    const lease = runOwnership.begin();
    setBusy(true);
    setCurrentFile({
      name: nameHint,
      progress: 0,
      status: "loading",
      message: "Downloading...",
    });

    try {
      await runTranscription(
        { kind: "url", url: parsedUrl.toString() },
        nameHint,
        lease,
      );
    } finally {
      if (lease.finish()) setBusy(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !files.length) return;
    if (busy || runOwnership.isBusy()) return;
    const lease = runOwnership.begin();
    if (!adsVisible) setAdsVisible(true);
    setBusy(true);

    try {
      for (const file of Array.from(files)) {
        if (!lease.isCurrent()) break;
        try {
          const media = await workflowMediaFromFile(file);
          if (!lease.isCurrent()) break;
          if (!SUPPORTED_EXTENSIONS.includes(media.format)) {
            throw new Error(
              "Unsupported file type. Please upload an audio or video file.",
            );
          }
          const result = await runTranscription(
            { kind: "file", media },
            file.name,
            lease,
          );
          if (result === "cancelled") break;
        } catch (error) {
          if (lease.isCurrent()) {
            setErrorMessage(
              error instanceof Error ? error.message : "Unsupported file",
            );
          }
        }
      }
    } finally {
      if (lease.finish()) setBusy(false);
    }
  }

  function onDrag(e: React.DragEvent) {
    e.preventDefault();
    if (e.type === "dragenter" || e.type === "dragover")
      setHint("Drop to transcribe");
    if (e.type === "dragleave") setHint("or drop files here");
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    if (busy || runOwnership.isBusy()) return;

    const effects = [
      "splash",
      "bounce",
      "spin",
      "pulse",
      "shake",
      "flip",
      "zoom",
      "confetti",
      "rejected",
    ];
    const effectIndex = Math.floor(Date.now() / 1000) % effects.length;
    const effect = effects[effectIndex];
    if (effect) {
      setDropEffect(effect);
    }

    setTimeout(() => setDropEffect(""), 1000);

    setHint("Transcribing...");
    handleFiles(e.dataTransfer.files).finally(() =>
      setHint("or drop files here"),
    );
  }

  useEffect(() => {
    if (dropEffect) {
      const timer = setTimeout(() => setDropEffect(""), 1000);
      return () => clearTimeout(timer);
    }
  }, [dropEffect]);

  useEffect(
    () => () => runOwnership.abort("Transcription view unmounted"),
    [runOwnership],
  );

  const adSlotPrefix = toolId;

  return (
    <ToolHeroLayout
      adsVisible={adsVisible}
      adSlotPrefix={adSlotPrefix}
      currentFile={currentFile}
      contentClassName="text-center"
      hero={
        <div
          ref={dropRef}
          onDragEnter={onDrag}
          onDragOver={onDrag}
          onDragLeave={onDrag}
          onDrop={onDrop}
          data-testid="tool-dropzone"
          className={`mt-8 mx-auto max-w-6xl border-2 border-dashed rounded-2xl p-12 hover:border-opacity-80 transition-colors cursor-pointer ${
            dropEffect ? `animate-${dropEffect}` : ""
          }`}
          style={{
            backgroundColor: randomColor + "15",
            borderColor: randomColor,
          }}
          onClick={onPick}
        >
          <div className="flex flex-col items-center space-y-6">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>

            <svg
              className="w-12 h-12"
              fill="none"
              stroke="currentColor"
              style={{ color: randomColor }}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>

            <Button
              size="lg"
              className="h-12 px-8 rounded-xl text-white shadow-lg"
              style={{
                backgroundColor: randomColor,
                borderColor: randomColor,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPick();
              }}
              disabled={busy}
            >
              {busy ? "Working..." : "CHOOSE FILES"}
            </Button>

            <div className="text-sm" style={{ color: randomColor }}>
              <p className="font-medium">{hint}</p>
            </div>

            <div
              className="mt-4 w-full max-w-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  inputMode="url"
                  placeholder="Paste a public link (YouTube, SoundCloud, or direct file)"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleUrlSubmit();
                    }
                  }}
                  className="w-full h-12 px-4 py-3 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={busy}
                  data-testid="tool-url-input"
                />
                <Button
                  size="lg"
                  className="h-12 px-6 rounded-xl text-white shadow-lg"
                  style={{
                    backgroundColor: randomColor,
                    borderColor: randomColor,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleUrlSubmit();
                  }}
                  disabled={busy || !urlInput.trim()}
                  data-testid="tool-url-submit"
                >
                  {busy ? "Working..." : "TRANSCRIBE URL"}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Supports public links. Private or logged-in content is not
                supported yet.
              </p>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            className="hidden"
            data-testid="tool-file-input"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      }
      below={
        <>
          {errorMessage && (
            <div className="mt-4 text-sm text-red-600">{errorMessage}</div>
          )}

          {transcript && (
            <div className="mt-8 max-w-4xl mx-auto text-left">
              <Card className="p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Transcript
                  </h3>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        navigator.clipboard
                          ?.writeText(transcript)
                          .catch(() => {})
                      }
                    >
                      Copy
                    </Button>
                    <Button
                      onClick={() =>
                        transcriptMedia &&
                        deliverMediaInBrowser(transcriptMedia)
                      }
                      disabled={!transcriptMedia}
                    >
                      Download
                    </Button>
                  </div>
                </div>
                <textarea
                  value={transcript}
                  readOnly
                  className="mt-4 w-full h-64 p-4 border rounded-lg resize-none bg-gray-50 font-mono text-sm"
                  placeholder="Transcript will appear here..."
                />
              </Card>
            </div>
          )}
        </>
      }
    />
  );
}
