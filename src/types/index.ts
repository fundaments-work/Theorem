/**
 * Lion Reader Type Definitions
 */

// Book Format Types
export type BookFormat = "epub" | "pdf" | "mobi" | "fb2" | "cbz";

// Highlight Colors - single source of truth
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red' | 'orange' | 'purple';

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
    yellow: 'rgba(255, 235, 59, 0.4)',
    green: 'rgba(76, 175, 80, 0.4)',
    blue: 'rgba(33, 150, 243, 0.4)',
    red: 'rgba(244, 67, 54, 0.4)',
    orange: 'rgba(255, 152, 0, 0.4)',
    purple: 'rgba(156, 39, 176, 0.4)',
};

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
    currentLocation?: string; // CFI for EPUB, page number for PDF
    category?: string;
    tags: string[];
    rating?: number; // 1-5
    isFavorite: boolean;
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
    location: string; // CFI or page reference
    selectedText?: string;
    noteContent?: string;
    color?: HighlightColor;
    createdAt: Date;
    updatedAt?: Date;
}

// Collection Types
export interface Collection {
    id: string;
    name: string;
    description?: string;
    bookIds: string[];
    createdAt: Date;
    isSmartCollection: boolean;
    smartFilter?: SmartFilter;
}

export interface SmartFilter {
    type: "recentlyAdded" | "currentlyReading" | "completed" | "abandoned";
    daysThreshold?: number;
}

// Reader Settings
export type ReaderTheme = "light" | "sepia" | "dark";
export type FontFamily = "original" | "serif" | "sans" | "mono";
export type ReadingFlow = "paged" | "scroll" | "auto";
export type PageLayout = "single" | "double";
export type PageAnimation = "slide" | "fade" | "instant";

export interface ReaderSettings {
    theme: ReaderTheme;
    fontFamily: FontFamily;
    fontSize: number; // 12-32
    lineHeight: number; // 1.2-2.0
    letterSpacing: number; // -0.05 to 0.2
    paragraphSpacing: number; // 0-2
    textAlign: "left" | "justify";
    hyphenation: boolean;
    margins: number; // percentage 0-25
    flow: ReadingFlow;
    layout: PageLayout;
    brightness: number; // 0-100
    fullscreen: boolean;
    pageAnimation: PageAnimation;
    toolbarAutoHide: boolean;
    autoHideDelay: number; // seconds
    // Performance settings
    prefetchDistance: number; // Number of sections to prefetch (1-3)
    enableAnimations: boolean;
    virtualScrolling: boolean; // For very long documents
}

// App Settings
export interface AppSettings {
    sidebarCollapsed: boolean;
    libraryViewMode: "grid" | "list" | "compact";
    librarySortBy: "title" | "author" | "dateAdded" | "lastRead" | "progress" | "rating";
    librarySortOrder: "asc" | "desc";
    scanFolders: string[];
    cacheSize: number; // MB
    readerSettings: ReaderSettings;
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
}

// Navigation
export type AppRoute = "library" | "reader" | "settings" | "bookDetails" | "annotations" | "statistics" | "shelves" | "bookmarks" | "profile";

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

export interface ThemeSettings {
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    textColor?: string;
    backgroundColor?: string;
    linkColor?: string;
    flow?: ReadingFlow;
    layout?: PageLayout;
    margins?: number;
}
