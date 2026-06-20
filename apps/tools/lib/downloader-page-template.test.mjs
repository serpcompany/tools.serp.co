import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const templateSource = readFileSync(
  new URL("../components/DownloaderPageTemplate.tsx", import.meta.url),
  "utf8",
);
const downloaderCtaSource = readFileSync(
  new URL("../components/DownloaderExtensionCTA.tsx", import.meta.url),
  "utf8",
);
const downloaderCtaModalSource = readFileSync(
  new URL("../components/DownloaderExtensionCTAModal.tsx", import.meta.url),
  "utf8",
);
const downloaderCooldownNoticeSource = readFileSync(
  new URL("../components/DownloaderCooldownNotice.tsx", import.meta.url),
  "utf8",
);
const downloaderCtaConfigSource = readFileSync(
  new URL("../lib/downloader-extension-cta.ts", import.meta.url),
  "utf8",
);
const downloaderHeroSource = readFileSync(
  new URL("../components/DownloaderPageHero.tsx", import.meta.url),
  "utf8",
);
const videoDownloaderToolSource = readFileSync(
  new URL("../components/VideoDownloaderTool.tsx", import.meta.url),
  "utf8",
);
const videoDownloaderPageSource = readFileSync(
  new URL("../app/video-downloader/page.tsx", import.meta.url),
  "utf8",
);
const loomDownloaderPageSource = readFileSync(
  new URL("../app/download-loom-videos/page.tsx", import.meta.url),
  "utf8",
);
const dynamicToolPageSource = readFileSync(
  new URL("../app/(convert)/[tool]/page.tsx", import.meta.url),
  "utf8",
);

test("downloader page template includes the ad banner section", () => {
  assert.match(templateSource, /DownloaderPageHero/);
  assert.match(downloaderHeroSource, /ToolAdInline/);
  assert.match(downloaderHeroSource, /Advertisement/);
  assert.match(downloaderHeroSource, /banner-inline/);
});

test("downloader page template includes the shared browser extension CTA", () => {
  assert.match(templateSource, /<DownloaderExtensionCTA extensionUrl={content\.productLinks\?\.serplyUrl}/);
  assert.doesNotMatch(templateSource, /productCtaUrl/);
  assert.doesNotMatch(templateSource, /Browser Extension/);
  assert.match(templateSource, /<DownloaderPageHero[\s\S]*extensionUrl={content\.productLinks\?\.serplyUrl}/);
  assert.match(templateSource, /<DownloaderPageHero[\s\S]*extensionProductName={content\.tool\.title}/);
  assert.match(templateSource, /getDownloaderOutboundLinks/);
  assert.match(templateSource, /Official Links/);
  assert.match(templateSource, /Install browser extension/);
  assert.match(templateSource, /SERP Apps/);
  assert.doesNotMatch(templateSource, /Apps lander/);
  assert.doesNotMatch(templateSource, /Apps page/);
  assert.match(templateSource, /GitHub repository/);
  assert.match(templateSource, /content\.sourceLinks/);
  assert.match(templateSource, /outboundLinks\.map/);
  assert.match(templateSource, /href={withSerplyTracking\(link\.url\)}/);
  assert.doesNotMatch(templateSource, /link\.url\.replace/);
  assert.doesNotMatch(templateSource, /break-all/);
  assert.match(downloaderHeroSource, /<VideoDownloaderTool[\s\S]*extensionUrl={extensionUrl}/);
  assert.match(downloaderHeroSource, /<VideoDownloaderTool[\s\S]*extensionProductName={extensionProductName}/);
  assert.match(downloaderHeroSource, /<DownloaderExtensionCTAModal[\s\S]*extensionUrl={extensionUrl}/);
  assert.match(downloaderCtaSource, /extensionUrl\?: string/);
  assert.match(downloaderCtaSource, /href={extensionUrl}/);
  assert.match(downloaderCtaModalSource, /extensionUrl\?: string/);
  assert.match(downloaderCtaModalSource, /href={extensionUrl}/);
  assert.match(downloaderCtaSource, /DOWNLOADER_EXTENSION_TEXT/);
  assert.match(downloaderCtaSource, /DOWNLOADER_EXTENSION_LABEL/);
  assert.match(downloaderCtaSource, /DOWNLOADER_EXTENSION_URL/);
  assert.match(downloaderCtaModalSource, /DOWNLOADER_EXTENSION_TEXT/);
  assert.match(downloaderCtaModalSource, /DOWNLOADER_EXTENSION_LABEL/);
  assert.match(downloaderCtaModalSource, /DOWNLOADER_EXTENSION_URL/);
  assert.match(downloaderCtaModalSource, /DownloaderCooldownNotice/);
  assert.match(downloaderCtaModalSource, /downloader-cta-cooldown/);
  assert.match(downloaderCooldownNoticeSource, /cooldownEndsAtMs: number \| null/);
  assert.match(downloaderCooldownNoticeSource, /Next download unlocks in/);
  assert.match(downloaderCooldownNoticeSource, /Next download is available now\./);
  assert.match(
    downloaderCtaConfigSource,
    /Get the browser extension for unlimited downloads\./,
  );
  assert.match(
    downloaderCtaConfigSource,
    /Get It Now/,
  );
  assert.match(downloaderCtaSource, /lg:justify-between/);
  assert.match(downloaderCtaSource, /lg:text-left/);
  assert.match(downloaderCtaSource, /w-full sm:w-auto/);
  assert.match(downloaderCtaSource, /SerplyCtaButton/);
  assert.match(downloaderCtaSource, /sticky top-16 z-40/);
  assert.match(downloaderCtaConfigSource, /https:\/\/serp\.ly\/serp-video-tools/);
  assert.doesNotMatch(loomDownloaderPageSource, /serp-video-tools/);
  assert.doesNotMatch(
    downloaderCtaSource,
    /Save time with the browser extension and launch the downloader workflow from anywhere\./,
  );
  assert.doesNotMatch(
    downloaderCtaSource,
    /Get the Downloader Browser Extension/,
  );
});

