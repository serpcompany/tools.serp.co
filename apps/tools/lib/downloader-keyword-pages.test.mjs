import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tools = JSON.parse(
  readFileSync(
    new URL("./catalog/tools.json", import.meta.url),
    "utf8",
  ),
);

const requestedDownloaderIds = [
  "download-skool-videos",
  "download-vimeo-videos",
  "download-onlyfans-videos",
  "download-whop-videos",
  "download-123movies-videos",
  "download-circle-videos",
  "download-clientclub-videos",
  "download-dailymotion-videos",
  "download-gohighlevel-videos",
  "download-gokollab-videos",
  "download-alpha-porno-videos",
  "download-ashemaletube-videos",
  "download-beeg-videos",
  "download-boyfriendtv-videos",
  "download-coomer-videos",
  "download-eporner-videos",
  "download-erome-videos",
  "download-erothots-videos",
  "download-hdzog-videos",
  "download-hentaihaven-videos",
  "download-justforfans-videos",
  "download-luxuretv-videos",
  "download-manyvids-videos",
  "download-motherless-videos",
  "download-nhentai-videos",
  "download-pornhub-videos",
  "download-m3u8-videos",
  "download-porntrex-videos",
  "download-redgifs-videos",
  "download-redtube-videos",
  "download-spankbang-videos",
  "download-thisvid-videos",
  "download-tnaflix-videos",
  "download-tokyomotion-videos",
  "download-txxx-videos",
  "download-upornia-videos",
  "download-xfantazy-videos",
  "download-xhamster-videos",
  "download-xnxx-videos",
  "download-xvideos-videos",
  "download-yespornplease-videos",
  "download-youjizz-videos",
  "download-youporn-videos",
  "download-sprout-videos",
  "download-tiktok-videos",
  "download-wistia-videos",
  "download-youtube-videos",
  "download-bongacams-videos",
  "download-cam4-videos",
  "download-cams-com-videos",
  "download-camsoda-videos",
  "download-chaturbate-videos",
  "download-dreamcam-videos",
  "download-dreamcam-vr-videos",
  "download-facebook-videos",
  "download-fansly-live-videos",
  "download-flirt4free-videos",
  "download-instagram-videos",
  "download-kajabi-videos",
  "download-linkedin-videos",
  "download-mindvalley-videos",
  "download-myfreecams-videos",
  "download-pinterest-videos",
  "download-reddit-videos",
  "download-sexchathu-videos",
  "download-streamate-videos",
  "download-stripchat-videos",
  "download-stripchat-vr-videos",
  "download-tellatv-videos",
  "download-thinkific-videos",
  "download-twitch-videos",
  "download-twitter-x-videos",
  "download-xhamsterlive-videos",
  "download-xlovecam-videos",
  "download-patreon-videos",
  "download-soundgasm-videos",
  "download-3movs-videos",
  "download-bootyexpo-videos",
  "download-bravotube-videos",
  "download-drtuber-videos",
  "download-fapality-videos",
  "download-porndig-videos",
  "download-porndoe-videos",
  "download-sunporno-videos",
  "download-tube8-videos",
  "download-veporn-videos",
  "download-zbporn-videos",
];

