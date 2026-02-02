# Lion Reader - Vision & Roadmap

> A powerful, unified reading platform for books, documents, articles, and web content with advanced annotation, learning, and knowledge management features.

---

## Core Philosophy

**"Read everything in one place, capture knowledge effortlessly, review and retain forever."**

Lion Reader aims to be the ultimate reading companion that:
- Unifies all reading formats (EPUB, PDF, RSS, Web)
- Makes annotation and knowledge capture seamless
- Helps users learn and retain through spaced repetition and reviews
- Integrates with existing knowledge management tools (Obsidian)
- Works across devices with sync capabilities

---

## Technical Decisions

### PDF Rendering Strategy

**Research Findings:**
- Poppler is **NOT available** for mobile (Android/iOS)
- Tauri mobile uses WebView, making JavaScript-based PDF rendering the best cross-platform option
- `react-pdf` (by wojtekmaj) is the most mature React wrapper for Mozilla's PDF.js
- For large PDFs (100MB+), we need: Range requests, Virtual scrolling, Canvas cleanup

**Final Decision:**
- **Use `react-pdf` with PDF.js** for all platforms (desktop + mobile)
- **Benefits:**
  - Single codebase for all platforms
  - Tauri integration is straightforward
  - Good performance with proper optimization
  - Annotation support via custom overlay layer
- **Optimization strategies for large PDFs:**
  - Range requests (partial loading)
  - Virtual scrolling (only render visible pages)
  - Canvas recycling and cleanup
  - Lower resolution for thumbnails

### Dictionary
- **Online:** Free Dictionary API (fastest, reliable)
- **Offline:** Optional downloadable dictionary packs (StarDict format)
- **User choice:** Toggle between online/offline per lookup

### RSS & Web Content
- **Full Pocket/Instapaper experience**
- Mozilla Readability for article extraction
- Full-text search across saved content
- Offline reading support

### Sync Architecture
- **Both options:** Self-hosted AND cloud service
- **Priority:** LAST (after core features)
- **Encryption:** End-to-end for user data
- **Offline-first:** Core functionality works without sync

---

## Phase 1: PDF Support (Priority: HIGHEST)

### 1.1 PDF.js Integration via react-pdf
**Goal:** Handle large PDFs smoothly on all platforms

**Technology Stack:**
- `react-pdf` (v7+) - React wrapper for PDF.js
- PDF.js worker (bundled or CDN)
- Custom annotation overlay layer

**Features:**
- [ ] Integrate `react-pdf` with Tauri
- [ ] Unified reader UI for PDF and EPUB
- [ ] Text selection and highlighting
- [ ] Multi-color annotations (highlight, underline, strikethrough)
- [ ] Freehand drawing (ink annotations)
- [ ] Sticky notes on PDF pages
- [ ] Area highlights for diagrams/images
- [ ] PDF search within document
- [ ] Outline/Bookmarks navigation
- [ ] Zoom controls (fit width, fit page, custom 50%-400%)
- [ ] Page thumbnail sidebar
- [ ] Continuous scroll or page-by-page modes
- [ ] Annotation export (JSON, embedded PDF)

### 1.2 Large PDF Optimization
**Critical for 100MB+ files:**

- [ ] **Range Request Support**
  - Partial loading (only load visible pages)
  - HTTP Range headers for progressive loading
  - Tauri custom protocol handler for file:// with range support
  
- [ ] **Virtual Scrolling**
  - Only render pages in viewport + buffer
  - Recycle canvas elements
  - Preload adjacent pages
  
- [ ] **Memory Management**
  - Canvas cleanup when pages leave viewport
  - PDF document cleanup on unmount
  - Worker termination and recreation
  
- [ ] **Thumbnail Generation**
  - Lower resolution thumbnails (0.5x)
  - Lazy thumbnail loading
  - Thumbnail cache

### 1.3 PDF Annotation System
- [ ] **Annotation Layer Architecture**
  ```
  PDF Page (Canvas from react-pdf)
  ↓
  Text Layer (for selection)
  ↓
  Annotation Layer (SVG/Canvas overlay)
  ↓
  Interaction Layer (click handlers)
  ```
  
