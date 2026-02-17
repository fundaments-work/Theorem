import { beforeEach, describe, expect, it } from "vitest";
import { useLibraryStore, useRssStore } from "../src/core/store";
import type { Annotation, Book, RssArticle } from "../src/core/types";

function createArticle(overrides: Partial<RssArticle>): RssArticle {
    return {
        id: overrides.id || crypto.randomUUID(),
        feedId: overrides.feedId || "feed-default",
        title: overrides.title || "Untitled",
        url: overrides.url || "https://example.com/article",
        content: overrides.content || "content",
        summary: overrides.summary,
        author: overrides.author,
        imageUrl: overrides.imageUrl,
        publishedAt: overrides.publishedAt,
        fetchedAt: overrides.fetchedAt || new Date(),
        isRead: overrides.isRead ?? false,
        isFavorite: overrides.isFavorite ?? false,
    };
}

function createAnnotation(overrides: Partial<Annotation>): Annotation {
    return {
        id: overrides.id || crypto.randomUUID(),
        bookId: overrides.bookId || "book-1",
        type: overrides.type || "highlight",
        location: overrides.location || "loc-1",
        selectedText: overrides.selectedText,
        noteContent: overrides.noteContent,
        color: overrides.color,
        createdAt: overrides.createdAt || new Date(),
        updatedAt: overrides.updatedAt,
        referenceId: overrides.referenceId,
        pageNumber: overrides.pageNumber,
        pdfAnnotationType: overrides.pdfAnnotationType,
        drawingData: overrides.drawingData,
        textNoteContent: overrides.textNoteContent,
        rect: overrides.rect,
        rects: overrides.rects,
        strokeWidth: overrides.strokeWidth,
    };
}

function createBook(overrides: Partial<Book>): Book {
    return {
        id: overrides.id || crypto.randomUUID(),
        title: overrides.title || "Untitled",
        author: overrides.author ?? "Unknown",
        filePath: overrides.filePath || `/tmp/${overrides.id || "book"}.epub`,
        storagePath: overrides.storagePath,
        format: overrides.format || "epub",
        contentHash: overrides.contentHash,
        coverPath: overrides.coverPath,
        coverExtractionDone: overrides.coverExtractionDone,
        description: overrides.description,
        publisher: overrides.publisher,
        publishedDate: overrides.publishedDate,
        language: overrides.language,
        isbn: overrides.isbn,
        fileSize: overrides.fileSize ?? 1234,
        addedAt: overrides.addedAt || new Date(),
        lastReadAt: overrides.lastReadAt,
        progress: overrides.progress ?? 0,
        currentLocation: overrides.currentLocation,
        lastClickFraction: overrides.lastClickFraction,
        pageProgress: overrides.pageProgress,
        pdfViewState: overrides.pdfViewState,
        locations: overrides.locations,
        category: overrides.category,
        tags: overrides.tags || [],
        rating: overrides.rating,
        isFavorite: overrides.isFavorite ?? false,
        manualCompletionState: overrides.manualCompletionState,
        progressBeforeFinish: overrides.progressBeforeFinish,
        readingTime: overrides.readingTime ?? 0,
        completedAt: overrides.completedAt,
    };
}

function clearStorage(storage: Storage | undefined): void {
    if (!storage) {
        return;
    }

    if (typeof storage.clear === "function") {
        storage.clear();
        return;
    }

    if (
        typeof storage.length === "number"
        && typeof storage.key === "function"
        && typeof storage.removeItem === "function"
    ) {
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key) {
                keys.push(key);
            }
        }
        keys.forEach((key) => storage.removeItem(key));
    }
}

function resetStores(): void {
    clearStorage(globalThis.localStorage as Storage | undefined);
    clearStorage(globalThis.sessionStorage as Storage | undefined);

    useLibraryStore.setState({
        books: [],
        collections: [],
        annotations: [],
        recentBooksCache: [],
        currentBookId: undefined,
        lastScannedAt: undefined,
        coversHydrated: true,
    });

    useRssStore.setState({
        feeds: [],
        articles: [],
        isLoading: false,
        error: undefined,
        currentArticle: null,
    });
}

