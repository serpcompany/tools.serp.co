import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const downloaderPageHeroPath = new URL(
  "../components/DownloaderPageHero.tsx",
  import.meta.url,
);
const downloaderPageHeroExists = existsSync(downloaderPageHeroPath);
const downloaderPageHeroSource = downloaderPageHeroExists
  ? readFileSync(downloaderPageHeroPath, "utf8")
  : "";
const toolAdsSource = readFileSync(
  new URL("../components/ToolAds.tsx", import.meta.url),
  "utf8",
);
const toolHeroLayoutSource = readFileSync(
  new URL("../components/ToolHeroLayout.tsx", import.meta.url),
  "utf8",
);
const toolResultMonetizationSource = readFileSync(
  new URL("../components/ToolResultMonetizationPanel.tsx", import.meta.url),
  "utf8",
);
const heroConverterSource = readFileSync(
  new URL("../components/HeroConverter.tsx", import.meta.url),
  "utf8",
);
const landerHeroTwoColumnSource = readFileSync(
  new URL("../components/LanderHeroTwoColumn.tsx", import.meta.url),
  "utf8",
);

test("downloader pages keep ads hidden until the user initiates the action", () => {
  assert.equal(
    downloaderPageHeroExists,
    true,
    "expected a shared downloader page hero component to own ad visibility",
  );
  assert.match(downloaderPageHeroSource, /const \[adsVisible, setAdsVisible\] = useState\(false\)/);
  assert.match(downloaderPageHeroSource, /const \[ctaModalOpen, setCtaModalOpen\] = useState\(false\)/);
  assert.match(
    downloaderPageHeroSource,
    /const \[cooldownEndsAtMs, setCooldownEndsAtMs\] = useState<number \| null>\(null\)/,
  );
  assert.match(downloaderPageHeroSource, /<VideoDownloaderTool[\s\S]*adsVisible={adsVisible}/);
  assert.match(
    downloaderPageHeroSource,
    /<VideoDownloaderTool[\s\S]*onAdsVisibleChange={handleAdsVisibleChange}[\s\S]*cooldownEndsAtMs={cooldownEndsAtMs}[\s\S]*onCooldownChange={setCooldownEndsAtMs}/,
  );
  assert.match(downloaderPageHeroSource, /if \(visible\) \{\s*setCtaModalOpen\(true\);\s*\}/);
  assert.match(
    downloaderPageHeroSource,
    /<DownloaderExtensionCTAModal[\s\S]*open={ctaModalOpen}[\s\S]*onOpenChange={setCtaModalOpen}[\s\S]*cooldownEndsAtMs={cooldownEndsAtMs}/,
  );
  assert.match(downloaderPageHeroSource, /\{adsVisible && \(/);
});

test("shared tool ad rails do not reserve rail height while ads are hidden", () => {
  assert.match(toolAdsSource, /if \(!visible\) \{\s*return \(/);
  assert.doesNotMatch(toolAdsSource, /railPlaceholderClass/);
  assert.doesNotMatch(toolAdsSource, /hidden h-\[600px\] w-full xl:block/);
  assert.match(toolAdsSource, /xl:grid-cols-\[160px_minmax\(0,1fr\)_160px\]/);
  assert.match(toolAdsSource, /className="hidden h-\[600px\] w-full xl:flex"/);
});

test("unfilled ad slots render house ads instead of inert placeholders", () => {
  assert.match(toolAdsSource, /HouseAdFallback/);
  assert.match(toolAdsSource, /data-house-ad="quiet"/);
  assert.match(toolAdsSource, /DOWNLOADER_EXTENSION_TEXT/);
  assert.match(toolAdsSource, /Browser extension available/);
  assert.match(toolAdsSource, /SERP Tools/);
  assert.doesNotMatch(toolAdsSource, /SerplyCtaButton/);
  assert.doesNotMatch(toolAdsSource, /ctaLabel/);
  assert.doesNotMatch(toolAdsSource, /border-dashed border-gray-200 bg-gray-50\/80/);
});

test("completed or failed tool runs show a post-result monetization panel", () => {
  assert.match(toolHeroLayoutSource, /resultPanel\?: React\.ReactNode/);
  assert.match(toolHeroLayoutSource, /currentFile\?\.status === "completed"/);
  assert.match(toolHeroLayoutSource, /currentFile\?\.status === "error"/);
  assert.match(toolHeroLayoutSource, /showResultPanel \? resultPanel : null/);
  assert.match(toolResultMonetizationSource, /tool-result-monetization/);
  assert.match(toolResultMonetizationSource, /result-inline/);
  assert.match(toolResultMonetizationSource, /size="336x280"/);
  assert.match(heroConverterSource, /ToolResultMonetizationPanel/);
  assert.match(landerHeroTwoColumnSource, /ToolResultMonetizationPanel/);
});
