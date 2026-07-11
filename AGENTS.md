# AGENTS.md

Operational guide for AI coding agents working in this repository.

## Product + Stack
- Theorem is a Tauri-first desktop reader with web fallback.
- Frontend stack: React 19, TypeScript, Vite 6, Tailwind CSS v4, Zustand.
- Reader stack:
  - Reflowable/fixed ebook formats via Foliate integration.
  - PDF via PDF.js engine.
  - RSS article reading via dedicated article reader path.

## Non-Negotiable Quality Gates (Before Every Commit)

**These run before EVERY commit. No exceptions.**

| Step | Command | Must Pass? |
|------|---------|------------|
| TypeScript typecheck | `pnpm typecheck` | Zero errors |
| JavaScript/TS linter | `pnpm lint` | Zero errors |
| Rust format | `cd src-tauri && cargo fmt` | No diff |
| Rust clippy | `cd src-tauri && cargo clippy` | Zero warnings |
| Rust typecheck | `cd src-tauri && cargo check` | Zero errors |

Rule: **Never commit or push code that fails any of these.** If you touch only `.ts`/`.tsx` files, run `pnpm typecheck` and `pnpm lint`. The linter uses Biome (Rust-based, fast) — it catches unused imports, `console.log` in production, missing error handling, and code style issues. If you touch any `.rs` file, run all four Rust gates.

Biome linter is check-only (no auto-fix). Detected issues must be fixed manually.

Additional validation per scope:

| Scope | Extra verification |
|-------|--------------------|
| Persistence/migration changes | Audit migration version bump + defaults |
| High-risk UI/runtime changes | `pnpm build` (verifies prod bundle) |
| Tauri command signature change | Update both Rust and TypeScript call sites |
| Any `lib.rs` module registration | Verify the module is declared + `pub use` if needed |

## Pre-commit Workflow (Preferred Order)

```bash
# 1. Rust formatting (if any .rs file changed)
cd src-tauri && cargo fmt && cd ..

# 2. Rust clippy (must be zero warnings)
cd src-tauri && cargo clippy && cd ..

# 3. TypeScript typecheck + linter
pnpm typecheck
pnpm lint

# 4. If typecheck/clippy/lint pass, commit
git add -A
git commit -m "..."

# 5. Push
git push origin <branch>
```

Do not skip clippy. Do not commit with clippy warnings still present. Fix them first.

## Non-Negotiable Reality Checks
- Navigation is store-driven (`useUIStore.currentRoute`), not React Router route objects.
- Imports are primarily relative/barrel imports inside `src`. Do not assume `@/*` or `@theorem/*` aliases.
- `src/features/reader/foliate-js/**` is vendored upstream code (git submodule pointing to `johnfactotum/foliate-js`). Do not edit. Run `git submodule update --init --recursive` after clone, and `git submodule update --remote` to pull upstream changes.
- `src/features/reader/foliate-js-runtime/**` is the runtime wrapper for foliate-js. This IS our code — modify freely.
- CBR is supported via import-time conversion to CBZ (Rust `unrar-ng` decompression).

## Import Architecture
- `src/core/index.ts` is the primary barrel: re-exports `lib/`, `store/`, `types/`, `services/`.
- Most app code imports from `"./core"` or `"../core"` — prefer this pattern.
- There are no path aliases (`@/`, `@theorem/*`); tsconfig has none.

