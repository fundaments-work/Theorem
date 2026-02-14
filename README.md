# Theorem

Tauri-based desktop e-book reader using a single root `pnpm` project.

## Layout

- `src`: React frontend entry and UI
- `src/core`: shared domain models, stores, and services
- `src/shell`: app shell components (titlebar, sidebar, branding, error boundary)
- `src/ui`: reusable UI primitives
- `src/features/*`: reader, library, settings, statistics, vocabulary, and feeds modules
- `src-tauri`: Rust backend and desktop packaging config

## Commands

```bash
# Install dependencies
pnpm install

# Start web app (Vite)
pnpm dev

# Start desktop app (Tauri + Vite)
pnpm dev:tauri
# or
pnpm tauri dev

# Typecheck app + imported modules
pnpm typecheck

# Production build
pnpm build

# Preview web build
pnpm preview
```

## Module Conventions

- Keep shared logic in `src/core`.
- Keep shell/layout in `src/shell`.
- Keep generic UI primitives in `src/ui`.
- Keep feature-specific logic/UI in `src/features/<feature-name>`.
- Use standard relative imports (no TypeScript path aliases).
