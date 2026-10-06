"use client";

import Link from "next/link";
import { useEffect } from "react";

import { captureBrowserException } from "@/lib/sentry-client";

// Replaces the root layout when it fails to render; reports the error.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureBrowserException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1.5rem", maxWidth: "36rem", margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
        <p>An unexpected error occurred. Please try again.</p>
        <p style={{ display: "flex", gap: "1rem" }}>
          <button type="button" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/">Go home</Link>
        </p>
      </body>
    </html>
  );
}
