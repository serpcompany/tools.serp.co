"use client";

import { useEffect } from "react";

import { initSentryBrowser } from "@/lib/sentry-client";

// Starts browser error reporting after the page loads (no-op without a DSN).
export function SentryInit() {
  useEffect(() => {
    void initSentryBrowser();
  }, []);
  return null;
}
