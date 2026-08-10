#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const SCRATCH_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;
const SCRATCH_ROOT_NAME = 'tools-serp-scratch';

function resolveScratchRoot() {
  const temporaryRoot = realpathSync(tmpdir());
  const scratchRoot = path.join(temporaryRoot, SCRATCH_ROOT_NAME);
  if (!existsSync(scratchRoot)) {
    mkdirSync(scratchRoot, { mode: 0o700 });
  }
  const status = lstatSync(scratchRoot);
  if (status.isSymbolicLink() || !status.isDirectory()) {
    throw new Error('Owned scratch root must be a real directory');
  }
  const resolvedScratchRoot = realpathSync(scratchRoot);
  if (path.dirname(resolvedScratchRoot) !== temporaryRoot) {
    throw new Error('Owned scratch root resolves outside OS temporary storage');
  }
  return resolvedScratchRoot;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function readOwner(candidateRoot) {
  const ownerPath = path.join(candidateRoot, '.owner.json');
  if (!existsSync(ownerPath) || lstatSync(ownerPath).isSymbolicLink()) {
    return undefined;
  }
  try {
    const owner = JSON.parse(readFileSync(ownerPath, 'utf8'));
    const createdAt = new Date(owner.createdAt);
    if (
      owner.schemaVersion !== 1 ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0 ||
      Number.isNaN(createdAt.valueOf())
    ) {
      return undefined;
    }
    return { pid: owner.pid, createdAt };
  } catch {
    return undefined;
  }
}

function removeAbandonedScratch(scratchRoot, now = new Date()) {
  for (const entry of readdirSync(scratchRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith('run-')) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new Error('Owned scratch root contains a symlinked run');
    }
    if (!entry.isDirectory()) {
      continue;
    }
    const candidateRoot = path.join(scratchRoot, entry.name);
    const candidateStatus = lstatSync(candidateRoot);
    const owner = readOwner(candidateRoot);
    const isAbandoned =
      owner === undefined
        ? now.valueOf() - candidateStatus.mtimeMs >
          SCRATCH_LIFETIME_MILLISECONDS
        : now.valueOf() - owner.createdAt.valueOf() >
            SCRATCH_LIFETIME_MILLISECONDS && !isProcessAlive(owner.pid);
    if (!isAbandoned) {
      continue;
    }
    const resolvedCandidate = realpathSync(candidateRoot);
    if (path.dirname(resolvedCandidate) !== scratchRoot) {
      throw new Error('Owned scratch run resolves outside its root');
    }
    rmSync(candidateRoot, { recursive: true });
  }
}

function parseCommand(arguments_) {
  if (arguments_[0] !== '--' || arguments_.length < 2) {
    throw new Error('Usage: run-with-scratch.mjs -- <command> [args...]');
  }
  return { command: arguments_[1], arguments: arguments_.slice(2) };
}

function main() {
  const command = parseCommand(process.argv.slice(2));
  const scratchRoot = resolveScratchRoot();
  removeAbandonedScratch(scratchRoot);
  const commandScratch = mkdtempSync(path.join(scratchRoot, 'run-'));
  writeFileSync(
    path.join(commandScratch, '.owner.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    })}\n`,
    { mode: 0o600, flag: 'wx' },
  );

  try {
    const result = spawnSync(command.command, command.arguments, {
      cwd: process.cwd(),
      env: { ...process.env, TOOLS_SERP_SCRATCH_DIR: commandScratch },
      stdio: 'inherit',
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(commandScratch, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Scratch command failed'}\n`,
  );
  process.exitCode = 1;
}
