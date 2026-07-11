# Theorem — Comprehensive Codebase Audit

Generated: v1.0.8 (updated from v1.0.7)
Scope: Full-stack audit covering Rust, TypeScript, dependencies, performance, security, accessibility, and test coverage.

---

## 0. Fix Status

### ✅ Fixed

| # | Issue | Status | Fixed In |
|---|-------|--------|----------|
| 1.1 | Unwrapped `Result`s in iroh_sync.rs | ✅ Fixed (15 unwrap calls → proper error handling) | v1.0.7 |
| 1.2 | `local.unwrap()` fragile pattern | ✅ Fixed (map_err + unwrap_or_else) | v1.0.7 |
| 1.3 | XSS via `dangerouslySetInnerHTML` | ✅ Fixed (10 locations wrapped with DOMPurify) | v1.0.7 |
| 1.4 | `book.locations` in Zustand | ✅ Fixed (stripped from partialize, stored in SQLite BLOB) | v1.0.7 |
| 1.5 | Silent `.catch(() => {})` | ✅ Fixed (26 locations → console.error) | v1.0.7 |
| 2.1 | Rust deps: `axum`, `tower-http`, `local-ip-address` | 🔶 `axum`/`tower-http` still used by sync-daemon controller; `local-ip-address` removed | v1.0.7 |
| 2.2 | JS deps: alpha plugins, `soundtouchjs`, `@types/uuid` | ✅ Fixed: removed `@tauri-apps/plugin-app`, `@tauri-apps/plugin-window`, `soundtouchjs` (all dead); moved `@types/uuid` to devDeps | v1.0.7 |
| 3.2 | No centralized toast system | ✅ Fixed (sonner `<Toaster />` added to App.tsx) | v1.0.7 |
| 4.1 | Security audit (DOMPurify, .unwrap(), .catch()) | ✅ Fixed — all 3 categories resolved | v1.0.7 |
| 6 | Recommended deps (sonner, dompurify) | ✅ Both installed and in use | v1.0.7 |
| 7 | Dep upgrades (reqwest 0.12, zip 2.x) | ✅ Both upgraded and compiling. `rand 0.9` blocked by `chacha20poly1305`'s `rand_core 0.6` dep — resolves after legacy LWW removal | v1.0.7 |
| 8.3 | `content-visibility: auto` | ✅ Added on 7 scroll containers | v1.0.7 |
| 10.3 | No centralized toast | ✅ Fixed (sonner) | v1.0.7 |
| 10.4 | React.memo incomplete | ✅ SettingsPage, ArticleViewer, BookCard, ReaderPage wrapped | v1.0.7 |
| 10.6 | Rust `.unwrap()` calls | ✅ Fixed (15 calls) | v1.0.7 |
| 10.8 | Silent `.catch(() => {})` | ✅ Fixed | v1.0.7 |
| 10.9 | `content-visibility: auto` | ✅ Fixed | v1.0.7 |
| 10.10 | Barrel imports | ✅ Audited — codebase already compliant (never imports from barrel) | v1.0.7 |
| — | `searchBooks()` O(n) uncached | ✅ WeakMap cache added | v1.0.7 |
| — | `addBookToCollection()` O(n) `.some()` | ✅ Changed to O(1) `getBookLookup` | v1.0.7 |
| — | Missing DB indexes (title, author, cover) | ✅ Added `CREATE INDEX` | v1.0.7 |
| — | Covers table `data_url` TEXT → `data BLOB` | ✅ Added column + safe migration | v1.0.7 |
| — | Database migration doesn't run on existing pools | ✅ `run_schema_migrations()` separated | v1.0.7 |
| — | Sync daemon blocks iroh-docs CRDT path | ✅ `isDaemonReady()` checks for paired peers | v1.0.7 |
| — | Live events dropped during `_isMerging` | ✅ Rescheduled (2s retry) | v1.0.7 |
| — | False "Synced" with 0 books on fresh device | ✅ Stability guard added | v1.0.7 |
| — | Concurrent sync loops race | ✅ Global `sync_lock` added | v1.0.7 |
| — | Stale ChaCha20 encryption UI claim | ✅ Removed from DeviceSync.tsx | v1.0.7 |
| — | PairedDevice type drops 3 fields | ✅ Added `fingerprint`, `peerRelayUrl`, `syncDocId` | v1.0.7 |
| — | Settings page provisions after pairing | ✅ `ensureResponderSyncReady` on mount | v1.0.7 |
| — | Sync status persists to localStorage | ✅ Removed from `partialize` | v1.0.7 |
| — | Settings migration forces `autoSyncEnabled: false` | ✅ Fixed | v1.0.7 |
| — | `docs_get_all_entries` corrupts JSON objects | ✅ Fixed | v1.0.7 |
| — | Verification test suite created | ✅ 26 tests | v1.0.7 |
| — | Fix script created | ✅ `scripts/fix-audit-issues.sh` | v1.0.7 |
| — | Rust integration tests (database + epub parser) | ✅ 43 unit tests: 25 database (KV, blob, cover, FTS, metadata, annotations), 18 epub parser (BOM, path resolution, OPF parsing, synthetic EPUBs) | v1.0.7 |
| — | Zustand store split into slices | ✅ `index.ts` (2525→5 lines barrel), 5 domain files (`uiStore.ts`, `libraryStore.ts`, `settingsStore.ts`, `vocabularyStore.ts`, `rssStore.ts`) | v1.0.7 |
| — | Legacy LWW protocol removed | ✅ Removed TheoremProtocolHandler, sync_with_peer, all handle_*_req, initiate_sync, sync_now, start/stop/wake_background_sync, set_sync_data, get_incoming_sync_data | v1.0.7 |
| — | sync-daemon sidecar removed | ✅ Deleted `crates/sync-daemon/` (HTTP axum server, port 43935) | v1.0.7 |
| — | DeviceIdentity crypto simplified | ✅ Removed x25519-dalek, chacha20poly1305, hkdf, rand — device_id now derived from iroh key | v1.0.7 |
| — | Android JNI rewritten to iroh-docs | ✅ `runBackgroundSync()` now creates temp iroh endpoint + doc.start_sync() instead of HTTP POST | v1.0.7 |

