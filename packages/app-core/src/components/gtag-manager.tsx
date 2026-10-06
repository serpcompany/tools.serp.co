"use client";

import { GoogleTagManager } from "@next/third-parties/google";

export function GTagManager() {
  const gtmId = "GTM-PP9W77LK";

  // Analytics run only on a build explicitly marked production, so staging,
  // previews and local builds never report into the production container.
  if (process.env.NEXT_PUBLIC_SITE_ENV !== "production") {
    return null;
  }

  return <GoogleTagManager gtmId={gtmId} />;
}
