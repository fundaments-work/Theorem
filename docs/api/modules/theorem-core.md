# @theorem/core

Shared workspace package.

## Module

- Path: `/packages/core`
- Version: `0.1.0`
- Public entry: `/packages/core/src/index.ts`

## Dependencies

**Internal packages**
_none_

**External packages**
- `@tauri-apps/api`
- `@tauri-apps/plugin-dialog`
- `clsx`
- `date-fns`
- `fflate`
- `idb-keyval`
- `tailwind-merge`
- `ts-fsrs`
- `uuid`
- `zustand`

## API Reference

### Functions

### Function `applyReaderStyles`

Apply reader settings instantly via CSS custom properties This is synchronous and extremely fast - no debouncing needed

```ts
applyReaderStyles(settings: ReaderSettings): void
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `settings` | `ReaderSettings` | no |

**Parameter `settings` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `autoHideDelay` | `number` | no |
| `brightness` | `number` | no |
| `enableAnimations` | `boolean` | no |
| `flow` | `ReadingFlow` | no |
| `fontFamily` | `FontFamily` | no |
| `fontSize` | `number` | no |
| `forcePublisherStyles` | `boolean` | no |
| `fullscreen` | `boolean` | no |
| `hyphenation` | `boolean` | no |
| `layout` | `PageLayout` | no |
| `letterSpacing` | `number` | no |
| `lineHeight` | `number` | no |
| `margins` | `number` | no |
| `pageAnimation` | `PageAnimation` | no |
| `paragraphSpacing` | `number` | no |
| `prefetchDistance` | `number` | no |
| `textAlign` | `"left" | "justify" | "center"` | no |
| `theme` | `ReaderTheme` | no |
| `toolbarAutoHide` | `boolean` | no |
| `virtualScrolling` | `boolean` | no |
| `wordSpacing` | `number` | no |
| `zoom` | `number` | no |

- Returns: `void`

### Function `buildSections`

Build section data from TOC and fractions

```ts
buildSections(toc: TocItem[], sectionFractions?: number[], sectionsProp?: BookSection[]): Array<{ index: number; fraction: number; nextFraction: number; width: number; label: string; href: string; }>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `toc` | `TocItem[]` | no |
| `sectionFractions` | `number[] | undefined` | yes |
| `sectionsProp` | `BookSection[] | undefined` | yes |

- Returns: `{ index: number; fraction: number; nextFraction: number; width: number; label: string; href: string; }[]`

### Function `cn`

```ts
cn(...inputs: ClassValue[]): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `inputs` | `ClassValue[]` | no |

- Returns: `string`

### Function `confirmClearAllData`

Confirmation for clearing all data

```ts
confirmClearAllData(): Promise<boolean>
```

- Parameters: _none_

- Returns: `Promise<boolean>`

### Function `confirmDeleteBook`

Confirmation for deleting a book

```ts
confirmDeleteBook(bookTitle: string): Promise<boolean>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `bookTitle` | `string` | no |

- Returns: `Promise<boolean>`

### Function `confirmDeleteBookmark`

Confirmation for deleting a bookmark

```ts
confirmDeleteBookmark(): Promise<boolean>
```

- Parameters: _none_

- Returns: `Promise<boolean>`

### Function `confirmDeleteShelf`

Confirmation for deleting a shelf

```ts
confirmDeleteShelf(shelfName: string): Promise<boolean>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `shelfName` | `string` | no |

- Returns: `Promise<boolean>`

### Function `confirmRemoveFromShelf`

Confirmation for removing a book from a shelf

```ts
confirmRemoveFromShelf(bookTitle: string, shelfName: string): Promise<boolean>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `bookTitle` | `string` | no |
| `shelfName` | `string` | no |

- Returns: `Promise<boolean>`

### Function `createBookEntry`

Create a book entry from a file path (Tauri only) Extracts metadata and cover image using foliate-js

```ts
createBookEntry(filePath: string): Promise<Book | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `filePath` | `string` | no |

- Returns: `Promise<Book | null>`

### Function `createBookEntryFromFile`

Create book entry from a browser File object Used for browser-based file imports

```ts
createBookEntryFromFile(file: File): Promise<Book | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `file` | `File` | no |

**Parameter `file` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `arrayBuffer` | `() => Promise<ArrayBuffer>` | no |
| `lastModified` | `number` | no |
| `name` | `string` | no |
| `size` | `number` | no |
| `slice` | `(start?: number, end?: number, contentType?: string) => Blob` | no |
| `stream` | `() => ReadableStream<Uint8Array>` | no |
| `text` | `() => Promise<string>` | no |
| `type` | `string` | no |
| `webkitRelativePath` | `string` | no |

- Returns: `Promise<Book | null>`

### Function `createInitialReviewSchedulerState`

Creates a brand-new scheduler state for a newly enrolled review item.

```ts
createInitialReviewSchedulerState(now?: Date): LearningReviewSchedulerState
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `now` | `Date` | yes |

**Parameter `now` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `getFullYear` | `() => number` | no |
| `getMonth` | `() => number` | no |
| `getTime` | `() => number` | no |
| `getUTCFullYear` | `() => number` | no |
| `getUTCMonth` | `() => number` | no |
| `toDateString` | `() => string` | no |
| `toLocaleDateString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toLocaleString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toLocaleTimeString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toString` | `() => string` | no |
| `toTimeString` | `() => string` | no |
| `valueOf` | `() => number` | no |

- Returns: `LearningReviewSchedulerState`

### Function `createReaderCSS`

Create CSS string for iframe injection with CURRENT values This ensures the iframe gets the actual colors, not default values

```ts
createReaderCSS(settings?: ReaderSettings): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `settings` | `ReaderSettings | undefined` | yes |

- Returns: `string`

### Function `debounce`

```ts
debounce<T extends (...args: unknown[]) => unknown>(func: T, wait: number): (...args: Parameters<T>) => void
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `func` | `T` | no |
| `wait` | `number` | no |

- Returns: `(...args: Parameters<T>) => void`

### Function `deleteBookData`

Delete book data from storage

```ts
deleteBookData(id: string, filePath?: string): Promise<void>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `id` | `string` | no |
| `filePath` | `string | undefined` | yes |

- Returns: `Promise<void>`

### Function `deleteCoverImage`

Delete cover image

```ts
deleteCoverImage(bookId: string): Promise<void>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `bookId` | `string` | no |

- Returns: `Promise<void>`

### Function `extractCover`

Extract cover only from a book file (for batch processing)

```ts
extractCover(data: ArrayBuffer, format: BookFormat, filename: string, bookId: string): Promise<string | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `data` | `ArrayBuffer` | no |
| `format` | `BookFormat` | no |
| `filename` | `string` | no |
| `bookId` | `string` | no |

**Parameter `data` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `byteLength` | `number` | no |
| `slice` | `(begin: number, end?: number) => ArrayBuffer` | no |

- Returns: `Promise<string | null>`

### Function `extractFilenameMetadata`

Extract basic metadata from filename

```ts
extractFilenameMetadata(filePath: string): { title: string; author: string; }
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `filePath` | `string` | no |

- Returns: `{ title: string; author: string; }`

### Function `extractMetadata`

Extract metadata and cover from a book file

```ts
extractMetadata(data: ArrayBuffer, format: BookFormat, filename: string, bookId?: string): Promise<ExtractedMetadata>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `data` | `ArrayBuffer` | no |
| `format` | `BookFormat` | no |
| `filename` | `string` | no |
| `bookId` | `string | undefined` | yes |

**Parameter `data` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `byteLength` | `number` | no |
| `slice` | `(begin: number, end?: number) => ArrayBuffer` | no |

- Returns: `Promise<ExtractedMetadata>`

### Function `findSectionAtFraction`

Find a section at a specific fraction position

```ts
findSectionAtFraction(sections: Array<{ fraction: number; nextFraction: number; }>, fraction: number): { fraction: number; nextFraction: number; index: number; } | null
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `sections` | `{ fraction: number; nextFraction: number; }[]` | no |
| `fraction` | `number` | no |

- Returns: `{ fraction: number; nextFraction: number; index: number; } | null`

### Function `flattenToc`

Flatten a nested TOC structure into a single-level array

```ts
flattenToc(toc: TocItem[]): Array<{ label: string; href: string; level: number; }>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `toc` | `TocItem[]` | no |

- Returns: `{ label: string; href: string; level: number; }[]`

### Function `formatFileSize`

```ts
formatFileSize(bytes: number): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `bytes` | `number` | no |

- Returns: `string`

### Function `formatProgress`

```ts
formatProgress(progress: number): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `progress` | `number` | no |

- Returns: `string`

### Function `formatReadingTime`

```ts
formatReadingTime(minutes: number): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `minutes` | `number` | no |

- Returns: `string`

### Function `formatRelativeDate`

```ts
formatRelativeDate(date: Date): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `date` | `Date` | no |

**Parameter `date` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `getFullYear` | `() => number` | no |
| `getMonth` | `() => number` | no |
| `getTime` | `() => number` | no |
| `getUTCFullYear` | `() => number` | no |
| `getUTCMonth` | `() => number` | no |
| `toDateString` | `() => string` | no |
| `toLocaleDateString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toLocaleString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toLocaleTimeString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toString` | `() => string` | no |
| `toTimeString` | `() => string` | no |
| `valueOf` | `() => number` | no |

- Returns: `string`

### Function `getBookBlob`

Get book data as a Blob - more memory efficient than ArrayBuffer This avoids extra memory copies when passing to EPUB.js

```ts
getBookBlob(id: string, filePath?: string): Promise<Blob | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `id` | `string` | no |
| `filePath` | `string | undefined` | yes |

- Returns: `Promise<Blob | null>`

### Function `getBookData`

Get book data from storage as ArrayBuffer

```ts
getBookData(id: string, filePath?: string): Promise<ArrayBuffer | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `id` | `string` | no |
| `filePath` | `string | undefined` | yes |

- Returns: `Promise<ArrayBuffer | null>`

### Function `getBookFormat`

Determine book format from file extension Supports: EPUB, MOBI/AZW, FB2, CBZ, PDF Note: CBR is recognized for graceful rejection, but not currently importable.

```ts
getBookFormat(filePath: string): BookFormat | null
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `filePath` | `string` | no |

- Returns: `BookFormat | null`

### Function `getBookMetadata`

Get book metadata from storage

```ts
getBookMetadata<T>(id: string): Promise<T | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `id` | `string` | no |

- Returns: `Promise<T | null>`

### Function `getCoverImage`

Get cover image data URL

```ts
getCoverImage(bookId: string): Promise<string | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `bookId` | `string` | no |

- Returns: `Promise<string | null>`

### Function `getCurrentReaderSettings`

Get current reader settings (for use by engine)

```ts
getCurrentReaderSettings(): ReaderSettings | null
```

- Parameters: _none_

- Returns: `ReaderSettings | null`

### Function `getEngineSettings`

Get settings that need to be applied to the rendering engine These are the settings that require iframe re-rendering

```ts
getEngineSettings(settings: ReaderSettings): { style: { spacing: number; justify: boolean; hyphenate: boolean; invert: boolean; theme: FoliateTheme; overrideFont: boolean; }; layout: { flow: "scrolled" | "paginated"; animated: boolean; gap: number; maxInlineSize: number; maxBlockSize: number; maxColumnCount: number; }; zoom: number; margins: number; }
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `settings` | `ReaderSettings` | no |

**Parameter `settings` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `autoHideDelay` | `number` | no |
| `brightness` | `number` | no |
| `enableAnimations` | `boolean` | no |
| `flow` | `ReadingFlow` | no |
| `fontFamily` | `FontFamily` | no |
| `fontSize` | `number` | no |
| `forcePublisherStyles` | `boolean` | no |
| `fullscreen` | `boolean` | no |
| `hyphenation` | `boolean` | no |
| `layout` | `PageLayout` | no |
| `letterSpacing` | `number` | no |
| `lineHeight` | `number` | no |
| `margins` | `number` | no |
| `pageAnimation` | `PageAnimation` | no |
| `paragraphSpacing` | `number` | no |
| `prefetchDistance` | `number` | no |
| `textAlign` | `"left" | "justify" | "center"` | no |
| `theme` | `ReaderTheme` | no |
| `toolbarAutoHide` | `boolean` | no |
| `virtualScrolling` | `boolean` | no |
| `wordSpacing` | `number` | no |
| `zoom` | `number` | no |

- Returns: `{ style: { spacing: number; justify: boolean; hyphenate: boolean; invert: boolean; theme: FoliateTheme; overrideFont: boolean; }; layout: { flow: "scrolled" | "paginated"; animated: boolean; gap: number; maxInlineSize: number; maxBlockSize: number; maxColumnCount: number; }; zoom: number; margins: number; }`

### Function `getSearchPlaceholder`

Returns the search placeholder for a domain.

```ts
getSearchPlaceholder(domain: SearchDomain): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `domain` | `SearchDomain` | no |

- Returns: `string`

### Function `getSettingsChanges`

Compare two settings objects and return what changed

```ts
getSettingsChanges(prev: ReaderSettings | null, current: ReaderSettings): { cssChanged: boolean; engineChanged: boolean; changedKeys: string[]; }
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `prev` | `ReaderSettings | null` | no |
| `current` | `ReaderSettings` | no |