describe("RSS store sorting", () => {
    beforeEach(() => {
        resetStores();
    });

    it("sorts articles by recency without mutating store order", () => {
        const oldest = createArticle({
            id: "oldest",
            feedId: "feed-a",
            publishedAt: new Date("2024-01-01T00:00:00Z"),
            fetchedAt: new Date("2024-01-02T00:00:00Z"),
        });
        const newest = createArticle({
            id: "newest",
            feedId: "feed-a",
            publishedAt: new Date("2024-03-01T00:00:00Z"),
            fetchedAt: new Date("2024-03-02T00:00:00Z"),
        });
        const middle = createArticle({
            id: "middle",
            feedId: "feed-b",
            publishedAt: new Date("2024-02-01T00:00:00Z"),
            fetchedAt: new Date("2024-02-02T00:00:00Z"),
        });

        useRssStore.setState({
            articles: [oldest, newest, middle],
        });

        expect(useRssStore.getState().articles.map((article) => article.id)).toEqual([
            "oldest",
            "newest",
            "middle",
        ]);

        const sorted = useRssStore.getState().getAllArticles();
        expect(sorted.map((article) => article.id)).toEqual([
            "newest",
            "middle",
            "oldest",
        ]);

        // Store state must preserve insertion order; getters should not mutate state arrays.
        expect(useRssStore.getState().articles.map((article) => article.id)).toEqual([
            "oldest",
            "newest",
            "middle",
        ]);
    });

    it("reuses cached sorted slices until article reference changes", () => {
        const first = createArticle({
            id: "feed-a-new",
            feedId: "feed-a",
            publishedAt: new Date("2024-04-01T00:00:00Z"),
        });
        const second = createArticle({
            id: "feed-a-old",
            feedId: "feed-a",
            publishedAt: new Date("2024-01-01T00:00:00Z"),
        });
        const third = createArticle({
            id: "feed-b-mid",
            feedId: "feed-b",
            publishedAt: new Date("2024-02-01T00:00:00Z"),
        });

        useRssStore.setState({
            articles: [second, third, first],
        });

        const allFirstCall = useRssStore.getState().getAllArticles();
        const allSecondCall = useRssStore.getState().getAllArticles();
        expect(allSecondCall).toBe(allFirstCall);

        const feedFirstCall = useRssStore.getState().getArticlesForFeed("feed-a");
        const feedSecondCall = useRssStore.getState().getArticlesForFeed("feed-a");
        expect(feedSecondCall).toBe(feedFirstCall);

        useRssStore.setState({ error: "transient" });

        expect(useRssStore.getState().getAllArticles()).toBe(allFirstCall);
        expect(useRssStore.getState().getArticlesForFeed("feed-a")).toBe(feedFirstCall);

        useRssStore.setState((state) => ({
            articles: [...state.articles],
        }));

        expect(useRssStore.getState().getAllArticles()).not.toBe(allFirstCall);
        expect(useRssStore.getState().getArticlesForFeed("feed-a")).not.toBe(feedFirstCall);
    });
});

