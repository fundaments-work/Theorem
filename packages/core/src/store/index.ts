import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeCardTextForDisplay } from "../lib/learning-card-text";
import { applyReaderStyles, initReaderStyles } from "../lib/reader-styles";
import {
    lookupDictionaryTerm,
    vocabularyTermFromLookup,
    type DictionaryLookupResult,
} from "../services/DictionaryService";
import {
    importStarDictDictionary,
    removeStarDictDictionary,
} from "../services/StarDictService";
import {
    createInitialReviewSchedulerState,
    normalizeReviewSchedulerState,
    reviewItemSchedulerState,
} from "../services/LearningSchedulerService";
import type {
    Annotation,
    AppRoute,
    AppSettings,
    Book,
    Collection,
    DailyReviewItem,
    DailyReminderState,
    HighlightColor,
    InstalledDictionary,
    LearningReviewRecord,
    LearningSettings,
    PdfViewState,
    ReaderSettings,
    ReadingStats,
    ReviewEvent,
    ReviewLaunchScope,
    ReviewSourceType,
    ReviewGrade,
    UIState,
    VocabularyContext,
    VocabularyContextSourceType,
    VocabularyTerm,
} from "../types";

// Default reader settings - optimized for performance
const defaultReaderSettings: ReaderSettings = {
    theme: "light",
    fontFamily: "original",
    fontSize: 18,
    lineHeight: 1.6,
    letterSpacing: 0,
    paragraphSpacing: 1,
    textAlign: "left",
    hyphenation: false,
    margins: 10,
    flow: "paged",
    layout: "auto", // Auto-detect based on viewport
    brightness: 100,
    fullscreen: false,
    pageAnimation: "slide",
    toolbarAutoHide: false,
    autoHideDelay: 5,
    zoom: 100,
    wordSpacing: 0,
    forcePublisherStyles: false,
    // Performance settings
    prefetchDistance: 1,
    enableAnimations: false,
    virtualScrolling: false,
};

// Default app settings
const defaultLearningSettings: LearningSettings = {
    vocabularyEnabled: true,
    reviewVocabularyEnabled: true,
    reviewHighlightEnabled: true,
    defaultReminderReviewScope: "all",
    dictionaryMode: "auto",
    preferredProviders: ["free_dictionary_api", "wiktionary", "stardict"],
    dailyReviewTime: "09:00",
    dailyReviewGoal: 20,
    inAppReminder: true,
    showPronunciation: true,
    playPronunciationAudio: false,
};

// Default app settings
const defaultAppSettings: AppSettings = {
    sidebarCollapsed: false,
    libraryViewMode: "grid",
    librarySortBy: "lastRead",
    librarySortOrder: "desc",
    scanFolders: [],
    cacheSize: 500, // MB
    theme: "system",
    readerSettings: defaultReaderSettings,
    learning: defaultLearningSettings,
};

// Default reading stats
const defaultReadingStats: ReadingStats = {
    totalReadingTime: 0,
    booksCompleted: 0,
    averageReadingSpeed: 200,
    currentStreak: 0,
    longestStreak: 0,
    dailyGoal: 30,
    yearlyBookGoal: 24,
    booksReadThisYear: 0,
    dailyActivity: [],
};

// UI State Store
interface UIStore extends UIState {
    setRoute: (route: AppRoute, bookId?: string) => void;
    toggleSidebar: () => void;
    setSearchQuery: (query: string) => void;
    setSelectedBooks: (bookIds: string[]) => void;
    toggleBookSelection: (bookId: string) => void;
    clearSelection: () => void;
    setLoading: (loading: boolean, message?: string) => void;
    setError: (error?: string) => void;
    // Reader-specific UI
    setReaderToolbarVisible: (visible: boolean) => void;
    toggleReaderToolbar: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
    currentRoute: "library",
    currentBookId: undefined,
    sidebarOpen: true,
    readerToolbarVisible: true,
    searchQuery: "",
    selectedBooks: [],
    isLoading: false,
    loadingMessage: undefined,
    error: undefined,

    setRoute: (route, bookId) =>
        set({
            currentRoute: route,
            currentBookId: bookId,
            searchQuery: "",
        }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setSelectedBooks: (bookIds) => set({ selectedBooks: bookIds }),
    toggleBookSelection: (bookId) =>
        set((state) => ({
            selectedBooks: state.selectedBooks.includes(bookId)
                ? state.selectedBooks.filter((id) => id !== bookId)
                : [...state.selectedBooks, bookId],
        })),
    clearSelection: () => set({ selectedBooks: [] }),
    setLoading: (loading, message) =>
        set({ isLoading: loading, loadingMessage: message }),
    setError: (error) => set({ error }),

    // Reader toolbar
    setReaderToolbarVisible: (visible) => set({ readerToolbarVisible: visible }),
    toggleReaderToolbar: () => set((state) => ({ readerToolbarVisible: !state.readerToolbarVisible })),
}));

// Recently opened books cache for fast access
interface CachedBookMetadata {
    id: string;
    title: string;
    author: string;
    coverPath?: string;
    currentLocation?: string;
    progress: number;
    lastClickFraction?: number;
    pageProgress?: {
        currentPage: number;
        endPage?: number;
        totalPages: number;
        range: string;
    };
    pdfViewState?: PdfViewState;
    lastReadAt: Date;
}

type CompletionUpdateSource = "auto" | "manual";

// Helper to create cache entry from book
const createCacheEntry = (book: Book): CachedBookMetadata => ({
    id: book.id,
    title: book.title,
    author: book.author,
    coverPath: book.coverPath,
    currentLocation: book.currentLocation,
    progress: book.progress,
    lastClickFraction: book.lastClickFraction,
    pageProgress: book.pageProgress,
    pdfViewState: book.pdfViewState,
    lastReadAt: book.lastReadAt || new Date(),
});

function updateBookById(
    books: Book[],
    bookId: string,
    updater: (book: Book) => Book,
): { books: Book[]; updatedBook: Book | null } {
    const index = books.findIndex((book) => book.id === bookId);
    if (index === -1) {
        return { books, updatedBook: null };
    }

    const currentBook = books[index];
    const nextBook = updater(currentBook);
    if (nextBook === currentBook) {
        return { books, updatedBook: currentBook };
    }

    const nextBooks = books.slice();
    nextBooks[index] = nextBook;
    return { books: nextBooks, updatedBook: nextBook };
}

const bookLookupCache = new WeakMap<Book[], Map<string, Book>>();
const cachedBookLookupCache = new WeakMap<CachedBookMetadata[], Map<string, CachedBookMetadata>>();

function getBookLookup(books: Book[]): Map<string, Book> {
    const existingLookup = bookLookupCache.get(books);
    if (existingLookup) {
        return existingLookup;
    }
    const nextLookup = new Map(books.map((book) => [book.id, book]));
    bookLookupCache.set(books, nextLookup);
    return nextLookup;
}

function getCachedBookLookup(cache: CachedBookMetadata[]): Map<string, CachedBookMetadata> {
    const existingLookup = cachedBookLookupCache.get(cache);
    if (existingLookup) {
        return existingLookup;
    }
    const nextLookup = new Map(cache.map((book) => [book.id, book]));
    cachedBookLookupCache.set(cache, nextLookup);
    return nextLookup;
}

function toIsoDateString(date: Date = new Date()): string {
    return date.toISOString().slice(0, 10);
}

function normalizeTermKey(term: string, language: string): string {
    return `${term.trim().toLowerCase()}::${language.trim().toLowerCase()}`;
}

// Library Store
interface LibraryStore {
    books: Book[];
    collections: Collection[];
    annotations: Annotation[];
    lastScannedAt?: Date;
    // Cache for quick access to recently opened books
    recentBooksCache: CachedBookMetadata[];
    // Currently active book for annotations
    currentBookId?: string;

