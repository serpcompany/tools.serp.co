import Script from "next/script";

import { AppHeader } from "./app-header";
import { GTagManager } from "./gtag-manager";
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
        {adsenseClient && (process.env.NODE_ENV !== "development" || adsenseTestMode) ? (
          <Script
            id="adsense-script"
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsenseClient}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
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
