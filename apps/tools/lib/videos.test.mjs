import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { handlerFor, scanPageHandlers } from "../scripts/lib/tool-sweep.mjs";
import { allTools, getTool } from "./catalog/catalog.ts";
import {
  VIDEOS_PATH,
  buildVideosMetadata,
  buildWatchMetadata,
  findWatchVideo,
  relatedWatchVideos,
  toWatchVideo,
  watchBreadcrumbs,
  watchDescription,
  watchPageParams,
  watchPath,
  watchVideos,
} from "./videos.ts";

const ORIGIN = "https://tools.serp.co";

const handlers = scanPageHandlers(fileURLToPath(new URL("../app", import.meta.url)));

test("a Tool's video is one registry record; everything else about it is derived", () => {
  assert.deepEqual(findWatchVideo("webp-to-png", "FJkyr2TEUs0", ORIGIN), {
    id: "FJkyr2TEUs0",
    slug: "FJkyr2TEUs0",
    title: "How to Convert WebP to PNG (Free Method)",
    description:
      "A WebP photo is dragged onto the WebP to PNG Converter and converted to PNG in the browser. The PNG downloads automatically and opens as the same picture.",
    sourceUrl: "https://www.youtube.com/watch?v=FJkyr2TEUs0",
    watchPath: "/watch/webp-to-png/FJkyr2TEUs0/",
    watchUrl: "https://tools.serp.co/watch/webp-to-png/FJkyr2TEUs0/",
    embedUrl: "https://www.youtube-nocookie.com/embed/FJkyr2TEUs0",
    thumbnailUrl: "https://i.ytimg.com/vi/FJkyr2TEUs0/hqdefault.jpg",
    platform: "youtube",
    uploadDate: "2026-10-22T00:15:20-07:00",
    duration: "PT27S",
    durationSeconds: 27,
    productSlug: "webp-to-png",
    productName: "WebP to PNG Converter",
    productPath: "/webp-to-png/",
  });
  // URLs are on the origin they're given, as the JSON-LD's are.
  assert.equal(
    findWatchVideo("webp-to-png", "FJkyr2TEUs0", "http://localhost:3000").watchUrl,
    "http://localhost:3000/watch/webp-to-png/FJkyr2TEUs0/",
  );
});

test("every video is an active Tool's, on a converter page that shows it, and the library lists each once", () => {
  const withVideo = allTools().filter((tool) => tool.video);
  assert.ok(withVideo.length > 0);
  const library = watchVideos(ORIGIN);
  assert.deepEqual(
    library.map((video) => video.productSlug).sort(),
    withVideo.filter((tool) => tool.isActive).map((tool) => tool.id).sort(),
  );
  for (const tool of withVideo) {
    assert.ok(tool.isActive, `${tool.id} has a video but no page`);
    // Only the generic converter page (ToolPageTemplate) renders the video.
    assert.equal(handlerFor(tool, handlers), "ToolPageRenderer", `${tool.id} wouldn't show its video`);
  }
  assert.equal(new Set(library.map((video) => video.watchPath)).size, library.length);
  assert.equal(new Set(library.map((video) => video.title)).size, library.length);
});

test("the library is newest first", () => {
  const library = watchVideos(ORIGIN);
  for (let index = 1; index < library.length; index += 1) {
    assert.ok(Date.parse(library[index - 1].uploadDate) >= Date.parse(library[index].uploadDate));
  }
  assert.deepEqual(
    library.map((video) => video.productSlug),
    ["avif-to-jpg", "heic-to-jpg", "jpg-to-webp", "svg-to-png", "webp-to-png"],
  );
});

test("each video has its own written description, naming the Tool it shows, not a link", () => {
  for (const video of watchVideos(ORIGIN)) {
    assert.doesNotMatch(video.description, /https?:\/\/|www\./, video.productSlug);
    assert.match(video.description, /[.!?]$/, `${video.productSlug} ends as a sentence`);
    assert.ok(video.description.includes(video.productName), `${video.productSlug} names ${video.productName}`);
  }
});

test("a watch URL is served only for an active Tool and its own video", () => {
  const [video] = watchVideos(ORIGIN);
  assert.ok(findWatchVideo(video.productSlug, video.id, ORIGIN));
  assert.equal(findWatchVideo(video.productSlug, "aaaaaaaaaaa", ORIGIN), undefined);
  assert.equal(findWatchVideo(video.productSlug, video.id.toLowerCase(), ORIGIN), undefined);
  assert.equal(findWatchVideo("png-to-jpg", video.id, ORIGIN), undefined, "a Tool without a video");
  assert.equal(findWatchVideo("not-a-tool", video.id, ORIGIN), undefined);
  const inactive = allTools().find((tool) => !tool.isActive);
  assert.equal(findWatchVideo(inactive.id, video.id, ORIGIN), undefined);

  const byTool = (a, b) => a.tool.localeCompare(b.tool);
  assert.deepEqual(
    watchPageParams().sort(byTool),
    watchVideos(ORIGIN)
      .map((each) => ({ tool: each.productSlug, video: each.id }))
      .sort(byTool),
  );
  assert.equal(watchPath("webp-to-png", "FJkyr2TEUs0"), "/watch/webp-to-png/FJkyr2TEUs0/");
});

