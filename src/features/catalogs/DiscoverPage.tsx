import { useCallback, useEffect, useState } from "react";
import {
    Globe,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../core/lib/utils";
import { useOpdsStore } from "../../core/store";
import { DiscoverService, type DiscoverSection } from "../../core/services/DiscoverService";
import type { OpdsEntry } from "../../core/types";
import { Modal, ModalBody, ModalFooter, ModalHeader, PageLoader, TheoremBookCover } from "../../ui";
import { DiscoverBookCard } from "./components/DiscoverBookCard";
import { DiscoverCarousel } from "./components/DiscoverCarousel";
import { DiscoverDetailModal } from "./components/DiscoverDetailModal";

export function DiscoverPage() {
    const [sections, setSections] = useState<DiscoverSection[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<OpdsEntry[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    const [selectedBook, setSelectedBook] = useState<OpdsEntry | null>(null);
    const [isAddSourceOpen, setIsAddSourceOpen] = useState(false);
    const [newSourceTitle, setNewSourceTitle] = useState("");
    const [newSourceUrl, setNewSourceUrl] = useState("");

    const addCatalog = useOpdsStore((state) => state.addCatalog);

    const loadDiscoverFeed = useCallback(async (forceRefresh = false) => {
        if (forceRefresh) setIsRefreshing(true);
        else setIsLoading(true);
        setError(null);

        try {
            const data = await DiscoverService.loadCuratedSections(forceRefresh);
            if (data.length > 0) {
                setSections(data);
            } else {
                setError("Could not load discover sections. Please check your internet connection.");
            }
        } catch (err: any) {
            console.error("Discover load error:", err);
            setError("Could not connect to online libraries.");
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void loadDiscoverFeed();
    }, [loadDiscoverFeed]);

    const handleSearchSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const trimmed = searchQuery.trim();
        if (!trimmed) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const results = await DiscoverService.search(trimmed);
            setSearchResults(results);
            if (results.length === 0) {
                toast("No books found for that query.");
            }
        } catch (err: any) {
            toast.error("Search failed. Please check your connection.");
        } finally {
            setIsSearching(false);
        }
    };

    const handleAddSourceSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newSourceTitle.trim() || !newSourceUrl.trim()) return;

        let cleanUrl = newSourceUrl.trim();
        if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
            cleanUrl = `https://${cleanUrl}`;
        }

        addCatalog({
            title: newSourceTitle.trim(),
            url: cleanUrl,
        });

        setIsAddSourceOpen(false);
        setNewSourceTitle("");
        setNewSourceUrl("");
        toast.success(`Added "${newSourceTitle}" library source`);
    };

    // Spotlight hero book (first book from the essentials list)
    const heroBook = sections[0]?.books[0] || null;

    return (
        <div className="flex flex-col min-h-full px-4 sm:px-6 md:px-8 py-6 space-y-8 max-w-7xl mx-auto w-full">
            {/* Top Discovery Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--color-border)] pb-5">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[color:var(--color-text-primary)]">
                        Discover
                    </h1>
                    <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
                        Curated public domain classics and open libraries.
                    </p>
                </div>

                {/* Search Bar & Actions */}
                <div className="flex items-center gap-3">
                    <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-72 md:w-80">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[color:var(--color-text-muted)]" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                if (!e.target.value.trim()) setSearchResults([]);
                            }}
                            placeholder="Search thousands of classics…"
                            className="w-full h-9 pl-9 pr-8 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:border-[var(--color-text-primary)] transition-colors"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchQuery("");
                                    setSearchResults([]);
                                }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </form>

                    <button
                        onClick={() => loadDiscoverFeed(true)}
                        disabled={isRefreshing || isLoading}
                        className="p-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors shrink-0 disabled:opacity-50"
                        title="Refresh Discover feed"
                        aria-label="Refresh feed"
                    >
                        <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
                    </button>

                    <button
                        onClick={() => setIsAddSourceOpen(true)}
                        className="px-3.5 py-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-semibold text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors shrink-0 flex items-center gap-1.5"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Add Source</span>
                    </button>
                </div>
            </div>

            {/* Body Content */}
            {isLoading || isSearching ? (
                <div className="flex flex-col items-center justify-center py-24">
                    <PageLoader message={isSearching ? "Searching library catalog…" : "Loading curated libraries…"} />
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 bg-[var(--color-surface-muted)] rounded-2xl border border-[var(--color-border)] p-8">
                    <Globe className="h-10 w-10 text-[color:var(--color-text-muted)] stroke-1" />
                    <p className="text-xs text-[color:var(--color-text-muted)] max-w-sm">{error}</p>
                    <button
                        onClick={() => loadDiscoverFeed(true)}
                        className="mt-2 px-4 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-bold rounded-lg hover:bg-[var(--color-surface-muted)] transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            ) : searchResults.length > 0 ? (
                /* Search Results Grid Mode */
                <div className="space-y-4 animate-fade-in">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold text-[color:var(--color-text-primary)]">
                            Search Results for "{searchQuery}"
                        </h2>
                        <span className="text-xs text-[color:var(--color-text-muted)]">
                            {searchResults.length} {searchResults.length === 1 ? "book" : "books"} found
                        </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {searchResults.map((entry) => (
                            <DiscoverBookCard
                                key={entry.id}
                                entry={entry}
                                onSelect={(b) => setSelectedBook(b)}
                            />
                        ))}
                    </div>
                </div>
            ) : (
                /* Editorial Storefront Mode */
                <div className="space-y-10 animate-fade-in">
                    {/* Hero Spotlight Banner */}
                    {heroBook && (
                        <div
                            onClick={() => setSelectedBook(heroBook)}
                            className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface)] via-[var(--color-surface-muted)] to-[var(--color-surface)] p-6 sm:p-8 cursor-pointer group shadow-sm hover:shadow-md transition-all duration-200"
                        >
                            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
                                <div className="aspect-[2/3] w-32 sm:w-40 shrink-0 rounded-lg overflow-hidden border border-[var(--color-border)] shadow-lg group-hover:scale-105 transition-transform duration-300">
                                    <TheoremBookCover
                                        title={heroBook.title}
                                        author={heroBook.author}
                                        coverUrl={heroBook.coverUrl || heroBook.thumbnailUrl}
                                        badge="FEATURED CLASSIC"
                                    />
                                </div>

                                <div className="flex flex-col justify-between space-y-4 text-center sm:text-left min-w-0 flex-1">
                                    <div className="space-y-2">
                                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-accent)]">
                                            <Sparkles className="h-3 w-3" />
                                            <span>Featured Classic</span>
                                        </div>
                                        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[color:var(--color-text-primary)]">
                                            {heroBook.title}
                                        </h2>
                                        <p className="text-xs font-semibold text-[color:var(--color-text-secondary)]">
                                            {heroBook.author || "Public Domain"}
                                        </p>
                                        {heroBook.summary && (
                                            <p className="text-xs text-[color:var(--color-text-muted)] line-clamp-3 leading-relaxed max-w-2xl pt-1">
                                                {heroBook.summary}
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-center sm:justify-start gap-3 pt-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedBook(heroBook);
                                            }}
                                            className="px-5 py-2.5 rounded-full bg-[var(--color-text-primary)] text-[var(--color-background)] text-xs font-bold hover:opacity-90 transition-opacity"
                                        >
                                            View Book
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Curated Horizontal Carousels */}
                    {sections.map((section) => (
                        <DiscoverCarousel
                            key={section.id}
                            section={section}
                            onSelectBook={(b) => setSelectedBook(b)}
                        />
                    ))}
                </div>
            )}

            {/* Book Detail Modal */}
            <DiscoverDetailModal
                entry={selectedBook}
                onClose={() => setSelectedBook(null)}
            />

            {/* Add Custom Source Modal */}
            <Modal isOpen={isAddSourceOpen} onClose={() => setIsAddSourceOpen(false)}>
                <form onSubmit={handleAddSourceSubmit}>
                    <ModalHeader title="Add Library Source" onClose={() => setIsAddSourceOpen(false)} />
                    <ModalBody className="space-y-4">
                        <div>
                            <label className="block text-xs font-semibold text-[color:var(--color-text-secondary)] mb-1.5">
                                Source Name
                            </label>
                            <input
                                type="text"
                                value={newSourceTitle}
                                onChange={(e) => setNewSourceTitle(e.target.value)}
                                placeholder="e.g. My Calibre Server"
                                className="w-full h-9 bg-[var(--color-surface)] border border-[var(--color-border)] px-3 text-xs text-[color:var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-primary)]"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-[color:var(--color-text-secondary)] mb-1.5">
                                OPDS / Feed URL
                            </label>
                            <input
                                type="text"
                                value={newSourceUrl}
                                onChange={(e) => setNewSourceUrl(e.target.value)}
                                placeholder="http://192.168.1.100:8080/opds"
                                className="w-full h-9 bg-[var(--color-surface)] border border-[var(--color-border)] px-3 text-xs text-[color:var(--color-text-primary)] rounded-md focus:outline-none focus:border-[var(--color-text-primary)]"
                                required
                            />
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button
                            type="button"
                            onClick={() => setIsAddSourceOpen(false)}
                            className="px-4 py-2 border border-[var(--color-border)] text-xs font-semibold text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] rounded-md"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-[var(--color-text-primary)] text-[var(--color-background)] text-xs font-bold rounded-md hover:opacity-90"
                        >
                            Add Source
                        </button>
                    </ModalFooter>
                </form>
            </Modal>
        </div>
    );
}
