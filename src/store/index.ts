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
} from "@/types";

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
        set({ currentRoute: route, currentBookId: bookId }),
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
    lastReadAt: book.lastReadAt || new Date(),
});

// Library Store
interface LibraryStore {
    books: Book[];
    collections: Collection[];
    annotations: Annotation[];
    lastScannedAt?: Date;
    // Cache for quick access to recently opened books
    recentBooksCache: CachedBookMetadata[];

    // Book actions
    addBook: (book: Book) => void;
    addBooks: (books: Book[]) => void;
    removeBook: (bookId: string) => void;
    updateBook: (bookId: string, updates: Partial<Book>) => void;
    updateProgress: (bookId: string, progress: number, location: string, lastClickFraction?: number, pageProgress?: { currentPage: number; endPage?: number; totalPages: number; range: string }) => void;
    toggleFavorite: (bookId: string) => void;
    updateBookMetadata: (bookId: string, metadata: Partial<Book>) => void;
    saveBookLocations: (bookId: string, locations: string) => void;

    // Collection actions
    addCollection: (collection: Collection) => void;
    removeCollection: (collectionId: string) => void;
    addBookToCollection: (bookId: string, collectionId: string) => void;
    removeBookFromCollection: (bookId: string, collectionId: string) => void;

    // Annotation actions
    addAnnotation: (annotation: Annotation) => void;
    updateAnnotation: (annotationId: string, updates: Partial<Annotation>) => void;
    removeAnnotation: (annotationId: string) => void;
    getBookAnnotations: (bookId: string) => Annotation[];

    // Getters
    getBook: (bookId: string) => Book | undefined;
    getRecentBooks: (limit?: number) => Book[];
    getFavoriteBooks: () => Book[];
    getBooksByCategory: (category: string) => Book[];
    searchBooks: (query: string) => Book[];
    getCachedBook: (bookId: string) => CachedBookMetadata | undefined;

    // Scanning
    setLastScannedAt: (date: Date) => void;

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
                })),

            updateBook: (bookId, updates) =>
                set((state) => ({
                    books: state.books.map((b) =>
                        b.id === bookId ? { ...b, ...updates } : b
                    ),
                })),

            updateProgress: (bookId, progress, location, lastClickFraction, pageProgress) =>
                set((state) => {
                    const updatedBooks = state.books.map((b) =>
                        b.id === bookId
                            ? {
                                ...b,
                                progress,
                                currentLocation: location,
                                ...(lastClickFraction !== undefined && { lastClickFraction }),
                                ...(pageProgress !== undefined && { pageProgress }),
                                lastReadAt: new Date()
                            }
                            : b
                    );

                    // Update cache as well for fast access
                    const book = updatedBooks.find(b => b.id === bookId);
                    if (book) {
                        const existingCache = state.recentBooksCache.filter(b => b.id !== bookId);
                        const newCache = [createCacheEntry(book), ...existingCache].slice(0, 20);
                        return { books: updatedBooks, recentBooksCache: newCache };
                    }

                    return { books: updatedBooks };
                }),

            toggleFavorite: (bookId) =>
                set((state) => ({
                    books: state.books.map((b) =>
                        b.id === bookId ? { ...b, isFavorite: !b.isFavorite } : b
                    ),
                })),

            updateBookMetadata: (bookId, metadata) =>
                set((state) => ({
                    books: state.books.map((b) =>
                        b.id === bookId ? { ...b, ...metadata } : b
                    ),
                })),

            saveBookLocations: (bookId, locations) =>
                set((state) => ({
                    books: state.books.map((b) =>
                        b.id === bookId ? { ...b, locations } : b
                    ),
                })),

            // Collection actions
            addCollection: (collection) =>
                set((state) => ({ collections: [...state.collections, collection] })),

            removeCollection: (collectionId) =>
                set((state) => ({
                    collections: state.collections.filter((c) => c.id !== collectionId),
                })),

            addBookToCollection: (bookId, collectionId) =>
                set((state) => ({
                    collections: state.collections.map((c) =>
                        c.id === collectionId && !c.bookIds.includes(bookId)
                            ? { ...c, bookIds: [...c.bookIds, bookId] }
                            : c
                    ),
                })),

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

            // Getters
            getBook: (bookId) => get().books.find((b) => b.id === bookId),

            getRecentBooks: (limit = 10) =>
                [...get().books]
                    .filter((b) => b.lastReadAt)
                    .sort((a, b) =>
                        (b.lastReadAt?.getTime() || 0) - (a.lastReadAt?.getTime() || 0)
                    )
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

            getCachedBook: (bookId) => {
                return get().recentBooksCache.find(b => b.id === bookId);
            },

            setLastScannedAt: (date) => set({ lastScannedAt: date }),

        }),
        {
            name: "lion-reader-library",
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
        (set) => ({
            settings: defaultAppSettings,
            stats: defaultReadingStats,

            updateSettings: (updates) =>
                set((state) => ({
                    settings: { ...state.settings, ...updates },
                })),

            updateReaderSettings: (updates) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        readerSettings: { ...state.settings.readerSettings, ...updates },
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

            resetReaderSettings: () =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        readerSettings: defaultReaderSettings,
                    },
                })),
        }),
        {
            name: "lion-reader-settings",
        }
    )
);
