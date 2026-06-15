# Downloader Lander Content Upgrade Retrospective

## Executive Summary

The downloader landing-page project upgraded shallow source-specific downloader landers into richer, app-grade pages that can explain the product, route users to the right extension, and give search engines a fuller page to evaluate.

The final shipped state kept the generic `/video-downloader` page separate from the source-specific pages. There are 79 active download tools total: one generic downloader and 78 active source-specific downloader pages. The work shipped in PR #9 and was merged as `62480f6`.

The main outcome was a repeatable content-enrichment pattern for downloader-listing sites: collect product truth from live SERP app and extension pages, normalize it into registry content, keep route counts stable, make every CTA product-specific, and verify the template does not leak generic or raw backend behavior.

## Problem We Found

The original downloader landers were mostly keyword pages. They had enough structure to route users into the shared downloader flow, but they did not consistently explain what each product was, why a browser extension was the better path, or where users could find official supporting links.

The largest gaps were:

- CTAs were not consistently source-specific. Source pages could still point to the generic `serp.ly/serp-video-tools` destination instead of the relevant product URL.
- Page content was thin. Many landers were missing app-grade body copy, screenshots, reviews, feature detail, full FAQs, platform support, region support, permission explanations, and keywords.
- Unsupported or downloader-only sources could expose backend-flavored failure states instead of a conversion-focused message that points users to the matching extension.
- Outbound links were incomplete or noisy. Some links used generic labels, stale assumptions, or visible naked URLs instead of clean anchor labels.
- The template had repeated CTA/ad surfaces and hidden ad rail whitespace that made some pages feel unfinished when ads were gated.

## Source Of Truth And Data Collection

The primary source of truth was the live `apps.serp.co` product lander for each downloader. Those pages supplied app metadata, product copy, features, FAQs, screenshots, reviews, operating-system support, region support, permission justifications, keywords, and app links.

Secondary link data came from live `extensions.serp.co` extension detail pages. Additional sitemap-derived outbound links came from `serp.co`, `serp.ai`, and `browserextensions.io`. Brand data came from `~/dev/repos/serp/docs/websites/pages/brands.json`.

The key operating rule was that live source pages override stale local assumptions. When a slug, app name, link, or body-content detail differed between a local guess and the live product page, the live product page won.

This rule mattered most for canonical slug exceptions. For example, the CAM4 downloader uses a `cam4-video-downloader` apps/product slug while the extension ecosystem can still refer to `cam4-downloader`. The implementation had to preserve the correct app/product slug instead of deriving every URL mechanically from the tools route.

## Content Model Added

The registry content for source-specific downloaders was expanded beyond the basic tool title/subtitle model. Each enriched downloader page can now carry:

- Product links, including product-specific `serp.ly` CTA URLs, SERP Apps URLs, and GitHub repository URLs.
- Screenshots and reviews from the product landers.
- Feature lists, full body copy, and complete FAQs.
- `sourceLinks` for official outbound references.
- Supported operating systems and supported regions.
- Permission justifications for extension behavior.
- Keywords and richer metadata used by the page renderer.

The downloader renderer was updated to use these fields instead of treating every downloader page as a near-identical keyword shell. Source-specific pages now render screenshots, features, reviews, official links, platform support, permission notes, and complete FAQs when the data is present.

## CTA And Failure-Message Rules

The generic `/video-downloader` page remains the broad multi-source downloader page. Source-specific downloader pages use their own product-specific extension URLs.

The CTA rule is:

- Source-specific pages must pass the product-specific `serp.ly/...` URL through to the top CTA banner, downloader modal, and failure CTA.
- Source-specific pages must not use `https://serp.ly/serp-video-tools`.
- The generic downloader can continue to use the generic downloader extension URL.

Unsupported and downloader-only failure states were changed to be conversion-focused. Instead of showing raw backend errors for sources the web form cannot reliably handle, the page should explain that the site cannot be downloaded reliably from the web form and route the user to the relevant browser extension.

The template cleanup also removed duplicate CTA banners and prevented hidden ad rails from reserving large whitespace when ads are not visible.

## Outbound Link Rules

Every active source-specific downloader should include at least these official links when the underlying data exists:

