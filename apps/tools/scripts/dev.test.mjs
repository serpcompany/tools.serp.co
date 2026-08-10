import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const devScript = fileURLToPath(new URL('./dev.mjs', import.meta.url));

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function createFakeNext(testContext) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'tools-serp-dev-'));
  const capturePath = path.join(fixtureRoot, 'arguments.json');
  const nextPath = path.join(fixtureRoot, 'next');
  writeFileSync(
    nextPath,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'fs.writeFileSync(process.env.NEXT_ARGUMENT_CAPTURE, JSON.stringify(process.argv.slice(2)));',
      '',
    ].join('\n'),
  );
  chmodSync(nextPath, 0o755);
  testContext.after(() =>
    rmSync(fixtureRoot, { recursive: true, force: true }),
  );
  return { fixtureRoot, capturePath };
}

function runDev(fakeNext, arguments_) {
  return spawnSync(process.execPath, [devScript, ...arguments_], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // Test-only executable isolation; production commands inherit their normal PATH.
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      PATH: `${fakeNext.fixtureRoot}${path.delimiter}${process.env.PATH}`,
      NEXT_ARGUMENT_CAPTURE: fakeNext.capturePath,
    },
  });
}

test('local development forwards supported Next.js arguments', async (t) => {
  const fakeNext = createFakeNext(t);
  const port = await availablePort();

  const result = runDev(fakeNext, [
    '--port',
    String(port),
    '--hostname',
    '127.0.0.1',
    '--disable-source-maps',
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(fakeNext.capturePath, 'utf8')), [
    'dev',
    '--hostname',
    '127.0.0.1',
    '--disable-source-maps',
    '--port',
    String(port),
  ]);
});

for (const unsupportedArgument of [
  '--turbopack',
  '--turbo',
  '--experimental-upload-trace',
]) {
  test(`local development rejects ${unsupportedArgument}`, (t) => {
    const fakeNext = createFakeNext(t);

    const result = runDev(fakeNext, [unsupportedArgument]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported local development argument/i);
  });
}