### ❌ Not Fixed (Remaining for v1.0.7)

| # | Issue | Reason | Target |
|---|-------|--------|--------|
| 3.1 | Reader.tsx 2515 lines (30+ useState, 31 useEffect) | Major refactor — needs careful decomposition | v1.0.7 |
| 10.1 | `useOptimistic` for likes/favorites/ratings | Small scope — 0.5 day | v1.0.7 |
| 10.2 | TanStack Query for data fetching (87+ useEffect) | Large refactor — 3 days | v1.0.7 |
| — | `rand 0.8 → 0.9` | Blocked by `chacha20poly1305`'s `rand_core 0.6` dep — resolves after legacy LWW protocol removal. When unblocked: update both `Cargo.toml`s, fix `OsRng` usage in `sync_crypto.rs` to use `rand::rng()`, verify with `cargo check && cargo clippy && cargo test` | v1.0.7 |

### 🟢 Done (Legacy Protocol Removal — Completed in v1.0.7)

| # | Issue | Status |
|---|-------|--------|
| — | Custom ALPN `theorem-sync/v1` + full legacy LWW protocol | ✅ Removed — iroh-docs CRDT is the only sync path |
| — | sync-daemon sidecar (HTTP-based LWW) | ✅ Removed — deleted `crates/sync-daemon/` |
| — | Android worker HTTP → iroh-docs CRDT | ✅ Rewritten — JNI uses temp iroh endpoint |
| — | `chacha20poly1305`, `x25519-dalek`, `hkdf`, `sha2`, `rand` | ✅ Removed from both Cargo.tomls |

