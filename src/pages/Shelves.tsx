/**
 * Shelves Page
 * Organize books into collections/shelves
 */

import { useState, useMemo } from "react";
import { cn, normalizeAuthor } from "@/lib/utils";
import { useLibraryStore, useUIStore, useSettingsStore } from "@/store";
import { ShelfModal } from "@/components/modals";
import { getShelfColor, getShelfInitials } from "@/lib/shelf-colors";
import {
    FolderOpen,
    Plus,
    MoreVertical,
    Edit3,
    Trash2,
    BookOpen,
    X,
    Grid3X3,
    List,
    ArrowLeft,
    LayoutGrid,
} from "lucide-react";
import type { Book, Collection, LibraryViewMode } from "@/types";
import { confirmDeleteBook, confirmRemoveFromShelf } from "@/lib/dialogs";

// View mode icons
const viewModeIcons: Record<LibraryViewMode, React.ReactNode> = {
    grid: <LayoutGrid className="w-4 h-4" />,
    list: <List className="w-4 h-4" />,
    compact: <Grid3X3 className="w-4 h-4" />,
};

// Empty state component
function EmptyShelves({ onCreate }: { onCreate: () => void }) {
    return (
        <div className="ui-empty-state-stack px-4 sm:px-6 flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-surface-muted)] flex items-center justify-center mb-6">
                <FolderOpen className="w-6 h-6 text-[color:var(--color-text-secondary)]" />
            </div>
            <h2 className="ui-empty-state-title text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                No Shelves Yet
            </h2>
            <p className="ui-empty-state-copy text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
                Create shelves to organize your books your way.
            </p>
            <button
                onClick={onCreate}
                className={cn(
                    "ui-empty-state-action flex items-center gap-2 px-6 py-2.5 rounded-full",
                    "bg-[var(--color-accent)] ui-text-accent-contrast text-sm font-medium",
                    "hover:opacity-90 transition-opacity"
                )}
            >
                <Plus className="w-4 h-4" />
                <span>Create Shelf</span>
            </button>
        </div>
    );
}

// Empty shelf detail state
function EmptyShelfDetail({ shelfName, onAddBooks }: { shelfName: string; onAddBooks: () => void }) {
    return (
        <div className="ui-empty-state-stack px-4 sm:px-6 flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-surface-muted)] flex items-center justify-center mb-6">
                <BookOpen className="w-6 h-6 text-[color:var(--color-text-secondary)]" />
            </div>
            <h2 className="ui-empty-state-title text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                "{shelfName}" is Empty
            </h2>
            <p className="ui-empty-state-copy text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
                Add books from your library to this shelf.
            </p>
            <button
                onClick={onAddBooks}
                className={cn(
                    "ui-empty-state-action flex items-center gap-2 px-6 py-2.5 rounded-full",
                    "bg-[var(--color-accent)] ui-text-accent-contrast text-sm font-medium",
                    "hover:opacity-90 transition-opacity"
                )}
            >
                <BookOpen className="w-4 h-4" />
                <span>Go to Library</span>
            </button>
        </div>
    );
}

