#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArguments(arguments_) {
  const [operation, ...tokens] = arguments_;
  const options = {};
  const repeatableOptions = new Set([
    'input-hash',
    'linked-work',
    'tool-evidence',
  ]);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const name = token.slice(2);
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) {
      options[name] = true;
    } else {
      if (repeatableOptions.has(name)) {
        options[name] = [...(options[name] ?? []), value];
      } else {
        options[name] = value;
      }
      index += 1;
    }
  }

  return { operation, options };
}

const RETENTION_DAYS = Object.freeze({
  'local-debug': 7,
  'retained-debug': 14,
  'pull-request': 14,
  scheduled: 30,
  main: 30,
  migration: 7,
});

const DEFAULT_RETENTION_CLASS = Object.freeze({
  local: 'local-debug',
  'pull-request': 'pull-request',
  scheduled: 'scheduled',
  main: 'main',
  migration: 'migration',
});

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function parseTimestamp(value, optionName) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error(`--${optionName} must be a valid timestamp`);
  }
  return timestamp;
}

function assertSafeSlug(value, optionName) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`--${optionName} must be a lowercase slug`);
  }
}

function parseToolEvidence(values) {
  const tools = values.map((value) => {
    let tool;
    try {
      tool = JSON.parse(value);
    } catch {
      throw new Error('--tool-evidence must be valid JSON');
    }
    if (
      tool === null ||
      typeof tool !== 'object' ||
      Array.isArray(tool) ||
      Object.keys(tool).some(
        (key) =>
          key !== 'toolId' && key !== 'invariants' && key !== 'warnings',
      ) ||
      !Array.isArray(tool.invariants) ||
      (tool.warnings !== undefined && !Array.isArray(tool.warnings))
    ) {
      throw new Error(
        '--tool-evidence must contain only toolId, invariants, and optional warnings arrays',
      );
    }
    assertSafeSlug(tool.toolId, 'tool-evidence toolId');
    for (const invariant of tool.invariants) {
      assertSafeSlug(invariant, 'tool-evidence invariant');
    }
    if (new Set(tool.invariants).size !== tool.invariants.length) {
      throw new Error('--tool-evidence invariants must be unique');
    }
    const warnings = tool.warnings ?? [];
    for (const warning of warnings) {
      assertSafeSlug(warning, 'tool-evidence warning');
    }
    if (new Set(warnings).size !== warnings.length) {
      throw new Error('--tool-evidence warnings must be unique');
    }
    return {
      toolId: tool.toolId,
      invariants: tool.invariants,
      ...(tool.warnings !== undefined ? { warnings } : {}),
    };
  });
  if (new Set(tools.map((tool) => tool.toolId)).size !== tools.length) {
    throw new Error('--tool-evidence Tool ids must be unique');
  }
  return tools;
}

function redactReport(report) {
  const safeLine =
    /^(?:status=(?:success|failure|cancelled)|(?:checks-passed|checks-failed|items|bytes|duration-ms|samples|min-ms|p50-ms|p95-ms|max-ms)=\d+)$/;

  return `${report
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => {
      if (safeLine.test(line)) {
        return line;
      }
      if (/production[_ -]?row|raw[_ -]?(?:row|record)/i.test(line)) {
        return '[production-row-redacted]';
      }
      if (/authorization|\bbearer\s+/i.test(line)) {
        return '[authorization-redacted]';
      }
      if (
        /password|passwd|token|secret|api[_ -]?key|database_url|postgres(?:ql)?:|mysql:|environment[_ -]?export|private[_ -]?key/i.test(
          line,
        )
      ) {
        return '[credential-redacted]';
      }
      if (/https?:\/\/|x-amz-|signature\s*=|[?&][^\s=]+=/i.test(line)) {
        return '[url-redacted]';
      }
      if (
        /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)|\b(?:source|file(?:name)?|input[_-]?file|output[_-]?file)\s*[:=]|\b[\w.-]+\.(?:csv|json|jsonl|sql|sqlite|db|env|pem|key|log|txt|xml|ya?ml)\b/i.test(
          line,
        )
      ) {
        return '[sensitive-filename-redacted]';
      }
      if (
        /\b(?:email|user[_-]?id|customer[_-]?id|account[_-]?id|phone|ip[_-]?address)\s*[:=]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(
          line,
        )
      ) {
        return '[personal-identifier-redacted]';
      }
      return '[unstructured-value-redacted]';
    })
    .join('\n')}\n`;
}

