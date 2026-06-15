#!/usr/bin/env node
import fs from 'node:fs';

const targetUrl = process.argv[2] || 'https://www.tube8.com/porn-video/193214781/';
const outPath = 'tmp/competitor-adapter-smoke-results.csv';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: options.redirect || 'follow',
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/json,*/*',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    return { response, text, error: '' };
  } catch (error) {
    return { response: null, text: '', error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function classifyHtml(text) {
  const lower = text.toLowerCase();
  const directMedia = (text.match(/https?:[^"'<>\s]+\.(?:mp4|m3u8)(?:\?[^"'<>\s]*)?/gi) || []).slice(0, 3);
  const dirpy = (text.match(/https?:\/\/dirpy\.com\/studio\?[^"'<>\s]+/gi) || []).slice(0, 3);
  const downloadLinks = (text.match(/https?:[^"'<>\s]+(?:download|get|media)[^"'<>\s]*/gi) || []).slice(0, 5);
  if (directMedia.length) return { status: 'candidate_direct_media', evidence: directMedia.join(' | ') };
  if (dirpy.length) return { status: 'external_fallback_dirpy', evidence: dirpy.join(' | ') };
  if (/video \(mp4\)|download options|quality|720p|1080p/.test(lower)) return { status: 'ui_quality_options_no_direct_media', evidence: text.match(/.{0,40}(?:720p|1080p|Video \(mp4\)|Download).{0,80}/i)?.[0] || 'quality/download UI text' };
  if (/captcha|cloudflare|verify you are human|access denied|forbidden/.test(lower)) return { status: 'blocked_or_challenge', evidence: text.match(/.{0,40}(?:captcha|cloudflare|access denied|forbidden).{0,80}/i)?.[0] || 'blocked/challenge text' };
  return { status: 'no_usable_signal', evidence: downloadLinks.join(' | ') || text.slice(0, 160).replace(/\s+/g, ' ') };
}

async function probeBadass() {
  const rows = [];
  for (const server of ['https://srv.badasserver.com', 'https://srv.badasserver1.com']) {
    const body = new URLSearchParams({ info: JSON.stringify({ url: encodeURIComponent(targetUrl), domain: 'tube8.com' }) });
    const { response, text, error } = await fetchText(`${server}/get-info`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://m.badassdownloader.com', referer: 'https://m.badassdownloader.com/' },
      timeoutMs: 25000,
    });
    let status = 'failed';
    let evidence = error || `HTTP ${response?.status}`;
    try {
      const json = JSON.parse(text);
      if (json?.success && json?.sources) {
        const sourceText = JSON.stringify(json.sources).slice(0, 500);
        status = /src/.test(sourceText) ? 'candidate_competitor_api_sources' : 'api_success_no_sources';
        evidence = sourceText;
      } else {
        status = 'api_error';
        evidence = JSON.stringify(json).slice(0, 500);
      }
    } catch {
      evidence = `${evidence} ${text.slice(0, 240).replace(/\s+/g, ' ')}`.trim();
    }
    rows.push({ competitor: `badass:${server}`, endpoint: `${server}/get-info`, status, http_status: response?.status || '', evidence });
  }
  return rows;
}

async function probeDownloadTube() {
  const body = new URLSearchParams({ url: targetUrl });
  const { response, text, error } = await fetchText('https://www.downloadtube.net/download/', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://www.downloadtube.net', referer: 'https://www.downloadtube.net/download-videos-from-tube8/' },
  });
  const c = error ? { status: 'failed', evidence: error } : classifyHtml(text);
  return [{ competitor: 'downloadtube', endpoint: 'https://www.downloadtube.net/download/', status: c.status, http_status: response?.status || '', evidence: c.evidence }];
}

async function probeTubeOffline() {
  const url = `https://www.tubeoffline.com/downloadFrom.php?host=Tube8&video=${encodeURIComponent(targetUrl)}`;
  const { response, text, error } = await fetchText(url, { headers: { referer: 'https://www.tubeoffline.com/download-Tube8-videos.php' } });
  const c = error ? { status: 'failed', evidence: error } : classifyHtml(text);
  return [{ competitor: 'tubeoffline', endpoint: url, status: c.status, http_status: response?.status || '', evidence: c.evidence }];
}

async function probeFetchFile() {
  const body = new URLSearchParams({ url: targetUrl });
  const { response, text, error } = await fetchText('https://api.fetchfile.me/fetch', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://fetchfile.me', referer: 'https://fetchfile.me/' },
  });
  let status = 'failed';
  let evidence = error || text.slice(0, 500);
  try {
    const json = JSON.parse(text);
    status = json?.status === 'success' ? 'candidate_competitor_api_result' : 'api_error';
    evidence = JSON.stringify(json).slice(0, 500);
  } catch {}
  return [{ competitor: 'fetchfile', endpoint: 'https://api.fetchfile.me/fetch', status, http_status: response?.status || '', evidence }];
}

async function probeDirpy() {
  const url = `https://dirpy.com/studio?url=${encodeURIComponent(targetUrl)}&affid=adapter-smoke`;
  const { response, text, error } = await fetchText(url, { timeoutMs: 25000 });
  const c = error ? { status: 'failed', evidence: error } : classifyHtml(text);
  return [{ competitor: 'dirpy-direct', endpoint: url, status: c.status, http_status: response?.status || '', evidence: c.evidence }];
}

const all = [
  ...(await probeBadass()),
  ...(await probeDownloadTube()),
  ...(await probeTubeOffline()),
  ...(await probeFetchFile()),
  ...(await probeDirpy()),
];

fs.mkdirSync('tmp', { recursive: true });
const headers = ['competitor', 'endpoint', 'http_status', 'status', 'evidence'];
fs.writeFileSync(outPath, `${headers.join(',')}\n${all.map((row) => headers.map((h) => csvEscape(row[h])).join(',')).join('\n')}\n`);
for (const row of all) {
  console.log(`${row.competitor}: HTTP ${row.http_status || '-'} ${row.status} — ${row.evidence.slice(0, 180).replace(/\s+/g, ' ')}`);
}
console.log(`Wrote ${outPath}`);
