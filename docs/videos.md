# How-to videos and watch pages

How a Tool's how-to video is stored, where it shows, and how Google finds it:
the registry record, the converter page's player, the watch page, the
`/videos/` library, the video sitemap, and the steps for adding a video. It
follows the serp
[watch-pages standard](https://github.com/serpcompany/serp/tree/main/docs/engineering/websites/pages/watch-pages).
Paths are under `apps/tools/` unless they start with `docs/`.

## The record

A Tool's video is one registry field, its `video` in `lib/catalog/tools.json`
(`ToolVideo` in `types/index.d.ts`): the YouTube `id`; YouTube's `title`,
`uploadDate` and `duration` for it; and a `description` written for the watch
page, since YouTube's can be a bare link. Nothing else is stored.
`lib/videos.ts` derives the rest as a `WatchVideo`: the watch page's path and
URL, the player (`https://www.youtube-nocookie.com/embed/<id>`), the
thumbnail, the YouTube page, the length in seconds, and the Tool it shows. The standard names that Tool in its
`productSlug`, `productName` and `productPath` fields; here it is always the
Tool, never a Product in CONTEXT.md's sense.

Two thumbnails come from the id (`lib/youtube.ts`). The `VideoObject` and
the video sitemap name `maxresdefault.jpg`, 1280 x 720 with no black bars,
since Google shows that image in video results as it is. The video cards
show `hqdefault.jpg`, 480 x 360, which every video has and which is a fifth
the size; they crop it to 16:9, so its bars never show. YouTube makes
`maxresdefault.jpg` only for uploads of 720p or more; all five videos have it
(checked 2026-10-22).

`lib/catalog/validate.ts` holds each record to the standard: an 11-character
YouTube id, a plain-text description of at most 2,048 characters, an
`uploadDate` that is an ISO 8601 date-time with its time zone, and an ISO 8601
`duration` such as `PT27S`. No two videos share an id, title or description.
`lib/videos.test.mjs` checks that each description names its Tool and holds no
link.

## Where a video shows

- **The converter page** (`ToolPageTemplate`), right under the converter:
  YouTube's player in the server HTML, lazy but this near the top usually
  loaded with the page (`components/ToolVideoPlayer.tsx`), and links to the
  watch page and to `/videos/`. The page has no `VideoObject`: Google lists a video from
  the page where it is the main content. A page that is cross-origin isolated
  for multi-threaded FFmpeg shows no video (`lib/tool-video.ts`), since
  YouTube's player can't load there. Only Tools on the shared converter page
  (`ToolPageRenderer`) can show one; `lib/videos.test.mjs` fails otherwise.
- **The watch page**, `/watch/<tool id>/<video id>/` (`app/watch/`): built
  ahead for every video, and a 404 for any other pair. It shows the breadcrumb
  trail Home › Videos › Tool › video, the player in the server HTML, the
  title as its H1 and the description under it, the upload date and length,
  the Tool's page as the main link, YouTube as a second one, and up to 6 other
  videos, those sharing a format with the Tool first. Its title is the video's,
  its canonical its own URL, and its JSON-LD a `VideoObject` (`embedUrl`,
  never `contentUrl`) and a `BreadcrumbList` of the trail it shows.
- **`/videos/`** (`app/videos/`): a card per video, newest first, each linking
  to its watch page, with an `ItemList` of them. It is a 404 while no Tool has
  a video.

The pages sitemap lists `/videos/` and every watch page, and
`/sitemap-videos.xml`, last in the index, lists each watch page again with its
video: the player as `<video:player_loc>` (never `<video:content_loc>`, which
is for a media file) and the length in seconds (`lib/sitemap.ts`).

No footer or menu links to `/videos/` yet: a link there would change every
page. What a visitor's browser loads from YouTube, and when, is in
[telemetry.md](telemetry.md#youtube-videos).

## Adding a video

1. Read the facts from the video's YouTube page: its title as written, its
   `uploadDate` (the page's `<meta itemprop="uploadDate">`, which has the time
   zone), and its length in seconds (`videoDetails.lengthSeconds` in the page's
   player data; write 27 as `PT27S`). `<meta itemprop="duration">` rounds the
   length up, so it can be a second longer.
2. Watch the video and write its `description`: one or two plain sentences
   saying what it shows, naming the Tool's page (its H1, such as "SVG to PNG
   Converter"). Claim nothing the video doesn't show.
3. Check the video has a 1280 x 720 thumbnail: `curl -sI
   https://i.ytimg.com/vi/<id>/maxresdefault.jpg` answers 200 with a
   `content-length` over 10 KB (a 404 or a 120 x 90 placeholder means
   none). If it has none, upload it again at 720p or more first.
4. Add them as the Tool's `video` in `tools.json`, before its `content`. The
   Tool must be active and on the shared converter page.
5. Run `node --test apps/tools/lib/catalog/validate.test.mjs
   apps/tools/lib/videos.test.mjs apps/tools/lib/sitemap.test.mjs
   apps/tools/lib/metadata.test.mjs`. The watch page's meta description is
   generated from the title and length, and must be 110 to 160 characters.
6. On a preview build, open the converter page, the watch page, `/videos/` and
   `/sitemap-videos.xml`. After the deploy, run the watch page through Google's
   [Rich Results Test](https://search.google.com/test/rich-results), and watch
   Search Console's Video indexing report after the next crawl.