**Parameter `current` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `autoHideDelay` | `number` | no |
| `brightness` | `number` | no |
| `enableAnimations` | `boolean` | no |
| `flow` | `ReadingFlow` | no |
| `fontFamily` | `FontFamily` | no |
| `fontSize` | `number` | no |
| `forcePublisherStyles` | `boolean` | no |
| `fullscreen` | `boolean` | no |
| `hyphenation` | `boolean` | no |
| `layout` | `PageLayout` | no |
| `letterSpacing` | `number` | no |
| `lineHeight` | `number` | no |
| `margins` | `number` | no |
| `pageAnimation` | `PageAnimation` | no |
| `paragraphSpacing` | `number` | no |
| `prefetchDistance` | `number` | no |
| `textAlign` | `"left" | "justify" | "center"` | no |
| `theme` | `ReaderTheme` | no |
| `toolbarAutoHide` | `boolean` | no |
| `virtualScrolling` | `boolean` | no |
| `wordSpacing` | `number` | no |
| `zoom` | `number` | no |

- Returns: `{ cssChanged: boolean; engineChanged: boolean; changedKeys: string[]; }`

### Function `getShelfColor`

```ts
getShelfColor(shelfId: string, shelfName: string): { bg: string; text: string; border: string; icon: string; }
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `shelfId` | `string` | no |
| `shelfName` | `string` | no |

- Returns: `{ bg: string; text: string; border: string; icon: string; }`

### Function `getShelfDotColor`

```ts
getShelfDotColor(shelfId: string, shelfName: string): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `shelfId` | `string` | no |
| `shelfName` | `string` | no |

- Returns: `string`

### Function `getShelfInitials`

```ts
getShelfInitials(name: string): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `name` | `string` | no |

- Returns: `string`

### Function `getStorageStats`

Get storage stats

```ts
getStorageStats(): Promise<{ used: number; total: number; }>
```

- Parameters: _none_

- Returns: `Promise<{ used: number; total: number; }>`

### Function `getThemeColors`

Get theme colors for a specific theme

```ts
getThemeColors(theme: ReaderTheme): { bg: string; fg: string; link: string; }
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `theme` | `ReaderTheme` | no |

- Returns: `{ bg: string; fg: string; link: string; }`

### Function `hasSearchDomain`

Helper for route/placement rendering logic.

```ts
hasSearchDomain(domain: SearchDomain): boolean
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `domain` | `SearchDomain` | no |

- Returns: `boolean`

### Function `importBooks`

Import multiple books with error handling

```ts
importBooks(filePaths: string[]): Promise<Book[]>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `filePaths` | `string[]` | no |

- Returns: `Promise<Book[]>`

### Function `importBooksFromFiles`

Import books from browser File objects

```ts
importBooksFromFiles(files: File[]): Promise<Book[]>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `files` | `File[]` | no |

- Returns: `Promise<Book[]>`

### Function `importStarDictDictionary`

Imports StarDict files and persists them for offline lookups.

```ts
importStarDictDictionary(files: FileList | File[]): Promise<InstalledDictionary>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `files` | `File[] | FileList` | no |

**Parameter `files` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `length` | `number` | no |
| `toLocaleString` | `(() => string) | { (): string; (locales: string | string[], options?: Intl.NumberFormatOptions & Intl.DateTimeFormatOptions): string; }` | no |
| `toString` | `(() => string) | (() => string)` | no |

- Returns: `Promise<InstalledDictionary>`

### Function `initReaderStyles`

Initialize reader styles with default settings

```ts
initReaderStyles(settings: ReaderSettings): void
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `settings` | `ReaderSettings` | no |

**Parameter `settings` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `autoHideDelay` | `number` | no |
| `brightness` | `number` | no |
| `enableAnimations` | `boolean` | no |
| `flow` | `ReadingFlow` | no |
| `fontFamily` | `FontFamily` | no |
| `fontSize` | `number` | no |
| `forcePublisherStyles` | `boolean` | no |
| `fullscreen` | `boolean` | no |
| `hyphenation` | `boolean` | no |
| `layout` | `PageLayout` | no |
| `letterSpacing` | `number` | no |
| `lineHeight` | `number` | no |
| `margins` | `number` | no |
| `pageAnimation` | `PageAnimation` | no |
| `paragraphSpacing` | `number` | no |
| `prefetchDistance` | `number` | no |
| `textAlign` | `"left" | "justify" | "center"` | no |
| `theme` | `ReaderTheme` | no |
| `toolbarAutoHide` | `boolean` | no |
| `virtualScrolling` | `boolean` | no |
| `wordSpacing` | `number` | no |
| `zoom` | `number` | no |

- Returns: `void`

### Function `isFixedLayout`

```ts
isFixedLayout(format: BookFormat): boolean
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `format` | `BookFormat` | no |

- Returns: `boolean`

### Function `isImportFormatSupported`

Returns true when the format can be imported and rendered in this build.

```ts
isImportFormatSupported(format: BookFormat): boolean
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `format` | `BookFormat` | no |

- Returns: `boolean`

### Function `isMobile`

Check if running on mobile (for UI adaptations)

```ts
isMobile(): boolean
```

- Parameters: _none_

- Returns: `boolean`

### Function `isReflowable`

```ts
isReflowable(format: BookFormat): boolean
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `format` | `BookFormat` | no |

- Returns: `boolean`

### Function `isTauri`

Check if running in a Tauri environment

```ts
isTauri(): boolean
```

- Parameters: _none_

- Returns: `boolean`

### Function `isTouchDevice`

Check if running on a touch device

```ts
isTouchDevice(): boolean
```

- Parameters: _none_

- Returns: `boolean`

### Function `lookupDictionaryTerm`

Runs dictionary lookup according to configured provider strategy.

```ts
lookupDictionaryTerm(input: DictionaryLookupInput): Promise<DictionaryLookupResult | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `input` | `DictionaryLookupInput` | no |

**Parameter `input` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `installedDictionaryIds` | `string[] | undefined` | yes |
| `language` | `string | undefined` | yes |
| `mode` | `DictionaryMode` | no |
| `term` | `string` | no |

- Returns: `Promise<DictionaryLookupResult | null>`

### Function `lookupInStarDictDictionaries`

Looks up a term in all provided StarDict dictionary IDs.

```ts
lookupInStarDictDictionaries(dictionaryIds: string[], term: string): Promise<VocabularyMeaning[]>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `dictionaryIds` | `string[]` | no |
| `term` | `string` | no |

- Returns: `Promise<VocabularyMeaning[]>`

### Function `lookupInStarDictDictionary`

Looks up a term in a specific imported StarDict dictionary.

```ts
lookupInStarDictDictionary(id: string, term: string): Promise<VocabularyMeaning[]>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `id` | `string` | no |
| `term` | `string` | no |

- Returns: `Promise<VocabularyMeaning[]>`

### Function `normalizeAuthor`

Normalize author field which might be a string, object, or array EPUB metadata can have author as: string | {name, sortAs, role} | Array<string|object>

```ts
normalizeAuthor(author: unknown): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `author` | `unknown` | no |

- Returns: `string`

### Function `normalizeCardTextForDisplay`

Normalizes card text before rendering it.

```ts
normalizeCardTextForDisplay(value: string): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `value` | `string` | no |

- Returns: `string`

### Function `normalizeCardTextForStorage`

Normalizes card text before persisting it.

```ts
normalizeCardTextForStorage(value: string): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `value` | `string` | no |

- Returns: `string`

### Function `normalizeLookupTerm`

Normalizes a lookup query for dedupe and provider calls.

```ts
normalizeLookupTerm(term: string): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `term` | `string` | no |

- Returns: `string`

### Function `normalizeReviewSchedulerState`

Ensures persisted scheduler fields are converted back into runtime values.

```ts
normalizeReviewSchedulerState(state: LearningReviewSchedulerState): LearningReviewSchedulerState
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `state` | `LearningReviewSchedulerState` | no |

**Parameter `state` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `difficulty` | `number` | no |
| `due` | `Date` | no |
| `elapsed_days` | `number` | no |
| `lapses` | `number` | no |
| `last_review` | `Date | undefined` | yes |
| `learning_steps` | `number` | no |
| `reps` | `number` | no |
| `scheduled_days` | `number` | no |
| `stability` | `number` | no |
| `state` | `number` | no |

- Returns: `LearningReviewSchedulerState`

### Function `pickAndImportBooks`

Show file picker and import selected books Works in both Tauri and browser environments

```ts
pickAndImportBooks(): Promise<Book[]>
```

- Parameters: _none_

- Returns: `Promise<Book[]>`

### Function `pickBookFiles`

Open file picker dialog and return selected file paths (Tauri only)

```ts
pickBookFiles(): Promise<string[]>
```

- Parameters: _none_

- Returns: `Promise<string[]>`

### Function `pickBookFilesBrowser`

Browser file picker using HTML5 File Input API Returns array of File objects

```ts
pickBookFilesBrowser(): Promise<File[]>
```

- Parameters: _none_

- Returns: `Promise<File[]>`

### Function `rankByFuzzyQuery`

Applies fuzzy ranking and returns items ordered by relevance.

```ts
rankByFuzzyQuery<T>(items: T[], query: string, options: RankByFuzzyQueryOptions<T>): RankedFuzzyItem<T>[]
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `items` | `T[]` | no |
| `query` | `string` | no |
| `options` | `RankByFuzzyQueryOptions<T>` | no |

**Parameter `options` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `ignoreLocation` | `boolean | undefined` | yes |
| `keys` | `FuseOptionKey<T>[]` | no |
| `limit` | `number | undefined` | yes |
| `minMatchCharLength` | `number | undefined` | yes |
| `threshold` | `number | undefined` | yes |

- Returns: `RankedFuzzyItem<T>[]`

### Function `readBookFile`

Read a book file from storage Uses the storage abstraction to handle both Tauri paths and IndexedDB

```ts
readBookFile(filePath: string, bookId?: string): Promise<ArrayBuffer>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `filePath` | `string` | no |
| `bookId` | `string | undefined` | yes |

- Returns: `Promise<ArrayBuffer>`

### Function `registerEngineStyleCallback`

Register an engine to receive style update notifications

```ts
registerEngineStyleCallback(callback: () => void): () => void
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `callback` | `() => void` | no |

- Returns: `() => void`

### Function `removeStarDictDictionary`

Removes an imported StarDict dictionary from storage and memory.

```ts
removeStarDictDictionary(id: string): Promise<void>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `id` | `string` | no |

- Returns: `Promise<void>`

### Function `resolveSearchDomain`

Resolves the active search domain from placement and current route.

```ts
resolveSearchDomain({ placement, route, }: { placement: SearchPlacement; route: AppRoute; }): SearchDomain
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `props` | `{ placement: SearchPlacement; route: AppRoute; }` | no |

**Parameter `props` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `placement` | `SearchPlacement` | no |
| `route` | `AppRoute` | no |

- Returns: `SearchDomain`

### Function `reviewItemSchedulerState`

Runs a single FSRS review transition for a review item.

```ts
reviewItemSchedulerState(schedulerState: LearningReviewSchedulerState, grade: ReviewGrade, now?: Date): SchedulerReviewResult
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `schedulerState` | `LearningReviewSchedulerState` | no |
| `grade` | `ReviewGrade` | no |
| `now` | `Date` | yes |

**Parameter `schedulerState` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `difficulty` | `number` | no |
| `due` | `Date` | no |
| `elapsed_days` | `number` | no |
| `lapses` | `number` | no |
| `last_review` | `Date | undefined` | yes |
| `learning_steps` | `number` | no |
| `reps` | `number` | no |
| `scheduled_days` | `number` | no |
| `stability` | `number` | no |
| `state` | `number` | no |

**Parameter `now` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `getFullYear` | `() => number` | no |
| `getMonth` | `() => number` | no |
| `getTime` | `() => number` | no |
| `getUTCFullYear` | `() => number` | no |
| `getUTCMonth` | `() => number` | no |
| `toDateString` | `() => string` | no |
| `toLocaleDateString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toLocaleString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toLocaleTimeString` | `{ (): string; (locales?: string | string[], options?: Intl.DateTimeFormatOptions): string; (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions): string; }` | no |
| `toString` | `() => string` | no |
| `toTimeString` | `() => string` | no |
| `valueOf` | `() => number` | no |

- Returns: `SchedulerReviewResult`

### Function `saveBookData`

Save book data to storage In Tauri: saves to app data directory Fallback: IndexedDB for development

```ts
saveBookData(id: string, data: ArrayBuffer): Promise<string>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `id` | `string` | no |
| `data` | `ArrayBuffer` | no |

**Parameter `data` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `byteLength` | `number` | no |
| `slice` | `(begin: number, end?: number) => ArrayBuffer` | no |

- Returns: `Promise<string>`

### Function `saveBookMetadata`

Save book metadata to storage

```ts
saveBookMetadata<T>(id: string, metadata: T): Promise<void>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `id` | `string` | no |
| `metadata` | `T` | no |

- Returns: `Promise<void>`

### Function `saveCoverImage`

Save cover image as data URL

```ts
saveCoverImage(bookId: string, blob: Blob): Promise<string>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `bookId` | `string` | no |
| `blob` | `Blob` | no |

**Parameter `blob` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `arrayBuffer` | `() => Promise<ArrayBuffer>` | no |
| `size` | `number` | no |
| `slice` | `(start?: number, end?: number, contentType?: string) => Blob` | no |
| `stream` | `() => ReadableStream<Uint8Array>` | no |
| `text` | `() => Promise<string>` | no |
| `type` | `string` | no |

- Returns: `Promise<string>`

### Function `scanFolderForBooks`

Scan a folder for books (Tauri only)

```ts
scanFolderForBooks(folderPath: string): Promise<string[]>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `folderPath` | `string` | no |

- Returns: `Promise<string[]>`

### Function `showAsk`

Shows a native ask dialog (Yes/No) and waits for user choice