test("source-specific downloader failures promote the extension instead of raw backend errors", () => {
  assert.match(videoDownloaderToolSource, /extensionUrl\?: string/);
  assert.match(videoDownloaderToolSource, /extensionProductName\?: string/);
  assert.match(videoDownloaderToolSource, /getExtensionFailureCta/);
  assert.match(videoDownloaderToolSource, /Use the \$\{extensionFailureCta\.productName\} Extension/);
  assert.match(videoDownloaderToolSource, /Get the \$\{extensionFailureCta\.productName\} Extension/);
  assert.match(videoDownloaderToolSource, /href={extensionFailureCta\.extensionUrl}/);
  assert.match(videoDownloaderToolSource, /This site cannot be downloaded reliably from the web form/);
  assert.match(videoDownloaderToolSource, /Unsupported URL/);
  assert.match(videoDownloaderToolSource, /Download failed \\\(500\\\)/);
  assert.match(videoDownloaderToolSource, /extensionUrl: extensionUrl \?\? DOWNLOADER_EXTENSION_URL/);
  assert.match(videoDownloaderToolSource, /setExtensionFailureCta/);
  assert.match(videoDownloaderToolSource, /setErrorMessage\("Paste a valid public URL first\."\)/);
  assert.doesNotMatch(
    videoDownloaderToolSource,
    /setErrorMessage\(message\)/,
  );
}
);

test("dedicated downloader routes use the shared downloader page template", () => {
  assert.match(videoDownloaderPageSource, /DownloaderPageTemplate/);
  assert.match(loomDownloaderPageSource, /DownloaderPageTemplate/);
});

test("legacy typo downloader routes redirect to canonical downloader routes", () => {
  assert.match(dynamicToolPageSource, /LEGACY_DOWNLOADER_ROUTE_REDIRECTS/);
  assert.match(dynamicToolPageSource, /redirect\(legacyDownloaderRoute\)/);
  assert.match(
    dynamicToolPageSource,
    /download-stripcha-videos[\s\S]*\/download-stripchat-videos/,
  );
  assert.match(
    dynamicToolPageSource,
    /download-kajab-videos[\s\S]*\/download-kajabi-videos/,
  );
});

test("known unreliable downloader pages fail fast into extension monetization", () => {
  assert.match(videoDownloaderToolSource, /HIGH_RISK_DOWNLOADER_TOOL_IDS/);
  assert.match(videoDownloaderToolSource, /download-beeg-videos/);
  assert.match(videoDownloaderToolSource, /download-eporner-videos/);
  assert.match(videoDownloaderToolSource, /download-ashemaletube-videos/);
  assert.match(videoDownloaderToolSource, /download-xhamster-videos/);
  assert.match(videoDownloaderToolSource, /download-boyfriendtv-videos/);
  assert.match(videoDownloaderToolSource, /getFailFastDownloaderCta/);
  assert.match(videoDownloaderToolSource, /known_unreliable_web_downloader/);
  assert.match(videoDownloaderToolSource, /failFast: true/);
  assert.match(videoDownloaderToolSource, /Use the browser extension for this site\./);
});

test("downloaders map extension-only API responses into extension monetization", () => {
  assert.match(videoDownloaderToolSource, /Download failed/);
  assert.match(videoDownloaderToolSource, /403/);
  assert.match(videoDownloaderToolSource, /requires a browser extension/);
  assert.match(videoDownloaderToolSource, /extension_only/);
  assert.match(videoDownloaderToolSource, /Browser Extension Required/);
  assert.match(
    videoDownloaderToolSource,
    /This website requires a browser extension to download from\./,
  );
  assert.doesNotMatch(videoDownloaderToolSource, /NEXT_PUBLIC_FEATURE_FLAG_DOWNLOADER_EXTENSION_ONLY/);
});

test("downloader usage pressure is tracked locally without requiring login", () => {
  assert.match(videoDownloaderToolSource, /LOCAL_USAGE_STORAGE_KEY/);
  assert.match(videoDownloaderToolSource, /serp-tools:downloader-usage:v1/);
  assert.match(videoDownloaderToolSource, /LOCAL_USAGE_PRESSURE_THRESHOLD = 3/);
  assert.match(videoDownloaderToolSource, /incrementLocalUsageCount/);
  assert.match(videoDownloaderToolSource, /window\.localStorage\.setItem/);
  assert.match(videoDownloaderToolSource, /You have tried \{localUsageCount\} downloads today\./);
  assert.match(videoDownloaderToolSource, /Install the browser extension for unlimited downloads/);
});

test("shared downloader hero does not render the old public-links helper copy", () => {
  assert.doesNotMatch(
    videoDownloaderToolSource,
    /Public links only\. Private or logged-in content is not supported yet\./,
  );
  assert.match(videoDownloaderToolSource, /DownloaderCooldownNotice/);
  assert.match(videoDownloaderToolSource, /DownloaderCooldownMonetizationPanel/);
  assert.match(videoDownloaderToolSource, /ToolAdSlot/);
  assert.match(videoDownloaderToolSource, /cooldown-inline/);
  assert.match(videoDownloaderToolSource, /size="336x280"/);
  assert.match(videoDownloaderToolSource, /DOWNLOADER_EXTENSION_TEXT/);
  assert.match(videoDownloaderToolSource, /downloader-hero-cooldown/);
});
