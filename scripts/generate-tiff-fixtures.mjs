import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'apps/tools/package.json'));
const { writeArrayBuffer } = require('geotiff');
const fixtureDirectory = path.join(root, 'apps/tools/benchmarks/fixtures/tiff');
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'serp-tiff-'));
mkdirSync(fixtureDirectory, { recursive: true });

function pixels(samplesPerPixel) {
  const values = new Uint8Array(16 * 16 * samplesPerPixel);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const offset = (y * 16 + x) * samplesPerPixel;
      const channels = [x * 16, y * 16, (x + y) * 8, 64 + ((x + y) % 4) * 48];
      values.set(channels.slice(0, samplesPerPixel), offset);
    }
  }
  return values;
}

function writeBase(name, samplesPerPixel, metadata) {
  const output = path.join(temporaryDirectory, name);
  writeFileSync(
    output,
    new Uint8Array(
      writeArrayBuffer(pixels(samplesPerPixel), {
        width: 16,
        height: 16,
        SamplesPerPixel: samplesPerPixel,
        BitsPerSample: Array(samplesPerPixel).fill(8),
        SampleFormat: Array(samplesPerPixel).fill(1),
        PlanarConfiguration: 1,
        ...metadata,
      }),
    ),
  );
  return output;
}

function tiffcp(input, outputName, args) {
  const inputs = Array.isArray(input) ? input : [input];
  const result = spawnSync(
    'tiffcp',
    ['-m', '64', ...args, ...inputs, path.join(fixtureDirectory, outputName)],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `tiffcp failed for ${outputName}`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`);
  }
}

try {
  const rgb = writeBase('rgb.tiff', 3, { PhotometricInterpretation: 2 });
  const grayscale = writeBase('grayscale.tiff', 1, {
    PhotometricInterpretation: 1,
  });
  const alpha = writeBase('alpha.tiff', 4, {
    PhotometricInterpretation: 2,
    ExtraSamples: [2],
  });
  const palette = path.join(temporaryDirectory, 'palette.tiff');
  run('magick', [
    '-size',
    '256x1',
    'gradient:#0000ff-#ff0000',
    '-colors',
    '256',
    '-depth',
    '8',
    '-define',
    'tiff:bits-per-sample=8',
    '-type',
    'Palette',
    `TIFF:${palette}`,
  ]);

  tiffcp(rgb, 'rgb-little-stripped-none.tiff', ['-L', '-s', '-c', 'none']);
  tiffcp(rgb, 'rgb-big-tiled-lzw.tiff', [
    '-B',
    '-t',
    '-w',
    '16',
    '-l',
    '16',
    '-c',
    'lzw',
  ]);
  tiffcp(grayscale, 'grayscale-little-stripped-deflate.tiff', [
    '-L',
    '-s',
    '-c',
    'zip',
  ]);
  tiffcp(alpha, 'rgba-big-stripped-none.tiff', ['-B', '-s', '-c', 'none']);
  tiffcp(palette, 'palette-little-stripped-lzw.tiff', [
    '-L',
    '-s',
    '-c',
    'lzw',
  ]);
  tiffcp([rgb, grayscale], 'negative-multipage.tiff', ['-L', '-s']);
  tiffcp(rgb, 'negative-bigtiff.tiff', ['-8', '-L', '-s']);
  writeFileSync(
    path.join(fixtureDirectory, 'negative-higher-depth.tiff'),
    new Uint8Array(
      writeArrayBuffer(new Uint16Array(16 * 16).fill(1_024), {
        width: 16,
        height: 16,
        SamplesPerPixel: 1,
        BitsPerSample: [16],
        SampleFormat: [1],
        PhotometricInterpretation: 1,
        PlanarConfiguration: 1,
      }),
    ),
  );
  const truncated = new Uint8Array(
    writeArrayBuffer(pixels(3), {
      width: 16,
      height: 16,
      SamplesPerPixel: 3,
      BitsPerSample: [8, 8, 8],
      SampleFormat: [1, 1, 1],
      PhotometricInterpretation: 2,
      PlanarConfiguration: 1,
    }),
  ).slice(0, 32);
  writeFileSync(
    path.join(fixtureDirectory, 'negative-truncated-ifd.tiff'),
    truncated,
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
