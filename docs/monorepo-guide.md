# Repository Guide

This repository uses one root `pnpm` project with a standard Tauri app layout.

## Current Module Graph

- App entrypoint is `src`.
- `@theorem/core` contains shared domain/store/service logic.
- `@theorem/shell` contains app chrome and framing UI.
- `@theorem/ui` contains reusable primitives.
- `@theorem/feature-*` contains route-level feature modules.
- `@theorem/core` must not depend on feature modules.

## Add a New Feature Module

1. Create `src/features/<feature-name>/index.ts`.
2. Implement feature components/hooks under `src/features/<feature-name>`.
3. Export public feature API from `src/features/<feature-name>/index.ts`.
4. Add route/import wiring in `src/App.tsx`.
5. Add alias mapping in:
   - `tsconfig.json`
   - `vite.config.ts`

## Module Boundaries

- `src/core`: domain models, stores, services, and cross-feature business logic.
- `src/shell`: app-level layout, chrome, and app framing components.
- `src/ui`: generic UI primitives reusable across features.
- `src/features/*`: feature-specific routes and UI.

## Rules for AI-Assisted Changes

- Prefer editing one module at a time.
- Expose shared behavior through module public APIs before cross-module usage.
- Never add cross-module relative imports.
- Run `pnpm typecheck` before submitting changes.

## Recommended Workflow

- Run dev server:
  - `pnpm dev`
- Run desktop mode:
  - `pnpm dev:tauri` or `pnpm tauri dev`
- Run full checks before merge:
  - `pnpm typecheck`
  - `pnpm build`
