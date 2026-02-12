import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
    Book,
    Annotation,
    Collection,
    AppSettings,
    ReaderSettings,
    ReadingStats,
    UIState,
    AppRoute,
    HighlightColor,
    PdfViewState,
} from "@/types";
import { applyReaderStyles, initReaderStyles } from "@/lib/reader-styles";

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
const defaultAppSettings: AppSettings = {
    sidebarCollapsed: false,
    libraryViewMode: "grid",
    librarySortBy: "lastRead",
    librarySortOrder: "desc",
    scanFolders: [],
    cacheSize: 500, // MB
    theme: "system",
    readerSettings: defaultReaderSettings,
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
    markBookCompleted: (bookId: string) => { wasAlreadyCompleted: boolean; completedYear: number } | null;

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

            removeBook: (bookId) =>
                set((state) => ({
                    books: state.books.filter((b) => b.id !== bookId),
                    annotations: state.annotations.filter((a) => a.bookId !== bookId),
                    recentBooksCache: state.recentBooksCache.filter((b) => b.id !== bookId),
                    // Remove book from all collections to keep counts accurate
                    collections: state.collections.map((c) => ({
                        ...c,
                        bookIds: c.bookIds.filter((id) => id !== bookId),
                    })),
                })),

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
            markBookCompleted: (bookId) => {
                const book = get().books.find((b) => b.id === bookId);
                if (!book) return null;

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

                // Only update if not already completed
                if (!wasAlreadyCompleted) {
                    set((state) => ({
                        books: state.books.map((b) =>
                            b.id === bookId
                                ? { ...b, progress: 1.0, completedAt: now }
                                : b
                        ),
                    }));
                }

                return { wasAlreadyCompleted, completedYear };
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
            addAnnotation: (annotation) =>
                set((state) => ({ annotations: [...state.annotations, annotation] })),

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
                return annotation;
            },

            setCurrentBookId: (bookId) => set({ currentBookId: bookId }),

            updateAnnotation: (annotationId, updates) =>
                set((state) => ({
                    annotations: state.annotations.map((a) =>
                        a.id === annotationId ? { ...a, ...updates, updatedAt: new Date() } : a
                    ),
                })),

            removeAnnotation: (annotationId) =>
                set((state) => ({
                    annotations: state.annotations.filter((a) => a.id !== annotationId),
                })),

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
                
                // Migration: Ensure dailyActivity exists for old stored data
                if (state && !state.stats.dailyActivity) {
                    state.stats.dailyActivity = [];
                }
            },
        }
    )
);
