
import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../../core/lib/utils";
import { rankByFuzzyQuery } from "../../core/lib/search/fuzzy";
import { useLibraryStore, useUIStore } from "../../core/store";
import { HIGHLIGHT_SOLID_COLORS } from "../../core/lib/design-tokens";
import type { HighlightColor } from "../../core/types";
import { EditNoteModal } from "./components/modals/EditNoteModal";
import { PageHeader, Dropdown, ConfirmDialog } from "../../ui";
import {
    Highlighter,
    StickyNote,
    MoreVertical,
    Pencil,
    BookOpen,
    Trash2,
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
} from "lucide-react";
import { ShareMenu } from "./components/ShareMenu";

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
        <div className="mx-auto w-full max-w-[26rem] min-w-0 px-4 sm:px-6 flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 bg-[var(--color-surface-muted)] flex items-center justify-center mb-6">
                <Icon className="w-6 h-6 text-[color:var(--color-text-secondary)]" />
            </div>
            <h2 className="w-full break-words text-balance text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                {titles[type]}
            </h2>
            <p className="mx-auto w-full max-w-[24rem] break-words text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
                {descriptions[type]}
            </p>
        </div>
    );
}

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
    shareId: string | null;
    onDelete: (id: string) => void;
    onEdit: (id: string) => void;
    onGoToBook: (bookId: string) => void;
    onShare: (id: string | null) => void;
}

const AnnotationCard = memo(function AnnotationCard({
    annotation,
    book,
    shareId,
    onDelete,
    onEdit,
    onShare,
}: AnnotationCardProps) {
    const [showMenu, setShowMenu] = useState(false);
    const borderColor = annotation.color ? HIGHLIGHT_SOLID_COLORS[annotation.color] : "var(--color-border)";

    return (
        <div
            className="group bg-[var(--color-surface)] p-5 transition-colors hover:border-[var(--color-accent)]"
            style={{ borderLeft: `3px solid ${borderColor}` }}
        >
            
            <div className="flex items-start justify-between mb-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-sans text-[11px] font-semibold text-[color:var(--color-text-secondary)]">
                            {annotation.type}
                        </span>
                        <span className="font-sans text-[11px] text-[color:var(--color-text-secondary)]">
                            {new Date(annotation.createdAt).toISOString().slice(0, 10)}
                        </span>

                    </div>
                    <div className="mt-2 font-sans text-[11px] text-[color:var(--color-text-secondary)] truncate">
                        {book?.title || "Unknown source"} <span className="text-[color:var(--color-text-muted)]">|</span> {book?.author || "Unknown author"}
                    </div>
                </div>
                <div className="relative">
                    <button
                        onClick={() => setShowMenu(!showMenu)}
                        className="border border-[var(--color-border)] p-1.5 text-[color:var(--color-text-muted)] transition-opacity hover:text-[color:var(--color-text-primary)]"
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    {showMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                role="button"
                                tabIndex={-1}
                                aria-label="Close menu"
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
                                        onShare(annotation.id);
                                        setShowMenu(false);
                                    }}
                                    className="w-full whitespace-nowrap px-3 py-2 text-left font-sans text-[11px] font-medium text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
                                >
                                    Share
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
                    {shareId === annotation.id && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                role="button"
                                tabIndex={-1}
                                aria-label="Close menu"
                                onClick={() => onShare(null)}
                            />
                            <ShareMenu
                                annotation={annotation}
                                book={book}
                                onClose={() => onShare(null)}
                            />
                        </>
                    )}
                </div>
            </div>

            <div className="space-y-3">
                {annotation.selectedText && (
                    <blockquote className="pl-3 font-serif text-[17px] leading-relaxed text-[color:var(--color-text-primary)]">
                        {annotation.selectedText}
                    </blockquote>
                )}
                {annotation.noteContent && (
                    <p className="font-serif text-[16px] leading-relaxed text-[color:var(--color-text-primary)] whitespace-pre-wrap">
                        {annotation.noteContent}
                    </p>
                )}
            </div>
        </div>
    );
});

