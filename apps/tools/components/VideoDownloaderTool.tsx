"use client";

import { useState } from "react";
import { Button } from "@serp-tools/ui/components/button";
import DownloaderCooldownNotice from "@/components/DownloaderCooldownNotice";
import { saveBlob } from "@/components/saveAs";
import SerplyCtaButton from "@/components/SerplyCtaButton";
import { ToolAdSlot } from "@/components/ToolAds";
import { ToolHeroLayout } from "@/components/ToolHeroLayout";
import type { ToolProgressFile } from "@/components/ToolProgressIndicator";
import { ToolResultMonetizationPanel } from "@/components/ToolResultMonetizationPanel";
import { normalizeBlobPart } from "@/lib/blob-parts";
import { createDownloaderRequestHeaders } from "@/lib/downloader-client";
import { DOWNLOADER_CONSUMER } from "@/lib/downloader-contract.js";
import {
  DOWNLOADER_EXTENSION_LABEL,
  DOWNLOADER_EXTENSION_TEXT,
  DOWNLOADER_EXTENSION_URL,
} from "@/lib/downloader-extension-cta";
import { getDownloaderMediaFetchEndpoint } from "@/lib/media-fetch-endpoint";
import { beginToolRun, getTelemetryFailure } from "@/lib/telemetry";
import { AUDIO_FORMATS, VIDEO_FORMATS } from "@/lib/capabilities";

type ProgressUpdate = {
  receivedBytes: number;
  totalBytes?: number;
  ratio?: number;
  etaSeconds?: number;
};

type Props = {
  toolId: string;
  title: string;
  subtitle?: string;
  mode?: "audio" | "video";
  adsVisible?: boolean;
  onAdsVisibleChange?: (visible: boolean) => void;
  cooldownEndsAtMs?: number | null;
  extensionUrl?: string;
  extensionProductName?: string;
};

type ExtensionFailureCta = {
  extensionUrl: string;
  productName: string;
  reason: "download_failure" | "extension_only" | "site_unreliable";
};

const SUPPORTED_EXTENSIONS = new Set([...AUDIO_FORMATS, ...VIDEO_FORMATS]);
const LOCAL_USAGE_STORAGE_KEY = "serp-tools:downloader-usage:v1";
const LOCAL_USAGE_PRESSURE_THRESHOLD = 3;
const HIGH_RISK_DOWNLOADER_TOOL_IDS = new Set([
  "download-ashemaletube-videos",
  "download-beeg-videos",
  "download-boyfriendtv-videos",
  "download-eporner-videos",
  "download-xhamster-videos",
]);

const MIME_EXTENSION_MAP: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "audio/3gpp": "3gp",
  "audio/3gpp2": "3g2",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/ogg": "ogv",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/x-flv": "flv",
  "video/x-ms-asf": "asf",
  "video/x-ms-wmv": "wmv",
  "video/3gpp": "3gp",
  "video/3gpp2": "3g2",
};