- [ ] **Annotation Types:**
  - Highlight (with color selection)
  - Underline
  - Strikethrough
  - Freehand drawing (SVG paths)
  - Text notes (positioned on page)
  - Area selection (rectangular highlights)
  
- [ ] **Storage:**
  - JSON-based annotation format
  - Page coordinates (x, y, width, height)
  - Quads for text highlights (PDF standard)
  - Sync-ready structure

- [ ] **Import/Export:**
  - Export annotations as JSON
  - Import annotations
  - Future: Embed annotations in PDF (PDF standard)

### 1.4 Mobile PDF Optimization
- [ ] Touch gestures (pinch zoom, swipe to turn page)
- [ ] Lower default resolution for mobile
- [ ] Smaller viewport buffer
- [ ] Hardware acceleration hints

---

## Phase 2: Dictionary & Vocabulary (Priority: HIGH)

### 2.1 Dictionary System
**Goal:** Seamless word lookup while reading

- [ ] Word selection → instant popup definition
- [ ] Free Dictionary API integration (primary)
- [ ] Wiktionary fallback
- [ ] Pronunciation audio (where available)
- [ ] Multiple definitions with parts of speech
- [ ] Example sentences

### 2.2 Offline Dictionary (Optional Download)
- [ ] StarDict format support
- [ ] Downloadable dictionary packs
- [ ] User toggle: Online / Offline / Auto-fallback
- [ ] Compression for storage efficiency

### 2.3 Vocabulary Builder
- [ ] One-click "Add to Vocabulary" from any document
- [ ] Save word + context sentence + source document
- [ ] Personal vocabulary list with search/filter
- [ ] Spaced repetition algorithm (FSRS)
- [ ] Daily review notifications
- [ ] Flashcard mode for vocabulary review
- [ ] Progress tracking and stats
- [ ] Export to Anki/CSV

### 2.4 Daily Review System
- [ ] Morning digest of vocabulary to review
- [ ] Highlights resurfacing for memory reinforcement
- [ ] Reading streak reminders
- [ ] Customizable review schedule

---

## Phase 3: RSS & Web Clipper (Priority: HIGH)

### 3.1 RSS Feed Reader - "Read It Later"
**Full Pocket/Instapaper-style experience**

- [ ] RSS/Atom feed subscription
- [ ] Feed discovery from URL
- [ ] Article extraction (Mozilla Readability)
- [ ] Unified reader UI (same as EPUB/PDF)
- [ ] Full-text search across all saved articles
- [ ] Folder/tag organization
- [ ] Star/bookmark articles
- [ ] Archive vs active queue
- [ ] Auto-sync feeds in background
- [ ] Import/Export OPML
- [ ] Article count badges

### 3.2 Web Clipper Browser Extension
**One-click save from any webpage**

- [ ] Chrome extension
- [ ] Firefox extension
- [ ] Safari extension
- [ ] One-click "Save to Lion Reader"
- [ ] Content extraction (article mode)
- [ ] Full page save option
- [ ] Tag selection during save
- [ ] Add notes while clipping
- [ ] Keyboard shortcuts

### 3.3 Web Highlights
**Highlight any web content before saving**

- [ ] Text highlighting on any webpage
- [ ] Color selection
- [ ] Add notes to highlights
- [ ] Clip with highlights preserved
- [ ] Save full page or selection only
- [ ] Context menu integration

### 3.4 Saved Web Content Management
- [ ] Web viewer for saved articles
- [ ] Original link preservation
- [ ] Screenshot/archive options
- [ ] Tag and organize web clips
- [ ] Search across all web content

---

## Phase 4: Newsletter Subscriptions (Priority: MEDIUM)

### 4.1 Email-to-Reader
**Reference: Omnivore (open source, archived)**

- [ ] Unique email address per user
- [ ] Email ingestion pipeline
- [ ] Newsletter parsing and extraction
- [ ] Convert newsletters to readable format
- [ ] Newsletter organization (sender-based folders)
- [ ] Unsubscribe detection and handling
- [ ] Support Substack, Revue, Buttondown, etc.

### 4.2 Newsletter Features
- [ ] Newsletter tagging
- [ ] Archive old newsletters
- [ ] Newsletter-specific search
- [ ] Sender filtering/blocking

---

## Phase 5: Integrations (Priority: MEDIUM)

