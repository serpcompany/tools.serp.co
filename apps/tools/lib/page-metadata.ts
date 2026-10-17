import type { Metadata } from "next";

import {
  SHARE_IMAGES,
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  type ShareImageName,
} from "./share-images.ts";

// The parts every page's metadata is built from: its tags, its share image,
// and descriptions fitted to what search results show (issue #320). It reads
// no registry, so the root layout and lib/table-convert.ts can use it;
// lib/metadata.ts builds the catalog's pages with it.

export const SITE_NAME = "SERP Tools";
// The root layout's title template: a page's own title, then the site.
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;
// Search results show about 160 characters of a description, so each is at
// most DESCRIPTION_MAX and, where its facts allow, at least DESCRIPTION_TARGET.
export const DESCRIPTION_MAX = 160;
export const DESCRIPTION_TARGET = 120;

const HOME_HEADLINE = "Free File Converters, Compressors & Downloaders";
export const HOME_TITLE = `${HOME_HEADLINE} | ${SITE_NAME}`;
export const HOME_DESCRIPTION =
  "Free online file converters, compressors and video downloaders. Most converters run in your browser, with no sign-up and nothing to install.";

// True of every page but a downloader's: the site has no accounts, and its
// Tools run in a web page.
export const FREE: Fact = ["Free, with no sign-up and no software to install.", "Free, with no sign-up."];

type ShareImage = { url: string; width: number; height: number; alt: string };

export function shareImage(name: ShareImageName): ShareImage {
  const image = SHARE_IMAGES[name];
  return {
    url: image.path,
    width: SHARE_IMAGE_WIDTH,
    height: SHARE_IMAGE_HEIGHT,
    alt: `${SITE_NAME}: ${image.title}`,
  };
}

type PageMetadataInput = {
  // The page's own title; the layout's template adds " | SERP Tools".
  title: string;
  description: string;
  canonical?: string;
  image: ShareImageName;
};

export function pageMetadata({ title, description, canonical, image }: PageMetadataInput): Metadata {
  const images = [shareImage(image)];
  return {
    title,
    description,
    alternates: canonical ? { canonical } : undefined,
    openGraph: {
      title,
      description,
      type: "website",
      url: canonical,
      siteName: SITE_NAME,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images,
    },
  };
}

// The text as one sentence or more, ending in punctuation, cut to at most
// `max` characters at a sentence end. A first sentence longer than that is cut
// at a word, with an ellipsis.
export function fitSentences(text: string, max = DESCRIPTION_MAX): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const ended = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  if (ended.length <= max) return ended;

  let kept = "";
  for (const sentence of ended.split(/(?<=[.!?])\s+/)) {
    const next = kept ? `${kept} ${sentence}` : sentence;
    if (next.length > max) break;
    kept = next;
  }
  if (kept) return kept;
  const cut = ended.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:]+$/, "")}…`;
}

// A sentence, or alternatives of which the first that fits is used (none:
// nothing to add).
export type Fact = string | readonly string[];

// The lead, then facts in order while the description is shorter than
// DESCRIPTION_TARGET, skipping any that would take it past `max`.
export function composeDescription(
  lead: string,
  facts: readonly Fact[],
  max = DESCRIPTION_MAX,
): string {
  let description = fitSentences(lead, max);
  for (const fact of facts) {
    if (description.length >= DESCRIPTION_TARGET) break;
    const fits = (typeof fact === "string" ? [fact] : fact)
      .map((sentence) => `${description} ${sentence}`)
      .find((next) => next.length <= max);
    if (fits) description = fits;
  }
  return description;
}

// The homepage. Its canonical and og:url are written by app/page.tsx, as the
// bare origin, so neither is set here.
export function buildHomeMetadata(): Metadata {
  const metadata = pageMetadata({
    title: HOME_HEADLINE,
    description: HOME_DESCRIPTION,
    image: "default",
  });
  return { ...metadata, title: { absolute: HOME_TITLE } };
}

// The root layout's defaults, for a page that sets none of its own: only the
// noindex 404 pages and the internal dashboard do (metadata.test.mjs fails on
// any other). They are neutral, not the homepage's, so such a page never
// copies the homepage's head.
const SITE_DESCRIPTION =
  "Free online file converters, compressors, and utilities for images, audio, and video.";

export function buildSiteMetadata(): Metadata {
  const images = [shareImage("default")];
  return {
    title: { default: SITE_NAME, template: TITLE_TEMPLATE },
    description: SITE_DESCRIPTION,
    openGraph: { type: "website", siteName: SITE_NAME, images },
    twitter: { card: "summary_large_image", images },
  };
}
