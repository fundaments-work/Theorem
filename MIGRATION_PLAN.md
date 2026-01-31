# Migration Plan: EPUB.js → Foliate-js

## Overview
Complete migration from EPUB.js to Foliate-js for superior rendering, pagination, and theming.

## Goals
- **Remove ALL EPUB.js code** (completely)
- **Add foliate-js as git submodule** (latest code)
- **Port exact rendering and theming from Foliate GTK app**
- **Keep only 3 themes**: Light, Sepia, Dark
- **Maintain existing UI components** (no redesign)
- **Complete TODAY**

---

## Phase 1: Setup (30 minutes)

### 1.1 Add Git Submodule
```bash
git submodule add https://github.com/johnfactotum/foliate-js.git src/foliate-js
```

### 1.2 Update Dependencies
- Remove: `epubjs`
- Add: `@zip.js/zip.js` (required by foliate-js)

### 1.3 Create Directory Structure
```
src/
├── foliate-js/                    # Git submodule
├── foliate/
│   ├── reader.ts                  # Ported from reader.js
│   ├── themes.ts                  # 3 themes only
│   └── styles.css                 # Ported styles
├── engines/
│   ├── foliate-engine.ts          # NEW: Main engine
│   └── index.ts                   # UPDATE: Export new engine
├── hooks/
│   └── useDocumentReader.ts       # UPDATE: Use foliate-engine
└── components/reader/
    ├── ReaderViewport.tsx         # REWRITE: Use foliate-view
    ├── ReaderSettings.tsx         # UPDATE: Foliate features
    └── [other components]         # UPDATE: Minor changes
```

---

## Phase 2: Port Core Files (2 hours)

### 2.1 Create `src/foliate/themes.ts`
**3 Themes Only** (from Foliate GTK):

```typescript
export const themes = [
  {
    name: 'light',
    label: 'Light',
    light: { fg: '#000000', bg: '#ffffff', link: '#0066cc' },
    dark: { fg: '#000000', bg: '#ffffff', link: '#0066cc' }
  },
  {
    name: 'sepia',
    label: 'Sepia',
    light: { fg: '#5b4636', bg: '#f1e8d0', link: '#008b8b' },
    dark: { fg: '#ffd595', bg: '#342e25', link: '#48d1cc' }
  },
  {
    name: 'dark',
    label: 'Dark',
    light: { fg: '#e0e0e0', bg: '#222222', link: '#77bbee' },
    dark: { fg: '#e0e0e0', bg: '#222222', link: '#77bbee' }
  }
]
```

### 2.2 Create `src/foliate/reader.ts`
Port the core Reader class from `foliate/src/reader/reader.js`:

**Key Functions:**
- `getCSS()` - Theme/style injection (exact from Foliate)
- `Reader` class - Event handling, annotations, progress
- `open()` - Book initialization
- Event handlers: `relocate`, `load`, `create-overlay`, etc.

**Adaptations for Web:**
- Remove WebKit-specific `emit()` function
- Replace with direct function calls or React state
- Remove GTK dialog code
- Keep core rendering logic intact

### 2.3 Create `src/foliate/styles.css`
Port CSS from `foliate/src/reader/reader.html`:

**Critical CSS Variables:**
```css
:root {
  --light-bg: #ffffff;
  --light-fg: #000000;
  --dark-bg: #222222;
  --dark-fg: #e0e0e0;
}

foliate-view::part(head),
foliate-view::part(foot) {
  font: menu;
  font-size: 9pt;
}

foliate-view {
  --overlayer-highlight-blend-mode: multiply;
}

@media (prefers-color-scheme: dark) {
  foliate-view {
    --overlayer-highlight-blend-mode: screen;
  }
}
```

---

## Phase 3: Create New Engine (1.5 hours)

### 3.1 Create `src/engines/foliate-engine.ts`

**Key Imports:**
```typescript
import { makeBook } from '../foliate-js/view.js'
import { Reader } from '../foliate/reader.js'
import { themes } from '../foliate/themes.js'
```

