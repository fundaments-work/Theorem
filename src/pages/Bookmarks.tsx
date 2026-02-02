/**
 * Bookmarks Page
 * View and manage all bookmarks across books
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useLibraryStore, useUIStore } from "@/store";
import {
    Bookmark,
    Search,
    Trash2,
    BookOpen,
    Clock,
    ExternalLink,
    X,
    ChevronDown,
    LayoutGrid,
    List,
} from "lucide-react";

// Empty state component
function EmptyBookmarks() {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-border-subtle)] flex items-center justify-center mb-6">
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
    onDelete: (id: string) => void;
    onGoToBook: (bookId: string) => void;
}

function BookmarkCard({ bookmark, book, viewMode, onDelete, onGoToBook }: BookmarkCardProps) {
    if (viewMode === "list") {
        return (
            <div className="group flex items-center gap-4 p-4 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-text-muted)] transition-colors">
                {/* Cover */}
                <button
                    onClick={() => book && onGoToBook(bookmark.bookId)}
                    className="flex-shrink-0"
                >
                    {book?.coverPath ? (
                        <img
                            src={book.coverPath}
                            alt={book.title}
                            className="w-10 h-14 object-cover rounded shadow-sm"
                        />
                    ) : (
                        <div className="w-10 h-14 bg-[var(--color-border-subtle)] rounded flex items-center justify-center">
                            <BookOpen className="w-4 h-4 text-[var(--color-text-muted)]" />
                        </div>
                    )}
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <button
                        onClick={() => book && onGoToBook(bookmark.bookId)}
                        className="text-left"
                    >
                        <h3 className="font-medium text-sm text-[var(--color-text-primary)] truncate hover:text-[var(--color-accent)] transition-colors">
                            {book?.title || "Unknown Book"}
                        </h3>
                        <p className="text-xs text-[var(--color-text-secondary)] truncate">
                            {book?.author || "Unknown Author"}
                        </p>
                    </button>
                </div>

                {/* Date */}
                <div className="hidden sm:flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <Clock className="w-3.5 h-3.5" />
                    {bookmark.createdAt.toLocaleDateString()}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        onClick={() => book && onGoToBook(bookmark.bookId)}
                        className="p-2 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)] hover:text-[var(--color-text-primary)]"
                        title="Go to bookmark"
                    >
                        <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => onDelete(bookmark.id)}
                        className="p-2 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)] hover:text-[var(--color-error)]"
                        title="Delete bookmark"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="group bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden hover:border-[var(--color-text-muted)] transition-colors">
            {/* Book Cover Section */}
            <button
                onClick={() => book && onGoToBook(bookmark.bookId)}
                className="block w-full aspect-[3/2] bg-[var(--color-border-subtle)] relative overflow-hidden"
            >
                {book?.coverPath ? (
                    <>
                        <img
                            src={book.coverPath}
                            alt={book.title}
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3">
                            <h3 className="font-medium text-sm text-white line-clamp-1">
                                {book?.title || "Unknown Book"}
                            </h3>
                            <p className="text-xs text-white/80 line-clamp-1">
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
                        <Bookmark className="w-4 h-4 text-white fill-white" />
                    </div>
                </div>
            </button>

            {/* Content */}
            <div className="p-4">
                {bookmark.selectedText && (
                    <blockquote className="text-sm text-[var(--color-text-secondary)] border-l-2 border-[var(--color-border)] pl-3 italic line-clamp-2 mb-3">
                        "{bookmark.selectedText}"
                    </blockquote>
                )}

                <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">
                        {bookmark.createdAt.toLocaleDateString()}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={() => book && onGoToBook(bookmark.bookId)}
                            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => onDelete(bookmark.id)}
                            className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)] hover:text-[var(--color-error)]"
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
    const { setRoute } = useUIStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
    const [sortBy, setSortBy] = useState<"newest" | "oldest" | "book">("newest");

    // Get only bookmark annotations
    const bookmarks = useMemo(() => {
        return annotations.filter((a) => a.type === "bookmark");
    }, [annotations]);

    // Filter and sort
    const filteredBookmarks = useMemo(() => {
        let filtered = [...bookmarks];

        // Apply search filter
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

    const handleDelete = (id: string) => {
        if (confirm("Are you sure you want to delete this bookmark?")) {
            removeAnnotation(id);
        }
    };

    const handleGoToBook = (bookId: string) => {
        setRoute("reader", bookId);
    };

    const getBookInfo = (bookId: string) => {
        return books.find((b) => b.id === bookId);
    };

    if (bookmarks.length === 0) {
        return <EmptyBookmarks />;
    }

    return (
        <div className="p-8 max-w-6xl mx-auto animate-fade-in min-h-screen">
            {/* Header */}
            <div className="flex items-start justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                        Bookmarks
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        {bookmarks.length} {bookmarks.length === 1 ? "bookmark" : "bookmarks"} across{" "}
                        {new Set(bookmarks.map((b) => b.bookId)).size} books
                    </p>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
                {/* Search */}
                <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search bookmarks..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={cn(
                            "w-full pl-10 pr-10 py-2.5 rounded-lg",
                            "bg-[var(--color-surface)] border border-[var(--color-border)]",
                            "text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                            "focus:outline-none focus:border-[var(--color-accent)]",
                            "transition-colors duration-200"
                        )}
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* View Controls */}
                <div className="flex items-center gap-3">
                    {/* Sort Dropdown */}
                    <div className="relative">
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                            className={cn(
                                "appearance-none pl-4 pr-10 py-2 rounded-lg",
                                "bg-[var(--color-surface)] border border-[var(--color-border)]",
                                "text-sm text-[var(--color-text-primary)]",
                                "focus:outline-none focus:border-[var(--color-accent)]",
                                "cursor-pointer"
                            )}
                        >
                            <option value="newest">Newest First</option>
                            <option value="oldest">Oldest First</option>
                            <option value="book">By Book</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
                    </div>

                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-[var(--color-border-subtle)] rounded-lg p-1">
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
                            onGoToBook={handleGoToBook}
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
                            onGoToBook={handleGoToBook}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

