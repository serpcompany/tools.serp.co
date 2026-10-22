# How-to videos and watch pages

How a Tool's how-to video is stored, where it shows, and how Google finds it:
the registry record, the converter page's player, the watch page, the
`/videos/` library, the video sitemap, and the steps for adding a video. It
follows the serp
[watch-pages standard](https://github.com/serpcompany/serp/tree/main/docs/engineering/websites/pages/watch-pages).
Paths are under `apps/tools/` unless they start with `docs/`.

## The record

A Tool's video is one registry field, its `video` in `lib/catalog/tools.json`
(`ToolVideo` in `types/index.d.ts`): the YouTube `id`, and YouTube's `title`,
`description`, `uploadDate` and `duration` for it. Nothing else is stored.
`lib/videos.ts` derives the rest as a `WatchVideo`: the watch page's path and
URL, the player (`https://www.youtube-nocookie.com/embed/<id>`), the
thumbnail (YouTube's `hqdefault.jpg`, 480 x 360), the YouTube page, the length
in seconds, and the Tool it shows. The standard names that Tool in its
`productSlug`, `productName` and `productPath` fields; here it is always the
Tool, never a Product in CONTEXT.md's sense.

`lib/catalog/validate.ts` holds each record to the standard: an 11-character
YouTube id, a plain-text description of at most 2,048 characters, an
`uploadDate` that is an ISO 8601 date-time with its time zone, and an ISO 8601
`duration` such as `PT28S`. No two videos share an id, title or description.

## Where a video shows

- **The converter page** (`ToolPageTemplate`), under the How-to section: the
  video's thumbnail and a play button, then YouTube's player once a visitor
  clicks it (`components/ToolVideoPlayer.tsx`), and links to the watch page
  and to `/videos/`. The page has no `VideoObject`: Google lists a video from
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

1. Read the facts from the video's YouTube page: its title and description as
   written, its `uploadDate` (the page's `<meta itemprop="uploadDate">`, which
   has the time zone), and its `duration` (`<meta itemprop="duration">`, such
   as `PT0M28S`; write it as `PT28S`). The YouTube Data API's `videos.list`
   gives the same facts. A description that is only a link reads thinly on the
   watch page; improve it on YouTube first, then copy it.
2. Add them as the Tool's `video` in `tools.json`, before its `content`. The
   Tool must be active and on the shared converter page.
3. Run `node --test apps/tools/lib/catalog/validate.test.mjs
   apps/tools/lib/videos.test.mjs apps/tools/lib/sitemap.test.mjs
   apps/tools/lib/metadata.test.mjs`. The watch page's description is
   generated from the title and length, and must be 110 to 160 characters.
4. On a preview build, open the converter page, the watch page, `/videos/` and
   `/sitemap-videos.xml`. After the deploy, run the watch page through Google's
   [Rich Results Test](https://search.google.com/test/rich-results), and watch
   Search Console's Video indexing report after the next crawl.
