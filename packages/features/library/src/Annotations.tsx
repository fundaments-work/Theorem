/**
 * Annotations/Highlights Page
 * View and manage all highlights and notes across books
 */

import { useState, useMemo } from "react";
import { HIGHLIGHT_SOLID_COLORS } from "@theorem/core";
import { cn } from "@theorem/core";
import { rankByFuzzyQuery } from "@theorem/core";
import { useLibraryStore, useUIStore } from "@theorem/core";
import type { HighlightColor } from "@theorem/core";
import { EditNoteModal } from "@theorem/ui";
import { Dropdown } from "@theorem/ui";
import {
    Highlighter,
    StickyNote,
    MoreVertical,
} from "lucide-react";

// Color badge component
function ColorBadge({ color }: { color: HighlightColor }) {
    return (
        <span
            className="inline-block w-2.5 h-2.5 border border-[var(--color-border)]"
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
        location: string;
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

    return (
        <div className="group border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-colors hover:border-black">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-sans text-[11px] font-semibold text-[color:var(--color-text-secondary)]">
                            {annotation.type}
                        </span>
                        <span className="font-sans text-[11px] text-[color:var(--color-text-secondary)]">
                            {new Date(annotation.createdAt).toISOString().slice(0, 10)}
                        </span>
                        {annotation.color && <ColorBadge color={annotation.color} />}
                    </div>
                    <div className="mt-2 font-sans text-[11px] text-[color:var(--color-text-secondary)]">
                        {book?.title || "Unknown source"} | {book?.author || "Unknown author"}
                    </div>
                </div>
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="border border-[var(--color-border)] p-1.5 text-[color:var(--color-text-muted)] opacity-0 transition-opacity hover:text-[color:var(--color-text-primary)] group-hover:opacity-100"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    {showMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={() => setShowMenu(false)}
                            />
                            <div className="absolute right-0 top-full z-20 mt-1 w-40 border border-[var(--color-border)] bg-[var(--color-surface)] py-1">
                                <button
                                    onClick={() => {
                                        onEdit(annotation.id);
                                        setShowMenu(false);
                                    }}
                                    className="w-full whitespace-nowrap px-3 py-2 text-left font-sans text-[11px] font-medium text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
                                >
                                    Edit note
                                </button>
                                <button
                                    onClick={() => {
                                        onDelete(annotation.id);
                                        setShowMenu(false);
                                    }}
                                    className="w-full whitespace-nowrap px-3 py-2 text-left font-sans text-[11px] font-medium text-[color:var(--color-error)] hover:bg-[var(--color-surface-muted)]"
                                >
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
                    <blockquote className="border-l-2 border-black pl-3 font-serif text-[17px] leading-relaxed text-[color:var(--color-text-primary)]">
                        {annotation.selectedText}
                    </blockquote>
                )}
                {annotation.noteContent && (
                    <p className="font-serif text-[16px] leading-relaxed text-[color:var(--color-text-primary)] whitespace-pre-wrap">
                        {annotation.noteContent}
                    </p>
                )}
            </div>

            {/* Footer */}
            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
                <button
                    onClick={() => book && onGoToBook(annotation.bookId)}
                    className="font-sans text-[11px] font-medium text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-text-primary)]"
                >
                    Open source
                </button>
                <div className="mt-3 border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-sans text-[11px] text-[color:var(--color-text-secondary)]">
                    Location: {annotation.location}
                </div>
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
    const {
        currentBookId,
        setRoute,
        searchQuery,
        vaultSyncStatus,
        vaultSyncMessage,
    } = useUIStore();
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

        if (currentBookId) {
            filtered = filtered.filter((annotation) => annotation.bookId === currentBookId);
        }

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
    }, [annotations, activeFilter, currentBookId, searchQuery, sortBy, bookTitleLookup]);

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
    const selectedBookTitle = currentBookId
        ? (bookTitleLookup.get(currentBookId) || "Selected reference")
        : null;

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
            <div className="mb-8 flex items-start justify-between">
                <div>
                    <h1 className="ui-page-title">
                        Workbench
                    </h1>
                    <p className="ui-page-subtitle">
                        {filteredAnnotations.length} {filteredAnnotations.length === 1 ? "annotation" : "annotations"} across{" "}
                        {new Set(filteredAnnotations.map((a) => a.bookId)).size} books
                    </p>
                </div>
            </div>

            <div className="mb-8 border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-sans text-[11px] font-medium text-[color:var(--color-text-primary)]">
                {vaultSyncStatus === "synced" && "Status: Synced to vault"}
                {vaultSyncStatus === "syncing" && "Status: Appending to markdown"}
                {vaultSyncStatus === "error" && "Status: Sync error"}
                {vaultSyncStatus === "idle" && "Status: Idle"}
                {vaultSyncMessage ? ` | ${vaultSyncMessage}` : ""}
            </div>

            {currentBookId && (
                <div className="mb-8 flex flex-wrap items-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-sans text-[11px] font-medium">
                    <span className="text-[color:var(--color-text-secondary)]">
                        Showing annotations for:
                    </span>
                    <span className="text-[color:var(--color-text-primary)]">{selectedBookTitle}</span>
                    <button
                        onClick={() => setRoute("annotations")}
                        className="ml-auto border border-[var(--color-border)] px-2 py-1 text-[11px] font-medium text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                    >
                        Clear
                    </button>
                </div>
            )}

            {/* Filters */}
            <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                {/* Filter Tabs */}
                <div className="flex items-center gap-1 w-fit">
                    {filterTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveFilter(tab.id)}
                            className={cn(
                                "border border-[var(--color-border)] px-3 py-1.5 font-sans text-[11px] font-medium transition-colors",
                                activeFilter === tab.id
                                    ? "bg-[var(--color-accent)] text-white ui-force-on-accent"
                                    : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                            )}
                        >
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
