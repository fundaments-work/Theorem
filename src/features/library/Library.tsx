/**
 * Library Page
 * Book management and import with right-click context menu, filtering, and sorting
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
    cn,
    normalizeFilePath,
    normalizeAuthor,
} from "../../core";
import { useLibraryStore, useUIStore, useSettingsStore } from "../../core";
import { formatProgress, formatFileSize, formatRelativeDate } from "../../core";
import {
    ensureFilenameForFormat,
    extractFilenameMetadata,
    extractFilenameFromPath,
    pickLibraryFolderMobile,
    importBooksIncremental,
    pickAndImportBooksIncremental,
    scanLibraryFolderMobile,
    scanFolderForBooks,
} from "../../core";
import {
    Plus, Filter, BookOpen, Loader2, FolderOpen, RefreshCw,
    Heart, Trash2, BookMarked, Info, LayoutGrid, List, Grid3X3, CheckCheck, RotateCcw,
    ChevronDown, Star, X, ArrowUpDown, Check, CloudOff
} from "lucide-react";
import type { Book, Collection, LibraryViewMode, LibrarySortBy, LibrarySortOrder } from "../../core";
import { FORMAT_DISPLAY_NAMES } from "../../core";
import { isMobile, isTauri } from "../../core";
import { getBookData } from "../../core";
import { ContextMenu } from "../../ui";
import type { ContextMenuItem } from "../../ui";
import { Dropdown } from "../../ui";
import { Modal, ModalBody, ModalFooter } from "../../ui";
import { confirmDeleteBook } from "../../core";
import { showOpenDirectoryDialog } from "../../core";
import { getShelfColor, getShelfInitials } from "../../core";
import { getFilteredAndSortedBooks } from "./filtering";

// View mode icons
const viewModeIcons: Record<LibraryViewMode, React.ReactNode> = {
    grid: <LayoutGrid className="w-4 h-4" />,
    list: <List className="w-4 h-4" />,
    compact: <Grid3X3 className="w-4 h-4" />,
};

const TOOLBAR_BUTTON_BASE =
    "ui-btn disabled:opacity-50";
const TOOLBAR_BUTTON_PRIMARY =
    "ui-btn-primary disabled:opacity-50";
const TOOLBAR_ICON_BUTTON = "h-10 w-10 px-0";

type ExtractMetadataFn = typeof import("../../core").extractMetadata;

const COVER_EXTRACTION_BATCH_SIZE = 3;
const IMPORT_METADATA_TIMEOUT_MS = isMobile() ? 9000 : 6000;
const IMPORT_COVER_TIMEOUT_MS = isMobile() ? 7000 : 4000;
const IMPORT_METADATA_QUEUE_CONCURRENCY = isMobile() ? 1 : 3;
const BATCH_METADATA_TIMEOUT_MS = isMobile() ? 22000 : 10000;
const BATCH_COVER_TIMEOUT_MS = isMobile() ? 16000 : 5000;
const MAX_METADATA_EXTRACTION_ATTEMPTS = isMobile() ? 4 : 6;
let extractMetadataPromise: Promise<ExtractMetadataFn> | null = null;

async function getExtractMetadataFn(): Promise<ExtractMetadataFn> {
    if (!extractMetadataPromise) {
        extractMetadataPromise = import("../../core").then(
            (module) => module.extractMetadata,
        );
    }
    return extractMetadataPromise;
}

function normalizeMetadataText(value: string | undefined): string {
    return (value || "").replace(/\s+/g, " ").trim();
}

function shouldUseExtractedTitle(book: Book, extractedTitle: string | undefined): boolean {
    const nextTitle = normalizeMetadataText(extractedTitle);
    if (!nextTitle) {
        return false;
    }

    const loweredNext = nextTitle.toLowerCase();
    if (loweredNext === "unknown title" || loweredNext === "untitled" || loweredNext === "untitled book") {
        return false;
    }

    const currentTitle = normalizeMetadataText(book.title);
    if (!currentTitle) {
        return true;
    }
    if (currentTitle === nextTitle) {
        return false;
    }

    const filenameFallbackTitle = normalizeMetadataText(extractFilenameMetadata(book.filePath).title);
    const currentIsFilenameFallback = (
        filenameFallbackTitle.length > 0
        && currentTitle.toLowerCase() === filenameFallbackTitle.toLowerCase()
    );

    return currentTitle === "Unknown" || currentTitle.includes(".") || currentIsFilenameFallback;
}

function shouldUseExtractedAuthor(book: Book, extractedAuthor: string | undefined): boolean {
    const nextAuthor = normalizeMetadataText(extractedAuthor);
    if (!nextAuthor || nextAuthor.toLowerCase() === "unknown author") {
        return false;
    }

    const currentAuthor = normalizeMetadataText(normalizeAuthor(book.author));
    if (!currentAuthor) {
        return true;
    }
    if (currentAuthor === nextAuthor) {
        return false;
    }

    const filenameFallbackAuthor = normalizeMetadataText(extractFilenameMetadata(book.filePath).author);
    const currentIsFilenameFallback = (
        filenameFallbackAuthor.length > 0
        && currentAuthor.toLowerCase() === filenameFallbackAuthor.toLowerCase()
    );

    return currentAuthor === "Unknown Author" || currentIsFilenameFallback;
}

function hasEncodedContentUriFallbackTitle(book: Book): boolean {
    return book.filePath.startsWith("content://") && /%[0-9a-f]{2}/i.test(book.title);
}

function isLikelyGeneratedFallbackCover(coverPath?: string): boolean {
    if (!coverPath || !coverPath.startsWith("data:image/svg+xml")) {
        return false;
    }

    try {
        const [, payload = ""] = coverPath.split(",", 2);
        const content = coverPath.includes(";base64,")
            ? atob(payload)
            : decodeURIComponent(payload);
        return content.includes("Book cover fallback");
    } catch {
        return false;
    }
}

function shouldRetryMissingCoverExtraction(book: Book): boolean {
    return !book.coverPath && book.coverExtractionDone === true;
}

function isBookMarkedRead(book: Book): boolean {
    if (book.manualCompletionState === "read") {
        return true;
    }
    if (book.manualCompletionState === "unread") {
        return false;
    }
    return !!book.completedAt || book.progress >= 0.999;
}

// Book Card Component with Context Menu
function BookCard({
    book,
    viewMode,
    onOpenBook,
    onToggleFavorite,
    onDeleteBook,
    onShowInfo,
    onAddToShelf,
    onMarkAsRead,
    onMarkAsUnread,
}: {
    book: Book;
    viewMode: LibraryViewMode;
    onOpenBook: (book: Book) => void;
    onToggleFavorite: (bookId: string) => void;
    onDeleteBook: (bookId: string) => void;
    onShowInfo: (book: Book) => void;
    onAddToShelf: (bookId: string) => void;
    onMarkAsRead: (bookId: string) => void;
    onMarkAsUnread: (bookId: string) => void;
}) {
    const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const clickCountRef = useRef(0);
    const isCompleted = isBookMarkedRead(book);

    const handleCardClick = () => {
        clickCountRef.current += 1;

        if (clickCountRef.current === 1) {
            // First click - wait to see if it's a double click
            clickTimeoutRef.current = setTimeout(() => {
                if (clickCountRef.current === 1) {
                    // Single click - open book
                    onOpenBook(book);
                }
                clickCountRef.current = 0;
            }, 250);
        } else if (clickCountRef.current === 2) {
            // Double click - toggle favorite
            if (clickTimeoutRef.current) {
                clearTimeout(clickTimeoutRef.current);
            }
            onToggleFavorite(book.id);
            clickCountRef.current = 0;
        }
    };

    // Build context menu items
    const contextMenuItems: ContextMenuItem[] = [
        {
            id: "open",
            label: "Open Book",
            icon: <BookOpen className="w-4 h-4" />,
            shortcut: "Enter",
            onClick: () => onOpenBook(book),
        },
        {
            id: "favorite",
            label: book.isFavorite ? "Remove from Favorites" : "Add to Favorites",
            icon: <Heart className={cn("w-4 h-4", book.isFavorite && "fill-current")} />,
            onClick: () => onToggleFavorite(book.id),
        },
        {
            id: isCompleted ? "mark-as-unread" : "mark-as-read",
            label: isCompleted ? "Mark Unfinish" : "Mark Finish",
            icon: isCompleted ? <RotateCcw className="w-4 h-4" /> : <CheckCheck className="w-4 h-4" />,
            onClick: () => {
                if (isCompleted) {
                    onMarkAsUnread(book.id);
                    return;
                }
                onMarkAsRead(book.id);
            },
        },
        {
            id: "add-to-shelf",
            label: "Add to Shelf...",
            icon: <BookMarked className="w-4 h-4" />,
            onClick: () => onAddToShelf(book.id),
        },
        {
            id: "separator1",
            label: "",
            separator: true,
        },
        {
            id: "info",
            label: "Book Info",
            icon: <Info className="w-4 h-4" />,
            onClick: () => onShowInfo(book),
        },
        {
            id: "separator2",
            label: "",
            separator: true,
        },
        {
            id: "delete",
            label: "Delete from Library",
            icon: <Trash2 className="w-4 h-4" />,
            danger: true,
            onClick: () => onDeleteBook(book.id),
        },
    ];

    // Grid view
    if (viewMode === "grid") {
        return (
            <ContextMenu items={contextMenuItems}>
                <div
                    className="group flex flex-col text-left w-full select-none"
                    onClick={handleCardClick}
                >
                    {/* Cover Image */}
                    <div
                        className={cn(
                            "relative aspect-[2/3] bg-[var(--color-surface-muted)] mb-3 overflow-hidden",
                            "border border-[var(--color-border)]",
                            "transition-all duration-300 group-hover:shadow-lg group-hover:-translate-y-1 cursor-pointer"
                        )}
                    >
                        {book.coverPath ? (
                            <img
                                src={book.coverPath}
                                alt={book.title}
                                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                loading="lazy"
                            />
                        ) : (
                            <div className="book-cover-placeholder w-full h-full text-[10px] p-2 flex items-center justify-center bg-[var(--color-surface-muted)]">
                                <span className="line-clamp-3 text-center uppercase tracking-tighter opacity-40 font-bold">{book.title}</span>
                            </div>
                        )}

                        {/* Progress Bar */}
                        {book.progress > 0 && (
                            <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-overlay-subtle)]">
                                <div
                                    className="h-full bg-[var(--color-accent)] transition-all duration-500"
                                    style={{ width: `${book.progress * 100}%` }}
                                />
                            </div>
                        )}

                        {/* Favorite Badge */}
                        <div
                            className={cn(
                                "absolute top-2 right-2 w-6 h-6 flex items-center justify-center transition-all duration-300 pointer-events-none",
                                book.isFavorite
                                    ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] scale-100"
                                    : "bg-white/90 text-[color:var(--color-text-secondary)] scale-0 opacity-0 group-hover:scale-100 group-hover:opacity-100"
                            )}
                        >
                            <Heart className={cn("w-3 h-3", book.isFavorite ? "fill-current" : "")} />
                        </div>

                        {/* Synced Without File Badge */}
                        {book.syncedWithoutFile && (
                            <div className="absolute top-2 left-2 w-6 h-6 flex items-center justify-center text-white rounded-sm pointer-events-none" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 90%, transparent)' }} title="Book file not available locally">
                                <CloudOff className="w-3 h-3" />
                            </div>
                        )}
                    </div>

                    {/* Book Info */}
                    <div className="px-0.5">
                        <h3 className="font-bold text-[11px] uppercase tracking-wide text-[color:var(--color-text-primary)] line-clamp-1 mb-0.5 transition-colors group-hover:text-[color:var(--color-accent)]">
                            {book.title}
                        </h3>
                        <p className="text-[10px] font-medium text-[color:var(--color-text-secondary)] line-clamp-1 opacity-60 uppercase tracking-tight">
                            {normalizeAuthor(book.author) || "Unknown Author"}
                        </p>
                    </div>
                </div>
            </ContextMenu>
        );
    }

    // List view
    if (viewMode === "list") {
        return (
            <ContextMenu items={contextMenuItems}>
                <div
                    className="group flex w-full items-center gap-3 p-3 transition-colors hover:bg-[var(--color-surface-muted)] sm:gap-4 cursor-pointer select-none"
                    onClick={handleCardClick}
                >
                    {/* Cover Image */}
                    <div className={cn(
                        "relative w-12 h-16 flex-shrink-0 bg-[var(--color-surface-muted)] overflow-hidden",
                        "border border-[var(--color-border)]"
                    )}>
                        {book.coverPath ? (
                            <img
                                src={book.coverPath}
                                alt={book.title}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="book-cover-placeholder w-full h-full text-[0.625rem] leading-tight p-1 flex items-center justify-center">
                                <span className="line-clamp-2 text-center">{book.title}</span>
                            </div>
                        )}
                    </div>

                    {/* Book Info */}
                    <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm text-[color:var(--color-text-primary)] truncate">
                            {book.title}
                        </h3>
                        <p className="text-xs text-[color:var(--color-text-secondary)] truncate">
                            {normalizeAuthor(book.author) || "Unknown Author"}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                            <div
                                className={cn(
                                    "transition-colors pointer-events-none",
                                    book.isFavorite
                                        ? "text-[color:var(--color-accent)]"
                                        : "opacity-0"
                                )}
                            >
                                <Heart className={cn("w-3 h-3 fill-current")} />
                            </div>
                            {book.rating && (
                                <div className="flex items-center gap-0.5">
                                    <Star className="w-3 h-3 text-[color:var(--color-warning)] fill-current" />
                                    <span className="text-[var(--font-size-3xs)] text-[color:var(--color-text-muted)]">{book.rating}</span>
                                </div>
                            )}
                            {book.syncedWithoutFile && (
                                <div className="flex items-center gap-0.5 text-[color:var(--color-warning)]" title="Book file not available locally">
                                    <CloudOff className="w-3 h-3" />
                                    <span className="text-[var(--font-size-3xs)]">No file</span>
                                </div>
                            )}
                        </div>
                        {book.progress > 0 && (
                            <p className="mt-1 text-[0.6875rem] text-[color:var(--color-text-muted)] sm:hidden">
                                {formatProgress(book.progress)}
                            </p>
                        )}
                    </div>

                    {/* Progress */}
                    <div className="hidden text-right sm:block">
                        {book.progress > 0 ? (
                            <p className="text-sm text-[color:var(--color-text-secondary)]">
                                {formatProgress(book.progress)}
                            </p>
                        ) : (
                            <p className="text-xs text-[color:var(--color-text-muted)]">Not started</p>
                        )}
                    </div>
                </div>
            </ContextMenu>
        );
    }

    // Compact view
    return (
        <ContextMenu items={contextMenuItems}>
            <div
                onClick={handleCardClick}
                className="group relative aspect-[2/3] bg-[var(--color-surface-muted)] overflow-hidden border border-[var(--color-border)] hover:shadow-lg transition-all duration-200 w-full cursor-pointer select-none"
            >
                {book.coverPath ? (
                    <img
                        src={book.coverPath}
                        alt={book.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="book-cover-placeholder w-full h-full text-[var(--font-size-3xs)] p-2 flex items-center justify-center">
                        <span className="line-clamp-3 text-center">{book.title}</span>
                    </div>
                )}

                {/* Progress Bar */}
                {book.progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-overlay-subtle)]">
                        <div
                            className="h-full bg-[var(--color-accent)]"
                            style={{ width: `${book.progress * 100}%` }}
                        />
                    </div>
                )}

                {/* Favorite Badge */}
                <div
                    className={cn(
                        "absolute top-1 right-1 w-5 h-5 flex items-center justify-center transition-colors pointer-events-none",
                        book.isFavorite
                            ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
                            : "opacity-0"
                    )}
                >
                    <Heart className={cn("w-2.5 h-2.5 fill-current")} />
                </div>

                {/* Synced Without File Badge */}
                {book.syncedWithoutFile && (
                    <div className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center text-white rounded-sm pointer-events-none" style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning) 90%, transparent)' }} title="Book file not available locally">
                        <CloudOff className="w-2.5 h-2.5" />
                    </div>
                )}
            </div>
        </ContextMenu>
    );
}

