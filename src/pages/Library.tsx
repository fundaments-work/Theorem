/**
 * Library Page
 * Book management and import
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useLibraryStore, useUIStore } from "@/store";
import { formatProgress } from "@/lib/utils";
import { pickAndImportBooks, scanFolderForBooks } from "@/lib/import";
import { Plus, Filter, BookOpen, Loader2, FolderOpen, RefreshCw } from "lucide-react";
import type { Book } from "@/types";
import { isTauri } from "@/lib/env";
import { getBookData } from "@/lib/storage";
import { extractBookMetadata } from "@/lib/cover-extractor";

// Book Card Component
function BookCard({ book }: { book: Book }) {
    const { setRoute } = useUIStore();

    return (
        <button
            onClick={() => setRoute("reader", book.id)}
            className="group flex flex-col text-left focus:outline-none"
        >
            {/* Cover Image */}
            <div className={cn(
                "relative aspect-[2/3] bg-[var(--color-border-subtle)] mb-3 overflow-hidden rounded-lg",
                "border border-[var(--color-border)]",
                "transition-all duration-200 group-hover:shadow-lg"
            )}>
                {book.coverPath ? (
                    <img
                        src={book.coverPath}
                        alt={book.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="book-cover-placeholder w-full h-full text-xs p-2">
                        <span className="line-clamp-3">{book.title}</span>
                    </div>
                )}

                {/* Progress Bar */}
                {book.progress > 0 && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/10">
                        <div
                            className="h-full bg-[var(--color-accent)]"
                            style={{ width: `${book.progress * 100}%` }}
                        />
                    </div>
                )}
            </div>

            {/* Book Info */}
            <div>
                <h3 className="font-medium text-sm text-[var(--color-text-primary)] line-clamp-1 mb-0.5">
                    {book.title}
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1">
                    {book.author}
                </p>
                {book.progress > 0 && (
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                        {formatProgress(book.progress)}
                    </p>
                )}
            </div>
        </button>
    );
}

// Empty State Component
function EmptyLibrary({ onAddBooks, isLoading }: { onAddBooks: () => void; isLoading: boolean }) {
    return (
        <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-[var(--color-border-subtle)] flex items-center justify-center mb-6">
                <BookOpen className="w-6 h-6 text-[var(--color-text-secondary)]" />
            </div>
            <h2 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">
                No books yet
            </h2>
            <p className="text-[var(--color-text-muted)] mb-8 max-w-xs mx-auto text-sm">
                Import books to start reading
            </p>
            <button
                onClick={onAddBooks}
                disabled={isLoading}
                className={cn(
                    "flex items-center gap-2 px-6 py-2.5 rounded-full",
                    "bg-[var(--color-accent)] text-white text-sm font-medium",
                    "hover:opacity-90 transition-opacity",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
            >
                {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                    <Plus className="w-4 h-4" />
                )}
                <span>{isLoading ? 'Importing...' : 'Import Books'}</span>
            </button>
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
            className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-[var(--color-accent)] text-white text-sm font-medium",
                "hover:opacity-90 transition-opacity",
                "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
        >
            {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
                <Plus className="w-4 h-4" />
            )}
            <span>Add</span>
        </button>
    );
}

