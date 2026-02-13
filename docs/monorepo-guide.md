# Monorepo Guide

This guide defines how to add and evolve modules without coupling breakage.

## Current Module Graph

- `@theorem/web` depends on `@theorem/core`, `@theorem/ui`, and `@theorem/feature-*`.
- `@theorem/ui` depends on `@theorem/core`.
- `@theorem/feature-*` depends on `@theorem/core` and optionally `@theorem/ui`.
- `@theorem/core` must not depend on feature packages.

## Add a New Feature Package

1. Create `packages/features/<feature-name>/src/index.ts`.
2. Add `packages/features/<feature-name>/package.json`:
   - `name`: `@theorem/feature-<feature-name>`
   - `private`: `true`
   - `type`: `module`
   - `exports`: `{ ".": "./src/index.ts" }`
   - internal deps with `workspace:*`
3. Add `packages/features/<feature-name>/tsconfig.json` extending `../../../tsconfig.base.json`.
4. Add feature routes/imports in `apps/web/src/App.tsx`.
5. Add path alias in `apps/web/tsconfig.json` and `apps/web/vite.config.ts`.

## Rules for AI-Assisted Changes

- Prefer editing one package at a time.
- Expose shared behavior through public package APIs before cross-package usage.
- Never add cross-package relative imports.
- Run `pnpm typecheck` before submitting changes.

## Recommended Workflows

- Work on one feature with workspace filter:
  - `pnpm --filter @theorem/web dev`
- Run full checks before merge:
  - `pnpm typecheck`
  - `pnpm build`
