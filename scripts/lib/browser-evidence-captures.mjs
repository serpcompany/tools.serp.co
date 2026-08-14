import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function createBrowserCaptureWorkspace(options) {
  if (options.outputDirectory && options.screenshotDirectory) {
    return Object.freeze({
      outputDirectory: options.outputDirectory,
      screenshotDirectory: options.screenshotDirectory,
      ownedDirectory: null,
    });
  }
  const ownedDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'tools-serp-browser-captures.'),
  );
  return Object.freeze({
    outputDirectory: options.outputDirectory ?? ownedDirectory,
    screenshotDirectory: options.screenshotDirectory ?? ownedDirectory,
    ownedDirectory,
  });
}

export async function retainBrowserCaptureWorkspace(
  workspace,
  { repositoryRoot, runId },
) {
  if (!workspace.ownedDirectory) return;
  const destination = path.join(
    repositoryRoot,
    '.artifacts',
    'runs',
    runId,
    'captures',
  );
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(workspace.ownedDirectory, destination, { recursive: true });
  await rm(workspace.ownedDirectory, { recursive: true, force: true });
}

export async function discardBrowserCaptureWorkspace(workspace) {
  if (!workspace.ownedDirectory) return;
  await rm(workspace.ownedDirectory, { recursive: true, force: true });
}
