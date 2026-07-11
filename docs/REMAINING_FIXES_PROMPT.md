# Agent Prompt: Remaining Quality Fixes

## Prerequisite Status

The following items are **ALREADY DONE** (this session) — do not re-do them, just verify they're complete:

| Item | Status | Proof |
|------|--------|-------|
| Fix silent `.catch(() => {})` | ✅ Done | `grep -rn "\.catch(()\s*=>\s*{})" src/` → 0 results |
| `dangerouslySetInnerHTML` → DOMPurify | ✅ Done | `grep -rn "dangerouslySetInnerHTML" src/` → 0 results (all 10 wrapped) |
| Replace `soundtouchjs` | ✅ Done | Removed from package.json, type declaration deleted |
| `reqwest 0.11→0.12` | ✅ Done | `Cargo.toml` has `version = "0.12"`, compiles |
| `zip 0.6→2.x` | ✅ Done | `Cargo.toml` has `zip = "2"`, `FileOptions` type annotation fixed, compiles |
| `@tauri-apps/plugin-app/window` alpha | ✅ Done | JS deps removed (unused), Rust dep at `2.0.0-alpha.2` (latest) |
| `@types/uuid` in deps | ✅ Done | Moved to devDependencies |

---

## Objective

Fix the 3 remaining quality issues:

1. **Rust integration tests** — Write tests for Tauri commands (database, sync, epub parser)
2. **Zustand stores → slices** — Split the monolithic `store/index.ts` (~2520 lines) into domain slices
3. **`rand 0.8→0.9`** — Upgrade after legacy LWW protocol removal (currently blocked by `chacha20poly1305`'s `rand_core` 0.6 dependency)

---

## 1. Rust Integration Tests

### Where

`src-tauri/tests/` (create directory if needed)

### What to test

Write integration tests for the following Tauri commands and backend functions. Use `#[cfg(test)]` modules in the existing Rust files, or create a separate `tests/` directory with integration tests.

#### a) Database commands (`src-tauri/src/database.rs`)

```rust
// Test SQLite operations:
// - sqlite_get_book / sqlite_save_book round-trip
// - sqlite_get_cover_image / sqlite_save_cover_image
// - sqlite_get_kv / sqlite_set_kv (key-value store)
// - sqlite_batch_get_kv
// - schema migrations (run_schema_migrations)
// - book search (sqlite_search_books)
```

Create an in-memory SQLite database (`:memory:`) for each test to avoid polluting real data.

#### b) EPUB pre-parser (`src-tauri/src/epub_parser.rs`)

```rust
// Test with a minimal synthetic EPUB (ZIP file in memory):
// - read_rootfile_path() with container.xml
// - read_epub_metadata() with OPF
// - prefetch_zip_metadata() end-to-end
// - Percent-encoded path handling
// - BOM stripping from container.xml
```

Create test fixtures as byte arrays (small synthetic EPUBs as ZIP files).

#### c) iroh sync helpers (`src-tauri/src/iroh_sync.rs`)

```rust
// Test iroh-docs operations:
// - doc creation + entry set/get round-trip
// - subscribe_doc_events listener registration
// - Pairing request/response serialization
```

These need an iroh runtime. Use `iroh_test` utilities if available, or create a minimal test endpoint.

#### d) Sync commands (`src-tauri/src/sync_commands.rs`)

```rust
// Test Tauri command wrappers:
// - docs_set_entry → docs_get_all_entries round-trip
// - blobs_add_bytes → blobs_download_bytes
// - init_sync error handling
```

Use `tauri::test` if available (Tauri v2 test utils), or test the underlying functions directly.

### Example test pattern

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqlite_book_roundtrip() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        // Run migrations
        run_schema_migrations_inner(&conn).unwrap();
        // Save a book
        let book = create_test_book();
        sqlite_save_book_inner(&conn, &book).unwrap();
        // Load it back
        let loaded = sqlite_get_book_inner(&conn, &book.id).unwrap();
        assert_eq!(loaded.id, book.id);
        assert_eq!(loaded.title, book.title);
    }
}
```

### Files to create/modify

| File | Action |
|------|--------|
| `src-tauri/tests/database_tests.rs` | Create — SQLite round-trip + migration tests |
| `src-tauri/tests/epub_parser_tests.rs` | Create — synthetic EPUB parsing tests |
| `src-tauri/tests/iroh_sync_tests.rs` | Create — iroh-docs CRUD tests |
| `src-tauri/Cargo.toml` | Modify — add `[dev-dependencies]` if needed |
| Existing `#[cfg(test)]` modules | Add tests to existing modules in `database.rs`, `epub_parser.rs` |

