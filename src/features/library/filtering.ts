import {
    FORMAT_DISPLAY_NAMES,
    normalizeAuthor,
    rankByFuzzyQuery,
    type Book,
    type LibrarySortBy,
    type LibrarySortOrder,
} from "../../core";

export interface LibraryFilterOptions {
    books: Book[];
    searchQuery: string;
    selectedShelfBookIds: Set<string> | null;
    showFavoritesOnly: boolean;
    sortBy: LibrarySortBy;
    sortOrder: LibrarySortOrder;
}

export function getFilteredAndSortedBooks({
    books,
    searchQuery,
    selectedShelfBookIds,
    showFavoritesOnly,
    sortBy,
    sortOrder,
}: LibraryFilterOptions): Book[] {
    let result = books;

    // In main library view (no shelf selected), RSS entries stay on Feeds page.
    if (selectedShelfBookIds) {
        result = result.filter((book) => selectedShelfBookIds.has(book.id));
    } else {
        result = result.filter((book) => !book.tags.includes("rss"));
    }

    if (showFavoritesOnly) {
        result = result.filter((book) => book.isFavorite);
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
        const rankedBooks = rankByFuzzyQuery(
            result.map((book) => ({
                book,
                title: book.title,
                author: normalizeAuthor(book.author),
                tags: book.tags.join(" "),
                format: `${FORMAT_DISPLAY_NAMES[book.format]} ${book.format}`,
            })),
            trimmedQuery,
            {
                keys: [
                    { name: "title", weight: 0.45 },
                    { name: "author", weight: 0.3 },
                    { name: "tags", weight: 0.15 },
                    { name: "format", weight: 0.1 },
                ],
            },
        );
        return rankedBooks.map(({ item }) => item.book);
    }

    const sorted = [...result];
    sorted.sort((a, b) => {
        let comparison = 0;

        switch (sortBy) {
            case "title":
                comparison = a.title.localeCompare(b.title);
                break;
            case "author":
                comparison = normalizeAuthor(a.author).localeCompare(normalizeAuthor(b.author));
                break;
            case "dateAdded": {
                const aAdded = a.addedAt instanceof Date ? a.addedAt : new Date(a.addedAt);
                const bAdded = b.addedAt instanceof Date ? b.addedAt : new Date(b.addedAt);
                comparison = aAdded.getTime() - bAdded.getTime();
                break;
            }
            case "lastRead": {
                const aLastRead = a.lastReadAt
                    ? (a.lastReadAt instanceof Date ? a.lastReadAt : new Date(a.lastReadAt))
                    : null;
                const bLastRead = b.lastReadAt
                    ? (b.lastReadAt instanceof Date ? b.lastReadAt : new Date(b.lastReadAt))
                    : null;
                const aTime = aLastRead?.getTime() || 0;
                const bTime = bLastRead?.getTime() || 0;
                comparison = aTime - bTime;
                break;
            }
            case "progress":
                comparison = a.progress - b.progress;
                break;
            case "rating": {
                const aRating = a.rating || 0;
                const bRating = b.rating || 0;
                comparison = aRating - bRating;
                break;
            }
        }

        return sortOrder === "asc" ? comparison : -comparison;
    });

    return sorted;
}