### 5.1 Obsidian Export
- [ ] Export highlights to Obsidian vault
- [ ] Customizable Markdown templates
- [ ] YAML frontmatter with metadata
- [ ] Backlinks to source document
- [ ] Tag synchronization
- [ ] Auto-export on highlight option
- [ ] Bulk export functionality

### 5.2 Public API
- [ ] REST API for library access
- [ ] CRUD for highlights and notes
- [ ] Vocabulary access
- [ ] Reading progress API
- [ ] API key authentication
- [ ] Webhook support
- [ ] OpenAPI documentation

---

## Phase 6: Text-to-Speech (Priority: LOWER)

### 6.1 TTS Features
- [ ] Native Web Speech API integration
- [ ] Speed control (0.5x - 3x)
- [ ] Voice selection
- [ ] Sentence/word highlighting while speaking
- [ ] Sleep timer
- [ ] Background audio playback
- [ ] Chapter queue/playlist

### 6.2 Premium Voices (Future)
- [ ] ElevenLabs integration
- [ ] Azure TTS
- [ ] Voice quality selection

---

## Phase 7: Sync & Cross-Platform (Priority: LAST)

### 7.1 Sync Infrastructure
- [ ] User accounts and authentication
- [ ] Self-hosted sync server option
- [ ] Cloud sync service option
- [ ] End-to-end encryption
- [ ] Offline-first architecture
- [ ] Conflict resolution
- [ ] Selective sync settings
- [ ] Background sync

### 7.2 Mobile Apps
- [ ] iOS app (via Tauri mobile)
- [ ] Android app (via Tauri mobile)
- [ ] Mobile-optimized reading experience
- [ ] Native sharing integrations
- [ ] Mobile-specific features (swipe gestures)

---

## PDF Technical Implementation Details

### react-pdf Setup with Tauri

```typescript
// PDF Viewer Component Architecture
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

// Worker setup for Tauri
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Large PDF optimization options
const PDF_OPTIONS = {
  cMapUrl: '/cmaps/',
  cMapPacked: true,
  // Enable range requests
  rangeChunkSize: 65536,
  disableAutoFetch: false,
  disableStream: false,
};
```

### Virtual Scrolling Implementation

```typescript
// Only render visible pages + buffer
const VISIBLE_BUFFER = 2; // Pages above/below viewport
const MAX_CANVASES = 5;   // Recycle canvas elements

// Page visibility tracking
interface PageVisibility {
  pageNumber: number;
  isVisible: boolean;
  priority: 'high' | 'low';
}
```

### Annotation Overlay System

```typescript
interface PDFAnnotation {
  id: string;
  page: number;
  type: 'highlight' | 'note' | 'ink';
  // Coordinates in PDF points (72 DPI)
  rect: { x: number; y: number; width: number; height: number };
  // For text highlights
  quads?: number[]; // [x1,y1,x2,y2,x3,y3,x4,y4] for each quad
  color: string;
  content?: string; // For notes
  // For ink
  paths?: Array<{ x: number; y: number }>;
}

// Render as SVG overlay on top of PDF page
<Page canvasRef={canvasRef}>
  <AnnotationLayer 
    annotations={pageAnnotations}
    onAnnotationClick={handleAnnotationClick}
    scale={pageScale}
  />
</Page>
```

---

## Unified Reader UI Architecture

The reader must be format-agnostic and consistent across all content types:

```
┌─────────────────────────────────────────────────────┐
│  Titlebar (Book/Article Title, Progress, Menu)     │
├─────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────┐  │
│  │                                              │  │
│  │           Content Area                       │  │
│  │                                              │  │
│  │    • EPUB: Flowing text with pagination     │  │
│  │    • PDF: Page-by-page with zoom (react-pdf)│  │
│  │    • RSS/Web: Article view                  │  │
│  │                                              │  │
│  │   Interaction Layer:                        │  │
│  │   • Text selection → Highlight/Note        │  │
│  │   • Dictionary lookup popup                │  │
│  │   • Annotation sidebar toggle              │  │
│  │   • TTS controls                           │  │
│  │                                              │  │
│  └──────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  Bottom Bar: Progress | Page/Location | Controls    │
└─────────────────────────────────────────────────────┘
```

---

## Data Model: Universal Annotation

