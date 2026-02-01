# Lion Reader Technical Specification

## Research Analysis: Foliate GTK4 Implementation

Based on deep analysis of the Foliate e-reader source code, this document outlines the technical architecture for implementing key e-reader features.

---

## 1. Text Highlighting System

### 1.1 Architecture Overview

Foliate implements highlighting through a layered SVG overlay system:

```
┌─────────────────────────────────────────┐
│  SVG Overlayer (pointer-events: none)   │  ← Highlight overlays
│  ┌─────────────────────────────────────┐│
│  │  <g> highlight rects </g>           ││
│  │  <g> underline rects </g>           ││
│  │  <g> squiggly paths </g>            ││
│  └─────────────────────────────────────┘│
├─────────────────────────────────────────┤
│  Content iframe (text selectable)       │  ← EPUB content
└─────────────────────────────────────────┘
```

### 1.2 Core Components

**Overlayer Class** (`foliate-js/overlayer.js`):
- Uses SVG for rendering highlights to avoid interfering with text selection
- Supports multiple annotation styles: `highlight`, `underline`, `strikethrough`, `squiggly`, `outline`
- Hit testing for annotation clicks via `getClientRects()` comparison
- Automatic redraw on viewport changes

**Key Methods**:
```javascript
// Add highlight to specific text range
overlayer.add(key, range, drawFunction, options)

// Remove by key
overlayer.remove(key)

// Hit test for clicks
overlayer.hitTest({ x, y }) → [key, range]

// Redraw on resize/layout change
overlayer.redraw()
```

### 1.3 Highlight Rendering Styles

| Style | Implementation | Use Case |
|-------|---------------|----------|
| `highlight` | SVG `<rect>` with opacity/mix-blend-mode | Standard highlights |
| `underline` | SVG `<rect>` at bottom of text | Emphasis |
| `strikethrough` | SVG `<rect>` at middle of text | Deletions |
| `squiggly` | SVG `<path>` with zigzag pattern | Errors/warnings |
| `outline` | SVG `<rect>` with stroke | Search results |

### 1.4 Color System

**CSS Variables for Highlight Styling**:
```css
:root {
    --overlayer-highlight-opacity: 0.4;
    --overlayer-highlight-blend-mode: normal;
}
```

**Color Palette** (6 colors):
- Yellow: `rgba(255, 235, 59, 0.4)`
- Green: `rgba(76, 175, 80, 0.4)`
- Blue: `rgba(33, 150, 243, 0.4)`
- Red: `rgba(244, 67, 54, 0.4)`
- Orange: `rgba(255, 152, 0, 0.4)`
- Purple: `rgba(156, 39, 176, 0.4)`

### 1.5 Text Selection Flow

```
User selects text
        ↓
SelectionChange event → get CFI from range
        ↓
Show color picker popup
        ↓
User selects color
        ↓
Create annotation object
        ↓
Call view.addAnnotation({ value: cfi, color })
        ↓
Resolve CFI → get { index, anchor }
        ↓
Get overlayer for section index
        ↓
Draw: overlayer.add(cfi, range, Overlayer.highlight, { color })
        ↓
Emit 'draw-annotation' event
        ↓
Save to storage via Zustand
```

### 1.6 Data Model

```typescript
interface Highlight {
    id: string;              // UUID
    bookId: string;
    type: 'highlight';
    cfi: string;             // EPUB CFI location
    color: HighlightColor;   // 'yellow' | 'green' | 'blue' | 'red' | 'orange' | 'purple'
    text: string;            // Selected text content
    note?: string;           // Optional associated note
    createdAt: Date;
    updatedAt?: Date;
}
```

---

## 2. Bookmark Management System

### 2.1 Architecture

Bookmarks in Foliate are special annotations without color/text:

```
Bookmark = Annotation with type: 'bookmark'
```

**Storage**: Same annotation store, filtered by type.

### 2.2 Bookmark Types

1. **Location Bookmark** - Marks current reading position
2. **CFI Bookmark** - Precise location via CFI
3. **Page Bookmark** - For PDFs with page numbers

### 2.3 Data Model

```typescript
interface Bookmark {
    id: string;
    bookId: string;
    type: 'bookmark';
    location: string;        // CFI or page number
    tocLabel?: string;       // Section/chapter name
    previewText?: string;    // First 100 chars of paragraph
    createdAt: Date;
}
```

### 2.4 UI Components

**Bookmark List View**:
- Group by chapter/section
- Show preview text
- Click to navigate
- Delete with confirmation

**Quick Bookmark Button**:
- In reader toolbar
- Toggle bookmark at current location
- Visual indicator when location is bookmarked

### 2.5 Bookmark Detection

