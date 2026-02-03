# PDFium Integration Guide for Lion Reader

## Overview

This document provides comprehensive guidance for integrating `pdfium-render` into the Lion Reader Tauri application to create a powerful, feature-rich PDF reader with native performance.

**Goal**: Build a professional PDF reader with annotations, bookmarks, resume functionality, thumbnails, and all standard reader features.

---

## 📚 Essential Documentation Links

### Primary Documentation
- **Crate Documentation**: https://docs.rs/pdfium-render/latest
- **GitHub Repository**: https://github.com/ajrcarey/pdfium-render
- **Examples**: https://github.com/ajrcarey/pdfium-render/tree/master/examples

### Pre-built Binaries
- **Desktop Binaries**: https://github.com/bblanchon/pdfium-binaries/releases
- **Mobile/WASM Binaries**: https://github.com/paulocoutinhox/pdfium-lib/releases

### PDFium Source
- **Official Repository**: https://pdfium.googlesource.com/pdfium/

### Related Crates
- **pdfium-rs (Alternative)**: https://docs.rs/pdfium/latest/pdfium/ - Lower-level API, thread-safe static access

---

## 🏗️ Architecture

### System Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (React/TypeScript)                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ PDFViewer    │ │ Thumbnails   │ │ Annotations Overlay      │ │
│  │ Component    │ │ Panel        │ │ (Canvas-based)           │ │
│  └──────┬───────┘ └──────┬───────┘ └────────────┬─────────────┘ │
└─────────┼────────────────┼──────────────────────┼───────────────┘
          │                │                      │
          │ Tauri IPC      │ Tauri IPC            │ Tauri IPC
          │ (Commands)     │ (Commands)           │ (Commands)
          ▼                ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Tauri Backend (Rust)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ PDF Service Module                                       │   │
│  │ • pdfium-render integration                              │   │
│  │ • Document cache management                              │   │
│  │ • Page rendering pipeline                                │   │
│  │ • Annotation handling                                    │   │
│  └────────────────────┬─────────────────────────────────────┘   │
│                       │                                          │
│  ┌────────────────────▼─────────────────────────────────────┐   │
│  │ PDFium Dynamic Library                                   │   │
│  │ (pdfium.dll / libpdfium.dylib / libpdfium.so)            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Principles
1. **Lazy Loading**: Only render visible pages
2. **Caching**: Cache rendered pages and document metadata
3. **Progressive Enhancement**: Load low-res first, then high-res
4. **State Persistence**: Auto-save reading position every 5 seconds
5. **Thread Safety**: Use mutex-protected PDFium access (handled by crate)

---

## 📦 Implementation Phases

### Phase 1: Core PDF Rendering
**Goal**: Basic PDF viewing with page navigation

**Tauri Commands to Implement**:
```rust
// Load PDF from bytes (received from frontend)
#[tauri::command]
async fn pdf_load(state: State<'_, PdfState>, bytes: Vec<u8>) -> Result<PdfInfo, Error>

// Render specific page at specific scale
#[tauri::command]
async fn pdf_render_page(
    state: State<'_, PdfState>, 
    page_index: u32, 
    scale: f32,
    max_width: Option<u32>
) -> Result<String, Error> // Returns base64 PNG

// Get document info (page count, metadata)
#[tauri::command]
async fn pdf_get_info(state: State<'_, PdfState>) -> Result<PdfInfo, Error>

// Close document and free resources
#[tauri::command]
async fn pdf_close(state: State<'_, PdfState>) -> Result<(), Error>
```

**Key APIs**:
```rust
use pdfium_render::prelude::*;

// Initialize PDFium
let pdfium = Pdfium::default();

// Load document from bytes
let document = pdfium.load_pdf_from_byte_slice(&bytes, password)?;

// Get page count
let page_count = document.pages().len();

// Render page
let page = document.pages().get(page_index)?;
let render_config = PdfRenderConfig::new()
    .set_target_width(width)
    .set_maximum_height(height);
    
let image = page.render_with_config(&render_config)?
    .as_image()
    .into_rgb8();

// Convert to base64 for frontend
let mut buffer = Cursor::new(Vec::new());
image.write_to(&mut buffer, ImageFormat::Png)?;
let base64 = BASE64_STANDARD.encode(buffer.into_inner());
```

