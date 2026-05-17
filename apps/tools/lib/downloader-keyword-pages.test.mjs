import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tools = JSON.parse(
  readFileSync(
    new URL("../../../packages/app-core/src/data/tools.json", import.meta.url),
    "utf8",
  ),
);
const plannerSource = readFileSync(
  new URL("../../../docs/planner/tools_planner.csv", import.meta.url),
  "utf8",
);

const requestedDownloaders = [
  { keyword: "Skool", id: "download-skool-videos" },
  { keyword: "Vimeo", id: "download-vimeo-videos" },
  { keyword: "Onlyfans", id: "download-onlyfans-videos" },
  { keyword: "Whop", id: "download-whop-videos" },
  { keyword: "123movies", id: "download-123movies-videos" },
  { keyword: "Circle", id: "download-circle-videos" },
  { keyword: "Clientclub", id: "download-clientclub-videos" },
  { keyword: "Dailymotion", id: "download-dailymotion-videos" },
  { keyword: "Gohighlevel", id: "download-gohighlevel-videos" },
  { keyword: "Gokollab", id: "download-gokollab-videos" },
  { keyword: "Alpha Porno", id: "download-alpha-porno-videos" },
  { keyword: "Ashemaletube", id: "download-ashemaletube-videos" },
  { keyword: "Beeg", id: "download-beeg-videos" },
  { keyword: "Boyfriendtv", id: "download-boyfriendtv-videos" },
  { keyword: "Coomer", id: "download-coomer-videos" },
  { keyword: "Eporner", id: "download-eporner-videos" },
  { keyword: "Erome", id: "download-erome-videos" },
  { keyword: "Kajab", id: "download-kajab-videos" },
  { keyword: "Erothots", id: "download-erothots-videos" },
  { keyword: "Hdzog", id: "download-hdzog-videos" },
  { keyword: "Hentaihaven", id: "download-hentaihaven-videos" },
  { keyword: "Justforfans", id: "download-justforfans-videos" },
  { keyword: "Luxuretv", id: "download-luxuretv-videos" },
  { keyword: "Manyvids", id: "download-manyvids-videos" },
  { keyword: "Motherless", id: "download-motherless-videos" },
  { keyword: "Nhentai", id: "download-nhentai-videos" },
  { keyword: "Pornhub", id: "download-pornhub-videos" },
  { keyword: "M3u8", id: "download-m3u8-videos" },
  { keyword: "Porntrex", id: "download-porntrex-videos" },
  { keyword: "Redgifs", id: "download-redgifs-videos" },
  { keyword: "Redtube", id: "download-redtube-videos" },
  { keyword: "SpankBang", id: "download-spankbang-videos" },
  { keyword: "Stripcha", id: "download-stripcha-videos" },
  { keyword: "Thisvid", id: "download-thisvid-videos" },
  { keyword: "TNAFlix", id: "download-tnaflix-videos" },
  { keyword: "Tokyomotion", id: "download-tokyomotion-videos" },
  { keyword: "Txxx", id: "download-txxx-videos" },
  { keyword: "Upornia", id: "download-upornia-videos" },
  { keyword: "Xfantazy", id: "download-xfantazy-videos" },
  { keyword: "Xhamster", id: "download-xhamster-videos" },
  { keyword: "Xnxx", id: "download-xnxx-videos" },
  { keyword: "Xvideos", id: "download-xvideos-videos" },
  { keyword: "Yespornplease", id: "download-yespornplease-videos" },
  { keyword: "Youjizz", id: "download-youjizz-videos" },
  { keyword: "Youporn", id: "download-youporn-videos" },
  { keyword: "Sprout", id: "download-sprout-videos" },
  { keyword: "Tiktok", id: "download-tiktok-videos" },
  { keyword: "Wistia", id: "download-wistia-videos" },
  { keyword: "Youtube", id: "download-youtube-videos" },
  { keyword: "Bongacams", id: "download-bongacams-videos" },
  { keyword: "Cam4", id: "download-cam4-videos" },
  { keyword: "Cams.com", id: "download-cams-com-videos" },
  { keyword: "Camsoda", id: "download-camsoda-videos" },
  { keyword: "Chaturbate", id: "download-chaturbate-videos" },
  { keyword: "Dreamcam", id: "download-dreamcam-videos" },
  { keyword: "Dreamcam VR", id: "download-dreamcam-vr-videos" },
  { keyword: "Facebook", id: "download-facebook-videos" },
  { keyword: "Fansly Live", id: "download-fansly-live-videos" },
  { keyword: "Flirt4free", id: "download-flirt4free-videos" },
  { keyword: "Instagram", id: "download-instagram-videos" },
  { keyword: "Kajabi", id: "download-kajabi-videos" },
  { keyword: "Linkedin", id: "download-linkedin-videos" },
  { keyword: "Mindvalley", id: "download-mindvalley-videos" },
  { keyword: "Myfreecams", id: "download-myfreecams-videos" },
  { keyword: "Pinterest", id: "download-pinterest-videos" },
  { keyword: "Reddit", id: "download-reddit-videos" },
  { keyword: "Sexchathu", id: "download-sexchathu-videos" },
  { keyword: "Streamate", id: "download-streamate-videos" },
  { keyword: "Stripchat", id: "download-stripchat-videos" },
  { keyword: "Stripchat VR", id: "download-stripchat-vr-videos" },
  { keyword: "Tellatv", id: "download-tellatv-videos" },
  { keyword: "Thinkific", id: "download-thinkific-videos" },
  { keyword: "Twitch", id: "download-twitch-videos" },
  { keyword: "Twitter/X", id: "download-twitter-x-videos" },
  { keyword: "Xhamsterlive", id: "download-xhamsterlive-videos" },
  { keyword: "Xlovecam", id: "download-xlovecam-videos" },
  { keyword: "Ashemaletube Bulk", id: "download-ashemaletube-bulk-videos" },
];

