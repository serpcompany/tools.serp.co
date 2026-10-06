// The dashboard used to print the caught error's message. For a D1 failure
// that is Drizzle's "Failed query: select ... params:" wrapper, which shows the
// SQL but hides the real reason (for example "no such table") in `cause`.

export type DashboardLoadError = Readonly<{
  title: string;
  message: string;
}>;

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join("\n");
}

export function describeDashboardLoadError(error: unknown): DashboardLoadError {
  const detail = errorChainText(error);

  if (/no such table\b/i.test(detail)) {
    return {
      title: "Telemetry database is not migrated",
      message:
        "Run the D1 migrations for this environment (pnpm -C apps/tools db:migrate:local, db:migrate:staging or db:migrate:production), then refresh this page.",
    };
  }

  if (/binding unavailable/i.test(detail)) {
    return {
      title: "Telemetry database is not connected",
      message: "This Worker has no SERP_TOOLS_DB binding. Check wrangler.jsonc for this environment.",
    };
  }

  return {
    title: "Dashboard data is unavailable",
    message: "Loading telemetry from D1 failed. The Worker logs have the full error.",
  };
}

export function dashboardLoadErrorLogDetail(error: unknown): string {
  return errorChainText(error);
}