---

### Phase 2: Table of Contents & Navigation
**Goal**: Extract and display document outline/bookmarks

**Tauri Commands**:
```rust
#[tauri::command]
async fn pdf_get_outline(state: State<'_, PdfState>) -> Result<Vec<OutlineItem>, Error>

#[tauri::command]
async fn pdf_navigate_to_destination(
    state: State<'_, PdfState>, 
    destination: String
) -> Result<PageLocation, Error>
```

**Key APIs**:
```rust
// Get bookmarks/outline
for bookmark in document.bookmarks() {
    let title = bookmark.title();
    let page_index = bookmark.destination()?.page_index()?;
    // Recursively get children
    for child in bookmark.children() { ... }
}

// Named destinations
for dest in document.destinations() {
    let page_index = dest.page_index()?;
    let view = dest.view()?;
}
```

---

### Phase 3: Thumbnails Panel
**Goal**: Sidebar with page thumbnails for quick navigation

**Tauri Commands**:
```rust
#[tauri::command]
async fn pdf_render_thumbnail(
    state: State<'_, PdfState>,
    page_index: u32,
    max_size: u32 // e.g., 150px
) -> Result<String, Error>

#[tauri::command]
async fn pdf_render_thumbnails_batch(
    state: State<'_, PdfState>,
    start_page: u32,
    count: u32,
    max_size: u32
) -> Result<Vec<(u32, String)>, Error>
```

**Key APIs**:
```rust
// Render thumbnail (small, fast)
let render_config = PdfRenderConfig::new()
    .set_target_width(150) // Small size for thumbnail
    .set_render_flags(
        PdfRenderConfig::RENDER_FLAGS_ANTI_ALIASING_TEXT |
        PdfRenderConfig::RENDER_FLAGS_ANTI_ALIASING_IMAGES
    );
```

---

### Phase 4: Text Layer & Search
**Goal**: Text selection, copying, and search functionality

**Tauri Commands**:
```rust
#[tauri::command]
async fn pdf_get_text_content(
    state: State<'_, PdfState>,
    page_index: u32
) -> Result<Vec<TextItem>, Error>

#[tauri::command]
async fn pdf_search(
    state: State<'_, PdfState>,
    query: String,
    options: SearchOptions
) -> Result<Vec<SearchResult>, Error>

#[tauri::command]
async fn pdf_extract_text(
    state: State<'_, PdfState>,
    page_range: Option<(u32, u32)>
) -> Result<String, Error>
```

**Key APIs**:
```rust
// Get all text on page with positions
let page_text = page.text()?;
for text_segment in page_text.segments() {
    let text = text_segment.text();
    let bounds = text_segment.bounds(); // PdfRect
    // bounds.left, bounds.top, bounds.right, bounds.bottom
}

// Search text
let search = page_text.search("query", &PdfSearchOptions::default())?;
for result in search.iter() {
    let bounds = result.bounds();
    // Highlight these bounds on canvas
}

// Extract all text
let all_text = page_text.all();
```

---

### Phase 5: Annotation System
**Goal**: Create, read, and display annotations (highlights, notes)

**Tauri Commands**:
```rust
#[tauri::command]
async fn pdf_get_annotations(
    state: State<'_, PdfState>,
    page_index: u32
) -> Result<Vec<Annotation>, Error>

#[tauri::command]
async fn pdf_add_highlight(
    state: State<'_, PdfState>,
    page_index: u32,
    rect: Rect,
    color: String // "#RRGGBB"
) -> Result<String, Error> // Returns annotation ID

#[tauri::command]
async fn pdf_add_text_annotation(
    state: State<'_, PdfState>,
    page_index: u32,
    position: Point,
    text: String,
    author: Option<String>
) -> Result<String, Error>

#[tauri::command]
async fn pdf_remove_annotation(
    state: State<'_, PdfState>,
    annotation_id: String
) -> Result<(), Error>

#[tauri::command]
async fn pdf_save_document(
    state: State<'_, PdfState>,
    path: Option<String> // None = save to original
) -> Result<(), Error>
```

