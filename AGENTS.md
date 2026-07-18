## Stack

React 19, TypeScript, Vite 8 (rolldown), Tailwind CSS v4, Zustand 5, Tauri 2, Rust (workspace). Tests: Vitest + jsdom.

## Setup

```bash
git clone --recurse-submodules <repo>
pnpm install
```

The `foliate-js` submodule at `src/features/reader/foliate-js/` is vendored upstream — do not edit. Our runtime wrapper is `src/features/reader/foliate-js-runtime/` (ours, edit freely). The sync script `scripts/sync-foliate-js.sh` patches imports and applies runtime patches.

## Commands

| What | Command |
|------|---------|
| Web dev | `pnpm dev` |
| Desktop dev | `pnpm dev:tauri` |
| Build | `pnpm build` |
| Typecheck | `pnpm typecheck` |
| Tests | `pnpm test` |
| Single test | `pnpm test tests/some.test.ts` |
| Rust fmt | `cd src-tauri && cargo fmt` |
| Rust lint | `cd src-tauri && cargo clippy` |
| Rust check | `cd src-tauri && cargo check` |
| Rust release build | `cd src-tauri && cargo build --release` |

Root `pnpm` commands run from repo root. Cargo commands run from `src-tauri/`. `pnpm build` runs typecheck first.

## Quality Gates (before every commit)

Run all that apply:

- TypeScript: `pnpm typecheck` — zero errors
- Rust (if any `.rs` changed): `cd src-tauri && cargo fmt && cargo clippy && cargo check` — fmt must produce no diff, clippy zero warnings

If clippy is noisy, try `cargo clippy --fix --lib` first.

CI (`ci.yml`) runs typecheck, test, build, and rust-check (fmt, clippy, check) on push to main.

## Architecture

**Routing**: Zustand-driven via `useUIStore.currentRoute` and `AppRoute` union type (`src/core/types/index.ts:366`). No React Router. Additions require updating: `src/App.tsx` (route switch + lazy load), `src/core/types/index.ts` (type), `src/shell/layout/Sidebar.tsx`, `src/shell/AppTitlebar.tsx`.

**Stores**: One file per slice in `src/core/store/`, barrel-rexported from `src/core/store/index.ts`. Always import from the barrel (`"../../core/store"`), not individual slice files. Import stores with individual selectors (`useUIStore(s => s.x)`), never destructuring.

**Imports**: Never import from the top-level barrel `src/core/index.ts` — it prevents tree-shaking. Import directly: `"../../core/store"` (stores), `"../../core/types"` (types), `"../../core/lib/env"` (env utils), `"../../core/lib/utils"` (cn). No path aliases.

**App entry**: `src/App.tsx` lazy-loads all route components (`React.lazy`). The reader chunk is pre-warmed via `prewarmReaderChunk()` on library mount. PDF.js is also pre-warmed.

**Reader**: Two rendering paths. Non-PDF: `ReaderViewport → useDocumentReader → FoliateEngine`. PDF: `PDFReader → PDFJsEngine`. `Reader.tsx` orchestrates both.

**EPUB pre-parser** (`src-tauri/src/epub_parser.rs`): Rust Tauri command `prefetch_zip_metadata` that pre-decodes EPUB ZIP text in parallel with zip.js. If the cache is populated, zip.js skips `getEntries()`. When changing the `ZipPrefetch` struct, update all 3 sides: Rust command, `src/core/lib/tauri-epub-bridge.ts` (TS interface), `src/features/reader/foliate-js-runtime/view.js` (consumer).

**Runtime split**: Guard desktop-only code with `isTauri()` / `isTauriDesktop()` / `isTauriMobile()` / `isMobile()` from `src/core/lib/env.ts`. Provide browser fallbacks.

**Sync**: P2P via iroh stack (iroh + iroh-docs + iroh-blobs + iroh-gossip). 18 Tauri commands in `sync_commands.rs`. Iroh is always compiled (no feature gate). See `docs/PERFORMANCE_SYNC_AUDIT.md`.

## Tauri backend

64 commands across `lib.rs` (file I/O, network, TTS, misc), `database.rs` (28 SQLite commands), `sync_commands.rs` (18 sync commands), `epub_parser.rs`, `file_transfer.rs`. To find all: `grep -r '#\[tauri::command\]' src-tauri/src/`. When signatures change, update both Rust and TS call sites.

## Persistence

SQLite via `rusqlite` + `r2d2` pool. All connections use `with_connection()` — never open raw `Connection::open()`. Migrations are versioned per store (Zustand persist middleware). When changing persisted schemas: bump version, update defaults, add/adjust `migrate`.

Key constraints: `book.locations` (foliate-js positions) must NOT be stored in Zustand — use SQLite BLOB. `data:` cover paths must not be serialized into sync payloads.

## Anti-patterns (violations = bugs)

- No React Router — use `useUIStore.currentRoute`
- No `transition-all` — specify the exact property
- No `snap-x snap-mandatory` on scroll containers
- No barrel imports from `src/core/index.ts`
- No Zustand destructuring (`const { x } = useStore()`)
- No `awaitSettledLayout()` / double-RAF delays after navigation (paginator container is grid-sized, measurements are immediate)
- No `Array.find()` on books array — use `getBook(bookId)` or `getBookLookup().get(bookId)`
- No `console.log` in production code — use `import.meta.env.DEV` guards

## CSS conventions

- `content-visibility: auto` + `overscroll-behavior: contain` on scroll containers
- Animate only with Tailwind utilities; guard `animate-fade-in` behind `prefers-reduced-motion: no-preference`
- Use `cn()` from `src/core/lib/utils.ts` for class composition
- Design tokens in `src/core/styles/design-tokens.css` + `@theme` block in `src/index.css`
