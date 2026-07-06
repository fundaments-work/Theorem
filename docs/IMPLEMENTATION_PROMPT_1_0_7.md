You are tasked with implementing the performance and sync fixes documented in `docs/PERFORMANCE_SYNC_AUDIT.md`. This is a systematic, multi-step implementation for the Theorem 1.0.7 release. Read the full audit document before starting.

## Branch Strategy

Create a single branch: `release/1.0.7`
Do all work on this branch. Do not create sub-branches per fix.

```bash
git checkout -b release/1.0.7
```

## Implementation Order (P0 → P1 → P2)

Execute fixes in priority order from section 11 of the audit document. For each fix:

1. Read the relevant source files first
2. Make the change (minimal diff, no unrelated refactors)
3. Run quality gates immediately after each logical set of changes:
   - `pnpm typecheck` (always)
   - `cd src-tauri && cargo fmt && cargo clippy && cargo check` (if any .rs changed)
4. If quality gates fail, fix the failures before committing
5. Commit with a descriptive message: `fix: <what was fixed>`

## P0 — Startup + Crash Prevention (do these first)

### P0-1: Kill white flash on startup
- `tauri.conf.json`: add `"visible": false` inside the window config
- `src/App.tsx`: add `useEffect` that calls `getCurrentWebviewWindow().show()` after React's first render
- If `getCurrentWebviewWindow` is not already imported, import from `@tauri-apps/api/window`

### P0-2: Add loader HTML in index.html
- `index.html`: inside `<div id="root">`, add an inline CSS spinner + "Theorem" text that React will replace on mount
- Use a simple CSS keyframe animation (no external deps)

### P0-3: Fix settings mobile scroll jank
- `src/features/settings/Settings.tsx`: remove `snap-x snap-mandatory snap-start` from the mobile tab bar (around line 649-667)
- Keep `overflow-x-auto` and `flex gap-2` but drop the snap classes

### P0-4: Replace transition-all on progress bar
- `src/features/settings/Settings.tsx`: find the progress bar div with `transition-all duration-500` (around line 844) and change `transition-all` to `transition-[width]`

### P0-5: Batch SQLite startup reads
- `src-tauri/src/database.rs`: add a `sqlite_batch_get_kv` command that takes `Vec<String>` keys, runs `SELECT key, value FROM kv_store WHERE key IN (...)` and returns a `Vec<(String, String)>`
- `src/core/lib/persist-storage.ts`: create a `hydrateAllStores()` function that calls the batch command once instead of 5 separate `sqliteGetKv` calls
- OR: if batching is too complex for a first pass, just add `PRAGMA busy_timeout = 5000` to `with_connection()` in `database.rs` to prevent SQLITE_BUSY crashes

### P0-6: Strip locations from Zustand persistence
- `src/core/store/index.ts`: in the library store's `partialize` function, strip `locations` from each book object (add it to the destructured fields alongside `coverPath`)
- `src/core/store/index.ts`: add a `bookLocations` field to the store state (not persisted) or create `src/core/lib/book-locations.ts` that reads/writes `locations` to SQLite via `sqliteSetBlob`/`sqliteGetBlob` using the book ID as key

### P0-7: Add busy_timeout to SQLite
- `src-tauri/src/database.rs`: add `PRAGMA busy_timeout = 5000;` to the `with_connection()` PRAGMA batch
- Also add performance PRAGMAs: `cache_size = -8000`, `mmap_size = 268435456`, `temp_store = MEMORY`, `journal_size_limit = 67108864`

## P1 — Sync Correctness

