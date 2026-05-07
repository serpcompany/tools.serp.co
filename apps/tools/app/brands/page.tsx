import Link from "next/link";
import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";

import { getNetworkBrands } from "@serp-tools/app-core/lib/network-brands";

export const dynamic = "force-static";

const brands = getNetworkBrands();
const description =
  "Browse the public brands, apps, and websites in the SERP network.";

export const metadata: Metadata = {
  title: "Brands | SERP Tools",
  description,
  alternates: { canonical: "/brands/" },
  openGraph: {
    title: "Brands | SERP Tools",
    description,
    type: "website",
    url: "/brands/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Brands | SERP Tools",
    description,
  },
};

export default function Page() {
  return (
    <main className="min-h-screen bg-background">
      <section className="border-b bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_55%),linear-gradient(180deg,_rgba(248,250,252,0.98)_0%,_rgba(255,255,255,1)_100%)]">
        <div className="container py-14 md:py-20">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-600">
              SERP Network
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">
              Brands
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
              Explore the public sites, products, and projects connected to the SERP network.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <div className="rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
              {brands.length} network brands
            </div>
            <div className="rounded-full border border-slate-200 bg-white/90 px-4 py-2 text-sm text-slate-600 shadow-sm">
              Main SERP group
            </div>
          </div>
        </div>
      </section>

      <section className="container py-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {brands.map((brand) => (
            <Link
              key={brand.slug}
              href={brand.url}
              prefetch={false}
              target="_blank"
              rel="noreferrer noopener"
              className="group block rounded-xl border bg-background p-5 transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold leading-tight group-hover:text-primary">
                    {brand.name}
                  </h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {brand.hostname}
                  </p>
                </div>
                <ExternalLink
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                  aria-hidden="true"
                />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