describe("Library annotation getters", () => {
    beforeEach(() => {
        resetStores();
    });

    it("returns scoped highlights/bookmarks and supports rss synthetic ids", () => {
        useLibraryStore.setState({
            annotations: [
                createAnnotation({ id: "h-book", bookId: "book-1", type: "highlight" }),
                createAnnotation({ id: "n-book", bookId: "book-1", type: "note" }),
                createAnnotation({ id: "b-book", bookId: "book-1", type: "bookmark" }),
                createAnnotation({ id: "h-rss", bookId: "rss:article-1", type: "highlight" }),
                createAnnotation({ id: "b-rss", bookId: "rss:article-1", type: "bookmark" }),
                createAnnotation({ id: "h-other", bookId: "book-2", type: "highlight" }),
            ],
        });

        const rssAnnotationsFirst = useLibraryStore.getState().getBookAnnotations("rss:article-1");
        const rssAnnotationsSecond = useLibraryStore.getState().getBookAnnotations("rss:article-1");

        expect(rssAnnotationsFirst.map((annotation) => annotation.id)).toEqual(["h-rss", "b-rss"]);
        expect(rssAnnotationsSecond).toBe(rssAnnotationsFirst);

        expect(
            useLibraryStore.getState().getHighlights("book-1").map((annotation) => annotation.id),
        ).toEqual(["h-book", "n-book"]);

        expect(
            useLibraryStore.getState().getBookmarks("book-1").map((annotation) => annotation.id),
        ).toEqual(["b-book"]);
    });

    it("keeps recentBooksCache in sync when updating a book", () => {
        const baseBook = createBook({
            id: "book-sync",
            title: "Old title",
            author: "Old author",
            progress: 0.2,
        });

        useLibraryStore.setState({
            books: [baseBook],
            recentBooksCache: [
                {
                    id: baseBook.id,
                    title: baseBook.title,
                    author: baseBook.author,
                    progress: baseBook.progress,
                    currentLocation: baseBook.currentLocation,
                    lastClickFraction: baseBook.lastClickFraction,
                    pageProgress: baseBook.pageProgress,
                    pdfViewState: baseBook.pdfViewState,
                    lastReadAt: new Date("2024-01-01T00:00:00Z"),
                },
            ],
        });

        useLibraryStore.getState().updateBook(baseBook.id, {
            title: "New title",
            author: "New author",
            coverPath: "data:image/jpeg;base64,abc",
            progress: 0.8,
        });

        const cachedBook = useLibraryStore.getState().getCachedBook(baseBook.id);
        expect(cachedBook?.title).toBe("New title");
        expect(cachedBook?.author).toBe("New author");
        expect(cachedBook?.coverPath).toBe("data:image/jpeg;base64,abc");
        expect(cachedBook?.progress).toBe(0.8);
    });
});

describe("Library import deduplication", () => {
    beforeEach(() => {
        resetStores();
    });

    it("deduplicates by content hash and merges missing metadata", () => {
        const existingBook = createBook({
            id: "book-existing",
            title: "Unknown",
            author: "",
            filePath: "/books/original.epub",
            format: "epub",
            fileSize: 1024,
            contentHash: "hash-123",
            coverExtractionDone: false,
        });

        useLibraryStore.setState({
            books: [existingBook],
            recentBooksCache: [
                {
                    id: existingBook.id,
                    title: existingBook.title,
                    author: existingBook.author,
                    progress: existingBook.progress,
                    currentLocation: existingBook.currentLocation,
                    lastClickFraction: existingBook.lastClickFraction,
                    pageProgress: existingBook.pageProgress,
                    pdfViewState: existingBook.pdfViewState,
                    lastReadAt: new Date("2024-01-01T00:00:00Z"),
                },
            ],
        });

        const duplicateImport = createBook({
            id: "book-duplicate",
            title: "Canonical Title",
            author: "Canonical Author",
            filePath: "/tmp/copy.epub",
            format: "epub",
            fileSize: 1024,
            contentHash: "hash-123",
            coverPath: "data:image/jpeg;base64,abc",
            description: "Merged description",
            coverExtractionDone: true,
        });

        useLibraryStore.getState().addBooks([duplicateImport]);

        const books = useLibraryStore.getState().books;
        expect(books).toHaveLength(1);
        expect(books[0].id).toBe("book-existing");
        expect(books[0].title).toBe("Canonical Title");
        expect(books[0].author).toBe("Canonical Author");
        expect(books[0].coverPath).toBe("data:image/jpeg;base64,abc");
        expect(books[0].description).toBe("Merged description");
        expect(books[0].coverExtractionDone).toBe(true);

        const cachedBook = useLibraryStore.getState().getCachedBook("book-existing");
        expect(cachedBook?.title).toBe("Canonical Title");
        expect(cachedBook?.author).toBe("Canonical Author");
        expect(cachedBook?.coverPath).toBe("data:image/jpeg;base64,abc");
    });

    it("deduplicates by file identity when content hash is missing", () => {
        const firstImport = createBook({
            id: "book-1",
            filePath: "/books/a.epub",
            format: "epub",
            fileSize: 2048,
            contentHash: undefined,
        });
        const duplicateImport = createBook({
            id: "book-2",
            filePath: "/books/a.epub",
            format: "epub",
            fileSize: 2048,
            contentHash: undefined,
            title: "Should not replace title",
        });

        useLibraryStore.getState().addBooks([firstImport, duplicateImport]);

        const books = useLibraryStore.getState().books;
        expect(books).toHaveLength(1);
        expect(books[0].id).toBe("book-1");
    });
});
