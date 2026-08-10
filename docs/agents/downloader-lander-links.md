# Downloader lander outbound-link policy

Do not add guessed outbound links to downloader landers.

Before adding or changing any URL in the Tool registry under
`content.productLinks` or `content.sourceLinks`:

1. Verify the exact URL with HTTP.
2. Do not invent GitHub repository, app, support, source, or product URLs from a
   slug.
3. If a URL returns `404` or `410`, remove it or leave the field blank.
4. If the source site blocks HEAD or GET with an anti-bot status but does not
   return `404` or `410`, document it as reachable-but-blocked only when
   necessary; do not replace it with an unverified alternate URL.
5. Never add Official Links that point users back to the source platform itself,
   such as a Tube8 lander linking to Tube8. Those links do not help SERP and
   should be omitted.
6. Prefer the verified `serp.ly` product or extension URL over guessed
   `apps.serp.co` or `github.com/serpapps/...` URLs.

Run these commands before reporting any downloader lander or content change:

```bash
pnpm lint:links
node scripts/validate-tools.mjs
pnpm -C apps/tools typecheck
```

For a single page while editing:

```bash
node scripts/validate-lander-outbound-links.mjs --tool-id=<tool-id>
```

The outbound-link check is intentionally wired into repository lint hooks so
fake lander links fail locally instead of shipping.