const expectedSerplyUrls = {
  "download-123movies-videos": "https://serp.ly/123movies-downloader",
  "download-alpha-porno-videos": "https://serp.ly/alpha-porno-downloader",
  "download-ashemaletube-bulk-videos": "https://serp.ly/ashemaletube-downloader",
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
  "download-kajab-videos": "https://serp.ly/kajabi-video-downloader",
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
  "download-stripcha-videos": "https://serp.ly/stripchat-video-downloader",
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

test("requested downloader keyword landers exist in the registry and planner", () => {
  const activeDownloadTools = tools.filter(
    (tool) => tool.isActive && tool.operation === "download",
  );

  assert.equal(activeDownloadTools.length, 79);

  for (const entry of requestedDownloaders) {
    const tool = tools.find((candidate) => candidate.id === entry.id);
    const plannerKeyword = entry.keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    assert.ok(tool, `expected ${entry.id} to exist in tools.json`);
    assert.equal(tool.operation, "download", `expected ${entry.id} to be a download tool`);
    assert.equal(tool.isActive, true, `expected ${entry.id} to be active`);
    assert.equal(tool.route, `/${entry.id}`, `expected ${entry.id} route to match slug`);
    assert.match(tool.name, /Downloader/, `expected ${entry.id} to use downloader naming`);
    assert.match(
      plannerSource,
      new RegExp(`^${plannerKeyword} video downloader,download,${entry.id},`, "mi"),
      `expected planner row for ${entry.id}`,
    );
  }
});

test("source-specific downloader landers include enriched content", () => {
  const sourceSpecificDownloaders = tools.filter(
    (tool) => tool.isActive && tool.operation === "download" && tool.id !== "video-downloader",
  );

  assert.equal(sourceSpecificDownloaders.length, 78);

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
    assert.equal(
      tool.content?.productLinks?.serplyUrl,
      expectedSerplyUrls[tool.id],
      `expected ${tool.id} to use its own serp.ly CTA`,
    );
    assert.ok(
      tool.content?.productLinks?.appsUrl?.startsWith("https://apps.serp.co/"),
      `expected ${tool.id} apps.serp.co URL`,
    );
    assert.notEqual(
      tool.content?.productLinks?.serplyUrl,
      "https://serp.ly/serp-video-tools",
      `expected ${tool.id} not to use the generic CTA`,
    );
    assert.ok(tool.content?.features?.length > 0, `expected ${tool.id} feature list`);
    assert.ok(tool.content?.screenshots?.length > 0, `expected ${tool.id} screenshots`);
    assert.ok(tool.content?.reviews?.length > 0, `expected ${tool.id} reviews`);
    assert.ok(tool.content?.sourceLinks?.length > 0, `expected ${tool.id} source links`);
    assert.ok(
      tool.content.sourceLinks.length >= 4,
      `expected ${tool.id} source links to include extensions.serp.co outbound links`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.url.startsWith("https://extensions.serp.co/extensions/serp/")),
      `expected ${tool.id} source links to include the extensions.serp.co detail page`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.label === "SERP Extensions"),
      `expected ${tool.id} source links to label extensions URL as SERP Extensions`,
    );
    assert.equal(
      tool.content.sourceLinks.some((link) => link.label === "SERP Extensions page"),
      false,
      `expected ${tool.id} source links not to label extensions URL as SERP Extensions page`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.url === tool.content.productLinks.serplyUrl),
      `expected ${tool.id} source links to include extension install URL`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.url === tool.content.productLinks.appsUrl),
      `expected ${tool.id} source links to include SERP Apps URL`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.label === "SERP Apps"),
      `expected ${tool.id} source links to label apps URL as SERP Apps`,
    );
    assert.equal(
      tool.content.sourceLinks.some((link) => link.label === "LibHunt" || link.url.includes("libhunt.com/")),
      false,
      `expected ${tool.id} source links not to include LibHunt`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.label === "SERP" && link.url.startsWith("https://serp.co/products/")),
      `expected ${tool.id} source links to include SERP product page`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.label === "SERP AI" && link.url.startsWith("https://serp.ai/products/")),
      `expected ${tool.id} source links to include SERP AI product page`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.label === "Browser Extensions" && link.url.startsWith("https://browserextensions.io/products/")),
      `expected ${tool.id} source links to include Browser Extensions product page`,
    );
    assert.ok(
      tool.content.sourceLinks.some((link) => link.url === tool.content.productLinks.githubRepoUrl),
      `expected ${tool.id} source links to include GitHub repository URL`,
    );
    assert.ok(
      tool.content?.supportedOperatingSystems?.length > 0,
      `expected ${tool.id} supported operating systems`,
    );
    assert.ok(
      tool.content?.supportedRegions?.length > 0,
      `expected ${tool.id} supported regions`,
    );
    assert.ok(tool.content?.keywords?.length > 0, `expected ${tool.id} keywords`);
    assert.ok(tool.content?.infoArticle?.markdown.length > 250, `expected ${tool.id} full body copy`);
    assert.ok(tool.content?.faqs?.length >= 5, `expected ${tool.id} full FAQ list`);
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
