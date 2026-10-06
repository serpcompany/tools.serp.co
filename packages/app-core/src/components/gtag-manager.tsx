"use client";

import { GoogleTagManager } from "@next/third-parties/google";

import { isProductionSite } from "../lib/site-env";

export function GTagManager() {
  const gtmId = "GTM-PP9W77LK";

  // Analytics run only on a build explicitly marked production, so staging,
  // previews and local builds never report into the production container.
  if (!isProductionSite(process.env.NEXT_PUBLIC_SITE_ENV)) {
    return null;
  }

  return <GoogleTagManager gtmId={gtmId} />;
}
