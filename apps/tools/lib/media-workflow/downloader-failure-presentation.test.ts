import assert from "node:assert/strict";
import test from "node:test";

import { getDownloaderExtensionCta } from "./downloader-failure-presentation.ts";

test("only structured extension recovery creates a downloader CTA", () => {
  assert.deepEqual(
    getDownloaderExtensionCta(
      {
        code: "acquisition-failed",
        message: "Download failed (403): Browser integration required",
        recovery: { kind: "browser-extension-required" },
      },
      {
        extensionUrl: "https://extension.example/install",
        productName: "Video Helper",
      },
    ),
    {
      extensionUrl: "https://extension.example/install",
      productName: "Video Helper",
      reason: "extension_only",
    },
  );

  for (const message of [
    "Unsupported URL",
    "Download failed (403)",
    "Download failed (500)",
    "Failed to fetch media",
    "This link returns a media type we do not support yet",
  ]) {
    assert.equal(
      getDownloaderExtensionCta({ code: "acquisition-failed", message }),
      null,
      message,
    );
  }
});
