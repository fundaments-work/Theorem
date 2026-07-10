# Theorem — Comprehensive Codebase Audit

Generated: v1.0.7-to-1.0.8
Scope: Full-stack audit covering Rust, TypeScript, dependencies, performance, security, accessibility, and test coverage.

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

RSS store directly calls `useLibraryStore.setState()` for tombstone mutations (`store/index.ts:1264,2018,2317,2331`). This couples the stores and bypasses action encapsulation.

**Recommendation**: Create a shared action (`deleteEntity`) that both stores import, or use zustand's `subscribeWithSelector` pattern.

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
| **Rust backend** (all lib.rs/iroh_sync.rs commands) | **❌ 0 integration tests** | High |
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
