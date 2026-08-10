# Artifact lifecycle and safe cleanup

This runbook owns the repository policy for scratch space, reproducible caches,
retained run evidence, and restricted exports. These asset classes are not
interchangeable.

## Owned locations

| Asset class         | Owner and location                                                                                   | Lifecycle                                                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process scratch     | `pnpm scratch:run` creates a uniquely named directory under the operating system temporary directory | Remove on command exit. Each invocation removes owned, abandoned directories older than 24 hours while preserving live owners. Never treat scratch as retained evidence.      |
| Reproducible caches | The tool that owns `.turbo`, `.next`, `.open-next`, `coverage`, or another documented build cache    | Recreate from versioned inputs. Use that tool's cache cleanup, not artifact cleanup.                                                                                          |
| Local run artifacts | Repository harness under ignored `.artifacts/runs/<run-id>`                                          | Store only structured, sanitized evidence. Apply the retention defaults below.                                                                                                |
| CI run artifacts    | The CI provider's artifact store, scoped to the job and revision                                     | Use the same run identity and manifest. Apply pull-request or scheduled/main retention. Do not commit downloads.                                                              |
| Fixtures            | The owning app or package, currently including `apps/tools/benchmarks/fixtures`                      | Commit only licensed, non-sensitive, reusable inputs. A fixture is an input, not proof that a Tool works.                                                                     |
| Audits              | Tracked, dated evidence under `docs/audits` and indexed by `docs/README.md`                          | Preserve useful sanitized observations at their named date and scope.                                                                                                         |
| ADRs                | Tracked decisions under `docs/adr`                                                                   | Follow the ADR policy; supersede rather than delete accepted history.                                                                                                         |
| Restricted exports  | A human-owner-controlled location outside the repository with restrictive permissions                | Never place credentials, environment exports, production rows, personal data, or captured authorization material in scratch, `.artifacts`, CI artifacts, fixtures, or audits. |

The repository has no `tmp/` workflow contract or catch-all ignore. The dated
[ignored local inventory](../audits/ignored-local-inventory-2026-08-11.md)
records aggregate classes observed before that convention was removed. Its
contents remain under owner-controlled disposition; implementation must not
blanket-delete or inspect restricted local material.

## Run identity and manifest

Nontrivial retained evidence uses this identity:

```text
<UTC basic timestamp>_<7-character revision>_<environment>_<scope>
```

For example:

```text
20260101T000000Z_abcdef1_local_all-tools
```

The scope and environment are lowercase slugs. The manifest records:

- command name and contract version;
- full Git revision and dirty state;
- start and completion timestamps;
- environment class;
- a sanitized scope label and optional SHA-256 input hashes;
- result status;
- Node.js, pnpm, platform, and architecture versions;
- `public` or `internal` classification;
- retention class and expiry; and
- linked GitHub issue references.

Create a manifest with the repository-owned command. Timestamps must be UTC;
the revision must be the exact commit tested.

```bash
pnpm artifacts:create -- \
  --command smoke:tools \
  --command-version 1 \
  --revision abcdef1234567890abcdef1234567890abcdef12 \
  --environment local \
  --scope all-tools \
  --input-hash sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --status success \
  --classification internal \
  --linked-work '#57' \
  --started-at 2026-01-01T00:00:00.000Z \
  --completed-at 2026-01-01T00:05:00.000Z
```

Use `--dirty` when the working tree contributed uncommitted inputs. Use
`--summary-stdin` to retain a short line-oriented report from standard input.
The only values preserved verbatim are `status=success|failure|cancelled` and
non-negative integer `checks-passed`, `checks-failed`, `items`, `bytes`, or
`duration-ms` fields. Restricted and unstructured lines become fixed redaction
markers, so free text cannot pass through to disk. Input paths are not manifest
fields. Record a content hash, not a filename.

Allowed environment classes are `local`, `pull-request`, `scheduled`, `main`,
and `migration`. A local run may opt into `--retention-class retained-debug`.
Credential-bearing and restricted classifications are refused.

## Retention defaults

| Class                                       |                                                               Default maximum |
| ------------------------------------------- | ----------------------------------------------------------------------------: |
| Process scratch                             |                                                                      24 hours |
| Local debugging                             |                                                                        7 days |
| Retained local debugging                    |                                                                       14 days |
| Pull-request CI                             |                                                                       14 days |
| Scheduled or main canary/benchmark evidence |                                                                       30 days |
| Restricted migration export                 | 7 days, only through checksum, snapshot, reconciliation, and owner acceptance |
| Credentials and environment exports         |                                                                Never retained |

The migration row does not authorize storing an export in `.artifacts`. It is
an upper bound for a protected external location controlled by the data owner.
Delete it sooner after owner acceptance.

Run a command that needs process scratch through the owned wrapper:

```bash
pnpm scratch:run -- node scripts/example-command.mjs
```

The command receives its private directory through
`TOOLS_SERP_SCRATCH_DIR`. The wrapper removes it when the command returns and,
on every invocation, reaps only its own `tools-serp-scratch/run-*` directories
that are older than 24 hours and whose recorded owner process is no longer
alive. It rejects a symlinked scratch root and does not use repository `tmp/`.

## Restricted values

Manifests and reports must not contain credentials, authorization headers,
signed query strings, sensitive filenames or paths, personal identifiers, raw
production rows, secrets, tokens, or environment-file contents. The manifest
CLI uses allowlisted values and hashes. Summary redaction is not a substitute
for source-side sanitization or human review of data-derived evidence.

## Cleanup

Inspect expired local artifacts without changing the filesystem:

```bash
pnpm artifacts:cleanup
```

Narrow the report by completion age or command:

```bash
pnpm artifacts:cleanup -- --older-than-days 14 --command smoke:tools
```

After reviewing the names, counts, and byte totals, apply the same selection:

```bash
pnpm artifacts:cleanup -- --older-than-days 14 --command smoke:tools --apply
```

Without an age override, cleanup selects manifests whose `expiresAt` is in the
past. It resolves only the repository-owned `.artifacts/runs` root, refuses
symlinked roots, entries, or contents, and never prints file contents. It does
not clean `.turbo`, `.next`, `.open-next`, dependency stores, or any other build
cache. Cache cleanup is a separate tool-owner operation.