```javascript
// Check if current location has bookmark
const isBookmarked = (cfi) => {
    return bookmarks.some(b => 
        CFI.compare(b.cfi, cfi) === 0
    );
};
```

---

## 3. Annotation/Notes System

### 3.1 Architecture

Annotations combine highlighting + notes:

```
Annotation = Highlight + Note Content
```

**Note Popup Flow**:
```
Click on highlight
        ↓
overlayer.hitTest() → [key, range]
        ↓
Emit 'show-annotation' event
        ↓
Show note popup at position
        ↓
User edits note
        ↓
Save to store
```

### 3.2 Data Model

```typescript
interface Annotation {
    id: string;
    bookId: string;
    type: 'highlight' | 'note' | 'bookmark';
    cfi: string;
    color?: HighlightColor;
    text?: string;           // Selected text
    note?: string;           // User note
    tags?: string[];         // Organizing annotations
    createdAt: Date;
    updatedAt?: Date;
}
```

### 3.3 Note Editor Component

**Features**:
- Inline editing in popup
- Markdown support (optional)
- Tag management
- Timestamp display
- Delete annotation button

### 3.4 Annotation List View

**Filtering**:
- By book
- By type (highlight/note/bookmark)
- By color
- By date range
- By search query

**Sorting**:
- Date created
- Location in book
- Color

**Export Options**:
- Markdown
- HTML
- JSON

---

## 4. Dictionary Integration

### 4.1 Architecture

Foliate uses a dictionary protocol:

```
User selects word
        ↓
Right-click / Long-press
        ↓
Get selected text
        ↓
Fetch definition from dictionary API
        ↓
Show definition popup
```

### 4.2 Dictionary Sources

**Primary**: Free Dictionary API (Wiktionary)
- URL: `https://api.dictionaryapi.dev/api/v2/entries/en/{word}`
- Free, no API key required
- JSON format

**Alternative**: Local dictionary files
- StarDict format support
- Offline capability
- Faster lookup

### 4.3 Data Model

```typescript
interface DictionaryEntry {
    word: string;
    phonetic?: string;
    phonetics?: {
        text?: string;
        audio?: string;
    }[];
    meanings: {
        partOfSpeech: string;
        definitions: {
            definition: string;
            example?: string;
            synonyms: string[];
            antonyms: string[];
        }[];
    }[];
    sourceUrls: string[];
}
```

### 4.4 Dictionary Popup UI

**Layout**:
```
┌─────────────────────────────┐
│ Word [phonetic] 🔊          │
├─────────────────────────────┤
│ noun                        │
│ 1. Definition...            │
│    "Example sentence"       │
│ 2. Definition...            │
├─────────────────────────────┤
│ verb                        │
│ 1. Definition...            │
├─────────────────────────────┤
│ [Highlight] [Copy] [Close]  │
└─────────────────────────────┘
```

### 4.5 Caching Strategy

- Cache lookups in memory
- Persist to IndexedDB
- LRU eviction policy
- Max 1000 entries

---

## 5. Reading Progress Tracking

### 5.1 Progress Calculation

Foliate uses `SectionProgress` for accurate percentage:

```javascript
class SectionProgress {
    constructor(sections, avgWordsPerSection = 1500, avgCharsPerWord = 6)
    
    // Calculate size of each section
    sectionSizes = sections.map(s => {
        const size = s.linear === 'no' ? 0 
            : s.uncompressedSize || s.size || avgWordsPerSection * avgCharsPerWord
        return size
    })
    
    // Convert to fractions
    totalSize = sum(sectionSizes)
    sectionFractions = cumulativeSum(sectionSizes) / totalSize
}
```

### 5.2 Location Tracking

**CFI (Canonical Fragment Identifier)**:
- Precise location in EPUB
- Format: `epubcfi(/6/4[id123]!/4/2/1:10)`
- Can target specific text ranges

**Fraction**:
- 0.0 to 1.0 progress through book
- Calculated from section sizes
- Used for progress bar

### 5.3 Data Model

```typescript
interface ReadingProgress {
    bookId: string;
    cfi: string;              // Precise location
    fraction: number;         // 0-1 progress
    percentage: number;       // 0-100 for display
    pageInfo?: {
        currentPage: number;
        totalPages: number;
        isEstimated: boolean;
    };
    lastReadAt: Date;
    readingTime: number;      // Total minutes read
}
```

### 5.4 Auto-Save Strategy

```
Location change event
        ↓
Debounce (2 seconds)
        ↓
Save to Zustand store
        ↓
Persist to localStorage/IndexedDB
```

---

## 6. Bottom Progress Bar UI

### 6.1 Architecture

Foliate's progress bar shows:
- Current position
- Chapter/section boundaries
- Reading progress percentage

### 6.2 Component Structure

