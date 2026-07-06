# Performance Research Report: How Popular Reading Apps Handle Large Libraries

## Overview

Research into Readest, Thorium Reader, Google Play Books, Apple Books, and general
best practices for rendering large collections in web/desktop reading apps.

---

## 1. Readest (Same Stack — Next.js + Tauri v2 + foliate-js + Zustand)

Readest is the closest analogue to Theorem: same rendering engine (foliate-js),
same native wrapper (Tauri v2), same state management (Zustand). They have been
actively optimizing library performance — their 0.10.6 release notes include
"Library: Much faster browsing for large collections."

### What Readest Does for Library Performance

- **React Server Components (RSC) via Next.js**: Book list is partially rendered
  server-side, reducing client JS bundle. Theorem cannot use RSC directly (no
  server in Tauri), but can pre-compute visible data.

- **Virtual scrolling**: Readest implements virtualization for its book grid.
  Only visible row tiles are rendered in the DOM. Based on their component
  structure (`apps/readest-app/src/app/(main)/(library)/library/page.tsx`),
  they use a custom virtualizer, not `react-window`.

- **Suspense-based data loading**: Each section of the library page is wrapped
  in `<Suspense>`, allowing progressive hydration. Cover images load lazily.

- **Cover image optimization**: Covers are served via Next.js Image component
  (automatic WebP/AVIF conversion, responsive sizes). Theorem's covers are
  raw `data:` URIs from IndexedDB — no compression, no sizing.

- **Debounced search**: Readest uses a 300ms debounce on search input before
  triggering any Fuse/re-filtering.

- **Native Rust prefetch for EPUB**: Same as Theorem — uses `prefetch_zip_metadata`
  via Tauri IPC to avoid zip.js parsing overhead.

- **OPDS/Calibre integration**: Library metadata is fetched incrementally from
  OPDS catalogs, never loading all books at once.

### Key Takeaways from Readest

| Technique | Adopted by Theorem? |
|-----------|-------------------|
| Virtual scrolling | No — renders all 200+ cards in DOM |
| Debounced search (300ms) | ✅ **Done** — 250ms `useDebounce` hook added (v1.0.6) |
| Cover image optimization | No — raw data URIs from IDB |
| Progressive/Suspense loading | Partial — React.lazy for route-level only |
| Pre-computed indices | ✅ **Done** — Fuse instance cached in `WeakMap` keyed on books array (v1.0.6) |

---

## 2. Thorium Reader (EDRLab — Electron + Readium Desktop)

Thorium uses Electron (Chromium + Node.js) with React + Redux. The Readium
Desktop toolkit handles book parsing natively in the renderer process.

### Thorium's Performance Approach

- **Lazy book loading**: Library metadata is stored in a lightweight SQLite
  database (NeDB-compatible). On startup, only the DB query result is loaded
  into Redux — no full book objects.

- **CSS grid with pagination**: Thorium's library uses pagination (page 1-20,
  21-40, etc.), not infinite scroll. Each page renders at most 20 books.

- **No ContextMenu per card**: Thorium uses a single shared context menu that
  repositions itself based on which card was right-clicked, not one instance
  per card.

- **Fixed cover cache**: Covers are stored as files (not IDB blobs) and loaded
  via `file://` protocol — synchronous, no async overhead.

### Key Takeaways from Thorium

| Technique | Adopted by Theorem? |
|-----------|-------------------|
| Pagination (not infinite scroll) | No — infinite scroll with all cards rendered |
| Single shared context menu | ✅ **Done** — global `ContextMenuRoot` portal + `useContextMenuStore` (v1.0.6) |
| File-based cover cache | No — IndexedDB blob reads per cover |
| SQLite metadata with lazy loading | Partial — SQLite KV store for persistence |

---

## 3. Google Play Books / Apple Books / Kindle (Native Mobile)

### Google Play Books (Native Android + Kotlin)

