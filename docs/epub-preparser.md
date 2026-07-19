# EPUB Pre-Parser (Metadata Only)

## Why Rust

Opening an EPUB in the browser normally requires:
1. ZIP traversal (list all entries) — synchronous, blocks the main thread
2. Read container.xml, OPF, NCX, and nav — each as a separate read
3. Parse XML metadata

The Tauri backend (`epub_parser.rs`) does steps 1-3 in a background thread while the JS initializes the reader UI. Only metadata files are prefetched; section content (chapter HTML, CSS, images) is loaded **lazily via zip.js** on the JS side. This avoids duplicating the entire book's text content in memory as JS strings (~3-6 MB for a typical EPUB with 50 sections).

## How It Works

```
JS (makeZipLoader)                         Rust (prefetch_zip_metadata)
  │                                             │
  ├─ Start zip.js ──────────────── parallel ──► ├─ Open ZIP file (zip crate)
  │                                             ├─ Parse container.xml
  │                                             ├─ Parse OPF (manifest, spine)
  │                                             ├─ Locate nav (HTML TOC) and NCX
  │                                             │
  │  ◄─────────── ZipPrefetch result ────────────┤
  │  {                                            │
  │    container: "xml...",            ┐           │
  │    opf: "xml...",                  │           │
  │    opf_path: "OPS/content.opf",    ├ metadata  │
  │    nav: "html...",                 │ only      │
  │    ncx: "xml...",                  │           │
  │    encryption: "xml...",          ┘           │
  │    sizes: {                                    │
  │      "OPS/ch01.xhtml": 12345,       ← sizes   │
  │      "OPS/style.css": 789,          map       │
  │    }                               still      │
  │  }                                 populated   │
  │                                             │
  ├─ Metadata reads → served from textCache
  ├─ Section reads → fall through to lazy zip.js
  │   (getLazyZip() → ZipReader.getEntries()
  │    → entry.getData(new TextWriter()))
  │
  └─ If Rust has not returned yet:
      zip.js reads everything normally (getEntries)
```

## The Three-Sided Contract

The `ZipPrefetch` struct is shared between 3 files. When changing it, all 3 must be updated:

| File | Role |
|------|------|
| `src-tauri/src/epub_parser.rs` | Rust struct definition + command |
| `src/core/lib/tauri-epub-bridge.ts` | TypeScript interface (`EpubPrefetchResult`) |
| `src/features/reader/foliate-js-runtime/view.js` | Consumer — checks cache and integrates with zip.js |

## What It Parses

- **container.xml**: Finds the OPF path. Strips UTF-8/UTF-16 BOMs before XML parsing.
- **OPF**: Manifest (all items with IDs, hrefs, media-types), spine (reading order), and `properties="nav"` detection for nav HTML.
- **Nav HTML**: The EPUB3 navigation document (table of contents).
- **NCX**: EPUB2 table of contents (`.ncx` file with `application/x-dtbncx+xml` media-type).
- **encryption.xml**: DRM/encryption metadata (if present).
- **Section sizes only**: The byte size of each file in the ZIP (sizes map). Section text is NOT prefetched.

## Performance

The command runs on `tauri::async_runtime::spawn_blocking` — true parallelism with the JS thread. For a 10MB EPUB with 50 sections, the metadata pre-parser completes in under 50ms.

Section content loads lazily via zip.js after the initial render. The first section load triggers `ZipReader.getEntries()` once; subsequent sections read from the cached entry map. This trade-off saves ~3-6 MB of JS heap per large EPUB (no duplicate text strings) at the cost of reading each section through zip.js decompression instead of direct string lookup.
