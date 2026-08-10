#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_ROUTES = [
  'docs/agents/issue-tracker.md',
  'docs/agents/triage-labels.md',
  'docs/agents/domain.md',
  'docs/agents/downloader-lander-links.md',
];

const AGENT_CONFIG_FILES = [
  '.codex/config.toml',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.mcp.json',
];

const PERSONAL_ABSOLUTE_PATH =
  /(?:\/Users\/(?!Shared(?:\/|$))[^/\s"']+\/|\/home\/[^/\s"']+\/|[A-Za-z]:\\Users\\[^\\\s"']+\\)/;
const CREDENTIAL_STYLE_ARGUMENTS = [
  /authorization\s*:\s*(?:bearer|basic)\s+\S+/i,
  /--(?:api[-_]?key|access[-_]?token|token|password|secret)\b/i,
  /["']?(?:api[_-]?key|apikey|access[_-]?token|accesstoken|password|secret)["']?\s*[:=]\s*["'](?!\s*(?:\$\{|<|your_|redacted|changeme))/i,
];
const PROJECT_PERSONAL_PREFERENCES = [
  /^\s*(?:notify\s*=|\[tui\]|\[notice(?:\.[^\]]+)?\]|hide_(?:full_access_warning|rate_limit_model_nudge|[^=\s]+_migration_prompt)\s*=)/,
  /["'](?:notifications|statusline|theme)["']\s*:/i,
];

function parseRoot(args) {
  const rootIndex = args.indexOf('--root');

  if (rootIndex === -1) {
    return process.cwd();
  }

  const root = args[rootIndex + 1];
  if (!root) {
    throw new Error('--root requires a directory');
  }

  return path.resolve(root);
}

function report(diagnostic) {
  process.stderr.write(`${diagnostic}\n`);
  process.exitCode = 1;
}

const root = parseRoot(process.argv.slice(2));
const agentInstructionsPath = path.join(root, 'AGENTS.md');

if (!existsSync(agentInstructionsPath)) {
  report('missing-file: AGENTS.md');
} else {
  const instructions = readFileSync(agentInstructionsPath, 'utf8');

  for (const route of REQUIRED_ROUTES) {
    if (!instructions.includes(route)) {
      report(`missing-route: ${route}`);
    }

    if (!existsSync(path.join(root, route))) {
      report(`missing-file: ${route}`);
    }
  }
}

for (const relativePath of AGENT_CONFIG_FILES) {
  const configPath = path.join(root, relativePath);
  if (!existsSync(configPath)) {
    continue;
  }

  const lines = readFileSync(configPath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (CREDENTIAL_STYLE_ARGUMENTS.some((pattern) => pattern.test(line))) {
      report(
        `unsafe-agent-config: credential-style-argument: ${relativePath}:${index + 1}`,
      );
    }

    if (PERSONAL_ABSOLUTE_PATH.test(line)) {
      report(
        `unsafe-agent-config: personal-absolute-path: ${relativePath}:${index + 1}`,
      );
    }

    if (PROJECT_PERSONAL_PREFERENCES.some((pattern) => pattern.test(line))) {
      report(
        `unsafe-agent-config: project-personal-preference: ${relativePath}:${index + 1}`,
      );
    }

    if (/@latest\b/i.test(line)) {
      report(
        `unsafe-agent-config: mutable-agent-tooling: ${relativePath}:${index + 1}`,
      );
    }
  });
}
