/**
 * Theorem Type Definitions
 */

// Book format types used in library metadata.
// Note: "cbr" is kept for backward compatibility with previously imported entries.
export type BookFormat = "epub" | "mobi" | "azw" | "azw3" | "fb2" | "cbz" | "cbr" | "pdf";

// Format categories for UI behavior
export const FIXED_LAYOUT_FORMATS: BookFormat[] = ["cbz", "cbr", "pdf"];
export const REFLOWABLE_FORMATS: BookFormat[] = ["epub", "mobi", "azw", "azw3", "fb2"];

// Helper to check if format has fixed layout (no font/size controls, uses zoom instead)
export const isFixedLayout = (format: BookFormat): boolean =>
    FIXED_LAYOUT_FORMATS.includes(format);

// Helper to check if format is reflowable (supports font/size controls)
export const isReflowable = (format: BookFormat): boolean =>
    REFLOWABLE_FORMATS.includes(format);

// Format display names
export const FORMAT_DISPLAY_NAMES: Record<BookFormat, string> = {
    epub: 'EPUB',
    mobi: 'MOBI',
    azw: 'AZW',
    azw3: 'AZW3',
    fb2: 'FB2',
    cbz: 'CBZ',
    cbr: 'CBR',
    pdf: 'PDF',
};

// Format icons or colors could be added here
export const FORMAT_COLORS: Record<BookFormat, string> = {
    epub: "#111111",
    mobi: "#2b2b2b",
    azw: "#2b2b2b",
    azw3: "#2b2b2b",
    fb2: "#454545",
    cbz: "#5f5f5f",
    cbr: "#5f5f5f",
    pdf: "#7a7a7a",
};

// Highlight Colors - single source of truth
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'orange' | 'purple';

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
    yellow: "rgba(17, 17, 17, 0.28)",
    green: "rgba(43, 43, 43, 0.24)",
    blue: "rgba(69, 69, 69, 0.22)",
    red: "rgba(95, 95, 95, 0.2)",
    orange: "rgba(122, 122, 122, 0.18)",
    purple: "rgba(148, 148, 148, 0.16)",
};

export type PdfZoomMode = "custom" | "page-fit" | "width-fit";

export interface PdfViewState {
    page: number;
    totalPages: number;
    zoom: number;
    zoomMode: PdfZoomMode;
}

// Book Entity
export interface Book {
    id: string;
    title: string;
    author: string;
    filePath: string;
    storagePath?: string; // Internal storage path for Tauri
    format: BookFormat;
    coverPath?: string;
    description?: string;
    publisher?: string;
    publishedDate?: string;
    language?: string;
    isbn?: string;
    fileSize: number;
    addedAt: Date;
    lastReadAt?: Date;
    progress: number; // 0-1
    currentLocation?: string; // EPUB CFI
    lastClickFraction?: number; // 0-1 - last position clicked on progress bar for visual consistency
    // Page-based progress (stored for instant correct display on reopen)
    pageProgress?: {
        currentPage: number;
        endPage?: number;
        totalPages: number;
        range: string;
    };
    pdfViewState?: PdfViewState;
    locations?: string; // Serialized locations JSON string
    category?: string;
    tags: string[];
    rating?: number; // 1-5
    isFavorite: boolean;
    // Explicit user override for read status.
    // "read"/"unread" takes precedence over automatic completion derived from progress.
    manualCompletionState?: "read" | "unread";
    // Snapshot of progress before the latest finished state, restored on "unfinish".
    progressBeforeFinish?: number;
    // Statistics
    readingTime: number; // in minutes
    completedAt?: Date; // When the book was marked completed (auto or manual)
}

// Reading Progress
export interface ReadingProgress {
    bookId: string;
    location: string;
    percentage: number;
    lastUpdated: Date;
    readingTime: number; // in minutes
    pagesRead: number;
}

// Annotation Types
export interface Annotation {
    id: string;
    bookId: string;
    type: "highlight" | "note" | "bookmark";
    location: string;
    selectedText?: string;
    noteContent?: string;
    color?: HighlightColor;
    createdAt: Date;
    updatedAt?: Date;
    // PDF-specific
    pageNumber?: number;
    pdfAnnotationType?: 'highlight' | 'drawing' | 'textNote';
    drawingData?: string;
    textNoteContent?: string;
    rect?: { x: number; y: number; width: number; height: number };
    rects?: Array<{ x: number; y: number; width: number; height: number }>;
    strokeWidth?: number;
}

