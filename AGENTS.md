# Agent Guidelines for Theorem

Tauri-based desktop e-book reader built with React, TypeScript, Vite, Tailwind CSS v4, Zustand, and Foliate-js.

## Project Layout

```
src/                            # Main app (Vite + React)
├── core/                       # Shared domain logic, stores, types, services
├── shell/                      # App chrome (titlebar, sidebar, boundaries, branding)
├── ui/                         # Shared UI primitives
└── features/
    ├── reader/                 # Reader feature module
    ├── library/                # Library feature module
    ├── settings/               # Settings feature module
    ├── statistics/             # Statistics feature module
    ├── vocabulary/             # Vocabulary feature module
    └── feeds/                  # Feed reader feature module

src-tauri/                      # Rust backend
```

## Package Manager

- Use root `pnpm` project commands.

## Build Commands

```bash
# Install deps
pnpm install

# App development (web)
pnpm dev

# Typecheck app and modules
pnpm typecheck

# Production build (typecheck + app build)
pnpm build

# App preview
pnpm preview

# Tauri desktop mode
pnpm dev:tauri
pnpm tauri dev
pnpm tauri build

# Rust backend only
cd src-tauri && cargo build --release
```

## Module Boundary Rules

- Import across modules only via package entrypoints (`@theorem/core`, `@theorem/shell`, `@theorem/ui`, `@theorem/feature-*`).
- Do not import via brittle cross-module relative paths.
- Keep module public APIs in `index.ts`.
- New features should be created under `src/features/<feature-name>`.
- Shared domain/state logic belongs in `src/core`.
- App chrome/navigation components belong in `src/shell`.
- Reusable UI primitives belong in `src/ui`.
- Feature-specific UI should stay inside the owning feature module.

## TypeScript Standards

- Strict mode enabled.
- Path alias: `@/*` maps to `src/*`.
- Use `type` imports where applicable.
- Avoid `any`; prefer explicit interfaces in `src/core/types`.

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
- Theme variables live in `src/index.css` and `src/core/lib/design-tokens.ts`.
- Reader-specific variables: `--reader-*`.

## State and Data

- Zustand stores and shared state contracts live in `src/core/store`.
- Persistence via `persist` middleware for reload-safe data.
- Storage helpers live in `src/core/lib/storage.ts`.

## Error Handling

- Use try/catch for async operations.
- Emit descriptive `console.error` messages.
- Return safe fallbacks for missing/corrupt data.

## Performance

- Use `useMemo` for expensive derivations.
- Use `useCallback` for handlers passed to children.
- Lazy-load feature routes where appropriate.

## Rust/Tauri Backend

Located in `src-tauri/`:
- Keep Tauri commands focused and serializable.
- Use serde for JSON payloads.
- Run `cargo fmt` before Rust commits.

## Git

- Conventional commit types: `feat:`, `fix:`, `refactor:`, `docs:`.
- Keep changes scoped: avoid touching unrelated modules in one commit.