---

## 1. Critical Issues

### 1.1 Unwrapped `Result`s in iroh_sync.rs

**Severity: CRITICAL — can crash the sync subsystem**

```rust
// iroh_sync.rs:232, 268, 282, 306, 357, 510, 558
serde_json::to_vec(manifest).unwrap()  // panics on serialize failure
serde_json::to_value(response).unwrap()
```

Every `iroh_request` call involves serializing an `AuthenticatedRequest`, then serializing the response. If serialization fails for any reason (e.g., malformed data, encoding edge case), `.unwrap()` panics the entire sync thread, dropping the connection and losing all in-flight data.

**Fix**: Replace all `.unwrap()` calls in production code paths with `.map_err(|e| format!(...))?`.

### 1.2 `local.unwrap()` Fragile Pattern

**Severity: HIGH** — `iroh_sync.rs:1018`. Currently safe (preceded by `Some` check), but bypasses the type system.

### 1.3 XSS via `dangerouslySetInnerHTML`

**Severity: HIGH** — RSS content and dictionary definitions are rendered via:

```tsx
// FeedsPage.tsx:284
<div dangerouslySetInnerHTML={{ __html: summaryHtml }} />

// ArticleReaderContent.tsx:101
contentElement.innerHTML = sanitizedContent

// Vocabulary.tsx:226
<div dangerouslySetInnerHTML={{ __html: def }} />
```

All three use external data (RSS feeds, dictionary API). The sanitization in `ArticleViewer.tsx:545` (labeled `sanitizedContent`) should be audited. Consider adding explicit `DOMPurify.sanitize()`.

**Fix**: Add `dompurify` and wrap all `dangerouslySetInnerHTML` usages.

### 1.4 `book.locations` in Zustand

**Severity: CRITICAL** — `src/core/store/index.ts:1076`. The `saveBookLocations` action stores `locations` (foliate-js pagination data) in the Zustand `Book` object. This can reach 50-100MB across opened books. The AGENTS.md explicitly forbids this — locations must only live in SQLite BLOB.

### 1.5 Silent `.catch(() => {})` — 19 occurrences

**Severity: HIGH** — Errors in SQLite persistence, sync, TTS, and file operations are completely invisible:

| Location | What's swallowed |
|----------|-----------------|
| `App.tsx:323,402,403,405` | Fingerprint init, background sync, daemon config |
| `store/index.ts:508,881,1279` | Book deletion, SQLite save |
| `book-locations.ts:20,39` | SQLite blob persistence |
| `sync-orchestrator.ts:897,918,940,1087` | Daemon sync, wake, autosync flag |
| `DeviceSync.tsx:652` | Daemon configure |
| `foliate-engine.ts:1518` | Async operation |

**Fix**: At minimum log the errors with `console.warn` or send to Sentry.

---

## 2. Outdated Dependencies

### 2.1 Rust (Cargo.toml)

| Dependency | Current | Latest | Risk |
|-----------|---------|--------|------|
| `reqwest` | 0.11 | 0.12 | No new features |
| `rand` | 0.8 | 0.9 | Breaking changes available |
| `zip` | 0.6 | 2.x | Old API, potential security issues |
| ~~`axum`~~ | 0.7 | — | **REMOVED** — stale dep |
| ~~`tower-http`~~ | 0.5 | — | **REMOVED** — stale dep |
| ~~`local-ip-address`~~ | 0.6 | — | **REMOVED** — dead code |

### 2.2 JavaScript (package.json)

| Dependency | Current | Latest | Risk |
|-----------|---------|--------|------|
| `@tauri-apps/plugin-app` | 2.0.0-alpha.1 | — | **Alpha pre-release** in production |
| `@tauri-apps/plugin-window` | 2.0.0-alpha.1 | — | **Alpha pre-release** in production |
| `soundtouchjs` | 0.3.0 | — | Unmaintained since 2019 |
| `@types/uuid` (in deps) | — | devDeps | Should be moved |

