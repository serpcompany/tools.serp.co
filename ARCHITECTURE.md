# Repository architecture

This map describes stable ownership and dependency boundaries on the current
default branch. It is a navigation contract, not a deployment record.
[AGENTS.md](./AGENTS.md) maps each area to the doc that holds its detailed
guidance.

## Ownership map

| Area                     | Owner                                  | Contract                                                                                                                                          |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product application      | `apps/tools`                           | Next.js routes, application components, Tool execution, API handlers, metadata, sitemaps, and Cloudflare assembly for `tools.serp.co`.            |
| Shared application core  | `packages/app-core`                    | Shared shell components, the versioned Tool registry, and related catalog data.                                                                   |
| Tool telemetry           | `packages/tool-telemetry`              | Browser/server event contracts plus D1 persistence and summaries.                                                                                 |
| UI primitives            | `packages/ui`                          | Reusable presentation primitives, styles, and small UI utilities; no Tool or application policy.                                                  |
| Lint configuration       | [`packages/eslint-config`](./packages/eslint-config/README.md)               | Shared ESLint configuration only.                                                                                                                 |
| TypeScript configuration | [`packages/typescript-config`](./packages/typescript-config/README.md)           | Shared TypeScript configuration only.                                                                                                             |
| Repository harness       | root `scripts` and root `package.json` | Repository-wide validation, generation, audit, and orchestration commands. Command roles are made explicit as the harness modernization proceeds. |
| Durable documentation    | root maps, `docs` and `.archive`       | Current guidance and accepted decisions in `docs`, mapped by area from `AGENTS.md`; historical evidence in `.archive`, classified as a whole.         |

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

| Concern                                        | Canonical source                                                               | Boundary                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Shipped Tool catalog intent                    | `packages/app-core/src/data/tools.json`                                        | Owns registry id, route, operation, active/inactive intent, formats, and catalog content. It does not prove correctness or health.        |
| Executable Tool behavior                       | Dispatch, workers, components, and API routes under `apps/tools`               | Code owns what executes. Registry flags and dependency names are not sufficient provenance by themselves.                                 |
| Related applications and network brands        | JSON data under `packages/app-core/src/data`                                   | These are separate catalogs and must not be inferred from Tool names or routes.                                                           |
| Workspace membership and declared dependencies | `pnpm-workspace.yaml` and each workspace `package.json`                        | Imports show actual consumption; planner fields do not override manifests or code.                                                        |
| Worker configuration                           | `apps/tools/wrangler.jsonc`                                                    | Only Wrangler config. Top level is local-only; `env.staging` and `env.production` own Worker names, routes, bindings and resource ids.   |
| Cloudflare build behavior                      | `apps/tools/open-next.config.ts` and `apps/tools/scripts/build-cloudflare.mjs` | Owns the OpenNext artifact and incremental-cache integration.                                                                             |
| D1 schema                                      | Drizzle schema in `packages/tool-telemetry/src/schema.ts`                      | `db:generate` writes ordered SQL to `apps/tools/migrations`; a test fails when schema and migrations drift.                               |
| Runtime observations                           | D1 `tool_runs` and derived `tool_status`                                       | Time-bound evidence for instrumented Tool ids, not catalog or work state.                                                                 |
| Planning evidence                              | `packages/app-core/src/data/tools-planner.csv`                                 | Advisory candidate rows, read and appended to by the downloader lander sync and read by two lander tests. Not catalog intent, capability, or health; join only by registry Tool id. |
| Active work                                    | GitHub Issues for this repository                                              | Issues, dependencies, labels, and assignees own readiness, blockers, and ownership. Repository plans are not a parallel tracker.          |
| Documentation map                              | `AGENTS.md`                                                                    | Maps each area to the doc that owns it; `docs/README.md` says what belongs in `docs/`. `.archive/` is historical evidence as a whole.     |

Registry Tool id is the join key across catalog intent, fixtures, verification,
runtime observations, planning evidence, and GitHub work. Names, routes, and
planner rows are not substitute join keys.

## Cloudflare runtime and data boundaries

The production application path is a Next.js application compiled by OpenNext
to the `tools-serp-co` Cloudflare Worker and routed to `tools.serp.co`.

- Workers Static Assets serves the generated application assets through the
  `ASSETS` binding.
- R2 backs the incremental cache through `NEXT_INC_CACHE_R2_BUCKET`, with one
  bucket per environment (local, staging, production).
- D1 stores telemetry through `SERP_TOOLS_DB`, with one database per
  environment and migrations owned by `apps/tools/migrations`.
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
