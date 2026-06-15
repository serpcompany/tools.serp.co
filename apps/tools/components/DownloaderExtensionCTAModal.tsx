"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@serp-tools/ui/components/dialog";
import DownloaderCooldownNotice from "@/components/DownloaderCooldownNotice";
import SerplyCtaButton from "@/components/SerplyCtaButton";
import {
  DOWNLOADER_EXTENSION_LABEL,
  DOWNLOADER_EXTENSION_TEXT,
  DOWNLOADER_EXTENSION_URL,
} from "@/lib/downloader-extension-cta";

type DownloaderExtensionCTAModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cooldownEndsAtMs: number | null;
};

export default function DownloaderExtensionCTAModal({
  open,
  onOpenChange,
  cooldownEndsAtMs,
}: DownloaderExtensionCTAModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-w-md border-[#bfd4ff]">
        <DialogHeader className="text-left">
          <DialogTitle>Download Faster</DialogTitle>
          <DialogDescription className="text-sm text-[#12337a]">
            {DOWNLOADER_EXTENSION_TEXT}
          </DialogDescription>
        </DialogHeader>

        <DownloaderCooldownNotice
          cooldownEndsAtMs={cooldownEndsAtMs}
          dataTestId="downloader-cta-cooldown"
          className="rounded-md bg-[#eef4ff] px-3 py-2 text-sm font-medium text-[#0f62fe]"
        />

        <DialogFooter className="sm:justify-start">
          <SerplyCtaButton
            href={DOWNLOADER_EXTENSION_URL}
            label={DOWNLOADER_EXTENSION_LABEL}
            className="h-10"
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