// Book Card Component (reused from Library)
function BookCard({
    book,
    viewMode,
    onOpenBook,
    onRemoveFromShelf,
}: {
    book: Book;
    viewMode: LibraryViewMode;
    onOpenBook: (book: Book) => void;
    onRemoveFromShelf: (bookId: string) => void | Promise<void>;
}) {
    // Grid view
    if (viewMode === "grid") {
        return (
            <div className="group relative">
                <button
                    onClick={() => onOpenBook(book)}
                    className="block w-full text-left"
                >
                    <div className="relative aspect-[2/3] bg-[var(--color-surface-muted)] mb-3 overflow-hidden rounded-lg border border-[var(--color-border)] transition-all duration-200 group-hover:shadow-lg">
                        {book.coverPath ? (
                            <img
                                src={book.coverPath}
                                alt={book.title}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="book-cover-placeholder w-full h-full text-xs p-2 flex items-center justify-center">
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
                    </div>
                    <h3 className="font-medium text-sm text-[color:var(--color-text-primary)] line-clamp-1 mb-0.5">
                        {book.title}
                    </h3>
                    <p className="text-xs text-[color:var(--color-text-secondary)] line-clamp-1">
                        {normalizeAuthor(book.author) || "Unknown Author"}
                    </p>
                </button>
                {/* Remove button */}
                <button
                    onClick={async (e) => {
                        e.stopPropagation();
                        await onRemoveFromShelf(book.id);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-[var(--color-overlay-strong)] text-[color:var(--color-text-inverse)] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--color-overlay-strong-hover)]"
                    title="Remove from shelf"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        );
    }

    // List view
    if (viewMode === "list") {
        return (
            <div className="group flex items-center gap-4 p-3 ui-surface hover:border-[var(--color-text-muted)] transition-colors">
                <button
                    onClick={() => onOpenBook(book)}
                    className="flex-shrink-0"
                >
                    {book.coverPath ? (
                        <img
                            src={book.coverPath}
                            alt={book.title}
                            className="w-12 h-16 object-cover rounded shadow-sm"
                            loading="lazy"
                        />
                    ) : (
                        <div className="w-12 h-16 bg-[var(--color-surface-muted)] rounded flex items-center justify-center">
                            <BookOpen className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                        </div>
                    )}
                </button>
                <div className="flex-1 min-w-0">
                    <button onClick={() => onOpenBook(book)} className="text-left w-full">
                        <h3 className="font-medium text-sm text-[color:var(--color-text-primary)] truncate hover:text-[color:var(--color-accent)] transition-colors">
                            {book.title}
                        </h3>
                    </button>
                    <p className="text-xs text-[color:var(--color-text-secondary)] truncate">
                        {normalizeAuthor(book.author) || "Unknown Author"}
                    </p>
                </div>
                <button
                    onClick={async (e) => {
                        e.stopPropagation();
                        await onRemoveFromShelf(book.id);
                    }}
                    className="p-2 rounded-md text-[color:var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-error)] opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove from shelf"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        );
    }

    // Compact view
    return (
        <div className="group relative">
            <button
                onClick={() => onOpenBook(book)}
                className="block w-full relative aspect-[2/3] bg-[var(--color-surface-muted)] overflow-hidden rounded-lg border border-[var(--color-border)] hover:shadow-lg transition-all duration-200"
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
            </button>
            {/* Remove button */}
            <button
                onClick={async (e) => {
                    e.stopPropagation();
                    await onRemoveFromShelf(book.id);
                }}
                className="absolute top-1 right-1 p-1 rounded-md bg-[var(--color-overlay-strong)] text-[color:var(--color-text-inverse)] opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--color-overlay-strong-hover)]"
                title="Remove from shelf"
            >
                <X className="w-3 h-3" />
            </button>
        </div>
    );
}

// Shelf card component
interface ShelfCardProps {
    shelf: Collection;
    books: Book[];
    actualBookCount: number;
    onClick: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

function ShelfCard({ shelf, books, actualBookCount, onClick, onEdit, onDelete }: ShelfCardProps) {
    const [showMenu, setShowMenu] = useState(false);
    const displayBooks = books.slice(0, 4);

    return (
        <div className="group relative ui-card hover:border-[var(--color-text-muted)] transition-colors">
            {/* Cover Grid Preview */}
            <button onClick={onClick} className="block w-full">
                <div className="aspect-[16/10] bg-[var(--color-surface-muted)] p-4">
                    {displayBooks.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2 h-full">
                            {displayBooks.map((book, i) => (
                                <div
                                    key={book.id}
                                    className="relative overflow-hidden rounded shadow-sm"
                                    style={{
                                        transform: `translateY(${i % 2 === 1 ? "8px" : "0"})`,
                                    }}
                                >
                                    {book.coverPath ? (
                                        <img
                                            src={book.coverPath}
                                            alt={book.title}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full bg-[var(--color-surface)] flex items-center justify-center">
                                            <BookOpen className="w-6 h-6 text-[color:var(--color-text-muted)]" />
                                        </div>
                                    )}
                                </div>
                            ))}
                            {/* Fill empty slots */}
                            {Array.from({ length: Math.max(0, 4 - displayBooks.length) }).map((_, i) => (
                                <div
                                    key={`empty-${i}`}
                                    className="bg-[var(--color-surface)]/50 rounded border border-dashed border-[var(--color-border)]"
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full">
                            <FolderOpen className="w-12 h-12 text-[color:var(--color-text-muted)] mb-2" />
                            <span className="text-sm text-[color:var(--color-text-secondary)]">Empty Shelf</span>
                        </div>
                    )}
                </div>
            </button>

            {/* Info */}
            <div className="p-4">
                <div className="flex items-center gap-3">
                    {/* Colored Shelf Avatar */}
                    <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold flex-shrink-0 shadow-sm"
                        style={{
                            backgroundColor: getShelfColor(shelf.id, shelf.name).bg,
                            color: getShelfColor(shelf.id, shelf.name).text,
                        }}
                    >
                        {getShelfInitials(shelf.name)}
                    </div>
                    
                    <div className="flex-1 min-w-0 overflow-hidden">
                        <button onClick={onClick} className="text-left w-full">
                            <h3 className="font-semibold text-[color:var(--color-text-primary)] truncate group-hover:text-[color:var(--color-accent)] transition-colors">
                                {shelf.name}
                            </h3>
                        </button>
                        <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
                            {actualBookCount} {actualBookCount === 1 ? "book" : "books"}
                        </p>
                    </div>

                    {/* Menu - Always visible on mobile, hover on desktop */}
                    <div className="relative flex-shrink-0">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMenu(!showMenu);
                            }}
                            className="p-1.5 rounded-md text-[color:var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
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
                                            onEdit();
                                            setShowMenu(false);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
                                    >
                                        <Edit3 className="w-4 h-4" />
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => {
                                            onDelete();
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
            </div>
        </div>
    );
}

// Shelf Detail View
interface ShelfDetailProps {
    shelf: Collection;
    onBack: () => void;
}

function ShelfDetail({ shelf, onBack }: ShelfDetailProps) {
    const { books, removeBookFromCollection, removeBook } = useLibraryStore();
    const { setRoute } = useUIStore();
    const { settings, updateSettings } = useSettingsStore();
    const [viewMode, setViewMode] = useState<LibraryViewMode>("grid");

    // Get actual books that exist in the library
    const shelfBooks = useMemo(() => {
        return shelf.bookIds
            .map((id) => books.find((b) => b.id === id))
            .filter((book): book is Book => book !== undefined);
    }, [shelf.bookIds, books]);

    const handleRemoveBook = async (bookId: string) => {
        const book = books.find(b => b.id === bookId);
        const confirmed = await confirmRemoveFromShelf(book?.title || "this book", shelf.name);
        if (confirmed) {
            removeBookFromCollection(bookId, shelf.id);
        }
    };

    const handleDeleteBook = async (bookId: string) => {
        const book = books.find(b => b.id === bookId);
        const confirmed = await confirmDeleteBook(book?.title || "this book");
        if (confirmed) {
            removeBook(bookId);
        }
    };

    const handleOpenBook = (book: Book) => {
        setRoute("reader", book.id);
    };

    const handleGoToLibrary = () => {
        // Store the shelf ID in session storage so Library page can filter by it
        sessionStorage.setItem("theorem-selected-shelf", shelf.id);
        setRoute("library");
    };

    // Cycle through view modes
    const cycleViewMode = () => {
        const modes: LibraryViewMode[] = ["grid", "list", "compact"];
        const currentIndex = modes.indexOf(viewMode);
        const nextMode = modes[(currentIndex + 1) % modes.length];
        setViewMode(nextMode);
    };

    if (shelfBooks.length === 0) {
        return <EmptyShelfDetail shelfName={shelf.name} onAddBooks={handleGoToLibrary} />;
    }

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-lg text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    {/* Colored Shelf Avatar */}
                    <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-semibold flex-shrink-0 shadow-sm"
                        style={{
                            backgroundColor: getShelfColor(shelf.id, shelf.name).bg,
                            color: getShelfColor(shelf.id, shelf.name).text,
                        }}
                    >
                        {getShelfInitials(shelf.name)}
                    </div>
                    <div>
                        <h1 className="ui-page-title">
                            {shelf.name}
                        </h1>
                        <p className="text-sm text-[color:var(--color-text-muted)] mt-0.5">
                            {shelfBooks.length} {shelfBooks.length === 1 ? "book" : "books"}
                        </p>
                    </div>
                </div>

                {/* View Toggle */}
                <button
                    onClick={cycleViewMode}
                    className={cn(
                        "flex items-center justify-center w-10 h-10 rounded-lg",
                        "border border-[var(--color-border)] bg-[var(--color-surface)]",
                        "text-[color:var(--color-text-secondary)]",
                        "hover:bg-[var(--color-surface-muted)] transition-colors"
                    )}
                    title={`View: ${viewMode}`}
                >
                    {viewModeIcons[viewMode]}
                </button>
            </div>

            {/* Books Display */}
            {viewMode === "grid" && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10">
                    {shelfBooks.map((book) => (
                        <BookCard
                            key={book.id}
                            book={book}
                            viewMode={viewMode}
                            onOpenBook={handleOpenBook}
                            onRemoveFromShelf={handleRemoveBook}
                        />
                    ))}
                </div>
            )}
            {viewMode === "list" && (
                <div className="space-y-2">
                    {shelfBooks.map((book) => (
                        <BookCard
                            key={book.id}
                            book={book}
                            viewMode={viewMode}
                            onOpenBook={handleOpenBook}
                            onRemoveFromShelf={handleRemoveBook}
                        />
                    ))}
                </div>
            )}
            {viewMode === "compact" && (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                    {shelfBooks.map((book) => (
                        <BookCard
                            key={book.id}
                            book={book}
                            viewMode={viewMode}
                            onOpenBook={handleOpenBook}
                            onRemoveFromShelf={handleRemoveBook}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// Main page component
export function ShelvesPage() {
    const { 
        collections, 
        books, 
        addCollection, 
        removeCollection, 
        updateCollection,
        removeBook 
    } = useLibraryStore();
    const { setRoute, searchQuery } = useUIStore();
    const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingShelf, setEditingShelf] = useState<{ id: string; name: string; description?: string } | undefined>();

    // Filter shelves by search query
    const filteredShelves = useMemo(() => {
        if (!searchQuery.trim()) return collections;
        const q = searchQuery.toLowerCase();
        return collections.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.description?.toLowerCase().includes(q)
        );
    }, [collections, searchQuery]);

    // Helper to get actual books count (excluding deleted books)
    const getActualBookCount = (bookIds: string[]) => {
        return bookIds.filter((id) => books.some((b) => b.id === id)).length;
    };

    // Helper to get actual books for display
    const getShelfBooks = (bookIds: string[]): Book[] => {
        return bookIds
            .map((id) => books.find((b) => b.id === id))
            .filter((book): book is Book => book !== undefined);
    };

    const handleCreateShelf = () => {
        setEditingShelf(undefined);
        setIsModalOpen(true);
    };

    const handleEditShelf = (shelf: { id: string; name: string; description?: string }) => {
        setEditingShelf(shelf);
        setIsModalOpen(true);
    };

    const handleSaveShelf = (name: string, description: string) => {
        if (editingShelf) {
            updateCollection(editingShelf.id, { name, description });
        } else {
            addCollection({
                id: crypto.randomUUID(),
                name,
                description,
                bookIds: [],
                createdAt: new Date(),
                isSmartCollection: false,
            });
        }
        setIsModalOpen(false);
    };

    const handleDeleteShelf = (shelfId: string, shelfName: string) => {
        if (confirm(`Are you sure you want to delete "${shelfName}"?`)) {
            removeCollection(shelfId);
        }
    };

    // Show shelf detail view
    if (selectedShelfId) {
        const shelf = collections.find((s) => s.id === selectedShelfId);
        if (shelf) {
            return (
                <div className="ui-page">
                    <ShelfDetail shelf={shelf} onBack={() => setSelectedShelfId(null)} />
                </div>
            );
        }
    }

    // Show shelves list
    if (collections.length === 0) {
        return (
            <div className="ui-page">
                <EmptyShelves onCreate={handleCreateShelf} />
                <ShelfModal
                    isOpen={isModalOpen}
                    shelf={editingShelf}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSaveShelf}
                />
            </div>
        );
    }

    return (
        <div className="ui-page animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-10">
                <div>
                    <h1 className="ui-page-title">
                        Shelves
                    </h1>
                    <p className="ui-page-subtitle">
                        {collections.length} {collections.length === 1 ? "shelf" : "shelves"} •{" "}
                        {collections.reduce((acc, s) => acc + getActualBookCount(s.bookIds), 0)} books
                    </p>
                </div>

                <button
                    onClick={handleCreateShelf}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2.5 rounded-lg",
                        "bg-[var(--color-accent)] ui-text-accent-contrast text-sm font-medium",
                        "hover:opacity-90 transition-opacity"
                    )}
                >
                    <Plus className="w-4 h-4" />
                    <span>New Shelf</span>
                </button>
            </div>

            {/* Shelves Grid */}
            {filteredShelves.length === 0 ? (
                <div className="text-center py-16">
                    <p className="text-[color:var(--color-text-muted)]">
                        No shelves found matching your search.
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {filteredShelves.map((shelf) => (
                        <ShelfCard
                            key={shelf.id}
                            shelf={shelf}
                            books={getShelfBooks(shelf.bookIds)}
                            actualBookCount={getActualBookCount(shelf.bookIds)}
                            onClick={() => setSelectedShelfId(shelf.id)}
                            onEdit={() =>
                                handleEditShelf({
                                    id: shelf.id,
                                    name: shelf.name,
                                    description: shelf.description,
                                })
                            }
                            onDelete={() => handleDeleteShelf(shelf.id, shelf.name)}
                        />
                    ))}
                </div>
            )}

            {/* Modal */}
            <ShelfModal
                isOpen={isModalOpen}
                shelf={editingShelf}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveShelf}
            />
        </div>
    );
}