### Success criteria

- `cd src-tauri && cargo test` — all tests pass
- At least 20 test cases across all areas
- Tests use in-memory databases (never touch real files)
- Tests clean up after themselves

---

## 2. Split Zustand Stores into Slices

### Where

`src/core/store/index.ts` (~2520 lines) — split into domain slices.

### Current architecture

The monolithic store exports 5 Zustand stores from one file:
- `useUIStore` — navigation, search, dialogs
- `useLibraryStore` — books, collections, annotations, covers
- `useSettingsStore` — app settings, reading stats, device identity
- `useVocabularyStore` — terms, dictionaries, lookup cache
- `useRssStore` — feeds, articles, current article

### Target architecture

Split into individual slice files:

```
src/core/store/
  index.ts              # Barrel — re-exports all stores (keep for backward compat)
  uiStore.ts            # useUIStore
  libraryStore.ts        # useLibraryStore
  settingsStore.ts       # useSettingsStore
  vocabularyStore.ts     # useVocabularyStore
  rssStore.ts           # useRssStore
  migrations.ts          # Versioned migration functions (extract from stores)
  persist.ts            # Persist middleware config (extract from stores)
```

### Migration steps

#### Step 1 — Extract each store into its own file

For each store (e.g., `useLibraryStore`):

1. Create `src/core/store/libraryStore.ts`
2. Copy the store definition (state interface + actions + create() call)
3. Include only the imports that store needs
4. Add `export` to the store
5. In `index.ts`, add `export { useLibraryStore } from './libraryStore'`

For example:

```typescript
// src/core/store/libraryStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Book, Collection, Annotation } from '../types';

interface LibraryState {
    books: Book[];
    collections: Collection[];
    annotations: Annotation[];
    // ... all fields
}

interface LibraryActions {
    addBooks: (books: Book[]) => void;
    removeBook: (bookId: string) => void;
    // ... all actions
}

export const useLibraryStore = create<LibraryState & LibraryActions>()(
    persist(
        (set, get) => ({
            books: [],
            collections: [],
            // ... initial state

            addBooks: (books) => set((state) => {
                const lookup = new Map(state.books.map(b => [b.id, b]));
                books.forEach(b => lookup.set(b.id, b));
                return { books: [...lookup.values()] };
            }),
            // ... all actions
        }),
        {
            name: 'theorem-library',
            partialize: (state) => ({
                books: state.books.map(({ locations, ...rest }) => rest),
                collections: state.collections,
            }),
            version: CURRENT_VERSION,
            migrate: /* migration functions */,
        }
    )
);
```

#### Step 2 — Extract shared types and config

- **`migrations.ts`**: Extract all version constants and migration functions into a shared module. Each store's migration function can live here.
- **`persist.ts`**: Extract shared persist middleware configuration if any (storage backend, serialize/deserialize, etc.)

#### Step 3 — Verify imports

Ensure all files that import from `"../../core/store"` still work. The barrel `index.ts` should re-export everything:

```typescript
// src/core/store/index.ts
export { useUIStore } from './uiStore';
export { useLibraryStore } from './libraryStore';
export { useSettingsStore } from './settingsStore';
export { useVocabularyStore } from './vocabularyStore';
export { useRssStore } from './rssStore';
```

