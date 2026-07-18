# Vocabulary

## Why Two Providers

Vocabulary lookups come from two sources:

1. **Online API** (`https://api.dictionaryapi.dev/`) — Used when online. Returns definitions, phonetics, audio URLs, examples. Wrapped in `DictionaryService.ts` which normalizes the response into our `VocabularyTerm` format.

2. **StarDict dictionaries** (offline) — Downloaded from a GitHub release and stored in SQLite `blob_store`. Used when offline or when the user wants faster lookups without network.

The online API is tried first (if reachable), falling back to StarDict. Results are cached in the in-memory `lookupCache` (not persisted) so repeated lookups of the same word are instant.

## StarDict Integration

StarDict is a dictionary format. The pipeline:

```
GitHub release ZIP/tar.bz2          StarDictService.ts
  │                                      │
  ▼                                      ▼
download_and_extract_stardict()     import dictionary parts
  (Rust Tauri command)               into SQLite blob_store
  │                                      │
  ├─ Download via reqwest (streaming)    │
  ├─ Emit progress events to JS          │
  ├─ Extract ZIP or tar.bz2              │
  ├─ Find .ifo / .idx / .dict.dz / .syn │
  └─ Store in blob_store via DB commands │
                                         ▼
                                   foliate-js dict.js
                                   (vendored, patched)
                                   provides StarDict lookup
                                         │
                                         ▼
                                   lookupTerm() → definitions
```

The `foliate-js-runtime/dict.js` (patched from upstream) handles the actual StarDict binary format parsing — the IFO metadata, the IDX key index (binary search), and the DICT content (with optional dictzip decompression via `fflate`).

Dictionary parts are stored in `blob_store` with key prefix `theorem-stardict:{dictionary-id}:` and parts `ifo`, `idx`, `dict`, `syn`.

## Vocabulary Term Model

```typescript
interface VocabularyTerm {
    id: string;
    term: string;                        // The word as looked up
    normalizedTerm: string;              // Lowercased, trimmed
    language: string;
    phonetic?: string;                   // Pronunciation string
    audioUrl?: string;                   // TTS audio URL (online API)
    meanings: VocabularyMeaning[];       // Part-of-speech → definitions
    providerHistory: ("stardict" | "free-dictionary-api")[];
    lookupCount: number;                 // Incremented on each lookup
    contexts: string[];                  // Surrounding text (from reader)
    // ...
}
```

## Vocabulary Store

The `vocabularyStore` (Zustand, version 5, persisted) holds:
- `vocabularyTerms: VocabularyTerm[]` — All saved terms
- `installedDictionaries: InstalledDictionary[]` — StarDict dictionary manifests

The store provides:
- `lookupTerm`: Queries all available providers, merges results, saves if not already saved
- `saveVocabularyTerm`: Direct save (for manual entries)
- `deleteVocabularyTerm`: Remove a term
- `importDictionary` / `removeDictionary`: Manage StarDict dictionaries

## UI

The Vocabulary page (`src/features/vocabulary/Vocabulary.tsx`) shows:
- A searchable, filterable list of saved terms
- Each term card shows the word, phonetic, and primary definition
- Tapping opens a detail panel with all definitions, examples, and context sentences
- Terms can be deleted individually

Lookups can also be triggered from the reader — selecting text shows a "Define" option that opens a popover with the definition and a "Save to Vocabulary" button.
