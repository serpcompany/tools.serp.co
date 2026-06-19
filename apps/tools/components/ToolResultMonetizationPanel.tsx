"use client";

import SerplyCtaButton from "@/components/SerplyCtaButton";
import { ToolAdSlot } from "@/components/ToolAds";
import {
  DOWNLOADER_EXTENSION_LABEL,
  DOWNLOADER_EXTENSION_TEXT,
  DOWNLOADER_EXTENSION_URL,
} from "@/lib/downloader-extension-cta";

type ToolResultMonetizationPanelProps = {
  slotPrefix: string;
  variant?: "tool" | "downloader";
  extensionUrl?: string;
  extensionProductName?: string;
};

export function ToolResultMonetizationPanel({
  slotPrefix,
  variant = "tool",
  extensionUrl = DOWNLOADER_EXTENSION_URL,
  extensionProductName = "browser extension",
}: ToolResultMonetizationPanelProps) {
  const isDownloader = variant === "downloader";
  const title = isDownloader ? "Want fewer web-form limits?" : "Need another tool?";
  const body = isDownloader
    ? DOWNLOADER_EXTENSION_TEXT
    : "Browse more SERP tools for conversions, compression, downloads, and document workflows.";
  const ctaHref = isDownloader ? extensionUrl : "/";
  const ctaLabel = isDownloader ? DOWNLOADER_EXTENSION_LABEL : "Explore Tools";

  return (
    <div
      className="mx-auto mt-6 grid max-w-5xl gap-4 text-left lg:grid-cols-[minmax(0,1fr)_336px] lg:items-stretch"
      data-testid="tool-result-monetization"
    >
      <div className="flex flex-col justify-center rounded-lg border border-[#bfd4ff] bg-[#eef4ff] p-4 text-[#12337a]">
        <p className="text-xs font-bold uppercase tracking-wide text-[#0f62fe]">Next step</p>
        <h2 className="mt-1 text-base font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6">{body}</p>
        {isDownloader && extensionProductName !== "browser extension" ? (
          <p className="mt-2 text-xs leading-5 text-[#12337a]/80">
            The {extensionProductName} extension runs inside your browser for sites that
            block generic web downloaders.
          </p>
        ) : null}
        <SerplyCtaButton
          href={ctaHref}
          label={ctaLabel}
          className="mt-4 h-10 w-full px-5 text-sm sm:w-fit"
        />
      </div>

      <ToolAdSlot
        slotId={`${slotPrefix}-result-inline`}
        size="336x280"
        className="mx-auto h-[280px] w-full max-w-[336px]"
      />
    </div>
  );
}