    // Book actions
    addBook: (book: Book) => void;
    addBooks: (books: Book[]) => void;
    removeBook: (bookId: string) => void;
    updateBook: (bookId: string, updates: Partial<Book>) => void;
    updateProgress: (bookId: string, progress: number, location: string, lastClickFraction?: number, pageProgress?: { currentPage: number; endPage?: number; totalPages: number; range: string }) => void;
    updatePdfReadingState: (bookId: string, state: PdfViewState) => void;
    toggleFavorite: (bookId: string) => void;
    updateBookMetadata: (bookId: string, metadata: Partial<Book>) => void;
    saveBookLocations: (bookId: string, locations: string) => void;

    // Reading time tracking
    addReadingTime: (bookId: string, minutes: number) => void;

    // Book completion
    markBookCompleted: (
        bookId: string,
        source?: CompletionUpdateSource,
    ) => { wasAlreadyCompleted: boolean; completedYear: number } | null;
    markBookUnread: (bookId: string) => boolean;

    // Collection actions
    addCollection: (collection: Collection) => void;
    removeCollection: (collectionId: string) => void;
    updateCollection: (collectionId: string, updates: Partial<Omit<Collection, 'id'>>) => void;
    addBookToCollection: (bookId: string, collectionId: string) => void;
    removeBookFromCollection: (bookId: string, collectionId: string) => void;

    // Annotation actions
    addAnnotation: (annotation: Annotation) => void;
    addHighlightWithNote: (cfi: string, text: string, color: HighlightColor, note?: string) => Annotation;
    updateAnnotation: (annotationId: string, updates: Partial<Annotation>) => void;
    removeAnnotation: (annotationId: string) => void;
    getBookAnnotations: (bookId: string) => Annotation[];
    getHighlights: (bookId: string) => Annotation[];
    getBookmarks: (bookId: string) => Annotation[];
    exportAnnotationsToMarkdown: (bookId: string) => string;

    // Getters
    getBook: (bookId: string) => Book | undefined;
    getRecentBooks: (limit?: number) => Book[];
    getFavoriteBooks: () => Book[];
    getBooksByCategory: (category: string) => Book[];
    searchBooks: (query: string) => Book[];
    getCachedBook: (bookId: string) => CachedBookMetadata | undefined;

    // Scanning
    setLastScannedAt: (date: Date) => void;

    // Current book tracking
    setCurrentBookId: (bookId: string | undefined) => void;

}

