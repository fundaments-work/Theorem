import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ChevronDown,
    Globe,
    Languages,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
    X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { cn } from "../../core/lib/utils";
import { useOpdsStore, useSettingsStore } from "../../core/store";
import { DiscoverService, type DiscoverSection } from "../../core/services/DiscoverService";
import type { OpdsEntry } from "../../core/types";
import { Modal, ModalBody, ModalFooter, ModalHeader, PageLoader, TheoremBookCover } from "../../ui";
import { DiscoverBookCard } from "./components/DiscoverBookCard";
import { DiscoverCarousel } from "./components/DiscoverCarousel";
import { DiscoverDetailModal } from "./components/DiscoverDetailModal";

const LANGUAGE_OPTIONS = [
    { code: "en", label: "English" },
    { code: "all", label: "All Languages" },
    { code: "es", label: "Español" },
    { code: "fr", label: "Français" },
    { code: "de", label: "Deutsch" },
    { code: "it", label: "Italiano" },
];

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
    const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false);

    const addCatalog = useOpdsStore((state) => state.addCatalog);
    const discoverLanguage = useSettingsStore((state) => state.settings.discoverLanguage) || "en";
    const updateSettings = useSettingsStore((state) => state.updateSettings);

    const scrollRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(1024);

    // Responsive columns for virtual search grid
    const effectiveCols = useMemo(() => {
        if (containerWidth < 640) return 2;
        if (containerWidth < 768) return 3;
        if (containerWidth < 1024) return 4;
        if (containerWidth < 1280) return 5;
        return 6;
    }, [containerWidth]);

    // Track scroll container width for responsive virtualizer
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const updateWidth = () => {
            setContainerWidth(el.clientWidth || 1024);
        };

        updateWidth();
        const ro = new ResizeObserver(updateWidth);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const loadDiscoverFeed = useCallback(async (forceRefresh = false, lang = discoverLanguage) => {
        if (forceRefresh) setIsRefreshing(true);
        else setIsLoading(true);
        setError(null);

        try {
            const data = await DiscoverService.loadCuratedSections(forceRefresh, lang);
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
    }, [discoverLanguage]);

    useEffect(() => {
        void loadDiscoverFeed(false, discoverLanguage);
    }, [loadDiscoverFeed, discoverLanguage]);

    const performSearch = useCallback(async (query: string, lang = discoverLanguage) => {
        const trimmed = query.trim();
        if (!trimmed) {
            setSearchResults([]);
            return;
        }

        setIsSearching(true);
        try {
            const results = await DiscoverService.search(trimmed, lang);
            if (results.length > 0) {
                setSearchResults(results);
            } else {
                // Fallback search across currently loaded sections
                const localMatches: OpdsEntry[] = [];
                const qLower = trimmed.toLowerCase();
                for (const section of sections) {
                    for (const b of section.books) {
                        if (
                            b.title.toLowerCase().includes(qLower) ||
                            (b.author && b.author.toLowerCase().includes(qLower)) ||
                            (b.summary && b.summary.toLowerCase().includes(qLower))
                        ) {
                            if (!localMatches.some((m) => m.id === b.id)) {
                                localMatches.push(b);
                            }
                        }
                    }
                }
                setSearchResults(localMatches);
            }
        } catch (err: any) {
            console.warn("Online search failed, searching local sections:", err);
            const localMatches: OpdsEntry[] = [];
            const qLower = trimmed.toLowerCase();
            for (const section of sections) {
                for (const b of section.books) {
                    if (
                        b.title.toLowerCase().includes(qLower) ||
                        (b.author && b.author.toLowerCase().includes(qLower))
                    ) {
                        if (!localMatches.some((m) => m.id === b.id)) {
                            localMatches.push(b);
                        }
                    }
                }
            }
            setSearchResults(localMatches);
        } finally {
            setIsSearching(false);
        }
    }, [sections, discoverLanguage]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchQuery.trim().length >= 2) {
                void performSearch(searchQuery, discoverLanguage);
            } else if (!searchQuery.trim()) {
                setSearchResults([]);
            }
        }, 350);

        return () => clearTimeout(timer);
    }, [searchQuery, performSearch, discoverLanguage]);

    const handleSearchSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        void performSearch(searchQuery, discoverLanguage);
    };

    const handleLanguageChange = (langCode: string) => {
        setIsLanguageMenuOpen(false);
        updateSettings({ discoverLanguage: langCode });
        void loadDiscoverFeed(true, langCode);
        if (searchQuery.trim()) {
            void performSearch(searchQuery, langCode);
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

    // Virtualization setup for search results grid
    const searchRowCount = Math.ceil(searchResults.length / effectiveCols);
    const searchVirtualizer = useVirtualizer({
        count: searchRowCount,
        getScrollElement: useCallback(() => scrollRef.current, []),
        estimateSize: useCallback(() => 270, []),
        overscan: 2,
    });

    // Spotlight hero book (first book from the essentials list)
    const heroBook = sections[0]?.books[0] || null;
    const currentLangLabel = LANGUAGE_OPTIONS.find((l) => l.code === discoverLanguage)?.label || "English";

    return (
        <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto min-h-0 custom-scrollbar [content-visibility:auto] overscroll-contain h-full"
        >
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

                    {/* Search Bar, Language Selector & Actions */}
                    <div className="flex flex-wrap items-center gap-3">
                        <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-64 md:w-72">
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

                        {/* Language Selector Dropdown */}
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setIsLanguageMenuOpen(!isLanguageMenuOpen)}
                                className="h-9 px-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-xs font-medium text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors flex items-center gap-1.5 shrink-0"
                                title="Select Book Language"
                            >
                                <Languages className="h-3.5 w-3.5" />
                                <span>{currentLangLabel}</span>
                                <ChevronDown className="h-3 w-3 opacity-60" />
                            </button>

                            {isLanguageMenuOpen && (
                                <>
                                    <div
                                        className="fixed inset-0 z-40"
                                        onClick={() => setIsLanguageMenuOpen(false)}
                                    />
                                    <div className="absolute right-0 top-full mt-1.5 z-50 w-36 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg animate-fade-in">
                                        {LANGUAGE_OPTIONS.map((lang) => (
                                            <button
                                                key={lang.code}
                                                type="button"
                                                onClick={() => handleLanguageChange(lang.code)}
                                                className={cn(
                                                    "w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
                                                    discoverLanguage === lang.code
                                                        ? "bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)] font-bold"
                                                        : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)]"
                                                )}
                                            >
                                                {lang.label}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>

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
                    /* Virtualized Search Results Grid */
                    <div className="space-y-4 animate-fade-in">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-bold text-[color:var(--color-text-primary)]">
                                Search Results for "{searchQuery}"
                            </h2>
                            <span className="text-xs text-[color:var(--color-text-muted)]">
                                {searchResults.length} {searchResults.length === 1 ? "book" : "books"} found
                            </span>
                        </div>

                        <div
                            style={{
                                height: `${searchVirtualizer.getTotalSize()}px`,
                                width: "100%",
                                position: "relative",
                            }}
                        >
                            {searchVirtualizer.getVirtualItems().map((virtualRow) => {
                                const startIndex = virtualRow.index * effectiveCols;
                                const rowBooks = searchResults.slice(startIndex, startIndex + effectiveCols);

                                return (
                                    <div
                                        key={virtualRow.index}
                                        data-index={virtualRow.index}
                                        ref={searchVirtualizer.measureElement}
                                        style={{
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}
                                        className="grid gap-4 pb-4"
                                        style-grid-cols={`grid-cols-${effectiveCols}`}
                                    >
                                        <div
                                            className={cn(
                                                "grid gap-4 w-full",
                                                effectiveCols === 2 && "grid-cols-2",
                                                effectiveCols === 3 && "grid-cols-3",
                                                effectiveCols === 4 && "grid-cols-4",
                                                effectiveCols === 5 && "grid-cols-5",
                                                effectiveCols === 6 && "grid-cols-6"
                                            )}
                                        >
                                            {rowBooks.map((entry) => (
                                                <DiscoverBookCard
                                                    key={entry.id}
                                                    entry={entry}
                                                    onSelect={(b) => setSelectedBook(b)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
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
        </div>
    );
}
