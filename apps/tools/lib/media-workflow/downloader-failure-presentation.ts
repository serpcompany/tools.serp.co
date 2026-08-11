import { DOWNLOADER_EXTENSION_URL } from "../downloader-extension-cta.ts";
import type { WorkflowFailure } from "../tool-workflow/index.ts";

export type DownloaderExtensionCta = Readonly<{
  extensionUrl: string;
  productName: string;
  reason: "extension_only";
}>;

export function getDownloaderExtensionCta(
  failure: WorkflowFailure,
  options: {
    extensionUrl?: string;
    productName?: string;
  } = {},
): DownloaderExtensionCta | null {
  if (failure.recovery?.kind !== "browser-extension-required") return null;

  return {
    extensionUrl: options.extensionUrl ?? DOWNLOADER_EXTENSION_URL,
    productName: options.productName || "Downloader",
    reason: "extension_only",
  };
}