export const useLibraryStore = create<LibraryStore>()(
    persist(
        (set, get) => ({
            books: [],
            collections: [],
            annotations: [],
            recentBooksCache: [],

            // Book actions
            addBook: (book) =>
                set((state) => ({ books: [...state.books, book] })),

            addBooks: (books) =>
                set((state) => ({ books: [...state.books, ...books] })),

            removeBook: (bookId) => {
                set((state) => ({
                    books: state.books.filter((b) => b.id !== bookId),
                    annotations: state.annotations.filter((a) => a.bookId !== bookId),
                    recentBooksCache: state.recentBooksCache.filter((b) => b.id !== bookId),
                    // Remove book from all collections to keep counts accurate
                    collections: state.collections.map((c) => ({
                        ...c,
                        bookIds: c.bookIds.filter((id) => id !== bookId),
                    })),
                }));
                useLearningStore.getState().syncReviewRecords();
            },

            updateBook: (bookId, updates) =>
                set((state) => {
                    const { books } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        ...updates,
                    }));
                    return { books };
                }),

            updateProgress: (bookId, progress, location, lastClickFraction, pageProgress) =>
                set((state) => {
                    const { books: updatedBooks, updatedBook } = updateBookById(
                        state.books,
                        bookId,
                        (book) => ({
                            ...book,
                            progress,
                            currentLocation: location,
                            ...(lastClickFraction !== undefined && { lastClickFraction }),
                            ...(pageProgress !== undefined && { pageProgress }),
                            lastReadAt: new Date(),
                        }),
                    );

                    // Update cache as well for fast access
                    if (updatedBook) {
                        const existingCache = state.recentBooksCache.filter((book) => book.id !== bookId);
                        const newCache = [createCacheEntry(updatedBook), ...existingCache].slice(0, 20);
                        return { books: updatedBooks, recentBooksCache: newCache };
                    }

                    return { books: updatedBooks };
                }),

            updatePdfReadingState: (bookId, pdfState) =>
                set((state) => {
                    const safeTotalPages = Math.max(1, Math.floor(pdfState.totalPages || 1));
                    const safePage = Math.max(1, Math.min(Math.floor(pdfState.page || 1), safeTotalPages));
                    const safeZoom = Math.max(0.25, Math.min(5, Number.isFinite(pdfState.zoom) ? pdfState.zoom : 1));
                    const safeProgress = Math.max(0, Math.min(1, safePage / safeTotalPages));
                    const safePdfViewState: PdfViewState = {
                        page: safePage,
                        totalPages: safeTotalPages,
                        zoom: safeZoom,
                        zoomMode: pdfState.zoomMode,
                    };

                    const { books: updatedBooks, updatedBook } = updateBookById(
                        state.books,
                        bookId,
                        (book) => ({
                            ...book,
                            currentLocation: `pdf:page:${safePage}`,
                            progress: safeProgress,
                            pageProgress: {
                                currentPage: safePage,
                                totalPages: safeTotalPages,
                                range: `${safePage}`,
                            },
                            pdfViewState: safePdfViewState,
                            lastReadAt: new Date(),
                        }),
                    );

                    if (updatedBook) {
                        const existingCache = state.recentBooksCache.filter((book) => book.id !== bookId);
                        const newCache = [createCacheEntry(updatedBook), ...existingCache].slice(0, 20);
                        return { books: updatedBooks, recentBooksCache: newCache };
                    }

                    return { books: updatedBooks };
                }),

            toggleFavorite: (bookId) =>
                set((state) => {
                    const { books } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        isFavorite: !book.isFavorite,
                    }));
                    return { books };
                }),

            updateBookMetadata: (bookId, metadata) =>
                set((state) => {
                    const { books } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        ...metadata,
                    }));
                    return { books };
                }),

            saveBookLocations: (bookId, locations) =>
                set((state) => {
                    const { books } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        locations,
                    }));
                    return { books };
                }),

            // Reading time tracking
            addReadingTime: (bookId, minutes) =>
                set((state) => {
                    const { books } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        readingTime: (book.readingTime || 0) + minutes,
                    }));
                    return { books };
                }),

            // Book completion
            markBookCompleted: (bookId, source = "manual") => {
                const book = get().books.find((b) => b.id === bookId);
                if (!book) return null;

                // Respect explicit manual unread override for automatic completion.
                if (source === "auto" && book.manualCompletionState === "unread") {
                    return null;
                }

                const now = new Date();
                const currentYear = now.getFullYear();
                const wasAlreadyCompleted = !!book.completedAt;
                let completedYear = currentYear;

                if (wasAlreadyCompleted && book.completedAt) {
                    const completedDate = book.completedAt instanceof Date
                        ? book.completedAt
                        : new Date(book.completedAt);
                    completedYear = completedDate.getFullYear();
                }

                // Keep explicit manual-read override persisted.
                const shouldSetManualRead = source === "manual" && book.manualCompletionState !== "read";
                const shouldSetCompletedAt = !wasAlreadyCompleted;

                if (shouldSetManualRead || shouldSetCompletedAt) {
                    set((state) => {
                        const { books: updatedBooks, updatedBook } = updateBookById(
                            state.books,
                            bookId,
                            (current) => ({
                                ...current,
                                progress: 1.0,
                                completedAt: current.completedAt || now,
                                ...(
                                    !current.completedAt
                                        ? { progressBeforeFinish: Math.max(0, Math.min(1, current.progress || 0)) }
                                        : {}
                                ),
                                ...(source === "manual" ? { manualCompletionState: "read" as const } : {}),
                            }),
                        );

                        if (!updatedBook) {
                            return { books: updatedBooks };
                        }

                        const existingCache = state.recentBooksCache.filter((entry) => entry.id !== bookId);
                        const newCache = [createCacheEntry(updatedBook), ...existingCache].slice(0, 20);

                        return {
                            books: updatedBooks,
                            recentBooksCache: newCache,
                        };
                    });
                }

                return { wasAlreadyCompleted, completedYear };
            },

            markBookUnread: (bookId) => {
                const book = get().books.find((b) => b.id === bookId);
                if (!book) return false;

                const restoredProgress = Math.max(0, Math.min(1, book.progressBeforeFinish ?? 0));
                const isAlreadyUnread = !book.completedAt && book.manualCompletionState === "unread";

                if (isAlreadyUnread) {
                    return false;
                }

                set((state) => {
                    const { books: updatedBooks, updatedBook } = updateBookById(
                        state.books,
                        bookId,
                        (current) => ({
                            ...current,
                            completedAt: undefined,
                            manualCompletionState: "unread",
                            progress: Math.max(0, Math.min(1, current.progressBeforeFinish ?? 0)),
                            progressBeforeFinish: undefined,
                        }),
                    );

                    if (!updatedBook) {
                        return { books: updatedBooks };
                    }

                    const existingCache = state.recentBooksCache.filter((entry) => entry.id !== bookId);
                    const newCache = [createCacheEntry(updatedBook), ...existingCache].slice(0, 20);

                    return {
                        books: updatedBooks,
                        recentBooksCache: newCache,
                    };
                });

                return true;
            },

            // Collection actions
            addCollection: (collection) =>
                set((state) => ({ collections: [...state.collections, collection] })),

            removeCollection: (collectionId) =>
                set((state) => ({
                    collections: state.collections.filter((c) => c.id !== collectionId),
                })),

            updateCollection: (collectionId, updates) =>
                set((state) => ({
                    collections: state.collections.map((c) =>
                        c.id === collectionId ? { ...c, ...updates } : c
                    ),
                })),

            addBookToCollection: (bookId, collectionId) =>
                set((state) => {
                    const bookExists = state.books.some((b) => b.id === bookId);
                    if (!bookExists) return state;
                    return {
                        collections: state.collections.map((c) =>
                            c.id === collectionId && !c.bookIds.includes(bookId)
                                ? { ...c, bookIds: [...c.bookIds, bookId] }
                                : c
                        ),
                    };
                }),

            removeBookFromCollection: (bookId, collectionId) =>
                set((state) => ({
                    collections: state.collections.map((c) =>
                        c.id === collectionId
                            ? { ...c, bookIds: c.bookIds.filter((id) => id !== bookId) }
                            : c
                    ),
                })),

            // Annotation actions
            addAnnotation: (annotation) => {
                set((state) => ({ annotations: [...state.annotations, annotation] }));
                useLearningStore.getState().syncReviewRecords();
            },

            addHighlightWithNote: (cfi, text, color, note) => {
                const annotation: Annotation = {
                    id: crypto.randomUUID(),
                    bookId: get().currentBookId || '',
                    type: note ? 'note' : 'highlight',
                    location: cfi,
                    selectedText: text,
                    color,
                    noteContent: note,
                    createdAt: new Date(),
                };
                set((state) => ({ annotations: [...state.annotations, annotation] }));
                useLearningStore.getState().syncReviewRecords();
                return annotation;
            },

            setCurrentBookId: (bookId) => set({ currentBookId: bookId }),

            updateAnnotation: (annotationId, updates) => {
                set((state) => ({
                    annotations: state.annotations.map((a) => (
                        a.id === annotationId
                            ? { ...a, ...updates, updatedAt: new Date() }
                            : a
                    )),
                }));
                useLearningStore.getState().syncReviewRecords();
            },

            removeAnnotation: (annotationId) => {
                set((state) => ({
                    annotations: state.annotations.filter((a) => a.id !== annotationId),
                }));
                useLearningStore.getState().syncReviewRecords();
            },

            getBookAnnotations: (bookId) =>
                get().annotations.filter((a) => a.bookId === bookId),

            getHighlights: (bookId) =>
                get().annotations.filter((a) => a.bookId === bookId && (a.type === 'highlight' || a.type === 'note')),

            getBookmarks: (bookId) =>
                get().annotations.filter((a) => a.bookId === bookId && a.type === 'bookmark'),

            exportAnnotationsToMarkdown: (bookId: string) => {
                const book = get().getBook(bookId);
                if (!book) return '';

                const annotations = get().getBookAnnotations(bookId);
                const highlights = annotations.filter(a => a.type === 'highlight' || a.type === 'note');
                const bookmarks = annotations.filter(a => a.type === 'bookmark');

                let markdown = `# Highlights for "${book.title}"\n\n`;
                markdown += `by ${book.author}\n\n`;
                markdown += `---\n\n`;

                if (highlights.length > 0) {
                    markdown += `## Highlights (${highlights.length})\n\n`;

                    highlights.forEach((annotation, index) => {
                        markdown += `### ${index + 1}. ${annotation.color || 'Highlight'}\n\n`;
                        markdown += `> ${annotation.selectedText?.replace(/\n/g, ' ') || ''}\n\n`;

                        if (annotation.noteContent) {
                            markdown += `**Note:** ${annotation.noteContent}\n\n`;
                        }

                        markdown += `\`\`\`\nLocation: ${annotation.location}\n\`\`\`\n\n`;
                        markdown += `---\n\n`;
                    });
                }

                if (bookmarks.length > 0) {
                    markdown += `## Bookmarks (${bookmarks.length})\n\n`;

                    bookmarks.forEach((bookmark, index) => {
                        markdown += `${index + 1}. ${bookmark.selectedText || 'Bookmark'}\n`;
                        markdown += `   - Location: ${bookmark.location}\n\n`;
                    });
                }

                return markdown;
            },

            // Getters
            getBook: (bookId) => getBookLookup(get().books).get(bookId),

            getRecentBooks: (limit = 10) =>
                [...get().books]
                    .filter((b) => b.lastReadAt)
                    .sort((a, b) => {
                        const aDate = a.lastReadAt instanceof Date ? a.lastReadAt : new Date(a.lastReadAt!);
                        const bDate = b.lastReadAt instanceof Date ? b.lastReadAt : new Date(b.lastReadAt!);
                        return (bDate.getTime() || 0) - (aDate.getTime() || 0);
                    })
                    .slice(0, limit),

            getFavoriteBooks: () => get().books.filter((b) => b.isFavorite),

            getBooksByCategory: (category) =>
                get().books.filter((b) => b.category === category),

            searchBooks: (query) => {
                const q = query.toLowerCase();
                return get().books.filter(
                    (b) =>
                        b.title.toLowerCase().includes(q) ||
                        b.author.toLowerCase().includes(q) ||
                        b.tags.some((t) => t.toLowerCase().includes(q))
                );
            },

            getCachedBook: (bookId) => getCachedBookLookup(get().recentBooksCache).get(bookId),

            setLastScannedAt: (date) => set({ lastScannedAt: date }),

        }),
        {
            name: "theorem-library",
            partialize: (state) => ({
                books: state.books,
                collections: state.collections,
                annotations: state.annotations,
                lastScannedAt: state.lastScannedAt,
                recentBooksCache: state.recentBooksCache,
            }),
        }
    )
);

// Settings Store
interface SettingsStore {
    settings: AppSettings;
    stats: ReadingStats;

