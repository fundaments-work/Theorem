/**
 * Annotations/Highlights Page
 * View and manage all highlights and notes across books
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useLibraryStore, useUIStore } from "@/store";
import { HIGHLIGHT_COLORS, type HighlightColor } from "@/types";
import {
    Highlighter,
    StickyNote,
    Bookmark,
    Search,

    Trash2,
    Edit3,
    BookOpen,
    MoreVertical,
    X,
    ChevronDown,
} from "lucide-react";

// Color badge component
function ColorBadge({ color }: { color: HighlightColor }) {
    return (
        <span
            className="inline-block w-3 h-3 rounded-full border border-black/10"
            style={{ backgroundColor: HIGHLIGHT_COLORS[color] }}
        />
    );
}

// Empty state component
function EmptyAnnotations({ type }: { type: "all" | "highlights" | "notes" | "bookmarks" }) {
    const icons = {
        all: Highlighter,
        highlights: Highlighter,
        notes: StickyNote,
        bookmarks: Bookmark,
    };
    const titles = {
        all: "No Annotations Yet",
        highlights: "No Highlights Yet",
        notes: "No Notes Yet",
        bookmarks: "No Bookmarks Yet",
    };
    const descriptions = {
        all: "Start reading and highlight text or add notes to see them here.",
        highlights: "Highlight important passages while reading to see them here.",
        notes: "Add notes to your books while reading to see them here.",
        bookmarks: "Bookmark pages while reading to see them here.",
    };

    const Icon = icons[type];

    return (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-border-subtle)] flex items-center justify-center mb-6">
                <Icon className="w-6 h-6 text-[var(--color-text-secondary)]" />
            </div>
            <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                {titles[type]}
            </h2>
            <p className="text-[var(--color-text-muted)] mb-8 max-w-xs mx-auto text-sm">
                {descriptions[type]}
            </p>
        </div>
    );
}

// Annotation card component
interface AnnotationCardProps {
    annotation: {
        id: string;
        bookId: string;
        type: "highlight" | "note" | "bookmark";
        selectedText?: string;
        noteContent?: string;
        color?: HighlightColor;
        createdAt: Date;
        updatedAt?: Date;
    };
    book: {
        title: string;
        author: string;
        coverPath?: string;
    } | undefined;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    onGoToBook: (bookId: string) => void;
}

function AnnotationCard({
    annotation,
    book,
    onDelete,
    onEdit,
    onGoToBook,
}: AnnotationCardProps) {
    const [showMenu, setShowMenu] = useState(false);

    const getIcon = () => {
        switch (annotation.type) {
            case "highlight":
                return <Highlighter className="w-4 h-4" />;
            case "note":
                return <StickyNote className="w-4 h-4" />;
            case "bookmark":
                return <Bookmark className="w-4 h-4" />;
        }
    };

    return (
        <div className="group bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-text-muted)] transition-colors">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                        {getIcon()}
                        <span className="text-xs capitalize">{annotation.type}</span>
                    </div>
                    {annotation.color && (
                        <ColorBadge color={annotation.color} />
                    )}
                </div>
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)] opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    {showMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowMenu(false)}
                            />
                            <div className="absolute right-0 top-full mt-1 w-36 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-20 py-1">
                                <button
                                    onClick={() => {
                                        onEdit(annotation.id);
                                        setShowMenu(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-border-subtle)]"
                                >
                                    <Edit3 className="w-4 h-4" />
                                    Edit
                                </button>
                                <button
                                    onClick={() => {
                                        onDelete(annotation.id);
                                        setShowMenu(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-error)] hover:bg-[var(--color-border-subtle)]"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="space-y-3">
                {annotation.selectedText && (
                    <blockquote className="text-sm text-[var(--color-text-secondary)] border-l-2 border-[var(--color-border)] pl-3 italic line-clamp-3">
                        "{annotation.selectedText}"
                    </blockquote>
                )}
                {annotation.noteContent && (
                    <p className="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap line-clamp-4">
                        {annotation.noteContent}
                    </p>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                <button
                    onClick={() => book && onGoToBook(annotation.bookId)}
                    className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                    {book?.coverPath ? (
                        <img
                            src={book.coverPath}
                            alt={book.title}
                            className="w-6 h-9 object-cover rounded-sm"
                        />
                    ) : (
                        <BookOpen className="w-4 h-4" />
                    )}
                    <span className="truncate max-w-[150px]">{book?.title || "Unknown Book"}</span>
                </button>
                <span className="text-xs text-[var(--color-text-muted)]">
                    {annotation.createdAt.toLocaleDateString()}
                </span>
            </div>
        </div>
    );
}

// Filter tabs
const filterTabs = [
    { id: "all" as const, label: "All", icon: Highlighter },
    { id: "highlights" as const, label: "Highlights", icon: Highlighter },
    { id: "notes" as const, label: "Notes", icon: StickyNote },
    { id: "bookmarks" as const, label: "Bookmarks", icon: Bookmark },
];

// Main page component
export function AnnotationsPage() {
    const { annotations, books, removeAnnotation, updateAnnotation } = useLibraryStore();
    const { setRoute } = useUIStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [activeFilter, setActiveFilter] = useState<"all" | "highlights" | "notes" | "bookmarks">("all");
    const [sortBy, setSortBy] = useState<"newest" | "oldest" | "book">("newest");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState("");

    // Filter and sort annotations
    const filteredAnnotations = useMemo(() => {
        let filtered = [...annotations];

        // Apply type filter
        if (activeFilter !== "all") {
            const typeMap = {
                highlights: "highlight",
                notes: "note",
                bookmarks: "bookmark",
                all: undefined,
            };
            filtered = filtered.filter((a) => a.type === typeMap[activeFilter]);
        }

        // Apply search filter
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(
                (a) =>
                    a.selectedText?.toLowerCase().includes(q) ||
                    a.noteContent?.toLowerCase().includes(q) ||
                    books.find((b) => b.id === a.bookId)?.title.toLowerCase().includes(q)
            );
        }

        // Sort
        filtered.sort((a, b) => {
            switch (sortBy) {
                case "newest":
                    return b.createdAt.getTime() - a.createdAt.getTime();
                case "oldest":
                    return a.createdAt.getTime() - b.createdAt.getTime();
                case "book":
                    const bookA = books.find((book) => book.id === a.bookId)?.title || "";
                    const bookB = books.find((book) => book.id === b.bookId)?.title || "";
                    return bookA.localeCompare(bookB);
                default:
                    return 0;
            }
        });

        return filtered;
    }, [annotations, activeFilter, searchQuery, sortBy, books]);

    const handleDelete = (id: string) => {
        if (confirm("Are you sure you want to delete this annotation?")) {
            removeAnnotation(id);
        }
    };

    const handleEdit = (id: string) => {
        const annotation = annotations.find((a) => a.id === id);
        if (annotation) {
            setEditingId(id);
            setEditContent(annotation.noteContent || "");
        }
    };

    const handleSaveEdit = () => {
        if (editingId) {
            updateAnnotation(editingId, { noteContent: editContent });
            setEditingId(null);
            setEditContent("");
        }
    };

    const handleGoToBook = (bookId: string) => {
        setRoute("reader", bookId);
    };

    const getBookInfo = (bookId: string) => {
        return books.find((b) => b.id === bookId);
    };

    if (annotations.length === 0) {
        return <EmptyAnnotations type="all" />;
    }

    return (
        <div className="p-8 max-w-5xl mx-auto animate-fade-in min-h-screen">
            {/* Header */}
            <div className="flex items-start justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                        Highlights & Notes
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        {annotations.length} {annotations.length === 1 ? "annotation" : "annotations"} across{" "}
                        {new Set(annotations.map((a) => a.bookId)).size} books
                    </p>
                </div>
            </div>

            {/* Filters and Search */}
            <div className="flex flex-col gap-4 mb-8">
                {/* Filter Tabs */}
                <div className="flex items-center gap-1 p-1 bg-[var(--color-border-subtle)] rounded-lg w-fit">
                    {filterTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveFilter(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                                activeFilter === tab.id
                                    ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
                                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            )}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Search and Sort */}
                <div className="flex items-center gap-4">
                    <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                        <input
                            type="text"
                            placeholder="Search annotations..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className={cn(
                                "w-full pl-10 pr-4 py-2.5 rounded-lg",
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

                    <div className="relative">
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                            className={cn(
                                "appearance-none pl-4 pr-10 py-2.5 rounded-lg",
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
                </div>
            </div>

            {/* Edit Modal */}
            {editingId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                    <div className="bg-[var(--color-surface)] rounded-xl shadow-xl max-w-lg w-full p-6">
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                            Edit Note
                        </h3>
                        <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className={cn(
                                "w-full h-32 p-3 rounded-lg resize-none",
                                "bg-[var(--color-background)] border border-[var(--color-border)]",
                                "text-sm text-[var(--color-text-primary)]",
                                "focus:outline-none focus:border-[var(--color-accent)]"
                            )}
                            placeholder="Add your note..."
                        />
                        <div className="flex items-center justify-end gap-3 mt-4">
                            <button
                                onClick={() => setEditingId(null)}
                                className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveEdit}
                                className={cn(
                                    "px-4 py-2 rounded-lg text-sm font-medium",
                                    "bg-[var(--color-accent)] text-white",
                                    "hover:opacity-90 transition-opacity"
                                )}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Annotations Grid */}
            {filteredAnnotations.length === 0 ? (
                <div className="text-center py-16">
                    <p className="text-[var(--color-text-muted)]">
                        No {activeFilter === "all" ? "" : activeFilter} found
                        {searchQuery ? " matching your search" : ""}.
                    </p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {filteredAnnotations.map((annotation) => (
                        <AnnotationCard
                            key={annotation.id}
                            annotation={annotation}
                            book={getBookInfo(annotation.bookId)}
                            onDelete={handleDelete}
                            onEdit={handleEdit}
                            onGoToBook={handleGoToBook}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default AnnotationsPage;
