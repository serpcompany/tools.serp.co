# Repository architecture

This map describes stable ownership and dependency boundaries on the current
default branch. It is a navigation contract, not a deployment record.
[AGENTS.md](./AGENTS.md) maps each area to the doc that holds its detailed
guidance.

## Ownership map

| Area                     | Owner                                  | Contract                                                                                                                                          |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product application      | [`apps/tools`](./apps/tools/README.md) | Next.js routes, components, the Tool registry, Tool execution, API handlers, metadata, sitemaps, and Cloudflare assembly for `tools.serp.co`.     |
| Shared application core  | `packages/app-core`                    | Shared shell components and related catalog data.                                                                                                 |
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
| Shipped Tool catalog intent                    | `apps/tools/lib/catalog/tools.json`                                            | Owns registry id, route, operation, active/inactive intent, formats, and catalog content. It does not prove correctness or health.        |
| Executable Tool behavior                       | Dispatch, workers, components, and API routes under `apps/tools`               | Code owns what executes. Registry flags and dependency names are not sufficient provenance by themselves.                                 |
| Related applications and network brands        | JSON data under `packages/app-core/src/data`                                   | These are separate catalogs and must not be inferred from Tool names or routes.                                                           |
| Workspace membership and declared dependencies | `pnpm-workspace.yaml` and each workspace `package.json`                        | Imports show actual consumption; planning data does not override manifests or code.                                                       |
| Worker configuration                           | `apps/tools/wrangler.jsonc`                                                    | Only Wrangler config. Top level is local-only; `env.staging` and `env.production` own Worker names, routes, bindings and resource ids.   |
| Cloudflare build behavior                      | `apps/tools/open-next.config.ts` and `apps/tools/scripts/build-cloudflare.mjs` | Owns the OpenNext artifact and incremental-cache integration.                                                                             |
| D1 schema                                      | Drizzle schema in `packages/tool-telemetry/src/schema.ts`                      | `db:generate` writes ordered SQL to `apps/tools/migrations`; a test fails when schema and migrations drift.                               |
| Verification evidence                          | `apps/tools/benchmarks/tool-sweep-results.json` and `fixture-matrix.json`      | The sweep's status for each active Tool at a recorded commit (`pnpm -C apps/tools tool-sweep`), and the fixture each format uses. A fixture alone proves nothing. |
| Runtime observations                           | D1 `tool_runs` and derived `tool_status`                                       | Time-bound evidence for instrumented Tool ids, not catalog or work state.                                                                 |
| Keyword demand                                 | `apps/tools/data/keywords.csv`                                                 | Search volume and difficulty per keyword from dated Ahrefs exports, rebuilt by `pnpm -C apps/tools keywords`. Planning evidence only.     |
| Tool status view                               | `apps/tools/benchmarks/tool-status.csv` (generated)                            | Joins catalog intent, verification, processing location (from the sweep's engine) and keyword demand by Tool id. Owns no fact; never edited by hand. |
| Active work                                    | GitHub Issues for this repository                                              | Issues, dependencies, labels, and assignees own readiness, blockers, and ownership. Repository plans are not a parallel tracker.          |
| Documentation map                              | `AGENTS.md`                                                                    | Maps each area to the doc that owns it; `docs/README.md` says what belongs in `docs/`. `.archive/` is historical evidence as a whole.     |

Registry Tool id is the join key across catalog intent, fixtures, verification,
runtime observations, keyword demand, and GitHub work. Names and routes are not
substitute join keys. A keyword joins the Tool whose id is its words joined by
hyphens; a Tool whose id differs only by a format alias (`docx-to-jpeg` for
"word to jpg") counts as alias coverage, never as an exact page.

After a sweep, a catalog change or a keyword import, run
`pnpm -C apps/tools tool-status` and commit `tool-status.csv` and
`tool-status-summary.md`; `pnpm test` fails while either is stale. On a merge
conflict in either file, regenerate it rather than resolving it by hand.

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
[Tool execution paths](./docs/execution-paths.md#routes-that-fail-on-workers)
lists the server routes the #224 sweep saw fail on Workers, and one it didn't
measure that would fail the same way.

Production deploys, remote migrations, provisioning, uploads, secrets, and
destructive resource retirement remain human-controlled. See the current
[Cloudflare operations runbook](./docs/runbooks/cloudflare.md) for
binding details and safe access paths.