    updateSettings: (updates: Partial<AppSettings>) => void;
    updateReaderSettings: (updates: Partial<ReaderSettings>) => void;
    updateLearningSettings: (updates: Partial<LearningSettings>) => void;
    updateStats: (updates: Partial<ReadingStats>) => void;
    resetSettings: () => void;
    resetReaderSettings: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set, get) => ({
            settings: defaultAppSettings,
            stats: defaultReadingStats,

            updateSettings: (updates) =>
                set((state) => ({
                    settings: { ...state.settings, ...updates },
                })),

            updateReaderSettings: (updates) => {
                const newSettings = { ...get().settings.readerSettings, ...updates };

                // Apply CSS variables immediately for instant visual feedback
                // This is synchronous and extremely fast
                applyReaderStyles(newSettings);

                set((state) => ({
                    settings: {
                        ...state.settings,
                        readerSettings: newSettings,
                    },
                }));
            },

            updateLearningSettings: (updates) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        learning: {
                            ...state.settings.learning,
                            ...updates,
                        },
                    },
                })),

            updateStats: (updates) =>
                set((state) => ({
                    stats: { ...state.stats, ...updates },
                })),

            resetSettings: () =>
                set({
                    settings: defaultAppSettings,
                }),

            resetReaderSettings: () => {
                // Apply default styles immediately
                applyReaderStyles(defaultReaderSettings);

                set((state) => ({
                    settings: {
                        ...state.settings,
                        readerSettings: defaultReaderSettings,
                    },
                }));
            },
        }),
        {
            name: "theorem-settings",
            onRehydrateStorage: () => (state) => {
                // Apply saved reader settings when store is rehydrated
                if (state?.settings.readerSettings) {
                    initReaderStyles(state.settings.readerSettings);
                }

                if (state && !state.settings.learning) {
                    state.settings.learning = defaultLearningSettings;
                } else if (state?.settings.learning) {
                    state.settings.learning = {
                        ...defaultLearningSettings,
                        ...state.settings.learning,
                    };
                }

                // Migration: Ensure dailyActivity exists for old stored data
                if (state && !state.stats.dailyActivity) {
                    state.stats.dailyActivity = [];
                }
            },
        }
    )
);

interface LearningStore {
    vocabularyTerms: VocabularyTerm[];
    reviewRecords: LearningReviewRecord[];
    reviewEvents: ReviewEvent[];
    installedDictionaries: InstalledDictionary[];
    lookupCache: Record<string, DictionaryLookupResult>;
    dailyReminderState: DailyReminderState;
    reviewSessionState: ReviewSessionState;

    saveVocabularyTerm: (term: VocabularyTerm, context?: SaveVocabularyContextInput) => VocabularyTerm;
    updateVocabularyTerm: (termId: string, updates: Partial<VocabularyTerm>) => void;
    deleteVocabularyTerm: (termId: string) => void;
    lookupTerm: (term: string, language?: string) => Promise<DictionaryLookupResult | null>;
    lookupAndSaveTerm: (term: string, language?: string) => Promise<VocabularyTerm | null>;

    syncReviewRecords: () => void;
    getDueReviewItems: (now?: Date, scope?: ReviewLaunchScope) => DailyReviewItem[];
    reviewItem: (
        sourceType: ReviewSourceType,
        sourceId: string,
        grade: ReviewGrade,
    ) => LearningReviewRecord | null;
    suspendReviewItem: (
        sourceType: ReviewSourceType,
        sourceId: string,
        suspended?: boolean,
    ) => void;

    importStarDict: (files: FileList | File[]) => Promise<InstalledDictionary>;
    removeDictionary: (dictionaryId: string) => Promise<void>;

    setReminderPromptVisible: (visible: boolean) => void;
    dismissDailyReminderPrompt: () => void;
    markDailyReviewCompleted: () => void;
    openReviewSession: (scope: ReviewLaunchScope) => void;
    closeReviewSession: () => void;
    updateReviewSessionState: (updates: Partial<ReviewSessionState>) => void;
}

interface ReviewSourceSnapshot {
    id: string;
    sourceType: ReviewSourceType;
    sourceId: string;
    createdAt: Date;
    front: string;
    back: string;
}

interface SaveVocabularyContextInput {
    sourceType: VocabularyContextSourceType;
    sourceId: string;
    label: string;
}

interface ReviewSessionState {
    isOpen: boolean;
    scope: ReviewLaunchScope;
    sessionItemIds: string[];
    cursor: number;
    revealed: boolean;
    reviewedCount: number;
    gradeTally: Record<ReviewGrade, number>;
}

const LEGACY_VOCABULARY_CONTEXT_LABEL = "Legacy / Unknown source";

const EMPTY_REVIEW_GRADE_TALLY: Record<ReviewGrade, number> = {
    again: 0,
    hard: 0,
    good: 0,
    easy: 0,
};

function createInitialReviewSessionState(
    scope: ReviewLaunchScope = "all",
): ReviewSessionState {
    return {
        isOpen: false,
        scope,
        sessionItemIds: [],
        cursor: 0,
        revealed: false,
        reviewedCount: 0,
        gradeTally: { ...EMPTY_REVIEW_GRADE_TALLY },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function toReviewRecordId(sourceType: ReviewSourceType, sourceId: string): string {
    return `${sourceType}:${sourceId}`;
}

function isReviewSourceType(value: unknown): value is ReviewSourceType {
    return value === "vocabulary" || value === "highlight";
}

function isVocabularyContextSourceType(value: unknown): value is VocabularyContextSourceType {
    return value === "book" || value === "site" || value === "legacy";
}

function toValidDate(value: Date | string | number | undefined, fallback: Date): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }

    if (value !== undefined) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }

    return fallback;
}

function toVocabularyContextKey(
    sourceType: VocabularyContextSourceType,
    sourceId: string,
): string {
    return `${sourceType}:${sourceId}`;
}

function createLegacyVocabularyContext(
    sourceDate: Date,
): VocabularyContext {
    return {
        key: toVocabularyContextKey("legacy", "legacy"),
        sourceType: "legacy",
        sourceId: "legacy",
        label: LEGACY_VOCABULARY_CONTEXT_LABEL,
        firstSeenAt: sourceDate,
        lastSeenAt: sourceDate,
        occurrences: 1,
    };
}

function normalizeVocabularyContext(
    value: unknown,
    fallbackDate: Date,
): VocabularyContext | null {
    if (!isRecord(value)) {
        return null;
    }

    const sourceType = isVocabularyContextSourceType(value.sourceType)
        ? value.sourceType
        : null;
    const rawSourceId = typeof value.sourceId === "string"
        ? value.sourceId.trim()
        : "";
    if (!sourceType || !rawSourceId) {
        return null;
    }

    const firstSeenAt = toValidDate(
        value.firstSeenAt as Date | string | number | undefined,
        fallbackDate,
    );
    const lastSeenAt = toValidDate(
        value.lastSeenAt as Date | string | number | undefined,
        firstSeenAt,
    );
    const rawOccurrences = Number(value.occurrences);
    const occurrences = Number.isFinite(rawOccurrences)
        ? Math.max(1, Math.trunc(rawOccurrences))
        : 1;

    const label = typeof value.label === "string" && value.label.trim()
        ? value.label.trim()
        : sourceType === "legacy"
            ? LEGACY_VOCABULARY_CONTEXT_LABEL
            : rawSourceId;

    const keyFromState = typeof value.key === "string" && value.key.trim()
        ? value.key.trim()
        : "";
    const key = keyFromState || toVocabularyContextKey(sourceType, rawSourceId);

    return {
        key,
        sourceType,
        sourceId: rawSourceId,
        label,
        firstSeenAt,
        lastSeenAt,
        occurrences,
    };
}

function mergeVocabularyContexts(
    existingContexts: VocabularyContext[],
    incomingContexts: VocabularyContext[],
): VocabularyContext[] {
    const mergedByKey = new Map(existingContexts.map((context) => [context.key, context]));

    for (const context of incomingContexts) {
        const existing = mergedByKey.get(context.key);
        if (!existing) {
            mergedByKey.set(context.key, context);
            continue;
        }

        mergedByKey.set(context.key, {
            ...existing,
            sourceType: context.sourceType,
            sourceId: context.sourceId,
            label: context.label || existing.label,
            firstSeenAt: existing.firstSeenAt.getTime() <= context.firstSeenAt.getTime()
                ? existing.firstSeenAt
                : context.firstSeenAt,
            lastSeenAt: existing.lastSeenAt.getTime() >= context.lastSeenAt.getTime()
                ? existing.lastSeenAt
                : context.lastSeenAt,
            occurrences: Math.max(1, existing.occurrences + context.occurrences),
        });
    }

    return Array.from(mergedByKey.values());
}