**Key APIs**:
```rust
// Read annotations
for annotation in page.annotations() {
    let annotation_type = annotation.annotation_type()?;
    let bounds = annotation.bounds()?;
    let content = annotation.contents()?; // For text annotations
    
    match annotation_type {
        PdfAnnotationType::Highlight => { ... }
        PdfAnnotationType::Text => { ... }
        PdfAnnotationType::Ink => { ... } // Freehand drawing
        PdfAnnotationType::Link => { ... }
        _ => {}
    }
}

// Create highlight annotation (requires annotation creation APIs)
// Note: pdfium-render supports creating annotations through page objects
// or using the low-level FPDF_* API
```

**Annotation Rendering Strategy**:
Since PDFium renders annotations to bitmap, for interactive annotations we need:
1. Render page without annotations (`render_config.clear_render_flags(...)`)
2. Get annotation positions separately
3. Render annotations as overlay in frontend (HTML/CSS or Canvas)
4. Allow interaction with overlay elements

---

### Phase 6: Advanced Features

#### Resume Reading Position
```rust
#[tauri::command]
async fn pdf_get_current_location(state: State<'_, PdfState>) -> Result<Location, Error>

// Location structure
struct Location {
    page_index: u32,
    // For precise position within page (optional)
    x: Option<f32>,
    y: Option<f32>,
    zoom: f32,
}
```

**Implementation**:
- Auto-save location every 5 seconds
- Store in Tauri store or frontend localStorage
- Restore on document reopen

#### Form Field Support
```rust
#[tauri::command]
async fn pdf_get_form_fields(
    state: State<'_, PdfState>
) -> Result<Vec<FormField>, Error>

#[tauri::command]
async fn pdf_set_form_field_value(
    state: State<'_, PdfState>,
    field_name: String,
    value: String
) -> Result<(), Error>
```

**Key APIs**:
```rust
// Get form
if let Some(form) = document.form() {
    for field in form.fields() {
        let name = field.name()?;
        let value = field.value()?;
        let field_type = field.field_type()?; // Text, Button, Checkbox, etc.
    }
}
```

#### Links (Internal & External)
```rust
#[tauri::command]
async fn pdf_get_links(
    state: State<'_, PdfState>,
    page_index: u32
) -> Result<Vec<Link>, Error>

// Link structure
struct Link {
    bounds: Rect,       // Clickable area
    target: LinkTarget, // Internal page or external URL
}

enum LinkTarget {
    Internal { page_index: u32, view: ViewDestination },
    External { url: String },
}
```

**Key APIs**:
```rust
for link in page.links() {
    let bounds = link.bounds()?;
    if let Some(dest) = link.destination() {
        // Internal link
        let page_index = dest.page_index()?;
    } else if let Some(uri) = link.uri() {
        // External link
        let url = uri.uri()?;
    }
}
```

---

## 🔧 Technical Implementation Details

### State Management

```rust
use std::sync::Mutex;
use std::collections::HashMap;
use pdfium_render::prelude::*;

pub struct PdfState {
    // PDFium instance (thread-safe via crate's internal mutex)
    pdfium: Pdfium,
    // Currently open documents
    documents: Mutex<HashMap<String, PdfDocument>>,
    // Cache for rendered pages (LRU cache recommended)
    page_cache: Mutex<lru::LruCache<(String, u32, u32), Vec<u8>>>,
}

impl PdfState {
    pub fn new() -> Result<Self, PdfError> {
        let pdfium = Pdfium::default();
        
        Ok(Self {
            pdfium,
            documents: Mutex::new(HashMap::new()),
            page_cache: Mutex::new(lru::LruCache::new(50)), // 50 pages
        })
    }
}
```

