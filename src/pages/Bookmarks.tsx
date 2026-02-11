/**
 * Bookmarks Page
 * View and manage all bookmarks across books
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useLibraryStore, useUIStore } from "@/store";
import { confirmDeleteBookmark } from "@/lib/dialogs";
import { Dropdown } from "@/components/ui";
import {
    Bookmark,
    Trash2,
    BookOpen,
    Clock,
    ExternalLink,
    ChevronDown,
    LayoutGrid,
    List,
} from "lucide-react";

// Empty state component
function EmptyBookmarks() {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-surface-muted)] flex items-center justify-center mb-6">
                <Bookmark className="w-6 h-6 text-[var(--color-text-secondary)]" />
            </div>
            <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                No Bookmarks Yet
            </h2>
            <p className="text-[var(--color-text-muted)] mb-8 max-w-xs mx-auto text-sm">
                Bookmark pages while reading to quickly return to them later.
            </p>
        </div>
    );
}

// Bookmark card component
interface BookmarkCardProps {
    bookmark: {
        id: string;
        bookId: string;
        location: string;
        selectedText?: string;
        noteContent?: string;
        createdAt: Date;
    };
    book: {
        title: string;
        author: string;
        coverPath?: string;
    } | undefined;
    viewMode: "grid" | "list";
    onDelete: (id: string) => Promise<void>;
    onGoToBookmark: (bookId: string, location: string) => void;
}

function BookmarkCard({ bookmark, book, viewMode, onDelete, onGoToBookmark }: BookmarkCardProps) {
    if (viewMode === "list") {
        return (
            <div 
                onClick={() => book && onGoToBookmark(bookmark.bookId, bookmark.location)}
                className="group flex items-center gap-4 p-4 ui-surface hover:border-[var(--color-text-muted)] transition-colors cursor-pointer"
            >
                {/* Cover */}
                <div className="flex-shrink-0">
                    {book?.coverPath ? (
                        <img
                            src={book.coverPath}
                            alt={book.title}
                            className="w-10 h-14 object-cover rounded shadow-sm"
                        />
                    ) : (
                        <div className="w-10 h-14 bg-[var(--color-surface-muted)] rounded flex items-center justify-center">
                            <BookOpen className="w-4 h-4 text-[var(--color-text-muted)]" />
                        </div>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm text-[var(--color-text-primary)] truncate hover:text-[var(--color-accent)] transition-colors">
                        {book?.title || "Unknown Book"}
                    </h3>
                    <p className="text-xs text-[var(--color-text-secondary)] truncate">
                        {book?.author || "Unknown Author"}
                    </p>
                </div>

                {/* Date */}
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(bookmark.createdAt).toLocaleDateString()}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            book && onGoToBookmark(bookmark.bookId, bookmark.location);
                        }}
                        className="p-2 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)]"
                        title="Go to bookmark"
                    >
                        <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                        onClick={async (e) => {
                            e.stopPropagation();
                            await onDelete(bookmark.id);
                        }}
                        className="p-2 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-error)]"
                        title="Delete bookmark"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="group ui-surface overflow-hidden hover:border-[var(--color-text-muted)] transition-colors">
            {/* Book Cover Section */}
            <div
                onClick={() => book && onGoToBookmark(bookmark.bookId, bookmark.location)}
                className="block w-full aspect-[3/2] bg-[var(--color-surface-muted)] relative overflow-hidden cursor-pointer"
            >
                {book?.coverPath ? (
                    <>
                        <img
                            src={book.coverPath}
                            alt={book.title}
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[var(--color-overlay-strong)] to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3">
                            <h3 className="font-medium text-sm text-[var(--color-text-inverse)] line-clamp-1">
                                {book?.title || "Unknown Book"}
                            </h3>
                            <p className="text-xs text-[var(--color-text-inverse)] opacity-80 line-clamp-1">
                                {book?.author || "Unknown Author"}
                            </p>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full p-4">
                        <BookOpen className="w-10 h-10 text-[var(--color-text-muted)] mb-2" />
                        <span className="text-sm text-[var(--color-text-secondary)] text-center line-clamp-2">
                            {book?.title || "Unknown Book"}
                        </span>
                    </div>
                )}

                {/* Bookmark Icon */}
                <div className="absolute top-3 right-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                        <Bookmark className="w-4 h-4 text-[var(--color-text-inverse)] fill-[var(--color-text-inverse)]" />
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-4">
                {bookmark.selectedText && (
                    <blockquote className="text-sm text-[var(--color-text-secondary)] border-l-2 border-[var(--color-border)] pl-3 italic line-clamp-2 mb-3">
                        "{bookmark.selectedText}"
                    </blockquote>
                )}

                <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">
                        {new Date(bookmark.createdAt).toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => book && onGoToBookmark(bookmark.bookId, bookmark.location)}
                            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                            title="Go to bookmark"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </button>
                        <button
                            onClick={async () => await onDelete(bookmark.id)}
                            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-error)]"
                            title="Delete bookmark"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Main page component