## Repository Map
```text
src/
  App.tsx                       # Route switch driven by useUIStore
  core/
    index.ts                    # Barrel re-exporting lib, store, types, services
    types/index.ts              # Core domain contracts (Book, Annotation, settings, routes)
    store/                      # Zustand stores (slices — one file per store)
      index.ts                  # Barrel re-exporting all 5 stores
      uiStore.ts                # useUIStore (navigation, search, dialogs)
      libraryStore.ts           # useLibraryStore (books, collections, annotations)
      settingsStore.ts          # useSettingsStore (settings, stats, migrations)
      vocabularyStore.ts        # useVocabularyStore (terms, dictionaries, lookup)
      rssStore.ts               # useRssStore (feeds, articles)
    lib/                        # Runtime helpers (env, storage, import, design tokens, dialogs, vault sync)
    services/                   # Dictionary, StarDict, RSS services
  shell/                        # App chrome (sidebar, titlebar, bottom nav, error boundary)
  ui/                           # Shared UI primitives (Modal/Dropdown/Panel/ContextMenu/Backdrop)
  features/
    reader/
      engines/
        foliate-engine.ts       # FoliateEngine class — main book rendering API
        pdfjs-engine.tsx        # PDF.js engine
      hooks/
        useDocumentReader.ts    # Bridge between React and FoliateEngine
      foliate-js/               # VENDORED — git submodule (johnfactotum/foliate-js)
      foliate-js-runtime/       # OUR runtime wrapper — can edit
        view.js                 # makeBook(), makeZipLoader(), FoliateView web component
        epub.js                 # EPUB.init() — OPF/manifest/spine/TOC parsing
        comic-book.js           # CBZ rendering
        vendor/zip.js           # @zip.js/zip.js (minified, keep as-is)
        vendor/fflate.js        # fflate for MOBI zlib decompression
    library/                    # Library/shelves/bookmarks/annotations pages
    vocabulary/                 # Vocabulary workspace
    feeds/                      # Feed subscriptions + article list
    settings/                   # App settings and data management
    statistics/                 # Reading stats
    onboarding/                 # First-run onboarding flow
src-tauri/
  Cargo.toml                    # Workspace root (members: theorem, theorem-sync-core, sync-daemon)
  src/
    lib.rs                      # Tauri commands + runtime bootstrap
    main.rs                     # Entry point (calls theorem_lib::run())
    database.rs                 # SQLite persistence (books, covers, kv_store, blob_store)
    epub_parser.rs              # Native EPUB pre-parser (prefetch_zip_metadata command)
    tts.rs                      # TTS orchestration
    sync_commands.rs          # All sync Tauri commands
  crates/
    theorem-sync-core/          # Shared sync library (crypto, protocol, embedded HTTP server)
    sync-daemon/                # Standalone background sync daemon (sidecar)
  tauri.conf.json               # Window config, CSP, bundling resources
docs/
  PERFORMANCE_SYNC_AUDIT.md     # Full performance + sync audit with scale analysis + fixes
  NEW_FEATURES_ARCHITECTURE.md  # Newsletter, accent color, file sync, Cloudflare sync design
```

## Required Commands
- Install: `git clone --recurse-submodules && pnpm install`
- Web dev: `pnpm dev`
- Desktop dev: `pnpm dev:tauri` or `pnpm tauri dev`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint`
- Build: `pnpm build`
- Preview: `pnpm preview`
- Rust-only build: `cd src-tauri && cargo build --release`
- Rust check: `cd src-tauri && cargo check`
- Rust format: `cd src-tauri && cargo fmt`
- Rust lint: `cd src-tauri && cargo clippy`

Notes:
- Run root `pnpm` commands from repo root.
- Run cargo commands from `src-tauri/`.
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
- If your release workflow needs Android project files versioned, remove `src-tauri/gen/android/` from `.gitignore` and use the generated project's nested `.gitignore` files (`src-tauri/gen/android/.gitignore`, `src-tauri/gen/android/app/.gitignore`) as baseline.

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
- Stores live in `src/core/store/` (one file per store, barrel `index.ts` re-exports all):
  - `uiStore.ts` → `useUIStore` (ephemeral UI/navigation/search/vault sync state)
  - `libraryStore.ts` → `useLibraryStore` (books/collections/annotations + persisted cache)
  - `settingsStore.ts` → `useSettingsStore` (settings/stats)
  - `vocabularyStore.ts` → `useVocabularyStore` (terms/dictionaries/lookup cache)
  - `rssStore.ts` → `useRssStore` (feeds/articles/current article)
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

### EPUB pre-parser (native Rust fast path)
- `src-tauri/src/epub_parser.rs` provides `prefetch_zip_metadata` Tauri command.
- On Tauri, the JS `makeZipLoader()` calls this in parallel with zip.js. When the prefetch provides `textCache` + `sizes`, zip.js's `getEntries()` is skipped entirely — all text comes from the pre-decoded cache.
- The `makeZipLoader` function in `src/features/reader/foliate-js-runtime/view.js` is the bridge between the Rust prefetch and foliate-js.
- Rust pre-parser uses `quick-xml` (streaming) for OPF/nav/NCX XML parsing, never regex.
- `read_zip_entry()` has percent-encoded path fallback for real-world EPUBs.
- `read_rootfile_path()` strips UTF-8/UTF-16 BOMs from container.xml.
- The command runs on `tauri::async_runtime::spawn_blocking` for true parallelism.
- When changing the `ZipPrefetch` struct or command signature, update both:
  - `src-tauri/src/epub_parser.rs` (struct + command)
  - `src/core/lib/tauri-epub-bridge.ts` (TypeScript interface `EpubPrefetchResult`)
  - `src/features/reader/foliate-js-runtime/view.js` (consumer of the cache)

### Runtime split (web vs desktop)
- Always guard desktop-only behavior with `isTauri()` (from `src/core/lib/env.ts`).
- Additional guards: `isTauriDesktop()`, `isTauriMobile()`, `isMobile()` for finer-grained checks.
- Keep browser fallbacks for dialogs/storage/network where already implemented.
- RSS/article fetch logic intentionally uses Tauri invokes in desktop mode to bypass browser CORS restrictions.

### Column layout (paginator internals)
- The `foliate-paginator` uses a CSS grid in its closed shadow DOM.
- The `#container` (grid cell that holds the view) has a fixed size determined by grid track sizing — NOT by iframe content. Its `getBoundingClientRect()` is valid immediately, no layout-settle delay needed.
- The `beforeRender()` call during `View.load()` measures `#container` ONLY. Since the container size is grid-determined, the measurement is correct on the very first attempt.
- Zoom is applied to the new section's document via `applyZoomToDocument()` inside the `load` event handler, which fires BEFORE `beforeRender()` and `columnize()`. So columns are calculated with zoom already active.
- Navigation methods (`goTo`, `goToFraction`, `open`) call `applyZoomSync()` after navigation completes. This re-applies zoom (redundant, harmless) and calls the paginator's `render()` to recalculate columns as a safety net.
- The relocate handler's section-change detection (`next()`/`prev()` wrapping to a new chapter) uses single `requestAnimationFrame(() => applyZoomSync())` — the RAF batches concurrent calls, not to wait for layout settle.

