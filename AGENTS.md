# Agent Guidelines for LionReader Monorepo

Tauri-based desktop e-book reader built with React, TypeScript, Vite, Tailwind CSS v4, Zustand, and Foliate-js.

## Workspace Layout

```
apps/
└── web/                        # Main app (Vite + React + Tauri)
    ├── src/                    # App entry + routing shell
    └── src-tauri/              # Rust backend

packages/
├── core/                       # Shared domain logic, stores, types, services
├── ui/                         # Shared UI components
└── features/
    ├── reader/                 # Reader feature module
    ├── library/                # Library feature module
    ├── settings/               # Settings feature module
    ├── statistics/             # Statistics feature module
    ├── vocabulary/             # Vocabulary feature module
    └── learning/               # Learning/review feature module
```

## Package Manager

- Use `pnpm` workspaces.
- Internal package dependencies must use `workspace:*`.

## Build Commands

```bash
# Install deps for all workspaces
pnpm install

# App development (web)
pnpm dev

# Core/UI typecheck
pnpm typecheck

# Production build (typecheck + app build)
pnpm build

# App preview
pnpm preview

# Tauri desktop mode
pnpm tauri dev
pnpm tauri build

# Rust backend only
cd apps/web/src-tauri && cargo build --release
```

## Monorepo Boundary Rules

- Import across modules only via package entrypoints (`@lionreader/core`, `@lionreader/ui`, `@lionreader/feature-*`).
- Do not import via cross-package source-relative paths (for example `../../../core/src/...`).
- Keep each package’s public API in `src/index.ts`.
- New features should be created under `packages/features/<feature-name>`.
- Shared logic belongs in `packages/core`; shared UI primitives belong in `packages/ui`.

## TypeScript Standards

- Strict mode enabled.
- Path alias in app package: `@/*` maps to `apps/web/src/*`.
- Use `type` imports where applicable.
- Avoid `any`; prefer explicit interfaces in `packages/core/src/types`.

## Naming Conventions

- Components: PascalCase (`ReaderToolbar`, `BookCard`)
- Hooks: camelCase with `use` prefix (`useDocumentReader`)
- Types/Interfaces: PascalCase (`Book`, `DocLocation`)
- Constants: UPPER_SNAKE_CASE
- Zustand stores: `use...Store`

## Component Patterns

- Prefer named exports.
- Use function declarations for components.
- Keep package-level barrel exports (`src/index.ts`).
- Use `cn()` utility for conditional class names.

## Styling

- Tailwind CSS v4 with CSS variables.
- Theme variables live in `apps/web/src/index.css` and `packages/core/src/lib/design-tokens.ts`.
- Reader-specific variables: `--reader-*`.

## State and Data

- Zustand stores and shared state contracts live in `packages/core/src/store`.
- Persistence via `persist` middleware for reload-safe data.
- Storage helpers live in `packages/core/src/lib/storage.ts`.

## Error Handling

- Use try/catch for async operations.
- Emit descriptive `console.error` messages.
- Return safe fallbacks for missing/corrupt data.

## Performance

- Use `useMemo` for expensive derivations.
- Use `useCallback` for handlers passed to children.
- Lazy-load feature routes where appropriate.

## Rust/Tauri Backend

Located in `apps/web/src-tauri/`:
- Keep Tauri commands focused and serializable.
- Use serde for JSON payloads.
- Run `cargo fmt` before Rust commits.

## Git

- Conventional commit types: `feat:`, `fix:`, `refactor:`, `docs:`.
- Keep monorepo changes scoped: avoid touching unrelated packages in one commit.