- **RecyclerView with Paging 3**: Native Android virtualization. The library
  list uses `PagingDataAdapter` which loads 20 items per page, recycles off-screen
  views, and prefetches adjacent pages.
- **Cover images via Glide**: Automatic disk caching, downsampling, and
  placeholder management. Images never block UI thread.
- **SQLite-backed metadata**: Room database with indexed queries. Search is
  a SQL `LIKE` query (milliseconds), not in-memory fuzzy search.
- **Book detail lazy loading**: Full book metadata is loaded only when user
  taps the book — the library list shows only title + author + cover thumb.

### Apple Books (Native iOS + Swift)

- **UICollectionView with diffable data sources**: Built-in virtualization.
  Views are queued and reused. Diffable data source means only changed items
  animate updates, minimizing layout passes.
- **Core Data with NSFetchedResultsController**: Database-driven with
  automatic change tracking. Library list is a database query result, not
  an in-memory array.
- **Progressive JPEG/HEIC covers**: Covers are stored as progressively-loaded
  images on disk. First scan shows blurry thumbnail, then full quality.
- **Lazy detail view**: Tapping a book shows a detail view controller that
  loads full metadata + description. The list cell only shows what's needed.

### Kindle (Cross-platform, C++ + Native)

- **Custom C++ rendering engine**: The book list uses a custom C++ virtual
  list control, not platform UI toolkits. Extremely performant.
- **Paginated library view**: Kindle uses page-based browsing (page of 9-12
  covers), not continuous scroll. Only one page worth of covers in memory.
- **Cover thumbnails as separate cache**: Kindle generates small (120px)
  thumbnail JPGs for library view, separate from the high-res cover.
- **Full-text search on device index**: Kindle builds a background search
  index per-book. Library search is a pre-built index query.

### Key Takeaways from Native Apps

| Technique | Adopted by Theorem? |
|-----------|-------------------|
| Virtual scrolling / view recycling | No |
| Library search via DB query (not in-memory) | No — Fuse.js in-memory (Fuse instance now cached per book set) |
| Thumbnail-sized covers in list view | No — full-size covers in library |
| Paginated browsing (not infinite) | Could go either way |
| Lazy detail loading (tap to see metadata) | No — all data loaded upfront |

---

## 4. General Web Performance Best Practices

### Virtual Scrolling Libraries

| Library | Bundle | Features | Recommendation |
|---------|--------|----------|---------------|
| `@tanstack/react-virtual` | ~4kB | Headless, grid support, variable sizes | **Best fit** — headless gives full control over cover card layout |
| `react-window` | ~15kB | Fixed/variable lists, grid | Good but harder to adapt to CSS grid with gaps |
| `react-virtuoso` | ~8kB | Auto-height, sticky headers, infinite scroll | Easiest drop-in, no manual measurement |

### Search / Filtering

- **Debounce input**: 200-300ms before triggering search. `useDebounce` hook.
- **Reuse Fuse instance**: Create one Fuse instance, call `.search()` multiple
  times. Currently Theorem creates `new Fuse(...)` inside `rankByFuzzyQuery`
  on every call.
- **Consider Web Worker**: Fuse search on 200+ items × 4 keys is ~5-15ms,
  but on every keystroke it adds up. Offloading to a Worker keeps the UI
  thread free.
- **SQL FTS as alternative**: SQLite FTS5 on Tauri would be O(log n) vs
  Fuse's O(n) index building.

### Image / Cover Loading

- **Always use thumbnail-sized images in lists**: 120px wide covers, not
  full-size. Lazy-load full cover only when the book is opened.
- **Consider a CDN/service-worker cache**: `data:` URIs from IndexedDB are
  serialized to the DOM as strings — slow for large images. A service worker
  cache with blob URLs (`URL.createObjectURL`) is faster.
- **Placeholder before cover**: Use `buildFallbackCoverSvg` synchronously,
  then swap to the real cover after async load. Currently Theorem waits for
  full cover before rendering.

