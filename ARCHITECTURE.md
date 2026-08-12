# Repository architecture

This map describes stable ownership and dependency boundaries on the current
default branch. It is a navigation contract, not a deployment record. Use the
[documentation index](./docs/README.md) for detailed guidance and dated
evidence.

## Ownership map

| Area                     | Owner                                  | Contract                                                                                                                                          |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product application      | `apps/tools`                           | Next.js routes, application components, Tool execution, API handlers, metadata, sitemaps, and Cloudflare assembly for `tools.serp.co`.            |
| Shared application core  | `packages/app-core`                    | Shared shell components, the versioned Tool registry, its read-only Tool Catalog interface, and related catalog data.                             |
| Tool telemetry           | `packages/tool-telemetry`              | Browser/server event contracts plus D1 persistence and summaries.                                                                                 |
| UI primitives            | `packages/ui`                          | Reusable presentation primitives, styles, and small UI utilities; no Tool or application policy.                                                  |
| Lint configuration       | `packages/eslint-config`               | Shared ESLint configuration only.                                                                                                                 |
| TypeScript configuration | `packages/typescript-config`           | Shared TypeScript configuration only.                                                                                                             |
| Repository harness       | root `scripts` and root `package.json` | Repository-wide validation, generation, audit, and orchestration commands. Command roles are made explicit as the harness modernization proceeds. |
| Durable documentation    | root maps and `docs`                   | Current guidance, accepted decisions, and historical evidence as classified by the documentation index.                                           |

`apps/tools` is the only deployable application. A package owns reusable code
and data; it does not own application routes or deployment configuration.

## Permitted dependency direction

Runtime dependencies point from the application toward packages and from
higher-level shared packages toward lower-level primitives:

```text
apps/tools ───────┬──> packages/tool-telemetry
                  ├──> packages/app-core ──> packages/ui
                  └──> packages/ui
```

Build and lint configuration may be consumed by every workspace. Packages must
not import from `apps/tools`, and dependency cycles between workspace packages
are not permitted. Application-specific behavior stays in `apps/tools` until a
real reusable contract justifies moving it into a package.

## Canonical sources of truth

| Concern                                        | Canonical source                                                                  | Boundary                                                                                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shipped Tool catalog intent                    | `packages/app-core/src/data/tools.json`                                           | Sole versioned authority for shipped catalog intent. It does not prove correctness or health.                                                                      |
| Executable Tool behavior                       | Dispatch, workers, components, and API routes under `apps/tools`                  | Code owns what executes. Registry flags and dependency names are not sufficient provenance by themselves.                                                          |
| Tool implementation provenance                 | `apps/tools/lib/tool-execution-provenance.ts` and its imported dispatch selectors | Read-only Tool-id joins expose explicit engine ownership, implementation identity, and accepted execution profiles; unknown mappings remain unknown, never health. |
| Shared-workflow processor availability         | `apps/tools/lib/tool-processor-registry.ts`                                       | Read-only Tool-id joins distinguish registered adapters, explicitly unwired Tools, and unknown provenance. Known engines do not imply shared-workflow wiring.      |
| Related applications and network brands        | JSON data under `packages/app-core/src/data`                                      | These are separate catalogs and must not be inferred from Tool names or routes.                                                                                    |
| Workspace membership and declared dependencies | `pnpm-workspace.yaml` and each workspace `package.json`                           | Imports show actual consumption; planner fields do not override manifests or code.                                                                                 |
| Production Worker configuration                | `apps/tools/wrangler.jsonc`                                                       | Owns Worker name, route, bindings, compatibility settings, and production/preview resource ids.                                                                    |
| Cloudflare build behavior                      | `apps/tools/open-next.config.ts` and `apps/tools/scripts/build-cloudflare.mjs`    | Owns the OpenNext artifact and incremental-cache integration.                                                                                                      |
| D1 schema                                      | Ordered SQL in `apps/tools/migrations`                                            | Migrations own persisted production telemetry shape. TypeScript types and runbooks describe, but do not replace, the schema.                                       |
| Runtime observations                           | D1 `tool_runs` and derived `tool_status`                                          | Time-bound evidence for instrumented Tool ids, not catalog or work state.                                                                                          |
| Active work                                    | GitHub Issues for this repository                                                 | Issues, dependencies, labels, and assignees own readiness, blockers, and ownership. Repository plans are not a parallel tracker.                                   |
| Current documentation classification           | `docs/README.md`                                                                  | Every durable Markdown document must be indexed as current guidance, historical/advisory evidence, or legacy material awaiting migration.                          |