```typescript
interface Annotation {
  id: string;
  documentId: string;
  documentType: 'epub' | 'pdf' | 'rss' | 'web' | 'newsletter';
  type: 'highlight' | 'note' | 'bookmark' | 'vocabulary';
  
  // Format-specific location
  location: {
    // EPUB
    epub?: { cfi: string };
    // PDF (using PDF.js coordinates)
    pdf?: { 
      page: number; 
      rect: { x: number; y: number; width: number; height: number };
      quads?: number[]; // For text selection
    };
    // RSS/Web/Newsletter
    web?: { url: string; selector?: string; paragraphIndex?: number; offset: number };
  };
  
  content: {
    selectedText?: string;
    noteContent?: string;
    // For vocabulary
    word?: string;
    definition?: string;
    contextSentence?: string;
  };
  
  color?: HighlightColor;
  createdAt: Date;
  updatedAt?: Date;
  
  // For export/sync
  tags?: string[];
}
```

---

## Technology Stack

### Current
- React + TypeScript
- Tauri (Rust backend)
- Tailwind CSS
- Zustand (state)
- Foliate-js (EPUB)

### New Additions
- **PDF:** `react-pdf` (v7+) + PDF.js + custom annotation layer
- **Dictionary:** Free Dictionary API + StarDict parser
- **RSS:** Feed parser + Readability
- **Web Clipper:** Browser extension (Plasmo framework)
- **Newsletter:** Mail parsing (mail-parser crate in Rust)
- **TTS:** Web Speech API + optional cloud providers
- **Sync:** SQLite (local) + REST API + optional self-hosted server

---

## Implementation Order

### Sprint 1-3: PDF Foundation (6 weeks)
1. react-pdf integration with Tauri
2. Basic PDF viewer component
3. Virtual scrolling implementation
4. Text selection and highlighting
5. Annotation storage system

### Sprint 4-5: Dictionary (4 weeks)
1. Dictionary API integration
2. Word selection popup
3. Vocabulary list UI
4. Spaced repetition system

### Sprint 6-8: RSS & Web (6 weeks)
1. RSS feed reader
2. Readability integration
3. Web clipper extension
4. Saved article viewer

### Sprint 9-10: Newsletter (4 weeks)
1. Email ingestion system
2. Newsletter parsing
3. Email address generation
4. Omnivore reference study

### Sprint 11-12: Integrations (4 weeks)
1. Obsidian export
2. Public API foundation
3. Webhook system

### Sprint 13: TTS (2 weeks)
1. Web Speech API integration
2. TTS controls in reader

### Sprint 14-16: Sync (6 weeks)
1. User accounts
2. Self-hosted server
3. Cloud service
4. Mobile apps preparation

**Total: ~32 weeks (8 months) for full feature set**

---

## MVP Scope (First Release)

**Must have:**
- PDF support with react-pdf (desktop + mobile)
- Dictionary with online API
- Basic RSS reader
- Web clipper (Chrome/Firefox)
- Obsidian export

**Nice to have for MVP:**
- Offline dictionary
- Vocabulary SRS
- Newsletter support

**Post-MVP:**
- TTS
- Sync
- Mobile apps
- Public API

---

## Success Metrics

- [ ] PDF: Handle 200MB+ files smoothly
- [ ] PDF: Virtual scroll at 60fps
- [ ] Dictionary: <500ms lookup time
- [ ] Annotation: <100ms save time
- [ ] RSS: Support 100+ feeds
- [ ] Web Clipper: One-click save in <3 seconds
- [ ] Vocabulary: Effective retention tracking

---

## Key Research Notes

**Why react-pdf over Poppler?**
- Poppler not available on mobile (iOS/Android)
- Tauri's WebView makes JavaScript PDF rendering natural
- react-pdf provides good abstraction over PDF.js
- Single codebase for all platforms

**Handling Large PDFs with react-pdf:**
- Enable Range requests (partial loading)
- Implement virtual scrolling
- Recycle canvas elements
- Use lower resolution for thumbnails
- Proper cleanup on unmount

**Mobile Performance:**
- Lower default scale on mobile
- Reduce visible buffer size
- Use CSS transforms for zoom
- Touch gesture optimization

---

*Ready to start with Phase 1: PDF Support using react-pdf?*
