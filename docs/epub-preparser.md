# EPUB Pre-Parser

## Why Rust

Opening an EPUB in the browser normally requires:
1. ZIP traversal (list all entries) — synchronous, blocks the main thread
2. Read container.xml, OPF, NCX, nav, and all section files — each as a separate read
3. Parse XML metadata

This is slow for large EPUBs, especially on mobile. The Rust pre-parser (`epub_parser.rs`) does steps 1-3 in a background thread while the JS side initializes the reader UI. By the time JS needs the data, it's already cached.

## How It Works

```
JS (makeZipLoader)                         Rust (prefetch_zip_metadata)
  │                                             │
  ├─ Start zip.js loading ──── parallel ────► ├─ Open ZIP file (zip crate)
  │                                             ├─ Parse container.xml
  │                                             ├─ Parse OPF (manifest, spine)
  │                                             ├─ Locate nav (HTML TOC) and NCX
  │                                             ├─ Decode all OPF-referenced text files
  │                                             │  (HTML sections, CSS, etc.)
  │                                             │
  │  ◄─────────── ZipPrefetch result ────────────┤
  │  {                                            │
  │    container: "xml...",                       │
  │    opf: "xml...",                             │
  │    opf_path: "OPS/content.opf",               │
  │    nav: "html...",                             │
  │    ncx: "xml...",                              │
  │    text_cache: {                               │
  │      "OPS/ch01.xhtml": {"text": "<html>..."}, │
  │      "OPS/style.css": {"text": "body {...}"}, │
  │    },                                          │
  │    sizes: {                                    │
  │      "OPS/ch01.xhtml": 12345,                  │
  │    }                                           │
  │  }                                             │
  │                                             │
  ├─ If text_cache is populated:
  │   zip.js skips getEntries() entirely
  │   All text reads come from the pre-parsed cache
  │
  └─ If text_cache is NOT populated yet:
      zip.js falls through to normal getEntries()
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
- **Section files**: All text files referenced in the OPF manifest are pre-decoded. Binary files (images, fonts) are not — only their sizes are returned.

## Performance

The command runs on `tauri::async_runtime::spawn_blocking` — true parallelism with the JS thread. For a 10MB EPUB with 50 sections, the pre-parser typically completes in under 50ms, well before zip.js finishes its initialization.

The `text_cache` is the key: it contains the decoded text for every section file. When zip.js's `readEntry()` is called for a text file, it checks the cache first. If found, it returns the pre-decoded text immediately without any ZIP seek.
