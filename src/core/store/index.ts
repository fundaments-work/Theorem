import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { applyReaderStyles, initReaderStyles } from "../lib/design-tokens";
import { syncVaultMarkdownSnapshot } from "../lib/vault-sync";
import { isMobile } from "../lib/env";
import { theoremPersistStorage } from "../lib/persist-storage";
import {
    lookupDictionaryTerm,
    vocabularyTermFromLookup,
    type DictionaryLookupResult,
} from "../services/DictionaryService";
import {
    importStarDictDictionary,
    removeStarDictDictionary,
} from "../services/StarDictService";
import { deleteBookStorage, cleanupOrphanedStorage } from "../lib/storage-manager";
import { getCoverImage } from "../lib/storage";
import type {
    Annotation,
    AppRoute,
    AppSettings,
    Book,
    Collection,
    HighlightColor,
    InstalledDictionary,
    VocabularySettings,
    PdfViewState,
    ReaderSettings,
    ReadingStats,
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
const defaultVocabularySettings: VocabularySettings = {
    vocabularyEnabled: true,
    dictionaryMode: "auto",
    preferredProviders: ["free_dictionary_api", "wiktionary", "stardict"],
    showPronunciation: true,
    playPronunciationAudio: false,
};

const defaultVaultSettings: AppSettings["vault"] = {
    enabled: false,
    vaultPath: "",
    autoExportHighlights: true,
    highlightsFileName: "theorem-highlights",
    vocabularyFileName: "theorem-vocabulary.md",
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
    vocabulary: defaultVocabularySettings,
    vault: defaultVaultSettings,
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
    setRoute: (route: AppRoute, bookId?: string, pushHistory?: boolean) => void;
    goBack: () => void;
    toggleSidebar: () => void;
    setSearchQuery: (query: string) => void;
    commitSearch: () => void;
    clearSearch: () => void;
    setSelectedBooks: (bookIds: string[]) => void;
    toggleBookSelection: (bookId: string) => void;
    clearSelection: () => void;
    setLoading: (loading: boolean, message?: string) => void;
    setError: (error?: string) => void;
    setVaultSyncStatus: (
        status: UIState["vaultSyncStatus"],
        message?: string,
        syncedAt?: string,
    ) => void;
    // Reader-specific UI
    setReaderToolbarVisible: (visible: boolean) => void;
    toggleReaderToolbar: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
    currentRoute: "library",
    currentBookId: undefined,
    sidebarOpen: !isMobile(), // Closed by default on mobile, open on desktop
    readerToolbarVisible: true,
    searchQuery: "",
    searchCommittedQuery: "",
    selectedBooks: [],
    isLoading: false,
    loadingMessage: undefined,
    error: undefined,
    vaultSyncStatus: "idle",
    vaultSyncMessage: undefined,
    vaultSyncAt: undefined,

    setRoute: (route, bookId, pushHistory = true) => {
        if (pushHistory && typeof window !== "undefined") {
            window.history.pushState({ route, bookId }, "");
        }
        set((state) => ({
            currentRoute: route,
            currentBookId: bookId,
            searchQuery: "",
            searchCommittedQuery: "",
        }));
    },
    goBack: () => {
        if (typeof window !== "undefined" && window.history.length > 1) {
            window.history.back();
        } else {
            set((state) => ({
                currentRoute: "library",
                currentBookId: undefined,
            }));
        }
    },
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    setSearchQuery: (query) => set({ searchQuery: query }),
    commitSearch: () => set((state) => ({
        searchCommittedQuery: state.searchQuery.trim(),
    })),
    clearSearch: () => set({ searchQuery: "", searchCommittedQuery: "" }),
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
    setVaultSyncStatus: (vaultSyncStatus, vaultSyncMessage, vaultSyncAt) =>
        set({ vaultSyncStatus, vaultSyncMessage, vaultSyncAt }),

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
const annotationsByBookCache = new WeakMap<Annotation[], Map<string, Annotation[]>>();
const COVER_RESTORE_BATCH_SIZE = 24;

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

function getAnnotationsByBookLookup(annotations: Annotation[]): Map<string, Annotation[]> {
    const existingLookup = annotationsByBookCache.get(annotations);
    if (existingLookup) {
        return existingLookup;
    }

    const nextLookup = new Map<string, Annotation[]>();
    for (const annotation of annotations) {
        const existingAnnotations = nextLookup.get(annotation.bookId);
        if (existingAnnotations) {
            existingAnnotations.push(annotation);
            continue;
        }
        nextLookup.set(annotation.bookId, [annotation]);
    }

    annotationsByBookCache.set(annotations, nextLookup);
    return nextLookup;
}

function getBookAnnotationSlice(annotations: Annotation[], bookId: string): Annotation[] {
    return getAnnotationsByBookLookup(annotations).get(bookId) ?? [];
}

function normalizeTermKey(term: string, language: string): string {
    return `${term.trim().toLowerCase()}::${language.trim().toLowerCase()}`;
}

function mergeBookIntoCachedEntry(entry: CachedBookMetadata, book: Book): CachedBookMetadata {
    return {
        ...entry,
        title: book.title,
        author: book.author,
        coverPath: book.coverPath,
        currentLocation: book.currentLocation,
        progress: book.progress,
        lastClickFraction: book.lastClickFraction,
        pageProgress: book.pageProgress,
        pdfViewState: book.pdfViewState,
        lastReadAt: book.lastReadAt || entry.lastReadAt,
    };
}

function syncRecentBooksCacheWithBook(
    cache: CachedBookMetadata[],
    book: Book,
): CachedBookMetadata[] {
    const index = cache.findIndex((entry) => entry.id === book.id);
    if (index === -1) {
        return cache;
    }

    const nextCache = cache.slice();
    nextCache[index] = mergeBookIntoCachedEntry(cache[index], book);
    return nextCache;
}

function normalizeContentHash(contentHash?: string): string | undefined {
    if (typeof contentHash !== "string") {
        return undefined;
    }

    const normalized = contentHash.trim().toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
}

function findDuplicateBookIndex(books: Book[], incomingBook: Book): number {
    const incomingHash = normalizeContentHash(incomingBook.contentHash);
    if (incomingHash) {
        const byHashIndex = books.findIndex(
            (book) => normalizeContentHash(book.contentHash) === incomingHash,
        );
        if (byHashIndex !== -1) {
            return byHashIndex;
        }
    }

    return books.findIndex((book) => {
        const sameStoragePath = Boolean(
            incomingBook.storagePath
            && book.storagePath
            && incomingBook.storagePath === book.storagePath,
        );
        if (sameStoragePath) {
            return true;
        }

        return (
            incomingBook.filePath === book.filePath
            && incomingBook.format === book.format
            && incomingBook.fileSize === book.fileSize
        );
    });
}

function isPlaceholderTitle(title: string): boolean {
    return title === "Unknown" || title.includes(".");
}

function isPlaceholderAuthor(author: string): boolean {
    return author === "Unknown Author" || author.trim().length === 0;
}

function mergeImportedBookMetadata(existingBook: Book, incomingBook: Book): Book {
    let changed = false;
    const nextBook = { ...existingBook };

    if (!existingBook.contentHash && incomingBook.contentHash) {
        nextBook.contentHash = incomingBook.contentHash;
        changed = true;
    }

    if (!existingBook.coverPath && incomingBook.coverPath) {
        nextBook.coverPath = incomingBook.coverPath;
        changed = true;
    }

    if (!existingBook.coverExtractionDone && incomingBook.coverExtractionDone) {
        nextBook.coverExtractionDone = true;
        changed = true;
    }

    if (isPlaceholderTitle(existingBook.title) && incomingBook.title && !isPlaceholderTitle(incomingBook.title)) {
        nextBook.title = incomingBook.title;
        changed = true;
    }

    if (isPlaceholderAuthor(existingBook.author) && incomingBook.author && !isPlaceholderAuthor(incomingBook.author)) {
        nextBook.author = incomingBook.author;
        changed = true;
    }

    if (!existingBook.description && incomingBook.description) {
        nextBook.description = incomingBook.description;
        changed = true;
    }

    if (!existingBook.publisher && incomingBook.publisher) {
        nextBook.publisher = incomingBook.publisher;
        changed = true;
    }

    if (!existingBook.publishedDate && incomingBook.publishedDate) {
        nextBook.publishedDate = incomingBook.publishedDate;
        changed = true;
    }

    if (!existingBook.language && incomingBook.language) {
        nextBook.language = incomingBook.language;
        changed = true;
    }

    if (!existingBook.isbn && incomingBook.isbn) {
        nextBook.isbn = incomingBook.isbn;
        changed = true;
    }

    return changed ? nextBook : existingBook;
}

function cleanupDiscardedImportedBook(book: Book): void {
    if (!book.id) {
        return;
    }

    deleteBookStorage(book.id).catch((error) => {
        console.error("[LibraryStore] Failed to cleanup duplicate imported book storage:", error);
    });
}

function normalizePersistedBook(book: Book): Book {
    const contentHash = normalizeContentHash(book.contentHash);
    const hasLegacyPersistedCoverPath = typeof book.coverPath === "string" && book.coverPath.length > 0;

    return {
        ...book,
        contentHash,
        coverExtractionDone: Boolean(book.coverExtractionDone || hasLegacyPersistedCoverPath),
    };
}

function collectBookIdsMissingCoverPath(
    books: Book[],
    recentBooksCache: CachedBookMetadata[],
): string[] {
    const ids = new Set<string>();

    for (const book of books) {
        if (!book.coverPath) {
            ids.add(book.id);
        }
    }

    for (const cachedBook of recentBooksCache) {
        if (!cachedBook.coverPath) {
            ids.add(cachedBook.id);
        }
    }

    return [...ids];
}

async function loadCoverLookup(bookIds: string[]): Promise<Map<string, string>> {
    const coverLookup = new Map<string, string>();

    for (let i = 0; i < bookIds.length; i += COVER_RESTORE_BATCH_SIZE) {
        const batchIds = bookIds.slice(i, i + COVER_RESTORE_BATCH_SIZE);
        const batchEntries = await Promise.all(
            batchIds.map(async (bookId) => {
                const coverPath = await getCoverImage(bookId);
                return [bookId, coverPath] as const;
            }),
        );

        for (const [bookId, coverPath] of batchEntries) {
            if (coverPath) {
                coverLookup.set(bookId, coverPath);
            }
        }
    }

    return coverLookup;
}

function applyCoverLookupToBooks(books: Book[], coverLookup: Map<string, string>): Book[] {
    let changed = false;

    const nextBooks = books.map((book) => {
        if (book.coverPath) {
            return book;
        }

        const restoredCoverPath = coverLookup.get(book.id);
        if (!restoredCoverPath) {
            return book;
        }

        changed = true;
        return {
            ...book,
            coverPath: restoredCoverPath,
        };
    });

    return changed ? nextBooks : books;
}

function applyCoverLookupToRecentCache(
    recentBooksCache: CachedBookMetadata[],
    coverLookup: Map<string, string>,
): CachedBookMetadata[] {
    let changed = false;

    const nextCache = recentBooksCache.map((cachedBook) => {
        if (cachedBook.coverPath) {
            return cachedBook;
        }

        const restoredCoverPath = coverLookup.get(cachedBook.id);
        if (!restoredCoverPath) {
            return cachedBook;
        }

        changed = true;
        return {
            ...cachedBook,
            coverPath: restoredCoverPath,
        };
    });

    return changed ? nextCache : recentBooksCache;
}

type LegacyCollection = Omit<Collection, "kind"> & {
    kind?: "general" | "research";
};

function normalizeCollectionKind(collection: LegacyCollection): Collection | null {
    if (collection.kind === "research") {
        return null;
    }

    return {
        ...collection,
        kind: "general",
    };
}

let vaultSyncQueue: Promise<void> = Promise.resolve();

function queueVaultSync(annotation: Annotation): void {
    const { settings } = useSettingsStore.getState();
    const { setVaultSyncStatus } = useUIStore.getState();

    if (!settings.vault.enabled || !settings.vault.autoExportHighlights) {
        return;
    }

    if (annotation.type !== "highlight" && annotation.type !== "note") {
        return;
    }

    setVaultSyncStatus("syncing", "STATUS: SYNCING_MARKDOWN_EXPORT");

    vaultSyncQueue = vaultSyncQueue
        .catch(() => undefined)
        .then(async () => {
            const { books, annotations } = useLibraryStore.getState();
            const { articles } = useRssStore.getState();
            const { vocabularyTerms } = useVocabularyStore.getState();
            const result = await syncVaultMarkdownSnapshot({
                books,
                annotations,
                rssArticles: articles,
                vocabularyTerms,
                settings: settings.vault,
            });

            if (result.status === "synced") {
                setVaultSyncStatus("synced", result.message, new Date().toISOString());
                return;
            }

            if (result.status === "error") {
                setVaultSyncStatus("error", result.message);
                return;
            }

            setVaultSyncStatus("idle", result.message);
        });
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
    // Marks when cover paths stripped from persisted state have been restored from IDB.
    coversHydrated: boolean;

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

type PersistedLibraryState = Pick<
    LibraryStore,
    "books" | "collections" | "annotations" | "lastScannedAt" | "recentBooksCache"
>;

export const useLibraryStore = create<LibraryStore>()(
    persist(
        (set, get) => ({
            books: [],
            collections: [],
            annotations: [],
            recentBooksCache: [],
            coversHydrated: false,

            // Book actions
            addBook: (book) => {
                const state = get();
                const duplicateIndex = findDuplicateBookIndex(state.books, book);

                if (duplicateIndex === -1) {
                    set({ books: [...state.books, book] });
                    return;
                }

                const duplicateBook = state.books[duplicateIndex];
                if (duplicateBook.id !== book.id) {
                    cleanupDiscardedImportedBook(book);
                }

                const mergedBook = mergeImportedBookMetadata(duplicateBook, book);
                if (mergedBook === duplicateBook) {
                    return;
                }

                const books = state.books.slice();
                books[duplicateIndex] = mergedBook;

                const recentBooksCache = syncRecentBooksCacheWithBook(
                    state.recentBooksCache,
                    mergedBook,
                );

                set(
                    recentBooksCache === state.recentBooksCache
                        ? { books }
                        : { books, recentBooksCache },
                );
            },

            addBooks: (incomingBooks) => {
                if (incomingBooks.length === 0) {
                    return;
                }

                const state = get();
                let nextBooks = state.books;
                let nextRecentBooksCache = state.recentBooksCache;
                let booksChanged = false;
                let cacheChanged = false;

                for (const incomingBook of incomingBooks) {
                    const duplicateIndex = findDuplicateBookIndex(nextBooks, incomingBook);

                    if (duplicateIndex === -1) {
                        if (!booksChanged) {
                            nextBooks = nextBooks.slice();
                            booksChanged = true;
                        }
                        nextBooks.push(incomingBook);
                        continue;
                    }

                    const duplicateBook = nextBooks[duplicateIndex];
                    if (duplicateBook.id !== incomingBook.id) {
                        cleanupDiscardedImportedBook(incomingBook);
                    }

                    const mergedBook = mergeImportedBookMetadata(duplicateBook, incomingBook);
                    if (mergedBook !== duplicateBook) {
                        if (!booksChanged) {
                            nextBooks = nextBooks.slice();
                            booksChanged = true;
                        }
                        nextBooks[duplicateIndex] = mergedBook;

                        const updatedCache = syncRecentBooksCacheWithBook(
                            nextRecentBooksCache,
                            mergedBook,
                        );
                        if (updatedCache !== nextRecentBooksCache) {
                            nextRecentBooksCache = updatedCache;
                            cacheChanged = true;
                        }
                    }
                }

                if (!booksChanged && !cacheChanged) {
                    return;
                }

                set(
                    cacheChanged
                        ? { books: nextBooks, recentBooksCache: nextRecentBooksCache }
                        : { books: nextBooks },
                );
            },

            removeBook: async (bookId) => {
                const book = get().books.find((b) => b.id === bookId);

                // Clean up storage first (don't await to keep UI responsive)
                if (book) {
                    deleteBookStorage(bookId).catch((error) => {
                        console.error('[LibraryStore] Failed to delete book storage:', error);
                    });
                }

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
            },

            updateBook: (bookId, updates) =>
                set((state) => {
                    const { books, updatedBook } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        ...updates,
                    }));
                    if (!updatedBook) {
                        return { books };
                    }

                    const recentBooksCache = syncRecentBooksCacheWithBook(
                        state.recentBooksCache,
                        updatedBook,
                    );
                    return recentBooksCache === state.recentBooksCache
                        ? { books }
                        : { books, recentBooksCache };
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
                    const { books, updatedBook } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        isFavorite: !book.isFavorite,
                    }));
                    if (!updatedBook) {
                        return { books };
                    }

                    const recentBooksCache = syncRecentBooksCacheWithBook(
                        state.recentBooksCache,
                        updatedBook,
                    );
                    return recentBooksCache === state.recentBooksCache
                        ? { books }
                        : { books, recentBooksCache };
                }),

            updateBookMetadata: (bookId, metadata) =>
                set((state) => {
                    const { books, updatedBook } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        ...metadata,
                    }));
                    if (!updatedBook) {
                        return { books };
                    }

                    const recentBooksCache = syncRecentBooksCacheWithBook(
                        state.recentBooksCache,
                        updatedBook,
                    );
                    return recentBooksCache === state.recentBooksCache
                        ? { books }
                        : { books, recentBooksCache };
                }),

            saveBookLocations: (bookId, locations) =>
                set((state) => {
                    const { books, updatedBook } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        locations,
                    }));
                    if (!updatedBook) {
                        return { books };
                    }

                    const recentBooksCache = syncRecentBooksCacheWithBook(
                        state.recentBooksCache,
                        updatedBook,
                    );
                    return recentBooksCache === state.recentBooksCache
                        ? { books }
                        : { books, recentBooksCache };
                }),

            // Reading time tracking
            addReadingTime: (bookId, minutes) =>
                set((state) => {
                    const { books, updatedBook } = updateBookById(state.books, bookId, (book) => ({
                        ...book,
                        readingTime: (book.readingTime || 0) + minutes,
                    }));
                    if (!updatedBook) {
                        return { books };
                    }

                    const recentBooksCache = syncRecentBooksCacheWithBook(
                        state.recentBooksCache,
                        updatedBook,
                    );
                    return recentBooksCache === state.recentBooksCache
                        ? { books }
                        : { books, recentBooksCache };
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
                queueVaultSync(annotation);
            },

            addHighlightWithNote: (cfi, text, color, note) => {
                const currentBookId = get().currentBookId || '';
                const annotation: Annotation = {
                    id: crypto.randomUUID(),
                    bookId: currentBookId,
                    referenceId: currentBookId || undefined,
                    type: note ? 'note' : 'highlight',
                    location: cfi,
                    selectedText: text,
                    color,
                    noteContent: note,
                    createdAt: new Date(),
                };
                set((state) => ({ annotations: [...state.annotations, annotation] }));
                queueVaultSync(annotation);
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

                const syncedAnnotation = get().annotations.find((annotation) => annotation.id === annotationId);
                if (syncedAnnotation) {
                    queueVaultSync(syncedAnnotation);
                }
            },

            removeAnnotation: (annotationId) => {
                set((state) => ({
                    annotations: state.annotations.filter((a) => a.id !== annotationId),
                }));
            },

            getBookAnnotations: (bookId) =>
                getBookAnnotationSlice(get().annotations, bookId),

            getHighlights: (bookId) =>
                getBookAnnotationSlice(get().annotations, bookId)
                    .filter((annotation) => annotation.type === 'highlight' || annotation.type === 'note'),

            getBookmarks: (bookId) =>
                getBookAnnotationSlice(get().annotations, bookId)
                    .filter((annotation) => annotation.type === 'bookmark'),

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
            version: 4,
            storage: createJSONStorage(() => theoremPersistStorage),
            migrate: (persistedState, _version) => {
                const persisted = (
                    typeof persistedState === "object" && persistedState !== null
                        ? persistedState
                        : {}
                ) as Partial<PersistedLibraryState>;

                const books = Array.isArray(persisted.books)
                    ? (persisted.books as Book[]).map((book) => normalizePersistedBook(book))
                    : [];
                const collections = Array.isArray(persisted.collections)
                    ? (persisted.collections as LegacyCollection[])
                        .map((collection) => normalizeCollectionKind(collection))
                        .filter((collection): collection is Collection => Boolean(collection))
                    : [];
                const annotations = Array.isArray(persisted.annotations)
                    ? (persisted.annotations as Annotation[]).map((annotation) => ({
                        ...annotation,
                        referenceId: typeof annotation.referenceId === "string"
                            ? annotation.referenceId
                            : undefined,
                    }))
                    : [];
                const lastScannedAt = persisted.lastScannedAt
                    ? new Date(persisted.lastScannedAt)
                    : undefined;
                const recentBooksCache = Array.isArray(persisted.recentBooksCache)
                    ? persisted.recentBooksCache as CachedBookMetadata[]
                    : [];

                return {
                    books,
                    collections,
                    annotations,
                    lastScannedAt,
                    recentBooksCache,
                } as PersistedLibraryState;
            },
            partialize: (state): PersistedLibraryState => ({
                // Strip coverPath from books to reduce storage size (covers are in IDB)
                books: state.books.map(({ coverPath: _, ...book }) => book) as Book[],
                collections: state.collections,
                annotations: state.annotations,
                lastScannedAt: state.lastScannedAt,
                recentBooksCache: state.recentBooksCache.map(({ coverPath: _, ...book }) => book) as CachedBookMetadata[],
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) {
                    useLibraryStore.setState({ coversHydrated: true });
                    return;
                }

                state.collections = state.collections
                    .map((collection) => normalizeCollectionKind(collection as LegacyCollection))
                    .filter((collection): collection is Collection => Boolean(collection));
                state.annotations = state.annotations.map((annotation) => ({
                    ...annotation,
                    referenceId: typeof annotation.referenceId === "string"
                        ? annotation.referenceId
                        : undefined,
                }));

                const bookIdsMissingCoverPath = collectBookIdsMissingCoverPath(
                    state.books,
                    state.recentBooksCache,
                );

                if (bookIdsMissingCoverPath.length === 0) {
                    useLibraryStore.setState({ coversHydrated: true });
                    return;
                }

                void (async () => {
                    try {
                        const coverLookup = await loadCoverLookup(bookIdsMissingCoverPath);
                        if (coverLookup.size === 0) {
                            return;
                        }

                        useLibraryStore.setState((currentState) => {
                            const books = applyCoverLookupToBooks(currentState.books, coverLookup);
                            const recentBooksCache = applyCoverLookupToRecentCache(
                                currentState.recentBooksCache,
                                coverLookup,
                            );

                            if (
                                books === currentState.books
                                && recentBooksCache === currentState.recentBooksCache
                            ) {
                                return currentState;
                            }

                            return {
                                books,
                                recentBooksCache,
                            };
                        });
                    } finally {
                        useLibraryStore.setState({ coversHydrated: true });
                    }
                })();
            },
        }
    )
);

