import {
  serializeJsonLd,
  structuredDataOrigin,
  toolStructuredData,
  type ToolPageText,
} from "@/lib/structured-data";

// The page's one JSON-LD script tag: what the Tool is (lib/structured-data.ts).
// A Server Component: it reads the catalog, which must stay out of the browser
// bundle. Renders nothing for an id that isn't an active Tool.
export function StructuredData(page: ToolPageText) {
  const origin = structuredDataOrigin({
    siteEnv: process.env.NEXT_PUBLIC_SITE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  });
  const data = toolStructuredData(page, origin);
  if (!data) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
