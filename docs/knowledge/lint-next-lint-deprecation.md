# Tools lint: replace next lint with ESLint CLI

`next lint` now fails with ESLint 9 because it passes removed options (`useEslintrc`, `extensions`, etc.).

Fix:
- Switch `apps/tools` lint script to `eslint . --max-warnings 0`.
- Add `eslint` as a devDependency in `apps/tools` so the CLI resolves locally.
- Ignore build/vendor fixtures in `apps/tools/eslint.config.js` (at least `.next`, `out`, `public/vendor`, `benchmarks/fixtures`).
- Disable the triple-slash reference rule for `next-env.d.ts`.

After changes, `pnpm -C apps/tools lint` should pass.