**Engine Interface (Same as before):**
```typescript
export class FoliateEngine {
  // Book
  async open(source: Blob, filename: string, initialLocation?: any)
  async close()
  
  // Navigation
  async goTo(target: string | number)
  async goToFraction(fraction: number)
  async next()
  async prev()
  
  // State
  setLayout(layout: LayoutSettings)
  setFlow(flow: 'paginated' | 'scrolled')
  setZoom(zoom: number)
  setMargins(margins: Margins)
  applyTheme(theme: ThemeSettings)
  
  // Annotations
  async addHighlight(cfi: string, text: string, color: string)
  async removeHighlight(id: string)
  
  // Search
  async *search(query: string): AsyncGenerator<SearchResult>
  
  // Events
  onLocationChange?: (location: DocLocation) => void
  onMetadataLoaded?: (metadata: DocMetadata) => void
  onTocLoaded?: (toc: TocItem[]) => void
  onReady?: () => void
  onError?: (error: Error) => void
}
```

**Implementation Details:**
- Create `<foliate-view>` custom element
- Initialize `Reader` class with book
- Handle all events and forward to callbacks
- Manage pagination with `setAttribute()` calls
- Apply themes via `getCSS()` function

### 3.2 Update `src/engines/index.ts`
```typescript
export { FoliateEngine } from './foliate-engine'
```

---

## Phase 4: Update Hook (30 minutes)

### 4.1 Update `src/hooks/useDocumentReader.ts`
- Replace `EpubjsEngine` import with `FoliateEngine`
- Update location handling to use foliate-js format
- Keep same React interface for components

**Key Changes:**
```typescript
// Old
import { EpubjsEngine } from '@/engines/epubjs-engine'

// New
import { FoliateEngine } from '@/engines/foliate-engine'
```

---

## Phase 5: Update Components (2 hours)

### 5.1 Rewrite `src/components/reader/ReaderViewport.tsx`

**New Implementation:**
```typescript
import { useEffect, useRef } from 'react'
import { Reader } from '@/foliate/reader'

export function ReaderViewport({
  file,
  initialLocation,
  onLocationChange,
  // ... other props
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const readerRef = useRef<Reader | null>(null)
  
  useEffect(() => {
    if (!file || !containerRef.current) return
    
    const init = async () => {
      // Create foliate-view element
      const view = document.createElement('foliate-view')
      containerRef.current.appendChild(view)
      
      // Open book
      const book = await makeBook(file)
      const reader = new Reader(book)
      await reader.init()
      
      // Handle events
      reader.view.addEventListener('relocate', (e) => {
        onLocationChange?.(e.detail)
      })
      
      readerRef.current = reader
    }
    
    init()
    
    return () => {
      readerRef.current?.view.close()
      containerRef.current?.replaceChildren()
    }
  }, [file])
  
  return <div ref={containerRef} className="w-full h-full" />
}
```

### 5.2 Update `src/components/reader/ReaderSettings.tsx`

**New Settings (from Foliate):**
- **Theme**: Light / Sepia / Dark (dropdown)
- **Invert**: Toggle for night mode
- **Layout**: Paginated / Scrolled
- **Animated**: Smooth transitions toggle
- **Gap**: Column spacing (0-10%)
- **Max Column Width**: 400-800px
- **Max Columns**: 1-2
- **Justify**: Text alignment toggle
- **Hyphenate**: Auto-hyphenation toggle
- **Override Fonts**: Force system fonts
- **Line Height**: 1.0 - 2.0

### 5.3 Update `src/components/reader/ReaderProgressBar.tsx`
Use foliate-js progress system:
- Shows page numbers from book's `pageList`
- Falls back to calculated location
- Uses `format.loc()` from foliate

### 5.4 Update `src/components/reader/ReaderToolbar.tsx`
- Update chapter display to use foliate TOC
- Add theme quick-switch button
- Keep existing navigation controls

### 5.5 Update `src/components/reader/ReaderBookmarks.tsx`
- Update CFI handling for foliate-js format
- Use `epubcfi.js` for parsing

### 5.6 Update `src/components/reader/ReaderSearch.tsx`
- Use foliate-js search module
- Async generator for results

---

## Phase 6: Types & Store (30 minutes)

### 6.1 Update `src/types/index.ts`

