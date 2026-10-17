import { googleTagManagerScriptSrc } from "../lib/third-party-scripts";
import { isProductionSite } from "../lib/site-env";
import { GoogleTagManagerScript } from "./third-party-scripts";

// A Server Component: the container ID goes to the browser as a prop, so it is
// in every production page's HTML. The container loads once the page is
// interactive (lib/third-party-scripts.ts).
export function GTagManager() {
  const gtmId = "GTM-PP9W77LK";

  // Analytics run only on a build explicitly marked production, so staging,
  // previews and local builds never report into the production container.
  if (!isProductionSite(process.env.NEXT_PUBLIC_SITE_ENV)) {
    return null;
  }

  return <GoogleTagManagerScript src={googleTagManagerScriptSrc(gtmId)} />;
}
