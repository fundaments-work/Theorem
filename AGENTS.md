# AGENTS.md

Operational guide for AI coding agents working in this repository.

## Product + Stack
- Theorem is a Tauri-first desktop reader with web fallback.
- Frontend stack: React 19, TypeScript, Vite 6, Tailwind CSS v4, Zustand.
- Reader stack:
  - Reflowable/fixed ebook formats via Foliate integration.
  - PDF via PDF.js engine.
  - RSS article reading via dedicated article reader path.

## Non-Negotiable Reality Checks
- Navigation is store-driven (`useUIStore.currentRoute`), not React Router route objects.
- Imports are primarily relative/barrel imports inside `src`. Do not assume `@/*` or `@theorem/*` aliases.
- `src/features/reader/foliate-js/**` is vendored upstream code. Do not edit it unless explicitly required.
- CBR is recognized for compatibility but intentionally unsupported for import/render.

## Repository Map
```text
src/
  App.tsx                         # Route switch driven by useUIStore
  core/
    types/index.ts                # Core domain contracts (Book, Annotation, settings, routes)
    store/index.ts                # Zustand stores + persistence + migrations
    lib/                          # Runtime helpers (storage/import/design tokens/dialogs/vault sync)
    services/                     # Dictionary, StarDict, RSS services
  shell/                          # App chrome (sidebar/titlebar/error boundary)
  ui/                             # Shared UI primitives (Modal/Dropdown/Panel/ContextMenu/Backdrop)
  features/
    reader/                       # Book + article reader flows and engines
    library/                      # Library/shelves/bookmarks/annotations pages
    vocabulary/                   # Vocabulary workspace
    feeds/                        # Feed subscriptions + article list
    settings/                     # App settings and data management
    statistics/                   # Reading stats
src-tauri/
  src/lib.rs                      # Tauri commands and runtime bootstrap
  tauri.conf.json                 # Window config, CSP, bundling resources
```

## Required Commands
- Install: `pnpm install`
- Web dev: `pnpm dev`
- Desktop dev: `pnpm dev:tauri` or `pnpm tauri dev`
- Typecheck: `pnpm typecheck`
- Build: `pnpm build`
- Preview: `pnpm preview`
- Rust-only build: `cd src-tauri && cargo build --release`

Notes:
- Run root `pnpm` commands from repo root.
- `pnpm test` runs Vitest (currently focused and not yet comprehensive).

## Git Ignore Policy
- Treat generated/build outputs as uncommitted artifacts.
- Never commit local SDK/signing files or Android machine-local config.
- Keep these untracked by default:
  - `node_modules/`, `.pnpm-store/`, `dist/`, `dist-ssr/`, `coverage/`, `.vite/`
  - `target/`, `src-tauri/target/`, `src-tauri/gen/schemas/`
  - `src-tauri/gen/android/` (entire generated Android Studio project)
  - `*.jks`, `*.keystore`, `*.aab`, `*.apk`, `output-metadata.json`
- If your release workflow needs Android project files versioned, remove `src-tauri/gen/android/` from `.gitignore` and use the generated project’s nested `.gitignore` files (`src-tauri/gen/android/.gitignore`, `src-tauri/gen/android/app/.gitignore`) as baseline.

## Architecture Rules

### Routing + page wiring
- `src/App.tsx` is the route switch. Additions to app pages require updates here.
- `AppRoute` union in `src/core/types/index.ts` is canonical.
- If a new route is added, update all relevant route-aware surfaces:
  - `src/App.tsx`
  - `src/core/types/index.ts`
  - `src/shell/layout/Sidebar.tsx`
  - `src/shell/AppTitlebar.tsx`
  - `src/core/lib/search/domain.ts`

### State + persistence
- Stores live in `src/core/store/index.ts`:
  - `useUIStore` (ephemeral UI/navigation/search/vault sync state)
  - `useLibraryStore` (books/collections/annotations + persisted cache)
  - `useSettingsStore` (settings/stats)
  - `useVocabularyStore` (terms/dictionaries/lookup cache)
  - `useRssStore` (feeds/articles/current article)
- Persisted stores already use versioned migrations. When changing persisted schema:
  - Update defaults.
  - Bump version.
  - Add/adjust `migrate`.
  - Keep `onRehydrateStorage` compatibility behavior.

