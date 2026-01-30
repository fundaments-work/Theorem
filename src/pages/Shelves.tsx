/**
 * Shelves Page
 * Organize books into collections/shelves
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useLibraryStore, useUIStore } from "@/store";
import {
    FolderOpen,
    Plus,
    Search,
    MoreVertical,
    Edit3,
    Trash2,
    BookOpen,
    X,
    Grid3X3,
    List,
    ArrowLeft,
} from "lucide-react";

// Empty state component
function EmptyShelves({ onCreate }: { onCreate: () => void }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-border-subtle)] flex items-center justify-center mb-6">
                <FolderOpen className="w-6 h-6 text-[var(--color-text-secondary)]" />
            </div>
            <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                No Shelves Yet
            </h2>
            <p className="text-[var(--color-text-muted)] mb-8 max-w-xs mx-auto text-sm">
                Create shelves to organize your books your way.
            </p>
            <button
                onClick={onCreate}
                className={cn(
                    "flex items-center gap-2 px-6 py-2.5 rounded-full",
                    "bg-[var(--color-accent)] text-white text-sm font-medium",
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
function EmptyShelfDetail({ shelfName }: { shelfName: string }) {
    const { setRoute } = useUIStore();

    return (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-border-subtle)] flex items-center justify-center mb-6">
                <BookOpen className="w-6 h-6 text-[var(--color-text-secondary)]" />
            </div>
            <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                "{shelfName}" is Empty
            </h2>
            <p className="text-[var(--color-text-muted)] mb-8 max-w-xs mx-auto text-sm">
                Add books from your library to this shelf.
            </p>
            <button
                onClick={() => setRoute("library")}
                className={cn(
                    "flex items-center gap-2 px-6 py-2.5 rounded-full",
                    "bg-[var(--color-accent)] text-white text-sm font-medium",
                    "hover:opacity-90 transition-opacity"
                )}
            >
                <BookOpen className="w-4 h-4" />
                <span>Go to Library</span>
            </button>
        </div>
    );
}

// Shelf card component
interface ShelfCardProps {
    shelf: {
        id: string;
        name: string;
        description?: string;
        bookIds: string[];
        createdAt: Date;
    };
    books: {
        id: string;
        coverPath?: string;
        title: string;
    }[];
    onClick: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

function ShelfCard({ shelf, books, onClick, onEdit, onDelete }: ShelfCardProps) {
    const [showMenu, setShowMenu] = useState(false);
    const displayBooks = books.slice(0, 4);

    return (
        <div className="group relative bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden hover:border-[var(--color-text-muted)] transition-colors">
            {/* Cover Grid Preview */}
            <button onClick={onClick} className="block w-full">
                <div className="aspect-[16/10] bg-[var(--color-border-subtle)] p-4">
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
                                            <BookOpen className="w-6 h-6 text-[var(--color-text-muted)]" />
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
                            <FolderOpen className="w-12 h-12 text-[var(--color-text-muted)] mb-2" />
                            <span className="text-sm text-[var(--color-text-secondary)]">Empty Shelf</span>
                        </div>
                    )}
                </div>
            </button>

            {/* Info */}
            <div className="p-4">
                <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                        <button onClick={onClick} className="text-left w-full">
                            <h3 className="font-semibold text-[var(--color-text-primary)] truncate group-hover:text-[var(--color-accent)] transition-colors">
                                {shelf.name}
                            </h3>
                        </button>
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                            {shelf.bookIds.length} {shelf.bookIds.length === 1 ? "book" : "books"}
                        </p>
                    </div>

                    {/* Menu */}
                    <div className="relative ml-2">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowMenu(!showMenu);
                            }}
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
                                            onEdit();
                                            setShowMenu(false);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-border-subtle)]"
                                    >
                                        <Edit3 className="w-4 h-4" />
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => {
                                            onDelete();
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
            </div>
        </div>
    );
}

// Shelf Detail View
interface ShelfDetailProps {
    shelf: {
        id: string;
        name: string;
        description?: string;
        bookIds: string[];
        createdAt: Date;
    };
    onBack: () => void;
}

