# Theorem Monorepo

Tauri-based desktop e-book reader built as a monorepo:
- `apps/web`: React + Vite frontend and Tauri host app
- `packages/core`: shared types, stores, services, and utilities
- `packages/ui`: reusable UI components
- `packages/features/*`: feature modules (reader, library, settings, statistics, vocabulary, learning)

## Package Manager

This repository uses `pnpm` workspaces.

## Commands

```bash
# Install dependencies
pnpm install

# Start web dev app
pnpm dev

# Typecheck shared contracts (core + ui)
pnpm typecheck

# Production build (typecheck + web build)
pnpm build

# Generate API and AI-context docs
pnpm docs:build

# Run Tauri commands (examples)
pnpm tauri dev
pnpm tauri build
```

## Monorepo Conventions

- Internal dependencies use `workspace:*`.
- Import other modules only through package public APIs (for example `@theorem/core`), not via source-relative paths.
- Keep new code inside the relevant feature package and expose entry points from each package `src/index.ts`.

## AI Documentation System

- `pnpm docs:api` generates API reference docs from public package entry points into `docs/api/`.
- `pnpm docs:context` generates AI-oriented indexes:
  - `docs/ai/module-index.md`
  - `llms.txt`
  - `llms-full.txt`
- `pnpm docs:build` runs both doc generation steps.
