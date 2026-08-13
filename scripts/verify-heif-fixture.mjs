import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = path.join(
  repositoryRoot,
  'apps/tools/benchmarks/fixtures/sample-2.png',
);
const fixturePath = path.join(
  repositoryRoot,
  'apps/tools/benchmarks/fixtures/sample.heif',
);
const expected = Object.freeze({
  sourceSha256:
    '7121c88e12c0381ba2bfd80713d4965c0362fe439b779bd38fc94cfc0391c999',
  fixtureSha256:
    '62952c9045e9abc24f1710c8bf516f8cccf7c19fcfdb09c6f0e3c601b808a183',
  encoderVersion: '1.20.2',
  encoderSha256:
    'accb5e98e51bcbf75cf74d9e9d149f3da5481a34e7dcc397697e03eb064a938a',
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function requireHash(label, actual, wanted) {
  if (actual !== wanted) {
    throw new Error(`${label} SHA-256 ${actual} does not match ${wanted}.`);
  }
}

const encoderPath = execFileSync('which', ['heif-enc'], {
  encoding: 'utf8',
}).trim();
const encoderVersion = execFileSync(encoderPath, ['--version'], {
  encoding: 'utf8',
})
  .trim()
  .split(/\r?\n/, 1)[0];
if (encoderVersion !== expected.encoderVersion) {
  throw new Error(
    `heif-enc ${encoderVersion} does not match ${expected.encoderVersion}.`,
  );
}
requireHash(
  'heif-enc',
  sha256(readFileSync(encoderPath)),
  expected.encoderSha256,
);
requireHash(
  'source fixture',
  sha256(readFileSync(sourcePath)),
  expected.sourceSha256,
);

const workspace = mkdtempSync(path.join(tmpdir(), 'tools-serp-heif-fixture-'));
try {
  const regeneratedPath = path.join(workspace, 'sample.heif');
  execFileSync(encoderPath, [sourcePath, '-q', '90', '-o', regeneratedPath], {
    stdio: 'pipe',
  });
  const regenerated = readFileSync(regeneratedPath);
  requireHash(
    'regenerated fixture',
    sha256(regenerated),
    expected.fixtureSha256,
  );
  requireHash(
    'checked-in fixture',
    sha256(readFileSync(fixturePath)),
    expected.fixtureSha256,
  );
  process.stdout.write(
    `HEIF fixture reproduced exactly: sha256:${expected.fixtureSha256}\n`,
  );
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
