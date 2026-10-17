import { AppLayout } from "@serp-tools/app-core/components/app-layout";
import type { Metadata } from "next";

import { SentryInit } from "@/components/SentryInit";
import { buildSiteMetadata } from "@/lib/page-metadata";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tools.serp.co";
const metadataBase = new URL(siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`);

// Defaults for a page that sets none of its own, and the title template that
// suffixes every page's own title with " | SERP Tools".
export const metadata: Metadata = {
  metadataBase,
  ...buildSiteMetadata(),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AppLayout>
      <SentryInit />
      {children}
    </AppLayout>
  );
}