### Rendering Configuration

```rust
fn create_render_config(
    viewport_width: u32,
    viewport_height: u32,
    scale: f32,
    quality: RenderQuality
) -> PdfRenderConfig {
    let base_config = PdfRenderConfig::new();
    
    match quality {
        RenderQuality::Draft => {
            base_config
                .set_target_width((viewport_width as f32 * scale) as u32)
                .set_render_flags(0) // No anti-aliasing for speed
        }
        RenderQuality::Normal => {
            base_config
                .set_target_width((viewport_width as f32 * scale) as u32)
                .set_render_flags(
                    PdfRenderConfig::RENDER_FLAGS_ANTI_ALIASING_TEXT
                )
        }
        RenderQuality::High => {
            base_config
                .set_target_width((viewport_width as f32 * scale * 2.0) as u32) // 2x for retina
                .set_maximum_height((viewport_height as f32 * scale * 2.0) as u32)
                .set_render_flags(
                    PdfRenderConfig::RENDER_FLAGS_ANTI_ALIASING_TEXT |
                    PdfRenderConfig::RENDER_FLAGS_ANTI_ALIASING_IMAGES |
                    PdfRenderConfig::RENDER_FLAGS_ANTI_ALIASING_PATHS
                )
        }
    }
}
```

### Error Handling

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum PdfCommandError {
    #[error("PDFium error: {0}")]
    Pdfium(#[from] PdfiumError),
    
    #[error("Document not found: {0}")]
    DocumentNotFound(String),
    
    #[error("Page not found: {0}")]
    PageNotFound(u32),
    
    #[error("Rendering error: {0}")]
    RenderingError(String),
    
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

// Convert to Tauri error
impl serde::Serialize for PdfCommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
```

---

## 📱 Frontend Architecture

### React Components Structure

```typescript
// Core PDF Viewer
interface PDFViewerProps {
  documentId: string;
  initialPage?: number;
  onPageChange?: (page: number) => void;
  onLocationChange?: (location: Location) => void;
}

// Main component
export const PDFViewer: React.FC<PDFViewerProps> = ({
  documentId,
  initialPage = 0,
  onPageChange,
  onLocationChange
}) => {
  const [documentInfo, setDocumentInfo] = useState<PdfInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [scale, setScale] = useState(1.0);
  const [renderedPages, setRenderedPages] = useState<Map<number, string>>(new Map());
  
  // Load document
  useEffect(() => {
    loadDocument(documentId);
  }, [documentId]);
  
  // Render visible pages
  useEffect(() => {
    renderVisiblePages();
  }, [currentPage, scale]);
  
  return (
    <div className="pdf-viewer">
      <PDFToolbar 
        currentPage={currentPage}
        totalPages={documentInfo?.pageCount || 0}
        scale={scale}
        onPageChange={setCurrentPage}
        onScaleChange={setScale}
      />
      <PDFCanvas
        pages={renderedPages}
        currentPage={currentPage}
        scale={scale}
        onScroll={handleScroll}
      />
      <PDFAnnotationsOverlay
        annotations={annotations}
        scale={scale}
        onAnnotationClick={handleAnnotationClick}
      />
    </div>
  );
};
```

### Tauri API Layer

```typescript
// src/lib/pdf-api.ts
import { invoke } from '@tauri-apps/api/core';

export interface PdfInfo {
  pageCount: number;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
  };
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OutlineItem {
  title: string;
  pageIndex: number;
  children: OutlineItem[];
}

export const pdfApi = {
  loadDocument: (bytes: Uint8Array): Promise<PdfInfo> =>
    invoke('pdf_load', { bytes: Array.from(bytes) }),
    
  renderPage: (pageIndex: number, scale: number, maxWidth?: number): Promise<string> =>
    invoke('pdf_render_page', { pageIndex, scale, maxWidth }),
    
  getOutline: (): Promise<OutlineItem[]> =>
    invoke('pdf_get_outline'),
    
  getTextContent: (pageIndex: number): Promise<TextItem[]> =>
    invoke('pdf_get_text_content', { pageIndex }),
    
  search: (query: string, options?: SearchOptions): Promise<SearchResult[]> =>
    invoke('pdf_search', { query, options }),
    
  close: (): Promise<void> =>
    invoke('pdf_close'),
};
```

---

## 🎨 Feature Implementation Guide

### 1. Smooth Zooming

**Strategy**: Progressive rendering with debouncing

```typescript
const useSmoothZoom = () => {
  const [targetScale, setTargetScale] = useState(1.0);
  const [renderedScale, setRenderedScale] = useState(1.0);
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setRenderedScale(targetScale);
    }, 150); // Debounce rendering
    
    return () => clearTimeout(timer);
  }, [targetScale]);
  
  // Use CSS transform for immediate visual feedback
  const transform = `scale(${targetScale / renderedScale})`;
  
  return { targetScale, renderedScale, transform, setTargetScale };
};
```

### 2. Text Selection

**Strategy**: Invisible text layer over canvas

```typescript
const TextLayer: React.FC<{
  textItems: TextItem[];
  scale: number;
  onSelection: (selection: TextSelection) => void;
}> = ({ textItems, scale, onSelection }) => {
  return (
    <div className="text-layer" style={{ position: 'absolute', inset: 0 }}>
      {textItems.map((item, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: item.x * scale,
            top: item.y * scale,
            width: item.width * scale,
            height: item.height * scale,
            fontSize: item.height * scale,
            color: 'transparent',
            cursor: 'text',
            userSelect: 'text',
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
};
```

### 3. Highlight Annotations

**Strategy**: Canvas overlay with selectable regions

```typescript
const HighlightLayer: React.FC<{
  highlights: Highlight[];
  scale: number;
  onHighlightClick: (id: string) => void;
}> = ({ highlights, scale, onHighlightClick }) => {
  return (
    <div className="highlight-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {highlights.map(h => (
        <div
          key={h.id}
          style={{
            position: 'absolute',
            left: h.rect.x * scale,
            top: h.rect.y * scale,
            width: h.rect.width * scale,
            height: h.rect.height * scale,
            backgroundColor: h.color,
            opacity: 0.3,
            pointerEvents: 'auto',
            cursor: 'pointer',
          }}
          onClick={() => onHighlightClick(h.id)}
        />
      ))}
    </div>
  );
};
```

### 4. Thumbnails Sidebar

**Strategy**: Virtual scrolling with lazy loading

```typescript
const ThumbnailsPanel: React.FC<{
  pageCount: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
}> = ({ pageCount, currentPage, onPageSelect }) => {
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const visibleRange = useVisibleRange(); // Virtual scrolling
  
  useEffect(() => {
    // Load thumbnails for visible range
    loadThumbnailsBatch(visibleRange.start, visibleRange.end);
  }, [visibleRange]);
  
  return (
    <div className="thumbnails-panel">
      {Array.from({ length: pageCount }, (_, i) => (
        <Thumbnail
          key={i}
          pageIndex={i}
          image={thumbnails.get(i)}
          isActive={i === currentPage}
          onClick={() => onPageSelect(i)}
        />
      ))}
    </div>
  );
};
```

---

## 📦 Cargo.toml Dependencies

```toml
[dependencies]
# Core Tauri
tauri = { version = "2", features = [] }

# PDFium integration
pdfium-render = "0.8"
image = { version = "0.25", default-features = false, features = ["png", "jpeg"] }

# State management
dashmap = "5"
once_cell = "1"

# Caching
lru = "0.12"

# Encoding
base64 = "0.22"

# Error handling
thiserror = "1"
anyhow = "1"

# Serialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# Async
tokio = { version = "1", features = ["sync", "rt-multi-thread"] }

[features]
# Static linking option (optional)
static = ["pdfium-render/static"]
```

---

## 🧪 Testing Strategy

### Unit Tests (Rust)
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_load_pdf() {
        let pdfium = Pdfium::default();
        let bytes = std::fs::read("test.pdf").unwrap();
        let doc = pdfium.load_pdf_from_byte_slice(&bytes, None).unwrap();
        assert!(doc.pages().len() > 0);
    }
    
    #[test]
    fn test_render_page() {
        // Test rendering at different scales
    }
    
    #[test]
    fn test_text_extraction() {
        // Test text extraction accuracy
    }
}
```

### Integration Tests
- Open various PDF types (scanned, text-based, with forms)
- Test large files (>100MB)
- Test encrypted/password-protected PDFs
- Cross-platform rendering consistency

---

## 🚢 Deployment & Distribution

### Desktop Apps

**Windows**:
- Bundle `pdfium.dll` in installer
- Place in same directory as executable

**macOS**:
- Bundle `libpdfium.dylib` in app bundle
- `LionReader.app/Contents/Frameworks/libpdfium.dylib`

**Linux**:
- Option 1: Bundle `libpdfium.so` (AppImage, .deb, .rpm)
- Option 2: Depend on system package

### Mobile Apps

**Android**:
- Bundle `libpdfium.so` for each architecture (arm64, armv7, x86, x86_64)
- Place in `jniLibs/[arch]/`

**iOS**:
- Use static library `libpdfium.a`
- Link in Xcode project
- Required for App Store submission

---

## 📋 Feature Checklist

### Core Features
- [ ] Load PDF from file bytes
- [ ] Render pages to bitmap (PNG/JPEG)
- [ ] Page navigation (next/prev/go to)
- [ ] Zoom (in/out/fit width/fit page)
- [ ] Scroll/pan navigation
- [ ] Rotation (0°, 90°, 180°, 270°)

### Navigation Features
- [ ] Table of contents/outline panel
- [ ] Thumbnail sidebar with lazy loading
- [ ] Page counter and jumper
- [ ] Back/forward navigation history
- [ ] Resume reading position
- [ ] Reading progress indicator

### Text Features
- [ ] Text layer for selection
- [ ] Text search with highlights
- [ ] Text extraction (copy)
- [ ] Search navigation (next/prev result)

### Annotation Features
- [ ] Display existing annotations
- [ ] Highlight text (multiple colors)
- [ ] Add text notes
- [ ] Freehand drawing (ink)
- [ ] Delete annotations
- [ ] Save annotations to PDF

### Advanced Features
- [ ] Form field filling
- [ ] Link navigation (internal/external)
- [ ] Password-protected PDFs
- [ ] Presentation mode
- [ ] Night/sepia themes
- [ ] Print support

---

## 🔗 Quick Reference Links

| Topic | Link |
|-------|------|
| **Crate Docs** | https://docs.rs/pdfium-render/latest |
| **Examples** | https://github.com/ajrcarey/pdfium-render/tree/master/examples |
| **Desktop Binaries** | https://github.com/bblanchon/pdfium-binaries/releases |
| **Mobile Binaries** | https://github.com/paulocoutinhox/pdfium-lib/releases |
| **PDFium Source** | https://pdfium.googlesource.com/pdfium/ |
| **Tauri Docs** | https://tauri.app/ |

---

## 💡 Tips for AI Assistants

1. **Always use high-level APIs first**: Prefer `pdfium_render::prelude::*` over raw FFI
2. **Handle errors gracefully**: PDFs can be malformed or encrypted
3. **Cache aggressively**: Rendering is expensive, cache at multiple levels
4. **Use base64 for images**: Easiest way to transfer bitmaps to frontend
5. **Thread safety**: The crate handles PDFium's thread-safety, but avoid parallel rendering of same doc
6. **Memory management**: Always close documents when done
7. **Test with real PDFs**: Scanned PDFs, text PDFs, forms, annotations all behave differently

---

*Document Version: 1.0*
*Last Updated: 2026-02-03*
*Compatible with: pdfium-render 0.8.37+, Tauri 2.0+*
