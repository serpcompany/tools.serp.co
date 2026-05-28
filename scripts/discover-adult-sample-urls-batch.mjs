#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith('--')) {
    args.set(arg, process.argv[index + 1]?.startsWith('--') ? true : (process.argv[index + 1] ?? true));
    if (process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) index += 1;
  }
}
const offset = Number(args.get('--offset') || 0);
const limit = Number(args.get('--limit') || 10);
const inputPath = path.join(repo, 'tmp/missing-adult-downloader-routes.csv');
const outputPath = String(args.get('--output') || path.join(repo, `tmp/adult-downloader-sample-urls-offset-${offset}-limit-${limit}.csv`));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.filter(Boolean).map((line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
        else if (c === '"') quoted = false;
        else value += c;
      } else if (c === ',') { values.push(value); value = ''; }
      else if (c === '"') quoted = true;
      else value += c;
    }
    values.push(value);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });
}
function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*' },
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, url: response.url, text, contentType: response.headers.get('content-type') || '', error: '' };
  } catch (error) {
    return { ok: false, status: 0, url, text: '', contentType: '', error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
function absUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return ''; }
}
function normalizeHost(host) { return host.replace(/^www\./, '').toLowerCase(); }
function isSameDomain(url, domain) {
  try { return normalizeHost(new URL(url).hostname) === normalizeHost(domain); } catch { return false; }
}
function isLikelyVideoUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  const p = decodeURIComponent(u.pathname).toLowerCase();
  if (/[;<>]/.test(p) || /text\/html|charset=|undefined|null|width=device|initial-scale|minimum-scale|maximum-scale|ie=edge|chrome=1|rta-5042/.test(p)) return false;
  if (/\.(jpg|jpeg|png|gif|webp|svg|css|js|ico|xml|txt|json|mp4|m3u8|ts|mp3|zip|rar|pdf)$/i.test(p)) return false;
  if (/\/(category|categories|tag|tags|search|pornstar|stars|models|channels|users?|members?|login|signup|register|privacy|terms|dmca|contact|blog|forum|photos?|galleries)\b/i.test(p)) return false;
  const positive = [
    /\/video\//i, /\/videos\//i, /\/watch\//i, /\/view\//i, /\/movie\//i, /\/embed\//i,
    /\/v\//i, /\/clip\//i, /\/porn-video\//i, /\bvideo[-_]?\d+/i, /\d{5,}/,
  ];
  return positive.some((rx) => rx.test(p));
}
function scoreVideoUrl(url) {
  const p = new URL(url).pathname.toLowerCase();
  let score = 0;
  if (/\/video\//.test(p)) score += 25;
  if (/\/videos\//.test(p)) score += 20;
  if (/\/watch\//.test(p)) score += 20;
  if (/\/view\//.test(p)) score += 12;
  if (/\/embed\//.test(p)) score -= 5;
  if (/\d{6,}/.test(p)) score += 10;
  score += Math.min(20, p.split('/').filter(Boolean).length * 2);
  return score;
}
function extractLocs(xml) {
  return [...xml.matchAll(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => m[1].trim().replaceAll('&amp;', '&'));
}
function extractLinks(html, base) {
  const urls = new Set();
  for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const u = absUrl(m[1], base);
    if (u) urls.add(u);
  }
  return [...urls];
}
async function discover(row) {
  const domain = row.website;
  const bases = [`https://www.${domain}`, `https://${domain}`];
  const sitemapSeeds = new Set();
  const candidateUrls = new Map();
  const notes = [];

  // robots.txt sitemap discovery
  for (const base of bases) {
    const robots = await fetchText(`${base}/robots.txt`, 9000);
    if (robots.ok || robots.text) {
      notes.push(`robots ${new URL(base).hostname} ${robots.status}`);
      for (const m of robots.text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) sitemapSeeds.add(m[1].trim());
    }
  }
  for (const base of bases) {
    for (const path of ['/sitemap.xml','/sitemap_index.xml','/sitemap-video.xml','/video-sitemap.xml','/sitemap-videos.xml']) {
      sitemapSeeds.add(`${base}${path}`);
    }
  }

  const seenSitemaps = new Set();
  const sitemapQueue = [...sitemapSeeds];
  while (sitemapQueue.length && seenSitemaps.size < 18 && candidateUrls.size < 30) {
    const sitemap = sitemapQueue.shift();
    if (!sitemap || seenSitemaps.has(sitemap)) continue;
    seenSitemaps.add(sitemap);
    const res = await fetchText(sitemap, 10000);
    if (!res.text) continue;
    notes.push(`sitemap ${sitemap} ${res.status}`);
    for (const loc of extractLocs(res.text).slice(0, 2000)) {
      if (/sitemap/i.test(loc) && seenSitemaps.size + sitemapQueue.length < 30) sitemapQueue.push(loc);
      if (isSameDomain(loc, domain) && isLikelyVideoUrl(loc)) candidateUrls.set(loc, `sitemap:${sitemap}`);
    }
  }

  // Home/listing crawl fallback: homepage + likely listing pages, shallow only.
  for (const base of bases) {
    for (const page of ['', '/', '/videos', '/videos/', '/latest', '/latest/', '/new', '/new/', '/popular', '/popular/']) {
      if (candidateUrls.size >= 30) break;
      const url = `${base}${page}`;
      const res = await fetchText(url, 10000);
      if (!res.text) continue;
      notes.push(`page ${url} ${res.status}`);
      for (const link of extractLinks(res.text, res.url).slice(0, 500)) {
        if (isSameDomain(link, domain) && isLikelyVideoUrl(link)) candidateUrls.set(link, `internal:${url}`);
      }
    }
    if (candidateUrls.size) break;
  }

  const sorted = [...candidateUrls.entries()]
    .sort((a, b) => scoreVideoUrl(b[0]) - scoreVideoUrl(a[0]));
  const [sampleUrl, source] = sorted[0] || ['', ''];
  return {
    route: row.route,
    website: domain,
    sample_url: sampleUrl || '',
    source: source || '',
    confidence: sampleUrl ? String(Math.max(1, scoreVideoUrl(sampleUrl))) : '0',
    notes: sampleUrl ? `selected from ${sorted.length} candidates; ${notes.slice(0, 8).join(' | ')}` : `no sample found; ${notes.slice(0, 8).join(' | ')}`,
  };
}

const rows = parseCsv(fs.readFileSync(inputPath, 'utf8')).slice(offset, offset + limit);
const results = [];
for (const row of rows) {
  console.log(`Discovering ${row.website}...`);
  results.push(await discover(row));
}
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const headers = ['route','website','sample_url','source','confidence','notes'];
fs.writeFileSync(outputPath, `${headers.join(',')}\n${results.map((row) => headers.map((h) => csvEscape(row[h])).join(',')).join('\n')}\n`);
console.log(`Wrote ${results.length} rows to ${outputPath}`);
console.log(`Found samples: ${results.filter((r) => r.sample_url).length}/${results.length}`);
