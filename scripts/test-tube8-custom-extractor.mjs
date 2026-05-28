#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const result = spawnSync('node', ['scripts/probe-downloader-capability.mjs', '--limit', '1'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  timeout: 120000,
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const csv = fs.readFileSync('tmp/adult-downloader-capability-results.csv', 'utf8').trim().split(/\r?\n/);
const headers = csv[0].split(',');
const values = csv[1].match(/("(?:""|[^"])*"|[^,]*)/g).filter((_, index) => index % 2 === 0).map((value) => value.replace(/^"|"$/g, '').replaceAll('""', '"'));
const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));

if (row.website !== 'tube8.com') throw new Error(`Expected tube8.com, got ${row.website}`);
if (row.status !== 'works_with_simple_html_json_extractor') throw new Error(`Expected Tube8 extractor candidate, got ${row.status}`);
if (row.extractor !== 'tube8-media-definition') throw new Error(`Expected tube8-media-definition, got ${row.extractor}`);
if (!row.best_candidate_url.includes('.mp4') && !row.best_candidate_url.includes('.m3u8')) {
  throw new Error('Expected MP4 or HLS candidate URL.');
}
if (!Number(row.content_length)) throw new Error('Expected non-zero content_length from HEAD check.');
console.log('Tube8 probe regression passed.');
