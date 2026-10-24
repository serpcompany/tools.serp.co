// Where CI jobs run (docs/runbooks/ci-runners.md). A routed job runs where the
// repository variable CI_RUNNER_LABELS points, and on ubuntu-latest while it is
// unset; a fork's pull request always runs on ubuntu-latest. Every other job,
// including any that holds a secret or runs apt as root, stays on GitHub's
// runners.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(root, '.github/workflows');
const workflowFiles = readdirSync(workflowDir)
  .filter((file) => /\.ya?ml$/.test(file))
  .sort();

const GITHUB_HOSTED = 'ubuntu-latest';
const ROUTED =
  "${{ github.event.pull_request && github.event.pull_request.head.repo.full_name != github.repository && 'ubuntu-latest' || fromJSON(vars.CI_RUNNER_LABELS || '\"ubuntu-latest\"') }}";

// `<workflow file>:<job id>` for every job that follows CI_RUNNER_LABELS.
const ROUTED_JOBS = [
  'check.yml:check',
  'check.yml:smoke',
  'docs-checks.yml:check-docs',
  'docs-links.yml:validate-links',
  'pr-title.yml:conventional-title',
];

// Deploys, with the Cloudflare and Sentry keys: GitHub's runners only.
const CREDENTIALED_WORKFLOWS = ['deploy.yml'];

// Each job of a workflow, by its id under `jobs:`, with its `runs-on` values
// and its text: its own lines, then the workflow's lines outside `jobs:` (a
// workflow-level `env:` reaches every job). Comments are left out.
function jobsOf(file, source) {
  const jobs = [];
  let workflowText = '';
  let inJobs = false;
  let job;
  for (const line of source.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    if (/^\S/.test(line)) {
      inJobs = /^jobs:\s*$/.test(line);
      job = undefined;
      if (!inJobs) workflowText += `${line}\n`;
      continue;
    }
    if (!inJobs) {
      workflowText += `${line}\n`;
      continue;
    }
    const id = /^ {2}([\w-]+):\s*$/.exec(line)?.[1];
    if (id) {
      job = { id: `${file}:${id}`, runsOn: [], text: '' };
      jobs.push(job);
      continue;
    }
    const runsOn = /^ {4}runs-on:\s*(.+?)\s*$/.exec(line)?.[1];
    if (runsOn) job.runsOn.push(runsOn);
    job.text += `${line}\n`;
  }
  for (const each of jobs) each.text += workflowText;
  return jobs;
}

// Any expression that reads `secrets` other than secrets.GITHUB_TOKEN
// (`secrets.X`, `secrets['X']`, `toJSON(secrets)`), and a `secrets:` key, as in
// a reusable workflow's `secrets: inherit`.
const holdsSecret = (text) =>
  /\$\{\{(?:(?!\}\})[\s\S])*\bsecrets\b(?!\.GITHUB_TOKEN\b)/.test(text) || /^\s+secrets:/m.test(text);
// Playwright's `--with-deps` and `install-deps` run apt as root.
const installsAsRoot = (text) => /\bsudo\b|apt-get|\bapt install\b|--with-deps|install-deps/.test(text);

const allJobs = workflowFiles.flatMap((file) => jobsOf(file, readFileSync(path.join(workflowDir, file), 'utf8')));

// Evaluates the GitHub expression subset `runs-on` uses (string literals,
// context paths, ==, !=, &&, ||, parentheses, fromJSON) with GitHub's
// precedence and values: a missing property is null, and && and || return an
// operand, not a boolean.
function evaluate(expression, context) {
  const body = /^\$\{\{(.*)\}\}$/s.exec(expression)?.[1];
  assert.ok(body !== undefined, `not an expression: ${expression}`);
  const tokens = body.match(/'(?:[^']|'')*'|[A-Za-z_][\w.-]*|!=|==|&&|\|\||\S/g) ?? [];
  let position = 0;
  const take = (expected) => {
    const token = tokens[position++];
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new Error(`expected ${expected ?? 'a token'} at token ${position} of ${expression}`);
    }
    return token;
  };
  const primary = () => {
    const token = take();
    if (token === '(') {
      const value = or();
      take(')');
      return value;
    }
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token === 'fromJSON') {
      take('(');
      const value = or();
      take(')');
      return JSON.parse(String(value));
    }
    if (!/^[A-Za-z_][\w.-]*$/.test(token)) throw new Error(`unsupported token ${token}`);
    return token.split('.').reduce((value, key) => (value == null ? null : (value[key] ?? null)), context);
  };
  const comparison = () => {
    const left = primary();
    const operator = tokens[position];
    if (operator !== '==' && operator !== '!=') return left;
    take();
    const right = primary();
    return operator === '==' ? left === right : left !== right;
  };
  const and = () => {
    let value = comparison();
    while (tokens[position] === '&&') {
      take();
      const right = comparison();
      value = value ? right : value;
    }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[position] === '||') {
      take();
      const right = and();
      value = value ? value : right;
    }
    return value;
  };
  const result = or();
  assert.equal(position, tokens.length, `unparsed input in ${expression}`);
  return result;
}

