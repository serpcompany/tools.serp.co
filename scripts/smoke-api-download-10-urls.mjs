#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const input = process.argv[2] || 'tmp/adult-downloader-sample-urls-offset-0-limit-25.csv';
const output = process.argv[3] || 'tmp/adult-downloader-10-url-api-download-smoke.csv';
const limit = Number(process.argv[4] || 10);

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

const rows = parseCsv(fs.readFileSync(input, 'utf8')).filter((r) => r.sample_url).slice(0, limit);
const out = [];
for (const [index, row] of rows.entries()) {
  const body = JSON.stringify({ mode: 'video', url: row.sample_url });
  const binPath = `/tmp/adult-download-smoke-${index}.bin`;
  try { fs.unlinkSync(binPath); } catch {}
  const result = spawnSync('curl', [
    '-sS', '--max-time', '25',
    '-D', '-', '-o', binPath,
    '-X', 'POST', 'http://localhost:3011/api/media-fetch/',
    '-H', 'content-type: application/json',
    '--data', body,
  ], { encoding: 'utf8', timeout: 35000, maxBuffer: 1024 * 1024 });
  const headers = result.stdout || '';
  const http = headers.match(/HTTP\/\d(?:\.\d)?\s+(\d+)/g)?.at(-1)?.match(/(\d{3})/)?.[1] || '';
  const contentType = headers.match(/^content-type:\s*(.+)$/im)?.[1]?.trim() || '';
  const mediaExtension = headers.match(/^x-media-extension:\s*(.+)$/im)?.[1]?.trim() || '';
  const fileName = headers.match(/^x-media-filename:\s*(.+)$/im)?.[1]?.trim() || '';
  const bytes = fs.existsSync(binPath) ? fs.statSync(binPath).size : 0;
  const started = http === '200' && bytes > 0 && /video|octet-stream|audio/i.test(contentType);
  out.push({
    website: row.website,
    sample_url: row.sample_url,
    http_status: http,
    download_started: started ? 'yes' : 'no',
    bytes_saved: bytes,
    content_type: contentType,
    media_extension: mediaExtension,
    filename: fileName,
    curl_exit: result.status ?? '',
    stderr: (result.stderr || '').slice(0, 500),
  });
  console.log(`${index + 1}/${rows.length} ${row.website}: HTTP ${http || '-'} bytes=${bytes} started=${started ? 'yes' : 'no'} ${mediaExtension || ''}`);
}
const headers = ['website','sample_url','http_status','download_started','bytes_saved','content_type','media_extension','filename','curl_exit','stderr'];
fs.writeFileSync(output, `${headers.join(',')}\n${out.map((row) => headers.map((h) => csvEscape(row[h])).join(',')).join('\n')}\n`);
console.log(`Wrote ${output}`);
console.log(`Downloaded/started: ${out.filter((row) => row.download_started === 'yes').length}/${out.length}`);
