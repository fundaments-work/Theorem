# Performance Benchmark Analysis — v1.0.6

Results from `tests/library-performance.test.ts` run on 2026-07-05
(Node.js / Vitest jsdom — CPU-only, no GPU/DOM rendering cost included).

---

## 1. Sort-only performance (no Fuse search)

| Library size | Title sort | Author sort | dateAdded sort | Verdict |
|---|---|---|---|---|
| 50 books | 0.007ms | 0.007ms | 0.006ms | ✅ No action |
| 200 books | 0.041ms | 0.058ms | 0.008ms | ✅ No action |
| 500 books | 0.111ms | 0.150ms | 0.021ms | ✅ No action |
| 1000 books | 0.206ms | 0.311ms | 0.043ms | ✅ No action |

**Conclusion:** `Array.prototype.sort` with `localeCompare` (title/author) is
the most expensive sort key but still 0.3ms at 1000 books — well within the
16ms frame budget. **No optimization needed here.**

---

## 2. Fuse search: cold (index build) vs warm (cache hit)

| Library size | Cold avg | Warm avg | Speedup |
|---|---|---|---|
| 50 books | 0.864ms | 0.583ms | 1.5× |
| 200 books | 2.452ms | 1.974ms | 1.2× |
| 500 books | 5.730ms | 4.839ms | 1.2× |
| 1000 books | 11.206ms | 9.648ms | 1.2× |

**Key findings:**

1. **Cache speedup is modest (1.2–1.5×)** — the Fuse index build itself is
   fast. Most of the search time is in `.search()`, not `new Fuse(...)`.
   The WeakMap cache is still worthwhile (avoids the index build on every
   debounce tick), but it's not a dramatic gain.

2. **At 500 books (~5ms) and 1000 books (~10ms), Fuse search crosses the
   "monitor" threshold.** With the 250ms debounce in place, this fires at
   most 4 times per second, so the practical impact is low. But it confirms:
   - Libraries of **< 500 books**: no JS performance issue.
   - Libraries of **500–1000 books**: Fuse is measurably slow on each debounced
     tick; Web Worker offload would help.
   - Libraries of **> 1000 books**: Fuse search pushes into "⚠ ok" territory.

3. **Query length increases cost** — Fuse scales from ~1.7ms (1-char query)
   to ~4.7ms (7-char query) at 500 books. Longer queries do more bitap
   scoring work per item.

---

## 3. Filter cost (shelf + favorites)

| Operation | 500 books avg |
|---|---|
| Sort only (no filter) | 0.111ms |
| Shelf filter + sort | 0.088ms |
| Favorites filter + sort | 0.037ms |
| Shelf filter + Fuse search | 4.827ms |

**Conclusion:** `.filter()` on 500 books costs < 0.1ms — negligible.
The cost of combined shelf + search is dominated entirely by Fuse, not the
post-search filter. **No optimization needed for the filter layer itself.**

---

## 4. RSS URL normalization

- 1000 URL normalizations: **0.118ms avg**
- `toLowerCase() + replace(/\/+$/, "")` is essentially free.
- **Conclusion:** No optimization needed. The regex is fine even at very high
  article counts.

---

## 5. Decision Matrix: When is virtual scrolling worth it?

| Library size | Sort JS cost | Search JS cost | Frame budget (16ms) | Verdict |
|---|---|---|---|---|
| 25–200 books | < 0.06ms | < 2ms | 14ms headroom | ✅ No action needed |
| 500 books | 0.11ms | 4.6ms | 11ms headroom | ✅ No action needed (JS side) |
| 1000 books | 0.21ms | 9.4ms | 6.6ms headroom | ⚠ Monitor — JS is fine but DOM rendering may dominate |

**Important note:** These benchmarks measure only the JS pipeline (filtering
and sorting). They do **not** include:
- React render time for 200+ `BookCard` components
- DOM layout / style recalculation for the CSS grid
- Cover image decode and paint (each cover is a `data:` URI)

At 200+ books, DOM rendering is likely the bottleneck, not JS.
Virtual scrolling removes 90%+ of that DOM cost.

**Recommended thresholds for virtual scrolling consideration:**

| Metric | Threshold |
|---|---|
| JS search avg at current library size | > 8ms → Web Worker search |
| DOM nodes in library grid | > 500 visible elements → virtual scroll |
| Frame time measured in DevTools | > 30ms total → virtual scroll urgent |

---

## 6. Cache correctness: WeakMap contract

- The WeakMap cache is **correct under Zustand**: every store mutation
  creates a new array reference (`[...state.books]`), triggering a cache miss
  and a fresh Fuse rebuild. ✅
- **Anti-pattern documented**: if anyone mutates the books array in-place
  (push/splice on the same reference), the cache returns stale search results.
  The test `"returns stale results if the same array reference is mutated in-place"`
  documents this contract explicitly.

---

## Remaining Performance Opportunities (Updated)

### Confirmed no action needed
- ✅ Sort pipeline — all keys < 0.35ms at 1000 books
- ✅ Filter layer — < 0.1ms at all sizes
- ✅ RSS URL normalization — < 0.12ms per 1000 URLs

### Worth doing (evidence-based)
- ⚠ **Virtual scrolling** — JS is fine, but DOM render cost at 200+ books is
  unmeasured. If profiling DevTools shows > 30ms frames while scrolling the
  library, implement `@tanstack/react-virtual`.
- ⚠ **Fuse Web Worker** — At 1000+ books, warm search is ~9.4ms. With debounce
  it fires 4×/sec → offloading to a Worker would keep main thread free.
  Not urgent until library regularly exceeds 500 books.
- ⚠ **Cover image size** — Not measured here. `data:` URI covers in IndexedDB
  are full-size, decoded on every render. Thumbnail covers (120px) would
  reduce decode cost and memory significantly.

### Not worth doing yet
- ❌ SQLite FTS5 — Fuse is only ~5ms at 500 books. Not a bottleneck until >1000 books.
- ❌ Paginated library — UX trade-off is real; JS/DOM cost doesn't justify it yet.
