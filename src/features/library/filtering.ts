import { FORMAT_DISPLAY_NAMES } from "../../core/types";
import { normalizeAuthor } from "../../core/lib/utils";

import type { Book, LibrarySortBy, LibrarySortOrder } from "../../core/types";

export interface LibraryFilterOptions {
    books: Book[];
    searchQuery: string;
    selectedShelfBookIds: Set<string> | null;
    showFavoritesOnly: boolean;
    sortBy: LibrarySortBy;
    sortOrder: LibrarySortOrder;
    
    ftsSearchIds?: string[];
}

import Fuse from "fuse.js";

const booksFuseCache = new WeakMap<Book[], Fuse<any>>();

export function getFilteredAndSortedBooks({
    books,
    searchQuery,
    selectedShelfBookIds,
    showFavoritesOnly,
    sortBy,
    sortOrder,
    ftsSearchIds,
}: LibraryFilterOptions): Book[] {
    let searchResults = books;
    const trimmedQuery = searchQuery.trim();

    if (trimmedQuery) {
        if (ftsSearchIds && ftsSearchIds.length > 0) {
            const idSet = new Set(ftsSearchIds);
            searchResults = books.filter((b) => idSet.has(b.id));
        } else {
            let fuse = booksFuseCache.get(books);
            if (!fuse) {
                const searchableItems = books.map((book) => ({
                    book,
                    title: book.title,
                    author: normalizeAuthor(book.author),
                    tags: book.tags.join(" "),
                    format: `${FORMAT_DISPLAY_NAMES[book.format]} ${book.format}`,
                }));

                fuse = new Fuse(searchableItems, {
                    keys: [
                        { name: "title", weight: 0.45 },
                        { name: "author", weight: 0.3 },
                        { name: "tags", weight: 0.15 },
                        { name: "format", weight: 0.1 },
                    ],
                    threshold: 0.34,
                    ignoreLocation: true,
                    includeScore: true,
                    shouldSort: true,
                    minMatchCharLength: 2,
                });
                booksFuseCache.set(books, fuse);
            }

            const rawResults = fuse.search(trimmedQuery);
            searchResults = rawResults.map((r) => r.item.book);
        }
    }

    let result = searchResults;

    if (selectedShelfBookIds) {
        result = result.filter((book) => selectedShelfBookIds.has(book.id));
    } else {
        result = result.filter((book) => !book.tags.includes("rss"));
    }

    if (showFavoritesOnly) {
        result = result.filter((book) => book.isFavorite);
    }

    if (trimmedQuery) {
        return result;
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
