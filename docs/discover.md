# Discover & OPDS Catalogs

## Overview

The **Discover** feature (`src/features/catalogs/DiscoverPage.tsx`) provides an editorial storefront for browsing, searching, and downloading public-domain books directly into the user's Theorem library without requiring external web browsers or cloud subscriptions.

```
┌─────────────────────────────────────────────────────────┐
│                      DiscoverPage                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Search Bar (instant search across public domain)  │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Curated Carousels (Gutenberg, Standard Ebooks)    │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Custom OPDS Feeds & Virtualized Search Results    │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 1. Supported Catalog Standards

Theorem speaks **OPDS 1.2 (Open Publication Distribution System)**, an Atom XML-based syndication format for digital publications.

### Key OPDS Feed Elements Parsed:
* `<feed>`: Catalog root with navigation and acquisition links.
* `<entry>`: Individual book entries containing Dublin Core metadata (`dc:title`, `dc:creator`, `dc:language`, `dc:issued`).
* `<link rel="http://opds-spec.org/acquisition" type="application/epub+zip">`: Direct EPUB download URL.
* `<link rel="http://opds-spec.org/image">` / `<link rel="http://opds-spec.org/thumbnail">`: Cover artwork.
* `<link rel="search" type="application/opds-catalog+xml">`: OpenSearch description URL for remote catalog searches.

---

## 2. Ingestion & Download Pipeline

```
DiscoverBookCard ("Get Book" click)
  │
  ▼
DiscoverService.downloadCatalogBook(book)
  │
  ├─ 1. Stream EPUB bytes via Tauri fetch or browser fetch
  ├─ 2. Pass ArrayBuffer to importBooksIncremental()
  ├─ 3. Compute contentHash (SHA-256) & extract metadata/cover
  ├─ 4. Save to SQLite database & book-cache/
  └─ 5. Show toast notification & update Library view
```

---

## 3. Fallback Clothbound Cover System

For catalog books lacking bundled high-resolution cover artwork, Theorem renders deterministic, publication-grade clothbound covers using `TheoremBookCover.tsx`:
* **7 Curated Cloth Palettes**: `oxford-navy`, `terracotta`, `sage`, `crimson`, `obsidian`, `plum`, and `parchment`.
* **Deterministic Palette Hashing**: A book title/author hash consistently maps to the same cloth palette across all devices.
* **Typographic Foil Stamping**: Title and author are rendered in elegant serif typography with subtle gold/silver foil debossing effects.

---

## 4. Virtualization & Search Performance

* **Virtual Scrolling**: Search results and deep catalog feeds use `@tanstack/react-virtual` to smoothly render thousands of titles without memory degradation.
* **Non-Book OPDS Filtering**: `DiscoverService.ts` filters out zero-result banners, sub-catalogs, and navigational links so only real downloadable books render as book cards.
* **Resilient Offline Caching**: Previously fetched curated sections are cached locally, allowing the Discover tab to render instantly even during temporary network interruptions.
