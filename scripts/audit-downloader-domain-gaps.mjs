#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const foo = '/Users/devin/dev/repos/foo';
const toolsPath = path.join(repo, 'packages/app-core/src/data/tools.json');
const byCompetitorPath = path.join(foo, 'distinct_verified_domains_by_competitor_site.csv');
const adultPath = path.join(foo, 'adult_site_domains.csv');
const combinedPath = path.join(foo, 'combined_sitemap_urls.csv');
const outDir = path.join(repo, 'docs/audits');
fs.mkdirSync(outDir, { recursive: true });

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() || [];
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function writeCsv(file, rows, headers) {
  const text = [headers.join(','), ...rows.map((row) => headers.map((h) => csvEscape(row[h] ?? '')).join(','))].join('\n') + '\n';
  fs.writeFileSync(file, text);
}

function domainBase(domain) {
  const d = String(domain || '').toLowerCase().replace(/^www\./, '').trim();
  const parts = d.split('.').filter(Boolean);
  if (parts.length >= 3 && ['co', 'com', 'net', 'org'].includes(parts.at(-2)) && parts.at(-1).length === 2) return parts.at(-3);
  return parts[0] || '';
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\.com$/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function displayName(domain) {
  const base = domainBase(domain);
  const special = new Map([
    ['xnxx', 'XNXX'], ['xvideos', 'XVideos'], ['xhamster', 'xHamster'], ['youtube', 'YouTube'], ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['twitter', 'Twitter'], ['vimeo', 'Vimeo'], ['dailymotion', 'Dailymotion'], ['pornhub', 'Pornhub'], ['redgifs', 'RedGifs'], ['javtiful', 'Javtiful'], ['eporner', 'EPorner'], ['spankbang', 'SpankBang']
  ]);
  if (special.has(base)) return special.get(base);
  return base.split('-').filter(Boolean).map((p) => p ? p[0].toUpperCase() + p.slice(1) : '').join(' ');
}

const tools = JSON.parse(fs.readFileSync(toolsPath, 'utf8'));
const downloadTools = tools.filter((t) => t.operation === 'download' && t.isActive !== false);
const existingKeys = new Map();
const existingRoutes = new Map();
for (const t of downloadTools) {
  const tokens = new Set();
  for (const source of [t.id, t.route, t.name, t.from, ...(t.tags || [])]) {
    const raw = String(source || '').toLowerCase();
    if (!raw) continue;
    tokens.add(slugify(raw));
    tokens.add(slugify(raw.replace(/^download-/, '').replace(/-videos$/, '').replace(/-video-downloader$/, '').replace(/-downloader$/, '')));
  }
  // Manual aliases for existing pages whose page name differs from a site domain.
  if (t.id === 'download-twitter-x-videos') { tokens.add('twitter'); tokens.add('x'); }
  if (t.id === 'download-cams-com-videos') { tokens.add('cams'); }
  if (t.id === 'download-circle-videos') { tokens.add('circle'); }
  if (t.id === 'video-downloader') { tokens.add('generic-video-downloader'); }
  for (const token of tokens) {
    if (!token) continue;
    existingKeys.set(token, t);
  }
  existingRoutes.set(t.route, t);
}

const byCompetitor = parseCsv(fs.readFileSync(byCompetitorPath, 'utf8'));
const adultRows = parseCsv(fs.readFileSync(adultPath, 'utf8'));
const combined = parseCsv(fs.readFileSync(combinedPath, 'utf8'));
const adultDomains = new Map(adultRows.map((r) => [r.domain, r]));

const aggregate = new Map();
for (const r of byCompetitor) {
  const domain = r.domain;
  if (!domain) continue;
  if (!aggregate.has(domain)) aggregate.set(domain, { domain, competitors: new Map(), urlCount: 0 });
  const item = aggregate.get(domain);
  item.competitors.set(r.competitor_site, Number(r.url_count || 0));
  item.urlCount += Number(r.url_count || 0);
}

const samples = new Map();
for (const r of combined) {
  const domain = r.site_url_is_about;
  if (!domain || !aggregate.has(domain)) continue;
  if (!samples.has(domain)) samples.set(domain, []);
  const list = samples.get(domain);
  if (list.length < 8 && r.url && !list.includes(r.url)) list.push(r.url);
}

const rows = [];
for (const item of aggregate.values()) {
  const base = slugify(domainBase(item.domain));
  const exactRoute = `/download-${base}-videos`;
  const existing = existingRoutes.get(exactRoute) || existingKeys.get(base) || existingKeys.get(item.domain.replace(/\./g, '-')) || null;
  const adult = adultDomains.get(item.domain);
  const competitors = [...item.competitors.entries()].sort((a,b)=>b[1]-a[1]);
  const competitorSites = competitors.map(([site]) => site).join('|');
  const topCompetitor = competitors[0]?.[0] || '';
  const competitorCount = competitors.length;
  const recommendedRoute = exactRoute;
  const name = displayName(item.domain);
  const sampleUrls = samples.get(item.domain) || [];
  const contentAngle = adult
    ? `${name} adult video downloader page; emphasize public videos, privacy, HD/MP4 formats, no popups, browser extension CTA, and legal/adult disclaimer.`
    : `${name} video downloader page; emphasize public links, supported formats, troubleshooting, extension CTA, and no-login/no-private-content limits.`;
  rows.push({
    domain: item.domain,
    base_slug: base,
    status: existing ? 'existing' : 'missing',
    existing_tool_id: existing?.id || '',
    existing_route: existing?.route || '',
    recommended_tool_id: `download-${base}-videos`,
    recommended_route: recommendedRoute,
    recommended_name: `${name} Video Downloader`,
    is_adult: adult ? 'true' : 'false',
    competitor_count: competitorCount,
    total_competitor_url_count: item.urlCount,
    top_competitor: topCompetitor,
    competitor_sites: competitorSites,
    content_angle: contentAngle,
    sample_competitor_urls: sampleUrls.join('|'),
  });
}

rows.sort((a,b) => {
  if (a.status !== b.status) return a.status === 'missing' ? -1 : 1;
  if (a.is_adult !== b.is_adult) return a.is_adult === 'true' ? -1 : 1;
  return Number(b.competitor_count) - Number(a.competitor_count) || Number(b.total_competitor_url_count) - Number(a.total_competitor_url_count) || a.domain.localeCompare(b.domain);
});

const headers = ['domain','base_slug','status','existing_tool_id','existing_route','recommended_tool_id','recommended_route','recommended_name','is_adult','competitor_count','total_competitor_url_count','top_competitor','competitor_sites','content_angle','sample_competitor_urls'];
const allPath = path.join(outDir, 'tools-serp-downloader-domain-gap-audit.csv');
writeCsv(allPath, rows, headers);
writeCsv(path.join(outDir, 'tools-serp-missing-downloader-pages.csv'), rows.filter((r) => r.status === 'missing'), headers);
writeCsv(path.join(outDir, 'tools-serp-missing-adult-downloader-pages.csv'), rows.filter((r) => r.status === 'missing' && r.is_adult === 'true'), headers);
writeCsv(path.join(outDir, 'tools-serp-existing-downloader-competitor-content-gaps.csv'), rows.filter((r) => r.status === 'existing'), headers);

const missing = rows.filter((r) => r.status === 'missing');
const existing = rows.filter((r) => r.status === 'existing');
const missingAdult = missing.filter((r) => r.is_adult === 'true');
const missingMainstream = missing.filter((r) => r.is_adult !== 'true');
const topMissing = missing.slice(0, 50);
const topAdult = missingAdult.slice(0, 50);
const topExistingGaps = existing.sort((a,b)=>Number(b.competitor_count)-Number(a.competitor_count)||Number(b.total_competitor_url_count)-Number(a.total_competitor_url_count)).slice(0,50);
const summary = `# tools.serp.co Downloader Page Gap Audit\n\nGenerated from verified competitor sitemap/domain research. This is an audit only; it did not add tools or publish pages.\n\n## Inputs\n\n- Existing registry: \`packages/app-core/src/data/tools.json\`\n- Competitor/domain data: \`/Users/devin/dev/repos/foo/distinct_verified_domains_by_competitor_site.csv\`\n- Adult labels: \`/Users/devin/dev/repos/foo/adult_site_domains.csv\`\n- Competitor sample URLs: \`/Users/devin/dev/repos/foo/combined_sitemap_urls.csv\`\n\n## Counts\n\n- Existing active downloader tools in tools.serp.co: ${downloadTools.length}\n- Verified competitor target domains audited: ${rows.length}\n- Domains already covered by an active downloader page: ${existing.length}\n- Missing downloader pages: ${missing.length}\n- Missing adult downloader pages: ${missingAdult.length}\n- Missing mainstream/unknown downloader pages: ${missingMainstream.length}\n\n## Output files\n\n- \`docs/audits/tools-serp-downloader-domain-gap-audit.csv\` — all verified domains with existing/missing status.\n- \`docs/audits/tools-serp-missing-downloader-pages.csv\` — missing pages only.\n- \`docs/audits/tools-serp-missing-adult-downloader-pages.csv\` — missing adult pages only.\n- \`docs/audits/tools-serp-existing-downloader-competitor-content-gaps.csv\` — already-covered domains with competitor examples to skyscraper content.\n\n## Highest-priority missing pages\n\n| domain | route | adult | competitors | competitor URLs | top competitor |\n|---|---:|---:|---:|---:|---|\n${topMissing.map(r => `| ${r.domain} | ${r.recommended_route} | ${r.is_adult} | ${r.competitor_count} | ${r.total_competitor_url_count} | ${r.top_competitor} |`).join('\n')}\n\n## Highest-priority missing adult pages\n\n| domain | route | competitors | competitor URLs | top competitor |\n|---|---:|---:|---:|---|\n${topAdult.map(r => `| ${r.domain} | ${r.recommended_route} | ${r.competitor_count} | ${r.total_competitor_url_count} | ${r.top_competitor} |`).join('\n')}\n\n## Existing pages with competitor content to skyscraper\n\nThese pages already exist, but competitor pages provide extra content angles/sample URLs to expand copy, FAQs, troubleshooting, supported URL examples, and related links.\n\n| domain | existing route | competitors | competitor URLs | top competitor |\n|---|---|---:|---:|---|\n${topExistingGaps.map(r => `| ${r.domain} | ${r.existing_route} | ${r.competitor_count} | ${r.total_competitor_url_count} | ${r.top_competitor} |`).join('\n')}\n\n## Recommended next implementation path\n\n1. Start with \`docs/audits/tools-serp-missing-adult-downloader-pages.csv\` if the goal is adult downloader SEO expansion.\n2. Add new registry-backed downloader landers in \`packages/app-core/src/data/tools.json\`; use \`operation: "download"\`, \`handler: "custom"\` or the existing downloader shared renderer pattern, and \`route: /download-{base}-videos\`.\n3. Update \`docs/planner/tools_planner.csv\` in the same batch.\n4. Reuse \`DownloaderPageTemplate\` and the existing browser extension CTA/cooldown path.\n5. For existing pages, use \`tools-serp-existing-downloader-competitor-content-gaps.csv\` to enrich \`content.infoArticle\`, FAQs, keyword lists, supported examples, and related tools.\n6. Run \`pnpm -C apps/tools typecheck\`, \`pnpm lint\`, and route smoke checks before publishing.\n\n## Notes\n\n- Matching is based on active downloader registry entries and normalized target-domain base slugs. Review collisions before bulk-applying changes.\n- The audit uses only verified \`site_url_is_about\` domains; blank/unverified guesses were excluded.\n- Competitor URLs are examples for page coverage/content angles, not copy sources. Write original content.\n`;
fs.writeFileSync(path.join(outDir, 'tools-serp-downloader-domain-gap-audit.md'), summary);

console.log(JSON.stringify({
  downloadTools: downloadTools.length,
  auditedDomains: rows.length,
  existing: existing.length,
  missing: missing.length,
  missingAdult: missingAdult.length,
  missingMainstream: missingMainstream.length,
  outputs: [
    allPath,
    path.join(outDir, 'tools-serp-missing-downloader-pages.csv'),
    path.join(outDir, 'tools-serp-missing-adult-downloader-pages.csv'),
    path.join(outDir, 'tools-serp-existing-downloader-competitor-content-gaps.csv'),
    path.join(outDir, 'tools-serp-downloader-domain-gap-audit.md'),
  ]
}, null, 2));