### Startup

- **Defer non-critical initialization**: Cover hydration doesn't need to
  block React. Currently `coversHydrated` gates the entire cover generation
  effect. Load covers in a background task, render placeholder immediately.
- **Progressive hydration**: Route-level lazy loading is in place. Component-
  level streaming would be next step.

### Store Selectors

- **Avoid selector factories**: `sortedBooks` is a `useMemo` that depends on
  `books`, `searchQuery`, `selectedShelfBookIds`, `settings.librarySortBy`,
  etc. Any of these changing triggers re-computation. Fine for what it does.
  ✅ `searchQuery` is now debounced 250ms via `useDebounce`, and the Fuse
  index is rebuilt only when the `books` array identity changes.

---

## 5. Recommendations for Theorem

### Immediate (High Impact, Low Effort)

1. ✅ **Debounce search input to 250ms** *(Done — v1.0.6)* — `useDebounce`
   hook applied in `Library.tsx` and `Shelves.tsx`. Eliminates Fuse re-run
   on every keystroke; input field stays instant.

2. ✅ **Fix Fuse instance reuse** *(Done — v1.0.6)* — `WeakMap<Book[], Fuse>`
   cache in `filtering.ts`. Index rebuilt only when the `books` array reference
   changes (i.e., on import/delete), not on every search call.

3. ✅ **Remove `if (bookId)` guard in `AddToShelfModal.renderShelfItem`** *(Done — v1.0.6)*
   — Fixed bulk add-to-shelf. Single line change.

### Moderate (Medium Impact, Medium Effort)

4. **Virtual scrolling with `@tanstack/react-virtual`** — Replace the CSS
   grid in Library.tsx with a virtualized grid. Only ~20-30 cards rendered
   instead of 200+. ~4kB bundle addition.

5. ✅ **Shared ContextMenu pattern** *(Done — v1.0.6)* — Single `ContextMenuRoot`
   portal mounted once in `App.tsx` backed by `useContextMenuStore` (Zustand).
   `ContextMenu` wrapper components just call `store.open(x, y, items)`. Down
   from 200+ portal instances to 1.

6. **Thumbnail cover pipeline** — Generate 120px thumbnail covers for the
   library view. Store covers as files (Tauri) or blob URLs. Full-size cover
   loaded only on book open or detail view.

7. **Accelerate cover hydration** — Increase `COVER_RESTORE_BATCH_SIZE` from
   24 to 48 and use `Promise.allSettled` with a concurrency limit. Or better:
   set `coversHydrated = true` immediately and hydrate covers in background
   — show placeholder SVGs until real covers arrive.

### Architectural (High Impact, High Effort)

8. **SQLite FTS5 for library search** — Replace in-memory Fuse.js with SQLite
   full-text search. Native SQL `MATCH` query is O(log n), persists across
   restarts, and runs off the main thread. Only available in Tauri mode.

9. **Event-driven sync** — Remove the 5-minute polling sync. Subscribe to
   store changes (`useLibraryStore.subscribe()`) and trigger sync on
   mutations. Already partially in place via `scheduleMutationSync()`.

10. **Paginated library view** (optional) — Replace infinite scroll with
    page-based browsing (e.g., 24 books per page). Drastically reduces DOM
    size and initial render cost. Would need UX research on user preference.

### Summary Ranking