function getExtensionFromName(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

function getFileNameFromUrl(url: URL) {
  const raw = url.pathname.split("/").filter(Boolean).pop() || "download";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

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

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value < 10 && unitIndex > 0 ? 1 : 0;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remaining}s`;
  return `${remaining}s`;
}

function getExtensionFailureCta(
  message: string,
  extensionUrl?: string,
  extensionProductName?: string
): ExtensionFailureCta | null {
  const isExtensionEligibleFailure =
    /Unsupported URL/i.test(message) ||
    /requires a browser extension/i.test(message) ||
    /Download failed \(500\)/i.test(message) ||
    /Download failed \(403\)/i.test(message) ||
    /This link returns a media type we do not support yet/i.test(message) ||
    /That link does not look like a supported media file/i.test(message) ||
    /Failed to fetch media/i.test(message);

  if (!isExtensionEligibleFailure) return null;

  return {
    extensionUrl: extensionUrl ?? DOWNLOADER_EXTENSION_URL,
    productName: extensionProductName || "Downloader",
    reason: /requires a browser extension/i.test(message)
      ? "extension_only"
      : "download_failure",
  };
}

function getFailFastDownloaderCta(
  toolId: string,
  extensionUrl?: string,
  extensionProductName?: string
): ExtensionFailureCta | null {
  if (!HIGH_RISK_DOWNLOADER_TOOL_IDS.has(toolId)) return null;

  return {
    extensionUrl: extensionUrl ?? DOWNLOADER_EXTENSION_URL,
    productName: extensionProductName || "Downloader",
    reason: "site_unreliable",
  };
}

function getLocalUsageDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function incrementLocalUsageCount() {
  if (typeof window === "undefined") return 0;

  const today = getLocalUsageDayKey();
  try {
    const stored = window.localStorage.getItem(LOCAL_USAGE_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) as { day?: string; count?: number } : null;
    const currentCount =
      parsed?.day === today && Number.isFinite(parsed.count) ? Number(parsed.count) : 0;
    const nextCount = currentCount + 1;
    window.localStorage.setItem(
      LOCAL_USAGE_STORAGE_KEY,
      JSON.stringify({ day: today, count: nextCount }),
    );
    return nextCount;
  } catch {
    return 0;
  }
}

function DownloaderCooldownMonetizationPanel({
  cooldownEndsAtMs,
  extensionUrl,
  toolId,
}: {
  cooldownEndsAtMs: number | null;
  extensionUrl?: string;
  toolId: string;
}) {
  return (
    <div className="mx-auto mt-4 grid max-w-5xl gap-4 text-left lg:grid-cols-[minmax(0,1fr)_336px] lg:items-stretch">
      <div className="flex flex-col justify-center rounded-lg border border-[#bfd4ff] bg-[#eef4ff] p-4 text-[#12337a]">
        <DownloaderCooldownNotice
          cooldownEndsAtMs={cooldownEndsAtMs}
          dataTestId="downloader-hero-cooldown"
          className="text-sm font-semibold text-[#0f62fe]"
        />
        <p className="mt-2 text-sm leading-6">{DOWNLOADER_EXTENSION_TEXT}</p>
        <SerplyCtaButton
          href={extensionUrl ?? DOWNLOADER_EXTENSION_URL}
          label={DOWNLOADER_EXTENSION_LABEL}
          className="mt-4 h-10 w-full px-5 text-sm sm:w-fit"
        />
      </div>

      <ToolAdSlot
        slotId={`${toolId}-cooldown-inline`}
        size="336x280"
        className="mx-auto h-[280px] w-full max-w-[336px]"
      />
    </div>
  );
}

async function downloadUrlToBlob(
  url: URL,
  mode: "audio" | "video",
  onProgress?: (update: ProgressUpdate) => void
) {
  const response = await fetch(getDownloaderMediaFetchEndpoint(), {
    method: "POST",
    headers: createDownloaderRequestHeaders(),
    body: JSON.stringify({
      consumer: DOWNLOADER_CONSUMER,
      mode,
      url: url.toString(),
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      if (data?.error) {
        detail = data.error;
      }
    } catch {
      detail = "";
    }
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`Download failed (${response.status})${suffix}`);
  }

  const contentTypeRaw = response.headers.get("content-type") || "";
  const contentType = contentTypeRaw.split(";")[0]?.trim().toLowerCase() || "";
  const fileNameFromHeader = response.headers.get("x-media-filename")?.trim() || "";
  const fileNameFromUrl = getFileNameFromUrl(url);
  const fileNameCandidate = fileNameFromHeader || fileNameFromUrl;
  const extensionFromHeader =
    response.headers.get("x-media-extension")?.trim().toLowerCase() || "";
  const extensionFromName = getExtensionFromName(fileNameCandidate);
  const extensionFromType = MIME_EXTENSION_MAP[contentType] || "";
  const extension = SUPPORTED_EXTENSIONS.has(extensionFromName)
    ? extensionFromName
    : extensionFromHeader && SUPPORTED_EXTENSIONS.has(extensionFromHeader)
      ? extensionFromHeader
      : extensionFromType;
  const looksLikeMedia =
    contentType.startsWith("audio/") || contentType.startsWith("video/");

  if (!extension || !SUPPORTED_EXTENSIONS.has(extension)) {
    if (looksLikeMedia) {
      throw new Error(
        "This link returns a media type we do not support yet. Try another link."
      );
    }
    throw new Error(
      "That link does not look like a supported media file. Try another link."
    );
  }

  let fileName = fileNameCandidate || "download";
  if (!getExtensionFromName(fileName)) {
    fileName = `${fileName}.${extension}`;
  }

  const totalBytesHeader = response.headers.get("content-length");
  const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : 0;
  const hasTotalBytes = Number.isFinite(totalBytes) && totalBytes > 0;

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    return {
      blob: new Blob([buffer], { type: contentType || "application/octet-stream" }),
      fileName,
    };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const startedAt = performance.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.byteLength;

    const elapsed = (performance.now() - startedAt) / 1000;
    const speed = elapsed > 0 ? receivedBytes / elapsed : 0;
    const ratio = hasTotalBytes ? Math.min(1, receivedBytes / totalBytes) : undefined;
    const etaSeconds =
      hasTotalBytes && speed > 0 ? Math.max(0, (totalBytes - receivedBytes) / speed) : undefined;

    onProgress?.({
      receivedBytes,
      totalBytes: hasTotalBytes ? totalBytes : undefined,
      ratio,
      etaSeconds,
    });
  }

  const blobParts = chunks.map((chunk) => {
    const slice = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
    return normalizeBlobPart(slice);
  });
  const blob = new Blob(blobParts, { type: contentType || "application/octet-stream" });
  return { blob, fileName };
}

export default function VideoDownloaderTool({
  toolId,
  title,
  subtitle,
  mode = "video",
  adsVisible: controlledAdsVisible,
  onAdsVisibleChange,
  cooldownEndsAtMs = null,
  extensionUrl,
  extensionProductName,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [currentFile, setCurrentFile] = useState<ToolProgressFile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extensionFailureCta, setExtensionFailureCta] =
    useState<ExtensionFailureCta | null>(null);
  const [localUsageCount, setLocalUsageCount] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const [uncontrolledAdsVisible, setUncontrolledAdsVisible] = useState(false);
  const adsVisible = controlledAdsVisible ?? uncontrolledAdsVisible;

  function revealAds() {
    if (adsVisible) return;
    if (onAdsVisibleChange) {
      onAdsVisibleChange(true);
      return;
    }
    setUncontrolledAdsVisible(true);
  }

  async function handleUrlSubmit() {
    if (busy) return;
    const parsedUrl = parseUrlInput(urlInput);
    if (!parsedUrl) {
      setExtensionFailureCta(null);
      setErrorMessage("Paste a valid public URL first.");
      return;
    }

    revealAds();
    const nextUsageCount = incrementLocalUsageCount();
    setLocalUsageCount(nextUsageCount);
    setErrorMessage(null);
    setExtensionFailureCta(null);

    const nameHint = getFileNameFromUrl(parsedUrl);
    const failFastCta = getFailFastDownloaderCta(
      toolId,
      extensionUrl,
      extensionProductName
    );

    if (failFastCta) {
      const isExtensionOnly = failFastCta.reason === "extension_only";
      setExtensionFailureCta(failFastCta);
      setCurrentFile({
        name: nameHint,
        progress: 0,
        status: "error",
        message: isExtensionOnly
          ? "This website requires the browser extension."
          : "Use the browser extension for this site.",
      });
      const run = beginToolRun({
        toolId,
        from: "url",
        to: mode === "video" ? "mp4" : "audio",
        metadata: {
          source: "url",
          mode,
          urlHost: parsedUrl.host,
          failFast: true,
          failFastReason: failFastCta.reason,
        },
      });
      run.finishFailure({
        errorCode: isExtensionOnly
          ? "downloader_extension_only"
          : "known_unreliable_web_downloader",
        metadata: {
          source: "url",
          mode,
          urlHost: parsedUrl.host,
          failFast: true,
          failFastReason: failFastCta.reason,
        },
      });
      return;
    }

    setBusy(true);
    setCurrentFile({
      name: nameHint,
      progress: 0,
      status: "loading",
      message: "Starting download...",
    });

    const run = beginToolRun({
      toolId,
      from: "url",
      to: mode === "video" ? "mp4" : "audio",
      metadata: { source: "url", mode, urlHost: parsedUrl.host },
    });

    try {
      const result = await downloadUrlToBlob(parsedUrl, mode, (update) => {
        const hasRatio = typeof update.ratio === "number";
        const ratio = update.ratio ?? 0;
        const progress = hasRatio ? Math.round(ratio * 100) : 0;
        const percent = hasRatio ? Math.round(ratio * 100) : null;
        const eta = update.etaSeconds ? formatDuration(update.etaSeconds) : "";
        const received = formatBytes(update.receivedBytes);
        const total = update.totalBytes ? formatBytes(update.totalBytes) : "";

        let message = "Downloading...";
        if (percent !== null) {
          message = `Downloading... ${percent}%`;
        }
        if (total) {
          message += ` (${received} / ${total}`;
          if (eta) {
            message += `, ~${eta} left`;
          }
          message += ")";
        } else {
          message += ` (${received})`;
        }

        setCurrentFile({
          name: nameHint,
          progress,
          status: "loading",
          message,
        });
      });

      saveBlob(result.blob, result.fileName);
      run.finishSuccess({
        outputBytes: result.blob.size,
        metadata: { fileName: result.fileName, source: "url", mode },
      });
      setCurrentFile({
        name: result.fileName,
        progress: 100,
        status: "completed",
        message: "Download ready!",
      });
    } catch (err) {
      const failure = getTelemetryFailure(err, "download_failed");
      const message = failure.message || "Download failed";
      const extensionCta = getExtensionFailureCta(
        message,
        extensionUrl,
        extensionProductName
      );

      if (extensionCta) {
        setExtensionFailureCta(extensionCta);
        setErrorMessage(null);
        setCurrentFile({
          name: nameHint,
          progress: 0,
          status: "error",
          message: "Use the browser extension for this site.",
        });
        run.finishFailure({ errorCode: failure.errorCode, metadata: failure.metadata });
        return;
      }

      setCurrentFile({
        name: nameHint,
        progress: 0,
        status: "error",
        message,
      });
      run.finishFailure({ errorCode: failure.errorCode, metadata: failure.metadata });
    } finally {
      setBusy(false);
    }
  }

  const adSlotPrefix = toolId;
  const showCooldownNotice = cooldownEndsAtMs !== null;
  const showUsagePressure =
    localUsageCount >= LOCAL_USAGE_PRESSURE_THRESHOLD && !extensionFailureCta;
  const hasBelowContent =
    Boolean(errorMessage) || Boolean(extensionFailureCta) || showCooldownNotice || showUsagePressure;

  return (
    <ToolHeroLayout
      adsVisible={adsVisible}
      adSlotPrefix={adSlotPrefix}
      currentFile={currentFile}
      progressCompletedLabel="Download complete!"
      showInlineAd={false}
      contentClassName="text-center"
      containerClassName="max-w-6xl px-6 py-10"
      resultPanel={
        showCooldownNotice ? undefined : (
          <ToolResultMonetizationPanel
            slotPrefix={toolId}
            variant="downloader"
            extensionUrl={extensionUrl}
            extensionProductName={extensionProductName}
          />
        )
      }
      hero={
        <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-8 shadow-sm">
          <div className="mx-auto max-w-2xl space-y-4">
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                type="url"
                inputMode="url"
                placeholder="Paste public video link here"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleUrlSubmit();
                  }
                }}
                className="h-12 w-full rounded-lg border border-gray-200 bg-white px-4 py-3 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={busy}
                data-testid="tool-url-input"
              />
              <Button
                size="lg"
                className="h-12 px-6"
                onClick={handleUrlSubmit}
                disabled={busy || !urlInput.trim()}
                data-testid="tool-url-submit"
              >
                {busy ? "Working..." : "DOWNLOAD"}
              </Button>
            </div>
          </div>
        </div>
      }
      below={
        hasBelowContent ? (
          <div className="mt-4 space-y-2">
            {errorMessage ? <div className="text-sm text-red-600">{errorMessage}</div> : null}
            {showUsagePressure ? (
              <div className="mx-auto max-w-2xl rounded-lg border border-[#bfd4ff] bg-[#eef4ff] p-4 text-left text-[#12337a]">
                <p className="text-sm font-semibold">
                  You have tried {localUsageCount} downloads today.
                </p>
                <p className="mt-2 text-sm leading-6">
                  Install the browser extension for unlimited downloads and fewer web-form
                  limits.
                </p>
                <SerplyCtaButton
                  href={extensionUrl ?? DOWNLOADER_EXTENSION_URL}
                  label={DOWNLOADER_EXTENSION_LABEL}
                  className="mt-4 h-10 px-5 text-sm"
                />
              </div>
            ) : null}
            {extensionFailureCta ? (
              <div className="mx-auto max-w-2xl rounded-lg border border-[#bfd4ff] bg-[#eef4ff] p-4 text-left">
                <h2 className="text-base font-semibold text-[#12337a]">
                  {extensionFailureCta.reason === "extension_only"
                    ? "Browser Extension Required"
                    : `Use the ${extensionFailureCta.productName} Extension`}
                </h2>
                <p className="mt-2 text-sm leading-6 text-[#12337a]">
                  {extensionFailureCta.reason === "extension_only"
                    ? "This website requires a browser extension to download from."
                    : `This site cannot be downloaded reliably from the web form. The ${extensionFailureCta.productName} Extension detects the video inside your browser and saves it directly.`}
                </p>
                <SerplyCtaButton
                  href={extensionFailureCta.extensionUrl}
                  label={`Get the ${extensionFailureCta.productName} Extension`}
                  className="mt-4 h-10 px-5 text-sm"
                />
              </div>
            ) : null}
            {showCooldownNotice ? (
              <DownloaderCooldownMonetizationPanel
                cooldownEndsAtMs={cooldownEndsAtMs}
                extensionUrl={extensionUrl}
                toolId={toolId}
              />
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
