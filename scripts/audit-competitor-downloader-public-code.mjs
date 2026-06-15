#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const competitors = [
  'badassdownloader.com',
  'downloadtube.net',
  'faceb.com',
  'fetchfile.me',
  'jaksta.com',
  'jdownloader.org',
  'locoloader.com',
  'pastedownload.com',
  'pornsaver.net',
  'pptube.org',
  'saveporn.net',
  'savesubs.com',
  'savethevideo.com',
  'savido.net',
  'tubeninja.net',
  'tubeoffline.com',
  'vidquickly.com',
  'yesdownloader.com',
  'yt2save.com',
];

const candidatePaths = [
  '/',
  '/tube8/',
  '/tube8',
  '/download-tube8-videos/',
  '/download-videos-from-tube8/',
  '/download-Tube8-videos.php',
  '/download-from-tube8/',
  '/download/',
  '/online-video-downloader/',
  '/video-downloader/',
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const outDir = 'tmp/competitor-code-audit';
fs.mkdirSync(outDir, { recursive: true });

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/javascript,text/javascript,*/*' },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, finalUrl: res.url, contentType: res.headers.get('content-type') || '', text, error: '' };
  } catch (error) {
    return { ok: false, status: 0, finalUrl: url, contentType: '', text: '', error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}
function absUrl(href, base) {
  try { return new URL(href, base).toString(); } catch { return ''; }
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
function snippetAround(text, needle, radius = 180) {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(needle.toLowerCase());
  if (idx < 0) return '';
  return text.slice(Math.max(0, idx - radius), Math.min(text.length, idx + needle.length + radius)).replace(/\s+/g, ' ').trim();
}
function scanText(text, baseUrl) {
  const scripts = uniq([...text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => absUrl(m[1], baseUrl)));
  const forms = [...text.matchAll(/<form[\s\S]*?>/gi)].map(m => m[0]);
  const formActions = uniq(forms.map(f => {
    const action = f.match(/action=["']([^"']*)["']/i)?.[1] || '';
    return action ? absUrl(action, baseUrl) : baseUrl;
  }));
  const urls = uniq([
    ...[...text.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)].map(m => m[0].replace(/[),.;]+$/, '')),
    ...[...text.matchAll(/(?:fetch|axios|\$\.ajax|XMLHttpRequest|open)\s*\(?\s*["']([^"']+)["']/gi)].map(m => absUrl(m[1], baseUrl)),
    ...[...text.matchAll(/url\s*:\s*["']([^"']+)["']/gi)].map(m => absUrl(m[1], baseUrl)),
  ]);
  const interestingWords = [
    'yt-dlp','youtube-dl','youtubedl','youtube_dl','ffmpeg','gallery-dl','cobalt','cobalt.tools','api.cobalt','dirpy','get-info','downloadFrom','download/file','download/status','csrf','token','rapidapi','apify','phantomjs','puppeteer','playwright','selenium','extractor','sources','videoUrl','mediaDefinition','m3u8','mp4','blob','download_video','getVideo','getLink','convert','record',
  ];
  const clues = [];
  for (const word of interestingWords) {
    if (text.toLowerCase().includes(word.toLowerCase())) clues.push({ word, snippet: snippetAround(text, word) });
  }
  return { scripts, formActions, urls, clues };
}
function classify(findings) {
  const allText = JSON.stringify(findings).toLowerCase();
  const notes = [];
  if (allText.includes('dirpy.com')) notes.push('uses/links Dirpy fallback');
  if (allText.includes('yt-dlp') || allText.includes('youtube-dl') || allText.includes('youtubedl')) notes.push('public code mentions yt-dlp/youtube-dl');
  if (allText.includes('ffmpeg')) notes.push('public code mentions ffmpeg');
  if (allText.includes('get-info') || allText.includes('badasserver')) notes.push('BadAss-style get-info API exposed');
  if (allText.includes('downloadfrom.php')) notes.push('TubeOffline-style downloadFrom.php flow exposed');
  if (allText.includes('api.fetchfile.me')) notes.push('FetchFile API exposed');
  if (allText.includes('jdownloader')) notes.push('JDownloader app/service, not simple web extractor');
  if (allText.includes('jaksta')) notes.push('Jaksta app/product, likely desktop downloader');
  if (!notes.length) notes.push('no obvious public extractor/tool clue');
  return notes;
}

const results = [];
for (const domain of competitors) {
  console.log(`Auditing ${domain}`);
  const pageFindings = [];
  const scriptUrls = new Set();
  for (const p of candidatePaths) {
    const url = `https://${domain}${p}`;
    const page = await fetchText(url);
    if (!page.text || ![200,301,302,403,404,410].includes(page.status)) continue;
    const scan = scanText(page.text, page.finalUrl);
    for (const s of scan.scripts) {
      if (hostOf(s) === hostOf(page.finalUrl) || /badass|download|tube|fetch|save|savi|locoloader|pastedownload|pornsaver|yt2save|vidquickly|tubeninja/i.test(s)) scriptUrls.add(s);
    }
    pageFindings.push({ url, status: page.status, finalUrl: page.finalUrl, contentType: page.contentType, title: (page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim(), ...scan, textLen: page.text.length });
  }
  const scriptFindings = [];
  for (const s of [...scriptUrls].slice(0, 25)) {
    const js = await fetchText(s, 12000);
    if (!js.text || js.status >= 500) continue;
    const scan = scanText(js.text, s);
    scriptFindings.push({ url: s, status: js.status, contentType: js.contentType, finalUrl: js.finalUrl, ...scan, textLen: js.text.length });
  }
  const result = { domain, pages: pageFindings, scripts: scriptFindings };
  result.classification = classify(result);
  results.push(result);
}

fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(results, null, 2));

const md = [];
md.push('# Competitor public-code downloader audit');
md.push('');
md.push('Scope: public HTML and same-origin/public JS only. This identifies exposed endpoints/protocols/tools, not hidden server code.');
for (const r of results) {
  md.push(`\n## ${r.domain}`);
  md.push(`Classification: ${r.classification.join('; ')}`);
  const pages200 = r.pages.filter(p => p.status === 200).slice(0, 5).map(p => `- ${p.finalUrl} — ${p.title || p.contentType}`).join('\n');
  if (pages200) md.push(`\nPages inspected:\n${pages200}`);
  const formActions = uniq(r.pages.flatMap(p => p.formActions)).slice(0, 10);
  if (formActions.length) md.push(`\nForm actions:\n${formActions.map(x => `- ${x}`).join('\n')}`);
  const endpoints = uniq([...r.pages, ...r.scripts].flatMap(p => p.urls))
    .filter(u => /api|download|get-info|fetch|convert|studio|dirpy|badasserver|downloadFrom|media|ajax|json/i.test(u))
    .slice(0, 20);
  if (endpoints.length) md.push(`\nInteresting URLs/endpoints:\n${endpoints.map(x => `- ${x}`).join('\n')}`);
  const clues = [...r.pages, ...r.scripts].flatMap(p => p.clues.map(c => ({...c, source: p.finalUrl || p.url}))).slice(0, 12);
  if (clues.length) {
    md.push('\nCode clues:');
    for (const c of clues) md.push(`- ${c.word} @ ${c.source}: ${c.snippet}`);
  }
}
fs.writeFileSync(path.join(outDir, 'report.md'), md.join('\n') + '\n');
console.log(`Wrote ${path.join(outDir, 'report.md')}`);