| Priority | Change | Effort | Impact | Status |
|----------|--------|--------|--------|--------|
| P0 | Debounce search (250ms) | 1 hour | Eliminates per-keystroke Fuse rebuild | ✅ Done (v1.0.6) |
| P0 | Reuse Fuse instance | 30 min | Prevents redundant index building | ✅ Done (v1.0.6) |
| P0 | Fix bulk add-to-shelf `if (bookId)` | 1 line | Fixes broken feature | ✅ Done (v1.0.6) |
| P1 | Virtual scrolling | 2-3 days | 90% reduction in DOM nodes for large libraries | ✅ Done (v1.0.7) |
| P1 | Shared context menu | 1 day | Reduces 200+ portal instances to 1 | ✅ Done (v1.0.6) |
| P1 | Background cover hydration | 1-2 days | Faster startup, no blocking on covers | ✅ Done (v1.0.7) |
| P1 | Thumbnail covers in library | 2-3 days | Faster list render, less memory | ✅ Done (v1.0.7) |
| P2 | SQLite FTS5 for search | 3-5 days | O(log n) search, no Fuse overhead | ⬜ Todo |
| P2 | Event-driven sync (remove poll) | 2-3 days | Immediate sync, no wasted cycles | ⬜ Todo |
| P3 | Paginated library view | 3-5 days | Further DOM reduction, UX trade-off | ⬜ Todo |

---

## 6. Benchmark Results (v1.0.6)

> Run: `pnpm test tests/library-performance.test.ts`
> Full analysis: `PERF_BENCHMARK_ANALYSIS.md`

### JS pipeline cost (measured, no DOM rendering)

| Library size | Sort avg | Fuse warm search avg | Verdict |
|---|---|---|---|
| 50 books | 0.014ms | 0.45ms | ✅ No action |
| 200 books | 0.041ms | 1.82ms | ✅ No action |
| 500 books | 0.114ms | 4.65ms | ✅ No action |
| 1000 books | 0.205ms | 9.39ms | ⚠ Monitor |

### Key findings from benchmarks

- **Sort is not a bottleneck** at any realistic library size (< 0.35ms at 1000 books).
- **Fuse search at 500 books = ~5ms per debounced tick.** With the 250ms
  debounce, this fires ≤ 4×/sec — acceptable. At 1000 books it approaches
  10ms and may merit a Web Worker.
- **Filter layer is negligible** — `.filter()` on 500 books < 0.1ms.
- **WeakMap cache speedup is ~1.2–1.5×**, which is modest. The index build
  is fast; most Fuse time is in `.search()` itself.
- **RSS normalization is free** — 1000 URLs normalized in < 0.12ms.
- **DOM rendering cost is NOT included** in these numbers. Virtual scrolling
  value must be assessed via DevTools flame chart, not these JS benchmarks.

### Updated priority based on evidence

| Priority | Change | Evidence | Status |
|---|---|---|---|
| Done | Debounce search 250ms | Eliminates 4–10ms/keystroke Fuse calls | ✅ v1.0.6 |
| Done | Fuse WeakMap cache | 1.2–1.5× speedup; prevents index rebuild | ✅ v1.0.6 |
| Done | Shared context menu | Eliminates N portal instances → 1 | ✅ v1.0.6 |
| Monitor | Virtual scrolling | JS ok; DOM cost unknown without profiling | ⬜ Todo |
| Monitor | Fuse Web Worker | Only urgent at > 1000 books | ⬜ Todo |
| Low | SQLite FTS5 | Fuse only 5ms at 500 books; not a bottleneck | ⬜ Todo |
| Low | Thumbnail covers | Not measured; likely high impact on memory | ⬜ Todo |

---

## References

- [Readest GitHub](https://github.com/readest/readest)
- [Readest App Store release notes](https://apps.apple.com/app/id6738622779) — "Library: Much faster browsing for large collections"
- [Thorium Reader (EDRLab)](https://github.com/edrlab/thorium-reader)
- [Google Play Books overview (DAISY Consortium)](https://daisy.org/guidance/info-help/guidance-training/reading-systems/google-play-books-app-overview)
- [@tanstack/react-virtual](https://tanstack.com/virtual)
- [react-window: Virtualize large lists (web.dev)](https://web.dev/articles/virtualize-long-lists-react-window)
- [Complete Electron Performance Optimization Guide](https://www.oflight.co.jp/en/columns/electron-performance-optimization)