---

## 3. Code Quality

### 3.1 Reader.tsx — 2515 lines, 30+ `useState`, 31 `useEffect`

The reader component has grown beyond maintainable size:
- 30+ individual `useState` calls (lines 185-231)
- 31 `useEffect` blocks across ~1500 lines
- Mixes PDF state, TTS state, UI state, annotation state

**Recommendation**: Extract into:
- `useReaderState` — reducer for all reader state variables
- Sub-components for PDF, TTS, annotations, settings panels
- Consider `@tanstack/react-query` for data-fetching effects

### 3.2 No Centralized Toast System

Three duplicated implementations:
- `ShareStatsStudioModal.tsx` — local toast state
- `ShareStudioModal.tsx` — same pattern duplicated
- `FeedsPage.tsx` — inline error toast

**Recommendation**: Add `sonner` (1KB, 5k stars) or build a zustand toast store. ~50 lines of integration removes 3+ duplications.

### 3.3 Cross-Store State Mutations

RSS store directly calls `useLibraryStore.setState()` for tombstone mutations. This couples the stores and bypasses action encapsulation.

**Resolution**: Stores were split into domain slices in v1.0.7. Cross-store calls use direct `getState()/setState()` (standard Zustand pattern). This avoids circular imports and keeps cross-store dependencies explicit.

---

## 4. Security

### 4.1 Audit Needed

| Area | Status |
|------|--------|
| HTML sanitization for RSS content | Unknown — needs audit |
| HTML sanitization for dictionary definitions | Unknown — needs audit |
| CSP in tauri.conf.json | Should be verified |
| Sentry beforeSend strips file paths | ✅ Good |
| `window.open` with `noopener,noreferrer` | ✅ Good |
| No `onclick=` in HTML strings | ✅ Good |

### 4.2 Recommended Additions

- `dompurify` for explicit sanitization
- `@axe-core/react` for automated a11y testing

---

## 5. Testing Coverage

| Area | Coverage | Risk |
|------|----------|------|
| Sync correctness (16 tests) | ✅ Good | Protocol bugs caught |
| Zod schema validation (21 tests) | ✅ Good | Malformed data handled |
| Store performance (12 tests) | ✅ Good | Scale concerns addressed |
| UI static (12 tests) | ✅ Good | CSS/layout regressions |
| **Reader engine** (foliate-engine.ts:2588 lines) | **❌ 0 tests** | High |
| **PDF engine** (pdfjs-engine.tsx:2219 lines) | **❌ 0 tests** | High |
| **RSS service** (RssService.ts) | **❌ 0 tests** | Medium |
| **Rust database** (database.rs) | ✅ 25 tests | KV, blob, cover, FTS, metadata, annotations |
| **Rust EPUB parser** (epub_parser.rs) | ✅ 18 tests | BOM, path resolution, OPF parsing, synthetic EPUBs |
| **Rust backend** (all lib.rs/iroh_sync.rs/sync_commands.rs) | **❌ 0 integration tests (needs iroh runtime)** | High |
| **Store migrations** | **❌ 0 tests** | Medium |
| **Zustand actions** | **❌ 0 unit tests** | Medium |

---

## 6. Recommended Dependency Additions

| Library | Purpose | Size | Stars | Priority |
|---------|---------|------|-------|----------|
| `@tanstack/react-query` | Data fetching with cache, dedup, retry | 13KB | 44k | HIGH |
| `sonner` | Centralized toast notifications | 1KB | 9k | MEDIUM |
| `dompurify` | HTML sanitization (XSS protection) | 10KB | 14k | HIGH |
| `react-hook-form` | Form validation | 8KB | 43k | LOW |

## 7. Recommended Dependency Removals/Upgrades

