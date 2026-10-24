# CI runners

Which runners CI's jobs use, and how to switch them. The repository is private,
so minutes on GitHub's runners are billed, while SERP's isolated runners
(serpcompany/serp-server#7) cost nothing per minute.

## The switch

The credential-free jobs below follow the repository variable
`CI_RUNNER_LABELS`, and run on GitHub's `ubuntu-latest` while it is unset. Set
to `"serp-isolated"`, they run on SERP's isolated runners. The value is JSON,
quotes included: a bare `serp-isolated` isn't JSON and fails every routed job
at `runs-on`. The runners' group takes selected private repositories only, so
the repository is added to it before the variable is set (#385).

```bash
gh variable set CI_RUNNER_LABELS --repo serpcompany/tools.serp.co --body '"serp-isolated"'
# Rollback: runs that start later use ubuntu-latest.
gh variable delete CI_RUNNER_LABELS --repo serpcompany/tools.serp.co
```

A job already queued for `serp-isolated` keeps waiting after a rollback, until
it is cancelled and re-run. A fork's pull request always runs on
`ubuntu-latest`, whatever the variable says, so SERP's runners never run a
fork's code.

| Follows `CI_RUNNER_LABELS`         | Always `ubuntu-latest`       |
| ---------------------------------- | ---------------------------- |
| Repository Check: `check`, `smoke` | Repository Check: `decoders` |
| Docs Checks, Docs Links, PR Title  | Deploy                       |

- **Deploy** holds the Cloudflare and Sentry keys, so it stays on GitHub's
  short-lived VMs, and no key, D1 data or Wrangler session lands on SERP's
  server.
- **`decoders`** runs the browsers' image decoders check
  ([browser-smoke.md](browser-smoke.md#browser-decoders)) in Chromium, Firefox
  and WebKit. Firefox and WebKit need system packages that only Playwright's
  `--with-deps` installs, which runs apt as root; SERP's runners have
  Chromium's libraries alone and no root.
- **`smoke`** installs Chromium without `--with-deps`, on every runner.

`scripts/ci-runners.test.mjs` lists the routed jobs, and fails any other
`runs-on`, a runner label named in a workflow, and a routed job that reads a
secret or installs with root.

## SERP's isolated runners

Each job gets a throwaway container that is deleted after it, with its own
network and process namespaces, so a fixed port such as `smoke`'s Worker on
8787 can't collide with a neighbour's. A slot has 6 threads and 24 GB of
memory. CPU-bound tests take about twice as long as on a public repository's
4-vCPU `ubuntu-latest` (serpcompany/serp-server#7), so routed jobs have room in
their timeouts.
The checkout and `node_modules` sit on a 12 GB in-memory disk, and `/tmp` holds
4 GB. Jobs get no Docker, no sudo and no secrets beyond their own
`GITHUB_TOKEN`. The image has `gh`, git, curl, jq and Chromium's system
libraries, and no `sqlite3`: tests use `node:sqlite`. `setup-node` installs
Node.

## Required checks

The `staging` ruleset requires `check`, `check-docs`, `smoke`,
`validate-links` and `conventional-title`, and `decoders` once the owner adds
it (#385). A moved job keeps its id, so its check keeps its name on either
runner.
