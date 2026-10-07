#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);
const toolIdFilter = args.find((arg) => arg.startsWith("--tool-id="))?.slice("--tool-id=".length);
const failOnUnreachable = args.includes("--fail-on-unreachable");
const timeoutMs = Number(args.find((arg) => arg.startsWith("--timeout-ms="))?.slice("--timeout-ms=".length) ?? 10000);
const concurrency = Number(args.find((arg) => arg.startsWith("--concurrency="))?.slice("--concurrency=".length) ?? 12);

const toolsPath = path.join(root, "apps/tools/lib/catalog/tools.json");
const tools = JSON.parse(await fs.readFile(toolsPath, "utf8"));

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hostnameWithoutWww(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isSourceSiteLink(tool, link) {
  if (tool.operation !== "download") return false;
  const from = normalizeText(tool.from);
  if (!from) return false;
  const label = normalizeText(link.label);
  const host = normalizeText(hostnameWithoutWww(link.url).split(".")[0]);
  return label === from || host === from;
}

function collectToolLinks(tool) {
  const links = [];
  const content = tool.content ?? {};
  const productLinks = content.productLinks ?? {};

  for (const [field, url] of Object.entries(productLinks)) {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      links.push({ toolId: tool.id, route: tool.route, field: `content.productLinks.${field}`, label: field, url, kind: "product" });
    }
  }

  for (const [index, link] of (content.sourceLinks ?? []).entries()) {
    if (typeof link?.url === "string" && /^https?:\/\//i.test(link.url)) {
      const collectedLink = {
        toolId: tool.id,
        route: tool.route,
        field: `content.sourceLinks[${index}].url`,
        label: link.label ?? `sourceLinks[${index}]`,
        url: link.url,
        kind: "source",
        sourceSiteViolation: isSourceSiteLink(tool, link),
      };
      links.push(collectedLink);
    }
  }

  return links;
}

function statusIsBroken(status) {
  return status === 404 || status === 410;
}

function statusNeedsGetFallback(status) {
  return status === 403 || status === 405 || status === 406 || status === 429 || status === 999;
}

async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkUrl(url, redirectCount = 0) {
  if (redirectCount > 8) {
    return { ok: false, kind: "unreachable", status: 0, finalUrl: url, message: "too many redirects" };
  }

  let response;
  try {
    response = await fetchWithTimeout(url, {
      method: "HEAD",
      redirect: "manual",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; SERPLinkValidator/1.0)",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch (error) {
    return { ok: false, kind: "unreachable", status: 0, finalUrl: url, message: error?.message ?? String(error) };
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    response.body?.cancel();
    if (!location) {
      return { ok: false, kind: "unreachable", status: response.status, finalUrl: url, message: "redirect without location" };
    }
    return checkUrl(new URL(location, url).toString(), redirectCount + 1);
  }

  if (statusIsBroken(response.status)) {
    response.body?.cancel();
    return { ok: false, kind: "broken", status: response.status, finalUrl: url, message: `HTTP ${response.status}` };
  }

  if (statusNeedsGetFallback(response.status)) {
    response.body?.cancel();
    try {
      const getResponse = await fetchWithTimeout(url, {
        method: "GET",
        redirect: "manual",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; SERPLinkValidator/1.0)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          range: "bytes=0-0",
        },
      });
      if ([301, 302, 303, 307, 308].includes(getResponse.status)) {
        const location = getResponse.headers.get("location");
        getResponse.body?.cancel();
        if (!location) {
          return { ok: false, kind: "unreachable", status: getResponse.status, finalUrl: url, message: "GET redirect without location" };
        }
        return checkUrl(new URL(location, url).toString(), redirectCount + 1);
      }
      const result = statusIsBroken(getResponse.status)
        ? { ok: false, kind: "broken", status: getResponse.status, finalUrl: url, message: `HTTP ${getResponse.status}` }
        : { ok: true, kind: "ok", status: getResponse.status, finalUrl: getResponse.url || url, message: "" };
      getResponse.body?.cancel();
      return result;
    } catch (error) {
      return { ok: false, kind: "unreachable", status: response.status, finalUrl: url, message: error?.message ?? String(error) };
    }
  }

  response.body?.cancel();
  return { ok: true, kind: "ok", status: response.status, finalUrl: response.url || url, message: "" };
}

const allLinks = tools
  .filter((tool) => !toolIdFilter || tool.id === toolIdFilter)
  .flatMap(collectToolLinks);

const sourceSiteViolations = allLinks.filter((link) => link.sourceSiteViolation);

const urlToRefs = new Map();
for (const link of allLinks) {
  const refs = urlToRefs.get(link.url) ?? [];
  refs.push(link);
  urlToRefs.set(link.url, refs);
}

const urls = [...urlToRefs.keys()].sort();
const results = new Map();
let cursor = 0;

async function worker() {
  while (cursor < urls.length) {
    const index = cursor;
    cursor += 1;
    const url = urls[index];
    results.set(url, await checkUrl(url));
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

const broken = [];
const unreachable = [];
for (const [url, result] of results.entries()) {
  if (result.kind === "broken") broken.push({ url, result, refs: urlToRefs.get(url) ?? [] });
  if (result.kind === "unreachable") unreachable.push({ url, result, refs: urlToRefs.get(url) ?? [] });
}

function printFailure(groupName, entries) {
  if (!entries.length) return;
  console.error(`${groupName}:`);
  for (const entry of entries) {
    console.error(`- ${entry.url} -> ${entry.result.message}`);
    for (const ref of entry.refs.slice(0, 8)) {
      console.error(`  ${ref.toolId} ${ref.route ?? ""} ${ref.field}`);
    }
    if (entry.refs.length > 8) console.error(`  ... ${entry.refs.length - 8} more references`);
  }
}

function printSourceSiteViolations(entries) {
  if (!entries.length) return;
  console.error("Source-site official links are not allowed:");
  for (const link of entries) {
    console.error(`- ${link.toolId} ${link.route ?? ""} ${link.field}: ${link.label} -> ${link.url}`);
  }
}

if (sourceSiteViolations.length || broken.length || (failOnUnreachable && unreachable.length)) {
  console.error("Lander outbound link validation failed.");
  printSourceSiteViolations(sourceSiteViolations);
  printFailure("Broken 404/410 links", broken);
  if (failOnUnreachable) printFailure("Unreachable links", unreachable);
  if (!failOnUnreachable && unreachable.length) {
    console.error(`Unreachable/non-404 links warned only: ${unreachable.length}`);
  }
  process.exit(1);
}

if (unreachable.length) {
  console.warn(`Lander outbound link validation warnings: ${unreachable.length} unreachable/non-404 URLs.`);
}
console.log(`Lander outbound link validation passed: ${urls.length} unique URLs checked, ${allLinks.length} references, ${broken.length} broken, ${sourceSiteViolations.length} source-site official links.`);