const expectedSerplyUrls = {
  "download-123movies-videos": "https://serp.ly/123movies-downloader",
  "download-alpha-porno-videos": "https://serp.ly/alpha-porno-downloader",
  "download-ashemaletube-videos": "https://serp.ly/ashemaletube-downloader",
  "download-beeg-videos": "https://serp.ly/beeg-video-downloader",
  "download-bongacams-videos": "https://serp.ly/bongacams-downloader",
  "download-boyfriendtv-videos": "https://serp.ly/boyfriendtv-downloader",
  "download-cam4-videos": "https://serp.ly/cam4-video-downloader",
  "download-cams-com-videos": "https://serp.ly/camscom-video-downloader",
  "download-camsoda-videos": "https://serp.ly/camsoda-downloader",
  "download-chaturbate-videos": "https://serp.ly/chaturbate-downloader",
  "download-circle-videos": "https://serp.ly/circle-downloader",
  "download-clientclub-videos": "https://serp.ly/clientclub-downloader",
  "download-coomer-videos": "https://serp.ly/coomer-downloader",
  "download-dailymotion-videos": "https://serp.ly/dailymotion-downloader",
  "download-dreamcam-videos": "https://serp.ly/dreamcam-video-downloader",
  "download-dreamcam-vr-videos": "https://serp.ly/dreamcam-vr-video-downloader",
  "download-eporner-videos": "https://serp.ly/eporner-downloader",
  "download-erome-videos": "https://serp.ly/erome-downloader",
  "download-erothots-videos": "https://serp.ly/erothots-downloader",
  "download-facebook-videos": "https://serp.ly/facebook-downloader",
  "download-fansly-live-videos": "https://serp.ly/fansly-live-downloader",
  "download-flirt4free-videos": "https://serp.ly/flirt4free-video-downloader",
  "download-gohighlevel-videos": "https://serp.ly/gohighlevel-downloader",
  "download-gokollab-videos": "https://serp.ly/gokollab-downloader",
  "download-hdzog-videos": "https://serp.ly/hdzog-downloader",
  "download-hentaihaven-videos": "https://serp.ly/hentaihaven-downloader",
  "download-instagram-videos": "https://serp.ly/instagram-downloader",
  "download-justforfans-videos": "https://serp.ly/justforfans-downloader",
  "download-kajabi-videos": "https://serp.ly/kajabi-video-downloader",
  "download-linkedin-videos": "https://serp.ly/linkedin-downloader",
  "download-loom-videos": "https://serp.ly/loom-video-downloader",
  "download-luxuretv-videos": "https://serp.ly/luxuretv-downloader",
  "download-m3u8-videos": "https://serp.ly/m3u8-downloader",
  "download-manyvids-videos": "https://serp.ly/manyvids-downloader",
  "download-mindvalley-videos": "https://serp.ly/mindvalley-downloader",
  "download-motherless-videos": "https://serp.ly/motherless-downloader",
  "download-myfreecams-videos": "https://serp.ly/myfreecams-downloader",
  "download-nhentai-videos": "https://serp.ly/nhentai-downloader",
  "download-onlyfans-videos": "https://serp.ly/onlyfans-downloader",
  "download-pinterest-videos": "https://serp.ly/pinterest-downloader",
  "download-pornhub-videos": "https://serp.ly/pornhub-video-downloader",
  "download-porntrex-videos": "https://serp.ly/porntrex-downloader",
  "download-reddit-videos": "https://serp.ly/reddit-downloader",
  "download-redgifs-videos": "https://serp.ly/redgifs-downloader",
  "download-redtube-videos": "https://serp.ly/redtube-video-downloader",
  "download-sexchathu-videos": "https://serp.ly/sexchathu-video-downloader",
  "download-skool-videos": "https://serp.ly/skool-video-downloader",
  "download-spankbang-videos": "https://serp.ly/spankbang-video-downloader",
  "download-sprout-videos": "https://serp.ly/sprout-video-downloader",
  "download-streamate-videos": "https://serp.ly/streamate-video-downloader",
  "download-stripchat-videos": "https://serp.ly/stripchat-video-downloader",
  "download-stripchat-vr-videos": "https://serp.ly/stripchat-vr-video-downloader",
  "download-tellatv-videos": "https://serp.ly/tellatv-downloader",
  "download-thinkific-videos": "https://serp.ly/thinkific-downloader",
  "download-thisvid-videos": "https://serp.ly/thisvid-downloader",
  "download-tiktok-videos": "https://serp.ly/tiktok-downloader",
  "download-tnaflix-videos": "https://serp.ly/tnaflix-video-downloader",
  "download-tokyomotion-videos": "https://serp.ly/tokyomotion-downloader",
  "download-twitch-videos": "https://serp.ly/twitch-video-downloader",
  "download-twitter-x-videos": "https://serp.ly/twitter-downloader",
  "download-txxx-videos": "https://serp.ly/txxx-downloader",
  "download-upornia-videos": "https://serp.ly/upornia-downloader",
  "download-vimeo-videos": "https://serp.ly/vimeo-video-downloader",
  "download-whop-videos": "https://serp.ly/whop-video-downloader",
  "download-wistia-videos": "https://serp.ly/wistia-video-downloader",
  "download-xfantazy-videos": "https://serp.ly/xfantazy-downloader",
  "download-xhamster-videos": "https://serp.ly/xhamster-video-downloader",
  "download-xhamsterlive-videos": "https://serp.ly/xhamsterlive-video-downloader",
  "download-xlovecam-videos": "https://serp.ly/xlovecam-video-downloader",
  "download-xnxx-videos": "https://serp.ly/xnxx-video-downloader",
  "download-xvideos-videos": "https://serp.ly/xvideos-downloader",
  "download-yespornplease-videos": "https://serp.ly/yespornplease-downloader",
  "download-youjizz-videos": "https://serp.ly/youjizz-downloader",
  "download-youporn-videos": "https://serp.ly/youporn-video-downloader",
  "download-youtube-videos": "https://serp.ly/youtube-downloader",
  "download-patreon-videos": "https://serp.ly/patreon-downloader",
  "download-soundgasm-videos": "https://serp.ly/soundgasm-downloader",
  "download-3movs-videos": "https://serp.ly/3movs-downloader",
  "download-bootyexpo-videos": "https://serp.ly/bootyexpo-downloader",
  "download-bravotube-videos": "https://serp.ly/bravotube-downloader",
  "download-drtuber-videos": "https://serp.ly/drtuber-downloader",
  "download-fapality-videos": "https://serp.ly/fapality-downloader",
  "download-porndig-videos": "https://serp.ly/porndig-downloader",
  "download-porndoe-videos": "https://serp.ly/porndoe-downloader",
  "download-sunporno-videos": "https://serp.ly/sunporno-downloader",
  "download-tube8-videos": "https://serp.ly/tube8-downloader",
  "download-veporn-videos": "https://serp.ly/veporn-downloader",
  "download-zbporn-videos": "https://serp.ly/zbporn-downloader",
};

