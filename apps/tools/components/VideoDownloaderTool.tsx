"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@serp-tools/ui/components/button";
import DownloaderCooldownNotice from "@/components/DownloaderCooldownNotice";
import SerplyCtaButton from "@/components/SerplyCtaButton";
import { ToolAdSlot } from "@/components/ToolAds";
import { ToolHeroLayout } from "@/components/ToolHeroLayout";
import type { ToolProgressFile } from "@/components/ToolProgressIndicator";
import { ToolResultMonetizationPanel } from "@/components/ToolResultMonetizationPanel";
import {
  DOWNLOADER_EXTENSION_LABEL,
  DOWNLOADER_EXTENSION_TEXT,
  DOWNLOADER_EXTENSION_URL,
} from "@/lib/downloader-extension-cta";
import { createBrowserMediaWorkflow } from "@/lib/media-workflow/browser";
import { getDownloaderAttemptPolicy } from "@/lib/media-workflow/attempt-policy";
import { createMonotonicProgress } from "@/lib/media-workflow/monotonic-progress";
import { projectMediaTransfer } from "@/lib/media-workflow/transfer-presentation";

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

const LOCAL_USAGE_STORAGE_KEY = "serp-tools:downloader-usage:v1";
const LOCAL_USAGE_PRESSURE_THRESHOLD = 3;
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

function getExtensionFailureCta(
  message: string,
  extensionUrl?: string,
  extensionProductName?: string,
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
  extensionProductName?: string,
): ExtensionFailureCta | null {
  if (getDownloaderAttemptPolicy(toolId).kind !== "reject") return null;

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
    const parsed = stored
      ? (JSON.parse(stored) as { day?: string; count?: number })
      : null;
    const currentCount =
      parsed?.day === today && Number.isFinite(parsed.count)
        ? Number(parsed.count)
        : 0;
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
  showExtensionCta = true,
  toolId,
}: {
  cooldownEndsAtMs: number | null;
  extensionUrl?: string;
  showExtensionCta?: boolean;
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
        {showExtensionCta ? (
          <>
            <p className="mt-2 text-sm leading-6">
              {DOWNLOADER_EXTENSION_TEXT}
            </p>
            <SerplyCtaButton
              href={extensionUrl ?? DOWNLOADER_EXTENSION_URL}
              label={DOWNLOADER_EXTENSION_LABEL}
              className="mt-4 h-10 w-full px-5 text-sm sm:w-fit"
            />
          </>
        ) : null}
      </div>

      <ToolAdSlot
        slotId={`${toolId}-cooldown-inline`}
        size="336x280"
        className="mx-auto h-[280px] w-full max-w-[336px]"
      />
    </div>
  );
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
  const activeRun = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [currentFile, setCurrentFile] = useState<ToolProgressFile | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [extensionFailureCta, setExtensionFailureCta] =
    useState<ExtensionFailureCta | null>(null);
  const [localUsageCount, setLocalUsageCount] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const [uncontrolledAdsVisible, setUncontrolledAdsVisible] = useState(false);
  const adsVisible = controlledAdsVisible ?? uncontrolledAdsVisible;

  useEffect(() => () => activeRun.current?.abort("Downloader unmounted"), []);

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

    const nameHint = "Media download";
    const failFastCta = getFailFastDownloaderCta(
      toolId,
      extensionUrl,
      extensionProductName,
    );

    setBusy(true);
    setCurrentFile({
      name: nameHint,
      progress: 0,
      status: "loading",
      message: "Starting download...",
    });

    const progress = createMonotonicProgress();
    try {
      const controller = new AbortController();
      activeRun.current?.abort("Replaced by a new downloader run");
      activeRun.current = controller;
      const outcome = await createBrowserMediaWorkflow({
        releaseDeliveredBytes: true,
        onTransfer(transfer) {
          const presentation = projectMediaTransfer(transfer);
          setCurrentFile({
            name: nameHint,
            progress: progress.project(presentation.progress),
            status: "loading",
            message: presentation.message,
          });
        },
      }).run(
        {
          toolId,
          input: { kind: "url", url: parsedUrl.toString() },
          options: { mode },
        },
        {
          signal: controller.signal,
          observe(snapshot) {
            if (
              snapshot.phase === "succeeded" ||
              snapshot.phase === "failed" ||
              snapshot.phase === "cancelled"
            ) {
              return;
            }
            setCurrentFile({
              name: nameHint,
              progress: progress.project(
                snapshot.progress === undefined
                  ? undefined
                  : snapshot.progress * 100,
              ),
              status: snapshot.phase === "acquiring" ? "loading" : "processing",
              message:
                snapshot.phase === "acquiring"
                  ? "Downloading..."
                  : snapshot.phase === "delivering"
                    ? "Preparing download..."
                    : "Checking download...",
            });
          },
        },
      );
      if (outcome.status === "failed") throw new Error(outcome.error.message);
      if (outcome.status === "cancelled") return;
      const result = outcome.results[0];
      if (!result) throw new Error("Download produced no result");
      setCurrentFile({
        name: result.name,
        progress: 100,
        status: "completed",
        message: "Download ready!",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed";
      if (failFastCta) {
        setExtensionFailureCta(failFastCta);
        setCurrentFile({
          name: nameHint,
          progress: 0,
          status: "error",
          message: "Use the browser extension for this site.",
        });
        return;
      }
      const extensionCta = getExtensionFailureCta(
        message,
        extensionUrl,
        extensionProductName,
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
        return;
      }

      setCurrentFile({
        name: nameHint,
        progress: 0,
        status: "error",
        message,
      });
    } finally {
      activeRun.current = null;
      setBusy(false);
    }
  }

  const adSlotPrefix = toolId;
  const showCooldownNotice = cooldownEndsAtMs !== null;
  const showUsagePressure =
    localUsageCount >= LOCAL_USAGE_PRESSURE_THRESHOLD && !extensionFailureCta;
  const hasBelowContent =
    Boolean(errorMessage) ||
    Boolean(extensionFailureCta) ||
    showCooldownNotice ||
    showUsagePressure;

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
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}

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
            {errorMessage ? (
              <div className="text-sm text-red-600">{errorMessage}</div>
            ) : null}
            {showUsagePressure ? (
              <div className="mx-auto max-w-2xl rounded-lg border border-[#bfd4ff] bg-[#eef4ff] p-4 text-left text-[#12337a]">
                <p className="text-sm font-semibold">
                  You have tried {localUsageCount} downloads today.
                </p>
                <p className="mt-2 text-sm leading-6">
                  Install the browser extension for unlimited downloads and
                  fewer web-form limits.
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
                showExtensionCta={!extensionFailureCta}
                toolId={toolId}
              />
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
