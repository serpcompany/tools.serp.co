import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const RETIRED_RUNNERS = [
  'scripts/apply-downloader-capabilities-to-tools.mjs',
  'scripts/audit-competitor-downloader-public-code.mjs',
  'scripts/audit-downloader-domain-gaps.mjs',
  'scripts/build-adult-downloader-sample-url-manifest.mjs',
  'scripts/discover-adult-sample-urls-batch.mjs',
  'scripts/probe-competitor-adapters-smoke.mjs',
  'scripts/probe-downloader-capability.mjs',
  'scripts/smoke-api-download-10-urls.mjs',
  'scripts/smoke-api-for-probed-batch.mjs',
  'scripts/test-tube8-custom-extractor.mjs',
];

const RETIRED_GENERATED_DATA = [
  'data/downloader-capabilities.adult.json',
  'data/downloader-capabilities.schema.json',
  'docs/audits/tools-serp-downloader-domain-gap-audit.csv',
  'docs/audits/tools-serp-existing-downloader-competitor-content-gaps.csv',
  'docs/audits/tools-serp-missing-adult-downloader-pages.csv',
  'docs/audits/tools-serp-missing-downloader-pages.csv',
];

const RETAINED_AUDITS = [
  'docs/audits/adult-downloader-10-url-api-smoke-after-direct-streaming.md',
  'docs/audits/adult-downloader-batch-10-scale-test.md',
  'docs/audits/adult-downloader-competitor-code-audit.md',
  'docs/audits/adult-downloader-wave-0-capability-report.md',
  'docs/audits/tools-serp-downloader-domain-gap-audit.md',
];

test('dated downloader and competitor runners are retired', () => {
  for (const retiredPath of [...RETIRED_RUNNERS, ...RETIRED_GENERATED_DATA]) {
    assert.equal(existsSync(retiredPath), false, retiredPath);
  }
});

test('package commands and current documentation do not advertise retired runners', () => {
  const currentSurface = [
    readFileSync('package.json', 'utf8'),
    readFileSync('README.md', 'utf8'),
    readFileSync('docs/runbooks/commands.md', 'utf8'),
    readFileSync('docs/runbooks/catalog-syncs.md', 'utf8'),
  ].join('\n');

  for (const runner of RETIRED_RUNNERS) {
    assert.doesNotMatch(
      currentSurface,
      new RegExp(runner.replaceAll('/', '\\/')),
    );
  }
});

test('retained findings are bounded dated audits without local input dependencies', () => {
  for (const auditPath of RETAINED_AUDITS) {
    const audit = readFileSync(auditPath, 'utf8');
    assert.match(audit, /^- Observed:/m, auditPath);
    assert.match(audit, /^- Revision:/m, auditPath);
    assert.match(audit, /^- Source provenance:/m, auditPath);
    assert.match(audit, /^- Scope:/m, auditPath);
    assert.match(audit, /^- Limitations:/m, auditPath);
    assert.doesNotMatch(audit, /\/Users\//, auditPath);
    assert.doesNotMatch(audit, /`tmp\//, auditPath);
  }
});

test('no retired runner or generated capability input backs maintained validation', () => {
  const validationCommands = JSON.parse(
    readFileSync('package.json', 'utf8'),
  ).scripts;
  const checkSurface = [
    validationCommands.check,
    validationCommands.test,
    validationCommands['verify:catalog'],
    validationCommands['check:links'],
  ].join('\n');
  const validationSources = [
    'scripts/run-tests.mjs',
    'scripts/verify-agent-workflow.mjs',
    'scripts/verify-documentation.mjs',
    'scripts/validate-tools.mjs',
    'scripts/validate-lander-outbound-links.mjs',
  ]
    .map((sourcePath) => readFileSync(sourcePath, 'utf8'))
    .join('\n');

  for (const retiredPath of [...RETIRED_RUNNERS, ...RETIRED_GENERATED_DATA]) {
    const retiredPattern = new RegExp(retiredPath.replaceAll('/', '\\/'));
    assert.doesNotMatch(checkSurface, retiredPattern);
    assert.doesNotMatch(validationSources, retiredPattern);
  }
  assert.doesNotMatch(validationSources, /\/Users\//);
  assert.doesNotMatch(validationSources, /tmp\/adult-downloader/);
});