const filterTabs = [
    { id: "all" as const, label: "All", icon: Highlighter },
    { id: "highlights" as const, label: "Highlights", icon: Highlighter },
    { id: "notes" as const, label: "Notes", icon: StickyNote },
];

export function AnnotationsPage() {
    const annotations = useLibraryStore((state) => state.annotations);
    const books = useLibraryStore((state) => state.books);
    const removeAnnotation = useLibraryStore((state) => state.removeAnnotation);
    const updateAnnotation = useLibraryStore((state) => state.updateAnnotation);
    const currentBookId = useUIStore((state) => state.currentBookId);
    const setRoute = useUIStore((state) => state.setRoute);
    const searchQuery = useUIStore((state) => state.searchQuery);
    const [activeFilter, setActiveFilter] = useState<"all" | "highlights" | "notes">("all");
    const [sortBy, setSortBy] = useState<"newest" | "oldest" | "book">("newest");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState("");
    const [sharingId, setSharingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<"list" | "cards">("list");
    const [cardIndex, setCardIndex] = useState(0);
    const [groupIndex, setGroupIndex] = useState(0);

    const cardTouchStartX = useRef(0);
    const cardTouchStartY = useRef(0);

    const bookTitleLookup = useMemo(
        () => new Map(books.map((book) => [book.id, book.title])),
        [books],
    );

    const filteredAnnotations = useMemo(() => {
        let filtered = annotations.filter((a) => a.type !== "bookmark");

        if (currentBookId) {
            filtered = filtered.filter((annotation) => annotation.bookId === currentBookId);
        }

        if (activeFilter !== "all") {
            const typeMap = {
                highlights: "highlight",
                notes: "note",
                all: undefined,
            };
            filtered = filtered.filter((a) => a.type === typeMap[activeFilter]);
        }

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

    const getBookInfo = (bookId: string) => {
        return useLibraryStore.getState().getBook(bookId);
    };

    const prevLenRef = useRef(filteredAnnotations.length);
    if (filteredAnnotations.length !== prevLenRef.current) {
        prevLenRef.current = filteredAnnotations.length;
        setGroupIndex(0);
        setCardIndex(0);
    }

    const annotationGroups = useMemo(() => {
        const groups = new Map<string, typeof filteredAnnotations>();
        for (const ann of filteredAnnotations) {
            const key = ann.bookId;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(ann);
        }
        return Array.from(groups.entries()).map(([bookId, annotations]) => ({
            bookId,
            annotations,
            book: getBookInfo(bookId),
            title: bookTitleLookup.get(bookId) || "Unknown source",
        }));
    }, [filteredAnnotations, bookTitleLookup]);

    const handleCardTouchStart = useCallback((e: React.TouchEvent) => {
        cardTouchStartX.current = e.touches[0].clientX;
        cardTouchStartY.current = e.touches[0].clientY;
    }, []);
    const handleCardTouchEnd = useCallback((e: React.TouchEvent) => {
        const dx = e.changedTouches[0].clientX - cardTouchStartX.current;
        const dy = e.changedTouches[0].clientY - cardTouchStartY.current;
        if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy)) return;
        const group = annotationGroups[groupIndex];
        if (!group) return;
        if (dx > 0) {
            if (cardIndex > 0) setCardIndex(i => i - 1);
            else if (groupIndex > 0) { setGroupIndex(g => g - 1); setCardIndex(0); }
        } else {
            if (cardIndex < group.annotations.length - 1) setCardIndex(i => i + 1);
            else if (groupIndex < annotationGroups.length - 1) { setGroupIndex(g => g + 1); setCardIndex(0); }
        }
    }, [cardIndex, groupIndex, annotationGroups]);

    const annotationsVirtualizer = useVirtualizer({
        count: filteredAnnotations.length,
        getScrollElement: useCallback(() => document.getElementById('app-main'), []),
        estimateSize: useCallback(() => 160, []),
        overscan: 3,
        measureElement: (el) => el.getBoundingClientRect().height,
    });

    const [deleteAnnotationId, setDeleteAnnotationId] = useState<string | null>(null);

    useEffect(() => {
        if (viewMode !== "cards" || annotationGroups.length === 0) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") {
                if (cardIndex > 0) {
                    setCardIndex(i => i - 1);
                } else if (groupIndex > 0) {
                    setGroupIndex(g => g - 1);
                    const prevGroup = annotationGroups[groupIndex - 1];
                    setCardIndex(prevGroup.annotations.length - 1);
                }
            }
            if (e.key === "ArrowRight") {
                const group = annotationGroups[groupIndex];
                if (cardIndex < group.annotations.length - 1) {
                    setCardIndex(i => i + 1);
                } else if (groupIndex < annotationGroups.length - 1) {
                    setGroupIndex(g => g + 1);
                    setCardIndex(0);
                }
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [viewMode, annotationGroups, groupIndex, cardIndex]);

    const handleDelete = (id: string) => {
        setDeleteAnnotationId(id);
    };

    const handleDeleteConfirm = () => {
        if (deleteAnnotationId) {
            removeAnnotation(deleteAnnotationId);
            setDeleteAnnotationId(null);
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

    const handleShare = (id: string | null) => {
        setSharingId(id);
    };

    const annotationCount = annotations.filter((a) => a.type !== "bookmark").length;
    const selectedBookTitle = currentBookId
        ? (bookTitleLookup.get(currentBookId) || "Selected reference")
        : null;

    if (annotationCount === 0) {
        return (
            <div className="mx-auto w-full max-w-[var(--layout-content-max-width)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
                <EmptyAnnotations type="all" />
            </div>
        );
    }

    return (
            <div className="mx-auto w-full max-w-[var(--layout-content-max-width)] px-4 py-6 pb-0 sm:px-6 lg:px-8 lg:py-8 animate-fade-in">
            
            <PageHeader
                title="Workbench"
                description={`${filteredAnnotations.length} ${filteredAnnotations.length === 1 ? "annotation" : "annotations"} across ${new Set(filteredAnnotations.map((a) => a.bookId)).size} books`}
            />

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

            <div className="mb-10 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                
                <div className="flex items-center gap-1 w-fit">
                    {filterTabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveFilter(tab.id)}
                            className={cn(
                                "border border-[var(--color-border)] px-3 py-2 font-sans text-xs font-medium transition-colors",
                                activeFilter === tab.id
                                    ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
                                    : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setViewMode(viewMode === "list" ? "cards" : "list")}
                        className={cn(
                            "border border-[var(--color-border)] px-3 py-2 font-sans text-xs font-medium transition-colors",
                            viewMode === "cards"
                                ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
                                : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                        )}
                        aria-label={viewMode === "list" ? "Card view" : "List view"}
                    >
                        {viewMode === "list" ? "Cards" : "List"}
                    </button>

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
            </div>

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

            <ConfirmDialog
                isOpen={!!deleteAnnotationId}
                title="Delete Annotation"
                message="Are you sure you want to delete this annotation?"
                confirmLabel="Delete"
                cancelLabel="Cancel"
                variant="danger"
                onConfirm={handleDeleteConfirm}
                onCancel={() => setDeleteAnnotationId(null)}
            />

            {filteredAnnotations.length === 0 ? (
                <div className="text-center py-16">
                    <p className="text-[color:var(--color-text-muted)]">
                        No {activeFilter === "all" ? "" : activeFilter} found
                        {searchQuery ? " matching your search" : ""}.
                    </p>
                </div>
            ) : viewMode === "cards" ? (
                <div className="flex flex-col items-center">
                    <div className="w-full max-w-[42rem]">
                        {annotationGroups.length === 0 ? (
                            <div className="text-center py-16">
                                <p className="text-[color:var(--color-text-muted)]">No annotations to display as cards.</p>
                            </div>
                        ) : (
                            <>
                                <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-1">
                                    <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
                                        <span className="text-[10px] font-medium text-[color:var(--color-text-muted)] uppercase tracking-wider whitespace-nowrap">
                                            Deck {groupIndex + 1} of {annotationGroups.length}
                                        </span>
                                        <span className="text-[color:var(--color-border)] hidden sm:inline shrink-0">|</span>
                                        <span className="text-[10px] font-medium text-[color:var(--color-text-muted)] uppercase tracking-wider truncate min-w-0">
                                            {annotationGroups[groupIndex].title}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1 self-end sm:self-auto">
                                        <button
                                            onClick={() => {
                                                if (groupIndex > 0) {
                                                    setGroupIndex(g => g - 1);
                                                    setCardIndex(0);
                                                }
                                            }}
                                            disabled={groupIndex === 0}
                                            className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] uppercase tracking-wider disabled:opacity-30 transition-colors touch-manipulation"
                                            aria-label="Previous book"
                                        >
                                            <ChevronsLeft className="w-3.5 h-3.5 sm:hidden" />
                                            <span className="hidden sm:inline">← Prev Book</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (groupIndex < annotationGroups.length - 1) {
                                                    setGroupIndex(g => g + 1);
                                                    setCardIndex(0);
                                                }
                                            }}
                                            disabled={groupIndex >= annotationGroups.length - 1}
                                            className="inline-flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] uppercase tracking-wider disabled:opacity-30 transition-colors touch-manipulation"
                                            aria-label="Next book"
                                        >
                                            <span className="hidden sm:inline">Next Book →</span>
                                            <ChevronsRight className="w-3.5 h-3.5 sm:hidden" />
                                        </button>
                                    </div>
                                </div>

                                {(() => {
                                    const group = annotationGroups[groupIndex];
                                    const ann = group.annotations[cardIndex];
                                    const book = group.book;

                                    return (
                                        <div
                                            className="border border-[var(--color-border)] bg-[var(--color-surface)]"
                                            onTouchStart={handleCardTouchStart}
                                            onTouchEnd={handleCardTouchEnd}
                                        >
                                            <div className="px-4 sm:px-8 pt-4 sm:pt-8 pb-3 sm:pb-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between min-h-0">
                                                <div className="flex items-center gap-2 text-[11px] text-[color:var(--color-text-secondary)] font-medium min-w-0">
                                                    {ann.color && (
                                                        <span className="w-2.5 h-2.5 shrink-0 border border-[var(--color-border)]" style={{ backgroundColor: HIGHLIGHT_SOLID_COLORS[ann.color] }} />
                                                    )}
                                                    <span className="truncate">{book?.title || "Unknown source"}</span>
                                                    {book?.author && <><span className="text-[color:var(--color-text-muted)] shrink-0">·</span><span className="truncate hidden sm:inline">{book.author}</span></>}
                                                </div>
                                            </div>

                                            <div className="px-4 sm:px-8 py-6 sm:py-10">
                                                {ann.selectedText && (
                                                    <blockquote
                                                        className="pl-4 sm:pl-5 leading-relaxed font-serif text-[1.05rem] sm:text-[1.25rem] text-[color:var(--color-text-primary)] border-l-[3px]"
                                                        style={{ borderColor: ann.color ? HIGHLIGHT_SOLID_COLORS[ann.color] : 'var(--color-accent)' }}
                                                    >
                                                        {ann.selectedText}
                                                    </blockquote>
                                                )}

                                                {ann.noteContent && (
                                                    <>
                                                        {ann.selectedText && <div className="my-4 sm:my-6 border-t border-[var(--color-border-subtle)]" />}
                                                        <p className="font-sans text-[12px] sm:text-[13px] leading-relaxed text-[color:var(--color-text-secondary)] whitespace-pre-wrap">
                                                            {ann.noteContent}
                                                        </p>
                                                    </>
                                                )}
                                            </div>

                                            <div className="px-4 sm:px-8 py-2.5 sm:py-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between gap-1">
                                                <button
                                                    onClick={() => {
                                                        if (cardIndex > 0) {
                                                            setCardIndex(i => i - 1);
                                                        } else if (groupIndex > 0) {
                                                            setGroupIndex(g => g - 1);
                                                            setCardIndex(annotationGroups[groupIndex - 1].annotations.length - 1);
                                                        }
                                                    }}
                                                    disabled={groupIndex === 0 && cardIndex === 0}
                                                    className="inline-flex items-center gap-1 ui-btn text-[11px] disabled:opacity-30 touch-manipulation"
                                                    aria-label="Previous card"
                                                >
                                                    <ChevronLeft className="w-4 h-4 sm:hidden" />
                                                    <span className="hidden sm:inline">← Previous</span>
                                                </button>

                                                <div className="flex items-center gap-1 sm:gap-1.5 px-1 overflow-hidden">
                                                    {group.annotations.slice(0, Math.min(group.annotations.length, 20)).map((_, i) => {
                                                        const distance = Math.abs(i - cardIndex);
                                                        if (distance > 4 && group.annotations.length > 9) return null;
                                                        return (
                                                            <button
                                                                key={i}
                                                                onClick={() => setCardIndex(i)}
                                                                className="rounded-full border-0 p-0 transition-[transform,background-color] duration-200 touch-manipulation"
                                                                style={{
                                                                    width: i === cardIndex ? '10px' : '6px',
                                                                    height: i === cardIndex ? '10px' : '6px',
                                                                    backgroundColor: i === cardIndex ? 'var(--color-accent)' : 'var(--color-border)',
                                                                }}
                                                                aria-label={`Go to card ${i + 1}`}
                                                            />
                                                        );
                                                    })}
                                                </div>

                                                <button
                                                    onClick={() => {
                                                        if (cardIndex < group.annotations.length - 1) {
                                                            setCardIndex(i => i + 1);
                                                        } else if (groupIndex < annotationGroups.length - 1) {
                                                            setGroupIndex(g => g + 1);
                                                            setCardIndex(0);
                                                        }
                                                    }}
                                                    disabled={groupIndex === annotationGroups.length - 1 && cardIndex >= group.annotations.length - 1}
                                                    className="inline-flex items-center gap-1 ui-btn text-[11px] disabled:opacity-30 touch-manipulation"
                                                    aria-label="Next card"
                                                >
                                                    <span className="hidden sm:inline">Next →</span>
                                                    <ChevronRight className="w-4 h-4 sm:hidden" />
                                                </button>
                                            </div>

                                            <div className="px-4 sm:px-8 py-2 border-t border-[var(--color-border-subtle)] flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
                                                <span className="text-[10px] font-medium text-[color:var(--color-text-muted)] tracking-wider uppercase whitespace-nowrap">
                                                    {cardIndex + 1}/{group.annotations.length}
                                                    <span className="hidden sm:inline"> in this book</span>
                                                </span>
                                                <button
                                                    onClick={() => { handleEdit(ann.id); }}
                                                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] uppercase tracking-wider transition-colors touch-manipulation"
                                                    aria-label="Edit"
                                                >
                                                    <Pencil className="w-3 h-3 sm:hidden" />
                                                    <span className="hidden sm:inline">Edit</span>
                                                </button>
                                                <button
                                                    onClick={() => handleGoToBook(ann.bookId)}
                                                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] uppercase tracking-wider transition-colors touch-manipulation"
                                                    aria-label="Open book"
                                                >
                                                    <BookOpen className="w-3 h-3 sm:hidden" />
                                                    <span className="hidden sm:inline">Open Book</span>
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(ann.id)}
                                                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[color:var(--color-error)] hover:text-[color:var(--color-error)] uppercase tracking-wider transition-colors touch-manipulation"
                                                    aria-label="Delete"
                                                >
                                                    <Trash2 className="w-3 h-3 sm:hidden" />
                                                    <span className="hidden sm:inline">Delete</span>
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </>
                        )}
                    </div>
                </div>
            ) : (
                <div style={{ height: `${annotationsVirtualizer.getTotalSize()}px`, position: "relative" }}>
                    <div style={{ paddingTop: `${annotationsVirtualizer.getVirtualItems()[0]?.start ?? 0}px` }}>
                        {annotationsVirtualizer.getVirtualItems().map((virtualRow) => (
                            <div key={virtualRow.key} data-index={virtualRow.index} ref={annotationsVirtualizer.measureElement} className="pb-4">
                                <AnnotationCard
                                    annotation={filteredAnnotations[virtualRow.index]}
                                    book={getBookInfo(filteredAnnotations[virtualRow.index].bookId)}
                                    shareId={sharingId}
                                    onDelete={handleDelete}
                                    onEdit={handleEdit}
                                    onGoToBook={handleGoToBook}
                                    onShare={handleShare}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
