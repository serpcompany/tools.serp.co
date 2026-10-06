#!/usr/bin/env node

// PR titles become the squash commit and the changelog line, so they must be
// Conventional Commits (serp git-workflow standard). Titles from GitHub's
// Revert button are allowed too: every merge to main deploys production, so a
// revert must never wait on a retitle.

import { pathToFileURL } from 'node:url';

export const TITLE_TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
];

const CONVENTIONAL_TITLE = new RegExp(
  `^(?:${TITLE_TYPES.join('|')})(?:\\([^()\\s][^()]*\\))?!?: \\S.*$`,
);
const GITHUB_REVERT_TITLE = /^Revert ".+"$/;

export function isValidPrTitle(title) {
  return CONVENTIONAL_TITLE.test(title) || GITHUB_REVERT_TITLE.test(title);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const title = process.env.TITLE ?? '';
  if (isValidPrTitle(title)) {
    console.log(`PR title is a Conventional Commit: ${title}`);
  } else {
    console.log(
      `::error::PR title must look like "fix: what the user notices" or "fix(scope): ...". ` +
        `Types: ${TITLE_TYPES.join(', ')}. Got: ${title}`,
    );
    process.exit(1);
  }
}
