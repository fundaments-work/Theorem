# Architecture

## High-Level Design

```
┌─────────────────────────────────────────────────────┐
│                    App.tsx                            │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ Sidebar   │  │ Titlebar │  │ Route Switch        │  │
│  │ (desktop) │  │         │  │ (useUIStore driven) │  │
│  └──────────┘  └──────────┘  └────────────────────┘  │
│  ┌──────────┐                          │              │
│  │ BottomNav│                    ┌──────┴──────┐      │
│  │ (mobile) │                    │ Lazy routes │      │
│  └──────────┘                    └──────┬──────┘      │
└────────────────────────────────────────┼─────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │         Features         │                          │
         ┌────┴─────┐ ┌──────┴──────┐ ┌──┴───┐ ┌────────────────┐  │
         │  Reader   │ │  Library    │ │Feeds │ │ Vocabulary     │  │
         │  (2 engs) │ │  (virtual) │ │      │ │ (StarDict)     │  │
         └──────────┘ └─────────────┘ └──────┘ └────────────────┘  │
              │                                                    │
         ┌────┴────────────────────────────────────────────────────┘
         │
    ┌────┴────┐
    │  Core    │
    │  Stores  │◄──── Zustand persist ────► SQLite (via Tauri)
    │  Lib     │
    │  Services│
    └─────────┘
         │
    ┌────┴──────────────────┐
    │     Tauri Backend      │
    │  ┌──────┬──────┬────┐  │
    │  │ DB   │ Sync │ TTS│  │
    │  │EPUB  │ File │HTTP│  │
    │  │Parser│Xfer  │    │  │
    │  └──────┴──────┴────┘  │
    └────────────────────────┘
```

## Data Flow

### Book Import → Library → Reader

```
File system          Tauri command            JS import pipeline        Store
  │                     │                         │                     │
  ├─ epub/pdf/... ──► read_file() ──► importBooksIncremental() ───► libraryStore
  │                                          │                            │
  │                                    ┌──────┴──────┐                    │
  │                                    │ contentHash  │                    │
  │                                    │ (SHA-256     │                    │
  │                                    │  dedup)      │                    │
  │                                    │ metadata     │                    │
  │                                    │ extraction   │                    │
  │                                    │ cover        │                    │
  │                                    │ extraction   │                    │
  │                                    └─────────────┘                    │
  │                                                                       │
  │    Later: select book ──► useUIStore.setRoute("reader", bookId)       │
  │                              │                                        │
  │                         Reader.tsx loads book:
  │                           ├─ EPUB/MOBI → FoliateEngine
  │                           └─ PDF       → PDFJsEngine
```

### Sync Data Flow

```
Device A                              Device B
  │                                       │
  │  provisionToIrohDocs()                │
  │  (serializes all store state          │
  │   into iroh-docs entries)             │
  │                                       │
  │  docsSetEntry("books", ...)           │
  │  docsSetEntry("annotations", ...)     │
  │  docsSetEntry("settings", ...)        │
  │  ...                                  │
  │                                       │
  │  docsSyncNow(peerDeviceId) ──────────►│
  │  (iroh-docs CRDT sync)                │
  │                                       │
  │◄──── docs-sync-finished (event) ──────│
  │                                       │
  │  hydrateFromIrohDocs()                │
  │  mergeIncomingData()                  │
  │   ├─ mergeBooks()                     │
  │   ├─ mergeAnnotations()               │
  │   └─ mergeSettings()                  │
  │                                       │
  │  requestBookFile(blobHash) ──────────►│
  │◄──── book data (stream) ──────────────│
```

### Reader Rendering

```
Reader.tsx
  │
  ├─ Non-PDF (EPUB, MOBI, FB2, CBZ, CBR)
  │   └─ ReaderViewport
  │       └─ useDocumentReader
  │           └─ FoliateEngine
  │               └─ foliate-js view.js (iframed content)
  │                   ├─ paginator.js (CSS grid column layout)
  │                   ├─ epub.js (OPF/spine parsing)
  │                   └─ overlay.js (highlight rendering)
  │
  └─ PDF
      └─ PDFReader (lazy loaded)
          └─ PDFJsEngine
              └─ pdfjs-dist (canvas rendering)
                  ├─ text layer (selection)
                  └─ annotation layer (highlights/drawings)
```