test("no Tool's route is under /videos/ or /watch/", () => {
  for (const tool of allTools()) {
    if (!tool.route) continue;
    assert.doesNotMatch(tool.route, /^\/?(?:videos|watch)(?:\/|$)/, tool.id);
  }
});

// A video for a real Tool, as the library would hold it if that Tool had
// one.
const fakeVideo = (toolId, uploadDate) => {
  const tool = getTool(toolId);
  assert.ok(tool, toolId);
  const video = { id: `${toolId}-v`, title: toolId, description: toolId, uploadDate, duration: "PT1M" };
  return toWatchVideo({ ...tool, video }, ORIGIN);
};

test("a watch page's other videos: those sharing a format with its Tool first, then the rest", () => {
  const library = [
    fakeVideo("mp4-to-mp3", "2026-10-26T00:00:00Z"),
    fakeVideo("png-to-jpg", "2026-10-25T00:00:00Z"),
    fakeVideo("compress-mp4", "2026-10-24T00:00:00Z"),
    fakeVideo("webp-to-jpg", "2026-10-23T00:00:00Z"),
    fakeVideo("webp-to-png", "2026-10-22T00:00:00Z"),
  ];
  const current = library[4];
  const order = (videos) => videos.map((video) => video.productSlug);

  assert.deepEqual(order(relatedWatchVideos(current, library)), [
    "png-to-jpg",
    "webp-to-jpg",
    "mp4-to-mp3",
    "compress-mp4",
  ]);
  assert.deepEqual(order(relatedWatchVideos(current, library, 2)), ["png-to-jpg", "webp-to-jpg"]);
  assert.deepEqual(relatedWatchVideos(current, [current]), [], "a lone video has none");
});

test("each watch page links to the other videos, WebP to PNG first to those sharing WebP or PNG", () => {
  const library = watchVideos(ORIGIN);
  for (const video of library) {
    const related = relatedWatchVideos(video, library);
    assert.equal(related.length, library.length - 1, video.productSlug);
    assert.ok(related.every((other) => other.watchPath !== video.watchPath));
  }
  const webpToPng = findWatchVideo("webp-to-png", "FJkyr2TEUs0", ORIGIN);
  assert.deepEqual(
    relatedWatchVideos(webpToPng, library).map((video) => video.productSlug),
    ["jpg-to-webp", "svg-to-png", "avif-to-jpg", "heic-to-jpg"],
  );
});

test("the breadcrumb trail is Home, Videos, the Tool, then the video", () => {
  const video = findWatchVideo("webp-to-png", "FJkyr2TEUs0", ORIGIN);
  assert.deepEqual(watchBreadcrumbs(video), [
    { name: "Home", path: "/" },
    { name: "Videos", path: VIDEOS_PATH },
    { name: "WebP to PNG Converter", path: "/webp-to-png/" },
    { name: "How to Convert WebP to PNG (Free Method)", path: "/watch/webp-to-png/FJkyr2TEUs0/" },
  ]);
});

test("a watch page is titled as its video and canonical at its watch URL", () => {
  for (const video of watchVideos(ORIGIN)) {
    const metadata = buildWatchMetadata(video);
    assert.equal(metadata.title, video.title);
    assert.equal(metadata.alternates.canonical, video.watchPath);
    assert.equal(metadata.openGraph.url, video.watchPath);
    assert.equal(metadata.openGraph.type, "video.other");
    assert.deepEqual(metadata.openGraph.videos, [{ url: video.embedUrl, type: "text/html" }]);
    assert.equal(metadata.description, watchDescription(video));
    assert.ok(metadata.description.includes(video.title), "the description names the video");
    assert.ok(metadata.description.includes(video.productName), "and the Tool it shows");
  }
  assert.equal(
    watchDescription(findWatchVideo("webp-to-png", "FJkyr2TEUs0", ORIGIN)),
    "Watch How to Convert WebP to PNG (Free Method): a 27-second video showing how to use the WebP to PNG Converter on SERP Tools.",
  );
});

test("the library page is canonical at /videos/", () => {
  const metadata = buildVideosMetadata();
  assert.equal(metadata.title, "How-to Videos");
  assert.equal(metadata.alternates.canonical, "/videos/");
});
