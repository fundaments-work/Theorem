import { describe, expect, it } from "vitest";
import type { Book, LibrarySortBy, LibrarySortOrder } from "../src/core";
import { getFilteredAndSortedBooks } from "../src/features/library/filtering";

function makeBook(overrides: Partial<Book> & Pick<Book, "id" | "title">): Book {
    return {
        id: overrides.id,
        title: overrides.title,
        author: overrides.author ?? "Unknown Author",
        filePath: overrides.filePath ?? `/library/${overrides.id}.epub`,
        format: overrides.format ?? "epub",
        fileSize: overrides.fileSize ?? 1024,
        addedAt: overrides.addedAt ?? new Date("2025-01-01T00:00:00.000Z"),
        lastReadAt: overrides.lastReadAt,
        progress: overrides.progress ?? 0,
        tags: overrides.tags ?? [],
        isFavorite: overrides.isFavorite ?? false,
        readingTime: overrides.readingTime ?? 0,
        rating: overrides.rating,
        coverPath: overrides.coverPath,
        locations: overrides.locations,
        storagePath: overrides.storagePath,
        currentLocation: overrides.currentLocation,
        lastClickFraction: overrides.lastClickFraction,
        pageProgress: overrides.pageProgress,
        pdfViewState: overrides.pdfViewState,
        category: overrides.category,
        description: overrides.description,
        publisher: overrides.publisher,
        publishedDate: overrides.publishedDate,
        language: overrides.language,
        isbn: overrides.isbn,
        manualCompletionState: overrides.manualCompletionState,
        progressBeforeFinish: overrides.progressBeforeFinish,
        completedAt: overrides.completedAt,
        contentHash: overrides.contentHash,
        coverExtractionDone: overrides.coverExtractionDone,
    };
}

function runFilter({
    books,
    searchQuery = "",
    selectedShelfBookIds = null,
    showFavoritesOnly = false,
    sortBy = "title",
    sortOrder = "asc",
}: {
    books: Book[];
    searchQuery?: string;
    selectedShelfBookIds?: Set<string> | null;
    showFavoritesOnly?: boolean;
    sortBy?: LibrarySortBy;
    sortOrder?: LibrarySortOrder;
}) {
    return getFilteredAndSortedBooks({
        books,
        searchQuery,
        selectedShelfBookIds,
        showFavoritesOnly,
        sortBy,
        sortOrder,
    });
}

describe("library filtering", () => {
    const books: Book[] = [
        makeBook({
            id: "alpha",
            title: "Alpha",
            author: "Alice",
            addedAt: new Date("2024-01-10T00:00:00.000Z"),
            isFavorite: false,
            tags: ["fiction"],
        }),
        makeBook({
            id: "beta-rss",
            title: "Beta RSS",
            author: "Bob",
            addedAt: new Date("2024-01-11T00:00:00.000Z"),
            isFavorite: true,
            tags: ["rss"],
        }),
        makeBook({
            id: "beta-book",
            title: "Beta Book",
            author: "Beatrice",
            addedAt: new Date("2024-01-12T00:00:00.000Z"),
            isFavorite: true,
            tags: ["fantasy"],
        }),
        makeBook({
            id: "gamma",
            title: "Gamma",
            author: "Gabe",
            addedAt: new Date("2024-01-13T00:00:00.000Z"),
            isFavorite: false,
            tags: ["history"],
        }),
    ];

    it("hides rss books in main library view", () => {
        const result = runFilter({ books });
        expect(result.map((book) => book.id)).toEqual(["alpha", "beta-book", "gamma"]);
    });

    it("includes rss books when filtering by a selected shelf", () => {
        const result = runFilter({
            books,
            selectedShelfBookIds: new Set(["beta-rss", "gamma"]),
        });
        expect(result.map((book) => book.id)).toEqual(["beta-rss", "gamma"]);
    });

    it("applies favorites filter after shelf filtering", () => {
        const result = runFilter({
            books,
            selectedShelfBookIds: new Set(["alpha", "beta-book", "gamma"]),
            showFavoritesOnly: true,
        });
        expect(result.map((book) => book.id)).toEqual(["beta-book"]);
    });

    it("searches only within the already filtered set", () => {
        const result = runFilter({
            books,
            searchQuery: "beta",
        });
        expect(result.map((book) => book.id)).toEqual(["beta-book"]);
    });

    it("uses fuzzy ranking order when searching regardless of sort order", () => {
        const asc = runFilter({
            books,
            searchQuery: "beta",
            selectedShelfBookIds: new Set(["beta-rss", "beta-book"]),
            sortBy: "title",
            sortOrder: "asc",
        });
        const desc = runFilter({
            books,
            searchQuery: "beta",
            selectedShelfBookIds: new Set(["beta-rss", "beta-book"]),
            sortBy: "title",
            sortOrder: "desc",
        });

        expect(asc.map((book) => book.id)).toEqual(desc.map((book) => book.id));
    });

    it("sorts by date when no search query is active", () => {
        const asc = runFilter({
            books,
            sortBy: "dateAdded",
            sortOrder: "asc",
        });
        const desc = runFilter({
            books,
            sortBy: "dateAdded",
            sortOrder: "desc",
        });

        expect(asc.map((book) => book.id)).toEqual(["alpha", "beta-book", "gamma"]);
        expect(desc.map((book) => book.id)).toEqual(["gamma", "beta-book", "alpha"]);
    });
});
