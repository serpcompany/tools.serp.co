# Catalog synchronization

All catalog synchronization is inspect-first. Run the `:check` command, review
the proposed owned-output changes, then ask a human before using `:write` when
the input authority is external. Writes are deterministic and touch only the
listed owned outputs.

| Commands                                                                      | Input authority and network behavior                                                                                                                       | Owned outputs                                | Failure and write behavior                                                                                                                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm sync:extensions:check` / `pnpm sync:extensions:write`                   | Exact Chrome Web Store URLs already stored in the extension catalog; reads those pages over the network.                                                   | `packages/app-core/src/data/extensions.json` | Transient unreachability is reported separately and never means confirmed removal. Existing entries and assets are not deleted.                                                           |
| `pnpm sync:downloader-registry:check` / `pnpm sync:downloader-registry:write` | `serpcompany/downloader-source-registry` registry JSON through `gh api`, plus network verification of exact outbound URLs present in each registry record. | `packages/app-core/src/data/tools.json`      | Missing or unreachable exact URLs are omitted. The sync never derives outbound links from Tool ids, slugs, or guessed repository names. Advisory planning CSVs are not inputs or outputs. |

Check mode is the default and produces no repository changes. It reports the
proposed output paths and record-level additions or field changes. Write mode
must produce the same proposal and then update only the owned outputs, leaving
a normal repository diff for review. Neither mode belongs to `pnpm check`.

The downloader sync is deliberately one-way: external registry facts are
validated into the canonical Tool Catalog. Historical planning exports are not
regenerated or read back. A hand edit under `docs/evidence` therefore cannot
change a sync proposal, shipped Tool, support count, or acceptance result.

The former network-brand sync is retired because no portable source authority
currently exists. `packages/app-core/src/data/network-brands.json` remains the
runtime owner and can be changed through an ordinary reviewed repository diff;
a personal sibling checkout is not an accepted dependency or authority.
