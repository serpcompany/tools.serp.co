# Sandcastle as a controlled agent environment

Date: 2026-08-10

## Question

What control, isolation, reproducibility, testing, browser/runtime feedback, security, and maintenance value would [Matt Pocock's Sandcastle](https://github.com/mattpocock/sandcastle) provide to `tools.serp.co`, and is it strong enough to prototype?

## Decision

**Prototype Sandcastle in a bounded follow-up; do not adopt it as the repository's agent harness yet.**

Sandcastle is a strong orchestration layer for running coding agents on named branches, supervising them, and placing verification commands between agent turns. It is not a complete security boundary, deterministic development environment, browser-testing system, or replacement for the Matt Pocock issue workflow. A prototype is justified because its strongest capabilities align with this project's desired fresh-clone-to-reviewable-PR loop, while its most important gaps—browser setup, Cloudflare parity, secret containment, and native dependency behavior—can only be settled by running this repository inside it.

The best initial subject is a **local, explicitly named-branch Docker or rootless Podman run** with repository-owned setup and verification. Sandcastle's Vercel provider offers materially stronger remote isolation, ports, resource sizing, and network policy, but choosing it now would reintroduce a Vercel operational dependency while this project is deciding how to retire Vercel. That provider should remain an alternative, not the prototype default.

## What Sandcastle actually provides

### Control: strong

Sandcastle is a TypeScript orchestration library rather than an opinionated planning system. Its public API controls the agent/model, prompt, branch strategy, iteration and completion limits, cancellation, lifecycle hooks, structured output, logs, and environment setup. A reusable sandbox can run an implementer, execute a verification command, and then run a reviewer against the same warm filesystem. Results expose stdout, commits, the working branch, session metadata, and a log path. These are useful primitives for the agreed Matt workflow, but the repository must still define when an issue is eligible, which checks are mandatory, and who may publish or merge. [Sandcastle API and reusable sandbox](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/README.md#api)

The branch controls are particularly relevant. `branch` places commits on a named worktree branch suitable for a PR; `merge-to-head` creates and later merges a temporary branch. However, the default for Docker and Podman is `head`, which writes directly into the active host checkout. An unattended repository workflow must therefore select a safe strategy explicitly rather than accept the local default. [Sandcastle branch strategies](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/README.md#branch-strategies)

### Isolation: provider-dependent

Docker and Podman are bind-mount providers. Sandcastle creates or selects a host worktree and mounts it, together with required Git metadata, into the container. The agent therefore has a narrower operating-system environment, but its writes to the mounted worktree are host writes. Docker documents that bind mounts are writable by default and that changes appear on the host. A named worktree limits the intended Git destination; it does not turn a bind mount into a hard security boundary. [Sandcastle Docker provider](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/src/sandboxes/docker.ts#L126-L199), [Docker bind-mount behavior](https://docs.docker.com/engine/containers/run/#bind-mounts)

The built-in Vercel provider is an isolated provider: it creates an ephemeral Firecracker microVM, syncs files in and out, and supports exposed ports, resource sizing, snapshots as sources, and network policy. That is a stronger boundary for untrusted work than a writable local bind mount, at the cost of an external account, credentials, usage cost, transfer/setup latency, and another provider integration to maintain. [Sandcastle Vercel provider](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/src/sandboxes/vercel.ts#L22-L169), [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)

### Security: useful mechanisms, permissive policy

Sandcastle deliberately runs the coding agent with its own permission checks bypassed, relying on the selected sandbox boundary. Its Docker provider runs as a non-root user, but uses Docker's normal network when none is configured and allows writable mounts, supplemental groups, devices, `sudo` setup hooks, and even a `noSandbox()` provider. The Docker API exposes a CPU limit but not memory, process-count, read-only-root, capability-drop, or seccomp controls. Docker itself has no resource limits unless the caller supplies them. [Agent invocation](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/src/Orchestrator.ts#L140-L188), [Docker provider options](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/src/sandboxes/docker.ts#L37-L123), [Docker resource defaults](https://docs.docker.com/engine/containers/resource_constraints/)

Secrets declared in `.sandcastle/.env` or provider configuration become environment variables visible to the agent. With outbound network access, any such credential is exfiltratable. Sandcastle has no built-in short-lived credential broker or command-level approval layer. The harness would need to supply only task-scoped credentials, avoid production Cloudflare/D1/R2 access, and treat GitHub write authority separately from test execution. Sandcastle's environment resolver does at least restrict automatic host fallback to keys named in `.sandcastle/.env`; it does not silently copy the host's entire environment. [Environment resolution](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/src/EnvResolver.ts)

Vercel's adapter exposes a network policy but defaults to full internet access when no policy is provided. Rootless Podman may reduce host privilege compared with Docker, but neither choice removes the need for an explicit threat model. [Vercel adapter network default](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/src/sandboxes/vercel.ts#L85-L90)

### Reproducibility: achievable, not automatic

A checked-in Dockerfile, lockfile install, named branch, captured prompt, fixed model settings, and explicit verification commands can make an agent run much easier to reproduce than an ad hoc host session. Sandcastle also preserves dirty worktrees after failures and can reuse a warm sandbox for implement/verify/review cycles.

Its generated defaults are not deterministic on their own. The example image uses the mutable `node:22-bookworm` tag, installs current apt packages, and executes a remote agent installer without a pinned version. Templates may run an unpinned `npm install` or copy host `node_modules`. Reproducibility would therefore come from repository-owned pinning and setup policy, not from installing Sandcastle. [Generated Dockerfile](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/.sandcastle/Dockerfile), [configuration guidance](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/README.md#configuration)

### Test and runtime feedback: good generic plumbing

`sandbox.exec()` returns stdout, stderr, and an exit code, so the harness can gate an agent turn on repository commands in the same environment. Logs can include agent text, tool calls, and raw output; runs have idle and completion timeouts; failed or dirty worktrees remain inspectable. This is enough to make lint, typecheck, build, and test evidence visible to orchestration code. It does not interpret those results or decide which checks matter. [Reusable sandbox verification example](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/README.md#createsandbox--reusable-sandbox), [v0.12.0 release](https://github.com/mattpocock/sandcastle/releases/tag/v0.12.0)

Browser feedback is not first-class. The public API has no browser controller, screenshot protocol, visual-regression layer, or standard artifact collector. A project can install Playwright and invoke it through `sandbox.exec()`, but it owns browser binaries, OS libraries, app startup, port exposure, screenshots/traces, and result interpretation. Vercel accepts exposed ports; the Docker provider has no published port-mapping option. This repository already has Playwright and a Chromium-based benchmark script, so browser execution is plausible but must be proven rather than assumed. [Sandcastle provider API](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/README.md#sandbox-providers), [`tools.serp.co` browser benchmark](https://github.com/serpcompany/tools.serp.co/blob/4526054/scripts/benchmark-tools.mjs#L1-L30)

## Fit with `tools.serp.co`

The basic runtime fit is good:

- The repo declares Node `>=20 <23`; Sandcastle's generated image uses Node 22.
- Sandcastle detects pnpm, while this repo pins pnpm 10.4.1 and uses a conventional pnpm workspace.
- Verification is already shell-driven: Turbo build/lint plus tool/link validators and app-level typecheck/build commands.
- The app already provides local Cloudflare/OpenNext commands through Wrangler, including local D1 migration support.

[Root package configuration](https://github.com/serpcompany/tools.serp.co/blob/4526054/package.json#L5-L37), [app scripts and dependencies](https://github.com/serpcompany/tools.serp.co/blob/4526054/apps/tools/package.json#L6-L80), [Cloudflare bindings](https://github.com/serpcompany/tools.serp.co/blob/4526054/wrangler.jsonc)

The difficult fit is exactly why a prototype is warranted. A repository image must support pnpm/Corepack, Playwright Chromium and its Linux libraries, Sharp, FFmpeg, ImageMagick WASM, Ghostscript, yt-dlp-related packages, Next.js/OpenNext, and Wrangler. Running those successfully in Linux would improve local consistency, but it would not prove Cloudflare Workers production parity: the sandbox is a Node/Linux machine, while production has Workers runtime constraints and remote D1/R2/service bindings. Production credentials and destructive Wrangler commands must remain outside unattended runs.

Native package installation may also differ from the developer's macOS host. That is potentially a benefit—Linux failures become repeatable—but dependency downloads, large browser/model assets, and multi-platform binary behavior will affect image size and startup time. Sandcastle does not answer those project-specific questions.

## Maintenance and maturity

Sandcastle removes a meaningful amount of custom machinery: worktree lifecycle, branch collection/merge, agent process streaming, timeouts, session capture, cancellation, and sandbox-provider adapters. The project would still own the Dockerfile, prompt/workflow scripts, package installation, secrets, network rules, verification matrix, browser artifacts, GitHub publishing, and upgrade testing.

The current release is `0.12.0`, so its public integration surface is still pre-1.0. The repository was created in March 2026 and published many releases through June 2026, with recent changes across mounts, concurrency, provider behavior, worktree recovery, session handling, and command execution. That is evidence of active development and also a reason to expect churn. Pinning a version and budgeting upgrade verification would be necessary. [Package metadata](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/package.json), [Sandcastle releases](https://github.com/mattpocock/sandcastle/releases), [changelog](https://github.com/mattpocock/sandcastle/blob/e99f832f26dc9d245c019a9ddd19fa5dee792427/CHANGELOG.md)

## What the prototype must decide

The follow-up should be a decision prototype, not the beginning of adoption. It is successful only if it produces evidence on these remaining uncertainties:

1. Can a fresh Linux sandbox install the pinned pnpm workspace and run the repository's safe verification commands without host `node_modules` or production secrets?
2. Can it run a local Next/OpenNext target plus the existing Chromium benchmark and return useful logs and browser artifacts?
3. Are failures and uncommitted changes recoverable without touching the developer's active checkout or merging automatically?
4. Can network and credentials be restricted enough for an unattended `ready-for-agent` issue while still allowing package and model access?
5. Is setup, image rebuild, and per-run latency acceptable compared with today's worktree-based Codex workflow?

If these fail, the lower-maintenance alternative is to retain the existing agent harness and Git worktrees while adding a repository-owned container/devcontainer solely for reproducible verification. A CI-only workflow provides a separate clean runner and review gate but slower interactive feedback. If local bind-mount isolation proves inadequate, an isolated remote provider such as Vercel Sandbox can be assessed separately without making it the site's deployment platform.

## Conclusion

Sandcastle is strong enough to prototype because it directly addresses controlled agent lifecycle, worktree/branch handling, reusable verification environments, and observable runs. It is not strong enough to adopt on evidence alone. The deciding prototype should focus on this repository's Linux/native/browser/Cloudflare verification loop and secret boundary, using an explicit named branch and no automatic merge. The Matt Pocock workflow remains the planning and eligibility layer; Sandcastle would sit underneath it as an execution mechanism.