function isReviewableAnnotation(annotation: Annotation): boolean {
    return annotation.type === "highlight" || annotation.type === "note";
}

function extractAnnotationNote(annotation: Annotation): string {
    return normalizeCardTextForDisplay(
        annotation.noteContent || annotation.textNoteContent || "",
    );
}

function formatAnnotationLocation(annotation: Annotation): string {
    if (typeof annotation.pageNumber === "number" && Number.isFinite(annotation.pageNumber)) {
        return `Page ${annotation.pageNumber}`;
    }
    return annotation.location || "Unknown location";
}

function seedInitialDueAt(sourceCreatedAt: Date, now: Date): Date {
    const sourceTime = sourceCreatedAt.getTime();
    const dueAt = new Date(now);
    if (Number.isNaN(sourceTime)) {
        return dueAt;
    }
    return dueAt;
}

function buildVocabularyBack(term: VocabularyTerm): string {
    const definitions = term.meanings
        .flatMap((meaning) => meaning.definitions)
        .map((definition) => normalizeCardTextForDisplay(definition))
        .filter(Boolean)
        .slice(0, 3);

    if (definitions.length === 0) {
        return "(No definition)";
    }

    return definitions.join("\n");
}

function buildHighlightBack(annotation: Annotation, bookTitle: string): string {
    const noteContent = extractAnnotationNote(annotation);
    const createdAt = toValidDate(annotation.createdAt, new Date());
    const contextLines = [
        `Book: ${bookTitle || "Unknown book"}`,
        `Captured: ${createdAt.toLocaleDateString()}`,
        `Location: ${formatAnnotationLocation(annotation)}`,
    ];

    return `${noteContent || "(No note)"}\n\n${contextLines.join("\n")}`;
}

function collectReviewSourceSnapshots(
    vocabularyTerms: VocabularyTerm[],
    annotations: Annotation[],
    books: Book[],
): Map<string, ReviewSourceSnapshot> {
    const snapshots = new Map<string, ReviewSourceSnapshot>();
    const bookTitleById = new Map(books.map((book) => [book.id, book.title]));

    for (const term of vocabularyTerms) {
        const sourceId = term.id;
        const sourceType: ReviewSourceType = "vocabulary";
        const id = toReviewRecordId(sourceType, sourceId);
        const createdAt = toValidDate(term.createdAt, new Date());
        const front = normalizeCardTextForDisplay(term.term) || "(Untitled term)";
        const back = buildVocabularyBack(term);

        snapshots.set(id, {
            id,
            sourceType,
            sourceId,
            createdAt,
            front,
            back,
        });
    }

    for (const annotation of annotations) {
        if (!isReviewableAnnotation(annotation)) {
            continue;
        }

        const sourceId = annotation.id;
        const sourceType: ReviewSourceType = "highlight";
        const id = toReviewRecordId(sourceType, sourceId);
        const createdAt = toValidDate(annotation.createdAt, new Date());
        const front = normalizeCardTextForDisplay(annotation.selectedText || "")
            || "Review this highlight";
        const bookTitle = normalizeCardTextForDisplay(bookTitleById.get(annotation.bookId) || "Unknown book");
        const back = buildHighlightBack(annotation, bookTitle);

        snapshots.set(id, {
            id,
            sourceType,
            sourceId,
            createdAt,
            front,
            back,
        });
    }

    return snapshots;
}

function normalizeLearningReviewRecord(record: LearningReviewRecord): LearningReviewRecord {
    const now = new Date();
    const dueAt = toValidDate(record.dueAt, now);
    const schedulerDue = toValidDate(record.scheduler?.due, dueAt);
    const schedulerLastReview = record.scheduler?.last_review
        ? toValidDate(record.scheduler.last_review, dueAt)
        : undefined;

    return {
        ...record,
        id: toReviewRecordId(record.sourceType, record.sourceId),
        createdAt: toValidDate(record.createdAt, now),
        updatedAt: record.updatedAt ? toValidDate(record.updatedAt, now) : undefined,
        lastReviewedAt: record.lastReviewedAt
            ? toValidDate(record.lastReviewedAt, now)
            : undefined,
        dueAt,
        scheduler: normalizeReviewSchedulerState({
            ...record.scheduler,
            due: schedulerDue,
            last_review: schedulerLastReview,
        }),
    };
}

function normalizeVocabularyTerm(term: VocabularyTerm): VocabularyTerm {
    const now = new Date();
    const normalized = { ...term } as VocabularyTerm & { linkedCardId?: string };
    if ("linkedCardId" in normalized) {
        delete normalized.linkedCardId;
    }
    const createdAt = toValidDate(normalized.createdAt, now);
    const sourceContexts = Array.isArray(normalized.contexts)
        ? normalized.contexts
            .map((context) => normalizeVocabularyContext(context, createdAt))
            .filter((context): context is VocabularyContext => Boolean(context))
        : [];
    const contexts = sourceContexts.length > 0
        ? sourceContexts
        : [createLegacyVocabularyContext(createdAt)];

    return {
        ...normalized,
        contexts,
        createdAt,
        updatedAt: normalized.updatedAt
            ? toValidDate(normalized.updatedAt, now)
            : undefined,
        lastReviewedAt: normalized.lastReviewedAt
            ? toValidDate(normalized.lastReviewedAt, now)
            : undefined,
    };
}

function normalizeReviewEvent(review: ReviewEvent): ReviewEvent | null {
    if (!isReviewSourceType(review.sourceType) || !review.sourceId) {
        return null;
    }

    const now = new Date();
    return {
        ...review,
        reviewedAt: toValidDate(review.reviewedAt, now),
        dueBefore: toValidDate(review.dueBefore, now),
        dueAfter: toValidDate(review.dueAfter, now),
    };
}

function normalizeLearningDailyReminderState(value: unknown): DailyReminderState {
    const asRecord = isRecord(value) ? value : {};
    return {
        isPromptVisible: false,
        lastPromptDate: typeof asRecord.lastPromptDate === "string"
            ? asRecord.lastPromptDate
            : undefined,
        dismissedDate: typeof asRecord.dismissedDate === "string"
            ? asRecord.dismissedDate
            : undefined,
        completedDate: typeof asRecord.completedDate === "string"
            ? asRecord.completedDate
            : undefined,
    };
}

function normalizeLearningLookupCache(
    value: unknown,
): Record<string, DictionaryLookupResult> {
    if (!isRecord(value)) {
        return {};
    }

    return value as Record<string, DictionaryLookupResult>;
}

function normalizeReviewSessionState(value: unknown): ReviewSessionState {
    if (!isRecord(value)) {
        return createInitialReviewSessionState();
    }

    const scope = value.scope === "vocabulary" || value.scope === "highlight"
        ? value.scope
        : "all";
    return {
        ...createInitialReviewSessionState(scope),
        isOpen: false,
    };
}

function shouldIncludeReviewSourceInScope(
    sourceType: ReviewSourceType,
    scope: ReviewLaunchScope,
    learningSettings: LearningSettings,
): boolean {
    if (scope === "vocabulary" && sourceType !== "vocabulary") {
        return false;
    }
    if (scope === "highlight" && sourceType !== "highlight") {
        return false;
    }
    if (sourceType === "vocabulary" && !learningSettings.reviewVocabularyEnabled) {
        return false;
    }
    if (sourceType === "highlight" && !learningSettings.reviewHighlightEnabled) {
        return false;
    }
    return true;
}

