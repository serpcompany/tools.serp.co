# Fix: Next.js build fails on @jsquash/webp

## Symptom
- `next build` fails with `Identifier 'Module' has already been declared` in `@jsquash/webp/codec/*`.

## Root cause
- Next/SWC transpiles `@jsquash/webp` when it is listed in `transpilePackages`.
- SWC lowers default parameters to `let Module = ...` and the Emscripten output also declares `var Module = ...`, creating an invalid redeclare after transpilation.

## Fix
- Remove `@jsquash/webp` from `transpilePackages` in `apps/tools/next.config.mjs` so SWC does not rewrite it.

## Verify
- `pnpm -C apps/tools build`
