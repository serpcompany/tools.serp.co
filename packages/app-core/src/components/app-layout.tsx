import { AppHeader } from "./app-header";
import { isProductionSite } from "../lib/site-env";
import { adsenseScriptSrc } from "../lib/third-party-scripts";
import { GTagManager } from "./gtag-manager";
import { AdSenseScript } from "./third-party-scripts";
import { SiteFooter } from "./site-footer";

import "@serp-tools/ui/globals.css";

const adsenseClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "ca-pub-2343633734899216";
const adsenseTestMode = process.env.NEXT_PUBLIC_ADSENSE_TEST_MODE === "true";

export function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" style={{ colorScheme: "light" }}>
      <body className="bg-background font-sans antialiased">
        {adsenseClient && (isProductionSite(process.env.NEXT_PUBLIC_SITE_ENV) || adsenseTestMode) ? (
          <AdSenseScript src={adsenseScriptSrc(adsenseClient)} />
        ) : null}
        <GTagManager />
        <div className="flex min-h-screen flex-col">
          <AppHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