export const useLearningStore = create<LearningStore>()(
    persist(
        (set, get) => ({
            vocabularyTerms: [],
            reviewRecords: [],
            reviewEvents: [],
            installedDictionaries: [],
            lookupCache: {},
            dailyReminderState: {
                isPromptVisible: false,
            },
            reviewSessionState: createInitialReviewSessionState(),

            saveVocabularyTerm: (incomingTerm, context) => {
                const now = new Date();
                const incomingCreatedAt = toValidDate(incomingTerm.createdAt, now);
                const incomingUpdatedAt = incomingTerm.updatedAt
                    ? toValidDate(incomingTerm.updatedAt, now)
                    : now;
                const incomingContexts = Array.isArray(incomingTerm.contexts)
                    ? incomingTerm.contexts
                        .map((entry) => normalizeVocabularyContext(entry, incomingCreatedAt))
                        .filter((entry): entry is VocabularyContext => Boolean(entry))
                    : [];
                const contextFromSave = context && context.sourceId.trim()
                    ? {
                        key: toVocabularyContextKey(context.sourceType, context.sourceId.trim()),
                        sourceType: context.sourceType,
                        sourceId: context.sourceId.trim(),
                        label: context.label.trim() || context.sourceId.trim(),
                        firstSeenAt: now,
                        lastSeenAt: now,
                        occurrences: 1,
                    } satisfies VocabularyContext
                    : null;
                const contextEntriesToMerge = contextFromSave
                    ? [...incomingContexts, contextFromSave]
                    : incomingContexts;

                const normalizedKey = normalizeTermKey(
                    incomingTerm.normalizedTerm,
                    incomingTerm.language,
                );

                const existing = get().vocabularyTerms.find((term) => (
                    normalizeTermKey(term.normalizedTerm, term.language) === normalizedKey
                ));

                if (!existing) {
                    const mergedContexts = mergeVocabularyContexts([], contextEntriesToMerge);
                    const termToSave: VocabularyTerm = {
                        ...incomingTerm,
                        contexts: mergedContexts.length > 0
                            ? mergedContexts
                            : [createLegacyVocabularyContext(incomingCreatedAt)],
                        createdAt: incomingCreatedAt,
                        updatedAt: incomingUpdatedAt,
                    };
                    set((state) => ({
                        vocabularyTerms: [...state.vocabularyTerms, termToSave],
                    }));
                    get().syncReviewRecords();
                    return termToSave;
                }

                const mergedMeanings = [...existing.meanings];
                for (const meaning of incomingTerm.meanings) {
                    const signature = JSON.stringify({
                        provider: meaning.provider,
                        partOfSpeech: meaning.partOfSpeech,
                        definitions: meaning.definitions,
                    });
                    const alreadyPresent = mergedMeanings.some((candidate) => JSON.stringify({
                        provider: candidate.provider,
                        partOfSpeech: candidate.partOfSpeech,
                        definitions: candidate.definitions,
                    }) === signature);
                    if (!alreadyPresent) {
                        mergedMeanings.push(meaning);
                    }
                }

                const mergedProviderHistory = Array.from(new Set([
                    ...existing.providerHistory,
                    ...incomingTerm.providerHistory,
                ]));
                const mergedContexts = contextEntriesToMerge.length > 0
                    ? mergeVocabularyContexts(existing.contexts, contextEntriesToMerge)
                    : existing.contexts;

                const mergedTerm: VocabularyTerm = {
                    ...existing,
                    term: incomingTerm.term || existing.term,
                    normalizedTerm: incomingTerm.normalizedTerm || existing.normalizedTerm,
                    language: incomingTerm.language || existing.language,
                    phonetic: incomingTerm.phonetic || existing.phonetic,
                    audioUrl: incomingTerm.audioUrl || existing.audioUrl,
                    meanings: mergedMeanings,
                    providerHistory: mergedProviderHistory,
                    lookupCount: existing.lookupCount + Math.max(1, incomingTerm.lookupCount || 1),
                    contexts: mergedContexts.length > 0
                        ? mergedContexts
                        : [createLegacyVocabularyContext(toValidDate(existing.createdAt, now))],
                    updatedAt: now,
                };

                set((state) => ({
                    vocabularyTerms: state.vocabularyTerms.map((term) => (
                        term.id === existing.id ? mergedTerm : term
                    )),
                }));
                get().syncReviewRecords();
                return mergedTerm;
            },

            updateVocabularyTerm: (termId, updates) => {
                const now = new Date();
                set((state) => ({
                    vocabularyTerms: state.vocabularyTerms.map((term) => (
                        term.id === termId
                            ? {
                                ...term,
                                ...updates,
                                contexts: Array.isArray(updates.contexts)
                                    ? updates.contexts
                                        .map((entry) => normalizeVocabularyContext(entry, term.createdAt))
                                        .filter((entry): entry is VocabularyContext => Boolean(entry))
                                    : term.contexts,
                                updatedAt: now,
                            }
                            : term
                    )),
                }));
                get().syncReviewRecords();
            },

            deleteVocabularyTerm: (termId) => {
                set((state) => ({
                    vocabularyTerms: state.vocabularyTerms.filter((term) => term.id !== termId),
                }));
                get().syncReviewRecords();
            },

            lookupTerm: async (term, language = "en") => {
                const normalizedQuery = term.trim().toLowerCase();
                if (!normalizedQuery) {
                    return null;
                }

                const cacheKey = normalizeTermKey(normalizedQuery, language);
                const cached = get().lookupCache[cacheKey];
                if (cached) {
                    return cached;
                }

                const settings = useSettingsStore.getState().settings.learning;
                const installedIds = get().installedDictionaries.map((dictionary) => dictionary.id);

                const result = await lookupDictionaryTerm({
                    term,
                    language,
                    mode: settings.dictionaryMode,
                    installedDictionaryIds: installedIds,
                });

                if (result) {
                    set((state) => ({
                        lookupCache: {
                            ...state.lookupCache,
                            [cacheKey]: result,
                        },
                    }));
                }

                return result;
            },

            lookupAndSaveTerm: async (term, language = "en") => {
                const result = await get().lookupTerm(term, language);
                if (!result) {
                    return null;
                }

                const vocabularyTerm = vocabularyTermFromLookup(result);
                return get().saveVocabularyTerm(vocabularyTerm);
            },

            syncReviewRecords: () => {
                const libraryState = useLibraryStore.getState();
                const sourceSnapshots = collectReviewSourceSnapshots(
                    get().vocabularyTerms,
                    libraryState.annotations,
                    libraryState.books,
                );
                const now = new Date();
                const nowTime = now.getTime();

                set((state) => {
                    const existingById = new Map<string, LearningReviewRecord>();
                    for (const record of state.reviewRecords) {
                        if (!isReviewSourceType(record.sourceType) || !record.sourceId) {
                            continue;
                        }
                        const id = toReviewRecordId(record.sourceType, record.sourceId);
                        existingById.set(id, {
                            ...record,
                            id,
                        });
                    }

                    const nextRecords: LearningReviewRecord[] = [];
                    const activeIds = new Set<string>();

                    for (const [id, snapshot] of sourceSnapshots.entries()) {
                        activeIds.add(id);
                        const existingRecord = existingById.get(id);

                        if (existingRecord) {
                            const existingDueAt = toValidDate(existingRecord.dueAt, now);
                            const shouldPullForward = existingRecord.reviewCount === 0
                                && existingDueAt.getTime() > nowTime;

                            const scheduler = shouldPullForward
                                ? {
                                    ...existingRecord.scheduler,
                                    due: new Date(now),
                                }
                                : existingRecord.scheduler;
                            nextRecords.push({
                                ...existingRecord,
                                id,
                                sourceType: snapshot.sourceType,
                                sourceId: snapshot.sourceId,
                                scheduler,
                                dueAt: shouldPullForward ? new Date(now) : existingDueAt,
                                updatedAt: shouldPullForward ? now : existingRecord.updatedAt,
                            });
                            continue;
                        }

                        const seededDueAt = seedInitialDueAt(snapshot.createdAt, now);
                        const scheduler = createInitialReviewSchedulerState(now);
                        scheduler.due = seededDueAt;

                        nextRecords.push({
                            id,
                            sourceType: snapshot.sourceType,
                            sourceId: snapshot.sourceId,
                            suspended: false,
                            scheduler,
                            dueAt: seededDueAt,
                            createdAt: snapshot.createdAt,
                            reviewCount: 0,
                            lapseCount: 0,
                        });
                    }

                    const nextEvents = state.reviewEvents.filter((event) => (
                        activeIds.has(toReviewRecordId(event.sourceType, event.sourceId))
                    ));

                    return {
                        reviewRecords: nextRecords,
                        reviewEvents: nextEvents,
                    };
                });
            },

            getDueReviewItems: (now = new Date(), scope: ReviewLaunchScope = "all") => {
                const learningState = get();
                const libraryState = useLibraryStore.getState();
                const learningSettings = useSettingsStore.getState().settings.learning;
                const sourceSnapshots = collectReviewSourceSnapshots(
                    learningState.vocabularyTerms,
                    libraryState.annotations,
                    libraryState.books,
                );
                const nowTime = now.getTime();

                return learningState.reviewRecords
                    .filter((record) => !record.suspended)
                    .filter((record) => shouldIncludeReviewSourceInScope(
                        record.sourceType,
                        scope,
                        learningSettings,
                    ))
                    .filter((record) => toValidDate(record.dueAt, now).getTime() <= nowTime)
                    .map((record) => {
                        const sourceSnapshot = sourceSnapshots.get(record.id);
                        if (!sourceSnapshot) {
                            return null;
                        }
                        return {
                            id: record.id,
                            sourceType: record.sourceType,
                            sourceId: record.sourceId,
                            front: sourceSnapshot.front,
                            back: sourceSnapshot.back,
                            dueAt: toValidDate(record.dueAt, now),
                            createdAt: sourceSnapshot.createdAt,
                            suspended: record.suspended,
                            reviewCount: record.reviewCount,
                            lapseCount: record.lapseCount,
                        } satisfies DailyReviewItem;
                    })
                    .filter((item): item is DailyReviewItem => Boolean(item))
                    .sort((a, b) => (
                        a.dueAt.getTime() - b.dueAt.getTime()
                        || a.sourceType.localeCompare(b.sourceType)
                        || a.createdAt.getTime() - b.createdAt.getTime()
                    ));
            },

            reviewItem: (sourceType, sourceId, grade) => {
                const reviewRecordId = toReviewRecordId(sourceType, sourceId);
                let currentRecord = get().reviewRecords.find((record) => record.id === reviewRecordId);

                if (!currentRecord) {
                    get().syncReviewRecords();
                    currentRecord = get().reviewRecords.find((record) => record.id === reviewRecordId);
                }

                if (!currentRecord) {
                    return null;
                }

                const now = new Date();
                const reviewResult = reviewItemSchedulerState(currentRecord.scheduler, grade, now);

                const nextRecord: LearningReviewRecord = {
                    ...currentRecord,
                    scheduler: reviewResult.scheduler,
                    dueAt: reviewResult.dueAt,
                    lastReviewedAt: now,
                    reviewCount: currentRecord.reviewCount + 1,
                    lapseCount: grade === "again"
                        ? currentRecord.lapseCount + 1
                        : currentRecord.lapseCount,
                    updatedAt: now,
                };

                const reviewEvent: ReviewEvent = {
                    id: crypto.randomUUID(),
                    sourceType,
                    sourceId,
                    grade,
                    reviewedAt: now,
                    dueBefore: toValidDate(currentRecord.dueAt, now),
                    dueAfter: toValidDate(reviewResult.dueAt, now),
                    sourceState: reviewResult.sourceState,
                    nextState: reviewResult.nextState,
                };

                set((state) => ({
                    reviewRecords: state.reviewRecords.map((record) => (
                        record.id === reviewRecordId ? nextRecord : record
                    )),
                    reviewEvents: [...state.reviewEvents, reviewEvent],
                    vocabularyTerms: sourceType === "vocabulary"
                        ? state.vocabularyTerms.map((term) => (
                            term.id === sourceId
                                ? {
                                    ...term,
                                    lastReviewedAt: now,
                                    updatedAt: now,
                                }
                                : term
                        ))
                        : state.vocabularyTerms,
                }));

                return nextRecord;
            },

            suspendReviewItem: (sourceType, sourceId, suspended = true) => {
                const recordId = toReviewRecordId(sourceType, sourceId);
                const now = new Date();
                set((state) => ({
                    reviewRecords: state.reviewRecords.map((record) => (
                        record.id === recordId
                            ? {
                                ...record,
                                suspended,
                                updatedAt: now,
                            }
                            : record
                    )),
                }));
            },

            importStarDict: async (files) => {
                const dictionary = await importStarDictDictionary(files);
                set((state) => ({
                    installedDictionaries: [dictionary, ...state.installedDictionaries],
                }));
                return dictionary;
            },

            removeDictionary: async (dictionaryId) => {
                await removeStarDictDictionary(dictionaryId);
                set((state) => ({
                    installedDictionaries: state.installedDictionaries.filter(
                        (dictionary) => dictionary.id !== dictionaryId,
                    ),
                }));
            },

            setReminderPromptVisible: (visible) => {
                set((state) => ({
                    dailyReminderState: {
                        ...state.dailyReminderState,
                        isPromptVisible: visible,
                        lastPromptDate: visible
                            ? toIsoDateString()
                            : state.dailyReminderState.lastPromptDate,
                    },
                }));
            },

            dismissDailyReminderPrompt: () => {
                set((state) => ({
                    dailyReminderState: {
                        ...state.dailyReminderState,
                        isPromptVisible: false,
                        dismissedDate: toIsoDateString(),
                    },
                }));
            },

            markDailyReviewCompleted: () => {
                set((state) => ({
                    dailyReminderState: {
                        ...state.dailyReminderState,
                        isPromptVisible: false,
                        completedDate: toIsoDateString(),
                    },
                }));
            },

            openReviewSession: (scope) => {
                const queueIds = get().getDueReviewItems(new Date(), scope).map((item) => item.id);
                if (queueIds.length === 0) {
                    set({
                        reviewSessionState: createInitialReviewSessionState(scope),
                    });
                    return;
                }

                set({
                    reviewSessionState: {
                        isOpen: true,
                        scope,
                        sessionItemIds: queueIds,
                        cursor: 0,
                        revealed: false,
                        reviewedCount: 0,
                        gradeTally: { ...EMPTY_REVIEW_GRADE_TALLY },
                    },
                });
            },

            closeReviewSession: () => {
                const currentScope = get().reviewSessionState.scope;
                set({
                    reviewSessionState: createInitialReviewSessionState(currentScope),
                });
            },

            updateReviewSessionState: (updates) => {
                set((state) => ({
                    reviewSessionState: {
                        ...state.reviewSessionState,
                        ...updates,
                    },
                }));
            },
        }),
        {
            name: "theorem-learning",
            version: 3,
            migrate: (persistedState, version) => {
                const persisted = isRecord(persistedState) ? persistedState : {};
                const { preferredTab: _preferredTab, ...persistedWithoutPreferredTab } = persisted;
                const vocabularyTermsRaw = Array.isArray(persisted.vocabularyTerms)
                    ? persisted.vocabularyTerms
                    : [];
                const vocabularyTerms = vocabularyTermsRaw.map((term) => {
                    if (!isRecord(term)) {
                        return term;
                    }
                    const { linkedCardId: _linkedCardId, ...rest } = term;
                    return rest;
                });
                const installedDictionaries = Array.isArray(persisted.installedDictionaries)
                    ? persisted.installedDictionaries
                    : [];
                const dailyReminderState = normalizeLearningDailyReminderState(
                    persisted.dailyReminderState,
                );
                const lookupCache = normalizeLearningLookupCache(persisted.lookupCache);
                const reviewSessionState = normalizeReviewSessionState(persisted.reviewSessionState);

                if (version < 2) {
                    return {
                        vocabularyTerms,
                        reviewRecords: [],
                        reviewEvents: [],
                        installedDictionaries,
                        lookupCache,
                        dailyReminderState,
                        reviewSessionState,
                    };
                }

                const reviewRecords = Array.isArray(persisted.reviewRecords)
                    ? persisted.reviewRecords
                    : [];
                const reviewEvents = Array.isArray(persisted.reviewEvents)
                    ? persisted.reviewEvents
                    : [];

                return {
                    ...persistedWithoutPreferredTab,
                    vocabularyTerms,
                    reviewRecords,
                    reviewEvents,
                    installedDictionaries,
                    lookupCache,
                    dailyReminderState,
                    reviewSessionState,
                } as LearningStore;
            },
            onRehydrateStorage: () => (state) => {
                if (!state) {
                    return;
                }

                state.vocabularyTerms = (state.vocabularyTerms || []).map((term) => (
                    normalizeVocabularyTerm(term)
                ));

                state.reviewRecords = (state.reviewRecords || []).map((record) => (
                    normalizeLearningReviewRecord(record)
                ));

                state.reviewEvents = (state.reviewEvents || [])
                    .map((review) => normalizeReviewEvent(review))
                    .filter((review): review is ReviewEvent => Boolean(review));

                state.installedDictionaries = (state.installedDictionaries || []).map((dictionary) => ({
                    ...dictionary,
                    importedAt: toValidDate(dictionary.importedAt, new Date()),
                }));

                state.lookupCache = normalizeLearningLookupCache(state.lookupCache);
                state.dailyReminderState = normalizeLearningDailyReminderState(state.dailyReminderState);
                state.reviewSessionState = normalizeReviewSessionState(state.reviewSessionState);

                const runSync = () => state.syncReviewRecords();
                const libraryPersist = (
                    useLibraryStore as typeof useLibraryStore & {
                        persist?: {
                            hasHydrated?: () => boolean;
                            onFinishHydration?: (callback: () => void) => () => void;
                        };
                    }
                ).persist;

                if (!libraryPersist || libraryPersist.hasHydrated?.()) {
                    runSync();
                } else {
                    libraryPersist.onFinishHydration?.(runSync);
                }
            },
        },
    ),
);

