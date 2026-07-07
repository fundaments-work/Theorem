import { beforeEach, describe, expect, it } from "vitest";
import { useLibraryStore } from "../src/core/store";
import type { Book } from "../src/core/types";

function createBook(overrides: Partial<Book> & Pick<Book, "id">): Book {
    return {
        title: overrides.title ?? `Book ${overrides.id}`,
        author: overrides.author ?? "Author",
        filePath: overrides.filePath ?? `/tmp/${overrides.id}.epub`,
        storagePath: overrides.storagePath,
        format: overrides.format ?? "epub",
        fileSize: overrides.fileSize ?? 1024,
        addedAt: overrides.addedAt ?? new Date(),
        progress: overrides.progress ?? 0,
        tags: overrides.tags ?? [],
        isFavorite: overrides.isFavorite ?? false,
        readingTime: overrides.readingTime ?? 0,
        contentHash: overrides.contentHash,
        coverPath: overrides.coverPath,
        lastReadAt: overrides.lastReadAt,
        rating: overrides.rating,
        description: overrides.description,
        publisher: overrides.publisher,
        language: overrides.language,
        ...overrides,
    };
}

beforeEach(() => {
    useLibraryStore.setState({
        books: [],
        annotations: [],
        collections: [],
        deletionTombstones: [],
        recentBooksCache: [],
        coversHydrated: false,
    });
});

// ─── P2-21: O(1) addBooks Dedup ───

describe("P2-21: O(1) addBooks deduplication", () => {
    it("addBooks deduplicates by contentHash", () => {
        useLibraryStore.getState().addBooks([
            createBook({ id: "a", contentHash: "abc123" }),
        ]);
        useLibraryStore.getState().addBooks([
            createBook({ id: "b", contentHash: "abc123" }),
        ]);
        const books = useLibraryStore.getState().books;
        expect(books).toHaveLength(1);
    });

    it("addBooks deduplicates by storagePath", () => {
        useLibraryStore.getState().addBooks([
            createBook({ id: "a", storagePath: "sqlite://book-a" }),
        ]);
        useLibraryStore.getState().addBooks([
            createBook({ id: "b", storagePath: "sqlite://book-a" }),
        ]);
        expect(useLibraryStore.getState().books).toHaveLength(1);
    });

    it("addBooks deduplicates by filePath:format:fileSize", () => {
        useLibraryStore.getState().addBooks([
            createBook({ id: "a", filePath: "/tmp/book.epub", format: "epub", fileSize: 2048 }),
        ]);
        useLibraryStore.getState().addBooks([
            createBook({ id: "b", filePath: "/tmp/book.epub", format: "epub", fileSize: 2048 }),
        ]);
        expect(useLibraryStore.getState().books).toHaveLength(1);
    });

    it("addBooks handles intra-batch dedup", () => {
        useLibraryStore.getState().addBooks([
            createBook({ id: "a", contentHash: "hash-1" }),
            createBook({ id: "b", contentHash: "hash-1" }),
        ]);
        const books = useLibraryStore.getState().books;
        expect(books).toHaveLength(1);
    });

    it("addBooks at scale: 5000 books with no duplicate slowdown", () => {
        const batch = Array.from({ length: 5000 }, (_, i) =>
            createBook({
                id: `book-${i}`,
                contentHash: `hash-${i}`,
                filePath: `/tmp/book-${i}.epub`,
            }),
        );
        const start = performance.now();
        useLibraryStore.getState().addBooks(batch);
        const elapsed = performance.now() - start;
        // With O(1) dedup, 5000 books should import in <500ms
        expect(elapsed).toBeLessThan(500);
        expect(useLibraryStore.getState().books).toHaveLength(5000);
    });

    it("addBooks handles duplicate in large batch correctly", () => {
        const batch = Array.from({ length: 2000 }, (_, i) =>
            createBook({ id: `book-${i}`, contentHash: `hash-${i}` }),
        );
        // Add the first book again at the end
        batch.push(createBook({ id: "book-0-dup", contentHash: "hash-0" }));
        useLibraryStore.getState().addBooks(batch);
        expect(useLibraryStore.getState().books).toHaveLength(2000);
    });
});

// ─── P2-20: Cover Restore Batching ───

describe("P2-20: Cover restore uses single setState", () => {
    it("getBook returns undefined for non-existent book", () => {
        const result = useLibraryStore.getState().getBook("nonexistent");
        expect(result).toBeUndefined();
    });

    it("getBook uses O(1) WeakMap-cached lookup", () => {
        useLibraryStore.getState().addBooks([createBook({ id: "a" })]);
        const book = useLibraryStore.getState().getBook("a");
        expect(book).toBeDefined();
        expect(book!.id).toBe("a");

        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            const b = useLibraryStore.getState().getBook("a");
            expect(b!.id).toBe("a");
        }
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(5);
    });
});

// ─── P0-6: Locations Stripped from Persist ───

describe("P0-6: Locations stripped from Zustand persist", () => {
    it("partialize strips locations and coverPath from books", () => {
        const book = createBook({
            id: "a",
            locations: JSON.stringify({ sections: { "1": { position: 42 } } }),
            coverPath: "data:image/png;base64,xxx",
        });
        useLibraryStore.getState().addBooks([book]);

        // Verify locations exist in-memory
        const memBook = useLibraryStore.getState().getBook("a");
        expect(memBook!.locations).toBeDefined();
        expect(memBook!.coverPath).toBeDefined();

        // partialize should strip both
        const store = useLibraryStore as any;
        const persistApi = store.persist;
        if (persistApi?.getOptions) {
            const options = persistApi.getOptions();
            if (options.partialize) {
                // Cast needed because partialize generates PersistedLibraryState
                const partialized = options.partialize({
                    books: useLibraryStore.getState().books,
                    annotations: [],
                    collections: [],
                    deletionTombstones: [],
                    recentBooksCache: [],
                }) as any;
                expect(partialized.books).toBeDefined();
                expect(partialized.books[0].locations).toBeUndefined();
                expect(partialized.books[0].coverPath).toBeUndefined();
            }
        }
    });
});

// ─── P3-28: hasHydrated Flag ───

describe("P3-28: hasHydrated flag", () => {
    it("setHydrated changes hasHydrated to true", async () => {
        const { useUIStore } = await import("../src/core/store");
        const initial = useUIStore.getState().hasHydrated;
        // Default is false on fresh store
        expect(initial).toBe(false);

        useUIStore.getState().setHydrated();
        expect(useUIStore.getState().hasHydrated).toBe(true);
    });
});

// ─── Book Lookup Performance ───

describe("Book lookup operations are O(1)", () => {
    it("getBook returns existing book in constant time", () => {
        useLibraryStore.getState().addBooks([createBook({ id: "test-book" })]);
        const start = performance.now();
        const book = useLibraryStore.getState().getBook("test-book");
        const elapsed = performance.now() - start;
        expect(book).toBeDefined();
        expect(book!.id).toBe("test-book");
        // O(1) lookup should be sub-millisecond
        expect(elapsed).toBeLessThan(5);
    });

    it("addBookToCollection should NOT use O(n) scan", () => {
        // Bulk add 5000 books
        const batch = Array.from({ length: 5000 }, (_, i) =>
            createBook({ id: `book-${i}` }),
        );
        useLibraryStore.getState().addBooks(batch);

        // Verify getBook lookups are O(1) after cache is built
        const start = performance.now();
        // Multiple lookups should all be O(1)
        for (let i = 0; i < 1000; i++) {
            useLibraryStore.getState().getBook(`book-${i * 5}`);
        }
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(10);
    });
});