Consumers migrate through
`packages/app-core/src/lib/tool-catalog.ts`. That read-only boundary validates
and projects registry identity, routes, taxonomy, publication intent, and
content. Explicit versioned compatibility profiles may preserve prior
presentation copy as catalog intent under
[ADR 0001](./docs/adr/0001-catalog-compatibility-copy-is-intent.md); that copy
must not be used as implementation provenance, verification evidence, or a
runtime observation.

Maintained Node.js harness consumers that cannot load the TypeScript facade use
the package-owned `tool-catalog-adapter.mjs`. It is the only approved
JavaScript registry reader, exposes bounded operational projections, and is
parity-tested against the full Tool Catalog. Individual scripts must not parse
the registry or recreate publication and taxonomy rules.

The tracked-source contract in
`scripts/verify-tool-catalog-boundary.mjs` rejects direct registry readers,
retired compatibility imports, and reconstructed active-publication filters.
Failures name the supported TypeScript Catalog and JavaScript adapter migration
paths. The downloader registry synchronizer is the sole retained raw
owned-output mutator; it does not provide a read interface to consumers.

Registry Tool id is the join key across catalog intent, fixtures, verification,
runtime observations, planning evidence, and GitHub work. Names, routes, and
planner rows are not substitute join keys.

The application-owned execution-provenance boundary maps canonical Tool ids to
engine records that name the owning dispatch module and processing location.
It reuses pure selectors imported by runtime dispatch, so package manifests and
real imports remain the evidence for engine ownership. It does not add
dependency guesses to catalog records or infer capability, correctness, or
health when no maintained mapping exists.

Processor contracts remain behind the shared workflow's single `run` seam.
Canonical Tool-id intent supplies the requested operation and output contract;
processor support separately declares accepted detected inputs, outputs,
resource limits, cardinality, parsed options, and semantic-validator policy.
Both contracts are validated and deeply frozen before acquisition. Declared
budgets are cooperative limits available to acquisition and processing code,
with workflow byte-limit postconditions as a second defense; they are not a
JavaScript sandbox. The workflow always enforces non-empty bytes and exact
format/MIME agreement with intent, then the processor-owned validator proves
format or domain semantics. Application semantic verifiers provide trusted
defaults without making their current format registry the extensibility
boundary. Processor availability is a separate Tool-id projection: inferred
provenance remains explicitly unwired until a production family migration
registers an adapter, and neither support nor validator results become Catalog
intent or runtime telemetry.

Browser lifecycle policy is owned by
`apps/tools/lib/browser-workflow-lifecycle.ts`. Its small interface supplies
terminal telemetry, delivery/object-URL ownership, and latest-result reading to
family adapters behind `ToolWorkflow.run`. Tool presentation modules may own
Tool-specific controls, copy, and snapshot rendering; processors may own
Tool-specific Worker and stream implementations. Neither presentation nor
family adapters may recreate the shared browser lifecycle. The tracked-source
verifier in `scripts/verify-tool-workflow-ownership.mjs` follows application
imports, reports the accepted interface with an actionable migration, and is
part of the canonical `pnpm check` gate.

The streamed-media adapter registration in
`apps/tools/lib/media-workflow/adapter-registration.ts` projects executable
families explicitly. Its downloader family is the active Tool-id set owned by
the shared downloader renderer, while transcription remains an explicit
Tool-id family. Execution provenance describes those Tools but does not
register or dispatch their adapters.

## Cloudflare runtime and data boundaries

The production application path is a Next.js application compiled by OpenNext
to the `tools-serp-co` Cloudflare Worker and routed to `tools.serp.co`.

- Workers Static Assets serves the generated application assets through the
  `ASSETS` binding.
- R2 backs the incremental cache through `NEXT_INC_CACHE_R2_BUCKET`, with
  separate production and preview buckets.
- D1 stores telemetry through `SERP_TOOLS_DB`, with separate production and
  preview database ids and migrations owned by `apps/tools/migrations`.
- `WORKER_SELF_REFERENCE` is the Worker service binding used by the OpenNext
  runtime.
- Large FFmpeg/WASM assets are hosted separately at
  `https://assets.tools.serp.co`; this host is configuration, not a second
  application runtime.

Native FFmpeg, ImageMagick, Ghostscript, or `yt-dlp` execution requires an
explicitly chosen compatible runtime; Cloudflare Workers support must not be
inferred from local Node.js behavior.

Production deploys, remote migrations, provisioning, uploads, secrets, and
destructive resource retirement remain human-controlled. See the current
[Cloudflare operations runbook](./docs/runbooks/cloudflare.md) for
binding details and safe access paths.