```
┌────────────────────────────────────────────────────────────┐
│ ProgressBar                                                │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ ▓▓▓▓░░░░▓▓▓▓▓▓░░░░░░▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░   │   │
│ │     ^      ^          ^                              │   │
│ │  ch.1    ch.2       ch.3                             │   │
│ └──────────────────────────────────────────────────────┘   │
│ 12% · Chapter 3: The Journey Begins                    45m │
└────────────────────────────────────────────────────────────┘
```

### 6.3 Section Markers

```typescript
interface SectionMarker {
    fraction: number;    // Position 0-1
    label: string;       // Chapter name
    index: number;       // Section index
}
```

### 6.4 Interactions

- **Hover**: Show tooltip with chapter name
- **Click**: Navigate to that position
- **Drag**: Scrub through book

### 6.5 Visual States

```css
.progress-bar {
    --progress-height: 4px;
    --progress-bg: var(--color-surface-variant);
    --progress-fill: var(--color-accent);
    --marker-color: var(--color-text-muted);
    --marker-hover-color: var(--color-accent);
}
```

---

## 7. Implementation Roadmap

### Phase 1: Core Highlighting System
1. Create `HighlightOverlayer` service
2. Implement color picker popup
3. Add text selection handling
4. Integrate with foliate-js's existing overlayer
5. Store highlights in Zustand

### Phase 2: Bookmark System
1. Create bookmark store methods
2. Add quick bookmark button
3. Create bookmark list view
4. Implement bookmark detection

### Phase 3: Annotation/Notes
1. Create note popup component
2. Implement note editing
3. Add annotation list view
4. Export functionality

### Phase 4: Dictionary
1. Implement dictionary API client
2. Create dictionary popup
3. Add caching layer
4. Support offline dictionaries

### Phase 5: Progress Bar
1. Create section marker calculation
2. Build progress bar component
3. Add tooltip and interactions
4. Integrate with reading progress

---

## 8. File Structure

```
src/
├── components/
│   └── reader/
│       ├── highlights/
│       │   ├── HighlightOverlayer.tsx    # SVG overlay management
│       │   ├── HighlightColorPicker.tsx  # Color selection popup
│       │   ├── HighlightMenu.tsx         # Selection context menu
│       │   └── index.ts
│       ├── annotations/
│       │   ├── AnnotationPopup.tsx       # Note editing popup
│       │   ├── AnnotationList.tsx        # List of all annotations
│       │   ├── AnnotationToolbar.tsx     # Annotation management
│       │   └── index.ts
│       ├── bookmarks/
│       │   ├── BookmarkButton.tsx        # Quick bookmark toggle
│       │   ├── BookmarkList.tsx          # Bookmark management
│       │   └── index.ts
│       ├── dictionary/
│       │   ├── DictionaryPopup.tsx       # Definition display
│       │   ├── DictionaryButton.tsx      # Lookup trigger
│       │   └── index.ts
│       └── progress/
│           ├── ProgressBar.tsx           # Bottom progress bar
│           ├── SectionMarkers.tsx        # Chapter indicators
│           └── index.ts
├── services/
│   ├── HighlightService.ts               # Highlight CRUD operations
│   ├── BookmarkService.ts                # Bookmark management
│   ├── AnnotationService.ts              # Annotation CRUD
│   ├── DictionaryService.ts              # Dictionary API client
│   └── ProgressService.ts                # Progress tracking
└── store/
    └── annotationStore.ts                # Extended annotation state
```

---

## 9. Key Technical Decisions

### 9.1 Why SVG for Highlights?

- **Non-intrusive**: `pointer-events: none` doesn't interfere with text selection
- **Performant**: GPU-accelerated rendering
- **Flexible**: Easy to implement different styles (highlight, underline, squiggly)
- **Redraw**: Simple to recalculate on resize/layout changes

### 9.2 Why CFI for Location?

- **Standard**: EPUB standard for precise locations
- **Robust**: Survives font size/layout changes
- **Portable**: Can be shared between devices

### 9.3 State Management Strategy

- **Zustand**: Primary state management
- **Persistence**: localStorage for settings, IndexedDB for annotations
- **Sync**: Auto-save with debouncing

---

## 10. Performance Considerations

### 10.1 Highlight Rendering

- Batch highlight additions
- Lazy load highlights for off-screen sections
- Use `requestAnimationFrame` for redraws
- Cache DOM ranges after initial calculation

### 10.2 Progress Tracking

- Debounce location updates (500ms)
- Don't save every page turn, only significant changes
- Pre-calculate section fractions on book open

### 10.3 Dictionary Lookups

- Debounce word selection (300ms)
- Cache results in memory + IndexedDB
- Cancel in-flight requests on new selection
