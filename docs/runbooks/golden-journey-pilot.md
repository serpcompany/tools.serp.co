# Golden Journey pilot

Use this pilot to decide whether the Tool architecture is worth expanding. It
is a fixed sample of ten user journeys, not a claim about all 2,807 Tools.

## Human starting point

Open the authenticated DEV/STAGING view:

<https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev/internal/tools/?pilot=golden>

The table shows the observed result, where the journey runs, what was checked,
whether the evidence is current, the remaining gap, and a direct **Try it**
link. Its membership is fixed at:

`sha256:cf077705f900e695b0310fbd090dbd366fa3c01219f93b2076f849b3396ba6ba`

Judge three things:

1. Does the Tool behave as the Golden table says it behaves?
2. Is the checked behavior meaningful enough to trust the result?
3. Did adding the neighboring `mp4-to-webm` Tool reuse the existing processor
   and verification path, or did it require another one-off architecture?

Then record one decision on #124: **continue**, **repair**, or **reconsider**.

## Regenerate the package

From a clean checkout at the exact deployed revision, with the temporary
Cloudflare Access cookie in `TOOL_FACTORY_CF_AUTHORIZATION`:

```sh
mise exec node@22.23.1 -- pnpm proof:golden-pilot -- \
  --environment preview \
  --base-url https://tools-serp-co-wayfinder-preview.serpcompany.workers.dev \
  --revision <full-deployed-commit-sha>
```

The command runs the fixed journeys, the one-Tool WebM expansion, the Tool
Factory browser flow, and the stale/current proof. It creates one ignored
`.artifacts/runs/<run-id>/report.html` with screenshots and sample outputs.
It performs no deployment, production query, GitHub mutation, or evidence
promotion.

Browser evidence must be reviewed before it is promoted:

```sh
pnpm evidence:promote:tool-journeys -- --run <browser-run-id>
```

Promotion copies validated structured facts into the retained evidence source.
The Tool Factory derives its display from that source; nobody types a status
into the dashboard. Commit, deploy, and rerun the exact preview after promotion
so the displayed evidence and deployed behavior name the same revision.

## What the stale/current proof means

The proof starts with a valid PNG-to-WebP record, changes the exact fixture
content revision, and observes `verified → stale`. Restoring and rerunning the
same input returns it to `verified`. Separate warning, skipped, missing-check,
and semantic-failure records remain non-verified.

## Same-family expansion estimate

`mp4-to-webm` is the bounded scaling rehearsal. It reuses the browser FFmpeg
engine, public workflow lifecycle, real MP4 fixture, WebM parser, output
delivery, cancellation, and telemetry policy. The generated report records the
elapsed implementation/verification window and the repeated steps future
family estimates should count.