function ShelfDetail({ shelf, onBack }: ShelfDetailProps) {
    const { books, removeBookFromCollection } = useLibraryStore();
    const { setRoute } = useUIStore();
    const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

    const shelfBooks = useMemo(() => {
        return shelf.bookIds
            .map((id) => books.find((b) => b.id === id))
            .filter(Boolean);
    }, [shelf.bookIds, books]);

    const handleRemoveBook = (bookId: string) => {
        if (confirm("Remove this book from the shelf?")) {
            removeBookFromCollection(bookId, shelf.id);
        }
    };

    const handleBookClick = (bookId: string) => {
        setRoute("reader", bookId);
    };

    if (shelfBooks.length === 0) {
        return <EmptyShelfDetail shelfName={shelf.name} />;
    }

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-border-subtle)] transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                            {shelf.name}
                        </h1>
                        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">
                            {shelfBooks.length} {shelfBooks.length === 1 ? "book" : "books"}
                        </p>
                    </div>
                </div>

                {/* View Toggle */}
                <div className="flex items-center bg-[var(--color-border-subtle)] rounded-lg p-1">
                    <button
                        onClick={() => setViewMode("grid")}
                        className={cn(
                            "p-2 rounded-md transition-colors",
                            viewMode === "grid"
                                ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        )}
                    >
                        <Grid3X3 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => setViewMode("list")}
                        className={cn(
                            "p-2 rounded-md transition-colors",
                            viewMode === "list"
                                ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        )}
                    >
                        <List className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Books Display */}
            {viewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10">
                    {shelfBooks.map((book) =>
                        book ? (
                            <div key={book.id} className="group relative">
                                <button
                                    onClick={() => handleBookClick(book.id)}
                                    className="block w-full text-left"
                                >
                                    <div className="relative aspect-[2/3] bg-[var(--color-border-subtle)] mb-3 overflow-hidden rounded-lg border border-[var(--color-border)] transition-all duration-200 group-hover:shadow-lg">
                                        {book.coverPath ? (
                                            <img
                                                src={book.coverPath}
                                                alt={book.title}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="book-cover-placeholder w-full h-full text-xs p-2">
                                                <span className="line-clamp-3">{book.title}</span>
                                            </div>
                                        )}
                                    </div>
                                    <h3 className="font-medium text-sm text-[var(--color-text-primary)] line-clamp-1 mb-0.5">
                                        {book.title}
                                    </h3>
                                    <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1">
                                        {book.author}
                                    </p>
                                </button>
                                <button
                                    onClick={() => handleRemoveBook(book.id)}
                                    className="absolute top-2 right-2 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                                    title="Remove from shelf"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ) : null
                    )}
                </div>
            ) : (
                <div className="space-y-2">
                    {shelfBooks.map((book) =>
                        book ? (
                            <div
                                key={book.id}
                                className="group flex items-center gap-4 p-3 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-text-muted)] transition-colors"
                            >
                                <button
                                    onClick={() => handleBookClick(book.id)}
                                    className="flex-shrink-0"
                                >
                                    {book.coverPath ? (
                                        <img
                                            src={book.coverPath}
                                            alt={book.title}
                                            className="w-12 h-16 object-cover rounded shadow-sm"
                                        />
                                    ) : (
                                        <div className="w-12 h-16 bg-[var(--color-border-subtle)] rounded flex items-center justify-center">
                                            <BookOpen className="w-5 h-5 text-[var(--color-text-muted)]" />
                                        </div>
                                    )}
                                </button>
                                <div className="flex-1 min-w-0">
                                    <button onClick={() => handleBookClick(book.id)}>
                                        <h3 className="font-medium text-sm text-[var(--color-text-primary)] truncate hover:text-[var(--color-accent)] transition-colors text-left">
                                            {book.title}
                                        </h3>
                                    </button>
                                    <p className="text-xs text-[var(--color-text-secondary)] truncate">
                                        {book.author}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleRemoveBook(book.id)}
                                    className="p-2 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)] hover:text-[var(--color-error)] opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Remove from shelf"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        ) : null
                    )}
                </div>
            )}
        </div>
    );
}

// Create/Edit Shelf Modal
interface ShelfModalProps {
    shelf?: {
        id: string;
        name: string;
        description?: string;
    };
    onClose: () => void;
    onSave: (name: string, description: string) => void;
}

