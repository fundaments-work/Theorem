/**
 * Annotations/Highlights Page
 * View and manage all highlights and notes across books
 */

import { useState, useMemo } from "react";
import { HIGHLIGHT_SOLID_COLORS } from "@lionreader/core";
import { cn } from "@lionreader/core";
import { rankByFuzzyQuery } from "@lionreader/core";
import { useLearningStore, useLibraryStore, useUIStore } from "@lionreader/core";
import type { HighlightColor } from "@lionreader/core";
import { EditNoteModal } from "@lionreader/ui";
import { Dropdown } from "@lionreader/ui";
import {
    Highlighter,
    StickyNote,
    Trash2,
    Edit3,
    BookOpen,
    BrainCircuit,
    MoreVertical,
} from "lucide-react";

// Color badge component
function ColorBadge({ color }: { color: HighlightColor }) {
    return (
        <span
            className="inline-block w-3 h-3 rounded-full border border-[var(--color-overlay-subtle)]"
            style={{ backgroundColor: HIGHLIGHT_SOLID_COLORS[color] }}
        />
    );
}

// Empty state component
function EmptyAnnotations({ type }: { type: "all" | "highlights" | "notes" }) {
    const icons = {
        all: Highlighter,
        highlights: Highlighter,
        notes: StickyNote,
    };
    const titles = {
        all: "No Annotations Yet",
        highlights: "No Highlights Yet",
        notes: "No Notes Yet",
    };
    const descriptions = {
        all: "Start reading and highlight text or add notes to see them here.",
        highlights: "Highlight important passages while reading to see them here.",
        notes: "Add notes to your books while reading to see them here.",
    };

    const Icon = icons[type];

    return (
        <div className="ui-empty-state-stack px-4 sm:px-6 flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-surface-muted)] flex items-center justify-center mb-6">
                <Icon className="w-6 h-6 text-[color:var(--color-text-secondary)]" />
            </div>
            <h2 className="ui-empty-state-title text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                {titles[type]}
            </h2>
            <p className="ui-empty-state-copy text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
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
                return <span className="w-4 h-4" />;
        }
    };

    return (
        <div className="group ui-surface p-5 hover:border-[var(--color-text-muted)] transition-colors">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-[color:var(--color-text-muted)]">
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
                        className="p-1.5 rounded-md text-[color:var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    {showMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowMenu(false)}
                            />
                            <div className="absolute right-0 top-full mt-1 w-36 ui-surface shadow-lg z-20 py-1">
                                <button
                                    onClick={() => {
                                        onEdit(annotation.id);
                                        setShowMenu(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
                                >
                                    <Edit3 className="w-4 h-4" />
                                    Edit
                                </button>
                                <button
                                    onClick={() => {
                                        onDelete(annotation.id);
                                        setShowMenu(false);
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[color:var(--color-error)] hover:bg-[var(--color-surface-muted)]"
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
                    <blockquote className="text-sm text-[color:var(--color-text-secondary)] border-l-2 border-[var(--color-border)] pl-3 italic line-clamp-3">
                        "{annotation.selectedText}"
                    </blockquote>
                )}
                {annotation.noteContent && (
                    <p className="text-sm text-[color:var(--color-text-primary)] whitespace-pre-wrap line-clamp-4">
                        {annotation.noteContent}
                    </p>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-border-subtle)]">
                <button
                    onClick={() => book && onGoToBook(annotation.bookId)}
                    className="flex items-center gap-2 text-sm text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] transition-colors"
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
                    <span className="truncate max-w-[var(--layout-inline-title-max-width)]">{book?.title || "Unknown Book"}</span>
                </button>
                <span className="text-xs text-[color:var(--color-text-muted)]">
                    {new Date(annotation.createdAt).toLocaleDateString()}
                </span>
            </div>
        </div>
    );
}

// Filter tabs - removed bookmarks tab
const filterTabs = [
    { id: "all" as const, label: "All", icon: Highlighter },
    { id: "highlights" as const, label: "Highlights", icon: Highlighter },
    { id: "notes" as const, label: "Notes", icon: StickyNote },
];

// Main page component
export function AnnotationsPage() {
    const { annotations, books, removeAnnotation, updateAnnotation } = useLibraryStore();
    const { setRoute, searchQuery } = useUIStore();
    const openReviewSession = useLearningStore((state) => state.openReviewSession);
    const dueHighlightCount = useLearningStore((state) => (
        state.getDueReviewItems(new Date(), "highlight").length
    ));
    const [activeFilter, setActiveFilter] = useState<"all" | "highlights" | "notes">("all");
    const [sortBy, setSortBy] = useState<"newest" | "oldest" | "book">("newest");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState("");
    const bookTitleLookup = useMemo(
        () => new Map(books.map((book) => [book.id, book.title])),
        [books],
    );

    // Filter annotations (excluding bookmarks - they have their own page)
    const filteredAnnotations = useMemo(() => {
        let filtered = annotations.filter((a) => a.type !== "bookmark");

        // Apply type filter
        if (activeFilter !== "all") {
            const typeMap = {
                highlights: "highlight",
                notes: "note",
                all: undefined,
            };
            filtered = filtered.filter((a) => a.type === typeMap[activeFilter]);
        }

        // Apply search filter from global search
        if (searchQuery.trim()) {
            const rankedAnnotations = rankByFuzzyQuery(
                filtered.map((annotation) => ({
                    annotation,
                    selectedText: annotation.selectedText || "",
                    noteContent: annotation.noteContent || "",
                    bookTitle: bookTitleLookup.get(annotation.bookId) || "",
                })),
                searchQuery,
                {
                    keys: [
                        { name: "selectedText", weight: 0.45 },
                        { name: "noteContent", weight: 0.35 },
                        { name: "bookTitle", weight: 0.2 },
                    ],
                },
            );
            return rankedAnnotations.map(({ item }) => item.annotation);
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
                    const bookA = bookTitleLookup.get(a.bookId) || "";
                    const bookB = bookTitleLookup.get(b.bookId) || "";
                    return bookA.localeCompare(bookB);
                default:
                    return 0;
            }
        });

        return filtered;
    }, [annotations, activeFilter, searchQuery, sortBy, bookTitleLookup]);

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

    const handleGoToBook = (bookId: string) => {
        setRoute("reader", bookId);
    };

    const getBookInfo = (bookId: string) => {
        return books.find((b) => b.id === bookId);
    };

    // Filter out bookmarks for the count
    const annotationCount = annotations.filter((a) => a.type !== "bookmark").length;

    if (annotationCount === 0) {
        return (
            <div className="ui-page">
                <EmptyAnnotations type="all" />
            </div>
        );
    }

    return (
        <div className="ui-page animate-fade-in">
            {/* Header */}
            <div className="flex items-start justify-between mb-10">
                <div>
                    <h1 className="ui-page-title">
                        Highlights & Notes
                    </h1>
                    <p className="ui-page-subtitle">
                        {filteredAnnotations.length} {filteredAnnotations.length === 1 ? "annotation" : "annotations"} across{" "}
                        {new Set(filteredAnnotations.map((a) => a.bookId)).size} books
                    </p>
                </div>
                <button
                    onClick={() => openReviewSession("highlight")}
                    disabled={dueHighlightCount === 0}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                        dueHighlightCount > 0
                            ? "bg-[var(--color-accent)] ui-text-accent-contrast"
                            : "bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)]",
                    )}
                >
                    <BrainCircuit className="h-4 w-4" />
                    Review Highlights
                    <span className="rounded-full bg-[var(--color-overlay-subtle)] px-2 py-0.5 text-xs">
                        {dueHighlightCount}
                    </span>
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
                {/* Filter Tabs */}
                <div className="flex items-center gap-1 p-1 bg-[var(--color-surface-muted)] rounded-lg w-fit">
                    {filterTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveFilter(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                                activeFilter === tab.id
                                    ? "bg-[var(--color-surface)] text-[color:var(--color-text-primary)] shadow-sm"
                                    : "text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                            )}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>

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
            </div>

            {/* Edit Modal */}
            <EditNoteModal
                isOpen={!!editingId}
                content={editContent}
                onClose={() => setEditingId(null)}
                onSave={(content) => {
                    if (editingId) {
                        updateAnnotation(editingId, { noteContent: content });
                        setEditingId(null);
                        setEditContent("");
                    }
                }}
            />

            {/* Annotations Grid */}
            {filteredAnnotations.length === 0 ? (
                <div className="text-center py-16">
                    <p className="text-[color:var(--color-text-muted)]">
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