```ts
showAsk(options: ConfirmOptions): Promise<boolean>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `options` | `ConfirmOptions` | no |

**Parameter `options` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `cancelLabel` | `string | undefined` | yes |
| `kind` | `"info" | "warning" | "error" | undefined` | yes |
| `message` | `string` | no |
| `okLabel` | `string | undefined` | yes |
| `title` | `string | undefined` | yes |

- Returns: `Promise<boolean>`

### Function `showConfirm`

Shows a native confirmation dialog and waits for user choice

```ts
showConfirm(options: ConfirmOptions): Promise<boolean>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `options` | `ConfirmOptions` | no |

**Parameter `options` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `cancelLabel` | `string | undefined` | yes |
| `kind` | `"info" | "warning" | "error" | undefined` | yes |
| `message` | `string` | no |
| `okLabel` | `string | undefined` | yes |
| `title` | `string | undefined` | yes |

- Returns: `Promise<boolean>`

### Function `showMessage`

Shows a native message dialog

```ts
showMessage(options: MessageOptions): Promise<void>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `options` | `MessageOptions` | no |

**Parameter `options` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `kind` | `"info" | "warning" | "error" | undefined` | yes |
| `message` | `string` | no |
| `okLabel` | `string | undefined` | yes |
| `title` | `string | undefined` | yes |

- Returns: `Promise<void>`

### Function `showOpenFileDialog`

Shows a native file open dialog

```ts
showOpenFileDialog(options?: FileDialogOptions): Promise<string | string[] | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `options` | `FileDialogOptions` | yes |

**Parameter `options` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `defaultPath` | `string | undefined` | yes |
| `filters` | `{ name: string; extensions: string[]; }[] | undefined` | yes |
| `multiple` | `boolean | undefined` | yes |
| `title` | `string | undefined` | yes |

- Returns: `Promise<string | string[] | null>`

### Function `showSaveFileDialog`

Shows a native file save dialog

```ts
showSaveFileDialog(options?: SaveDialogOptions): Promise<string | null>
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `options` | `SaveDialogOptions` | yes |

**Parameter `options` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `defaultPath` | `string | undefined` | yes |
| `filters` | `{ name: string; extensions: string[]; }[] | undefined` | yes |
| `title` | `string | undefined` | yes |

- Returns: `Promise<string | null>`

### Function `truncate`

```ts
truncate(text: string, maxLength: number): string
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `text` | `string` | no |
| `maxLength` | `number` | no |

- Returns: `string`

### Function `useDailyReviewReminder`

Shows an in-app reminder when daily review is due and review items are waiting.

```ts
useDailyReviewReminder(): void
```

- Parameters: _none_

- Returns: `void`

### Function `useLearningStore`

**Overload 1**

```ts
useLearningStore(): LearningStore
```

- Parameters: _none_

- Returns: `LearningStore`

**Overload 2**

```ts
useLearningStore<U>(selector: (state: LearningStore) => U): U
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `selector` | `(state: LearningStore) => U` | no |

- Returns: `U`

### Function `useLibraryStore`

**Overload 1**

```ts
useLibraryStore(): LibraryStore
```

- Parameters: _none_

- Returns: `LibraryStore`

**Overload 2**

```ts
useLibraryStore<U>(selector: (state: LibraryStore) => U): U
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `selector` | `(state: LibraryStore) => U` | no |

- Returns: `U`

### Function `useSettingsStore`

**Overload 1**

```ts
useSettingsStore(): SettingsStore
```

- Parameters: _none_

- Returns: `SettingsStore`

**Overload 2**

```ts
useSettingsStore<U>(selector: (state: SettingsStore) => U): U
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `selector` | `(state: SettingsStore) => U` | no |

- Returns: `U`

### Function `useShelfColor`

```ts
useShelfColor(shelfId: string, shelfName: string): { bg: string; text: string; border: string; icon: string; }
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `shelfId` | `string` | no |
| `shelfName` | `string` | no |

- Returns: `{ bg: string; text: string; border: string; icon: string; }`

### Function `useUIStore`

**Overload 1**

```ts
useUIStore(): UIStore
```

- Parameters: _none_

- Returns: `UIStore`

**Overload 2**

