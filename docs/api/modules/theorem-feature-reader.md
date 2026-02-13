# @theorem/feature-reader

Feature package.

## Module

- Path: `/packages/features/reader`
- Version: `0.1.0`
- Public entry: `/packages/features/reader/src/index.ts`

## Dependencies

**Internal packages**
- `@theorem/core`
- `@theorem/feature-learning`
- `@theorem/ui`

**External packages**
- `pdfjs-dist`
- `react`
- `zustand`

## API Reference

### Functions

### Function `ArticleViewer`

```ts
ArticleViewer({ article, feedTitle, isOpen, onClose, }: ArticleViewerProps): JSX.Element | null
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `ArticleViewerProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `article` | `RssArticle | null` | no |
| `feedTitle` | `string | undefined` | yes |
| `isOpen` | `boolean` | no |
| `onClose` | `() => void` | no |

- Returns: `JSX.Element | null`

### Function `ReaderPage`

```ts
ReaderPage(): JSX.Element
```

- Parameters: _none_

- Returns: `JSX.Element`

### Function `ReaderSearch`

```ts
ReaderSearch({ visible, onClose, onNavigate, onSearch, onClearSearch, className, }: ReaderSearchProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `ReaderSearchProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `className` | `string | undefined` | yes |
| `onClearSearch` | `() => void` | no |
| `onClose` | `() => void` | no |
| `onNavigate` | `(location: string) => void` | no |
| `onSearch` | `(query: string) => AsyncGenerator<ReaderSearchEvent>` | no |
| `visible` | `boolean` | no |

- Returns: `JSX.Element`

### Function `ReaderSettings`

```ts
ReaderSettings({ settings, visible, onClose, onUpdate, format, className, }: ReaderSettingsProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `ReaderSettingsProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `className` | `string | undefined` | yes |
| `format` | `BookFormat | undefined` | yes |
| `onClose` | `() => void` | no |
| `onUpdate` | `(updates: Partial<ReaderSettingsType>) => void` | no |
| `settings` | `ReaderSettingsType` | no |
| `visible` | `boolean` | no |

- Returns: `JSX.Element`

### Function `TableOfContents`

```ts
TableOfContents({ toc, visible, onClose, onNavigate, currentHref, isPdf, pdfHasOutline, className, }: TableOfContentsProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `TableOfContentsProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `className` | `string | undefined` | yes |
| `currentHref` | `string | undefined` | yes |
| `isPdf` | `boolean | undefined` | yes |
| `onClose` | `() => void` | no |
| `onNavigate` | `(href: string) => void` | no |
| `pdfHasOutline` | `boolean | undefined` | yes |
| `toc` | `TocItem[]` | no |
| `visible` | `boolean` | no |

- Returns: `JSX.Element`

### Function `useReaderFullscreen`

```ts
useReaderFullscreen({ fullscreen, enabled, onExitFullscreen, errorLabel, }: UseReaderFullscreenOptions): void
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `UseReaderFullscreenOptions` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `enabled` | `boolean | undefined` | yes |
| `errorLabel` | `string | undefined` | yes |
| `fullscreen` | `boolean` | no |
| `onExitFullscreen` | `(() => void) | undefined` | yes |

- Returns: `void`

### Function `useToolbarHeight`

```ts
useToolbarHeight(containerRef: RefObject<HTMLElement | null>, options?: UseToolbarHeightOptions): number
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `containerRef` | `RefObject<HTMLElement | null>` | no |
| `options` | `UseToolbarHeightOptions` | yes |

**Parameter `containerRef` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `current` | `HTMLElement | null` | no |

**Parameter `options` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `defaultHeight` | `number | undefined` | yes |
| `enabled` | `boolean | undefined` | yes |
| `minHeight` | `number | undefined` | yes |

- Returns: `number`

### Function `WindowTitlebar`

```ts
WindowTitlebar({ metadata, location, onBack, onPrevPage, onNextPage, onToggleToc, onToggleSettings, onToggleBookmarks, onToggleSearch, onToggleInfo, onAddBookmark, isCurrentPageBookmarked, activePanel, fullscreen, onToggleFullscreen, className, hideReaderControls, pdfControls, }: WindowTitlebarProps): JSX.Element
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `WindowTitlebarProps` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `activePanel` | `string | null` | no |
| `className` | `string | undefined` | yes |
| `fullscreen` | `boolean | undefined` | yes |
| `hideReaderControls` | `boolean | undefined` | yes |
| `isCurrentPageBookmarked` | `boolean | undefined` | yes |
| `location` | `DocLocation | null | undefined` | yes |
| `metadata` | `DocMetadata | null` | no |
| `onAddBookmark` | `(() => void) | undefined` | yes |
| `onBack` | `() => void` | no |
| `onNextPage` | `(() => void) | undefined` | yes |
| `onPrevPage` | `(() => void) | undefined` | yes |
| `onToggleBookmarks` | `() => void` | no |
| `onToggleFullscreen` | `(() => void) | undefined` | yes |
| `onToggleInfo` | `() => void` | no |
| `onToggleSearch` | `() => void` | no |
| `onToggleSettings` | `() => void` | no |
| `onToggleToc` | `() => void` | no |
| `pdfControls` | `{ currentPage: number; totalPages: number; zoom: number; zoomMode?: "custom" | "page-fit" | "width-fit"; annotationMode?: "none" | "highlight" | "pen" | "text" | "erase"; highlightColor?: HighlightColor; penColor?: HighlightColor; penWidth?: number; onPrevPage: () => void; onNextPage: () => void; onZoomIn: () => void; onZoomOut: () => void; onZoomReset: () => void; onZoomFitPage?: () => void; onZoomFitWidth?: () => void; onRotate: () => void; onPageInput?: (page: number) => void; onAddBookmark?: () => void; onAnnotationModeChange?: (mode: "none" | "highlight" | "pen" | "text" | "erase") => void; onHighlightColorChange?: (color: HighlightColor) => void; onPenColorChange?: (color: HighlightColor) => void; onPenWidthChange?: (width: number) => void; isCurrentPageBookmarked?: boolean; } | undefined` | yes |

- Returns: `JSX.Element`

## Validation

- Uses workspace-level validation commands.
- `pnpm build`

_Generated by `scripts/generate-module-docs.mjs`._