### P1-8: Fix device dedup
- Search `sync_server.rs` and `sync_commands.rs` for all uses of `identity.fingerprint` in `/pair`, QR generation, and `submit_pairing_code`
- Replace with `identity.effective_fingerprint()` (this function already exists, just isn't being called consistently)
- Verify the method exists on the identity struct — if it's `identity.effective_fingerprint()`, use that; if it's a free function, import and call it

### P1-9: Guard concurrent merge
- `src/core/lib/sync-orchestrator.ts`: in `runDeviceSync()`, at the top of the function, check `if (_isMerging) return;` same as `handleIncomingComplete` does
- Set `_isMerging = true` before merging, set to `false` in finally block

### P1-10: Vocabulary tombstones
- `src/core/types/index.ts`: add `"vocabulary"` to the `TombstoneEntity` union type
- `src/core/store/index.ts`: in `deleteVocabularyTerm()`, add a tombstone with `entityType: "vocabulary"` and `entityId: termId`
- `src/core/lib/sync-import.ts`: in `mergeVocabulary()`, accept tombstones parameter, filter out tombstoned term IDs

### P1-11: Per-key settings merge
- `src/core/lib/sync-import.ts`: in `mergeSettings()`, instead of whole-object LWW replacement, merge at the field level: iterate keys of both objects, for each key pick the one with the newer `_settingsUpdatedAt` (or just use the current whole-object timestamp comparison but exclude `deviceSync` from the merge since it's local-only)

### P1-12: Collection book removal sync
- `src/core/types/index.ts`: add `"collection_book"` to `TombstoneEntity` union
- `src/core/store/index.ts`: in `removeBookFromCollection()`, create a tombstone with `entityType: "collection_book"`, `entityId: `${collectionId}:${bookId}``
- `src/core/lib/sync-import.ts`: in `mergeCollections()`, filter out tombstoned collection:bookId pairs from `bookIds`

### P1-13: RSS content truncation in sync
- `src/core/lib/sync-orchestrator.ts`: in `buildDomainsAndManifest()`, when building the `rss_articles` domain, apply the same 50KB content truncation and 500-article cap that the persist `partialize` applies in `store/index.ts:2426-2447`

## P2 — Performance

### P2-14: Guard animations behind prefers-reduced-motion
- `src/index.css`: wrap the `@keyframes fade-in` and `.animate-fade-in` in `@media (prefers-reduced-motion: no-preference) { ... }`

### P2-15: CSS hidden for settings tabs
- `src/features/settings/Settings.tsx`: instead of `{activeTab === "general" && <div>...</div>}`, render all tab content as `<div className={activeTab === "general" ? "" : "hidden"}>...</div>` — this prevents DOM teardown/rebuild on tab switch

### P2-16: Add CSS containment and scroll properties
- `src/index.css` or `src/App.tsx`: on `#app-main`, add `-webkit-overflow-scrolling: touch` and `overscroll-behavior: contain`
- Add `content-visibility: auto` to the settings page content container

### P2-17: React.memo on page components
- `src/features/settings/Settings.tsx`: export `const SettingsPage = memo(function SettingsPage() { ... })`
- Import `memo` from React if not already imported

### P2-20: Batch cover restore setState
- `src/core/store/index.ts`: in the cover restore loop inside `onRehydrateStorage`, accumulate all cover updates in a Map, then call `setState` once at the end instead of per-batch

### P2-21: O(1) dedup in addBooks
- `src/core/store/index.ts`: in `addBooks()`, before the loop, build a `Set` or `Map` from existing books for O(1) lookup instead of calling `findDuplicateBookIndex()` which does O(n) scans

### P2-22: Route Connection::open through r2d2 pool
- `src-tauri/Cargo.toml`: add `r2d2 = "0.8"` and `r2d2_sqlite = "0.25"` dependencies
- `src-tauri/src/database.rs`: create a `static DB: OnceLock<r2d2::Pool<SqliteConnectionManager>>`. Initialize on first access with all PRAGMAs. Replace `with_connection()` to get connections from the pool instead of opening new ones.
- Update all callers to use the pool — this should be a drop-in replacement since the pool's `get()` returns a connection that implements the same traits

## Workflow Rules

### Before each commit
```bash
pnpm typecheck
cd src-tauri && cargo fmt && cargo clippy && cargo check && cd ..
```
If any fail, fix the issues BEFORE committing. Do not commit with warnings.

### Commit style
- One commit per logical fix group (e.g., "fix: kill white flash on startup (P0-1 through P0-2)")
- Use `fix:` prefix for bug fixes, `perf:` for performance improvements
- Reference the audit section in the commit body

### When confused or stuck
- Read the full relevant section in `docs/PERFORMANCE_SYNC_AUDIT.md`
- Read the actual source files mentioned at the specific line numbers
- Search the internet for library docs (e.g., "r2d2 rusqlite example", "zustand persist partialize example")
- Read `AGENTS.md` for repo conventions

### Library preference
- **Always prefer a mature library over custom code.** Check `docs/PERFORMANCE_SYNC_AUDIT.md` section 10 for the library reinvention audit.
- When adding new Rust deps, check if they're already in `Cargo.lock` as transitive deps — use the same version.
- When adding new npm deps, prefer lightweight options (see audit for specific recommendations).

### Do not touch
- `src/features/reader/foliate-js/**` — vendored, do not edit
- `pnpm-lock.yaml` — only change through `pnpm install` when adding deps
- `src-tauri/gen/**` — generated code

## After all P0-P2 fixes are committed
Run a final full verification:
```bash
pnpm typecheck && pnpm build && cd src-tauri && cargo fmt && cargo clippy && cargo check && cd ..
```
Push the branch:
```bash
git push origin release/1.0.7
```

## Success criteria
- [ ] White flash eliminated on startup
- [ ] Settings page scrolls smoothly on mobile
- [ ] `pnpm typecheck` passes with zero errors
- [ ] `cargo clippy` passes with zero warnings
- [ ] `cargo check` passes with zero errors
- [ ] All commits are on `release/1.0.7` branch
- [ ] Branch is pushed to remote

Skip any fix that requires files that don't exist or APIs that have changed. If a fix proves too complex, note it in a comment on the commit and move to the next one.