function ShelfModal({ shelf, onClose, onSave }: ShelfModalProps) {
    const [name, setName] = useState(shelf?.name || "");
    const [description, setDescription] = useState(shelf?.description || "");
    const isEditing = !!shelf;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onSave(name.trim(), description.trim());
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-[var(--color-surface)] rounded-xl shadow-xl max-w-md w-full p-6">
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                    {isEditing ? "Edit Shelf" : "Create New Shelf"}
                </h3>
                <form onSubmit={handleSubmit}>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                                Name
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g., To Read, Favorites, Sci-Fi"
                                className={cn(
                                    "w-full px-3 py-2.5 rounded-lg",
                                    "bg-[var(--color-background)] border border-[var(--color-border)]",
                                    "text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                                    "focus:outline-none focus:border-[var(--color-accent)]"
                                )}
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                                Description <span className="text-[var(--color-text-muted)] font-normal">(optional)</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Add a description for this shelf..."
                                className={cn(
                                    "w-full px-3 py-2.5 rounded-lg resize-none",
                                    "bg-[var(--color-background)] border border-[var(--color-border)]",
                                    "text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                                    "focus:outline-none focus:border-[var(--color-accent)]"
                                )}
                                rows={3}
                            />
                        </div>
                    </div>
                    <div className="flex items-center justify-end gap-3 mt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className={cn(
                                "px-4 py-2 rounded-lg text-sm font-medium",
                                "bg-[var(--color-accent)] text-white",
                                "hover:opacity-90 transition-opacity",
                                "disabled:opacity-50 disabled:cursor-not-allowed"
                            )}
                        >
                            {isEditing ? "Save Changes" : "Create Shelf"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// Main page component
export function ShelvesPage() {
    const { collections, books, addCollection, removeCollection, updateBookMetadata } = useLibraryStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingShelf, setEditingShelf] = useState<{ id: string; name: string; description?: string } | undefined>();

    // Filter shelves
    const filteredShelves = useMemo(() => {
        if (!searchQuery.trim()) return collections;
        const q = searchQuery.toLowerCase();
        return collections.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.description?.toLowerCase().includes(q)
        );
    }, [collections, searchQuery]);

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
            // Update existing
            updateBookMetadata(editingShelf.id, { title: name }); // This is a hack - we need a proper updateCollection
        } else {
            // Create new
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

    const getShelfBooks = (bookIds: string[]) => {
        return bookIds.map((id) => books.find((b) => b.id === id)).filter(Boolean) as typeof books;
    };

    // Show shelf detail view
    if (selectedShelfId) {
        const shelf = collections.find((s) => s.id === selectedShelfId);
        if (shelf) {
            return (
                <div className="p-8 max-w-6xl mx-auto min-h-screen">
                    <ShelfDetail shelf={shelf} onBack={() => setSelectedShelfId(null)} />
                </div>
            );
        }
    }

    // Show shelves list
    if (collections.length === 0) {
        return (
            <div className="p-8 max-w-6xl mx-auto min-h-screen">
                <EmptyShelves onCreate={handleCreateShelf} />
            </div>
        );
    }

    return (
        <div className="p-8 max-w-6xl mx-auto animate-fade-in min-h-screen">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                        Shelves
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        {collections.length} {collections.length === 1 ? "shelf" : "shelves"} •{" "}
                        {collections.reduce((acc, s) => acc + s.bookIds.length, 0)} books
                    </p>
                </div>

                <button
                    onClick={handleCreateShelf}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2.5 rounded-lg",
                        "bg-[var(--color-accent)] text-white text-sm font-medium",
                        "hover:opacity-90 transition-opacity"
                    )}
                >
                    <Plus className="w-4 h-4" />
                    <span>New Shelf</span>
                </button>
            </div>

            {/* Search */}
            <div className="relative max-w-md mb-8">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                    type="text"
                    placeholder="Search shelves..."
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

            {/* Shelves Grid */}
            {filteredShelves.length === 0 ? (
                <div className="text-center py-16">
                    <p className="text-[var(--color-text-muted)]">
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
            {isModalOpen && (
                <ShelfModal
                    shelf={editingShelf}
                    onClose={() => setIsModalOpen(false)}
                    onSave={handleSaveShelf}
                />
            )}
        </div>
    );
}

export default ShelvesPage;
