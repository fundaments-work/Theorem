# Reader

## Why Two Engines

Reflowable formats (EPUB, MOBI, FB2, CBZ) are fundamentally different from PDF. PDF is a fixed-layout print format — pages are predefined canvases. Reflowable formats are documents where text and images flow into columns of whatever size the viewport provides. One engine cannot do both well.

- **Foliate-js** handles all reflowable formats. It's a mature library that knows how to parse EPUB spines, MOBI headers, FB2 XML, and comic book archives, then render them into an iframe with CSS column layout.
- **PDF.js** handles PDF. It renders each page to a canvas, overlays a text layer for selection, and an annotation layer for highlights.

## Entry Points

| Component | File | Loaded |
|-----------|------|--------|
| `ReaderPage` | `src/features/reader/Reader.tsx` | Lazy (prewarmed on library mount) |
| `ReaderViewport` | `src/features/reader/components/ReaderViewport.tsx` | Eager |
| `PDFReader` | `src/features/reader/components/PDFReader.tsx` | Lazy (on first PDF) |
| `ImmersionBar` | `src/features/reader/audio/ImmersionBar.tsx` | Lazy (on first TTS) |
| `ArticleViewer` | `src/features/reader/article-reader/ArticleViewer.tsx` | Eager |

## Non-PDF Rendering Path

```
Reader.tsx
  └─ useDocumentReader() hook
       └─ FoliateEngine (class)
            └─ foliate-js view.js (iframe-based rendering)
                 ├─ foliate-paginator (CSS grid column layout)
                 │    └─ #container (grid track-sized, NOT content-sized)
                 ├─ overlayer.js (highlight overlays in iframe)
                 └─ epub.js / mobi.js / fb2.js / comic-book.js
```

**Loading flow:**
1. `Reader.tsx` checks `book.syncedWithoutFile` — if true, triggers `downloadBookOnDemand(bookId)`
2. Download: Rust `download_book_file` streams from peer to `book-cache/{id}.book` (1MB chunks, no IPC)
3. Progress: `download-progress` Tauri events update the UI bar (throttled to percentage changes)
4. Once file is ready, `getBookBlob(id, storagePath)` reads the file
5. Passes buffer to FoliateEngine or PDFReader
6. EPUBS: `makeZipLoader()` (handles both ZIP and non-ZIP formats)
7. Rust `prefetch_zip_metadata` runs in parallel with zip.js — if the cache populates first, zip.js skips `getEntries()`
8. `foliate-js view.js` creates a `FoliateView` web component in an iframe
9. The iframe is mounted inside `ReaderViewport`'s shadow DOM
10. `paginator.js` measures `#container` (grid-determined, no layout settle needed) and columnizes

**Zoom:** Applied to the iframe document before column calculation. `applyZoomToDocument()` runs inside the `load` event handler, before `beforeRender()` and `columnize()`. After navigation, `applyZoomSync()` re-applies zoom as a safety net (harmless redundancy).

## PDF Rendering Path

```
Reader.tsx
  └─ PDFReader (lazy)
       └─ PDFJsEngine (forwardRef + memo)
            └─ pdfjs-dist
                 ├─ canvas rendering (each page)
                 ├─ text layer (selectable text)
                 └─ annotation layer (highlights, drawings)
```

PDF.js is prewarmed on app start via `prewarmPdfJsRuntime()` from `src/core/lib/pdfjs-runtime.ts`. The `pdfjs-dist` package is chunked separately via Vite's `manualChunks` (`build.rolldownOptions.output.manualChunks`).

PDF reading uses range-based reads for large files — `read_pdf_range(path, offset, length)` reads only the bytes needed for the current page(s), not the entire file.

## Annotations

Annotations sync between three layers:
1. **Engine** — The rendering engine handles visual placement (highlights in iframe/on canvas)
2. **Store** — `libraryStore.annotations` holds the canonical annotation data
3. **Panel** — `ReaderAnnotationsPanel` provides the UI for viewing/editing

The sync is bi-directional:
- User highlights in iframe → engine event → store mutation → panel re-render
- User deletes in panel → store mutation → engine re-renders (removes highlight)

Annotations are persisted per-book in the `book_annotations` SQLite table, not in the shared Zustand annotations array. The shared array (`libraryStore.annotations`) is loaded on app start and kept in memory for sync and cross-book operations.

## Full-Text Search

- Non-PDF: foliate-js's built-in search via `search.js`
- PDF: PDF.js's built-in text layer search
- Both iterate matches and scroll to the selected result

## TTS / Immersion Reading

Platform-specific TTS commands in Rust:
- **Linux**: `spd-say` (speech-dispatcher)
- **macOS**: `say` command
- **Windows**: PowerShell `System.Speech`
- **Android**: Native TTS plugin

The Rust commands are synchronous shell commands, but the JS side (`ImmersionPlayer.ts`) manages playback state, highlighting the currently spoken word in the reader viewport.
