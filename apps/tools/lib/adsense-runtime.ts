type AdSenseSlotRuntimeArgs = {
  adsenseClient?: string;
  resolvedSlot?: string;
  adsenseTestMode?: boolean;
  siteEnv?: string;
};

// Ads serve only on a build explicitly marked production, unless test mode is
// on for local ad work.
export function isAdSenseSlotEnabled({
  adsenseClient,
  resolvedSlot,
  adsenseTestMode = false,
  siteEnv = process.env.NEXT_PUBLIC_SITE_ENV,
}: AdSenseSlotRuntimeArgs) {
  if (!adsenseClient || !resolvedSlot) {
    return false;
  }

  return siteEnv === "production" || adsenseTestMode;
}
