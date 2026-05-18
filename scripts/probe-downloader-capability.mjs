#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const defaultInput = path.join(repo, 'tmp/adult-downloader-sample-urls.csv');
const csvOutput = path.join(repo, 'tmp/adult-downloader-capability-results.csv');
const jsonOutput = path.join(repo, 'tmp/adult-downloader-capability-results.json');
const wave0 = new Set(['tube8.com','porntube.com','hellporno.com','thumbzilla.com','xtube.com','alphaporno.com','slutload.com','sunporno.com','pornhd.com','porn300.com']);
const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg.startsWith('--')) {
    args.set(arg, process.argv[index + 1]?.startsWith('--') ? true : (process.argv[index + 1] ?? true));
    if (process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) index += 1;
  }
}
const inputPath = String(args.get('--input') || defaultInput);
const limit = args.has('--limit') ? Number(args.get('--limit')) : 0;
const wave = args.get('--wave');
const top = args.has('--top') ? Number(args.get('--top')) : 0;

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.filter(Boolean).map((line) => {
    const values = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (quoted) {
        if (char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
        else if (char === '"') quoted = false;
        else value += char;
      } else if (char === ',') { values.push(value); value = ''; }
      else if (char === '"') quoted = true;
      else value += char;
    }
    values.push(value);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}
function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
function statusForHttp(status, html) {
  if ([403,404,410].includes(status)) return 'blocked_or_dead';
  if (/cf-chl|cloudflare|captcha|verify you are human/i.test(html)) return 'blocked_or_dead';
  return 'manual_review';
}
async function fetchText(url, referer) {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', accept: 'text/html,application/xhtml+xml,application/json,*/*', ...(referer ? { referer } : {}) }, redirect: 'follow' });
  const text = await response.text();
  return { response, text };
}
async function headCandidate(url, referer) {
  const response = await fetch(url, { method: 'HEAD', headers: { 'user-agent': 'Mozilla/5.0', accept: '*/*', ...(referer ? { referer } : {}) }, redirect: 'follow' });
  return { ok: response.ok, contentType: response.headers.get('content-type') ?? '', contentLength: response.headers.get('content-length') ?? '', finalUrl: response.url };
}
function parseMediaDefinition(html) {
  const match = html.match(/mediaDefinition\s*:\s*(\[.*?\])\s*,\s*(?:image_url|video_title)/s) || html.match(/mediaDefinition\s*:\s*(\[\{.*?videoUrl.*?\}\])/s);
  if (!match) return [];
  try { return JSON.parse(match[1]); } catch { return []; }
}
async function probeTube8(row) {
  const { response, text } = await fetchText(row.sample_url);
  if (!response.ok) return { ...row, status: statusForHttp(response.status, text), extractor: '', candidates_found: 0, best_candidate_url: '', best_candidate_type: '', content_length: '', error: `HTTP ${response.status}`, notes: 'Tube8 page fetch failed.' };
  const mediaDefinitions = parseMediaDefinition(text);
  const mp4 = mediaDefinitions.find((item) => item?.format === 'mp4' && item?.videoUrl);
  const hls = mediaDefinitions.find((item) => item?.format === 'hls' && item?.videoUrl);
  for (const item of [mp4, hls].filter(Boolean)) {
    const endpoint = await fetchText(item.videoUrl, row.sample_url);
    let variants = [];
    try { variants = JSON.parse(endpoint.text); } catch {}
    const candidates = variants.filter((variant) => variant?.videoUrl);
    if (candidates.length) {
      const sorted = candidates.sort((a,b) => Number(b.quality || 0) - Number(a.quality || 0));
      const best = sorted[0];
      const head = await headCandidate(best.videoUrl, row.sample_url);
      return { ...row, status: 'works_with_simple_html_json_extractor', extractor: 'tube8-media-definition', candidates_found: candidates.length, best_candidate_url: best.videoUrl, best_candidate_type: `${best.quality || ''}p ${best.format || item.format}`, content_length: head.contentLength, error: '', notes: `Found ${candidates.length} ${item.format} variants; HEAD ${head.ok ? 'ok' : 'failed'} ${head.contentType}` };
    }
  }
  return { ...row, status: 'needs_custom_extractor', extractor: 'tube8-media-definition', candidates_found: 0, best_candidate_url: '', best_candidate_type: '', content_length: '', error: '', notes: 'mediaDefinition found but no usable variants.' };
}
function probeYtdlp(row) {
  const result = spawnSync('yt-dlp', ['--dump-json', '--skip-download', '--no-warnings', row.sample_url], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 });
  if (result.status === 0 && result.stdout.trim()) {
    try {
      const info = JSON.parse(result.stdout.split('\n').filter(Boolean).at(-1));
      const formats = Array.isArray(info.formats) ? info.formats.length : 0;
      if (formats > 0) return { status: 'works_with_ytdlp', extractor: 'yt-dlp', candidates_found: formats, best_candidate_type: info.ext || '', notes: `yt-dlp extractor ${info.extractor || 'unknown'} returned ${formats} formats.` };
    } catch {}
  }
  return null;
}
async function probe(row) {
  if (!row.sample_url) return { ...row, status: 'manual_review', extractor: '', candidates_found: 0, best_candidate_url: '', best_candidate_type: '', content_length: '', error: '', notes: 'No verified sample URL available yet.' };
  try {
    const host = new URL(row.sample_url).hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'tube8.com') return await probeTube8(row);
    const ytdlp = probeYtdlp(row);
    if (ytdlp) return { ...row, ...ytdlp, best_candidate_url: '', content_length: '', error: '' };
    return { ...row, status: 'needs_custom_extractor', extractor: '', candidates_found: 0, best_candidate_url: '', best_candidate_type: '', content_length: '', error: '', notes: 'yt-dlp did not return formats; no generic public media parser matched yet.' };
  } catch (error) {
    return { ...row, status: 'manual_review', extractor: '', candidates_found: 0, best_candidate_url: '', best_candidate_type: '', content_length: '', error: error instanceof Error ? error.message : String(error), notes: 'Probe threw an exception.' };
  }
}

let rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));
if (wave === 'wave0') rows = rows.filter((row) => wave0.has(row.website));
if (top) rows = rows.slice(0, top);
if (limit) rows = rows.slice(0, limit);
const results = [];
for (const row of rows) {
  console.log(`Probing ${row.website} ${row.sample_url || '(no sample)'}`);
  results.push(await probe(row));
}
fs.mkdirSync(path.dirname(csvOutput), { recursive: true });
const headers = ['route','website','sample_url','status','extractor','candidates_found','best_candidate_url','best_candidate_type','content_length','error','notes'];
fs.writeFileSync(csvOutput, `${headers.join(',')}\n${results.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`);
fs.writeFileSync(jsonOutput, `${JSON.stringify(results, null, 2)}\n`);
console.log(`Wrote ${results.length} rows to ${csvOutput}`);
