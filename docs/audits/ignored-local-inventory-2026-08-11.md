# Ignored local workflow inventory — 2026-08-11

Historical evidence only.

- Observed: 2026-08-11
- Revision: `3acce16b3f2aed1cc408b3a8575097a67c947455`
- Source provenance: filesystem names, extensions, counts, and aggregate sizes
  from the local checkout; file contents were not read
- Scope: ignored repository-local workflow state present immediately before the
  catch-all `tmp/` ignore was removed
- Limitations: this is one checkout at one time; extensions do not prove content
  type, sensitivity, ownership, license, or whether a file remains useful

## Aggregate inventory

The legacy `tmp/` directory contained 123 files in six directories, totaling
approximately 46,196 KiB:

| Conservative class             | Count | Observed extensions or forms                | Handling assumption                                 |
| ------------------------------ | ----: | ------------------------------------------- | --------------------------------------------------- |
| Data and text exports          |    52 | CSV, JSON, text, Markdown, dot/no-extension | Potential research or production-derived material   |
| Code and local automation      |    38 | JavaScript, Python, shell, TypeScript       | Unreviewed provenance and license                   |
| Web/captured-response material |    11 | HTML, headers, body, log                    | Restricted until privacy/authorization review       |
| Media and document material    |    19 | PNG, SVG, PDF, WAV                          | Unreviewed screenshots, captures, or reusable media |
| Environment-formatted material |     3 | env                                         | Treat as credentials or secrets                     |

Other observed ignored roots included local environment files, legacy provider
metadata, browser-automation logs, general logs, dependency stores, and build or
runtime caches for Turbo, Next.js, OpenNext, and Wrangler.

## Owner-controlled disposition

No files were opened, copied, promoted, or deleted during this inventory.

1. Keep environment-formatted files, captured responses, production rows, and
   authorization material outside repository artifacts. Rotate credentials if
   exposure or reuse cannot be ruled out.
2. Review untracked research, code, screenshots, and media for privacy, license,
   source authority, and ongoing ownership before retaining anything. A useful
   reusable sample needs registration in its owning fixture contract.
3. Move any required restricted migration export to a protected external
   location, complete snapshot/reconciliation acceptance, then delete it on the
   data owner's schedule.
4. Remove caches through their owning tools. Remove legacy provider metadata and
   the old local workflow directory only after the owner confirms they are no
   longer needed.
5. Do not use blanket recursive cleanup. The removed catch-all ignore makes new
   repository-local temporary state visible to Git instead of silently turning
   it into a workflow input.
