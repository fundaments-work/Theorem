# RSS Full Article Extraction & Readability Engine Design

**Date**: 2026-08-30  
**Status**: Proposal / Planning  
**Area**: RSS Reader / Content Extraction / Foliate Engine  

---

## 1. Executive Summary

Most modern RSS feeds provide only a brief excerpt or truncated summary in their XML `<description>` tag to encourage users to visit their website. 

This design outlines an on-demand, local-first **Full Article Extraction Pipeline** using `@mozilla/readability` and Tauri's native `fetch_url_content` command. When an article is opened, Theorem fetches the original webpage, extracts the clean reader-view content (text, lead images, headings, code blocks) stripped of clutter, and renders it seamlessly inside the **Foliate Reader Engine** with full offline persistence.

---

## 2. Architecture & Data Flow

```
User Opens RSS Article
         │
         ▼
┌────────────────────────────────────────────────────────┐
│ Has cached fullContent in rssStore / SQLite?            │
└────────────────────────────────────────────────────────┘
         ├── YES ──► Pass fullContent to convertArticleToEpubBlob()
         │           Render in Foliate Reader immediately
         │
         └── NO  ──► Render available feed summary/content first (<1ms)
                     Show subtle "Fetching full article..." indicator
                            │
                            ▼
                     ArticleExtractorService.extract(article.url)
                            ├─ Tauri: invoke('fetch_url_content', { url })
                            │         (rotates User-Agents, handles 403/429)
                            └─ Web: fetch(url)
                            │
                            ▼
                     DOMParser -> @mozilla/readability -> Article
                     (Extracts: title, byline, content HTML, lead image)
                            │
                            ▼
                     Sanitize via DOMPurify
                     Update rssStore + persist to SQLite
                            │
                            ▼
                     Hot-update Foliate Reader with Full Article EPUB
```

---

## 3. Key Components

### A. `@mozilla/readability` Parser
- Standard, battle-tested readability algorithm used in Firefox Reader View.
- Lightweight (~30 KB), zero native dependencies, runs on browser DOM or `DOMParser`.
- Accurately identifies the primary article content block while eliminating:
  - Navigation headers and footers
  - Advertisements and sponsored widgets
  - Cookie consent banners and modal overlays
  - Comment sections and sidebars

### B. Network Fetcher with Anti-Blocking (`fetch_url_content`)
- Leverages existing Tauri Rust command `fetch_url_content(url)` in `src-tauri/src/lib.rs`.
- Features User-Agent rotation (Chrome, Firefox, Safari desktop headers), referer spoofing, and automatic 45-second connection timeout.
- Bypasses browser CORS restrictions on desktop and mobile.

### C. On-Demand vs Toggle Modes
- **Auto-Fetch on Open**: When user opens an article with short content (< 500 characters or missing paragraphs), Theorem automatically fetches the full web version in the background.
- **Manual Toggle in Reader Navbar / Titlebar**: A button in `WindowTitlebar` allows switching between **Feed Summary** and **Full Article**.

### D. Offline Persistence & Caching
- Extracted article content is stored in `RssArticle.fullContent` and persisted to SQLite via `rssStore`.
- Once fetched, the full article is available permanently offline and can be read, highlighted, and spoken via TTS with zero network connection.

---

## 4. Proposed Implementation Plan

1. **Install Dependency**:
   ```bash
   pnpm add @mozilla/readability
   ```
2. **Implement `src/core/services/ArticleExtractorService.ts`**:
   - `fetchRawHtml(url: string): Promise<string>`
   - `extractArticleContent(url: string): Promise<ExtractedArticle | null>`
3. **Extend `RssArticle` Type**:
   - Add optional `fullContent?: string;` and `contentSource?: 'feed' | 'extracted';`
4. **Integrate with `Reader.tsx` & `convertArticleToEpubBlob`**:
   - Prefer `article.fullContent || article.content || article.summary` when generating the in-memory EPUB.
   - Add a subtle reload/full-text toggle button in the reader titlebar.
5. **Quality Gates**:
   - Unit tests in `tests/article-extractor.test.ts`.
   - Verify `pnpm typecheck` and `pnpm test`.