| Change | Reason |
|--------|--------|
| Remove `axum` from main Cargo.toml | ✅ Done — stale from removed HTTP server |
| Remove `tower-http` from main Cargo.toml | ✅ Done — stale |
| Remove `local-ip-address` from main Cargo.toml | ✅ Done — dead code |
| Move `@types/uuid` to devDependencies | Correct categorization |
| Upgrade `reqwest` to 0.12 | API improvements |
| Upgrade `rand` to 0.9 | Better API |
| Upgrade `zip` to 2.x | Security + API |
| Evaluate `soundtouchjs` replacement | Unmaintained since 2019 |

---

## 8. Build & Performance

### 8.1 Build Times

- **Cargo.lock**: 9862 lines (very large dependency tree)
- Primary compile-time heavy deps: `iroh` (QUIC + rustls), `rusqlite` (bundled SQLite), `reqwest`
- Release profile well-configured: `opt-level = "s"`, `lto = true`, `panic = "abort"`, `strip = "symbols"`

### 8.2 Bundle Size

- All 9 route pages lazy-loaded via `React.lazy()` ✅
- PDF.js loaded dynamically via `prewarmPdfJsRuntime()` ✅
- `@mozilla/readability`, `fast-xml-parser`, `html-to-image` loaded dynamically ✅

### 8.3 Rendering Performance

- `@tanstack/react-virtual` used for all list views (library, shelves, annotations, bookmarks, vocabulary, feeds, search results) ✅
- `React.memo` usage unclear — `memo` is imported but exports may not be wrapped
- `content-visibility: auto` NOT used anywhere despite AGENTS.md recommendation

---

## 9. Accessibility

| Metric | Status |
|--------|--------|
| `aria-label` on icon buttons | ✅ Good (45+ occurrences) |
| `aria-labelledby` on modals | ✅ Good |
| `aria-live` for sync/reader status | ✅ Good |
| Focus trap in modals | ✅ Good |
| Keyboard shortcuts | ✅ Comprehensive system |
| `role="button"` on clickable divs | ✅ Good |
| `alt` text on cover images | ✅ Good |
| `htmlFor`/`id` for form labels | ❌ Missing in reader settings |
| `transition-all` | ✅ None — specific properties only |

---

## 10. Modern Paradigms & Professional Gaps

Based on research into current industry standards (React 19, TanStack Query, Zustand v5, Tauri v2, Rust 2024).

### 10.1 React 19: Not Using `useOptimistic` or Actions

**Severity: MEDIUM** — The app uses React 19 but doesn't leverage its core new features:

| Feature | What we do instead | What we should do |
|---------|-------------------|-------------------|
| `useOptimistic` | Manual `setState` + rollback on error | Optimistic UI for likes, favorites, rating changes |
| `<form action={...}>` | Manual `onSubmit` + `useState` for pending | Built-in form actions with `useActionState` |
| `useActionState` | Multiple `useState` + effects for form submission | Single hook with pending + error + success |
| `use()` for promises | `useEffect` + `useState` for data fetching | Suspense-integrated reads |

**Code locations**:
- `src/features/library/Library.tsx:210` — Book favorite toggle uses manual `setState` + `updateBook`
- `src/features/reader/components/highlights/HighlightColorPicker.tsx` — Form-like interaction without `useActionState`
- `src/features/settings/Settings.tsx:350` — Form submissions without Actions

**Impact**: Manual pending/error state management adds ~5-10 lines per form. `useOptimistic` would make favorites/ratings feel instant.

### 10.2 TanStack Query: Missing Data Fetching Library

**Severity: HIGH** — The app has ~87 `useEffect` calls, many for data fetching that TanStack Query handles better:

```
useEffect(() => { fetchData() }, [dep])   ← 87 occurrences
```

