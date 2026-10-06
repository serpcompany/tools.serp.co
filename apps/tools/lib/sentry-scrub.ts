// Shared Sentry settings for the browser and the Worker (issue #162, serp
// telemetry standard). Error reports carry the error, its stack, the page
// path and the release, never user data: no IP, cookies, headers, query
// strings, request bodies, console logs or user identity.

type ScrubbableEvent = {
  user?: unknown;
  request?: { url?: string; method?: string; [key: string]: unknown };
  breadcrumbs?: Array<{ category?: string; data?: Record<string, unknown>; [key: string]: unknown }>;
  extra?: unknown;
  contexts?: Record<string, unknown>;
  [key: string]: unknown;
};

export function stripQuery(url: string) {
  return url.replace(/[?#].*$/, "");
}

// Typed loosely so the same function serves @sentry/browser and
// @sentry/cloudflare events.
export function scrubEvent<E>(input: E): E {
  const event = input as ScrubbableEvent;
  delete event.user;
  delete event.extra;
  if (event.request) {
    const { url, method } = event.request;
    event.request = {
      ...(url ? { url: stripQuery(url) } : {}),
      ...(method ? { method } : {}),
    };
  }
  if (event.contexts) {
    delete event.contexts.cloud_resource;
    delete event.contexts.culture;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      // Console messages can include file names and other input.
      .filter((crumb) => crumb.category !== "console")
      .map((crumb) => {
        const url = crumb.data?.url;
        if (typeof url !== "string") return { ...crumb, data: undefined };
        const { method, status_code: statusCode } = crumb.data ?? {};
        return { ...crumb, data: { url: stripQuery(url), method, status_code: statusCode } };
      });
  }
  return input;
}

// Release id shared by browser and Worker events: the deployed commit.
export function sentryRelease(commit: string | undefined) {
  return commit && commit !== "unknown" ? `tools-serp-co@${commit}` : undefined;
}

export const SENTRY_DEFAULTS = {
  sendDefaultPii: false,
  tracesSampleRate: 0,
  maxBreadcrumbs: 30,
} as const;
