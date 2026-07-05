# PDF Performance Research

## Current Implementation

Theorem uses **PDF.js** rendering via `PDFJsEngine` (2099 lines, `src/features/reader/engines/pdfjs-engine.tsx`). Three-tier file loading:

1. Direct `convertFileSrc()` URL (fastest)
2. `TauriPdfRangeTransport` — range requests via Tauri IPC
3. Full file read fallback

### What Already Works Well
- Canvas render queue with priority (2-4 concurrent renders based on CPU cores)
- Offscreen canvas + atomic swap (no blank frames during zoom/rotation)
- Edge prefetching (8 pages ahead, rate-limited to 140ms)
- Operator list prefetch via `requestIdleCallback`
- Page proxy cache (45-page window)
- Text content cache (48 entries LRU)
- Inactive canvas release after 1.2s

### Current Performance Bottlenecks

| # | Problem | Impact | Native Reader Comparison |
|---|---------|--------|-------------------------|
| 1 | **Canvas re-renders on every zoom change** — no rescaling | 50-200ms per page for each zoom step | Evince rescales existing pixmap; Okular shows rescaled old pixmap while re-rendering; MuPDF replays display list at new resolution |
| 2 | **All page wrappers in DOM** — no virtual scrolling | Thousands of DOM nodes for 1000+ page PDFs | Evince builds height-to-page cache lazily; Zathura renders on demand; Sumatra uses tile render with page-run cache |
| 3 | **Text layer re-renders with every canvas render** | Text extraction + calibration on every zoom change | Okular uses normalized coords (0-1 per character) — recalculation at any zoom is O(n) without re-extraction |
| 4 | **Rust `get_pdf_metadata` reads entire file** | Wastes I/O for multi-hundred MB PDFs | Native readers read only header + xref table + Info dictionary |
| 5 | **No tile-based rendering** for large/oversize pages | Unnecessary full-page renders | Okular tiles when page >4x screen size; Sumatra clips to visible rect |
| 6 | **PDF.js worker serializes page parsing** | `getPage()` calls serialized through single worker | MuPDF creates display lists (parse once, render from any thread) |
| 7 | **Annotation overlays as separate divs** | Extra DOM nodes, layout/paint cost during scroll | Native readers merge annotations into page bitmap |

---

## How Native Readers Achieve Speed

### MuPDF — Display List Architecture (gold standard)

Parse once, render many times:
```
PDF page → fz_run_page → [fz_display_list] (reentrant command buffer)
                                    ↓
                       fz_run_display_list → fz_pixmap (rasterize at any resolution)
```

- `fz_display_list` stores drawing commands device-independently
- Same display list renders at 100% or 500% — just changes transform matrix
- Display list is **reentrant** — render from multiple threads in parallel
- Resource store (glyphs, images, fonts) is LRU-cached per `fz_context`
- Images decoded at sub-sampled resolution for small zoom (JPEG at 1/2, 1/4, 1/8)
- Interruptible rendering via `fz_abort_context`

### Okular — Tile-Based Rendering

When a page area exceeds 4x screen size and covers <75% of the page:
- **TilesManager** divides page into tree of tiles (split on zoom in, merge on zoom out)
- Each tile is an independent render request
- Cached pixmaps at different zoom levels can be **rescaled** for intermediate zooms
- Visible tiles never evicted; eviction priority: dirty state, distance, render time

### Evince — Byte-Based Pixbuf Cache

- Dynamic byte-based cache (not page-count)
- 2 pages before/after current range pre-cached
- `EvPageCache` stores text mappings, links, annotation data **permanently**
- Only rendered surfaces (`EvPixbufCache`) are LRU-evicted

### SumatraPDF — Predictive Tile Cache

- Thread pool (up to 8 threads), semaphore-driven request queue
- Fixed-size `BitmapCacheEntry[MAX_BITMAPS_CACHED]` with `FreeIfFull` eviction
- **Predictive rendering** — renders pages immediately before/after visible range
- Tiles tracked via `TilePosition`, rendered left-to-right, top-to-bottom

---

## Recommendations

### P0: Zoom Rescaling (Biggest UX Impact)

Instead of re-rendering on every zoom change:
1. Cache last rendered canvas as `ImageBitmap` or `OffscreenCanvas`
2. On zoom: `ctx.drawImage(cachedCanvas, 0, 0, newWidth, newHeight)` — GPU scale
3. Start re-render in background at target resolution
4. Atomic swap when re-render completes

For small zoom changes (<15%), rescale is visually indistinguishable from re-render but takes 0.5ms instead of 100ms.

### P0: Virtual Scrolling for Page DOM

Only keep visible + 2-3 buffer pages in DOM. Use IntersectionObserver to:
1. Mount `PageCanvas` + text layer when page enters buffer zone
2. Unmount when page leaves
3. Keep page proxy objects in pool (already have 45-page window)

For 1000+ page PDFs, DOM drops from 1000+ wrappers to ~10.

### P1: Offload Canvas Painting to Worker

PDF.js PRs #20053 and #20729 implement `OffscreenCanvas` rendering in worker. Enable:
- `isOffscreenCanvasSupported: true`
- Moves `CanvasGraphics` (actual `ctx.fill()`, `ctx.drawImage()`) to worker
- Frees main thread entirely during rendering

Requires WebKitGTK OffscreenCanvas support verification.

### P1: Fix Rust Metadata Extraction

`get_pdf_metadata` reads entire file. Change to:
1. Read first 64 KB (contains header + Info dict in most files)
2. If Info dict not found, read last 64 KB (xref trailer location)

### P2: Tile Rendering for Oversize Pages

When page dimensions exceed 2x viewport, split into tiles:
- Each tile is independent `page.render()` with clipping rect
- Only visible tiles rendered

---

## Target Metrics

| Metric | Current | Target | How |
|--------|---------|--------|-----|
| Zoom response | 50-200ms (re-render) | <16ms rescale, 50ms re-render | Cache canvas as ImageBitmap |
| Page switch | 20-100ms | <16ms | Pre-render adjacent, cache op lists |
| Document search | 5-30s (per-page extraction) | <1s | Background full-text index |
| 1000-page PDF open | 1-3s | <500ms | Lazy page proxy, virtual DOM |
| Metadata load | Full file read | <10ms (64KB) | Fix Rust command |
| Text selection | Good | Instant | Cache text content per page |