// Main Library Page
export function LibraryPage() {
    const books = useLibraryStore((state) => state.books);
    const addBooks = useLibraryStore((state) => state.addBooks);
    const updateBook = useLibraryStore((state) => state.updateBook);
    const [isImporting, setIsImporting] = useState(false);
    const [isScanning, setIsScanning] = useState(false);
    const [isExtractingCovers, setIsExtractingCovers] = useState(false);
    const [extractionProgress, setExtractionProgress] = useState({ current: 0, total: 0 });
    
    // Track if we've already started extraction to avoid duplicate runs
    const extractionStartedRef = useRef(false);

    // Auto-extract covers for books that don't have them
    useEffect(() => {
        // Only run once per session and if there are books
        if (extractionStartedRef.current || books.length === 0) return;
        
        // Find books without covers
        const booksWithoutCovers = books.filter(book => !book.coverPath);
        
        if (booksWithoutCovers.length === 0) return;
        
        extractionStartedRef.current = true;
        
        const extractCovers = async () => {
            console.log('[Library] Starting cover extraction for', booksWithoutCovers.length, 'books');
            setIsExtractingCovers(true);
            setExtractionProgress({ current: 0, total: booksWithoutCovers.length });
            
            for (let i = 0; i < booksWithoutCovers.length; i++) {
                const book = booksWithoutCovers[i];
                setExtractionProgress({ current: i + 1, total: booksWithoutCovers.length });
                
                try {
                    // Get book data from storage
                    const storagePath = book.storagePath || book.filePath;
                    const data = await getBookData(book.id, storagePath);
                    
                    if (!data) {
                        console.warn('[Library] Could not load book data for:', book.id);
                        continue;
                    }
                    
                    // Extract metadata and cover
                    const filename = book.filePath.split(/[/\\]/).pop() || 'book.epub';
                    const metadata = await extractBookMetadata(data, filename, book.id);
                    
                    // Update book with extracted data
                    const updates: Partial<Book> = {};
                    
                    if (metadata.coverDataUrl) {
                        updates.coverPath = metadata.coverDataUrl;
                    }
                    
                    // Only update title/author if current ones look like fallbacks
                    if (metadata.title && (book.title === 'Unknown' || book.title.includes('.'))) {
                        updates.title = metadata.title;
                    }
                    if (metadata.author && (book.author === 'Unknown Author' || !book.author)) {
                        updates.author = metadata.author;
                    }
                    
                    // Update other metadata if available
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
                    
                    if (Object.keys(updates).length > 0) {
                        console.log('[Library] Updating book with extracted data:', book.id, updates);
                        updateBook(book.id, updates);
                    }
                } catch (error) {
                    console.error('[Library] Failed to extract cover for book:', book.id, error);
                }
                
                // Small delay to avoid overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            setIsExtractingCovers(false);
            console.log('[Library] Cover extraction complete');
        };
        
        // Start extraction with a small delay to let the UI render first
        const timeoutId = setTimeout(extractCovers, 500);
        
        return () => clearTimeout(timeoutId);
    }, [books, updateBook]);

    // Handle importing books
    const handleAddBooks = useCallback(async () => {
        if (!isTauri()) {
            alert('Book import requires the desktop app. Please use the Tauri build.');
            return;
        }

        setIsImporting(true);
        try {
            const importedBooks = await pickAndImportBooks();
            if (importedBooks.length > 0) {
                addBooks(importedBooks);
            }
        } catch (err) {
            console.error('Import error:', err);
        } finally {
            setIsImporting(false);
        }
    }, [addBooks]);

    // Handle scanning folder (Tauri only)
    const handleScanFolder = useCallback(async () => {
        if (!isTauri()) {
            alert('Folder scanning requires the desktop app.');
            return;
        }

        setIsScanning(true);
        try {
            const dialog = await import('@tauri-apps/plugin-dialog');
            const folder = await dialog.open({
                directory: true,
                multiple: false,
            });
            
            if (folder && typeof folder === 'string') {
                const bookPaths = await scanFolderForBooks(folder);
                
                // Import found books
                const { importBooks } = await import('@/lib/import');
                const importedBooks = await importBooks(bookPaths);
                
                if (importedBooks.length > 0) {
                    addBooks(importedBooks);
                }
            }
        } catch (err) {
            console.error('Scan error:', err);
        } finally {
            setIsScanning(false);
        }
    }, [addBooks]);

    // Auto-scan on first load if Tauri
    useEffect(() => {
        const hasScanned = sessionStorage.getItem('lion-reader-initial-scan');
        if (!hasScanned && isTauri() && books.length === 0) {
            sessionStorage.setItem('lion-reader-initial-scan', 'true');
            // Could trigger initial scan here
        }
    }, [books.length]);

    if (books.length === 0) {
        return <EmptyLibrary onAddBooks={handleAddBooks} isLoading={isImporting} />;
    }

    return (
        <div className="p-8 max-w-7xl mx-auto animate-fade-in min-h-screen">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-10">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                        Library
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        {books.length} {books.length === 1 ? 'book' : 'books'}
                        {isExtractingCovers && (
                            <span className="ml-2 text-[var(--color-accent)]">
                                Extracting covers ({extractionProgress.current}/{extractionProgress.total})
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <ImportButton onImport={handleAddBooks} isLoading={isImporting} />

                    {isTauri() && (
                        <button
                            onClick={handleScanFolder}
                            disabled={isScanning}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-lg",
                                "border border-[var(--color-border)] bg-[var(--color-surface)]",
                                "text-[var(--color-text-secondary)] text-sm",
                                "hover:bg-[var(--color-border-subtle)] transition-colors",
                                "disabled:opacity-50 disabled:cursor-not-allowed"
                            )}
                            title="Scan Folder"
                        >
                            {isScanning ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <FolderOpen className="w-4 h-4" />
                            )}
                            <span className="hidden sm:inline">Scan</span>
                        </button>
                    )}

                    <button
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg",
                            "border border-[var(--color-border)] bg-[var(--color-surface)]",
                            "text-[var(--color-text-secondary)] text-sm",
                            "hover:bg-[var(--color-border-subtle)] transition-colors"
                        )}
                    >
                        <Filter className="w-4 h-4" />
                        <span className="hidden sm:inline">Filter</span>
                    </button>
                </div>
            </div>

            {/* Books Grid */}
            <section>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-6 gap-y-10">
                    {books.map((book) => (
                        <BookCard key={book.id} book={book} />
                    ))}
                </div>
            </section>
        </div>
    );
}

export default LibraryPage;