## Placement Rules (Where New Code Goes)
- Shared domain types/contracts: `src/core/types/index.ts`
- Shared state/persistence: `src/core/store/` (one file per store slice)
- Shared utility/runtime integration:
  - storage/import: `src/core/lib/storage.ts`, `src/core/lib/import.ts`
  - design tokens/theme sync: `src/core/lib/design-tokens.ts` + CSS tokens
  - dialogs: `src/core/lib/dialogs.ts`
  - vault markdown sync: `src/core/lib/vault-sync.ts`
  - epub prefetch bridge: `src/core/lib/tauri-epub-bridge.ts`
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
  - `prefetch_zip_metadata`
  - `update_sync_notification`
- SQLite-backed persistence (desktop Tauri only) uses `database::sqlite_*` commands, channeled through `src/core/lib/sqlite-storage.ts`.
- If command payload/return changes, update both Rust and TS call sites together.
- Run `cargo fmt` after Rust changes (required before every commit, see Quality Gates above).
- Run `cargo clippy` after Rust changes (required before every commit, zero warnings allowed).

## Agent workflow expectations
- Make focused changes; avoid unrelated refactors.
- Preserve existing public APIs unless task requires change.
- Prefer minimal-diff edits in reader/store files due high coupling.
- For any persistence-affecting change, include migration updates in same change.
- **Always run the Quality Gates before committing.** No exceptions.
- If clippy emits warnings you don't understand, fix them with `cargo clippy --fix --lib` first, then manually for any remaining ones.
- When adding a new Rust dependency, add it to `Cargo.toml` with the version that matches the existing lockfile if it's already a transitive dep.

## Performance & Bundling
- **Never import from the barrel (`src/core/index.ts`).** Import directly from the source module:
  - `cn` -> `src/core/lib/utils`
  - `useUIStore`/`useLibraryStore`/`useSettingsStore`/`useVocabularyStore`/`useRssStore` -> `src/core/store`
  - `isTauri`/`isMobile` etc. -> `src/core/lib/env`
  - Types -> `src/core/types`
  - Specific lib/services -> their exact module path
  - Barrel re-exports everything — importing from it prevents tree-shaking and bundles all stores/services together.
- **Use Zustand individual selectors, never destructuring.** `const x = useStore(s => s.x)` subscribes to only `x`, while `const { x } = useStore()` subscribes to the entire store and re-renders on any change.
- **Wrap heavy/reusable components in `React.memo()`**, especially:
  - List items rendered via `.map()` (e.g., `BookCard`)
  - `forwardRef` components (e.g., `ReaderViewport`, `PDFJsEngine`)
  - Shell chrome (`Sidebar`, `BottomNav`, `AppTitlebar`)