TanStack Query gives for free:
- Request deduplication (same URL called from 2 components = 1 request)
- Background refetch on window focus (stale data detection)
- Retry with exponential backoff
- Cache with configurable stale time
- Pagination (`useInfiniteQuery`)
- Optimistic mutations
- DevTools for debugging

**Prime candidates**:
- `src/core/services/RssService.ts:1036,1132,1195,1218` — RSS feed fetching
- `src/features/reader/Reader.tsx:302,319,441` — Book loading, reader init
- `src/features/reader/engines/pdfjs-engine.tsx:888,901,947` — PDF page loading
- `src/features/reader/article-reader/ArticleViewer.tsx:550,577` — Article content loading

### 10.3 No Centralized Toast System

**Severity: MEDIUM** — 3+ manual implementations:
- `ShareStatsStudioModal.tsx` — local `useState` + `setTimeout`
- `ShareStudioModal.tsx` — duplicated same pattern
- `FeedsPage.tsx` — inline error handling

**Recommended**: `sonner` (1KB, 9k stars) — one `<Toaster />` in root, `toast()` anywhere:
```tsx
import { Toaster, toast } from 'sonner';

function App() {
  return <>
    <Toaster position="bottom-right" />
    <YourApp />
  </>;
}

// Anywhere:
toast.success("Book synced!");
toast.error("Sync failed: " + error);
```

### 10.4 React.memo Usage — Incomplete

**Severity: MEDIUM** — The AGENTS.md recommends wrapping `BookCard`, `ReaderViewport`, `Sidebar`, `BottomNav`, `AppTitlebar` in `React.memo`, but:
- `memo` is imported in several components but usage is inconsistent
- `BookCard` in `Library.tsx` — verify it's wrapped
- `Sidebar`, `BottomNav` in `src/shell/` — verify it's wrapped

Without `React.memo`, every Zustand store change triggers re-render of the entire component tree.

### 10.5 Zustand — Slices Pattern (Fixed in v1.0.7)

**Severity: MEDIUM — Now ✅ Fixed**

The stores were split from a monolithic 2520-line `index.ts` into individual domain slice files:

```
src/core/store/
  index.ts              # Barrel (5 lines — re-exports all stores)
  uiStore.ts            # useUIStore — navigation, search, dialogs
  libraryStore.ts       # useLibraryStore — books, collections, annotations
  settingsStore.ts      # useSettingsStore — settings, stats, migrations
  vocabularyStore.ts    # useVocabularyStore — terms, dictionaries, lookup
  rssStore.ts           # useRssStore — feeds, articles
```

**Approach**: Each store is a standalone Zustand `create()` + `persist()` call in its own file, rather than Zustand's `StateCreator` slices pattern. This was chosen because:
- Each store has independent persistence (different storage keys, versions, partialize configs)
- Cross-store calls use direct `getState()/setState()` — standard Zustand, avoids circular imports
- Existing imports `from "../../core/store"` continue to work via the barrel

### 10.6 Rust — 16 `.unwrap()` Calls in Production Code

**Severity: CRITICAL** — See section 1.1. Every sync operation can panic. Should use `.context()` or `.map_err()?` instead.

### 10.7 Rust Integration Tests (Partially Fixed in v1.0.7)

**Severity: HIGH — 43 tests added**

| Area | Tests | Status |
|------|-------|--------|
| Database (database.rs) | 25 | ✅ Covers KV, blob, cover, FTS, metadata, annotations, clear_all |
| EPUB parser (epub_parser.rs) | 18 | ✅ Covers BOM stripping, path resolution, OPF parsing, synthetic EPUBs |
| iroh sync / sync commands | 0 | ❌ Needs iroh runtime — testing with `iroh_test` is deferred |

**Approach**: Extracted `_inner` functions from Tauri command wrappers. Each `_inner` takes `&Connection` (database) or uses generic `Read + Seek` (epub parser). Tests call these directly with in-memory databases / synthetic byte buffers — no Tauri runtime needed.

