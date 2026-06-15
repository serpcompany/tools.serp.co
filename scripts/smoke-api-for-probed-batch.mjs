#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const input = process.argv[2] || 'tmp/adult-downloader-batch-10-results.csv';
const output = process.argv[3] || 'tmp/adult-downloader-batch-10-api-smoke.csv';

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
const rows = parseCsv(fs.readFileSync(input, 'utf8')).filter((r) => r.sample_url && r.status === 'works_with_ytdlp');
const out = [];
for (const row of rows) {
  const body = JSON.stringify({ mode: 'video', url: row.sample_url });
  const result = spawnSync('curl', [
    '-sS', '--max-time', '12',
    '-D', '-', '-o', '/tmp/adult-batch-smoke.bin',
    '-X', 'POST', 'http://localhost:3011/api/media-fetch/',
    '-H', 'content-type: application/json',
    '--data', body,
  ], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
  const headers = result.stdout || '';
  const http = headers.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/g)?.at(-1)?.match(/(\d{3})/)?.[1] || '';
  const contentType = headers.match(/^content-type:\s*(.+)$/im)?.[1]?.trim() || '';
  const mediaExtension = headers.match(/^x-media-extension:\s*(.+)$/im)?.[1]?.trim() || '';
  const fileName = headers.match(/^x-media-filename:\s*(.+)$/im)?.[1]?.trim() || '';
  out.push({
    website: row.website,
    sample_url: row.sample_url,
    http_status: http,
    api_smoke_ok: http === '200' && /video|octet-stream|audio/i.test(contentType) ? 'yes' : 'no',
    content_type: contentType,
    media_extension: mediaExtension,
    filename: fileName,
    curl_exit: result.status ?? '',
    stderr: (result.stderr || '').slice(0, 300),
  });
  console.log(`${row.website}: HTTP ${http || '-'} ${contentType || ''} ${mediaExtension || ''}`);
}
const headers = ['website','sample_url','http_status','api_smoke_ok','content_type','media_extension','filename','curl_exit','stderr'];
fs.writeFileSync(output, `${headers.join(',')}\n${out.map((row) => headers.map((h) => csvEscape(row[h])).join(',')).join('\n')}\n`);
console.log(`Wrote ${output}`);