const expectedThisVidOutboundUrls = [
  "https://serp.ly/thisvid-downloader",
  "https://apps.serp.co/thisvid-downloader",
  "https://github.com/serpapps/thisvid-downloader",
  "https://extensions.serp.co/extensions/serp/thisvid-downloader/",
  "https://apify.com/serpxxx/thisvid-downloader/",
  "https://www.extensionhub.io/extensions/Thisvid-Downloader-1300",
  "https://browserextensions.io/products/thisvid-downloader",
  "https://serpdownloaders.com/products/thisvid-downloader",
  "https://serp.co/products/thisvid-downloader/reviews/",
  "https://serp.ai/products/thisvid-downloader/reviews/",
];

test("requested downloader keyword landers exist in the registry", () => {
  const activeDownloadTools = tools.filter(
    (tool) => tool.isActive && tool.operation === "download",
  );

  assert.ok(
    activeDownloadTools.length >= requestedDownloaderIds.length,
    "expected downloader registry to include the requested keyword landers",
  );

  for (const id of requestedDownloaderIds) {
    const tool = tools.find((candidate) => candidate.id === id);

    assert.ok(tool, `expected ${id} to exist in tools.json`);
    assert.equal(tool.operation, "download", `expected ${id} to be a download tool`);
    assert.equal(tool.isActive, true, `expected ${id} to be active`);
    assert.equal(tool.route, `/${id}`, `expected ${id} route to match slug`);
    assert.match(tool.name, /Downloader/, `expected ${id} to use downloader naming`);
  }
});

