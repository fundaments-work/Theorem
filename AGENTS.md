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
- CBR is supported via import-time conversion to CBZ (Rust `unrar-ng` decompression).

## Import Architecture
- `src/core/index.ts` is the primary barrel: re-exports `lib/`, `store/`, `types/`, `services/`.
- Most app code imports from `"./core"` or `"../core"` — prefer this pattern.
- There are no path aliases (`@/`, `@theorem/*`); tsconfig has none.

## Repository Map
```text
src/
  App.tsx                         # Route switch driven by useUIStore
  core/
    index.ts                      # Barrel re-exporting lib, store, types, services
    types/index.ts                # Core domain contracts (Book, Annotation, settings, routes)
    store/index.ts                # Zustand stores + persistence + migrations
    lib/                          # Runtime helpers (env, storage, import, design tokens, dialogs, vault sync)
    services/                     # Dictionary, StarDict, RSS services
  shell/                          # App chrome (sidebar, titlebar, bottom nav, error boundary)
  ui/                             # Shared UI primitives (Modal/Dropdown/Panel/ContextMenu/Backdrop)
  features/
    reader/                       # Book + article reader flows and engines
    library/                      # Library/shelves/bookmarks/annotations pages
    vocabulary/                   # Vocabulary workspace
    feeds/                        # Feed subscriptions + article list
    settings/                     # App settings and data management
    statistics/                   # Reading stats
    onboarding/                   # First-run onboarding flow
src-tauri/
  Cargo.toml                      # Workspace root (members: theorem, theorem-sync-core, sync-daemon)
  src/lib.rs                      # Tauri commands and runtime bootstrap
  src/main.rs                     # Entry point (calls theorem_lib::run())
  crates/
    theorem-sync-core/            # Shared sync library (crypto, protocol, embedded HTTP server)
    sync-daemon/                  # Standalone background sync daemon (sidecar)
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
- `pnpm build` runs `pnpm typecheck && vite build` — typecheck is a prerequisite.
- `pnpm test` runs Vitest with jsdom. Test files live in `tests/**/*.test.ts`, setup in `tests/setup.ts`.

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
- `App.tsx` pre-warms PDF.js via `prewarmPdfJsRuntime()` (from `src/core/lib/pdfjs-runtime.ts`) for faster first PDF open.
- High-risk area: annotation logic. Preserve annotation IDs and sync behavior across:
  - store mutations
  - viewport rendering
  - panel state

### Runtime split (web vs desktop)
- Always guard desktop-only behavior with `isTauri()` (from `src/core/lib/env.ts`).
- Additional guards: `isTauriDesktop()`, `isTauriMobile()`, `isMobile()` for finer-grained checks.
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
  - `read_pdf_file_size`
  - `read_pdf_range`
  - `get_pdf_metadata`
  - `take_pending_open_files`
  - `fetch_rss_feed`
  - `fetch_url_content`
  - `fetch_binary_content`
- SQLite-backed persistence (desktop Tauri only) uses `database::sqlite_*` commands, channeled through `src/core/lib/sqlite-storage.ts`.
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

## Performance & Bundling
- **Never import from the barrel (`src/core/index.ts`).** Import directly from the source module:
  - `cn` → `src/core/lib/utils`
  - `useUIStore`/`useLibraryStore`/`useSettingsStore`/`useVocabularyStore`/`useRssStore` → `src/core/store`
  - `isTauri`/`isMobile` etc. → `src/core/lib/env`
  - Types → `src/core/types`
  - Specific lib/services → their exact module path
  - Barrel re-exports everything — importing from it prevents tree-shaking and bundles all stores/services together.
- **Use Zustand individual selectors, never destructuring.** `const x = useStore(s => s.x)` subscribes to only `x`, while `const { x } = useStore()` subscribes to the entire store and re-renders on any change.
- **Wrap heavy/reusable components in `React.memo()`**, especially:
  - List items rendered via `.map()` (e.g., `BookCard`)
  - `forwardRef` components (e.g., `ReaderViewport`, `PDFJsEngine`)
  - Shell chrome (`Sidebar`, `BottomNav`, `AppTitlebar`)
- **Lazy-load heavy deps that aren't needed on every route:**
  - `soundtouchjs` (TTS) — lazy `import("./audio/ImmersionPlayer")` only when user activates TTS
  - `pdfjs-dist` — already dynamic via `prewarmPdfJsRuntime()`
  - `@mozilla/readability`, `fast-xml-parser` — dynamic `import()` inside RSS functions
  - `html-to-image` — dynamic `import()` inside `captureCardAsImage`/`downloadImage`
- **Use `React.lazy()` for route-level components** (already done in `App.tsx`).
- **Use `pnpm build` to verify chunk splitting** — inspect `dist/assets/` for unexpected size bloat.

## Accessibility Requirements
- **Modal component**: Must have `role="dialog"`, `aria-modal="true"`, `aria-labelledby` connected to header, focus trap (Tab/Shift+Tab within modal only), focus restoration on close, and `aria-hidden="true"` on background content while open.
- **Interactive elements must be keyboard accessible**: Any `<div>` with `onClick` must have `role="button"`, `tabIndex={0}`, and `onKeyDown` handler for Enter/Space.
- **Icon-only buttons must have `aria-label`** (or `aria-labelledby`). `title` alone is insufficient for screen readers.
- **Form inputs must use `htmlFor`/`id`** for label association. Wrapping `<label>` around `<input>` is not reliable for screen readers.
- **Dynamic content needs `aria-live` regions**: Use `role="status" aria-live="polite"` with `sr-only` class for status announcements (sync, playback, navigation).
- **Range sliders** must retain visible focus indicators — never `outline: none` without a visible `box-shadow`/`ring` alternative.
- **Color contrast** must meet WCAG AA (4.5:1 for normal text). Dark theme error colors need lighter hues (e.g., `#ef5350` on black).
- **Navigation landmarks** (`<nav>`) should have distinct `aria-label` (e.g., `"Main navigation"`, `"Primary navigation"`).

## Explicit anti-patterns for this repo
- Do not introduce React Router routing for page navigation.
- Always use React portal model for overlay
- Do not replace Zustand route state with local component routing state.
- Do not hardcode colors where design tokens exist.
- Do not directly edit vendored foliate-js internals for app-level behavior tweaks if the wrapper/engine layer can solve it.
- Do not import from the barrel (`src/core/index.ts`). Import from specific source modules only.