const repository = 'serpcompany/tools.serp.co';
const runnerFor = (event, variable) =>
  evaluate(ROUTED, {
    github: { event, repository },
    vars: variable === undefined ? {} : { CI_RUNNER_LABELS: variable },
  });
const pullRequestFrom = (headRepository) => ({
  pull_request: { head: { repo: headRepository === null ? null : { full_name: headRepository } } },
});

test('routes exactly the listed jobs and keeps every other job on ubuntu-latest', () => {
  const routed = [];
  for (const job of allJobs) {
    assert.equal(job.runsOn.length, 1, `${job.id} has one runs-on`);
    if (job.runsOn[0] === ROUTED) routed.push(job.id);
    else assert.equal(job.runsOn[0], GITHUB_HOSTED, job.id);
  }
  assert.deepEqual(routed.sort(), [...ROUTED_JOBS].sort());
});

test('names no self-hosted runner label in a workflow', () => {
  for (const file of workflowFiles) {
    const source = readFileSync(path.join(workflowDir, file), 'utf8');
    assert.doesNotMatch(source, /self-hosted|serp-isolated/, file);
  }
});

test('keeps every job with a secret or a root install on GitHub-hosted runners', () => {
  for (const job of allJobs) {
    const credentialed =
      holdsSecret(job.text) ||
      /^ {4}environment:/m.test(job.text) ||
      CREDENTIALED_WORKFLOWS.includes(job.id.split(':')[0]);
    if (credentialed || installsAsRoot(job.text)) {
      assert.equal(job.runsOn[0], GITHUB_HOSTED, job.id);
      assert.ok(!ROUTED_JOBS.includes(job.id), job.id);
    }
  }
  for (const file of CREDENTIALED_WORKFLOWS) assert.ok(workflowFiles.includes(file), file);
});

test('finds a secret however a job reads it', () => {
  const textOf = (source) => jobsOf('fixture.yml', source)[0].text;
  const job = (steps) => `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
  const run = (expression) => job(`      - run: echo "${expression}"\n`);
  for (const source of [
    run('${{ secrets.CLOUDFLARE_API_TOKEN }}'),
    run("${{ secrets['CLOUDFLARE_API_TOKEN'] }}"),
    run('${{ toJSON(secrets) }}'),
    `env:\n  TOKEN: \${{ secrets.SENTRY_AUTH_TOKEN }}\n${job('      - run: ./deploy\n')}`,
    'jobs:\n  call:\n    uses: ./.github/workflows/deploy.yml\n    secrets: inherit\n',
  ]) {
    assert.ok(holdsSecret(textOf(source)), source);
  }
  for (const source of [run('${{ secrets.GITHUB_TOKEN }}'), run('${{ github.token }}'), run('no secrets here')]) {
    assert.ok(!holdsSecret(textOf(source)), source);
  }
  assert.ok(installsAsRoot(textOf(job('      - run: pnpm exec playwright install --with-deps chromium\n'))));
  assert.ok(!installsAsRoot(textOf(job('      - run: pnpm exec playwright install chromium\n'))));
});

test('sends routed jobs to the variable, and a fork pull request to ubuntu-latest', () => {
  const sameRepository = pullRequestFrom(repository);
  // Unset: every event runs on ubuntu-latest.
  assert.equal(runnerFor(sameRepository), 'ubuntu-latest');
  assert.equal(runnerFor({}), 'ubuntu-latest');
  // "serp-isolated", quotes included: same-repository pull requests, pushes
  // and dispatches go to SERP's isolated runners.
  assert.equal(runnerFor(sameRepository, '"serp-isolated"'), 'serp-isolated');
  assert.equal(runnerFor({}, '"serp-isolated"'), 'serp-isolated');
  assert.deepEqual(runnerFor({}, '["self-hosted","Linux"]'), ['self-hosted', 'Linux']);
  // A fork's pull request, or one whose head repository was deleted, never
  // leaves GitHub.
  assert.equal(runnerFor(pullRequestFrom('someone/tools.serp.co'), '"serp-isolated"'), 'ubuntu-latest');
  assert.equal(runnerFor(pullRequestFrom(null), '"serp-isolated"'), 'ubuntu-latest');
  // Without the quotes the value isn't JSON, and every routed job fails at
  // runs-on instead of guessing.
  assert.throws(() => runnerFor({}, 'serp-isolated'), SyntaxError);
});
