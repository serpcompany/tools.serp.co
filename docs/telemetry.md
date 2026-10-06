# Telemetry

What tools.serp.co records when someone runs a tool, why, how long it is kept,
and how a visitor opts out or gets it deleted. This follows the serp
[telemetry standard](https://github.com/serpcompany/serp/blob/main/docs/engineering/technology/telemetry.md).
The database schema and write contract are in the
[runbooks](runbooks/cloudflare.md#d1-telemetry-database).

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

`from` and `to` (formats) may be sent but are not stored.

## Metadata

The server keeps only the keys in `METADATA_KEYS`
(`packages/tool-telemetry/src/validate.ts`) and drops everything else. In
groups:

- **Request origin, added by the server:** `ip` (the client IP from the
  request headers), `userAgent`, and `release` (the commit the Worker was built
  from). Keeping `ip` and `userAgent` was reviewed and accepted by the owner
  in #161; they help debug failures that only one browser or network hits.
- **Device:** `deviceId`, a random id the browser keeps in `localStorage`
  (`serp_tools_device_id`) so repeat failures from one browser can be grouped.
  It is not linked to an account, a name or anything outside this site.
- **How the tool ran:** `engine`, `route`, `op`, `from`, `to`, `format`,
  `status`, `source`, `mode`, `urlHost` (the host of a pasted URL, never the
  full URL), `failFast`, `failFastReason`, `compressionLevel`.
- **Sizes and counts, never content:** `fileCount`, `rows`, `columns`,
  `htmlLength`, `audioSeconds`, `characters`, `words`, `sentences`,
  `paragraphs`, `lines`, `readingTime`, `speakingTime`.

Never sent or stored: file names, file or page contents, pasted text, full
URLs, free-form error messages, or anything typed into a tool. Values are
capped (20 keys, 4 KB, strings cut to 256 characters).

## Retention

Tool runs are kept for **90 days** (`TOOL_RUN_RETENTION_DAYS` in
`packages/tool-telemetry/src/d1.ts`). A Cron Trigger runs every day at 03:23
UTC in staging and production (`apps/tools/worker-entry.mjs`) and deletes older
runs in bounded batches. Its result is logged as `telemetry purge` in Workers
Logs. `tool_status` holds only per-tool aggregates, no per-visitor data, and is
rewritten as runs complete.

## Opting out

A browser that sends [Global Privacy Control](https://globalprivacycontrol.org)
(`navigator.globalPrivacyControl === true`) sends no telemetry at all and gets
no device id. Clearing the site's `localStorage` resets the device id.

## Deletion requests

Runs expire after 90 days without any action. To delete one visitor's runs
sooner, ask them for their device id (`localStorage.serp_tools_device_id` in
their browser's console). Then, with the owner's approval, run against
production:

```bash
pnpm -C apps/tools exec wrangler d1 execute SERP_TOOLS_DB --remote --env production \
  --command "DELETE FROM tool_runs WHERE json_extract(metadata, '$.deviceId') = '<device id>'"
```

Runs from before #161 may also contain file names in `metadata`; they expire
on the same 90-day schedule.