- Install extension
- SERP Apps
- GitHub repository
- SERP Extensions
- SERP
- SERP AI
- Browser Extensions

Optional links such as Apify, ExtensionHub, and SERP Downloaders should be included only when found in source data. They should not be invented from a pattern alone.

Labeling rules:

- Use `SERP Apps`, not `Apps lander` or `Apps page`.
- Use `SERP Extensions`, not `SERP Extensions page`.
- Exclude `LibHunt`.
- Render visible anchor labels only. Do not show raw URLs in the cards.
- Keep link labels clean and user-readable even when the href contains a long product URL.

## Route And Slug Rules

The project intentionally kept the active source-specific downloader count stable. Do not add bulk-only routes unless they are already active, and do not expand the active downloader set unless the project explicitly calls for new active pages.

Legacy typo routes were preserved as redirects:

- `download-stripcha-videos` redirects to `download-stripchat-videos`.
- `download-kajab-videos` redirects to `download-kajabi-videos`.

Those typo routes still exist in the data/planner history, but the runtime route resolves users to the canonical page. This preserves old indexed or linked URLs without treating the typo as the long-term canonical landing page.

## QA, Tests, And Deployment

The verification approach covered both registry data and shared template behavior.

Registry assertions confirmed:

- There are 79 active download tools total.
- There are 78 active source-specific downloader pages.
- Every source-specific page has a product-specific `serp.ly` CTA and does not use `serp.ly/serp-video-tools`.
- Every source-specific page has an apps URL, extension URL, GitHub URL, rich content, full FAQs, and outbound links.

Template assertions confirmed:

- The source-specific CTA URL is passed through to the banner, modal, and failure CTA.
- The Official Links section renders anchor labels only.
- The duplicate CTA banner is not present.
- Hidden ad rails do not reserve 600px of whitespace when ads are hidden.
- Legacy typo routes redirect to their canonical downloader routes.

Deployment evidence from the shipped project:

- Production was deployed to `https://tools.serp.co`.
- Live checks passed for `/brands/`, `/download-thisvid-videos/`, and the legacy typo redirect `/download-stripcha-videos/`.
- Google Search Console sitemap resubmission was completed for the sitemap index and child sitemap indexes.

## Repeatable Checklist For Other Sites

1. Inventory the active downloader routes and split generic downloader pages from source-specific downloader pages.
2. Freeze the active source-specific route count unless the project explicitly includes new active pages.
3. For each source-specific page, collect live app data from the matching SERP Apps product lander.
4. Pull extension detail links from SERP Extensions and sitemap-derived links from SERP, SERP AI, and Browser Extensions.
5. Cross-check brand and slug data against `brands.json`, but let live source pages override stale local assumptions.
6. Add or update product links, screenshots, reviews, features, FAQs, body copy, supported OS/regions, permissions, keywords, and official links in the registry content.
7. Verify every source-specific page uses its own `serp.ly/...` CTA across banner, modal, and failure states.
8. Keep the generic downloader CTA scoped to the generic downloader page only.
9. Apply outbound-link label rules: `SERP Apps`, `SERP Extensions`, no `LibHunt`, and no naked visible URLs.
10. Preserve legacy typo or old indexed routes as redirects when they already exist.
11. Run registry tests for counts, required rich fields, CTA URLs, and outbound links.
12. Run template tests for CTA propagation, failure messaging, Official Links rendering, duplicate CTA removal, ad spacing, and redirects.
13. Deploy, smoke-check representative live pages and redirects, then resubmit the sitemap index and child sitemap indexes in GSC.

## Known Gotchas

Do not derive every URL from the downloader route slug. Some products have canonical app or extension slug exceptions, and live SERP Apps pages are the source of truth for those cases.

Do not assume bulk variants should become active routes. Bulk-only pages should be added only when they are already active or explicitly in scope.

Do not mix the generic downloader into source-specific QA counts. The expected shipped state is 79 active download tools total and 78 active source-specific downloader pages.

Do not regress the CTA destination by falling back to `serp.ly/serp-video-tools` on source pages. The failure CTA is part of this rule, not just the top banner.

Do not use raw URLs as visible link text in official-link cards. The card label should explain the destination, while the href carries the actual URL.
