import { serializeJsonLd } from "@/lib/structured-data";

// One JSON-LD script element holding `data`, escaped so no text
// in it can end the script or change how the page parses
// (serializeJsonLd in lib/structured-data.ts).
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