export function BookmarksPage() {
    const { annotations, books, removeAnnotation } = useLibraryStore();
    const { setRoute, searchQuery } = useUIStore();
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [sortBy, setSortBy] = useState<"newest" | "oldest" | "book">("newest");

    // Get only bookmark annotations
    const bookmarks = useMemo(() => {
        return annotations.filter((a) => a.type === "bookmark");
    }, [annotations]);

    // Filter and sort
    const filteredBookmarks = useMemo(() => {
        let filtered = [...bookmarks];

        // Apply search filter from global search
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(
                (b) =>
                    b.selectedText?.toLowerCase().includes(q) ||
                    books.find((book) => book.id === b.bookId)?.title.toLowerCase().includes(q) ||
                    books.find((book) => book.id === b.bookId)?.author.toLowerCase().includes(q)
            );
        }

        // Sort
        filtered.sort((a, b) => {
            switch (sortBy) {
                case "newest": {
                    const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
                    const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
                    return dateB.getTime() - dateA.getTime();
                }
                case "oldest": {
                    const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
                    const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
                    return dateA.getTime() - dateB.getTime();
                }
                case "book":
                    const bookA = books.find((book) => book.id === a.bookId)?.title || "";
                    const bookB = books.find((book) => book.id === b.bookId)?.title || "";
                    return bookA.localeCompare(bookB);
                default:
                    return 0;
            }
        });

        return filtered;
    }, [bookmarks, searchQuery, sortBy, books]);

    const handleDelete = async (id: string) => {
        const confirmed = await confirmDeleteBookmark();
        if (confirmed) {
            removeAnnotation(id);
        }
    };

    const handleGoToBookmark = (bookId: string, location: string) => {
        // Store the bookmark location in sessionStorage so the reader can navigate to it
        sessionStorage.setItem("lion-reader-goto-location", location);
        setRoute("reader", bookId);
    };

    const getBookInfo = (bookId: string) => {
        return books.find((b) => b.id === bookId);
    };

    if (bookmarks.length === 0) {
        return <EmptyBookmarks />;
    }

    return (
        <div className="ui-page animate-fade-in">
            {/* Header */}
            <div className="flex items-start justify-between mb-10">
                <div>
                    <h1 className="ui-page-title">
                        Bookmarks
                    </h1>
                    <p className="ui-page-subtitle">
                        {filteredBookmarks.length} {filteredBookmarks.length === 1 ? "bookmark" : "bookmarks"} across{" "}
                        {new Set(filteredBookmarks.map((b) => b.bookId)).size} books
                    </p>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4 mb-8">
                {/* Sort Dropdown */}
                <Dropdown
                    value={sortBy}
                    onChange={(value) => setSortBy(value as typeof sortBy)}
                    options={[
                        { value: "newest", label: "Newest First" },
                        { value: "oldest", label: "Oldest First" },
                        { value: "book", label: "By Book" },
                    ]}
                />

                {/* View Mode Toggle */}
                <div className="flex items-center bg-[var(--color-surface-muted)] rounded-lg p-1">
                    <button
                        onClick={() => setViewMode("grid")}
                        className={cn(
                            "p-2 rounded-md transition-colors",
                            viewMode === "grid"
                                ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        )}
                        title="Grid view"
                    >
                        <LayoutGrid className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setViewMode("list")}
                        className={cn(
                            "p-2 rounded-md transition-colors",
                            viewMode === "list"
                                ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        )}
                        title="List view"
                    >
                        <List className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Bookmarks Display */}
            {filteredBookmarks.length === 0 ? (
                <div className="text-center py-16">
                    <p className="text-[var(--color-text-muted)]">
                        No bookmarks found{searchQuery ? " matching your search" : ""}.
                    </p>
                </div>
            ) : viewMode === "grid" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredBookmarks.map((bookmark) => (
                        <BookmarkCard
                            key={bookmark.id}
                            bookmark={bookmark}
                            book={getBookInfo(bookmark.bookId)}
                            viewMode={viewMode}
                            onDelete={handleDelete}
                            onGoToBookmark={handleGoToBookmark}
                        />
                    ))}
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredBookmarks.map((bookmark) => (
                        <BookmarkCard
                            key={bookmark.id}
                            bookmark={bookmark}
                            book={getBookInfo(bookmark.bookId)}
                            viewMode={viewMode}
                            onDelete={handleDelete}
                            onGoToBookmark={handleGoToBookmark}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