### Verification

- `pnpm typecheck` — zero errors
- `pnpm test` — 220/220 tests pass (state-dependent tests may need snapshot updates)
- `pnpm build` — production build succeeds
- App loads without runtime errors (navigation, library display, settings, vocabulary, feeds all work)
- No change in user-facing behavior (same API, same selectors)

### Risks

- **Cross-store imports**: Some stores may import from each other (e.g., `useLibraryStore` importing `useSettingsStore`). These create circular dependency risks. Fix by:
  1. Moving shared logic to a standalone module
  2. Using `get()` from Zustand's store API to read other stores
  3. If cross-store reads are needed, use `useLibraryStore.getState()` inside actions of other stores

- **Store tests**: If there are tests that directly test store internals, they'll need import path updates

- **Migration functions**: These may reference both stores' state shapes. Extract shared migration types to `migrations.ts`.

---

## 3. `rand 0.8 → 0.9` (Post-Legacy-LWW)

### Prerequisite

This upgrade is **blocked** until the legacy LWW sync protocol is removed (see `docs/LEGACY_LWW_REMOVAL_PROMPT.md`). The blocker is:

```
chacha20poly1305 v0.10 → aead → rand_core v0.6
rand v0.9               → rand_core v0.9  ← CONFLICT
```

Once `chacha20poly1305` (and the rest of the legacy crypto) is removed:

### Steps

1. **Update versions** in both `Cargo.toml` files:

```toml
# src-tauri/Cargo.toml
rand = "0.9"

# src-tauri/crates/theorem-sync-core/Cargo.toml
rand = "0.9"
```

2. **Fix API changes** (file: `crates/theorem-sync-core/src/sync_crypto.rs`):

In rand 0.9, `OsRng` no longer directly implements `RngCore` the same way. The `fill_bytes()` method changes:

```rust
// OLD (rand 0.8):
use rand::RngCore;
OsRng.fill_bytes(&mut nonce_bytes);

// NEW (rand 0.9):
use rand::Rng;
let mut rng = rand::rngs::OsRng;
rng.fill_bytes(&mut nonce_bytes);
```

Or use the new `rand::rng()` shorthand:

```rust
use rand::Rng;
let mut rng = rand::rng();
rng.fill_bytes(&mut nonce_bytes);
```

3. **Run verification**:

```bash
cd src-tauri && cargo check    # Must compile
cargo clippy                    # Zero warnings
cargo test                      # All pass
```

---

## Post-Fix Docs Update

After all fixes are complete, update these documentation files:

### `docs/COMPREHENSIVE_AUDIT.md`

- Move completed items from "Not Fixed" to "Fixed" section
- Update counts (currently 34/42 fixed)
- Remove or update section 11 (remaining issues)
- Add a new subsection for any new items found

### `docs/PERFORMANCE_SYNC_AUDIT.md`

- Add new items to the hotfix table (80+)
- Update the total count

### `AGENTS.md`

- Check if any new patterns should be documented (e.g., store slice pattern)
- Update the store rules if the slices changed import paths

---

## Verification Checklist

```bash
# Rust
cd src-tauri && cargo check     # Zero errors
cargo clippy                     # Zero warnings
cargo fmt                        # No diff
cargo test                       # All tests pass

# TypeScript
cd .. && pnpm typecheck          # Zero errors
pnpm lint                        # Zero errors
pnpm test                        # 220/220 pass
pnpm build                       # Production build succeeds

# Manual smoke test
pnpm dev                         # App loads, navigation works
```

## Not In Scope

- Legacy LWW protocol removal (separate prompt in `docs/LEGACY_LWW_REMOVAL_PROMPT.md`)
- Reader.tsx refactoring
- TanStack Query integration
- `useOptimistic` for likes/favorites
