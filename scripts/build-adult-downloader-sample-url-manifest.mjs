#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const inputPath = path.join(repo, 'tmp/missing-adult-downloader-routes.csv');
const outputPath = path.join(repo, 'tmp/adult-downloader-sample-urls.csv');

const manualSamples = new Map([
  ['tube8.com', 'https://www.tube8.com/porn-video/193214781/'],
]);

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.filter(Boolean).map((line) => {
    const parts = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, parts[index] ?? '']));
  });
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

if (!fs.existsSync(inputPath)) {
  throw new Error(`Missing ${inputPath}. Run the adult gap audit first.`);
}

const rows = parseCsv(fs.readFileSync(inputPath, 'utf8'));
const output = rows.map((row) => {
  const website = row.website.trim().toLowerCase();
  const sampleUrl = manualSamples.get(website) ?? '';
  return {
    route: row.route.trim(),
    website,
    sample_url: sampleUrl,
    source: sampleUrl ? 'manual_canary_verified' : '',
    confidence: sampleUrl ? 'high' : '',
    notes: sampleUrl ? 'Seeded canary sample used to validate custom extractor flow.' : 'No verified sample URL yet.',
  };
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const headers = ['route', 'website', 'sample_url', 'source', 'confidence', 'notes'];
fs.writeFileSync(
  outputPath,
  `${headers.join(',')}\n${output.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`,
);

const seeded = output.filter((row) => row.sample_url).length;
console.log(`Wrote ${output.length} rows to ${outputPath}`);
console.log(`Seeded sample URLs: ${seeded}`);