// Settings Store
interface SettingsStore {
    settings: AppSettings;
    stats: ReadingStats;

    updateSettings: (updates: Partial<AppSettings>) => void;
    updateReaderSettings: (updates: Partial<ReaderSettings>) => void;
    updateVocabularySettings: (updates: Partial<VocabularySettings>) => void;
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

            updateVocabularySettings: (updates) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        vocabulary: {
                            ...state.settings.vocabulary,
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
            version: 2,
            storage: createJSONStorage(() => theoremPersistStorage),
            migrate: (persistedState, version) => {
                const state = (
                    typeof persistedState === "object" && persistedState !== null
                        ? persistedState
                        : {}
                ) as any;

                // Migration: rename settings.learning → settings.vocabulary
                if (version === 0 || !version) {
                    if (state.settings && state.settings.learning && !state.settings.vocabulary) {
                        state.settings.vocabulary = state.settings.learning;
                        delete state.settings.learning;
                    }

                    // Ensure vocabulary settings exist if missing
                    if (state.settings && !state.settings.vocabulary) {
                        state.settings.vocabulary = defaultVocabularySettings;
                    }
                }

                if (!state.settings) {
                    state.settings = {
                        ...defaultAppSettings,
                        readerSettings: { ...defaultReaderSettings },
                        vocabulary: { ...defaultVocabularySettings },
                        vault: { ...defaultVaultSettings },
                    };
                } else {
                    state.settings = {
                        ...defaultAppSettings,
                        ...state.settings,
                        readerSettings: {
                            ...defaultReaderSettings,
                            ...(state.settings.readerSettings || {}),
                        },
                        vocabulary: {
                            ...defaultVocabularySettings,
                            ...(state.settings.vocabulary || {}),
                        },
                        vault: {
                            ...defaultVaultSettings,
                            ...(state.settings.vault || {}),
                        },
                    };
                }

                if (!state.stats) {
                    state.stats = {
                        ...defaultReadingStats,
                        dailyActivity: [...defaultReadingStats.dailyActivity],
                    };
                } else if (!Array.isArray(state.stats.dailyActivity)) {
                    state.stats.dailyActivity = [];
                }

                return state;
            },
            onRehydrateStorage: () => (state) => {
                // Apply saved reader settings when store is rehydrated
                if (state?.settings.readerSettings) {
                    initReaderStyles(state.settings.readerSettings);
                }

                if (state && !state.settings.vocabulary) {
                    state.settings.vocabulary = defaultVocabularySettings;
                } else if (state?.settings.vocabulary) {
                    state.settings.vocabulary = {
                        ...defaultVocabularySettings,
                        ...state.settings.vocabulary,
                    };
                }

                if (state && !state.settings.vault) {
                    state.settings.vault = defaultVaultSettings;
                } else if (state?.settings.vault) {
                    state.settings.vault = {
                        ...defaultVaultSettings,
                        ...state.settings.vault,
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

interface VocabularyStore {
    vocabularyTerms: VocabularyTerm[];
    installedDictionaries: InstalledDictionary[];
    lookupCache: Record<string, DictionaryLookupResult>;

    saveVocabularyTerm: (term: VocabularyTerm, context?: SaveVocabularyContextInput) => VocabularyTerm;
    updateVocabularyTerm: (termId: string, updates: Partial<VocabularyTerm>) => void;
    deleteVocabularyTerm: (termId: string) => void;
    lookupTerm: (term: string, language?: string) => Promise<DictionaryLookupResult | null>;
    lookupAndSaveTerm: (term: string, language?: string) => Promise<VocabularyTerm | null>;

    importStarDict: (files: FileList | File[]) => Promise<InstalledDictionary>;
    removeDictionary: (dictionaryId: string) => Promise<void>;
}

interface SaveVocabularyContextInput {
    sourceType: VocabularyContextSourceType;
    sourceId: string;
    label: string;
}

const LEGACY_VOCABULARY_CONTEXT_LABEL = "Legacy / Unknown source";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
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

function normalizeVocabularyTerm(term: VocabularyTerm): VocabularyTerm {
    const now = new Date();
    const normalized = {
        ...term,
    } as VocabularyTerm & { linkedCardId?: string; lastReviewedAt?: Date | string | number };
    if ("linkedCardId" in normalized) {
        delete normalized.linkedCardId;
    }
    if ("lastReviewedAt" in normalized) {
        delete normalized.lastReviewedAt;
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
    };
}

function normalizeVocabularyLookupCache(
    value: unknown,
): Record<string, DictionaryLookupResult> {
    if (!isRecord(value)) {
        return {};
    }

    return value as Record<string, DictionaryLookupResult>;
}

export const useVocabularyStore = create<VocabularyStore>()(
    persist(
        (set, get) => ({
            vocabularyTerms: [],
            installedDictionaries: [],
            lookupCache: {},

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
            },

            deleteVocabularyTerm: (termId) => {
                set((state) => ({
                    vocabularyTerms: state.vocabularyTerms.filter((term) => term.id !== termId),
                }));
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

                const settings = useSettingsStore.getState().settings.vocabulary;
                const installedIds = get().installedDictionaries.map((dictionary) => dictionary.id);

                const result = await lookupDictionaryTerm({
                    term,
                    language,
                    mode: settings.dictionaryMode,
                    installedDictionaryIds: installedIds,
                });

                if (result) {
                    set((state) => {
                        const MAX_CACHE_SIZE = 100; // Limit cache to 100 entries
                        const newCache = { ...state.lookupCache, [cacheKey]: result };
                        const cacheKeys = Object.keys(newCache);

                        // If cache exceeds max size, remove oldest entries (LRU eviction)
                        if (cacheKeys.length > MAX_CACHE_SIZE) {
                            const keysToRemove = cacheKeys.slice(0, cacheKeys.length - MAX_CACHE_SIZE);
                            keysToRemove.forEach(key => delete newCache[key]);
                        }

                        return { lookupCache: newCache };
                    });
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
        }),
        {
            name: "theorem-vocabulary",
            version: 4,
            storage: createJSONStorage(() => theoremPersistStorage),
            migrate: (persistedState, _version) => {
                const persisted = isRecord(persistedState) ? persistedState : {};
                const {
                    preferredTab: _preferredTab,
                    reviewRecords: _reviewRecords,
                    reviewEvents: _reviewEvents,
                    dailyReminderState: _dailyReminderState,
                    reviewSessionState: _reviewSessionState,
                    ...persistedWithoutLegacyReviewFields
                } = persisted;
                const vocabularyTermsRaw = Array.isArray(persisted.vocabularyTerms)
                    ? persisted.vocabularyTerms
                    : [];
                const vocabularyTerms = vocabularyTermsRaw.map((term) => {
                    if (!isRecord(term)) {
                        return term;
                    }
                    const {
                        linkedCardId: _linkedCardId,
                        lastReviewedAt: _lastReviewedAt,
                        ...rest
                    } = term;
                    return rest;
                });
                const installedDictionaries = Array.isArray(persisted.installedDictionaries)
                    ? persisted.installedDictionaries
                    : [];
                const lookupCache = normalizeVocabularyLookupCache(persisted.lookupCache);

                return {
                    ...persistedWithoutLegacyReviewFields,
                    vocabularyTerms,
                    installedDictionaries,
                    lookupCache,
                } as VocabularyStore;
            },
            partialize: (state) => ({
                // Exclude lookupCache from persistence to reduce storage size
                vocabularyTerms: state.vocabularyTerms,
                installedDictionaries: state.installedDictionaries,
            }),
            onRehydrateStorage: () => (state) => {
                if (!state) {
                    return;
                }

                state.vocabularyTerms = (state.vocabularyTerms || []).map((term) => (
                    normalizeVocabularyTerm(term)
                ));

                state.installedDictionaries = (state.installedDictionaries || []).map((dictionary) => ({
                    ...dictionary,
                    importedAt: toValidDate(dictionary.importedAt, new Date()),
                }));

                // Initialize empty lookup cache on rehydrate
                state.lookupCache = {};
            },
        },
    ),
);

// ── RSS Feed Store ──

import type { RssFeed, RssArticle } from '../types';
import {
    fetchAndExtractArticleContent,
    fetchAndParseFeed,
    materializeFeed,
} from '../services/RssService';

const rssArticleSortCache = new WeakMap<RssArticle[], {
    allSorted: RssArticle[];
    feedSorted: Map<string, RssArticle[]>;
}>();

function getRssArticleTimestamp(article: RssArticle): number {
    const dateValue = article.publishedAt ?? article.fetchedAt;
    const timestamp = new Date(dateValue).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortRssArticlesByDateDesc(articles: RssArticle[]): RssArticle[] {
    const sortable = articles.map((article, index) => ({
        article,
        timestamp: getRssArticleTimestamp(article),
        index,
    }));

    sortable.sort((left, right) => {
        if (right.timestamp !== left.timestamp) {
            return right.timestamp - left.timestamp;
        }
        return left.index - right.index;
    });

    return sortable.map((entry) => entry.article);
}

function getSortedRssArticleLookup(articles: RssArticle[]): {
    allSorted: RssArticle[];
    feedSorted: Map<string, RssArticle[]>;
} {
    const existingLookup = rssArticleSortCache.get(articles);
    if (existingLookup) {
        return existingLookup;
    }

    const allSorted = sortRssArticlesByDateDesc(articles);
    const nextLookup = {
        allSorted,
        feedSorted: new Map<string, RssArticle[]>(),
    };
    rssArticleSortCache.set(articles, nextLookup);
    return nextLookup;
}

function getSortedRssArticlesForFeed(articles: RssArticle[], feedId: string): RssArticle[] {
    const lookup = getSortedRssArticleLookup(articles);
    const existingFeedArticles = lookup.feedSorted.get(feedId);
    if (existingFeedArticles) {
        return existingFeedArticles;
    }

    const nextFeedArticles = lookup.allSorted.filter((article) => article.feedId === feedId);
    lookup.feedSorted.set(feedId, nextFeedArticles);
    return nextFeedArticles;
}

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
                return getSortedRssArticlesForFeed(get().articles, feedId);
            },

            getAllArticles: () => {
                return getSortedRssArticleLookup(get().articles).allSorted;
            },

            openArticleInReader: async (article: RssArticle) => {
                // Mark article as read
                get().markArticleRead(article.id);

                // Open article in the unified reader route
                set({
                    currentArticle: article,
                });
                useUIStore.getState().setRoute('reader');

                // Try to fetch and extract the full article content from the source URL.
                // If extraction fails, we keep using feed-provided content as a safe fallback.
                if (!article.url) {
                    return;
                }

                const plainTextLength = article.content
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .length;
                if (plainTextLength >= 2200) {
                    // Looks like a full-text article already; avoid unnecessary network fetches.
                    return;
                }

                try {
                    const extracted = await fetchAndExtractArticleContent(article.url);
                    const articlePatch: Partial<RssArticle> = {
                        content: extracted.content,
                    };

                    if (extracted.title) {
                        articlePatch.title = extracted.title;
                    }
                    if (extracted.summary) {
                        articlePatch.summary = extracted.summary;
                    }
                    if (extracted.author) {
                        articlePatch.author = extracted.author;
                    }
                    if (extracted.imageUrl) {
                        articlePatch.imageUrl = extracted.imageUrl;
                    }
                    if (extracted.publishedAt) {
                        articlePatch.publishedAt = extracted.publishedAt;
                    }

                    const articleAnnotationBookId = `rss:${article.id}`;
                    const hasExistingArticleAnnotations = useLibraryStore.getState().annotations
                        .some((entry) => entry.bookId === articleAnnotationBookId);

                    set((state) => ({
                        articles: state.articles.map((entry) => (
                            entry.id === article.id
                                ? { ...entry, ...articlePatch }
                                : entry
                        )),
                        // Do not replace currently-open reader content once annotations exist,
                        // otherwise highlight render anchors can be invalidated mid-session.
                        currentArticle: (
                            !hasExistingArticleAnnotations
                            && state.currentArticle?.id === article.id
                        )
                            ? { ...state.currentArticle, ...articlePatch }
                            : state.currentArticle,
                    }));
                } catch (error) {
                    console.warn('[RssStore] Failed to load full article content, using feed content fallback:', error);
                }
            },

            closeArticleViewer: () => {
                set({
                    currentArticle: null,
                });

                const ui = useUIStore.getState();
                if (ui.currentRoute === 'reader') {
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
            storage: createJSONStorage(() => theoremPersistStorage),
            partialize: (state) => {
                const MAX_ARTICLES = 500; // Keep only last 500 articles
                const MAX_ARTICLE_AGE_DAYS = 30; // Remove articles older than 30 days

                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - MAX_ARTICLE_AGE_DAYS);

                // Filter out old articles and limit total count
                const filteredArticles = state.articles
                    .filter(article => {
                        const articleDate = article.publishedAt || article.fetchedAt;
                        return new Date(articleDate) >= cutoffDate;
                    })
                    .slice(0, MAX_ARTICLES);

                // Truncate article content to reduce storage size (keep first 50KB)
                const truncatedArticles = filteredArticles.map(article => ({
                    ...article,
                    content: article.content.length > 50000
                        ? article.content.slice(0, 50000) + '... [truncated]'
                        : article.content,
                }));

                return {
                    feeds: state.feeds,
                    articles: truncatedArticles,
                };
            },
        },
    ),
);
