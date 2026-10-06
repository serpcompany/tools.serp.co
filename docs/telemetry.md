# Telemetry

What tools.serp.co records when someone runs a tool, why, how long it is kept,
and how a visitor opts out or gets it deleted. This follows the serp
[telemetry standard](https://github.com/serpcompany/serp/blob/main/docs/engineering/technology/telemetry.md).
The database schema and write contract are in the
[D1 telemetry runbook](runbooks/d1-telemetry.md).

## Purpose

Tool-run telemetry answers one question: which tools work for real users and
which are failing. It feeds the `tool_status` health table and the internal
dashboard at `/internal/tools/`. It is not product analytics and is not used
for advertising or for identifying people. Google Tag Manager and AdSense are
separate from it.

## What a tool run sends

The browser sends a `tool_run_started` event when a tool starts and a
`tool_run_succeeded` or `tool_run_failed` event when it ends
(`packages/tool-telemetry/src/client.ts`). Each event carries:

| Field | What it is |
| --- | --- |
| `runId` | A random id for this one run. |
| `toolId` | The catalog id of the tool, e.g. `png-to-jpg`. |
| `startedAt` | When the run started. |
| `durationMs`, `inputBytes`, `outputBytes` | Timing and file sizes. |
| `errorCode` | A stable code such as `convert_failed`, on failures only. |
| `metadata` | Allowlisted keys only; see below. |

The event's top-level `from` and `to` (formats) are validated but not stored;
the same names inside `metadata` (see below) are.

## Metadata

The server keeps only the keys in `METADATA_KEYS`
(`packages/tool-telemetry/src/validate.ts`) and drops everything else. In
groups:

- **Request origin, set only by the server:** `ip` (Cloudflare's
  `cf-connecting-ip`, falling back to `x-real-ip` and then `x-forwarded-for`),
  `userAgent`, and `release` (the commit the Worker was built from). Values a
  client sends for these keys are dropped. Keeping `ip` and `userAgent` was
  reviewed and accepted by the owner in #161; they help debug failures that
  only one browser or network hits.
- **Device:** `deviceId`, a random id the browser keeps in `localStorage`
  (`serp_tools_device_id`) so repeat failures from one browser can be grouped.
  It is not linked to an account, a name or anything outside this site.
- **How the tool ran:** `engine`, `route`, `op`, `from`, `to`, `format`,
  `status`, `source`, `mode`, `urlHost` (the host of a URL pasted into a
  downloader, e.g. `www.youtube.com`, never the full URL), `failFast`,
  `failFastReason`, `compressionLevel`.
- **Sizes and counts, never content:** `fileCount`, `rows`, `columns`,
  `htmlLength`, `audioSeconds`, `characters`, `words`, `sentences`,
  `paragraphs`, `lines`, `readingTime`, `speakingTime`.

Never sent or stored: file names, file or page contents, pasted text, full
URLs, free-form error messages, or anything typed into a tool. Metadata objects
written in the app are typed `ToolRunMetadata` (allowlisted keys, minus the
server-only ones), so typecheck rejects a new key until it is added to
`METADATA_KEYS` and this doc. Values are capped (20 keys,
4 KB, strings cut to 256 characters).

## Retention

Tool runs are kept for **90 days** (`TOOL_RUN_RETENTION_DAYS` in
`packages/tool-telemetry/src/purge.ts`). The purge isn't scheduled yet (owner
decision, 2026-10-06), so run it by hand about once a month, checking first
with `--dry-run`. It uses your `wrangler login` session; with more than one
Cloudflare account, also set `CLOUDFLARE_ACCOUNT_ID` (the SERP account id is in
the Cloudflare runbook).

```bash
pnpm -C apps/tools telemetry:purge --env production --dry-run
pnpm -C apps/tools telemetry:purge --env production
```

It deletes expired runs through `wrangler d1 execute --remote`, 1,000 per
statement and at most 200 statements per run; if it stops at that limit, run it
again. Scheduling it later is a Cron Trigger on the Worker, which runs on
Cloudflare and uses no GitHub Actions minutes. `tool_status` holds only per-tool
aggregates, no per-visitor data, and is rewritten as runs complete.

## Opting out

A browser that sends [Global Privacy Control](https://globalprivacycontrol.org)
(`navigator.globalPrivacyControl === true`) sends no tool-run telemetry at all
and gets no device id. The server also ignores any telemetry request with the
`Sec-GPC: 1` header (status 204), which covers pages cached before the
client check. Clearing the site's `localStorage` resets the device id.
GPC doesn't change Google Tag Manager or AdSense, which are configured
separately.

## Deletion requests

Runs are deleted at the first manual purge after they turn 90 days old, so
with a monthly purge they live 90 to about 120 days. To delete one visitor's
runs sooner, ask them for their device id (`localStorage.serp_tools_device_id`
in their browser's console). Then, with the owner's approval, run:

```bash
pnpm -C apps/tools telemetry:purge --env production --device-id <device id>
```

The command accepts only the device id formats the client generates, so a
pasted value can't change the SQL. Runs without a device id (for example when
`localStorage` was blocked) can't be matched to a visitor. Runs from before
#161 may contain file names and error text in `metadata`; they are purged on
the same schedule.

## Other copies

- **Neon (before 2026-06-20):** about 26,800 runs from before the Cloudflare
  cutover stay in the retired Neon database or its export, which the owner
  keeps as the historical record (#34). They include file names and error
  text. The purge and deletion requests don't reach them; a deletion request
  for that period is handled by hand in Neon.
- **One-off D1 backup:** `tmp/d1-production-backup-20261006T0339Z.sql` in the
  owner's local checkout (ignored by git) holds every D1 run as of
  2026-10-06. It is kept only for the broken-tool investigation (#147) and is
  deleted when that work is done; deletion requests don't reach it until then.
  Never commit it or copy it elsewhere.
- **D1 Time Travel:** Cloudflare can restore the database to any point in the
  last 30 days, so deleted runs stay recoverable for up to 30 days after a
  purge or deletion request.
