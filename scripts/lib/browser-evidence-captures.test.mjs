import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createBrowserCaptureWorkspace,
  retainBrowserCaptureWorkspace,
} from './browser-evidence-captures.mjs';

test('browser evidence retains owned outputs and screenshots beside its run artifact', async () => {
  const repositoryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'browser-capture-repository.'),
  );
  try {
    const workspace = await createBrowserCaptureWorkspace({});
    assert.equal(workspace.outputDirectory, workspace.screenshotDirectory);
    assert.ok(workspace.ownedDirectory);
    await writeFile(
      path.join(workspace.outputDirectory, 'compress-svg.svg'),
      '<svg/>',
    );
    await retainBrowserCaptureWorkspace(workspace, {
      repositoryRoot,
      runId: 'exact-preview-run',
    });

    assert.equal(
      await readFile(
        path.join(
          repositoryRoot,
          '.artifacts/runs/exact-preview-run/captures/compress-svg.svg',
        ),
        'utf8',
      ),
      '<svg/>',
    );
    await assert.rejects(readFile(workspace.ownedDirectory));
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test('browser evidence leaves caller-owned Golden capture directories in place', async () => {
  const repositoryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'browser-capture-repository.'),
  );
  const callerDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'browser-capture-caller.'),
  );
  try {
    const workspace = await createBrowserCaptureWorkspace({
      outputDirectory: callerDirectory,
      screenshotDirectory: callerDirectory,
    });
    assert.equal(workspace.ownedDirectory, null);
    await writeFile(path.join(callerDirectory, 'caller-owned.txt'), 'kept');
    await retainBrowserCaptureWorkspace(workspace, {
      repositoryRoot,
      runId: 'golden-parent-run',
    });
    assert.equal(
      await readFile(path.join(callerDirectory, 'caller-owned.txt'), 'utf8'),
      'kept',
    );
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
    await rm(callerDirectory, { recursive: true, force: true });
  }
});