function resolveArtifactRoot(repositoryRootOption, { create = false } = {}) {
  if (typeof repositoryRootOption !== 'string') {
    throw new Error('--repository-root is required');
  }
  const repositoryRoot = realpathSync(path.resolve(repositoryRootOption));
  const artifactsDirectory = path.join(repositoryRoot, '.artifacts');
  const artifactRoot = path.join(artifactsDirectory, 'runs');

  for (const directory of [artifactsDirectory, artifactRoot]) {
    if (!existsSync(directory)) {
      if (!create) {
        return undefined;
      }
      mkdirSync(directory, { mode: 0o700 });
    }
    const status = lstatSync(directory);
    if (status.isSymbolicLink()) {
      throw new Error('Artifact root must not be a symlink');
    }
    if (!status.isDirectory()) {
      throw new Error('Artifact root must be a directory');
    }
  }

  const resolvedArtifactRoot = realpathSync(artifactRoot);
  const relativeArtifactRoot = path.relative(
    repositoryRoot,
    resolvedArtifactRoot,
  );
  if (
    relativeArtifactRoot.startsWith(`..${path.sep}`) ||
    relativeArtifactRoot === '..' ||
    path.isAbsolute(relativeArtifactRoot)
  ) {
    throw new Error('Artifact root resolves outside repository');
  }
  return artifactRoot;
}

function directorySize(directory) {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => {
      const entryPath = path.join(directory, entry.name);
      const entryStatus = lstatSync(entryPath);
      if (entryStatus.isSymbolicLink()) {
        throw new Error(`Refusing symlink in artifact run: ${entry.name}`);
      }
      return (
        total +
        (entryStatus.isDirectory()
          ? directorySize(entryPath)
          : entryStatus.size)
      );
    },
    0,
  );
}

function cleanup(options) {
  const artifactRoot = resolveArtifactRoot(options['repository-root']);
  if (artifactRoot === undefined) {
    process.stdout.write('dry-run: 0 artifacts, 0 bytes\n');
    return;
  }
  const now = new Date(options.now ?? Date.now());
  if (Number.isNaN(now.valueOf())) {
    throw new Error('--now must be a valid timestamp');
  }
  const olderThanDays =
    options['older-than-days'] === undefined
      ? undefined
      : Number(options['older-than-days']);
  if (
    olderThanDays !== undefined &&
    (!Number.isFinite(olderThanDays) || olderThanDays < 0)
  ) {
    throw new Error('--older-than-days must be a non-negative number');
  }
  const ageCutoff =
    olderThanDays === undefined
      ? undefined
      : new Date(now.valueOf() - olderThanDays * 24 * 60 * 60 * 1000);

  const artifactEntries = readdirSync(artifactRoot, { withFileTypes: true });
  if (artifactEntries.some((entry) => entry.isSymbolicLink())) {
    throw new Error('Refusing symlinked run entry in artifact root');
  }
  const candidates = artifactEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const runRoot = path.join(artifactRoot, entry.name);
      const bytes = directorySize(runRoot);
      const manifest = JSON.parse(
        readFileSync(path.join(runRoot, 'manifest.json'), 'utf8'),
      );
      return { name: entry.name, runRoot, manifest, bytes };
    })
    .filter(({ manifest }) =>
      ageCutoff === undefined
        ? new Date(manifest.expiresAt) <= now
        : new Date(manifest.timestamps.completedAt) <= ageCutoff,
    )
    .filter(
      ({ manifest }) =>
        options.command === undefined ||
        manifest.command.name === options.command,
    );

  const apply = options.apply === true;
  for (const candidate of candidates) {
    if (apply) {
      rmSync(candidate.runRoot, { recursive: true });
    }
    const action = apply ? 'deleted' : 'would-delete';
    process.stdout.write(
      `${action} ${candidate.name} ${candidate.bytes} bytes\n`,
    );
  }

  const totalBytes = candidates.reduce(
    (total, candidate) => total + candidate.bytes,
    0,
  );
  const noun = candidates.length === 1 ? 'artifact' : 'artifacts';
  const mode = apply ? 'applied' : 'dry-run';
  process.stdout.write(
    `${mode}: ${candidates.length} ${noun}, ${totalBytes} bytes\n`,
  );
}