## State Architecture

All state lives in 5 Zustand stores. Each store is persisted to SQLite via Tauri commands (`sqlite_set_kv` / `sqlite_get_kv` from `database.rs`).

```
uiStore (ephemeral)
  ├─ currentRoute, currentBookId
  ├─ sidebarOpen, searchQuery
  └─ vaultSyncStatus, deviceSyncStatus

libraryStore (persisted, version 6)
  ├─ books: Book[]
  ├─ annotations: Annotation[]
  ├─ collections: Collection[]
  └─ deletionTombstones: DeletionTombstone[]

settingsStore (persisted, version 9)
  ├─ settings: AppSettings
  ├─ stats: ReadingStats
  └─ settingsLastModifiedAt: string

vocabularyStore (persisted, version 5)
  ├─ vocabularyTerms: VocabularyTerm[]
  └─ installedDictionaries: InstalledDictionary[]

rssStore (persisted, version 1)
  ├─ feeds: RssFeed[]
  └─ articles: RssArticle[]
```

**Non-persisted data lives in SQLite directly:**
- `book.locations` — foliate position snapshots (BLOB column, prefix `locations:{bookId}`)
- Book binary data and covers (materialized to `book-cache/`)
- StarDict dictionary files (blob_store, prefix `theorem-stardict:{id}:`)
- Book metadata and annotations (separate tables with FK to books)

## Reader Architecture

Two rendering paths converge in `Reader.tsx`:

```
Reader.tsx orchestrates:
  ├─ Book loading (detect format → choose engine)
  ├─ Annotation sync (store ↔ engine ↔ panel)
  ├─ Search (engine-native or PDF.js)
  ├─ TTS/immersion reading (ImmersionPlayer)
  └─ Navigation state (pagination, position tracking)

Non-PDF path:
  ReaderViewport → useDocumentReader → FoliateEngine → foliate-js view.js

PDF path:
  PDFReader → PDFJsEngine → pdfjs-dist
```

The foliate-js submodule at `src/features/reader/foliate-js/` is vendored upstream (johnfactotum/foliate-js). We never edit it directly. Instead, `scripts/sync-foliate-js.sh` copies the files we need into `src/features/reader/foliate-js-runtime/` and applies runtime patches. This is where our modifications live.

Key patches applied by the sync script:
- Replace vendored PDF.js import with `pdfjs-dist` from npm
- Override paginator for `overflow:clip` and transform-based pagination
- Add in-flight request deduplication for EPUB text loading
- Add parallel ZIP prefetch support (Rust pre-parser integration)

## Sync Architecture

Three protocols, one per concern:

| Protocol | Purpose | Crate |
|----------|---------|-------|
| iroh-docs | CRDT-based structured data sync (books, annotations, settings) | `iroh-docs` |
| iroh-blobs | BLAKE3-verified content-addressed file transfer | `iroh-blobs` |
| iroh-gossip | Live peer discovery and event propagation | `iroh-gossip` |
| iroh-mdns | LAN peer discovery via mDNS | `iroh-mdns-address-lookup` |

Sync lifecycle:
1. **Start**: `iroh_start` initializes iroh endpoint, attaches to docs+blobs+gossip
2. **Pair**: QR code exchange → bidirectional key registration → doc import
3. **Provision**: All store state serialized into per-key iroh-docs entries
4. **Sync**: `docs_sync_now` triggers CRDT reconciliation with a peer
5. **Merge**: Incoming data validated via Zod schemas, merged with Last-Write-Wins CRDT semantics
6. **Live**: `docs-entry-changed` events stream real-time changes during sync session
7. **File transfer**: Blob hashes exchanged → `request_book_file` streams book files via QUIC