### 10.8 19 Silent `.catch(() => {})` — Error Visibility

**Severity: HIGH** — See section 1.5. Real errors in SQLite, TTS, sync, daemon operations are completely invisible. Industry standard would be at minimum `console.warn(error)`.

### 10.9 Bundle: `content-visibility: auto` Missing

**Severity: LOW** — AGENTS.md recommends `content-visibility: auto` on scroll containers to defer off-screen rendering. Not implemented anywhere. Added benefit: 0 lines of code change (CSS only).

### 10.10 TypeScript: Imports from Barrel

**Severity: LOW** — AGENTS.md bans barrel imports (`src/core/index.ts`). Verify no imports from barrel path exist. Barrel imports prevent tree-shaking and increase bundle size.

### 10.11 Recommendations Priority Matrix

| Priority | Change | Effort | Impact | User-visible | Status |
|----------|--------|--------|--------|-------------|--------|
| P0 | Replace `.unwrap()` with error handling | 1 day | Prevents crashes | ✅ No more sync panics | ✅ Done |
| P0 | Fix silent `.catch(() => {})` — log errors | 0.5 day | Error visibility | ❌ Dev-facing | ✅ Done |
| P0 | Replace `dangerouslySetInnerHTML` with DOMPurify | 1 day | Security | ❌ Prevents XSS | ✅ Done |
| P0 | Add TanStack Query for RSS/reader data fetching | 3 days | Performance + UX | ✅ Faster page loads | ⬜ Planned |
| P1 | Add `sonner` toast system | 0.5 day | UX consistency | ✅ Real error feedback | ✅ Done |
| P1 | Add `useOptimistic` for likes/favorites/ratings | 1 day | UX instant feedback | ✅ Instant UI updates | ⬜ Planned |
| P1 | Add Rust integration tests | 3 days | Quality | ❌ Dev-facing | ✅ Done (43 tests) |
| P2 | Split zustand stores into slices | 2 days | Maintainability | ❌ Dev-facing | ✅ Done |
| P2 | Add `content-visibility: auto` | 0.5 day | Rendering perf | ✅ Smoother scrolling | ✅ Done |
| P2 | Add React.memo to missing components | 1 day | Re-render perf | ✅ Subtle but measurable | ✅ Done |
| P3 | Replace `soundtouchjs` (unmaintained since 2019) | 1 day | Maintenance | ❌ | ✅ Done |
| P3 | Update `reqwest` 0.11→0.12, `zip` 0.6→2.x | 1 day | Security | ❌ | ✅ Done |
| P3 | Update `rand` 0.8→0.9 | 1 day | API | ❌ | 🔶 Blocked by legacy LWW removal |
| P3 | Upgrade `@tauri-apps/plugin-app/window` from alpha to stable | 0.5 day | Stability | ❌ | ✅ Done |

---

## 11. Remaining Issues (Not Fixed)

### Critical (P0)
| Issue | Location | Why it matters |
|-------|----------|----------------|
| No TanStack Query for data fetching | RSS, reader, PDF | 87+ `useEffect` calls for data fetching, no dedup/retry/cache |

### High (P1)
| Issue | Location | Why it matters |
|-------|----------|----------------|
| Reader.tsx 2515 lines | `Reader.tsx` | 30+ `useState`, 31 `useEffect` — unmaintainable |
| No iroh sync / sync_commands Rust tests | iroh_sync.rs, sync_commands.rs | Needs iroh runtime for testing |

### Medium (P2)
| Issue | Location | Why it matters |
|-------|----------|----------------|

### Low (P3)
| Issue | Location | Why it matters |
|-------|----------|----------------|

### Planned (Not Started)
| Issue | Status |
|-------|--------|
| Cloudflare Durable Object sync peer | ⬜ Planned — always-on cloud peer for seamless cross-device sync |
| Reader.tsx refactoring (2515 lines) | ⬜ Planned |