function create(options) {
  const artifactRoot = resolveArtifactRoot(options['repository-root'], {
    create: true,
  });
  const commandName = requireOption(options, 'command');
  if (!/^[a-z0-9][a-z0-9:-]*$/.test(commandName)) {
    throw new Error('--command contains unsupported characters');
  }
  const commandVersion = requireOption(options, 'command-version');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(commandVersion)) {
    throw new Error('--command-version contains unsupported characters');
  }
  const revision = requireOption(options, 'revision');
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('--revision must be the full 40-character Git commit');
  }
  const environment = requireOption(options, 'environment');
  const defaultRetentionClass = DEFAULT_RETENTION_CLASS[environment];
  if (defaultRetentionClass === undefined) {
    throw new Error(`Unsupported environment class: ${environment}`);
  }
  const scope = requireOption(options, 'scope');
  assertSafeSlug(scope, 'scope');
  const status = requireOption(options, 'status');
  if (!new Set(['success', 'failure', 'cancelled']).has(status)) {
    throw new Error(`Unsupported result status: ${status}`);
  }
  const classification = requireOption(options, 'classification');
  if (!new Set(['public', 'internal']).has(classification)) {
    throw new Error(
      'Credential-bearing and restricted material must never be retained as artifacts',
    );
  }
  const startedAt = parseTimestamp(
    requireOption(options, 'started-at'),
    'started-at',
  );
  const completedAt = parseTimestamp(
    requireOption(options, 'completed-at'),
    'completed-at',
  );
  if (completedAt < startedAt) {
    throw new Error('--completed-at must not precede --started-at');
  }
  const retentionClass = options['retention-class'] ?? defaultRetentionClass;
  if (!(retentionClass in RETENTION_DAYS)) {
    throw new Error(`Unsupported retention class: ${retentionClass}`);
  }
  if (
    retentionClass !== defaultRetentionClass &&
    !(environment === 'local' && retentionClass === 'retained-debug')
  ) {
    throw new Error(
      `Retention class ${retentionClass} is not valid for ${environment}`,
    );
  }
  const inputHashes = options['input-hash'] ?? [];
  for (const inputHash of inputHashes) {
    if (!/^sha256:[a-f0-9]{64}$/.test(inputHash)) {
      throw new Error('--input-hash must contain only a SHA-256 digest');
    }
  }
  const linkedWork = options['linked-work'] ?? [];
  for (const workReference of linkedWork) {
    if (!/^#\d+$/.test(workReference)) {
      throw new Error(
        '--linked-work must be a GitHub issue reference like #57',
      );
    }
  }
  const tools = parseToolEvidence(options['tool-evidence'] ?? []);

  const compactTimestamp = startedAt
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace(/\.\d{3}Z$/, 'Z');
  const runId = `${compactTimestamp}_${revision.slice(0, 7)}_${environment}_${scope}`;
  const runRoot = path.join(artifactRoot, runId);
  mkdirSync(runRoot, { mode: 0o700 });
  const packageManifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const pnpmVersion = packageManifest.packageManager.replace(/^pnpm@/, '');
  const expiresAt = new Date(
    completedAt.valueOf() +
      RETENTION_DAYS[retentionClass] * 24 * 60 * 60 * 1000,
  );
  const manifest = {
    schemaVersion: 1,
    runId,
    command: { name: commandName, version: commandVersion },
    revision: { commit: revision, dirty: options.dirty === true },
    timestamps: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    },
    environment,
    scope: {
      label: scope,
      inputHashes,
      ...(tools.length > 0 ? { tools } : {}),
    },
    result: { status },
    runtime: {
      node: process.versions.node,
      pnpm: pnpmVersion,
      platform: `${process.platform}-${process.arch}`,
    },
    classification,
    retentionClass,
    expiresAt: expiresAt.toISOString(),
    linkedWork,
  };
  writeFileSync(
    path.join(runRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  if (options['summary-stdin'] === true) {
    const report = readFileSync(0, 'utf8');
    writeFileSync(path.join(runRoot, 'summary.txt'), redactReport(report), {
      mode: 0o600,
      flag: 'wx',
    });
  }
  process.stdout.write(`created ${runId}\n`);
}

function main() {
  const { operation, options } = parseArguments(process.argv.slice(2));
  if (operation === 'cleanup') {
    cleanup(options);
    return;
  }
  if (operation === 'create') {
    create(options);
    return;
  }
  throw new Error(
    'Usage: run-artifacts.mjs <create|cleanup> --repository-root <path>',
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