// Empty State Component
function EmptyLibrary({
    onAddBooks,
    onScanFolder,
    isImporting,
    isScanning,
}: {
    onAddBooks: () => void;
    onScanFolder?: () => void;
    isImporting: boolean;
    isScanning: boolean;
}) {
    return (
        <div className="mx-auto w-full max-w-[26rem] min-w-0 px-4 sm:px-6 flex flex-col items-center justify-center py-24 text-center animate-fade-in">
            <div className="w-16 h-16 bg-[var(--color-surface-muted)] flex items-center justify-center mb-6">
                <BookOpen className="w-6 h-6 text-[color:var(--color-text-secondary)]" />
            </div>
            <h2 className="w-full break-words text-balance text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                No books yet
            </h2>
            <p className="mx-auto w-full max-w-[24rem] break-words text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
                Import books to start reading
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                    onClick={onAddBooks}
                    disabled={isImporting}
                    className={cn(TOOLBAR_BUTTON_PRIMARY, "min-w-[10.5rem] whitespace-nowrap px-6 py-2.5")}
                >
                    {isImporting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Plus className="w-4 h-4" />
                    )}
                    <span>{isImporting ? "Importing..." : "Import Books"}</span>
                </button>

                {onScanFolder && (
                    <button
                        onClick={onScanFolder}
                        disabled={isScanning}
                        className={cn(TOOLBAR_BUTTON_BASE, "min-w-[10.5rem] whitespace-nowrap px-6 py-2.5")}
                    >
                        {isScanning ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                            <FolderOpen className="w-4 h-4" />
                        )}
                        <span>{isScanning ? "Scanning..." : "Scan Folder"}</span>
                    </button>
                )}
            </div>
        </div>
    );
}

