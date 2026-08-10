#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCatalogSyncMode } from "./lib/catalog-sync-mode.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.resolve(
  __dirname,
  "../packages/app-core/src/data/extensions.json",
);
const inputAuthority = "exact Chrome Web Store URLs in extensions.json";
const ownedOutput = "packages/app-core/src/data/extensions.json";

const CHROME_HOSTS = new Set([
  "chromewebstore.google.com",
  "chrome.google.com",
]);

function decodeEscapedUrl(value) {
  return value
    .replace(/\\u002F/g, "/")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/")
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&amp;/g, "&");
}

function extractIcon(html) {
  const srcsetMatch = html.match(
    /srcset=["'](https:\/\/lh3\.googleusercontent\.com\/[^"'\s]*=s120[^"'\s]*)/i,
  );
  if (srcsetMatch) {
    return decodeEscapedUrl(srcsetMatch[1]);
  }

  const directMatch = html.match(
    /https:\/\/lh3\.googleusercontent\.com\/[^"']*s120[^"']*/i,
  );
  if (directMatch) {
    return decodeEscapedUrl(directMatch[0]);
  }

  return undefined;
}

function extractScreenshots(html) {
  const results = new Set();
  const scriptRegex = /_setImgSrc\('[^']+','([^']+)'\)/g;
  let scriptMatch;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const decoded = decodeEscapedUrl(scriptMatch[1]);
    if (decoded.includes("lh3.googleusercontent.com")) {
      results.add(decoded);
    }
  }

  if (results.size === 0) {
    const dataAttrRegex =
      /data-media-url=["'](https:\/\/lh3\.googleusercontent\.com[^"']+)["']/g;
    let attrMatch;
    while ((attrMatch = dataAttrRegex.exec(html)) !== null) {
      const decoded = decodeEscapedUrl(attrMatch[1]);
      if (decoded.includes("lh3.googleusercontent.com")) {
        results.add(decoded);
      }
    }
  }

  return Array.from(results)
    .filter((url) => Boolean(url) && /(?:s|w)1280/.test(url))
    .slice(0, 5);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "SerpTemplates/1.0 (+https://serptemplates.com)",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    const error = new Error(
      `Failed to fetch Chrome Web Store entry: ${response.status} ${response.statusText}`,
    );
    error.status = response.status;
    throw error;
  }

  return response.text();
}

function shouldUpdateExtension(extension) {
  if (!extension.chromeStoreUrl) return false;
  try {
    const host = new URL(extension.chromeStoreUrl).hostname;
    return CHROME_HOSTS.has(host);
  } catch {
    return false;
  }
}

export async function updateExtensions({
  dataPath = DATA_PATH,
  write = false,
  fetchStoreHtml = fetchHtml,
} = {}) {
  const original = await readFile(dataPath, "utf8");
  const extensions = JSON.parse(original);

  let updated = false;
  let unreachable = 0;
  let confirmedRemovals = 0;
  const proposedChanges = [];
  for (const extension of extensions) {
    if (!shouldUpdateExtension(extension)) continue;

    try {
      const html = await fetchStoreHtml(extension.chromeStoreUrl);
      const icon = extractIcon(html);
      const screenshots = extractScreenshots(html);
      if (!icon && screenshots.length === 0) {
        throw new Error("Chrome Web Store response was not recognizable");
      }

      if (icon && extension.icon !== icon) {
        extension.icon = icon;
        updated = true;
        proposedChanges.push(`${extension.slug}: icon`);
      }

      if (screenshots.length > 0) {
        if (
          JSON.stringify(extension.screenshots ?? []) !==
          JSON.stringify(screenshots)
        ) {
          extension.screenshots = screenshots;
          updated = true;
          proposedChanges.push(`${extension.slug}: screenshots`);
        }
      }
    } catch (error) {
      if (new Set([404, 410]).has(error?.status)) {
        confirmedRemovals += 1;
        console.error(
          `Confirmed store removal for ${extension.slug}; retained existing catalog data for human review.`,
        );
      } else {
        unreachable += 1;
        console.error(
          `Transient external unreachability for ${extension.slug}; retained existing catalog data:`,
          error.message,
        );
      }
    }
  }

  console.log(`Input authority: ${inputAuthority}`);
  console.log(`Owned output: ${ownedOutput}`);
  console.log(
    `Proposed diff: ${proposedChanges.length ? proposedChanges.join(", ") : "no changes"}`,
  );
  console.log(
    `External unreachable: ${unreachable}; confirmed removals: ${confirmedRemovals}`,
  );
  if (write && updated) {
    await writeFile(
      dataPath,
      `${JSON.stringify(extensions, null, 2)}\n`,
      "utf8",
    );
    console.log(
      "Updated extensions.json with reviewed Chrome Web Store assets.",
    );
  } else {
    console.log(
      write ? "No changes needed." : "Check mode: repository unchanged.",
    );
  }
  return { changed: updated, proposedChanges, unreachable, confirmedRemovals };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseCatalogSyncMode(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Extension sync arguments are invalid",
    );
    process.exit(1);
  }
  updateExtensions(options).catch((error) => {
    console.error("Unexpected error:", error);
    process.exitCode = 1;
  });
}
