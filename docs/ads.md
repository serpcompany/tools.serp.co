# Ads

Where ads go on Tool pages, when they show, and which builds load them.
[apps/tools/README.md](../apps/tools/README.md) maps the app's other topics.

Ad placement is centralized in `apps/tools/components/ToolAds.tsx`; the script
is mounted by the shared app layout. Tool and downloader ads remain hidden
until the user initiates the relevant action. Rail ads are hidden below the
`xl` breakpoint.

Ads load only in a production build (`NEXT_PUBLIC_SITE_ENV=production`, set by
`cf:build:production`); `NEXT_PUBLIC_ADSENSE_TEST_MODE=true` enables test ads
in any other build. Other `NEXT_PUBLIC_ADSENSE_*` variables configure client and
slot overrides.