**New Location Type:**
```typescript
export interface DocLocation {
  index: number           // Section index
  fraction: number        // 0-1 within section
  range?: Range          // Native Range object
  cfi?: string           // CFI representation
  pageItem?: { label: string }
  tocItem?: { label: string }
  location?: {
    current: number
    next: number
    total: number
  }
}
```

### 6.2 Update `src/store/index.ts`
- Update theme storage for new theme format
- Update location persistence
- Keep Zustand store structure

---

## Phase 7: Cleanup (15 minutes)

### 7.1 Remove EPUB.js
```bash
npm uninstall epubjs
rm -f src/engines/epubjs-engine.ts
```

### 7.2 Delete Old Files
- `src/engines/epubjs-engine.ts`
- Update imports in all files

### 7.3 Install zip.js
```bash
npm install @zip.js/zip.js
```

---

## Feature Implementation Checklist

### Rendering
- [ ] CSS multi-column pagination
- [ ] Fixed layout support (comics)
- [ ] RTL text support
- [ ] Vertical writing support
- [ ] Zoom with CSS transform
- [ ] Font override

### Themes
- [ ] Light theme (exact colors from Foliate)
- [ ] Sepia theme (exact colors from Foliate)
- [ ] Dark theme (exact colors from Foliate)
- [ ] Invert mode (filter: invert(1) hue-rotate(180deg))
- [ ] CSS variable injection
- [ ] Link colors
- [ ] Background/foreground colors

### Navigation
- [ ] Previous/Next page
- [ ] Go to fraction
- [ ] Go to CFI
- [ ] Go to href
- [ ] History (back/forward)

### Pagination
- [ ] Paginated mode
- [ ] Scrolled mode
- [ ] Animated transitions
- [ ] Column gap adjustment
- [ ] Max column width
- [ ] Max column count
- [ ] Progress calculation

### Text Settings
- [ ] Line spacing
- [ ] Justify text
- [ ] Hyphenation
- [ ] Override fonts

### Annotations
- [ ] Highlight
- [ ] Underline
- [ ] Strikethrough
- [ ] Squiggly
- [ ] Color selection

### Search
- [ ] Text search
- [ ] Incremental results
- [ ] Diacritics handling
- [ ] Word matching

---

## Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Setup | 30 min | ⏳ Pending |
| Phase 2: Port Core | 2 hours | ⏳ Pending |
| Phase 3: Create Engine | 1.5 hours | ⏳ Pending |
| Phase 4: Update Hook | 30 min | ⏳ Pending |
| Phase 5: Update Components | 2 hours | ⏳ Pending |
| Phase 6: Types & Store | 30 min | ⏳ Pending |
| Phase 7: Cleanup | 15 min | ⏳ Pending |
| **Total** | **~7 hours** | |

---

## Critical Implementation Notes

1. **Custom Elements**: foliate-js uses Web Components. In React, use refs and direct DOM manipulation.

2. **CSS Variables**: Foliate uses extensive CSS variables. Ensure they are set on the document root.

3. **Event Handling**: foliate-js emits native DOM events. Bridge these to React callbacks.

4. **Range Objects**: foliate-js returns native Range objects. Convert to CFI for storage using `epubcfi.js`.

5. **Async Generators**: Search uses async generators. Handle with `for await...of` loops.

6. **Zip.js**: Required for EPUB parsing. Must be loaded before foliate-js.

7. **Module Imports**: foliate-js uses ES modules. Use dynamic imports or configure bundler.

---

## Testing Checklist

- [ ] Open EPUB file
- [ ] Navigate pages
- [ ] Switch themes (Light/Sepia/Dark)
- [ ] Toggle invert mode
- [ ] Change layout (Paginated/Scrolled)
- [ ] Adjust column width
- [ ] Search text
- [ ] Add highlight
- [ ] Progress bar updates
- [ ] TOC navigation
- [ ] Bookmarks work
- [ ] Settings persist

---

## Success Criteria

1. ✅ Zero EPUB.js code remains
2. ✅ foliate-js rendering active
3. ✅ All 3 themes work exactly like Foliate GTK
4. ✅ Pagination is smooth and fast
5. ✅ All existing features still work
6. ✅ No UI redesign (same components)

---

## Migration Complete! 🎉

**Status**: In Progress  
**Started**: Today  
**Target**: Complete Today  
**Priority**: CRITICAL  