// Import Button Component
function ImportButton({
    onImport,
    isLoading
}: {
    onImport: () => void;
    isLoading: boolean;
}) {
    return (
        <button
            onClick={onImport}
            disabled={isLoading}
            className={cn(TOOLBAR_BUTTON_PRIMARY, "px-3 py-2 sm:px-4")}
        >
            {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
                <Plus className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">Add Books</span>
            <span className="sm:hidden">Add</span>
        </button>
    );
}

// Book Info Modal using Portal
function BookInfoModal({ book, isOpen, onClose }: { book: Book | null; isOpen: boolean; onClose: () => void }) {
    if (!book) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="md" showCloseButton={true}>
            <ModalBody className="p-0">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        {book.coverPath ? (
                            <img
                                src={book.coverPath}
                                alt={book.title}
                                className="w-24 h-36 object-cover shadow-md"
                            />
                        ) : (
                            <div className="w-24 h-36 bg-[var(--color-surface-muted)] flex items-center justify-center">
                                <BookOpen className="w-8 h-8 text-[color:var(--color-text-muted)]" />
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <h2 className="text-lg font-semibold text-[color:var(--color-text-primary)] line-clamp-2">
                                {book.title}
                            </h2>
                            <p className="text-sm text-[color:var(--color-text-secondary)] mt-1">
                                {normalizeAuthor(book.author) || "Unknown Author"}
                            </p>
                            {book.rating && (
                                <div className="flex items-center gap-1 mt-2">
                                    {[...Array(5)].map((_, i) => (
                                        <Star
                                            key={i}
                                            className={cn(
                                                "w-4 h-4",
                                                i < book.rating! ? "text-[color:var(--color-warning)] fill-current" : "text-[color:var(--color-border)]"
                                            )}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="mt-6 space-y-3">
                        {book.description && (
                            <div>
                                <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Description</p>
                                <p className="text-sm text-[color:var(--color-text-secondary)] mt-1 line-clamp-4">
                                    {book.description}
                                </p>
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            {book.publisher && (
                                <div>
                                    <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Publisher</p>
                                    <p className="text-sm text-[color:var(--color-text-secondary)]">{book.publisher}</p>
                                </div>
                            )}
                            {book.publishedDate && (
                                <div>
                                    <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Published</p>
                                    <p className="text-sm text-[color:var(--color-text-secondary)]">{book.publishedDate}</p>
                                </div>
                            )}
                            {book.language && (
                                <div>
                                    <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Language</p>
                                    <p className="text-sm text-[color:var(--color-text-secondary)]">{book.language}</p>
                                </div>
                            )}
                            {book.isbn && (
                                <div>
                                    <p className="text-xs text-[color:var(--color-text-muted)] uppercase">ISBN</p>
                                    <p className="text-sm text-[color:var(--color-text-secondary)]">{book.isbn}</p>
                                </div>
                            )}
                            <div>
                                <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Format</p>
                                <p className="text-sm text-[color:var(--color-text-secondary)] uppercase">{FORMAT_DISPLAY_NAMES[book.format] || book.format}</p>
                            </div>
                            <div>
                                <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Size</p>
                                <p className="text-sm text-[color:var(--color-text-secondary)]">{formatFileSize(book.fileSize)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Added</p>
                                <p className="text-sm text-[color:var(--color-text-secondary)]">{formatRelativeDate(book.addedAt instanceof Date ? book.addedAt : new Date(book.addedAt))}</p>
                            </div>
                            {book.lastReadAt && (
                                <div>
                                    <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Last Read</p>
                                    <p className="text-sm text-[color:var(--color-text-secondary)]">{book.lastReadAt ? formatRelativeDate(book.lastReadAt instanceof Date ? book.lastReadAt : new Date(book.lastReadAt)) : "Never"}</p>
                                </div>
                            )}
                        </div>
                        {book.progress > 0 && (
                            <div>
                                <p className="text-xs text-[color:var(--color-text-muted)] uppercase">Progress</p>
                                <p className="text-sm text-[color:var(--color-text-secondary)]">{formatProgress(book.progress)}</p>
                            </div>
                        )}
                        {book.tags.length > 0 && (
                            <div>
                                <p className="text-xs text-[color:var(--color-text-muted)] uppercase mb-1">Tags</p>
                                <div className="flex flex-wrap gap-1">
                                    {book.tags.map((tag: string) => (
                                        <span
                                            key={tag}
                                            className="px-2 py-0.5 text-xs bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]"
                                        >
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <button
                    onClick={onClose}
                    className="ui-btn-ghost"
                >
                    Close
                </button>
            </ModalFooter>
        </Modal>
    );
}

// Add to Shelf Modal using Portal
function AddToShelfModal({
    isOpen,
    onClose,
    bookId,
    collections,
    onAddToShelf,
    onCreateShelf,
}: {
    isOpen: boolean;
    onClose: () => void;
    bookId: string | null;
    collections: Collection[];
    onAddToShelf: (bookId: string, shelfId: string) => void;
    onCreateShelf: (name: string) => void;
}) {
    const [newShelfName, setNewShelfName] = useState("");

    const handleCreateShelf = () => {
        if (newShelfName.trim()) {
            onCreateShelf(newShelfName.trim());
            setNewShelfName("");
        }
    };

    const renderShelfItem = (shelf: Collection) => (
        <button
            key={shelf.id}
            onClick={() => {
                if (bookId) {
                    onAddToShelf(bookId, shelf.id);
                    onClose();
                }
            }}
            className="w-full flex items-center gap-3 p-3 hover:bg-[var(--color-surface-muted)] transition-colors text-left"
        >
            <FolderOpen className="w-5 h-5 text-[color:var(--color-text-muted)]" />
            <div className="flex-1">
                <p className="text-sm font-medium text-[color:var(--color-text-primary)]">
                    {shelf.name}
                </p>
                <p className="text-xs text-[color:var(--color-text-muted)]">
                    {shelf.bookIds.length} {shelf.bookIds.length === 1 ? "book" : "books"}
                </p>
            </div>
        </button>
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="sm" showCloseButton={true}>
            <ModalBody className="p-0">
                <div className="p-6">
                    <h2 className="text-lg font-semibold text-[color:var(--color-text-primary)] mb-4">
                        Add to Shelf
                    </h2>

                    {collections.length > 0 ? (
                        <div className="space-y-1">
                            {collections.map((shelf) => renderShelfItem(shelf))}
                        </div>
                    ) : (
                        <p className="text-sm text-[color:var(--color-text-muted)] text-center py-4">
                            No shelves yet. Create one below.
                        </p>
                    )}

                    <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                        <p className="text-xs text-[color:var(--color-text-muted)] uppercase mb-2">Create New General Shelf</p>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newShelfName}
                                onChange={(e) => setNewShelfName(e.target.value)}
                                placeholder="Shelf name..."
                                className={cn(
                                    "flex-1 px-3 py-2",
                                    "bg-[var(--color-background)] border border-[var(--color-border)]",
                                    "text-sm text-[color:var(--color-text-primary)]",
                                    "focus:outline-none focus:border-[var(--color-accent)]"
                                )}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleCreateShelf();
                                }}
                            />
                            <button
                                onClick={handleCreateShelf}
                                disabled={!newShelfName.trim()}
                                className="ui-btn-primary"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <button
                    onClick={onClose}
                    className="ui-btn-ghost"
                >
                    Cancel
                </button>
            </ModalFooter>
        </Modal>
    );
}

// Main Library Page
export function LibraryPage() {
    const books = useLibraryStore((state) => state.books);
    const collections = useLibraryStore((state) => state.collections);
    const coversHydrated = useLibraryStore((state) => state.coversHydrated);
    const addBook = useLibraryStore((state) => state.addBook);
    const removeBook = useLibraryStore((state) => state.removeBook);
    const updateBook = useLibraryStore((state) => state.updateBook);
    const setLastScannedAt = useLibraryStore((state) => state.setLastScannedAt);
    const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
    const markBookCompleted = useLibraryStore((state) => state.markBookCompleted);
    const markBookUnread = useLibraryStore((state) => state.markBookUnread);
    const addBookToCollection = useLibraryStore((state) => state.addBookToCollection);
    const addCollection = useLibraryStore((state) => state.addCollection);

    const { setRoute, searchQuery } = useUIStore();
    const { settings, updateSettings } = useSettingsStore();

    const [isImporting, setIsImporting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isExtractingCovers, setIsExtractingCovers] = useState(false);
    const [extractionProgress, setExtractionProgress] = useState({ current: 0, total: 0 });

    // Filter dropdown state
    const [showFilterDropdown, setShowFilterDropdown] = useState(false);
    const filterDropdownRef = useRef<HTMLDivElement>(null);



    // Modal states
    const [infoModalBook, setInfoModalBook] = useState<Book | null>(null);
    const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
    const [addToShelfBookId, setAddToShelfBookId] = useState<string | null>(null);
    const [isAddToShelfModalOpen, setIsAddToShelfModalOpen] = useState(false);

    // Tracks cover extraction jobs currently in progress.
    const extractedBookIdsRef = useRef<Set<string>>(new Set());
    const metadataExtractionAttemptsRef = useRef<Map<string, number>>(new Map());
    const pendingImportMetadataQueueRef = useRef<Book[]>([]);
    const queuedImportMetadataIdsRef = useRef<Set<string>>(new Set());
    const activeImportMetadataTasksRef = useRef(0);

    const performImportedBookMetadataExtraction = useCallback(async (book: Book) => {
        const latestBook = useLibraryStore
            .getState()
            .books
            .find((candidate) => candidate.id === book.id) ?? book;

        if (latestBook.coverExtractionDone && latestBook.coverPath) {
            return;
        }

        try {
            const extractMetadata = await getExtractMetadataFn();
            let data: ArrayBuffer | null = null;
            const isContentUri = latestBook.filePath.startsWith("content://");
            const hasOriginalFilePath = (
                !latestBook.filePath.startsWith('browser://')
                && !latestBook.filePath.startsWith('idb://')
                && !latestBook.filePath.startsWith('sqlite://')
                && !isContentUri
            );

            if (hasOriginalFilePath) {
                data = await getBookData('', latestBook.filePath);
            }

            if (!data) {
                const storagePath = latestBook.storagePath || latestBook.filePath;
                data = await getBookData(latestBook.id, storagePath);
            }

            if (!data) {
                return;
            }

            const filename = ensureFilenameForFormat(
                extractFilenameFromPath(latestBook.filePath),
                latestBook.format,
            );
            const metadata = await extractMetadata(
                data,
                latestBook.format,
                filename,
                latestBook.id,
                {
                    metadataTimeoutMs: IMPORT_METADATA_TIMEOUT_MS,
                    coverTimeoutMs: IMPORT_COVER_TIMEOUT_MS,
                    allowFallbackCover: false,
                },
            );

            const updates: Partial<Book> = {};

            if (metadata.coverDataUrl) {
                updates.coverPath = metadata.coverDataUrl;
            }

            const shouldUpdateTitle = shouldUseExtractedTitle(latestBook, metadata.title);
            if (shouldUpdateTitle) {
                updates.title = normalizeMetadataText(metadata.title);
            }

            const shouldUpdateAuthor = shouldUseExtractedAuthor(latestBook, metadata.author);
            if (shouldUpdateAuthor) {
                updates.author = normalizeMetadataText(metadata.author);
            }

            if (metadata.description && !latestBook.description) {
                updates.description = metadata.description;
            }
            if (metadata.publisher && !latestBook.publisher) {
                updates.publisher = metadata.publisher;
            }
            if (metadata.language && !latestBook.language) {
                updates.language = metadata.language;
            }
            if (metadata.publishedDate && !latestBook.publishedDate) {
                updates.publishedDate = metadata.publishedDate;
            }

            const hasUsefulMetadataUpdate = (
                Boolean(metadata.coverDataUrl)
                || shouldUpdateTitle
                || shouldUpdateAuthor
                || Boolean(metadata.description && !latestBook.description)
                || Boolean(metadata.publisher && !latestBook.publisher)
                || Boolean(metadata.language && !latestBook.language)
                || Boolean(metadata.publishedDate && !latestBook.publishedDate)
            );

            if (Boolean(metadata.coverDataUrl) || (hasUsefulMetadataUpdate && Boolean(latestBook.coverPath))) {
                updates.coverExtractionDone = true;
            }

            if (Object.keys(updates).length > 0) {
                updateBook(latestBook.id, updates);
            }

        } catch (error) {
            console.error("[Library] Fast metadata extraction failed for imported book:", book.id, error);
        }
    }, [updateBook]);

    const pumpImportMetadataQueue = useCallback(() => {
        while (
            activeImportMetadataTasksRef.current < IMPORT_METADATA_QUEUE_CONCURRENCY
            && pendingImportMetadataQueueRef.current.length > 0
        ) {
            const nextBook = pendingImportMetadataQueueRef.current.pop();
            if (!nextBook) {
                break;
            }

            if (extractedBookIdsRef.current.has(nextBook.id)) {
                continue;
            }

            activeImportMetadataTasksRef.current += 1;
            extractedBookIdsRef.current.add(nextBook.id);

            void performImportedBookMetadataExtraction(nextBook)
                .catch((error) => {
                    console.error("[Library] Import metadata queue task failed:", nextBook.id, error);
                })
                .finally(() => {
                    activeImportMetadataTasksRef.current = Math.max(0, activeImportMetadataTasksRef.current - 1);
                    extractedBookIdsRef.current.delete(nextBook.id);
                    queuedImportMetadataIdsRef.current.delete(nextBook.id);
                    if (pendingImportMetadataQueueRef.current.length > 0) {
                        pumpImportMetadataQueue();
                    }
                });
        }
    }, [performImportedBookMetadataExtraction]);

    const extractImportedBookMetadata = useCallback((book: Book) => {
        if (
            book.coverExtractionDone
            || queuedImportMetadataIdsRef.current.has(book.id)
            || extractedBookIdsRef.current.has(book.id)
        ) {
            return;
        }

        queuedImportMetadataIdsRef.current.add(book.id);
        pendingImportMetadataQueueRef.current.push(book);
        pumpImportMetadataQueue();
    }, [pumpImportMetadataQueue]);

    // Selected shelf state (safely initialized from session storage)
    const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null);

    // Favorites filter state
    const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
    const generalCollections = useMemo(
        () => collections.filter((collection) => collection.kind === "general"),
        [collections],
    );

    // Initialize selected shelf from session storage on mount
    useEffect(() => {
        const shelfId = sessionStorage.getItem("theorem-selected-shelf");
        if (shelfId) {
            setSelectedShelfId(shelfId);
        }
    }, []);

    useEffect(() => {
        if (!selectedShelfId) {
            return;
        }
        if (collections.some((collection) => collection.id === selectedShelfId)) {
            return;
        }
        sessionStorage.removeItem("theorem-selected-shelf");
        setSelectedShelfId(null);
    }, [collections, selectedShelfId]);

    const selectedShelf = selectedShelfId ? collections.find(c => c.id === selectedShelfId) : null;
    const selectedShelfBookIds = useMemo(() => {
        if (!selectedShelf) {
            return null;
        }
        return new Set(selectedShelf.bookIds);
    }, [selectedShelf]);

    const sortedBooks = useMemo(() => {
        return getFilteredAndSortedBooks({
            books,
            searchQuery,
            selectedShelfBookIds,
            showFavoritesOnly,
            sortBy: settings.librarySortBy,
            sortOrder: settings.librarySortOrder,
        });
    }, [
        books,
        searchQuery,
        selectedShelfBookIds,
        settings.librarySortBy,
        settings.librarySortOrder,
        showFavoritesOnly,
    ]);

    // Auto-extract covers for books that don't have them
    useEffect(() => {
        if (!coversHydrated || isExtractingCovers || books.length === 0) {
            return;
        }

        const knownBookIds = new Set(books.map((book) => book.id));
        extractedBookIdsRef.current.forEach((bookId) => {
            if (!knownBookIds.has(bookId)) {
                extractedBookIdsRef.current.delete(bookId);
            }
        });
        metadataExtractionAttemptsRef.current.forEach((_attempts, bookId) => {
            if (!knownBookIds.has(bookId)) {
                metadataExtractionAttemptsRef.current.delete(bookId);
            }
        });
        queuedImportMetadataIdsRef.current.forEach((bookId) => {
            if (!knownBookIds.has(bookId)) {
                queuedImportMetadataIdsRef.current.delete(bookId);
            }
        });
        pendingImportMetadataQueueRef.current = pendingImportMetadataQueueRef.current.filter(
            (book) => knownBookIds.has(book.id),
        );

        const booksNeedingMetadata = books
            .filter(
                (book) => {
                    const attempts = metadataExtractionAttemptsRef.current.get(book.id) ?? 0;
                    return attempts < MAX_METADATA_EXTRACTION_ATTEMPTS && (
                        !book.syncedWithoutFile &&
                        (
                            (
                                !book.coverPath
                                && book.coverExtractionDone !== true
                            )
                            || shouldRetryMissingCoverExtraction(book)
                            || hasEncodedContentUriFallbackTitle(book)
                            || (
                                book.filePath.startsWith("content://")
                                && isLikelyGeneratedFallbackCover(book.coverPath)
                            )
                        )
                        && !extractedBookIdsRef.current.has(book.id)
                        && !queuedImportMetadataIdsRef.current.has(book.id)
                    );
                },
            )
            .sort((a, b) => {
                const aAddedAt = new Date(a.addedAt).getTime();
                const bAddedAt = new Date(b.addedAt).getTime();
                return bAddedAt - aAddedAt;
            });

        if (booksNeedingMetadata.length === 0) {
            return;
        }

        let isCancelled = false;

        const extractCovers = async () => {
            setIsExtractingCovers(true);
            const total = booksNeedingMetadata.length;
            setExtractionProgress({ current: 0, total });

            try {
                const extractMetadata = await getExtractMetadataFn();
                let processedCount = 0;
                const batchSize = isMobile() ? 1 : COVER_EXTRACTION_BATCH_SIZE;

                for (let i = 0; i < booksNeedingMetadata.length && !isCancelled; i += batchSize) {
                    const batch = booksNeedingMetadata.slice(i, i + batchSize);

                    await Promise.all(batch.map(async (book) => {
                        if (extractedBookIdsRef.current.has(book.id)) {
                            return;
                        }
                        extractedBookIdsRef.current.add(book.id);

                        try {
                            let data: ArrayBuffer | null = null;
                            const isContentUri = book.filePath.startsWith("content://");
                            const hasOriginalFilePath = (
                                !book.filePath.startsWith('browser://')
                                && !book.filePath.startsWith('idb://')
                                && !book.filePath.startsWith('sqlite://')
                                && !isContentUri
                            );

                            if (hasOriginalFilePath) {
                                data = await getBookData('', book.filePath);
                            }

                            if (!data) {
                                const storagePath = book.storagePath || book.filePath;
                                data = await getBookData(book.id, storagePath);
                            }

                            if (!data) {
                                return;
                            }

                            const nextAttempts = (metadataExtractionAttemptsRef.current.get(book.id) ?? 0) + 1;
                            metadataExtractionAttemptsRef.current.set(book.id, nextAttempts);

                            const filename = ensureFilenameForFormat(
                                extractFilenameFromPath(book.filePath),
                                book.format,
                            );
                            const metadata = await extractMetadata(
                                data,
                                book.format,
                                filename,
                                book.id,
                                {
                                    metadataTimeoutMs: BATCH_METADATA_TIMEOUT_MS,
                                    coverTimeoutMs: BATCH_COVER_TIMEOUT_MS,
                                    allowFallbackCover: false,
                                },
                            );

                            const updates: Partial<Book> = {};
                            if (metadata.coverDataUrl) {
                                updates.coverPath = metadata.coverDataUrl;
                            }

                            const shouldUpdateTitle = shouldUseExtractedTitle(book, metadata.title);
                            const shouldUpdateAuthor = shouldUseExtractedAuthor(book, metadata.author);

                            if (shouldUseExtractedTitle(book, metadata.title)) {
                                updates.title = normalizeMetadataText(metadata.title);
                            }
                            if (shouldUseExtractedAuthor(book, metadata.author)) {
                                updates.author = normalizeMetadataText(metadata.author);
                            }

                            if (metadata.description && !book.description) {
                                updates.description = metadata.description;
                            }
                            if (metadata.publisher && !book.publisher) {
                                updates.publisher = metadata.publisher;
                            }
                            if (metadata.language && !book.language) {
                                updates.language = metadata.language;
                            }
                            if (metadata.publishedDate && !book.publishedDate) {
                                updates.publishedDate = metadata.publishedDate;
                            }

                            const hasUsefulMetadataUpdate = (
                                Boolean(metadata.coverDataUrl)
                                || shouldUpdateTitle
                                || shouldUpdateAuthor
                                || Boolean(metadata.description && !book.description)
                                || Boolean(metadata.publisher && !book.publisher)
                                || Boolean(metadata.language && !book.language)
                                || Boolean(metadata.publishedDate && !book.publishedDate)
                            );
                            if (Boolean(metadata.coverDataUrl) || (hasUsefulMetadataUpdate && Boolean(book.coverPath))) {
                                updates.coverExtractionDone = true;
                            }

                            if (!isCancelled && Object.keys(updates).length > 0) {
                                updateBook(book.id, updates);
                            }
                            if (metadata.coverDataUrl) {
                                metadataExtractionAttemptsRef.current.delete(book.id);
                            }
                        } catch (error) {
                            console.error('[Library] Failed to extract cover for book:', book.id, error);
                        } finally {
                            extractedBookIdsRef.current.delete(book.id);
                        }
                    }));

                    processedCount += batch.length;
                    if (!isCancelled) {
                        setExtractionProgress({
                            current: Math.min(processedCount, total),
                            total,
                        });
                    }

                    // Yield to keep UI responsive while processing large libraries.
                    if (!isCancelled) {
                        await new Promise((resolve) => setTimeout(resolve, 0));
                    }
                }
            } finally {
                if (!isCancelled) {
                    setIsExtractingCovers(false);
                }
            }
        };

        const timeoutId = setTimeout(() => {
            void extractCovers();
        }, 300);

        return () => {
            isCancelled = true;
            clearTimeout(timeoutId);
        };
    }, [books, coversHydrated, isExtractingCovers, updateBook]);

    // Close filter dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
                setShowFilterDropdown(false);
            }
        };

        if (showFilterDropdown) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [showFilterDropdown]);



    // Handle importing books (works in both Tauri and browser)
    const handleAddBooks = useCallback(async () => {
        setIsImporting(true);
        try {
            await pickAndImportBooksIncremental((book) => {
                addBook(book);
                void extractImportedBookMetadata(book);
            });
        } catch (err) {
            console.error('Import error:', err);
        } finally {
            setIsImporting(false);
        }
    }, [addBook, extractImportedBookMetadata]);

    const importDiscoveredBooks = useCallback(async (bookPaths: string[]) => {
        if (bookPaths.length === 0) {
            alert("No supported books were found in the selected folder.");
            return;
        }

        await importBooksIncremental(bookPaths, (book) => {
            addBook(book);
            void extractImportedBookMetadata(book);
        });
        setLastScannedAt(new Date());
    }, [addBook, extractImportedBookMetadata, setLastScannedAt]);

    const scanAndImportFolder = useCallback(async (folderPath: string) => {
        const normalizedFolderPath = normalizeFilePath(folderPath);
        if (!normalizedFolderPath) {
            return;
        }

        const bookPaths = await scanFolderForBooks(normalizedFolderPath);
        await importDiscoveredBooks(bookPaths);
    }, [importDiscoveredBooks]);

    // Handle scanning folder (Tauri only)
    const handleScanFolder = useCallback(async () => {
        if (!isTauri()) {
            alert('Folder scanning requires the desktop app.');
            return;
        }

        try {
            if (isMobile()) {
                setIsScanning(true);

                let selectedFolder = settings.scanFolders[0] || "";
                if (!selectedFolder) {
                    const pickedFolder = await pickLibraryFolderMobile();
                    if (!pickedFolder) {
                        return;
                    }
                    selectedFolder = pickedFolder;
                    updateSettings({ scanFolders: [selectedFolder] });
                }

                const bookUris = await scanLibraryFolderMobile(selectedFolder);
                await importDiscoveredBooks(bookUris);
                return;
            }

            const defaultDesktopFolder = settings.scanFolders[0]?.startsWith("content://")
                ? undefined
                : settings.scanFolders[0] || undefined;
            const selectedFolder = await showOpenDirectoryDialog({
                title: "Scan Library Folder",
                defaultPath: defaultDesktopFolder,
            });
            if (!selectedFolder) {
                return;
            }

            const normalizedFolderPath = normalizeFilePath(selectedFolder);
            if (!normalizedFolderPath) {
                return;
            }

            updateSettings({ scanFolders: [normalizedFolderPath] });

            setIsScanning(true);
            await scanAndImportFolder(normalizedFolderPath);
        } catch (err) {
            console.error('Scan error:', err);
            alert(err instanceof Error ? err.message : 'Failed to scan selected folder.');
        } finally {
            setIsScanning(false);
        }
    }, [
        importDiscoveredBooks,
        scanAndImportFolder,
        settings.scanFolders,
        updateSettings,
    ]);

    // Book actions
    const handleOpenBook = useCallback((book: Book) => {
        if (book.syncedWithoutFile) {
            window.alert(
                "This book was synced from another device but the file hasn't been transferred yet. " +
                "Please sync again with the source device to download the book file."
            );
            return;
        }
        setRoute("reader", book.id);
    }, [setRoute]);

    const handleToggleFavorite = useCallback((bookId: string) => {
        toggleFavorite(bookId);
    }, [toggleFavorite]);

    const handleDeleteBook = useCallback(async (bookId: string) => {
        const book = books.find(b => b.id === bookId);
        const confirmed = await confirmDeleteBook(book?.title || "this book");
        if (confirmed) {
            removeBook(bookId);
        }
    }, [removeBook, books]);

    const handleShowInfo = useCallback((book: Book) => {
        setInfoModalBook(book);
        setIsInfoModalOpen(true);
    }, []);

    const handleAddToShelf = useCallback((bookId: string) => {
        setAddToShelfBookId(bookId);
        setIsAddToShelfModalOpen(true);
    }, []);

    const handleMarkAsRead = useCallback((bookId: string) => {
        markBookCompleted(bookId, "manual");
    }, [markBookCompleted]);

    const handleMarkAsUnread = useCallback((bookId: string) => {
        markBookUnread(bookId);
    }, [markBookUnread]);

    const handleAddBookToShelf = useCallback((bookId: string, shelfId: string) => {
        addBookToCollection(bookId, shelfId);
    }, [addBookToCollection]);

    const handleCreateShelf = useCallback((name: string) => {
        const newShelf: Collection = {
            id: crypto.randomUUID(),
            name,
            bookIds: addToShelfBookId ? [addToShelfBookId] : [],
            kind: "general",
            createdAt: new Date(),
        };
        addCollection(newShelf);
        setIsAddToShelfModalOpen(false);
        setAddToShelfBookId(null);
    }, [addCollection, addToShelfBookId]);

    // Toggle view mode
    const toggleViewMode = () => {
        const modes: LibraryViewMode[] = ["grid", "list", "compact"];
        const currentIndex = modes.indexOf(settings.libraryViewMode);
        const nextMode = modes[(currentIndex + 1) % modes.length];
        updateSettings({ libraryViewMode: nextMode });
    };

    if (books.length === 0) {
        return (
            <EmptyLibrary
                onAddBooks={handleAddBooks}
                onScanFolder={isTauri() ? handleScanFolder : undefined}
                isImporting={isImporting}
                isScanning={isScanning}
            />
        );
    }

    return (
        <div className="mx-auto min-h-full w-full max-w-[var(--layout-content-max-width)] px-4 py-6 pb-[calc(var(--spacing-2xl)+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8 animate-fade-in">
            {/* Header */}
            <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <h1 className="m-0 break-words font-sans text-[1.45rem] font-semibold uppercase tracking-[0.12em] leading-[1.1] text-[color:var(--color-text-primary)] sm:text-[1.6rem]">
                        {selectedShelf ? selectedShelf.name : showFavoritesOnly ? "Favorites" : "Library"}
                    </h1>
                    <p className="mt-1 text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
                        {sortedBooks.length} {sortedBooks.length === 1 ? 'book' : 'books'}
                        {(selectedShelf || showFavoritesOnly) && (
                            <button
                                onClick={() => {
                                    sessionStorage.removeItem("theorem-selected-shelf");
                                    setSelectedShelfId(null);
                                    setShowFavoritesOnly(false);
                                }}
                                className="ml-2 text-[color:var(--color-accent)] hover:underline"
                            >
                                Clear filter
                            </button>
                        )}
                    </p>
                </div>

                <div className="flex items-center gap-2 sm:gap-4 ml-auto">
                    {/* Import and View Mode grouped left */}
                    <ImportButton onImport={handleAddBooks} isLoading={isImporting} />

                    <button
                        onClick={toggleViewMode}
                        className={cn(TOOLBAR_BUTTON_BASE, TOOLBAR_ICON_BUTTON, "border-2")}
                        title={`View: ${settings.libraryViewMode}`}
                    >
                        {viewModeIcons[settings.libraryViewMode]}
                    </button>

                    <div className="h-6 w-px bg-[var(--color-border)]" />

                    {/* Folder opening then Filter */}
                    {isTauri() && (
                        <button
                            onClick={handleScanFolder}
                            disabled={isScanning}
                            className={cn(TOOLBAR_BUTTON_BASE, "px-3 py-2 sm:px-4 border-2")}
                            title="Scan Folder"
                        >
                            {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
                            <span className="hidden sm:inline font-bold text-xs uppercase">Scan</span>
                        </button>
                    )}

                    <button
                        onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                        className={cn(
                            "ui-btn h-10 px-3 sm:px-5 transition-all duration-200 border-2",
                            showFilterDropdown
                                ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]"
                                : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-text-primary)]"
                        )}
                    >
                        <Filter className="w-4 h-4" />
                        <span className="hidden sm:inline font-black tracking-tight uppercase text-xs">Filter</span>
                        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform duration-300", showFilterDropdown && "rotate-180")} />
                    </button>
                </div>
            </div>

            <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-start mt-8">
                <div className="flex-1 w-full">
                    {/* Mobile Only: Inline Filter Drawer */}
                    <div className={cn(
                        "md:hidden overflow-hidden transition-all duration-300",
                        showFilterDropdown ? "max-h-[800px] mb-8 opacity-100" : "max-h-0 opacity-0 mb-0"
                    )}>
                        <div className="w-full border-t-2 border-b-2 border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                            <div className="grid grid-cols-1 divide-y divide-[var(--color-border)]">
                                {/* Sort Field */}
                                <div className="p-4">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[color:var(--color-text-muted)] mb-3">Sort By</h3>
                                    <div className="grid grid-cols-2 gap-1">
                                        {[
                                            { id: "title", label: "Title" },
                                            { id: "author", label: "Author" },
                                            { id: "dateAdded", label: "Added" },
                                            { id: "lastRead", label: "Read" },
                                        ].map((option) => (
                                            <button
                                                key={option.id}
                                                onClick={() => updateSettings({ librarySortBy: option.id as LibrarySortBy })}
                                                className={cn(
                                                    "flex items-center justify-between px-3 py-2 text-xs font-bold transition-all border",
                                                    settings.librarySortBy === option.id
                                                        ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]"
                                                        : "text-[color:var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]"
                                                )}
                                            >
                                                {option.label}
                                                {settings.librarySortBy === option.id && <Check className="w-3 h-3" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Order & Filters Group */}
                                <div className="grid grid-cols-2 divide-x divide-[var(--color-border)]">
                                    <div className="p-4">
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[color:var(--color-text-muted)] mb-3">Order</h3>
                                        <div className="flex flex-col gap-1">
                                            {["asc", "desc"].map((id) => (
                                                <button
                                                    key={id}
                                                    onClick={() => updateSettings({ librarySortOrder: id as LibrarySortOrder })}
                                                    className={cn(
                                                        "px-3 py-2 text-[10px] font-bold border transition-all",
                                                        settings.librarySortOrder === id ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]" : "text-[color:var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)]"
                                                    )}
                                                >
                                                    {id === "asc" ? "ASC" : "DESC"}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[color:var(--color-text-muted)] mb-3">Quick</h3>
                                        <div className="flex flex-col gap-1">
                                            <button
                                                onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
                                                className={cn(
                                                    "px-3 py-2 text-[10px] font-bold border transition-all",
                                                    showFavoritesOnly ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]" : "text-[color:var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)]"
                                                )}
                                            >
                                                FAVS
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Books Grid/List/Compact */}
                    <section>
                        {sortedBooks.length === 0 ? (
                            <div className="text-center py-16 border-2 border-dashed border-[var(--color-border)]">
                                <p className="text-[color:var(--color-text-muted)] font-bold uppercase text-xs tracking-widest">
                                    No documents match criteria
                                </p>
                                {searchQuery && (
                                    <button
                                        onClick={() => useUIStore.getState().setSearchQuery("")}
                                        className="mt-4 text-[10px] font-black uppercase text-[color:var(--color-accent)] hover:underline tracking-tighter"
                                    >
                                        [ RESET SEARCH ]
                                    </button>
                                )}
                            </div>
                        ) : settings.libraryViewMode === "list" ? (
                            <div className="space-y-1">
                                {sortedBooks.map((book) => (
                                    <BookCard
                                        key={book.id}
                                        book={book}
                                        viewMode={settings.libraryViewMode}
                                        onOpenBook={handleOpenBook}
                                        onToggleFavorite={handleToggleFavorite}
                                        onDeleteBook={handleDeleteBook}
                                        onShowInfo={handleShowInfo}
                                        onAddToShelf={handleAddToShelf}
                                        onMarkAsRead={handleMarkAsRead}
                                        onMarkAsUnread={handleMarkAsUnread}
                                    />
                                ))}
                            </div>
                        ) : settings.libraryViewMode === "compact" ? (
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                                {sortedBooks.map((book) => (
                                    <BookCard
                                        key={book.id}
                                        book={book}
                                        viewMode={settings.libraryViewMode}
                                        onOpenBook={handleOpenBook}
                                        onToggleFavorite={handleToggleFavorite}
                                        onDeleteBook={handleDeleteBook}
                                        onShowInfo={handleShowInfo}
                                        onAddToShelf={handleAddToShelf}
                                        onMarkAsRead={handleMarkAsRead}
                                        onMarkAsUnread={handleMarkAsUnread}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">
                                {sortedBooks.map((book) => (
                                    <BookCard
                                        key={book.id}
                                        book={book}
                                        viewMode={settings.libraryViewMode}
                                        onOpenBook={handleOpenBook}
                                        onToggleFavorite={handleToggleFavorite}
                                        onDeleteBook={handleDeleteBook}
                                        onShowInfo={handleShowInfo}
                                        onAddToShelf={handleAddToShelf}
                                        onMarkAsRead={handleMarkAsRead}
                                        onMarkAsUnread={handleMarkAsUnread}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                </div>

                {/* Desktop: Sticky Swiss Sidebar */}
                {showFilterDropdown && (
                    <aside className="hidden md:block w-72 shrink-0 sticky top-24 border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] animate-in slide-in-from-right-4 duration-300">
                        <div className="divide-y-2 divide-[var(--color-border)]">
                            {/* Sort */}
                            <div className="p-5">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[color:var(--color-text-muted)] mb-4">Sort Criteria</h3>
                                <div className="flex flex-col gap-1">
                                    {[
                                        { id: "title", label: "Title" },
                                        { id: "author", label: "Author" },
                                        { id: "dateAdded", label: "Date Added" },
                                        { id: "lastRead", label: "Last Read" },
                                    ].map((option) => (
                                        <button
                                            key={option.id}
                                            onClick={() => updateSettings({ librarySortBy: option.id as LibrarySortBy })}
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2.5 text-xs font-bold border-2 transition-all",
                                                settings.librarySortBy === option.id
                                                    ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]"
                                                    : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)]"
                                            )}
                                        >
                                            {option.label.toUpperCase()}
                                            {settings.librarySortBy === option.id && <Check className="w-3.5 h-3.5" />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Order */}
                            <div className="p-5">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[color:var(--color-text-muted)] mb-4">Direction</h3>
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: "asc", label: "ASC" },
                                        { id: "desc", label: "DESC" },
                                    ].map((option) => (
                                        <button
                                            key={option.id}
                                            onClick={() => updateSettings({ librarySortOrder: option.id as LibrarySortOrder })}
                                            className={cn(
                                                "py-2 text-[10px] font-black border-2 transition-all",
                                                settings.librarySortOrder === option.id
                                                    ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]"
                                                    : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)]"
                                            )}
                                        >
                                            {option.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Quick Filters */}
                            <div className="p-5">
                                <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[color:var(--color-text-muted)] mb-4">Quick</h3>
                                <button
                                    onClick={() => setShowFavoritesOnly((previous) => !previous)}
                                    className={cn(
                                        "w-full py-2 text-[10px] font-black border-2 transition-all",
                                        showFavoritesOnly
                                            ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]"
                                            : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)]"
                                    )}
                                >
                                    FAVORITES
                                </button>
                            </div>

                            {/* Shelf Filter */}
                            <div className="p-5">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-[color:var(--color-text-muted)]">Collections</h3>
                                    <button onClick={() => setRoute("shelves")} className="text-[10px] font-bold text-[color:var(--color-accent)] hover:underline">EDIT</button>
                                </div>
                                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                                    <button
                                        onClick={() => setSelectedShelfId(null)}
                                        className={cn(
                                            "flex items-center gap-3 px-4 py-2.5 text-xs font-bold border-2 transition-all",
                                            !selectedShelfId ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]" : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)]"
                                        )}
                                    >
                                        <LayoutGrid className="w-3.5 h-3.5" />
                                        ALL DOCUMENTS
                                    </button>
                                    {collections.map((shelf) => (
                                        <button
                                            key={shelf.id}
                                            onClick={() => setSelectedShelfId(shelf.id)}
                                            className={cn(
                                                "flex items-center justify-between px-4 py-2.5 text-xs font-bold border-2 transition-all",
                                                selectedShelfId === shelf.id ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)]" : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] border-transparent hover:border-[var(--color-border)]"
                                            )}
                                        >
                                            <span className="truncate">{shelf.name.toUpperCase()}</span>
                                            {selectedShelfId === shelf.id && <Check className="w-3.5 h-3.5" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </aside>
                )}
            </div>

            {/* Book Info Modal */}
            <BookInfoModal
                book={infoModalBook}
                isOpen={isInfoModalOpen}
                onClose={() => {
                    setIsInfoModalOpen(false);
                    setInfoModalBook(null);
                }}
            />

            {/* Add to Shelf Modal */}
            <AddToShelfModal
                isOpen={isAddToShelfModalOpen}
                onClose={() => {
                    setIsAddToShelfModalOpen(false);
                    setAddToShelfBookId(null);
                }}
                bookId={addToShelfBookId}
                collections={collections}
                onAddToShelf={handleAddBookToShelf}
                onCreateShelf={handleCreateShelf}
            />
        </div>
    );
}
