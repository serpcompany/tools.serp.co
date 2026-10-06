"use client";

import { SENTRY_DEFAULTS, scrubEvent, sentryRelease } from "./sentry-scrub.ts";

// Browser error reports. Off unless NEXT_PUBLIC_SENTRY_DSN is set at build
// time, and off for browsers that send Global Privacy Control. Loaded lazily
// so pages don't pay for the SDK before an error.

let started: Promise<typeof import("@sentry/browser") | null> | null = null;

function optedOut() {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return (nav as Navigator & { globalPrivacyControl?: boolean } | undefined)?.globalPrivacyControl === true;
}

export function initSentryBrowser() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || typeof window === "undefined" || optedOut()) return Promise.resolve(null);
  started ??= import("@sentry/browser").then((Sentry) => {
    Sentry.init({
      ...SENTRY_DEFAULTS,
      dsn,
      environment: process.env.NEXT_PUBLIC_SITE_ENV || "local",
      release: sentryRelease(process.env.NEXT_PUBLIC_RELEASE),
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (crumb) => (crumb.category === "console" ? null : crumb),
    });
    return Sentry;
  });
  return started;
}

export function captureBrowserException(error: unknown) {
  void initSentryBrowser().then((Sentry) => Sentry?.captureException(error));
}