```ts
useUIStore<U>(selector: (state: UIStore) => U): U
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `selector` | `(state: UIStore) => U` | no |

- Returns: `U`

### Function `vocabularyTermFromLookup`

Helper to convert a lookup result into a persisted vocabulary term object.

```ts
vocabularyTermFromLookup(result: DictionaryLookupResult): VocabularyTerm
```

| Parameter | Type | Optional |
| --- | --- | --- |
| `result` | `DictionaryLookupResult` | no |

**Parameter `result` fields**

| Property | Type | Optional |
| --- | --- | --- |
| `audioUrl` | `string | undefined` | yes |
| `language` | `string` | no |
| `meanings` | `VocabularyMeaning[]` | no |
| `normalizedTerm` | `string` | no |
| `phonetic` | `string | undefined` | yes |
| `providersUsed` | `DictionaryProvider[]` | no |
| `term` | `string` | no |

- Returns: `VocabularyTerm`

### Objects and Values

### Value `APP_THEME_PALETTES`

- Type: `Record<ReaderTheme, ThemeSemanticPalette>`

**Fields**

_No object fields detected._

### Value `DESIGN_TOKEN_VARS`

- Type: `{ readonly color: { readonly background: "var(--color-background)"; readonly surface: "var(--color-surface)"; readonly surfaceElevated: "var(--color-surface-elevated)"; readonly surfaceMuted: "var(--color-surface-muted)"; readonly surfaceVariant: "var(--color-surface-variant)"; readonly surfaceHover: "var(--color-surface-hover)"; readonly textPrimary: "var(--color-text-primary)"; readonly textSecondary: "var(--color-text-secondary)"; readonly textMuted: "var(--color-text-muted)"; readonly textInverse: "var(--color-text-inverse)"; readonly border: "var(--color-border)"; readonly borderSubtle: "var(--color-border-subtle)"; readonly accent: "var(--color-accent)"; readonly accentHover: "var(--color-accent-hover)"; readonly accentLight: "var(--color-accent-light)"; readonly accentContrast: "var(--color-accent-contrast)"; readonly success: "var(--color-success)"; readonly warning: "var(--color-warning)"; readonly error: "var(--color-error)"; readonly info: "var(--color-info)"; readonly focusRing: "var(--color-focus-ring)"; readonly overlaySubtle: "var(--color-overlay-subtle)"; readonly overlayMedium: "var(--color-overlay-medium)"; readonly overlayStrong: "var(--color-overlay-strong)"; readonly overlayStrongHover: "var(--color-overlay-strong-hover)"; }; readonly reader: { readonly background: "var(--reader-bg)"; readonly foreground: "var(--reader-fg)"; readonly link: "var(--reader-link)"; readonly fontSize: "var(--reader-font-size)"; readonly lineHeight: "var(--reader-line-height)"; readonly marginX: "var(--reader-margin-x)"; readonly marginY: "var(--reader-margin-y)"; readonly brightness: "var(--reader-brightness)"; readonly zoom: "var(--reader-zoom)"; }; readonly spacing: { readonly xxs: "var(--spacing-xxs)"; readonly xs: "var(--spacing-xs)"; readonly sm: "var(--spacing-sm)"; readonly md: "var(--spacing-md)"; readonly lg: "var(--spacing-lg)"; readonly xl: "var(--spacing-xl)"; readonly "2xl": "var(--spacing-2xl)"; readonly "3xl": "var(--spacing-3xl)"; readonly "4xl": "var(--spacing-4xl)"; }; readonly radius: { readonly xs: "var(--radius-xs)"; readonly sm: "var(--radius-sm)"; readonly md: "var(--radius-md)"; readonly lg: "var(--radius-lg)"; readonly xl: "var(--radius-xl)"; readonly "2xl": "var(--radius-2xl)"; readonly full: "var(--radius-full)"; }; readonly shadow: { readonly xs: "var(--shadow-xs)"; readonly sm: "var(--shadow-sm)"; readonly md: "var(--shadow-md)"; readonly lg: "var(--shadow-lg)"; }; readonly typography: { readonly family: { readonly sans: "var(--font-sans)"; readonly serif: "var(--font-serif)"; readonly mono: "var(--font-mono)"; readonly display: "var(--font-playfair)"; readonly readerSerif: "var(--font-merriweather)"; }; readonly size: { readonly "4xs": "var(--font-size-4xs)"; readonly "3xs": "var(--font-size-3xs)"; readonly "2xs": "var(--font-size-2xs)"; readonly caption: "var(--font-size-caption)"; readonly xs: "var(--font-size-xs)"; readonly sm: "var(--font-size-sm)"; readonly md: "var(--font-size-md)"; readonly lg: "var(--font-size-lg)"; readonly xl: "var(--font-size-xl)"; readonly "2xl": "var(--font-size-2xl)"; readonly "3xl": "var(--font-size-3xl)"; readonly "4xl": "var(--font-size-4xl)"; readonly "5xl": "var(--font-size-5xl)"; }; readonly lineHeight: { readonly tight: "var(--line-height-tight)"; readonly snug: "var(--line-height-snug)"; readonly normal: "var(--line-height-normal)"; readonly relaxed: "var(--line-height-relaxed)"; readonly loose: "var(--line-height-loose)"; }; readonly weight: { readonly regular: "var(--font-weight-regular)"; readonly medium: "var(--font-weight-medium)"; readonly semibold: "var(--font-weight-semibold)"; readonly bold: "var(--font-weight-bold)"; readonly black: "var(--font-weight-black)"; }; readonly letterSpacing: { readonly tight: "var(--letter-spacing-tight)"; readonly normal: "var(--letter-spacing-normal)"; readonly wide: "var(--letter-spacing-wide)"; readonly wider: "var(--letter-spacing-wider)"; }; }; readonly motion: { readonly duration: { readonly fast: "var(--duration-fast)"; readonly normal: "var(--duration-normal)"; readonly slow: "var(--duration-slow)"; }; readonly transition: { readonly fast: "var(--transition-fast)"; readonly normal: "var(--transition-normal)"; readonly slow: "var(--transition-slow)"; }; }; readonly layout: { readonly container: { readonly sm: "var(--container-width-sm)"; readonly md: "var(--container-width-md)"; readonly lg: "var(--container-width-lg)"; readonly xl: "var(--container-width-xl)"; readonly "2xl": "var(--container-width-2xl)"; readonly "7xl": "var(--container-width-7xl)"; readonly max: "var(--layout-content-max-width)"; readonly readable: "var(--layout-content-readable-width)"; readonly inlinePadding: "var(--layout-content-inline-padding)"; readonly inlinePaddingMobile: "var(--layout-content-inline-padding-mobile)"; }; readonly sidebar: { readonly expanded: "var(--layout-sidebar-width)"; readonly collapsed: "var(--layout-sidebar-collapsed-width)"; }; readonly chrome: { readonly headerHeight: "var(--layout-header-height)"; readonly titlebarHeight: "var(--layout-titlebar-height)"; readonly readerToolbarHeight: "var(--layout-reader-toolbar-height)"; }; readonly panel: { readonly readerWidth: "var(--layout-reader-panel-width)"; readonly readerWidthMobile: "var(--layout-reader-panel-width-mobile)"; readonly readerMaxHeight: "var(--layout-reader-panel-max-height)"; readonly readerMaxWidthMobile: "var(--layout-reader-panel-max-width-mobile)"; readonly readerMobileHeight: "var(--layout-reader-panel-mobile-height)"; readonly readerListMaxHeight: "var(--layout-reader-list-max-height)"; }; readonly overlay: { readonly modalMaxHeight: "var(--layout-modal-max-height)"; readonly modalWidthFluid: "var(--layout-modal-width-fluid)"; readonly modalWidthSm: "var(--layout-modal-width-sm)"; readonly modalWidthMd: "var(--layout-modal-width-md)"; readonly modalWidthLg: "var(--layout-modal-width-lg)"; readonly modalWidthXl: "var(--layout-modal-width-xl)"; readonly dropdownMinWidth: "var(--layout-dropdown-menu-min-width)"; readonly dropdownMaxWidth: "var(--layout-dropdown-menu-max-width)"; readonly popoverMinWidth: "var(--layout-popover-min-width)"; readonly tooltipMaxWidth: "var(--layout-tooltip-max-width)"; readonly floatingPanelMaxHeight: "var(--layout-floating-panel-max-height)"; readonly floatingPanelTopOffset: "var(--layout-floating-panel-top-offset)"; readonly floatingPanelMaxHeightDesktop: "var(--layout-floating-panel-max-height-desktop)"; readonly floatingPanelWidth: "var(--layout-floating-panel-width)"; }; readonly editor: { readonly noteWidth: "var(--layout-note-editor-width)"; readonly noteMinHeight: "var(--layout-note-editor-min-height)"; readonly noteMaxHeight: "var(--layout-note-editor-max-height)"; readonly annotationMinHeight: "var(--layout-annotation-editor-min-height)"; readonly inlineTitleMaxWidth: "var(--layout-inline-title-max-width)"; readonly errorStackMaxHeight: "var(--layout-error-stack-max-height)"; readonly errorComponentStackMaxHeight: "var(--layout-error-component-stack-max-height)"; }; readonly effect: { readonly backdropBlurSm: "var(--effect-backdrop-blur-sm)"; }; }; readonly controls: { readonly height: { readonly sm: "var(--control-height-sm)"; readonly md: "var(--control-height-md)"; readonly lg: "var(--control-height-lg)"; readonly touchMin: "var(--control-touch-min)"; readonly iconButton: "var(--control-icon-button-size)"; }; readonly padding: { readonly x: "var(--control-padding-x)"; readonly y: "var(--control-padding-y)"; }; readonly icon: { readonly sm: "var(--icon-size-sm)"; readonly md: "var(--icon-size-md)"; readonly lg: "var(--icon-size-lg)"; }; }; readonly zIndex: { readonly backdrop: "var(--z-backdrop)"; readonly dropdown: "var(--z-dropdown)"; readonly sticky: "var(--z-sticky)"; readonly modal: "var(--z-modal)"; readonly popover: "var(--z-popover)"; readonly tooltip: "var(--z-tooltip)"; }; readonly breakpoints: { readonly sm: "640px"; readonly md: "768px"; readonly lg: "1024px"; readonly xl: "1280px"; readonly "2xl": "1536px"; }; }`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `breakpoints` | `{ readonly sm: "640px"; readonly md: "768px"; readonly lg: "1024px"; readonly xl: "1280px"; readonly "2xl": "1536px"; }` | no |
| `color` | `{ readonly background: "var(--color-background)"; readonly surface: "var(--color-surface)"; readonly surfaceElevated: "var(--color-surface-elevated)"; readonly surfaceMuted: "var(--color-surface-muted)"; readonly surfaceVariant: "var(--color-surface-variant)"; readonly surfaceHover: "var(--color-surface-hover)"; readonly textPrimary: "var(--color-text-primary)"; readonly textSecondary: "var(--color-text-secondary)"; readonly textMuted: "var(--color-text-muted)"; readonly textInverse: "var(--color-text-inverse)"; readonly border: "var(--color-border)"; readonly borderSubtle: "var(--color-border-subtle)"; readonly accent: "var(--color-accent)"; readonly accentHover: "var(--color-accent-hover)"; readonly accentLight: "var(--color-accent-light)"; readonly accentContrast: "var(--color-accent-contrast)"; readonly success: "var(--color-success)"; readonly warning: "var(--color-warning)"; readonly error: "var(--color-error)"; readonly info: "var(--color-info)"; readonly focusRing: "var(--color-focus-ring)"; readonly overlaySubtle: "var(--color-overlay-subtle)"; readonly overlayMedium: "var(--color-overlay-medium)"; readonly overlayStrong: "var(--color-overlay-strong)"; readonly overlayStrongHover: "var(--color-overlay-strong-hover)"; }` | no |
| `controls` | `{ readonly height: { readonly sm: "var(--control-height-sm)"; readonly md: "var(--control-height-md)"; readonly lg: "var(--control-height-lg)"; readonly touchMin: "var(--control-touch-min)"; readonly iconButton: "var(--control-icon-button-size)"; }; readonly padding: { readonly x: "var(--control-padding-x)"; readonly y: "var(--control-padding-y)"; }; readonly icon: { readonly sm: "var(--icon-size-sm)"; readonly md: "var(--icon-size-md)"; readonly lg: "var(--icon-size-lg)"; }; }` | no |
| `layout` | `{ readonly container: { readonly sm: "var(--container-width-sm)"; readonly md: "var(--container-width-md)"; readonly lg: "var(--container-width-lg)"; readonly xl: "var(--container-width-xl)"; readonly "2xl": "var(--container-width-2xl)"; readonly "7xl": "var(--container-width-7xl)"; readonly max: "var(--layout-content-max-width)"; readonly readable: "var(--layout-content-readable-width)"; readonly inlinePadding: "var(--layout-content-inline-padding)"; readonly inlinePaddingMobile: "var(--layout-content-inline-padding-mobile)"; }; readonly sidebar: { readonly expanded: "var(--layout-sidebar-width)"; readonly collapsed: "var(--layout-sidebar-collapsed-width)"; }; readonly chrome: { readonly headerHeight: "var(--layout-header-height)"; readonly titlebarHeight: "var(--layout-titlebar-height)"; readonly readerToolbarHeight: "var(--layout-reader-toolbar-height)"; }; readonly panel: { readonly readerWidth: "var(--layout-reader-panel-width)"; readonly readerWidthMobile: "var(--layout-reader-panel-width-mobile)"; readonly readerMaxHeight: "var(--layout-reader-panel-max-height)"; readonly readerMaxWidthMobile: "var(--layout-reader-panel-max-width-mobile)"; readonly readerMobileHeight: "var(--layout-reader-panel-mobile-height)"; readonly readerListMaxHeight: "var(--layout-reader-list-max-height)"; }; readonly overlay: { readonly modalMaxHeight: "var(--layout-modal-max-height)"; readonly modalWidthFluid: "var(--layout-modal-width-fluid)"; readonly modalWidthSm: "var(--layout-modal-width-sm)"; readonly modalWidthMd: "var(--layout-modal-width-md)"; readonly modalWidthLg: "var(--layout-modal-width-lg)"; readonly modalWidthXl: "var(--layout-modal-width-xl)"; readonly dropdownMinWidth: "var(--layout-dropdown-menu-min-width)"; readonly dropdownMaxWidth: "var(--layout-dropdown-menu-max-width)"; readonly popoverMinWidth: "var(--layout-popover-min-width)"; readonly tooltipMaxWidth: "var(--layout-tooltip-max-width)"; readonly floatingPanelMaxHeight: "var(--layout-floating-panel-max-height)"; readonly floatingPanelTopOffset: "var(--layout-floating-panel-top-offset)"; readonly floatingPanelMaxHeightDesktop: "var(--layout-floating-panel-max-height-desktop)"; readonly floatingPanelWidth: "var(--layout-floating-panel-width)"; }; readonly editor: { readonly noteWidth: "var(--layout-note-editor-width)"; readonly noteMinHeight: "var(--layout-note-editor-min-height)"; readonly noteMaxHeight: "var(--layout-note-editor-max-height)"; readonly annotationMinHeight: "var(--layout-annotation-editor-min-height)"; readonly inlineTitleMaxWidth: "var(--layout-inline-title-max-width)"; readonly errorStackMaxHeight: "var(--layout-error-stack-max-height)"; readonly errorComponentStackMaxHeight: "var(--layout-error-component-stack-max-height)"; }; readonly effect: { readonly backdropBlurSm: "var(--effect-backdrop-blur-sm)"; }; }` | no |
| `motion` | `{ readonly duration: { readonly fast: "var(--duration-fast)"; readonly normal: "var(--duration-normal)"; readonly slow: "var(--duration-slow)"; }; readonly transition: { readonly fast: "var(--transition-fast)"; readonly normal: "var(--transition-normal)"; readonly slow: "var(--transition-slow)"; }; }` | no |
| `radius` | `{ readonly xs: "var(--radius-xs)"; readonly sm: "var(--radius-sm)"; readonly md: "var(--radius-md)"; readonly lg: "var(--radius-lg)"; readonly xl: "var(--radius-xl)"; readonly "2xl": "var(--radius-2xl)"; readonly full: "var(--radius-full)"; }` | no |
| `reader` | `{ readonly background: "var(--reader-bg)"; readonly foreground: "var(--reader-fg)"; readonly link: "var(--reader-link)"; readonly fontSize: "var(--reader-font-size)"; readonly lineHeight: "var(--reader-line-height)"; readonly marginX: "var(--reader-margin-x)"; readonly marginY: "var(--reader-margin-y)"; readonly brightness: "var(--reader-brightness)"; readonly zoom: "var(--reader-zoom)"; }` | no |
| `shadow` | `{ readonly xs: "var(--shadow-xs)"; readonly sm: "var(--shadow-sm)"; readonly md: "var(--shadow-md)"; readonly lg: "var(--shadow-lg)"; }` | no |
| `spacing` | `{ readonly xxs: "var(--spacing-xxs)"; readonly xs: "var(--spacing-xs)"; readonly sm: "var(--spacing-sm)"; readonly md: "var(--spacing-md)"; readonly lg: "var(--spacing-lg)"; readonly xl: "var(--spacing-xl)"; readonly "2xl": "var(--spacing-2xl)"; readonly "3xl": "var(--spacing-3xl)"; readonly "4xl": "var(--spacing-4xl)"; }` | no |
| `typography` | `{ readonly family: { readonly sans: "var(--font-sans)"; readonly serif: "var(--font-serif)"; readonly mono: "var(--font-mono)"; readonly display: "var(--font-playfair)"; readonly readerSerif: "var(--font-merriweather)"; }; readonly size: { readonly "4xs": "var(--font-size-4xs)"; readonly "3xs": "var(--font-size-3xs)"; readonly "2xs": "var(--font-size-2xs)"; readonly caption: "var(--font-size-caption)"; readonly xs: "var(--font-size-xs)"; readonly sm: "var(--font-size-sm)"; readonly md: "var(--font-size-md)"; readonly lg: "var(--font-size-lg)"; readonly xl: "var(--font-size-xl)"; readonly "2xl": "var(--font-size-2xl)"; readonly "3xl": "var(--font-size-3xl)"; readonly "4xl": "var(--font-size-4xl)"; readonly "5xl": "var(--font-size-5xl)"; }; readonly lineHeight: { readonly tight: "var(--line-height-tight)"; readonly snug: "var(--line-height-snug)"; readonly normal: "var(--line-height-normal)"; readonly relaxed: "var(--line-height-relaxed)"; readonly loose: "var(--line-height-loose)"; }; readonly weight: { readonly regular: "var(--font-weight-regular)"; readonly medium: "var(--font-weight-medium)"; readonly semibold: "var(--font-weight-semibold)"; readonly bold: "var(--font-weight-bold)"; readonly black: "var(--font-weight-black)"; }; readonly letterSpacing: { readonly tight: "var(--letter-spacing-tight)"; readonly normal: "var(--letter-spacing-normal)"; readonly wide: "var(--letter-spacing-wide)"; readonly wider: "var(--letter-spacing-wider)"; }; }` | no |
| `zIndex` | `{ readonly backdrop: "var(--z-backdrop)"; readonly dropdown: "var(--z-dropdown)"; readonly sticky: "var(--z-sticky)"; readonly modal: "var(--z-modal)"; readonly popover: "var(--z-popover)"; readonly tooltip: "var(--z-tooltip)"; }` | no |

### Value `DESIGN_TOKENS`

- Type: `{ readonly vars: { readonly color: { readonly background: "var(--color-background)"; readonly surface: "var(--color-surface)"; readonly surfaceElevated: "var(--color-surface-elevated)"; readonly surfaceMuted: "var(--color-surface-muted)"; readonly surfaceVariant: "var(--color-surface-variant)"; readonly surfaceHover: "var(--color-surface-hover)"; readonly textPrimary: "var(--color-text-primary)"; readonly textSecondary: "var(--color-text-secondary)"; readonly textMuted: "var(--color-text-muted)"; readonly textInverse: "var(--color-text-inverse)"; readonly border: "var(--color-border)"; readonly borderSubtle: "var(--color-border-subtle)"; readonly accent: "var(--color-accent)"; readonly accentHover: "var(--color-accent-hover)"; readonly accentLight: "var(--color-accent-light)"; readonly accentContrast: "var(--color-accent-contrast)"; readonly success: "var(--color-success)"; readonly warning: "var(--color-warning)"; readonly error: "var(--color-error)"; readonly info: "var(--color-info)"; readonly focusRing: "var(--color-focus-ring)"; readonly overlaySubtle: "var(--color-overlay-subtle)"; readonly overlayMedium: "var(--color-overlay-medium)"; readonly overlayStrong: "var(--color-overlay-strong)"; readonly overlayStrongHover: "var(--color-overlay-strong-hover)"; }; readonly reader: { readonly background: "var(--reader-bg)"; readonly foreground: "var(--reader-fg)"; readonly link: "var(--reader-link)"; readonly fontSize: "var(--reader-font-size)"; readonly lineHeight: "var(--reader-line-height)"; readonly marginX: "var(--reader-margin-x)"; readonly marginY: "var(--reader-margin-y)"; readonly brightness: "var(--reader-brightness)"; readonly zoom: "var(--reader-zoom)"; }; readonly spacing: { readonly xxs: "var(--spacing-xxs)"; readonly xs: "var(--spacing-xs)"; readonly sm: "var(--spacing-sm)"; readonly md: "var(--spacing-md)"; readonly lg: "var(--spacing-lg)"; readonly xl: "var(--spacing-xl)"; readonly "2xl": "var(--spacing-2xl)"; readonly "3xl": "var(--spacing-3xl)"; readonly "4xl": "var(--spacing-4xl)"; }; readonly radius: { readonly xs: "var(--radius-xs)"; readonly sm: "var(--radius-sm)"; readonly md: "var(--radius-md)"; readonly lg: "var(--radius-lg)"; readonly xl: "var(--radius-xl)"; readonly "2xl": "var(--radius-2xl)"; readonly full: "var(--radius-full)"; }; readonly shadow: { readonly xs: "var(--shadow-xs)"; readonly sm: "var(--shadow-sm)"; readonly md: "var(--shadow-md)"; readonly lg: "var(--shadow-lg)"; }; readonly typography: { readonly family: { readonly sans: "var(--font-sans)"; readonly serif: "var(--font-serif)"; readonly mono: "var(--font-mono)"; readonly display: "var(--font-playfair)"; readonly readerSerif: "var(--font-merriweather)"; }; readonly size: { readonly "4xs": "var(--font-size-4xs)"; readonly "3xs": "var(--font-size-3xs)"; readonly "2xs": "var(--font-size-2xs)"; readonly caption: "var(--font-size-caption)"; readonly xs: "var(--font-size-xs)"; readonly sm: "var(--font-size-sm)"; readonly md: "var(--font-size-md)"; readonly lg: "var(--font-size-lg)"; readonly xl: "var(--font-size-xl)"; readonly "2xl": "var(--font-size-2xl)"; readonly "3xl": "var(--font-size-3xl)"; readonly "4xl": "var(--font-size-4xl)"; readonly "5xl": "var(--font-size-5xl)"; }; readonly lineHeight: { readonly tight: "var(--line-height-tight)"; readonly snug: "var(--line-height-snug)"; readonly normal: "var(--line-height-normal)"; readonly relaxed: "var(--line-height-relaxed)"; readonly loose: "var(--line-height-loose)"; }; readonly weight: { readonly regular: "var(--font-weight-regular)"; readonly medium: "var(--font-weight-medium)"; readonly semibold: "var(--font-weight-semibold)"; readonly bold: "var(--font-weight-bold)"; readonly black: "var(--font-weight-black)"; }; readonly letterSpacing: { readonly tight: "var(--letter-spacing-tight)"; readonly normal: "var(--letter-spacing-normal)"; readonly wide: "var(--letter-spacing-wide)"; readonly wider: "var(--letter-spacing-wider)"; }; }; readonly motion: { readonly duration: { readonly fast: "var(--duration-fast)"; readonly normal: "var(--duration-normal)"; readonly slow: "var(--duration-slow)"; }; readonly transition: { readonly fast: "var(--transition-fast)"; readonly normal: "var(--transition-normal)"; readonly slow: "var(--transition-slow)"; }; }; readonly layout: { readonly container: { readonly sm: "var(--container-width-sm)"; readonly md: "var(--container-width-md)"; readonly lg: "var(--container-width-lg)"; readonly xl: "var(--container-width-xl)"; readonly "2xl": "var(--container-width-2xl)"; readonly "7xl": "var(--container-width-7xl)"; readonly max: "var(--layout-content-max-width)"; readonly readable: "var(--layout-content-readable-width)"; readonly inlinePadding: "var(--layout-content-inline-padding)"; readonly inlinePaddingMobile: "var(--layout-content-inline-padding-mobile)"; }; readonly sidebar: { readonly expanded: "var(--layout-sidebar-width)"; readonly collapsed: "var(--layout-sidebar-collapsed-width)"; }; readonly chrome: { readonly headerHeight: "var(--layout-header-height)"; readonly titlebarHeight: "var(--layout-titlebar-height)"; readonly readerToolbarHeight: "var(--layout-reader-toolbar-height)"; }; readonly panel: { readonly readerWidth: "var(--layout-reader-panel-width)"; readonly readerWidthMobile: "var(--layout-reader-panel-width-mobile)"; readonly readerMaxHeight: "var(--layout-reader-panel-max-height)"; readonly readerMaxWidthMobile: "var(--layout-reader-panel-max-width-mobile)"; readonly readerMobileHeight: "var(--layout-reader-panel-mobile-height)"; readonly readerListMaxHeight: "var(--layout-reader-list-max-height)"; }; readonly overlay: { readonly modalMaxHeight: "var(--layout-modal-max-height)"; readonly modalWidthFluid: "var(--layout-modal-width-fluid)"; readonly modalWidthSm: "var(--layout-modal-width-sm)"; readonly modalWidthMd: "var(--layout-modal-width-md)"; readonly modalWidthLg: "var(--layout-modal-width-lg)"; readonly modalWidthXl: "var(--layout-modal-width-xl)"; readonly dropdownMinWidth: "var(--layout-dropdown-menu-min-width)"; readonly dropdownMaxWidth: "var(--layout-dropdown-menu-max-width)"; readonly popoverMinWidth: "var(--layout-popover-min-width)"; readonly tooltipMaxWidth: "var(--layout-tooltip-max-width)"; readonly floatingPanelMaxHeight: "var(--layout-floating-panel-max-height)"; readonly floatingPanelTopOffset: "var(--layout-floating-panel-top-offset)"; readonly floatingPanelMaxHeightDesktop: "var(--layout-floating-panel-max-height-desktop)"; readonly floatingPanelWidth: "var(--layout-floating-panel-width)"; }; readonly editor: { readonly noteWidth: "var(--layout-note-editor-width)"; readonly noteMinHeight: "var(--layout-note-editor-min-height)"; readonly noteMaxHeight: "var(--layout-note-editor-max-height)"; readonly annotationMinHeight: "var(--layout-annotation-editor-min-height)"; readonly inlineTitleMaxWidth: "var(--layout-inline-title-max-width)"; readonly errorStackMaxHeight: "var(--layout-error-stack-max-height)"; readonly errorComponentStackMaxHeight: "var(--layout-error-component-stack-max-height)"; }; readonly effect: { readonly backdropBlurSm: "var(--effect-backdrop-blur-sm)"; }; }; readonly controls: { readonly height: { readonly sm: "var(--control-height-sm)"; readonly md: "var(--control-height-md)"; readonly lg: "var(--control-height-lg)"; readonly touchMin: "var(--control-touch-min)"; readonly iconButton: "var(--control-icon-button-size)"; }; readonly padding: { readonly x: "var(--control-padding-x)"; readonly y: "var(--control-padding-y)"; }; readonly icon: { readonly sm: "var(--icon-size-sm)"; readonly md: "var(--icon-size-md)"; readonly lg: "var(--icon-size-lg)"; }; }; readonly zIndex: { readonly backdrop: "var(--z-backdrop)"; readonly dropdown: "var(--z-dropdown)"; readonly sticky: "var(--z-sticky)"; readonly modal: "var(--z-modal)"; readonly popover: "var(--z-popover)"; readonly tooltip: "var(--z-tooltip)"; }; readonly breakpoints: { readonly sm: "640px"; readonly md: "768px"; readonly lg: "1024px"; readonly xl: "1280px"; readonly "2xl": "1536px"; }; }; readonly themes: Record<ReaderTheme, ThemeSemanticPalette>; readonly highlights: Record<HighlightColor, HighlightColorToken>; readonly shelves: ShelfColorToken[]; readonly readerThemePreviews: Record<ReaderTheme, { bg: string; fg: string; }>; }`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `highlights` | `Record<HighlightColor, HighlightColorToken>` | no |
| `readerThemePreviews` | `Record<ReaderTheme, { bg: string; fg: string; }>` | no |
| `shelves` | `ShelfColorToken[]` | no |
| `themes` | `Record<ReaderTheme, ThemeSemanticPalette>` | no |
| `vars` | `{ readonly color: { readonly background: "var(--color-background)"; readonly surface: "var(--color-surface)"; readonly surfaceElevated: "var(--color-surface-elevated)"; readonly surfaceMuted: "var(--color-surface-muted)"; readonly surfaceVariant: "var(--color-surface-variant)"; readonly surfaceHover: "var(--color-surface-hover)"; readonly textPrimary: "var(--color-text-primary)"; readonly textSecondary: "var(--color-text-secondary)"; readonly textMuted: "var(--color-text-muted)"; readonly textInverse: "var(--color-text-inverse)"; readonly border: "var(--color-border)"; readonly borderSubtle: "var(--color-border-subtle)"; readonly accent: "var(--color-accent)"; readonly accentHover: "var(--color-accent-hover)"; readonly accentLight: "var(--color-accent-light)"; readonly accentContrast: "var(--color-accent-contrast)"; readonly success: "var(--color-success)"; readonly warning: "var(--color-warning)"; readonly error: "var(--color-error)"; readonly info: "var(--color-info)"; readonly focusRing: "var(--color-focus-ring)"; readonly overlaySubtle: "var(--color-overlay-subtle)"; readonly overlayMedium: "var(--color-overlay-medium)"; readonly overlayStrong: "var(--color-overlay-strong)"; readonly overlayStrongHover: "var(--color-overlay-strong-hover)"; }; readonly reader: { readonly background: "var(--reader-bg)"; readonly foreground: "var(--reader-fg)"; readonly link: "var(--reader-link)"; readonly fontSize: "var(--reader-font-size)"; readonly lineHeight: "var(--reader-line-height)"; readonly marginX: "var(--reader-margin-x)"; readonly marginY: "var(--reader-margin-y)"; readonly brightness: "var(--reader-brightness)"; readonly zoom: "var(--reader-zoom)"; }; readonly spacing: { readonly xxs: "var(--spacing-xxs)"; readonly xs: "var(--spacing-xs)"; readonly sm: "var(--spacing-sm)"; readonly md: "var(--spacing-md)"; readonly lg: "var(--spacing-lg)"; readonly xl: "var(--spacing-xl)"; readonly "2xl": "var(--spacing-2xl)"; readonly "3xl": "var(--spacing-3xl)"; readonly "4xl": "var(--spacing-4xl)"; }; readonly radius: { readonly xs: "var(--radius-xs)"; readonly sm: "var(--radius-sm)"; readonly md: "var(--radius-md)"; readonly lg: "var(--radius-lg)"; readonly xl: "var(--radius-xl)"; readonly "2xl": "var(--radius-2xl)"; readonly full: "var(--radius-full)"; }; readonly shadow: { readonly xs: "var(--shadow-xs)"; readonly sm: "var(--shadow-sm)"; readonly md: "var(--shadow-md)"; readonly lg: "var(--shadow-lg)"; }; readonly typography: { readonly family: { readonly sans: "var(--font-sans)"; readonly serif: "var(--font-serif)"; readonly mono: "var(--font-mono)"; readonly display: "var(--font-playfair)"; readonly readerSerif: "var(--font-merriweather)"; }; readonly size: { readonly "4xs": "var(--font-size-4xs)"; readonly "3xs": "var(--font-size-3xs)"; readonly "2xs": "var(--font-size-2xs)"; readonly caption: "var(--font-size-caption)"; readonly xs: "var(--font-size-xs)"; readonly sm: "var(--font-size-sm)"; readonly md: "var(--font-size-md)"; readonly lg: "var(--font-size-lg)"; readonly xl: "var(--font-size-xl)"; readonly "2xl": "var(--font-size-2xl)"; readonly "3xl": "var(--font-size-3xl)"; readonly "4xl": "var(--font-size-4xl)"; readonly "5xl": "var(--font-size-5xl)"; }; readonly lineHeight: { readonly tight: "var(--line-height-tight)"; readonly snug: "var(--line-height-snug)"; readonly normal: "var(--line-height-normal)"; readonly relaxed: "var(--line-height-relaxed)"; readonly loose: "var(--line-height-loose)"; }; readonly weight: { readonly regular: "var(--font-weight-regular)"; readonly medium: "var(--font-weight-medium)"; readonly semibold: "var(--font-weight-semibold)"; readonly bold: "var(--font-weight-bold)"; readonly black: "var(--font-weight-black)"; }; readonly letterSpacing: { readonly tight: "var(--letter-spacing-tight)"; readonly normal: "var(--letter-spacing-normal)"; readonly wide: "var(--letter-spacing-wide)"; readonly wider: "var(--letter-spacing-wider)"; }; }; readonly motion: { readonly duration: { readonly fast: "var(--duration-fast)"; readonly normal: "var(--duration-normal)"; readonly slow: "var(--duration-slow)"; }; readonly transition: { readonly fast: "var(--transition-fast)"; readonly normal: "var(--transition-normal)"; readonly slow: "var(--transition-slow)"; }; }; readonly layout: { readonly container: { readonly sm: "var(--container-width-sm)"; readonly md: "var(--container-width-md)"; readonly lg: "var(--container-width-lg)"; readonly xl: "var(--container-width-xl)"; readonly "2xl": "var(--container-width-2xl)"; readonly "7xl": "var(--container-width-7xl)"; readonly max: "var(--layout-content-max-width)"; readonly readable: "var(--layout-content-readable-width)"; readonly inlinePadding: "var(--layout-content-inline-padding)"; readonly inlinePaddingMobile: "var(--layout-content-inline-padding-mobile)"; }; readonly sidebar: { readonly expanded: "var(--layout-sidebar-width)"; readonly collapsed: "var(--layout-sidebar-collapsed-width)"; }; readonly chrome: { readonly headerHeight: "var(--layout-header-height)"; readonly titlebarHeight: "var(--layout-titlebar-height)"; readonly readerToolbarHeight: "var(--layout-reader-toolbar-height)"; }; readonly panel: { readonly readerWidth: "var(--layout-reader-panel-width)"; readonly readerWidthMobile: "var(--layout-reader-panel-width-mobile)"; readonly readerMaxHeight: "var(--layout-reader-panel-max-height)"; readonly readerMaxWidthMobile: "var(--layout-reader-panel-max-width-mobile)"; readonly readerMobileHeight: "var(--layout-reader-panel-mobile-height)"; readonly readerListMaxHeight: "var(--layout-reader-list-max-height)"; }; readonly overlay: { readonly modalMaxHeight: "var(--layout-modal-max-height)"; readonly modalWidthFluid: "var(--layout-modal-width-fluid)"; readonly modalWidthSm: "var(--layout-modal-width-sm)"; readonly modalWidthMd: "var(--layout-modal-width-md)"; readonly modalWidthLg: "var(--layout-modal-width-lg)"; readonly modalWidthXl: "var(--layout-modal-width-xl)"; readonly dropdownMinWidth: "var(--layout-dropdown-menu-min-width)"; readonly dropdownMaxWidth: "var(--layout-dropdown-menu-max-width)"; readonly popoverMinWidth: "var(--layout-popover-min-width)"; readonly tooltipMaxWidth: "var(--layout-tooltip-max-width)"; readonly floatingPanelMaxHeight: "var(--layout-floating-panel-max-height)"; readonly floatingPanelTopOffset: "var(--layout-floating-panel-top-offset)"; readonly floatingPanelMaxHeightDesktop: "var(--layout-floating-panel-max-height-desktop)"; readonly floatingPanelWidth: "var(--layout-floating-panel-width)"; }; readonly editor: { readonly noteWidth: "var(--layout-note-editor-width)"; readonly noteMinHeight: "var(--layout-note-editor-min-height)"; readonly noteMaxHeight: "var(--layout-note-editor-max-height)"; readonly annotationMinHeight: "var(--layout-annotation-editor-min-height)"; readonly inlineTitleMaxWidth: "var(--layout-inline-title-max-width)"; readonly errorStackMaxHeight: "var(--layout-error-stack-max-height)"; readonly errorComponentStackMaxHeight: "var(--layout-error-component-stack-max-height)"; }; readonly effect: { readonly backdropBlurSm: "var(--effect-backdrop-blur-sm)"; }; }; readonly controls: { readonly height: { readonly sm: "var(--control-height-sm)"; readonly md: "var(--control-height-md)"; readonly lg: "var(--control-height-lg)"; readonly touchMin: "var(--control-touch-min)"; readonly iconButton: "var(--control-icon-button-size)"; }; readonly padding: { readonly x: "var(--control-padding-x)"; readonly y: "var(--control-padding-y)"; }; readonly icon: { readonly sm: "var(--icon-size-sm)"; readonly md: "var(--icon-size-md)"; readonly lg: "var(--icon-size-lg)"; }; }; readonly zIndex: { readonly backdrop: "var(--z-backdrop)"; readonly dropdown: "var(--z-dropdown)"; readonly sticky: "var(--z-sticky)"; readonly modal: "var(--z-modal)"; readonly popover: "var(--z-popover)"; readonly tooltip: "var(--z-tooltip)"; }; readonly breakpoints: { readonly sm: "640px"; readonly md: "768px"; readonly lg: "1024px"; readonly xl: "1280px"; readonly "2xl": "1536px"; }; }` | no |

### Value `FIXED_LAYOUT_FORMATS`

- Type: `BookFormat[]`

### Value `FORMAT_COLORS`

- Type: `Record<BookFormat, string>`

**Fields**

_No object fields detected._

### Value `FORMAT_DISPLAY_NAMES`

- Type: `Record<BookFormat, string>`

**Fields**

_No object fields detected._

### Value `HIGHLIGHT_COLOR_TOKENS`

- Type: `Record<HighlightColor, HighlightColorToken>`

**Fields**

_No object fields detected._

### Value `HIGHLIGHT_COLORS`

- Type: `Record<HighlightColor, string>`

**Fields**

_No object fields detected._

### Value `HIGHLIGHT_COLORS_DARK`

- Type: `Record<HighlightColor, string>`

**Fields**

_No object fields detected._

### Value `HIGHLIGHT_PICKER_ACTIVE_COLORS`

- Type: `Record<HighlightColor, string>`

**Fields**

_No object fields detected._

### Value `HIGHLIGHT_PICKER_COLORS`

- Type: `Record<HighlightColor, string>`

**Fields**

_No object fields detected._

### Value `HIGHLIGHT_SOLID_COLORS`

- Type: `Record<HighlightColor, string>`

**Fields**

_No object fields detected._

### Value `READER_THEME_PREVIEWS`

- Type: `Record<ReaderTheme, { bg: string; fg: string; }>`

**Fields**

_No object fields detected._

### Value `REFLOWABLE_FORMATS`

- Type: `BookFormat[]`

### Value `SHELF_COLOR_PALETTE`

- Type: `ShelfColorToken[]`

### Types and Interfaces

### Interface `Annotation`

- Type: `Annotation`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `bookId` | `string` | no |
| `color` | `HighlightColor | undefined` | yes |
| `createdAt` | `Date` | no |
| `drawingData` | `string | undefined` | yes |
| `id` | `string` | no |
| `location` | `string` | no |
| `noteContent` | `string | undefined` | yes |
| `pageNumber` | `number | undefined` | yes |
| `pdfAnnotationType` | `"highlight" | "drawing" | "textNote" | undefined` | yes |
| `rect` | `{ x: number; y: number; width: number; height: number; } | undefined` | yes |
| `rects` | `{ x: number; y: number; width: number; height: number; }[] | undefined` | yes |
| `selectedText` | `string | undefined` | yes |
| `strokeWidth` | `number | undefined` | yes |
| `textNoteContent` | `string | undefined` | yes |
| `type` | `"highlight" | "note" | "bookmark"` | no |
| `updatedAt` | `Date | undefined` | yes |

### Type `AppRoute`

- Type: `AppRoute`

**Fields**

_No object fields detected._

### Interface `AppSettings`

- Type: `AppSettings`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `cacheSize` | `number` | no |
| `learning` | `LearningSettings` | no |
| `librarySortBy` | `LibrarySortBy` | no |
| `librarySortOrder` | `LibrarySortOrder` | no |
| `libraryViewMode` | `LibraryViewMode` | no |
| `readerSettings` | `ReaderSettings` | no |
| `scanFolders` | `string[]` | no |
| `sidebarCollapsed` | `boolean` | no |
| `theme` | `"light" | "dark" | "system"` | no |

### Interface `Book`

- Type: `Book`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `addedAt` | `Date` | no |
| `author` | `string` | no |
| `category` | `string | undefined` | yes |
| `completedAt` | `Date | undefined` | yes |
| `coverPath` | `string | undefined` | yes |
| `currentLocation` | `string | undefined` | yes |
| `description` | `string | undefined` | yes |
| `filePath` | `string` | no |
| `fileSize` | `number` | no |
| `format` | `BookFormat` | no |
| `id` | `string` | no |
| `isbn` | `string | undefined` | yes |
| `isFavorite` | `boolean` | no |
| `language` | `string | undefined` | yes |
| `lastClickFraction` | `number | undefined` | yes |
| `lastReadAt` | `Date | undefined` | yes |
| `locations` | `string | undefined` | yes |
| `manualCompletionState` | `"read" | "unread" | undefined` | yes |
| `pageProgress` | `{ currentPage: number; endPage?: number; totalPages: number; range: string; } | undefined` | yes |
| `pdfViewState` | `PdfViewState | undefined` | yes |
| `progress` | `number` | no |
| `progressBeforeFinish` | `number | undefined` | yes |
| `publishedDate` | `string | undefined` | yes |
| `publisher` | `string | undefined` | yes |
| `rating` | `number | undefined` | yes |
| `readingTime` | `number` | no |
| `storagePath` | `string | undefined` | yes |
| `tags` | `string[]` | no |
| `title` | `string` | no |

### Type `BookFormat`

Theorem Type Definitions

- Type: `BookFormat`

**Fields**

_No object fields detected._

### Interface `BookSection`

- Type: `BookSection`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `fraction` | `number` | no |
| `href` | `string` | no |
| `index` | `number` | no |
| `label` | `string` | no |

### Interface `Collection`

- Type: `Collection`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `bookIds` | `string[]` | no |
| `createdAt` | `Date` | no |
| `description` | `string | undefined` | yes |
| `id` | `string` | no |
| `name` | `string` | no |

### Interface `DailyReadingActivity`

- Type: `DailyReadingActivity`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `booksRead` | `string[]` | no |
| `date` | `string` | no |
| `minutes` | `number` | no |

### Interface `DailyReminderState`

- Type: `DailyReminderState`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `completedDate` | `string | undefined` | yes |
| `dismissedDate` | `string | undefined` | yes |
| `isPromptVisible` | `boolean` | no |
| `lastPromptDate` | `string | undefined` | yes |

### Interface `DailyReviewItem`

- Type: `DailyReviewItem`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `back` | `string` | no |
| `createdAt` | `Date` | no |
| `dueAt` | `Date` | no |
| `front` | `string` | no |
| `id` | `string` | no |
| `lapseCount` | `number` | no |
| `reviewCount` | `number` | no |
| `sourceId` | `string` | no |
| `sourceType` | `ReviewSourceType` | no |
| `suspended` | `boolean` | no |

### Type `DesignTokenVars`

- Type: `{ readonly color: { readonly background: "var(--color-background)"; readonly surface: "var(--color-surface)"; readonly surfaceElevated: "var(--color-surface-elevated)"; readonly surfaceMuted: "var(--color-surface-muted)"; readonly surfaceVariant: "var(--color-surface-variant)"; readonly surfaceHover: "var(--color-surface-hover)"; readonly textPrimary: "var(--color-text-primary)"; readonly textSecondary: "var(--color-text-secondary)"; readonly textMuted: "var(--color-text-muted)"; readonly textInverse: "var(--color-text-inverse)"; readonly border: "var(--color-border)"; readonly borderSubtle: "var(--color-border-subtle)"; readonly accent: "var(--color-accent)"; readonly accentHover: "var(--color-accent-hover)"; readonly accentLight: "var(--color-accent-light)"; readonly accentContrast: "var(--color-accent-contrast)"; readonly success: "var(--color-success)"; readonly warning: "var(--color-warning)"; readonly error: "var(--color-error)"; readonly info: "var(--color-info)"; readonly focusRing: "var(--color-focus-ring)"; readonly overlaySubtle: "var(--color-overlay-subtle)"; readonly overlayMedium: "var(--color-overlay-medium)"; readonly overlayStrong: "var(--color-overlay-strong)"; readonly overlayStrongHover: "var(--color-overlay-strong-hover)"; }; readonly reader: { readonly background: "var(--reader-bg)"; readonly foreground: "var(--reader-fg)"; readonly link: "var(--reader-link)"; readonly fontSize: "var(--reader-font-size)"; readonly lineHeight: "var(--reader-line-height)"; readonly marginX: "var(--reader-margin-x)"; readonly marginY: "var(--reader-margin-y)"; readonly brightness: "var(--reader-brightness)"; readonly zoom: "var(--reader-zoom)"; }; readonly spacing: { readonly xxs: "var(--spacing-xxs)"; readonly xs: "var(--spacing-xs)"; readonly sm: "var(--spacing-sm)"; readonly md: "var(--spacing-md)"; readonly lg: "var(--spacing-lg)"; readonly xl: "var(--spacing-xl)"; readonly "2xl": "var(--spacing-2xl)"; readonly "3xl": "var(--spacing-3xl)"; readonly "4xl": "var(--spacing-4xl)"; }; readonly radius: { readonly xs: "var(--radius-xs)"; readonly sm: "var(--radius-sm)"; readonly md: "var(--radius-md)"; readonly lg: "var(--radius-lg)"; readonly xl: "var(--radius-xl)"; readonly "2xl": "var(--radius-2xl)"; readonly full: "var(--radius-full)"; }; readonly shadow: { readonly xs: "var(--shadow-xs)"; readonly sm: "var(--shadow-sm)"; readonly md: "var(--shadow-md)"; readonly lg: "var(--shadow-lg)"; }; readonly typography: { readonly family: { readonly sans: "var(--font-sans)"; readonly serif: "var(--font-serif)"; readonly mono: "var(--font-mono)"; readonly display: "var(--font-playfair)"; readonly readerSerif: "var(--font-merriweather)"; }; readonly size: { readonly "4xs": "var(--font-size-4xs)"; readonly "3xs": "var(--font-size-3xs)"; readonly "2xs": "var(--font-size-2xs)"; readonly caption: "var(--font-size-caption)"; readonly xs: "var(--font-size-xs)"; readonly sm: "var(--font-size-sm)"; readonly md: "var(--font-size-md)"; readonly lg: "var(--font-size-lg)"; readonly xl: "var(--font-size-xl)"; readonly "2xl": "var(--font-size-2xl)"; readonly "3xl": "var(--font-size-3xl)"; readonly "4xl": "var(--font-size-4xl)"; readonly "5xl": "var(--font-size-5xl)"; }; readonly lineHeight: { readonly tight: "var(--line-height-tight)"; readonly snug: "var(--line-height-snug)"; readonly normal: "var(--line-height-normal)"; readonly relaxed: "var(--line-height-relaxed)"; readonly loose: "var(--line-height-loose)"; }; readonly weight: { readonly regular: "var(--font-weight-regular)"; readonly medium: "var(--font-weight-medium)"; readonly semibold: "var(--font-weight-semibold)"; readonly bold: "var(--font-weight-bold)"; readonly black: "var(--font-weight-black)"; }; readonly letterSpacing: { readonly tight: "var(--letter-spacing-tight)"; readonly normal: "var(--letter-spacing-normal)"; readonly wide: "var(--letter-spacing-wide)"; readonly wider: "var(--letter-spacing-wider)"; }; }; readonly motion: { readonly duration: { readonly fast: "var(--duration-fast)"; readonly normal: "var(--duration-normal)"; readonly slow: "var(--duration-slow)"; }; readonly transition: { readonly fast: "var(--transition-fast)"; readonly normal: "var(--transition-normal)"; readonly slow: "var(--transition-slow)"; }; }; readonly layout: { readonly container: { readonly sm: "var(--container-width-sm)"; readonly md: "var(--container-width-md)"; readonly lg: "var(--container-width-lg)"; readonly xl: "var(--container-width-xl)"; readonly "2xl": "var(--container-width-2xl)"; readonly "7xl": "var(--container-width-7xl)"; readonly max: "var(--layout-content-max-width)"; readonly readable: "var(--layout-content-readable-width)"; readonly inlinePadding: "var(--layout-content-inline-padding)"; readonly inlinePaddingMobile: "var(--layout-content-inline-padding-mobile)"; }; readonly sidebar: { readonly expanded: "var(--layout-sidebar-width)"; readonly collapsed: "var(--layout-sidebar-collapsed-width)"; }; readonly chrome: { readonly headerHeight: "var(--layout-header-height)"; readonly titlebarHeight: "var(--layout-titlebar-height)"; readonly readerToolbarHeight: "var(--layout-reader-toolbar-height)"; }; readonly panel: { readonly readerWidth: "var(--layout-reader-panel-width)"; readonly readerWidthMobile: "var(--layout-reader-panel-width-mobile)"; readonly readerMaxHeight: "var(--layout-reader-panel-max-height)"; readonly readerMaxWidthMobile: "var(--layout-reader-panel-max-width-mobile)"; readonly readerMobileHeight: "var(--layout-reader-panel-mobile-height)"; readonly readerListMaxHeight: "var(--layout-reader-list-max-height)"; }; readonly overlay: { readonly modalMaxHeight: "var(--layout-modal-max-height)"; readonly modalWidthFluid: "var(--layout-modal-width-fluid)"; readonly modalWidthSm: "var(--layout-modal-width-sm)"; readonly modalWidthMd: "var(--layout-modal-width-md)"; readonly modalWidthLg: "var(--layout-modal-width-lg)"; readonly modalWidthXl: "var(--layout-modal-width-xl)"; readonly dropdownMinWidth: "var(--layout-dropdown-menu-min-width)"; readonly dropdownMaxWidth: "var(--layout-dropdown-menu-max-width)"; readonly popoverMinWidth: "var(--layout-popover-min-width)"; readonly tooltipMaxWidth: "var(--layout-tooltip-max-width)"; readonly floatingPanelMaxHeight: "var(--layout-floating-panel-max-height)"; readonly floatingPanelTopOffset: "var(--layout-floating-panel-top-offset)"; readonly floatingPanelMaxHeightDesktop: "var(--layout-floating-panel-max-height-desktop)"; readonly floatingPanelWidth: "var(--layout-floating-panel-width)"; }; readonly editor: { readonly noteWidth: "var(--layout-note-editor-width)"; readonly noteMinHeight: "var(--layout-note-editor-min-height)"; readonly noteMaxHeight: "var(--layout-note-editor-max-height)"; readonly annotationMinHeight: "var(--layout-annotation-editor-min-height)"; readonly inlineTitleMaxWidth: "var(--layout-inline-title-max-width)"; readonly errorStackMaxHeight: "var(--layout-error-stack-max-height)"; readonly errorComponentStackMaxHeight: "var(--layout-error-component-stack-max-height)"; }; readonly effect: { readonly backdropBlurSm: "var(--effect-backdrop-blur-sm)"; }; }; readonly controls: { readonly height: { readonly sm: "var(--control-height-sm)"; readonly md: "var(--control-height-md)"; readonly lg: "var(--control-height-lg)"; readonly touchMin: "var(--control-touch-min)"; readonly iconButton: "var(--control-icon-button-size)"; }; readonly padding: { readonly x: "var(--control-padding-x)"; readonly y: "var(--control-padding-y)"; }; readonly icon: { readonly sm: "var(--icon-size-sm)"; readonly md: "var(--icon-size-md)"; readonly lg: "var(--icon-size-lg)"; }; }; readonly zIndex: { readonly backdrop: "var(--z-backdrop)"; readonly dropdown: "var(--z-dropdown)"; readonly sticky: "var(--z-sticky)"; readonly modal: "var(--z-modal)"; readonly popover: "var(--z-popover)"; readonly tooltip: "var(--z-tooltip)"; }; readonly breakpoints: { readonly sm: "640px"; readonly md: "768px"; readonly lg: "1024px"; readonly xl: "1280px"; readonly "2xl": "1536px"; }; }`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `breakpoints` | `{ readonly sm: "640px"; readonly md: "768px"; readonly lg: "1024px"; readonly xl: "1280px"; readonly "2xl": "1536px"; }` | no |
| `color` | `{ readonly background: "var(--color-background)"; readonly surface: "var(--color-surface)"; readonly surfaceElevated: "var(--color-surface-elevated)"; readonly surfaceMuted: "var(--color-surface-muted)"; readonly surfaceVariant: "var(--color-surface-variant)"; readonly surfaceHover: "var(--color-surface-hover)"; readonly textPrimary: "var(--color-text-primary)"; readonly textSecondary: "var(--color-text-secondary)"; readonly textMuted: "var(--color-text-muted)"; readonly textInverse: "var(--color-text-inverse)"; readonly border: "var(--color-border)"; readonly borderSubtle: "var(--color-border-subtle)"; readonly accent: "var(--color-accent)"; readonly accentHover: "var(--color-accent-hover)"; readonly accentLight: "var(--color-accent-light)"; readonly accentContrast: "var(--color-accent-contrast)"; readonly success: "var(--color-success)"; readonly warning: "var(--color-warning)"; readonly error: "var(--color-error)"; readonly info: "var(--color-info)"; readonly focusRing: "var(--color-focus-ring)"; readonly overlaySubtle: "var(--color-overlay-subtle)"; readonly overlayMedium: "var(--color-overlay-medium)"; readonly overlayStrong: "var(--color-overlay-strong)"; readonly overlayStrongHover: "var(--color-overlay-strong-hover)"; }` | no |
| `controls` | `{ readonly height: { readonly sm: "var(--control-height-sm)"; readonly md: "var(--control-height-md)"; readonly lg: "var(--control-height-lg)"; readonly touchMin: "var(--control-touch-min)"; readonly iconButton: "var(--control-icon-button-size)"; }; readonly padding: { readonly x: "var(--control-padding-x)"; readonly y: "var(--control-padding-y)"; }; readonly icon: { readonly sm: "var(--icon-size-sm)"; readonly md: "var(--icon-size-md)"; readonly lg: "var(--icon-size-lg)"; }; }` | no |
| `layout` | `{ readonly container: { readonly sm: "var(--container-width-sm)"; readonly md: "var(--container-width-md)"; readonly lg: "var(--container-width-lg)"; readonly xl: "var(--container-width-xl)"; readonly "2xl": "var(--container-width-2xl)"; readonly "7xl": "var(--container-width-7xl)"; readonly max: "var(--layout-content-max-width)"; readonly readable: "var(--layout-content-readable-width)"; readonly inlinePadding: "var(--layout-content-inline-padding)"; readonly inlinePaddingMobile: "var(--layout-content-inline-padding-mobile)"; }; readonly sidebar: { readonly expanded: "var(--layout-sidebar-width)"; readonly collapsed: "var(--layout-sidebar-collapsed-width)"; }; readonly chrome: { readonly headerHeight: "var(--layout-header-height)"; readonly titlebarHeight: "var(--layout-titlebar-height)"; readonly readerToolbarHeight: "var(--layout-reader-toolbar-height)"; }; readonly panel: { readonly readerWidth: "var(--layout-reader-panel-width)"; readonly readerWidthMobile: "var(--layout-reader-panel-width-mobile)"; readonly readerMaxHeight: "var(--layout-reader-panel-max-height)"; readonly readerMaxWidthMobile: "var(--layout-reader-panel-max-width-mobile)"; readonly readerMobileHeight: "var(--layout-reader-panel-mobile-height)"; readonly readerListMaxHeight: "var(--layout-reader-list-max-height)"; }; readonly overlay: { readonly modalMaxHeight: "var(--layout-modal-max-height)"; readonly modalWidthFluid: "var(--layout-modal-width-fluid)"; readonly modalWidthSm: "var(--layout-modal-width-sm)"; readonly modalWidthMd: "var(--layout-modal-width-md)"; readonly modalWidthLg: "var(--layout-modal-width-lg)"; readonly modalWidthXl: "var(--layout-modal-width-xl)"; readonly dropdownMinWidth: "var(--layout-dropdown-menu-min-width)"; readonly dropdownMaxWidth: "var(--layout-dropdown-menu-max-width)"; readonly popoverMinWidth: "var(--layout-popover-min-width)"; readonly tooltipMaxWidth: "var(--layout-tooltip-max-width)"; readonly floatingPanelMaxHeight: "var(--layout-floating-panel-max-height)"; readonly floatingPanelTopOffset: "var(--layout-floating-panel-top-offset)"; readonly floatingPanelMaxHeightDesktop: "var(--layout-floating-panel-max-height-desktop)"; readonly floatingPanelWidth: "var(--layout-floating-panel-width)"; }; readonly editor: { readonly noteWidth: "var(--layout-note-editor-width)"; readonly noteMinHeight: "var(--layout-note-editor-min-height)"; readonly noteMaxHeight: "var(--layout-note-editor-max-height)"; readonly annotationMinHeight: "var(--layout-annotation-editor-min-height)"; readonly inlineTitleMaxWidth: "var(--layout-inline-title-max-width)"; readonly errorStackMaxHeight: "var(--layout-error-stack-max-height)"; readonly errorComponentStackMaxHeight: "var(--layout-error-component-stack-max-height)"; }; readonly effect: { readonly backdropBlurSm: "var(--effect-backdrop-blur-sm)"; }; }` | no |
| `motion` | `{ readonly duration: { readonly fast: "var(--duration-fast)"; readonly normal: "var(--duration-normal)"; readonly slow: "var(--duration-slow)"; }; readonly transition: { readonly fast: "var(--transition-fast)"; readonly normal: "var(--transition-normal)"; readonly slow: "var(--transition-slow)"; }; }` | no |
| `radius` | `{ readonly xs: "var(--radius-xs)"; readonly sm: "var(--radius-sm)"; readonly md: "var(--radius-md)"; readonly lg: "var(--radius-lg)"; readonly xl: "var(--radius-xl)"; readonly "2xl": "var(--radius-2xl)"; readonly full: "var(--radius-full)"; }` | no |
| `reader` | `{ readonly background: "var(--reader-bg)"; readonly foreground: "var(--reader-fg)"; readonly link: "var(--reader-link)"; readonly fontSize: "var(--reader-font-size)"; readonly lineHeight: "var(--reader-line-height)"; readonly marginX: "var(--reader-margin-x)"; readonly marginY: "var(--reader-margin-y)"; readonly brightness: "var(--reader-brightness)"; readonly zoom: "var(--reader-zoom)"; }` | no |
| `shadow` | `{ readonly xs: "var(--shadow-xs)"; readonly sm: "var(--shadow-sm)"; readonly md: "var(--shadow-md)"; readonly lg: "var(--shadow-lg)"; }` | no |
| `spacing` | `{ readonly xxs: "var(--spacing-xxs)"; readonly xs: "var(--spacing-xs)"; readonly sm: "var(--spacing-sm)"; readonly md: "var(--spacing-md)"; readonly lg: "var(--spacing-lg)"; readonly xl: "var(--spacing-xl)"; readonly "2xl": "var(--spacing-2xl)"; readonly "3xl": "var(--spacing-3xl)"; readonly "4xl": "var(--spacing-4xl)"; }` | no |
| `typography` | `{ readonly family: { readonly sans: "var(--font-sans)"; readonly serif: "var(--font-serif)"; readonly mono: "var(--font-mono)"; readonly display: "var(--font-playfair)"; readonly readerSerif: "var(--font-merriweather)"; }; readonly size: { readonly "4xs": "var(--font-size-4xs)"; readonly "3xs": "var(--font-size-3xs)"; readonly "2xs": "var(--font-size-2xs)"; readonly caption: "var(--font-size-caption)"; readonly xs: "var(--font-size-xs)"; readonly sm: "var(--font-size-sm)"; readonly md: "var(--font-size-md)"; readonly lg: "var(--font-size-lg)"; readonly xl: "var(--font-size-xl)"; readonly "2xl": "var(--font-size-2xl)"; readonly "3xl": "var(--font-size-3xl)"; readonly "4xl": "var(--font-size-4xl)"; readonly "5xl": "var(--font-size-5xl)"; }; readonly lineHeight: { readonly tight: "var(--line-height-tight)"; readonly snug: "var(--line-height-snug)"; readonly normal: "var(--line-height-normal)"; readonly relaxed: "var(--line-height-relaxed)"; readonly loose: "var(--line-height-loose)"; }; readonly weight: { readonly regular: "var(--font-weight-regular)"; readonly medium: "var(--font-weight-medium)"; readonly semibold: "var(--font-weight-semibold)"; readonly bold: "var(--font-weight-bold)"; readonly black: "var(--font-weight-black)"; }; readonly letterSpacing: { readonly tight: "var(--letter-spacing-tight)"; readonly normal: "var(--letter-spacing-normal)"; readonly wide: "var(--letter-spacing-wide)"; readonly wider: "var(--letter-spacing-wider)"; }; }` | no |
| `zIndex` | `{ readonly backdrop: "var(--z-backdrop)"; readonly dropdown: "var(--z-dropdown)"; readonly sticky: "var(--z-sticky)"; readonly modal: "var(--z-modal)"; readonly popover: "var(--z-popover)"; readonly tooltip: "var(--z-tooltip)"; }` | no |

### Interface `DictionaryLookupInput`

- Type: `DictionaryLookupInput`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `installedDictionaryIds` | `string[] | undefined` | yes |
| `language` | `string | undefined` | yes |
| `mode` | `DictionaryMode` | no |
| `term` | `string` | no |

### Interface `DictionaryLookupResult`

- Type: `DictionaryLookupResult`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `audioUrl` | `string | undefined` | yes |
| `language` | `string` | no |
| `meanings` | `VocabularyMeaning[]` | no |
| `normalizedTerm` | `string` | no |
| `phonetic` | `string | undefined` | yes |
| `providersUsed` | `DictionaryProvider[]` | no |
| `term` | `string` | no |

### Type `DictionaryMode`

- Type: `DictionaryMode`

**Fields**

_No object fields detected._

### Type `DictionaryProvider`

- Type: `DictionaryProvider`

**Fields**

_No object fields detected._

### Interface `DocLocation`

- Type: `DocLocation`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `cfi` | `string` | no |
| `pageInfo` | `{ currentPage: number; endPage?: number; totalPages: number; range?: string; isEstimated?: boolean; } | undefined` | yes |
| `pageItem` | `{ label: string; } | undefined` | yes |
| `percentage` | `number` | no |
| `tocItem` | `{ label: string; href: string; } | undefined` | yes |

### Interface `DocMetadata`

- Type: `DocMetadata`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `author` | `string` | no |
| `cover` | `string | undefined` | yes |
| `description` | `string | undefined` | yes |
| `identifier` | `string | undefined` | yes |
| `language` | `string | undefined` | yes |
| `pubdate` | `string | undefined` | yes |
| `publisher` | `string | undefined` | yes |
| `title` | `string` | no |

### Interface `ExtractedMetadata`

Extracted metadata from a book file

- Type: `ExtractedMetadata`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `author` | `string` | no |
| `coverDataUrl` | `string | null | undefined` | yes |
| `description` | `string | undefined` | yes |
| `identifier` | `string | undefined` | yes |
| `language` | `string | undefined` | yes |
| `publishedDate` | `string | undefined` | yes |
| `publisher` | `string | undefined` | yes |
| `title` | `string` | no |

### Type `FontFamily`

- Type: `FontFamily`

**Fields**

_No object fields detected._

### Type `HighlightColor`

- Type: `HighlightColor`

**Fields**

_No object fields detected._

### Interface `HighlightColorToken`

- Type: `HighlightColorToken`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `label` | `string` | no |
| `picker` | `string` | no |
| `pickerActive` | `string` | no |
| `soft` | `string` | no |
| `softDark` | `string` | no |
| `solid` | `string` | no |

### Interface `InstalledDictionary`

- Type: `InstalledDictionary`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `format` | `"stardict"` | no |
| `id` | `string` | no |
| `importedAt` | `Date` | no |
| `language` | `string` | no |
| `name` | `string` | no |
| `sizeBytes` | `number` | no |

### Interface `LearningReviewRecord`

- Type: `LearningReviewRecord`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `createdAt` | `Date` | no |
| `dueAt` | `Date` | no |
| `id` | `string` | no |
| `lapseCount` | `number` | no |
| `lastReviewedAt` | `Date | undefined` | yes |
| `reviewCount` | `number` | no |
| `scheduler` | `LearningReviewSchedulerState` | no |
| `sourceId` | `string` | no |
| `sourceType` | `ReviewSourceType` | no |
| `suspended` | `boolean` | no |
| `updatedAt` | `Date | undefined` | yes |

### Interface `LearningReviewSchedulerState`

- Type: `LearningReviewSchedulerState`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `difficulty` | `number` | no |
| `due` | `Date` | no |
| `elapsed_days` | `number` | no |
| `lapses` | `number` | no |
| `last_review` | `Date | undefined` | yes |
| `learning_steps` | `number` | no |
| `reps` | `number` | no |
| `scheduled_days` | `number` | no |
| `stability` | `number` | no |
| `state` | `number` | no |

### Interface `LearningSettings`

- Type: `LearningSettings`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `dailyReviewGoal` | `number` | no |
| `dailyReviewTime` | `string` | no |
| `defaultReminderReviewScope` | `ReviewLaunchScope` | no |
| `dictionaryMode` | `DictionaryMode` | no |
| `inAppReminder` | `boolean` | no |
| `playPronunciationAudio` | `boolean` | no |
| `preferredProviders` | `DictionaryProvider[]` | no |
| `reviewHighlightEnabled` | `boolean` | no |
| `reviewVocabularyEnabled` | `boolean` | no |
| `showPronunciation` | `boolean` | no |
| `vocabularyEnabled` | `boolean` | no |

### Type `LibrarySortBy`

- Type: `LibrarySortBy`

**Fields**

_No object fields detected._

### Type `LibrarySortOrder`

- Type: `LibrarySortOrder`

**Fields**

_No object fields detected._

### Type `LibraryViewMode`

- Type: `LibraryViewMode`

**Fields**

_No object fields detected._

### Type `PageAnimation`

- Type: `PageAnimation`

**Fields**

_No object fields detected._

### Type `PageLayout`

- Type: `PageLayout`

**Fields**

_No object fields detected._

### Interface `PdfViewState`

- Type: `PdfViewState`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `page` | `number` | no |
| `totalPages` | `number` | no |
| `zoom` | `number` | no |
| `zoomMode` | `PdfZoomMode` | no |

### Type `PdfZoomMode`

- Type: `PdfZoomMode`

**Fields**

_No object fields detected._

### Interface `RankByFuzzyQueryOptions`

- Type: `RankByFuzzyQueryOptions<T>`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `ignoreLocation` | `boolean | undefined` | yes |
| `keys` | `FuseOptionKey<T>[]` | no |
| `limit` | `number | undefined` | yes |
| `minMatchCharLength` | `number | undefined` | yes |
| `threshold` | `number | undefined` | yes |

### Interface `RankedFuzzyItem`

- Type: `RankedFuzzyItem<T>`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `item` | `T` | no |
| `score` | `number` | no |

### Interface `ReaderSettings`

- Type: `ReaderSettings`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `autoHideDelay` | `number` | no |
| `brightness` | `number` | no |
| `enableAnimations` | `boolean` | no |
| `flow` | `ReadingFlow` | no |
| `fontFamily` | `FontFamily` | no |
| `fontSize` | `number` | no |
| `forcePublisherStyles` | `boolean` | no |
| `fullscreen` | `boolean` | no |
| `hyphenation` | `boolean` | no |
| `layout` | `PageLayout` | no |
| `letterSpacing` | `number` | no |
| `lineHeight` | `number` | no |
| `margins` | `number` | no |
| `pageAnimation` | `PageAnimation` | no |
| `paragraphSpacing` | `number` | no |
| `prefetchDistance` | `number` | no |
| `textAlign` | `"left" | "justify" | "center"` | no |
| `theme` | `ReaderTheme` | no |
| `toolbarAutoHide` | `boolean` | no |
| `virtualScrolling` | `boolean` | no |
| `wordSpacing` | `number` | no |
| `zoom` | `number` | no |

### Type `ReaderTheme`

- Type: `ReaderTheme`

**Fields**

_No object fields detected._

### Interface `ReaderThemeSettings`

- Type: `ThemeSettings`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `backgroundColor` | `string | undefined` | yes |
| `flow` | `ReadingFlow | undefined` | yes |
| `fontFamily` | `string | undefined` | yes |
| `fontSize` | `number | undefined` | yes |
| `forcePublisherStyles` | `boolean | undefined` | yes |
| `hyphenation` | `boolean | undefined` | yes |
| `layout` | `PageLayout | undefined` | yes |
| `letterSpacing` | `number | undefined` | yes |
| `lineHeight` | `number | undefined` | yes |
| `linkColor` | `string | undefined` | yes |
| `margins` | `number | undefined` | yes |
| `paragraphSpacing` | `number | undefined` | yes |
| `textAlign` | `"left" | "justify" | "center" | undefined` | yes |
| `textColor` | `string | undefined` | yes |
| `wordSpacing` | `number | undefined` | yes |
| `zoom` | `number | undefined` | yes |

### Type `ReadingFlow`

- Type: `ReadingFlow`

**Fields**

_No object fields detected._

### Interface `ReadingProgress`

- Type: `ReadingProgress`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `bookId` | `string` | no |
| `lastUpdated` | `Date` | no |
| `location` | `string` | no |
| `pagesRead` | `number` | no |
| `percentage` | `number` | no |
| `readingTime` | `number` | no |

### Interface `ReadingStats`

- Type: `ReadingStats`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `averageReadingSpeed` | `number` | no |
| `booksCompleted` | `number` | no |
| `booksReadThisYear` | `number` | no |
| `currentStreak` | `number` | no |
| `dailyActivity` | `DailyReadingActivity[]` | no |
| `dailyGoal` | `number` | no |
| `lastReadDate` | `string | undefined` | yes |
| `longestStreak` | `number` | no |
| `totalReadingTime` | `number` | no |
| `yearlyBookGoal` | `number` | no |

### Interface `ReviewEvent`

- Type: `ReviewEvent`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `dueAfter` | `Date` | no |
| `dueBefore` | `Date` | no |
| `grade` | `ReviewGrade` | no |
| `id` | `string` | no |
| `nextState` | `number` | no |
| `reviewedAt` | `Date` | no |
| `sourceId` | `string` | no |
| `sourceState` | `number` | no |
| `sourceType` | `ReviewSourceType` | no |

### Type `ReviewGrade`

- Type: `ReviewGrade`

**Fields**

_No object fields detected._

### Type `ReviewLaunchScope`

- Type: `ReviewLaunchScope`

**Fields**

_No object fields detected._

### Type `ReviewSourceType`

- Type: `ReviewSourceType`

**Fields**

_No object fields detected._

### Interface `SchedulerReviewResult`

- Type: `SchedulerReviewResult`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `dueAt` | `Date` | no |
| `nextState` | `number` | no |
| `scheduler` | `LearningReviewSchedulerState` | no |
| `sourceState` | `number` | no |

### Type `SearchDomain`

- Type: `SearchDomain`

**Fields**

_No object fields detected._

### Type `SearchPlacement`

- Type: `SearchPlacement`

**Fields**

_No object fields detected._

### Interface `SearchResult`

- Type: `SearchResult`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `cfi` | `string` | no |
| `excerpt` | `string` | no |

### Interface `ShelfColorToken`

- Type: `ShelfColorToken`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `bg` | `string` | no |
| `border` | `string` | no |
| `dotClass` | `string` | no |
| `icon` | `string` | no |
| `text` | `string` | no |

### Interface `ThemeSemanticPalette`

- Type: `ThemeSemanticPalette`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `appAccent` | `string` | no |
| `appAccentContrast` | `string` | no |
| `appAccentHover` | `string` | no |
| `appAccentLight` | `string` | no |
| `appBg` | `string` | no |
| `appBorder` | `string` | no |
| `appBorderSubtle` | `string` | no |
| `appError` | `string` | no |
| `appInfo` | `string` | no |
| `appOverlayMedium` | `string` | no |
| `appOverlayStrong` | `string` | no |
| `appOverlayStrongHover` | `string` | no |
| `appOverlaySubtle` | `string` | no |
| `appSuccess` | `string` | no |
| `appSurface` | `string` | no |
| `appSurfaceElevated` | `string` | no |
| `appSurfaceHover` | `string` | no |
| `appSurfaceMuted` | `string` | no |
| `appSurfaceVariant` | `string` | no |
| `appTextInverse` | `string` | no |
| `appTextMuted` | `string` | no |
| `appTextPrimary` | `string` | no |
| `appTextSecondary` | `string` | no |
| `appWarning` | `string` | no |
| `readerBg` | `string` | no |
| `readerFg` | `string` | no |
| `readerLink` | `string` | no |

### Interface `ThemeSettings`

- Type: `ThemeSettings`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `backgroundColor` | `string | undefined` | yes |
| `flow` | `ReadingFlow | undefined` | yes |
| `fontFamily` | `string | undefined` | yes |
| `fontSize` | `number | undefined` | yes |
| `forcePublisherStyles` | `boolean | undefined` | yes |
| `hyphenation` | `boolean | undefined` | yes |
| `layout` | `PageLayout | undefined` | yes |
| `letterSpacing` | `number | undefined` | yes |
| `lineHeight` | `number | undefined` | yes |
| `linkColor` | `string | undefined` | yes |
| `margins` | `number | undefined` | yes |
| `paragraphSpacing` | `number | undefined` | yes |
| `textAlign` | `"left" | "justify" | "center" | undefined` | yes |
| `textColor` | `string | undefined` | yes |
| `wordSpacing` | `number | undefined` | yes |
| `zoom` | `number | undefined` | yes |

### Interface `TocItem`

- Type: `TocItem`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `href` | `string` | no |
| `label` | `string` | no |
| `subitems` | `TocItem[] | undefined` | yes |

### Interface `UIState`

- Type: `UIState`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `currentBookId` | `string | undefined` | yes |
| `currentRoute` | `AppRoute` | no |
| `error` | `string | undefined` | yes |
| `isLoading` | `boolean` | no |
| `loadingMessage` | `string | undefined` | yes |
| `readerToolbarVisible` | `boolean` | no |
| `searchQuery` | `string` | no |
| `selectedBooks` | `string[]` | no |
| `sidebarOpen` | `boolean` | no |

### Interface `VocabularyContext`

- Type: `VocabularyContext`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `firstSeenAt` | `Date` | no |
| `key` | `string` | no |
| `label` | `string` | no |
| `lastSeenAt` | `Date` | no |
| `occurrences` | `number` | no |
| `sourceId` | `string` | no |
| `sourceType` | `VocabularyContextSourceType` | no |

### Type `VocabularyContextSourceType`

- Type: `VocabularyContextSourceType`

**Fields**

_No object fields detected._

### Interface `VocabularyMeaning`

- Type: `VocabularyMeaning`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `antonyms` | `string[] | undefined` | yes |
| `definitions` | `string[]` | no |
| `examples` | `string[] | undefined` | yes |
| `partOfSpeech` | `string | undefined` | yes |
| `provider` | `DictionaryProvider` | no |
| `synonyms` | `string[] | undefined` | yes |

### Interface `VocabularyTerm`

- Type: `VocabularyTerm`

**Fields**

| Property | Type | Optional |
| --- | --- | --- |
| `audioUrl` | `string | undefined` | yes |
| `contexts` | `VocabularyContext[]` | no |
| `createdAt` | `Date` | no |
| `id` | `string` | no |
| `language` | `string` | no |
| `lastReviewedAt` | `Date | undefined` | yes |
| `lookupCount` | `number` | no |
| `meanings` | `VocabularyMeaning[]` | no |
| `normalizedTerm` | `string` | no |
| `personalNote` | `string | undefined` | yes |
| `phonetic` | `string | undefined` | yes |
| `providerHistory` | `DictionaryProvider[]` | no |
| `tags` | `string[]` | no |
| `term` | `string` | no |
| `updatedAt` | `Date | undefined` | yes |

## Validation

- `pnpm --filter @theorem/core typecheck`
- `pnpm build`

_Generated by `scripts/generate-module-docs.mjs`._

