# Ads

Where ads go on Tool pages, when they show, and which builds load them.
[apps/tools/README.md](../apps/tools/README.md) maps the app's other topics.

Ad placement is centralized in `apps/tools/components/ToolAds.tsx`; the script
is mounted by the shared app layout. Tool and downloader ads remain hidden
until the user initiates the relevant action. Rail ads are hidden below the
`xl` breakpoint.

## When the scripts load

The AdSense and Google Tag Manager scripts load once the page is interactive:
at the visitor's first tap, key press or scroll, or 5 seconds after the load
event if none comes first (`packages/app-core/src/lib/third-party-scripts.ts`).
Loaded with the page, they took a phone's bandwidth from the page's own files
and ran long tasks while it hydrated (#316). An ad slot loads AdSense as it
mounts, so an ad never waits for that: slots show only after the visitor acts.
Auto ads and a consent message, when the AdSense account turns them on, come
from the same script, so they start at that point too.

The layout passes each script's URL to the browser as a prop rather than
through `next/script`, whose default strategy preloads the script with the
page. The URLs and the GTM container ID are still in each production page's
HTML, which the deploy smoke check reads.

## Layout shifts

Every slot's box has a fixed height, so the ad filling it, which comes later
from Google, moves nothing. The slots themselves, and the result panel with its
336 by 280 slot, show at the visitor's action: choosing a file or submitting a
link. Chrome's layout-shift score leaves out what moves within half a second of
input, and it counts a file picked in the chooser as input. The result panel
shows from that moment, with the progress bar (`ToolHeroLayout.tsx`); when it
showed only once the Tool finished, it moved a phone's page by 0.11 (#316).

Nothing is held empty before the visitor acts: the rail columns from the `xl`
breakpoint take their space only then, so a Tool has its full width before
(chosen in May 2026), and the same goes for the inline slot.

## Builds

Ads load only in a production build (`NEXT_PUBLIC_SITE_ENV=production`, set by
`cf:build:production`); `NEXT_PUBLIC_ADSENSE_TEST_MODE=true` enables test ads
in any other build. Other `NEXT_PUBLIC_ADSENSE_*` variables configure client and
slot overrides.
