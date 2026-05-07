import networkBrandsData from "../data/network-brands.json" with { type: "json" };

const MAIN_GROUP_SLUG = "mainGroup";

type NetworkBrandSource = {
  name?: unknown;
  url?: unknown;
};

type NetworkBrandsSource = {
  brands?: unknown;
  brandGroups?: unknown;
};

export type NetworkBrandEntry = {
  slug: string;
  name: string;
  url: string;
  hostname: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeUrl(parsedUrl: URL): string {
  const pathname = parsedUrl.pathname.replace(/\/+$/, "");
  const normalizedPathname = pathname === "" ? "" : pathname;

  return `${parsedUrl.protocol.toLowerCase()}//${parsedUrl.host.toLowerCase()}${normalizedPathname}`;
}

function parseBrandUrl(slug: string, url: string): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Network brand ${slug} has an invalid URL`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Network brand ${slug} must use an http or https URL`);
  }

  return parsedUrl;
}

function readBrandGroups(source: NetworkBrandsSource): Record<string, unknown> {
  if (!isRecord(source.brandGroups)) {
    throw new Error("Network brands data is missing brand groups");
  }

  return source.brandGroups;
}

function readBrands(source: NetworkBrandsSource): Record<string, unknown> {
  if (!isRecord(source.brands)) {
    throw new Error("Network brands data is missing brands");
  }

  return source.brands;
}

function readGroupSlug(rawSlug: unknown, groupSlug: string): string {
  if (typeof rawSlug !== "string" || rawSlug.trim() === "") {
    throw new Error(`Network brand group ${groupSlug} contains an empty brand slug`);
  }

  return rawSlug.trim();
}

function readBrand(slug: string, brands: Record<string, unknown>): NetworkBrandSource {
  const brand = brands[slug];

  if (!isRecord(brand)) {
    throw new Error(`Network brand ${slug} is missing`);
  }

  return brand;
}

function readBrandName(slug: string, brand: NetworkBrandSource): string {
  if (typeof brand.name !== "string" || brand.name.trim() === "") {
    throw new Error(`Network brand ${slug} is missing a name`);
  }

  return brand.name.trim();
}

function readBrandUrl(slug: string, brand: NetworkBrandSource): string {
  if (typeof brand.url !== "string" || brand.url.trim() === "") {
    throw new Error(`Network brand ${slug} is missing a URL`);
  }

  return brand.url.trim();
}

export function getNetworkBrandsFromData(
  source: NetworkBrandsSource,
  groupSlug = MAIN_GROUP_SLUG,
): NetworkBrandEntry[] {
  const brands = readBrands(source);
  const brandGroups = readBrandGroups(source);
  const rawGroup = brandGroups[groupSlug];

  if (!Array.isArray(rawGroup)) {
    throw new Error(`Unknown network brand group: ${groupSlug}`);
  }

  const seenUrls = new Map<string, string>();

  return rawGroup.map((rawSlug) => {
    const slug = readGroupSlug(rawSlug, groupSlug);
    const brand = readBrand(slug, brands);
    const name = readBrandName(slug, brand);
    const url = readBrandUrl(slug, brand);
    const parsedUrl = parseBrandUrl(slug, url);
    const normalizedUrl = normalizeUrl(parsedUrl);
    const existingSlug = seenUrls.get(normalizedUrl);

    if (existingSlug) {
      throw new Error(
        `Duplicate network brand URL ${normalizedUrl} for ${existingSlug} and ${slug}`,
      );
    }

    seenUrls.set(normalizedUrl, slug);

    return {
      slug,
      name,
      url,
      hostname: parsedUrl.hostname,
    };
  });
}

export function getNetworkBrands(): NetworkBrandEntry[] {
  return getNetworkBrandsFromData(networkBrandsData);
}
