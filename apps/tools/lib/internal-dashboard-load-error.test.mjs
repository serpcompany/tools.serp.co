import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  dashboardLoadErrorLogDetail,
  describeDashboardLoadError,
} from "./internal-dashboard-load-error.ts";

// What drizzle-orm/d1 throws when the tables don't exist yet.
function drizzleNoSuchTable() {
  return new Error(
    'Failed query: select "tool_id", "status" from "tool_status" order by "tool_status"."updated_at" desc\nparams: ',
    { cause: new Error("D1_ERROR: no such table: tool_status: SQLITE_ERROR") },
  );
}

function shown(error) {
  const { title, message } = describeDashboardLoadError(error);
  return `${title}\n${message}`;
}

test("an unmigrated database points at the migration command, not the SQL", () => {
  const text = shown(drizzleNoSuchTable());

  assert.match(text, /not migrated/);
  assert.match(text, /db:migrate/);
  assert.doesNotMatch(text, /select|Failed query|SQLITE/i);
});

test("a missing binding says so", () => {
  assert.match(
    shown(new Error("D1 telemetry binding unavailable.")),
    /not connected[\s\S]*SERP_TOOLS_DB/,
  );
});

test("other failures show a generic message without raw error text", () => {
  const text = shown(new Error("D1_ERROR: network connection lost: SQLITE_IOERR"));

  assert.match(text, /Dashboard data is unavailable/);
  assert.doesNotMatch(text, /D1_ERROR|SQLITE|network connection/);
  assert.match(shown("weird"), /Dashboard data is unavailable/);
});

test("the log detail keeps the whole cause chain", () => {
  const detail = dashboardLoadErrorLogDetail(drizzleNoSuchTable());

  assert.match(detail, /Failed query/);
  assert.match(detail, /no such table: tool_status/);
});

test("the dashboard page renders the described error instead of err.message", () => {
  const page = readFileSync(new URL("../app/internal/tools/page.tsx", import.meta.url), "utf8");

  assert.match(page, /describeDashboardLoadError\(err\)/);
  assert.doesNotMatch(page, /err instanceof Error \? err\.message/);
});
