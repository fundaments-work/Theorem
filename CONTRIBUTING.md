# Contributing to Theorem

Thanks for your interest in contributing! Theorem is a Tauri-first desktop reader built with React 19, TypeScript, and Rust.

## Getting Started

### Prerequisites

- **Node.js 22+** and **pnpm 10+**
- **Rust** (stable, via [rustup](https://rustup.rs))
- **Tauri system dependencies**: `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev` (see [Tauri docs](https://tauri.app/start/prerequisites/))

### Setup

```bash
git clone https://github.com/fundaments-work/theorem.git
cd theorem
pnpm install
```

### Running

```bash
pnpm dev          # Web mode (port 1420)
pnpm dev:tauri    # Desktop mode (Tauri window)
```

## Project Architecture

See [AGENTS.md](./AGENTS.md) for the full repository map, import conventions, and placement rules.

Key concepts:
- **Navigation is store-driven** — `useUIStore.currentRoute`, not React Router
- **No path aliases** (`@/`, `@theorem/*`) — use relative imports
- **`src/features/reader/foliate-js/**` is vendored** — do not edit unless explicitly required

## Making Changes

1. Fork and create a feature branch
2. Write your changes following existing code conventions
3. Run `pnpm typecheck` to verify TypeScript
4. If Rust was touched, run `cargo fmt && cargo check` in `src-tauri/`
5. Run `pnpm test` to verify existing tests pass
6. Commit using [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.)
7. Open a pull request against `main`

## Commit Conventions

Use conventional commit prefixes:
- `feat:` — new feature
- `fix:` — bug fix
- `chore:` — maintenance, deps, cleanup
- `docs:` — documentation
- `style:` — formatting, design tokens
- `refactor:` — code restructuring without behavioral changes

## Testing

```bash
pnpm test          # Run all unit tests (Vitest + jsdom)
pnpm test:watch    # Watch mode
pnpm test:coverage # With coverage report
```

Tests live in `tests/**/*.test.ts` with setup in `tests/setup.ts`.

## Questions?

Open a [GitHub Discussion](https://github.com/fundaments-work/theorem/discussions) or [issue](https://github.com/fundaments-work/theorem/issues).