// Collection Types
export interface Collection {
    id: string;
    name: string;
    description?: string;
    bookIds: string[];
    createdAt: Date;
}

// Reader Settings
export type ReaderTheme = "light" | "sepia" | "dark";
export type FontFamily = "original" | "serif" | "sans" | "mono";
export type ReadingFlow = "paged" | "scroll" | "auto";
export type PageLayout = "single" | "double" | "auto";
export type PageAnimation = "slide" | "fade" | "instant";

export interface ReaderSettings {
    theme: ReaderTheme;
    fontFamily: FontFamily;
    fontSize: number; // 12-36
    lineHeight: number; // 1.0-2.5
    letterSpacing: number; // -0.05 to 0.2
    paragraphSpacing: number; // 0-2
    textAlign: "left" | "justify" | "center";
    hyphenation: boolean;
    margins: number; // percentage 0-35
    flow: ReadingFlow;
    layout: PageLayout;
    brightness: number; // 0-100
    fullscreen: boolean;
    pageAnimation: PageAnimation;
    toolbarAutoHide: boolean;
    autoHideDelay: number; // seconds
    zoom: number; // 50-200, percentage
    wordSpacing: number; // 0-0.5em
    forcePublisherStyles: boolean; // Override book's CSS
    // Performance settings
    prefetchDistance: number; // Number of sections to prefetch (1-3)
    enableAnimations: boolean;
    virtualScrolling: boolean; // For very long documents
}

// Library Settings Types
export type LibraryViewMode = "grid" | "list" | "compact";
export type LibrarySortBy = "title" | "author" | "dateAdded" | "lastRead" | "progress" | "rating";
export type LibrarySortOrder = "asc" | "desc";

// App Settings
export interface AppSettings {
    sidebarCollapsed: boolean;
    libraryViewMode: LibraryViewMode;
    librarySortBy: LibrarySortBy;
    librarySortOrder: LibrarySortOrder;
    scanFolders: string[];
    cacheSize: number; // MB
    theme: "light" | "dark" | "system";
    readerSettings: ReaderSettings;
    learning: LearningSettings;
}

export type DictionaryMode = "online" | "offline" | "auto";

export type DictionaryProvider = "free_dictionary_api" | "wiktionary" | "stardict";

export interface LearningSettings {
    vocabularyEnabled: boolean;
    reviewVocabularyEnabled: boolean;
    reviewHighlightEnabled: boolean;
    defaultReminderReviewScope: ReviewLaunchScope;
    dictionaryMode: DictionaryMode;
    preferredProviders: DictionaryProvider[];
    dailyReviewTime: string; // HH:mm
    dailyReviewGoal: number;
    inAppReminder: boolean;
    showPronunciation: boolean;
    playPronunciationAudio: boolean;
}

export interface VocabularyMeaning {
    partOfSpeech?: string;
    definitions: string[];
    examples?: string[];
    synonyms?: string[];
    antonyms?: string[];
    provider: DictionaryProvider;
}

export type VocabularyContextSourceType = "book" | "site" | "legacy";

export interface VocabularyContext {
    key: string;
    sourceType: VocabularyContextSourceType;
    sourceId: string;
    label: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
    occurrences: number;
}

export interface VocabularyTerm {
    id: string;
    term: string;
    normalizedTerm: string;
    language: string;
    phonetic?: string;
    audioUrl?: string;
    meanings: VocabularyMeaning[];
    providerHistory: DictionaryProvider[];
    lookupCount: number;
    personalNote?: string;
    tags: string[];
    contexts: VocabularyContext[];
    createdAt: Date;
    updatedAt?: Date;
    lastReviewedAt?: Date;
}

export type ReviewSourceType = "vocabulary" | "highlight";
export type ReviewLaunchScope = "all" | "vocabulary" | "highlight";

export interface LearningReviewSchedulerState {
    due: Date;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    learning_steps: number;
    reps: number;
    lapses: number;
    state: number;
    last_review?: Date;
}