- **Lazy-load heavy deps that aren't needed on every route:**
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
- Do not recombine store imports — import `useLibraryStore` from `"../../core/store"` (the barrel re-exports from there), not from individual slice files like `"../../core/store/libraryStore"`. The barrel `index.ts` is the canonical import path for stores.
- Do not commit code that fails `pnpm typecheck`, `cargo fmt`, `cargo clippy`, or `cargo check`.
- Do not leave clippy warnings unfixed — clean them up as part of the same commit.
- **Do not add `awaitSettledLayout()` / double-RAF delays after navigation.** The paginator's container dimensions are determined by CSS grid track sizing, not by iframe content — they're correct immediately.
- **Do not use `transition-all`** — always specify the exact property (e.g., `transition-[width]`, `transition-colors`).
- **Do not use `snap-x snap-mandatory` on scroll containers** — kills mobile scroll performance.
- **Do not store large unbounded fields in Zustand** — `book.locations` (foliate-js position data) must live in SQLite BLOB, never in persisted Zustand state.
- **Do not open raw `Connection::open()` without PRAGMAs** — sync paths currently skip WAL mode. All connections must go through `r2d2` pool or `with_connection()`.
- **Do not write `with_connection()` inside loops** — batch queries with `IN (...)` clauses or use a shared connection.
- **Do not use `Array.find()` / `Array.some()` on books array** — use `getBook(bookId)` or `getBookLookup().get(bookId)` for O(1) lookup.
- **Do not use `Array.includes()` on potentially large arrays in render** — convert to `Set` first.
- **Do not call `setState` in batches that trigger re-renders** — accumulate all mutations and call `setState` once.
- **Do not store book covers as base64 TEXT** in SQLite — use BLOB columns.
- **Do not serialize binary file data through JSON** in sync — use binary content-type (no base64 bloat).

## CSS Performance Rules
- Always use `content-visibility: auto` on scrollable content containers (off-screen not rendered).
- Always use `-webkit-overflow-scrolling: touch` + `overscroll-behavior: contain` on scroll containers.
- Never use `transition-all` — list the specific properties being transitioned.
- Never use `snap-x snap-mandatory` inside a parent `overflow-y-auto` (double scroll container).
- Guard heavy animations (`animate-fade-in`) behind `@media (prefers-reduced-motion: no-preference)`.
- Minimize `color-mix(in srgb, ...)` in inline styles — compute at token level once.

## Scale Rules (5000+ Books)
- `book.locations` MUST NOT be stored in the Zustand Book object. Store in SQLite BLOB, read on book open, write on book close. This field can reach 50-100MB across 1000 opened books.
- Books `partialize` must NOT `JSON.stringify` more than 1MB. At 5000 books, split metadata (title, author, cover hash) from runtime state (progress, location) and store runtime state in SQLite tables, not in a single JSON blob.
- `addBooks()` must use a pre-built lookup Map for dedup, not N serial `findIndex()` calls.
- Cover restore on rehydrate must batch all `setState` updates into ONE final call, not trigger 105 individual re-renders.
- Annotation selectors must use per-book queries, not subscribe to the full global annotations array.
- For search/sort/filter at 10K+ items: prefer SQLite queries over JavaScript `Array.filter().sort()`.

## Sync Architecture Direction
- Sync is the flagship feature. No other reading app provides resilient P2P sync.
- Metadata sync uses **iroh-docs** CRDT (range-based set reconciliation). Files use
  **iroh-blobs** (BLAKE3 verified streaming over QUIC). Live notifications use
  **iroh-gossip**. See `docs/PERFORMANCE_SYNC_AUDIT.md`.
- The three-tier network is: iroh N0 DNS/Pkarr (Internet P2P) → iroh relay (fallback)
  → Cloudflare Durable Object (future). See `docs/PERFORMANCE_SYNC_AUDIT.md` section 12.
- When adding sync code: prefer iroh-native protocols over custom implementations.
- The sync daemon and Android worker lifecycle must be tied to `autoSyncEnabled`.
  See `docs/DAEMON_IROH_MIGRATION.md` for the migration plan.
- Device identity dedup requires `effective_fingerprint()` everywhere.
- RSS: 50KB content cap, 500 articles max, 30-day age limit in sync payloads.
- File transfer uses iroh-blobs FsStore for persistent on-disk blob storage.
  Covers use `blobs_add_bytes` / `blobs_download_bytes`.