### Reader subsystem
- `src/features/reader/Reader.tsx` orchestrates:
  - Book mode (`BookReaderPage`) and article mode (`ArticleViewer`) under `ReaderPage`.
  - PDF and non-PDF split.
  - Annotation synchronization between UI, engine, and store.
- Non-PDF rendering path:
  - `ReaderViewport` -> `useDocumentReader` -> `FoliateEngine`.
- PDF rendering path:
  - `PDFReader` -> `PDFJsEngine`.
- High-risk area: annotation logic. Preserve annotation IDs and sync behavior across:
  - store mutations
  - viewport rendering
  - panel state

### Runtime split (web vs desktop)
- Always guard desktop-only behavior with `isTauri()`.
- Keep browser fallbacks for dialogs/storage/network where already implemented.
- RSS/article fetch logic intentionally uses Tauri invokes in desktop mode to bypass browser CORS restrictions.

## Placement Rules (Where New Code Goes)
- Shared domain types/contracts: `src/core/types/index.ts`
- Shared state/persistence: `src/core/store/index.ts`
- Shared utility/runtime integration:
  - storage/import: `src/core/lib/storage.ts`, `src/core/lib/import.ts`
  - design tokens/theme sync: `src/core/lib/design-tokens.ts` + CSS tokens
  - dialogs: `src/core/lib/dialogs.ts`
  - vault markdown sync: `src/core/lib/vault-sync.ts`
- Services:
  - dictionary orchestration: `src/core/services/DictionaryService.ts`
  - StarDict import/lookup: `src/core/services/StarDictService.ts`
  - feed parsing/article extraction: `src/core/services/RssService.ts`
- App chrome: `src/shell/*`
- Reusable primitives: `src/ui/*`
- Feature-specific logic/UI: `src/features/<feature>/*`

## Styling + UI Rules
- Use Tailwind utility classes with CSS variables from design tokens.
- Theme/token sources:
  - `src/core/styles/design-tokens.css`
  - `src/index.css`
  - runtime application in `src/core/lib/design-tokens.ts`
- Use `cn()` from `src/core/lib/utils.ts` for class composition.
- Prefer existing UI primitives (`Modal`, `Dropdown`, `Panel`, `Backdrop`, `ContextMenu`) before adding one-off patterns.
- Keep reader styles compatible with `--reader-*` variable pipeline.

## Data/format contracts you must preserve
- Book formats in `BookFormat`: `epub`, `mobi`, `azw`, `azw3`, `fb2`, `cbz`, `cbr`, `pdf`.
- Import is intentionally blocked for `cbr`.
- Storage paths may be:
  - external FS path
  - app data `.book` path
  - `idb://...`
  - `browser://...`
- RSS article annotations use synthetic book IDs: `rss:<articleId>`.
- Existing session keys are behaviorally significant:
  - `theorem-selected-shelf`
  - `theorem-goto-location`
  - `theorem-feeds:selected-feed-id`
  - `theorem-feeds:show-mobile-list`

## Tauri backend rules
- Tauri commands are in `src-tauri/src/lib.rs`.
- Frontend relies on command names:
  - `read_file`
  - `read_pdf_file`
  - `get_pdf_metadata`
  - `fetch_rss_feed`
  - `fetch_url_content`
  - `fetch_binary_content`
- If command payload/return changes, update both Rust and TS call sites together.
- Run `cargo fmt` after Rust changes.

## Agent workflow expectations
- Make focused changes; avoid unrelated refactors.
- Preserve existing public APIs unless task requires change.
- Prefer minimal-diff edits in reader/store files due high coupling.
- For any persistence-affecting change, include migration updates in same change.
- Validate before finishing:
  - minimum: `pnpm typecheck`
  - high-risk UI/runtime changes: also run `pnpm build`
  - Rust touched: run `cargo fmt` and at least `cargo check` in `src-tauri/`

## Explicit anti-patterns for this repo
- Do not introduce React Router routing for page navigation.
- Always use React portal model for overlay
- Do not replace Zustand route state with local component routing state.
- Do not hardcode colors where design tokens exist.
- Do not directly edit vendored foliate-js internals for app-level behavior tweaks if the wrapper/engine layer can solve it.