export interface LearningReviewRecord {
    id: string;
    sourceType: ReviewSourceType;
    sourceId: string;
    suspended: boolean;
    scheduler: LearningReviewSchedulerState;
    dueAt: Date;
    createdAt: Date;
    updatedAt?: Date;
    lastReviewedAt?: Date;
    reviewCount: number;
    lapseCount: number;
}

export interface DailyReviewItem {
    id: string;
    sourceType: ReviewSourceType;
    sourceId: string;
    front: string;
    back: string;
    dueAt: Date;
    createdAt: Date;
    suspended: boolean;
    reviewCount: number;
    lapseCount: number;
}

export type ReviewGrade = "again" | "hard" | "good" | "easy";

export interface ReviewEvent {
    id: string;
    sourceType: ReviewSourceType;
    sourceId: string;
    grade: ReviewGrade;
    reviewedAt: Date;
    dueBefore: Date;
    dueAfter: Date;
    sourceState: number;
    nextState: number;
}

export interface InstalledDictionary {
    id: string;
    name: string;
    language: string;
    format: "stardict";
    sizeBytes: number;
    importedAt: Date;
}

export interface DailyReminderState {
    isPromptVisible: boolean;
    lastPromptDate?: string; // ISO date YYYY-MM-DD
    dismissedDate?: string; // ISO date YYYY-MM-DD
    completedDate?: string; // ISO date YYYY-MM-DD
}

// Daily reading activity entry
export interface DailyReadingActivity {
    date: string; // ISO date string YYYY-MM-DD
    minutes: number;
    booksRead: string[]; // book IDs read that day
}

// Reading Statistics
export interface ReadingStats {
    totalReadingTime: number; // minutes
    booksCompleted: number;
    averageReadingSpeed: number; // words per minute
    currentStreak: number; // days
    longestStreak: number; // days
    dailyGoal: number; // minutes
    yearlyBookGoal: number;
    booksReadThisYear: number;
    dailyActivity: DailyReadingActivity[]; // Last 84 days (12 weeks) for heatmap
    lastReadDate?: string; // ISO date of last reading session
}

// Navigation
export type AppRoute = "library" | "reader" | "vocabulary" | "settings" | "bookDetails" | "annotations" | "statistics" | "shelves" | "bookmarks";

// UI State
export interface UIState {
    currentRoute: AppRoute;
    currentBookId?: string;
    sidebarOpen: boolean;
    readerToolbarVisible: boolean;
    searchQuery: string;
    selectedBooks: string[];
    isLoading: boolean;
    loadingMessage?: string;
    error?: string;
}

// Document Engine Types
export interface DocLocation {
    cfi: string;
    percentage: number;
    tocItem?: {
        label: string;
        href: string;
    };
    pageItem?: {
        label: string;
    };
    // Page-based location for accurate progress display
    pageInfo?: {
        currentPage: number;      // First visible page number
        endPage?: number;         // Last visible page number (for spread view)
        totalPages: number;       // Total pages in book
        range?: string;           // Formatted range like "5-6"
        isEstimated?: boolean;    // True if using byte-based estimation (not exact locations)
    };
}

export interface TocItem {
    label: string;
    href: string;
    subitems?: TocItem[];
}

export interface DocMetadata {
    title: string;
    author: string;
    description?: string;
    publisher?: string;
    language?: string;
    pubdate?: string;
    identifier?: string;
    cover?: string;
}

export interface SearchResult {
    cfi: string;
    excerpt: string;
}

// Book Section for progress bar
export interface BookSection {
    label: string;
    href: string;
    fraction: number; // 0-1 position in book
    index: number;
}

export interface ThemeSettings {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    letterSpacing?: number;
    wordSpacing?: number;
    paragraphSpacing?: number;
    textAlign?: "left" | "justify" | "center";
    textColor?: string;
    backgroundColor?: string;
    linkColor?: string;
    flow?: ReadingFlow;
    layout?: PageLayout;
    margins?: number;
    zoom?: number;
    hyphenation?: boolean;
    forcePublisherStyles?: boolean;
}

// Re-export for backward compatibility
export type { ThemeSettings as ReaderThemeSettings };