test("source-specific downloader landers include enriched content", () => {
  const sourceSpecificDownloaders = tools.filter(
    (tool) => tool.isActive && tool.operation === "download" && tool.id !== "video-downloader",
  );

  for (const tool of sourceSpecificDownloaders) {
    assert.ok(tool.content?.tool?.title, `expected ${tool.id} content tool title`);
    assert.ok(tool.content?.tool?.subtitle, `expected ${tool.id} content tool subtitle`);
    assert.ok(tool.content?.tool?.from, `expected ${tool.id} content source label`);
    assert.ok(tool.content?.tool?.to, `expected ${tool.id} content destination label`);
    assert.ok(tool.content?.howTo?.steps?.length >= 3, `expected ${tool.id} how-to steps`);
    assert.ok(tool.content?.infoArticle?.markdown, `expected ${tool.id} info article`);
    assert.ok(tool.content?.faqs?.length > 0, `expected ${tool.id} FAQs`);
    assert.ok(tool.content?.aboutSection?.fromFormat, `expected ${tool.id} from format`);
    assert.ok(tool.content?.aboutSection?.toFormat, `expected ${tool.id} to format`);
    if (expectedSerplyUrls[tool.id]) {
      assert.equal(
        tool.content?.productLinks?.serplyUrl,
        expectedSerplyUrls[tool.id],
        `expected ${tool.id} to use its own serp.ly CTA`,
      );
    } else {
      assert.match(
        tool.content?.productLinks?.serplyUrl ?? "",
        /^https:\/\/serp\.ly\/[a-z0-9-]+$/,
        `expected ${tool.id} to use a verified serp.ly CTA`,
      );
    }
    if (tool.content?.productLinks?.appsUrl) {
      assert.ok(
        tool.content.productLinks.appsUrl.startsWith("https://apps.serp.co/"),
        `expected ${tool.id} apps.serp.co URL`,
      );
    }
    assert.notEqual(
      tool.content?.productLinks?.serplyUrl,
      "https://serp.ly/serp-video-tools",
      `expected ${tool.id} not to use the generic CTA`,
    );
    assert.ok(tool.content?.features?.length > 0, `expected ${tool.id} feature list`);
    if (tool.content?.screenshots) {
      assert.ok(Array.isArray(tool.content.screenshots), `expected ${tool.id} screenshots array`);
    }
    if (tool.content?.reviews) {
      assert.ok(Array.isArray(tool.content.reviews), `expected ${tool.id} reviews array`);
    }
    if (tool.content?.sourceLinks?.length) {
      assert.ok(
        tool.content.sourceLinks.some((link) => link.url === tool.content.productLinks.serplyUrl),
        `expected ${tool.id} source links to include extension install URL`,
      );
      if (tool.content.productLinks.appsUrl) {
        assert.ok(
          tool.content.sourceLinks.some((link) => link.url === tool.content.productLinks.appsUrl),
          `expected ${tool.id} source links to include SERP Apps URL`,
        );
        assert.ok(
          tool.content.sourceLinks.some((link) => link.label === "SERP Apps"),
          `expected ${tool.id} source links to label apps URL as SERP Apps`,
        );
      }
      if (tool.content.productLinks.githubRepoUrl) {
        assert.ok(
          tool.content.sourceLinks.some((link) => link.url === tool.content.productLinks.githubRepoUrl),
          `expected ${tool.id} source links to include GitHub repository URL`,
        );
      }
      assert.equal(
        tool.content.sourceLinks.some((link) => link.label === "LibHunt" || link.url.includes("libhunt.com/")),
        false,
        `expected ${tool.id} source links not to include LibHunt`,
      );
    }
    if (tool.content?.supportedOperatingSystems) {
      assert.ok(
        tool.content.supportedOperatingSystems.length > 0,
        `expected ${tool.id} supported operating systems`,
      );
    }
    if (tool.content?.supportedRegions) {
      assert.ok(
        tool.content.supportedRegions.length > 0,
        `expected ${tool.id} supported regions`,
      );
    }
    assert.ok(tool.content?.keywords?.length > 0, `expected ${tool.id} keywords`);
    assert.ok(tool.content?.infoArticle?.markdown.length > 250, `expected ${tool.id} full body copy`);
    assert.ok(tool.content?.faqs?.length >= 5, `expected ${tool.id} full FAQ list`);
  }
});

test("downloader registry routes stay unique and normalized", () => {
  const activeDownloadTools = tools.filter(
    (tool) => tool.isActive && tool.operation === "download",
  );
  const ids = new Set();
  const routes = new Set();

  for (const tool of activeDownloadTools) {
    assert.equal(ids.has(tool.id), false, `expected unique downloader id for ${tool.id}`);
    assert.equal(routes.has(tool.route), false, `expected unique downloader route for ${tool.route}`);
    assert.doesNotMatch(tool.id, /-video-videos$/, `expected ${tool.id} not to duplicate video suffixes`);
    assert.doesNotMatch(tool.route, /-video-videos$/, `expected ${tool.route} not to duplicate video suffixes`);
    ids.add(tool.id);
    routes.add(tool.route);
  }
});

test("ThisVid downloader includes the full extensions.serp.co outbound link set", () => {
  const tool = tools.find((candidate) => candidate.id === "download-thisvid-videos");
  const sourceUrls = new Set(tool.content.sourceLinks.map((link) => link.url));

  for (const expectedUrl of expectedThisVidOutboundUrls) {
    assert.equal(
      sourceUrls.has(expectedUrl),
      true,
      `expected ThisVid outbound links to include ${expectedUrl}`,
    );
  }
});