// ── RSS Feed Store ──

import type { RssFeed, RssArticle } from '../types';
import {
    fetchAndParseFeed,
    materializeFeed,
} from '../services/RssService';

interface RssStore {
    feeds: RssFeed[];
    articles: RssArticle[];
    isLoading: boolean;
    error?: string;
    // Article viewer state
    currentArticle: RssArticle | null;

    addFeed: (url: string) => Promise<RssFeed | null>;
    removeFeed: (feedId: string) => void;
    refreshFeed: (feedId: string) => Promise<void>;
    refreshAll: () => Promise<void>;
    markArticleRead: (articleId: string) => void;
    toggleArticleFavorite: (articleId: string) => void;
    getArticlesForFeed: (feedId: string) => RssArticle[];
    getAllArticles: () => RssArticle[];
    openArticleInReader: (article: RssArticle) => Promise<void>;
    closeArticleViewer: () => void;
    setCurrentArticle: (article: RssArticle | null) => void;
    setError: (error?: string) => void;
}

export const useRssStore = create<RssStore>()(
    persist(
        (set, get) => ({
            feeds: [],
            articles: [],
            isLoading: false,
            error: undefined,
            currentArticle: null,

            addFeed: async (url: string) => {
                set({ isLoading: true, error: undefined });
                try {
                    const parsed = await fetchAndParseFeed(url);
                    const { feed, articles } = materializeFeed(url, parsed);

                    // Check for duplicate feed URL
                    const existing = get().feeds.find(f => f.url === url);
                    if (existing) {
                        set({ isLoading: false, error: 'This feed is already subscribed.' });
                        return null;
                    }

                    set(state => ({
                        feeds: [...state.feeds, feed],
                        articles: [...state.articles, ...articles],
                        isLoading: false,
                    }));
                    return feed;
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Failed to add feed';
                    set({ isLoading: false, error: message });
                    console.error('[RssStore] addFeed error:', err);
                    return null;
                }
            },

            removeFeed: (feedId: string) => {
                set(state => ({
                    feeds: state.feeds.filter(f => f.id !== feedId),
                    articles: state.articles.filter(a => a.feedId !== feedId),
                }));
            },

            refreshFeed: async (feedId: string) => {
                const feed = get().feeds.find(f => f.id === feedId);
                if (!feed) return;

                try {
                    const parsed = await fetchAndParseFeed(feed.url);
                    const now = new Date();

                    // Get existing article URLs to avoid duplicates
                    const existingUrls = new Set(
                        get().articles.filter(a => a.feedId === feedId).map(a => a.url),
                    );

                    const newArticles: RssArticle[] = parsed.articles
                        .filter(a => !existingUrls.has(a.url))
                        .map(a => ({
                            id: crypto.randomUUID(),
                            feedId,
                            title: a.title,
                            author: a.author,
                            url: a.url,
                            content: a.content,
                            summary: a.summary,
                            imageUrl: a.imageUrl,
                            publishedAt: a.publishedAt,
                            fetchedAt: now,
                            isRead: false,
                            isFavorite: false,
                        }));

                    set(state => {
                        const feedArticles = state.articles.filter(a => a.feedId === feedId);
                        const unreadCount = feedArticles.filter(a => !a.isRead).length + newArticles.length;
                        return {
                            articles: [...newArticles, ...state.articles],
                            feeds: state.feeds.map(f =>
                                f.id === feedId
                                    ? { ...f, lastFetched: now, errorMessage: undefined, unreadCount, title: parsed.feed.title || f.title }
                                    : f,
                            ),
                        };
                    });
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Refresh failed';
                    set(state => ({
                        feeds: state.feeds.map(f =>
                            f.id === feedId ? { ...f, errorMessage: message } : f,
                        ),
                    }));
                }
            },

            refreshAll: async () => {
                set({ isLoading: true });
                const feeds = get().feeds;
                await Promise.allSettled(feeds.map(f => get().refreshFeed(f.id)));
                set({ isLoading: false });
            },

            markArticleRead: (articleId: string) => {
                set(state => {
                    const article = state.articles.find(a => a.id === articleId);
                    if (!article) return state;
                    const wasRead = article.isRead;
                    return {
                        articles: state.articles.map(a =>
                            a.id === articleId ? { ...a, isRead: true } : a,
                        ),
                        feeds: wasRead ? state.feeds : state.feeds.map(f =>
                            f.id === article.feedId
                                ? { ...f, unreadCount: Math.max(0, f.unreadCount - 1) }
                                : f,
                        ),
                    };
                });
            },

            toggleArticleFavorite: (articleId: string) => {
                set(state => ({
                    articles: state.articles.map(a =>
                        a.id === articleId ? { ...a, isFavorite: !a.isFavorite } : a,
                    ),
                }));
            },

            getArticlesForFeed: (feedId: string) => {
                return get().articles
                    .filter(a => a.feedId === feedId)
                    .sort((a, b) => {
                        const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : new Date(a.fetchedAt).getTime();
                        const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : new Date(b.fetchedAt).getTime();
                        return dateB - dateA;
                    });
            },

            getAllArticles: () => {
                return get().articles
                    .sort((a, b) => {
                        const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : new Date(a.fetchedAt).getTime();
                        const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : new Date(b.fetchedAt).getTime();
                        return dateB - dateA;
                    });
            },

            openArticleInReader: async (article: RssArticle) => {
                // Mark article as read
                get().markArticleRead(article.id);

                // Open in dedicated full-screen article reader mode
                set({
                    currentArticle: article,
                });
                useUIStore.getState().setRoute('articleReader');
            },

            closeArticleViewer: () => {
                set({
                    currentArticle: null,
                });

                const ui = useUIStore.getState();
                if (ui.currentRoute === 'articleReader') {
                    ui.setRoute('feeds');
                }
            },

            setCurrentArticle: (article: RssArticle | null) => {
                set({ currentArticle: article });
            },

            setError: (error?: string) => {
                set({ error });
            },
        }),
        {
            name: 'theorem-rss',
            version: 1,
            partialize: (state) => ({
                feeds: state.feeds,
                articles: state.articles,
            }),
        },
    ),
);
