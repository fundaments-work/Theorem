import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ArrowLeft,
    BookOpen,
    ChevronRight,
    Download,
    Folder,
    Globe,
    Info,
    Plus,
    RefreshCw,
    Search,
    X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../core/lib/utils";
import { useOpdsStore, useUIStore } from "../../core/store";
import { OpdsService } from "../../core/services/OpdsService";
import type { OpdsEntry, OpdsFeed } from "../../core/types";
import { Modal, ModalHeader, ModalBody, ModalFooter, PageLoader } from "../../ui";

export function OPDSBrowserPage() {
    const catalogs = useOpdsStore((state) => state.catalogs);
    const activeCatalogId = useOpdsStore((state) => state.activeCatalogId);
    const currentFeedUrl = useOpdsStore((state) => state.currentFeedUrl);
    const feedHistory = useOpdsStore((state) => state.feedHistory);

    const setActiveCatalog = useOpdsStore((state) => state.setActiveCatalog);
    const navigateToFeed = useOpdsStore((state) => state.navigateToFeed);
    const navigateBack = useOpdsStore((state) => state.navigateBack);
    const addCatalog = useOpdsStore((state) => state.addCatalog);

    const setRoute = useUIStore((state) => state.setRoute);

    const [feed, setFeed] = useState<OpdsFeed | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);

    const [selectedEntry, setSelectedEntry] = useState<OpdsEntry | null>(null);
    const [downloadingEntryId, setDownloadingEntryId] = useState<string | null>(null);

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newCatalogTitle, setNewCatalogTitle] = useState("");
    const [newCatalogUrl, setNewCatalogUrl] = useState("");

    const activeCatalog = useMemo(() => {
        return catalogs.find((c) => c.id === activeCatalogId) || catalogs[0] || null;
    }, [catalogs, activeCatalogId]);

    const targetUrl = currentFeedUrl || activeCatalog?.url || null;

    const loadFeed = useCallback(async (url: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await OpdsService.fetchFeed(url);
            setFeed(data);
        } catch (err: any) {
            console.error("OPDS load error:", err);
            setError(err.message || "Failed to load catalog feed.");
            toast.error(err.message || "Failed to load catalog feed.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (targetUrl) {
            void loadFeed(targetUrl);
        }
    }, [targetUrl, loadFeed]);

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const trimmed = searchQuery.trim();
        if (!trimmed) {
            if (targetUrl) void loadFeed(targetUrl);
            return;
        }

        if (feed?.searchUrlTemplate) {
            setIsSearching(true);
            try {
                const searchResults = await OpdsService.search(
                    feed.searchUrlTemplate,
                    trimmed,
                    feed.selfUrl || targetUrl || ""
                );
                setFeed(searchResults);
            } catch (err: any) {
                toast.error("Search failed: " + (err.message || "Unknown error"));
            } finally {
                setIsSearching(false);
            }
        }
    };

    const filteredEntries = useMemo(() => {
        if (!feed?.entries) return [];
        if (!searchQuery.trim() || feed.searchUrlTemplate) {
            return feed.entries;
        }
        const q = searchQuery.toLowerCase();
        return feed.entries.filter(
            (e) =>
                e.title.toLowerCase().includes(q) ||
                (e.author && e.author.toLowerCase().includes(q)) ||
                (e.summary && e.summary.toLowerCase().includes(q))
        );
    }, [feed?.entries, searchQuery, feed?.searchUrlTemplate]);

    const navigationEntries = useMemo(
        () => filteredEntries.filter((e) => e.isNavigation),
        [filteredEntries]
    );

    const acquisitionEntries = useMemo(
        () => filteredEntries.filter((e) => !e.isNavigation),
        [filteredEntries]
    );

    const handleDownload = async (entry: OpdsEntry) => {
        if (!entry.downloadUrl) {
            toast.error("No download link found for this book.");
            return;
        }

        setDownloadingEntryId(entry.id);
        const toastId = toast.loading(`Downloading "${entry.title}"…`);

        try {
            const book = await OpdsService.downloadAndImportBook(entry, (step) => {
                toast.loading(step, { id: toastId });
            });

            toast.success(`"${book.title}" added to library!`, {
                id: toastId,
                action: {
                    label: "Read Now",
                    onClick: () => setRoute("reader", book.id),
                },
            });
        } catch (err: any) {
            console.error("Download failed:", err);
            toast.error("Download failed: " + (err.message || "Unknown error"), { id: toastId });
        } finally {
            setDownloadingEntryId(null);
        }
    };

    const handleAddCatalogSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const title = newCatalogTitle.trim();
        const url = newCatalogUrl.trim();

        if (!title || !url) {
            toast.error("Please provide both a title and valid URL.");
            return;
        }

        try {
            new URL(url);
        } catch {
            toast.error("Please enter a valid HTTP or HTTPS URL.");
            return;
        }

        addCatalog({ title, url });
        setNewCatalogTitle("");
        setNewCatalogUrl("");
        setIsAddModalOpen(false);
        toast.success(`Catalog "${title}" added!`);
    };

    return (
        <div className="mx-auto flex h-full w-full max-w-[var(--layout-content-max-width)] flex-col px-4 py-6 pb-0 sm:px-6 lg:px-8 lg:py-8 animate-fade-in">
            {/* Top Bar Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
                <div className="flex items-center gap-3">
                    {feedHistory.length > 0 && (
                        <button
                            onClick={navigateBack}
                            className="flex h-9 w-9 items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] transition-colors"
                            title="Back"
                            aria-label="Back"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                    )}
                    <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                            <h1 className="m-0 font-sans text-[1.45rem] font-semibold uppercase tracking-[0.12em] leading-[1.1] text-[color:var(--color-text-primary)] sm:text-[1.6rem]">
                                {feed?.title || activeCatalog?.title || "Catalogs"}
                            </h1>
                            <span className="inline-flex items-center gap-1 rounded bg-[var(--color-accent-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-accent)]">
                                <Globe className="h-3 w-3" /> OPDS
                            </span>
                        </div>
                        <p className="mt-1 text-xs text-[color:var(--color-text-muted)] truncate max-w-md">
                            {feed?.subtitle || activeCatalog?.description || activeCatalog?.url}
                        </p>
                    </div>
                </div>

                {/* Catalog Controls */}
                <div className="flex items-center gap-2">
                    <select
                        value={activeCatalogId || ""}
                        onChange={(e) => setActiveCatalog(e.target.value)}
                        className="h-9 px-3 text-xs font-semibold bg-[var(--color-surface)] border border-[var(--color-border)] text-[color:var(--color-text-primary)] hover:border-[var(--color-accent)] focus:outline-none transition-colors"
                    >
                        {catalogs.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.title} {c.isPreset ? "(Preset)" : ""}
                            </option>
                        ))}
                    </select>

                    <button
                        onClick={() => targetUrl && loadFeed(targetUrl)}
                        disabled={isLoading}
                        className="flex h-9 w-9 items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] disabled:opacity-50 transition-colors"
                        title="Refresh"
                        aria-label="Refresh"
                    >
                        <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                    </button>

                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="flex h-9 items-center gap-1.5 px-3 border border-[var(--color-accent)] bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
                    >
                        <Plus className="h-4 w-4" />
                        <span className="hidden sm:inline">Add Catalog</span>
                    </button>
                </div>
            </div>

            {/* Search Bar */}
            <form onSubmit={handleSearch} className="relative mb-6">
                <div className="relative flex items-center">
                    <Search className="absolute left-3.5 h-4 w-4 text-[color:var(--color-text-muted)] pointer-events-none" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={
                            feed?.searchUrlTemplate
                                ? "Search catalog catalog…"
                                : "Filter current page…"
                        }
                        className="h-10 w-full bg-[var(--color-surface)] border border-[var(--color-border)] pl-10 pr-24 text-xs text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none transition-colors"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery("");
                                if (targetUrl) void loadFeed(targetUrl);
                            }}
                            className="absolute right-12 p-1 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                    {feed?.searchUrlTemplate && (
                        <button
                            type="submit"
                            disabled={isSearching}
                            className="absolute right-1.5 h-7 px-2.5 bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)] text-[10px] font-bold uppercase tracking-wider hover:bg-[var(--color-border)] transition-colors"
                        >
                            {isSearching ? "Searching…" : "Search"}
                        </button>
                    )}
                </div>
            </form>

            {/* Main Content Area */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-12">
                {isLoading ? (
                    <PageLoader message="Loading catalog feed…" className="py-20" />
                ) : error ? (
                    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center border-2 border-dashed border-[var(--color-border)] p-8">
                        <p className="text-sm font-semibold text-[color:var(--color-error)]">
                            {error}
                        </p>
                        <button
                            onClick={() => targetUrl && loadFeed(targetUrl)}
                            className="px-4 py-2 bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] text-xs font-bold uppercase tracking-wider"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-8">
                        {/* Navigation Categories / Subsections */}
                        {navigationEntries.length > 0 && (
                            <div className="flex flex-col gap-3">
                                <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--color-text-muted)]">
                                    Categories & Navigation ({navigationEntries.length})
                                </h2>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {navigationEntries.map((nav) => (
                                        <button
                                            key={nav.id}
                                            onClick={() => nav.navUrl && navigateToFeed(nav.navUrl)}
                                            className="flex items-center justify-between p-3 bg-[var(--color-surface)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-muted)] text-left transition-all group"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <Folder className="h-4 w-4 text-[color:var(--color-accent)] shrink-0 group-hover:scale-110 transition-transform" />
                                                <span className="text-xs font-bold text-[color:var(--color-text-primary)] truncate">
                                                    {nav.title}
                                                </span>
                                            </div>
                                            <ChevronRight className="h-4 w-4 text-[color:var(--color-text-muted)] group-hover:text-[color:var(--color-text-primary)] shrink-0" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Acquisition Books Grid */}
                        {acquisitionEntries.length > 0 ? (
                            <div className="flex flex-col gap-3">
                                <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-[color:var(--color-text-muted)]">
                                    Available Books ({acquisitionEntries.length})
                                </h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
                                    {acquisitionEntries.map((book) => {
                                        const isDownloading = downloadingEntryId === book.id;
                                        return (
                                            <div
                                                key={book.id}
                                                className="group relative flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] overflow-hidden transition-all hover:shadow-md hover:border-[var(--color-accent)]"
                                            >
                                                {/* Book Cover */}
                                                <div
                                                    onClick={() => setSelectedEntry(book)}
                                                    className="relative aspect-[2/3] w-full bg-[var(--color-surface-muted)] cursor-pointer overflow-hidden flex items-center justify-center"
                                                >
                                                    {book.coverUrl ? (
                                                        <img
                                                            src={book.coverUrl}
                                                            alt={book.title}
                                                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                            loading="lazy"
                                                        />
                                                    ) : (
                                                        <div className="flex flex-col items-center justify-center p-3 text-center">
                                                            <BookOpen className="h-8 w-8 text-[color:var(--color-text-muted)] mb-2" />
                                                            <span className="text-[11px] font-bold text-[color:var(--color-text-primary)] line-clamp-2">
                                                                {book.title}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Format Badge */}
                                                    {book.downloadFormat && (
                                                        <span className="absolute top-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[9px] font-black uppercase text-white tracking-widest backdrop-blur-sm">
                                                            {book.downloadFormat}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Book Info */}
                                                <div className="flex flex-col flex-1 p-3">
                                                    <h3
                                                        onClick={() => setSelectedEntry(book)}
                                                        className="text-xs font-bold text-[color:var(--color-text-primary)] line-clamp-1 cursor-pointer hover:text-[color:var(--color-accent)] transition-colors"
                                                        title={book.title}
                                                    >
                                                        {book.title}
                                                    </h3>
                                                    <p className="text-[11px] text-[color:var(--color-text-muted)] line-clamp-1 mt-0.5">
                                                        {book.author || "Unknown Author"}
                                                    </p>

                                                    <div className="mt-auto pt-3 flex items-center gap-1.5">
                                                        <button
                                                            onClick={() => handleDownload(book)}
                                                            disabled={isDownloading}
                                                            className="flex-1 flex items-center justify-center gap-1.5 h-8 bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] text-[10px] font-black uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition-opacity"
                                                        >
                                                            <Download className={cn("h-3.5 w-3.5", isDownloading && "animate-bounce")} />
                                                            <span>{isDownloading ? "Saving…" : "Get"}</span>
                                                        </button>
                                                        <button
                                                            onClick={() => setSelectedEntry(book)}
                                                            className="flex h-8 w-8 items-center justify-center border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] transition-colors"
                                                            title="Details"
                                                            aria-label="Details"
                                                        >
                                                            <Info className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : navigationEntries.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-[var(--color-border)]">
                                <p className="text-xs font-bold uppercase tracking-widest text-[color:var(--color-text-muted)]">
                                    No books found matching criteria
                                </p>
                            </div>
                        ) : null}

                        {/* Pagination Next Link */}
                        {feed?.nextUrl && (
                            <div className="flex justify-center pt-4">
                                <button
                                    onClick={() => feed.nextUrl && navigateToFeed(feed.nextUrl)}
                                    className="px-6 py-2.5 border border-[var(--color-accent)] bg-[var(--color-surface)] text-[color:var(--color-accent)] text-xs font-bold uppercase tracking-wider hover:bg-[var(--color-accent)] hover:text-[color:var(--color-accent-contrast)] transition-colors"
                                >
                                    Next Page →
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Book Details Modal */}
            <Modal isOpen={!!selectedEntry} onClose={() => setSelectedEntry(null)}>
                {selectedEntry && (
                    <>
                        <ModalHeader title={selectedEntry.title} onClose={() => setSelectedEntry(null)} />
                        <ModalBody className="space-y-4">
                            <div className="flex flex-col sm:flex-row gap-4">
                                {selectedEntry.coverUrl && (
                                    <div className="aspect-[2/3] w-28 shrink-0 bg-[var(--color-surface-muted)] overflow-hidden rounded">
                                        <img src={selectedEntry.coverUrl} alt={selectedEntry.title} className="h-full w-full object-cover" />
                                    </div>
                                )}
                                <div className="flex flex-col gap-1 min-w-0">
                                    <h4 className="text-sm font-bold text-[color:var(--color-text-primary)]">{selectedEntry.title}</h4>
                                    <p className="text-xs text-[color:var(--color-accent)] font-medium">{selectedEntry.author || "Unknown Author"}</p>
                                    {selectedEntry.publisher && (
                                        <p className="text-[11px] text-[color:var(--color-text-muted)]">Publisher: {selectedEntry.publisher}</p>
                                    )}
                                    {selectedEntry.language && (
                                        <p className="text-[11px] text-[color:var(--color-text-muted)]">Language: {selectedEntry.language.toUpperCase()}</p>
                                    )}
                                    {selectedEntry.downloadFormat && (
                                        <p className="text-[11px] text-[color:var(--color-text-muted)]">Format: {selectedEntry.downloadFormat.toUpperCase()}</p>
                                    )}
                                </div>
                            </div>
                            {selectedEntry.summary && (
                                <div className="border-t border-[var(--color-border)] pt-3">
                                    <h5 className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-text-muted)] mb-1">
                                        Description
                                    </h5>
                                    <p className="text-xs text-[color:var(--color-text-secondary)] leading-relaxed whitespace-pre-line max-h-48 overflow-y-auto">
                                        {selectedEntry.summary}
                                    </p>
                                </div>
                            )}
                        </ModalBody>
                        <ModalFooter>
                            <button
                                onClick={() => setSelectedEntry(null)}
                                className="px-4 py-2 border border-[var(--color-border)] text-xs font-semibold text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                            >
                                Close
                            </button>
                            {selectedEntry.downloadUrl && (
                                <button
                                    onClick={() => {
                                        void handleDownload(selectedEntry);
                                        setSelectedEntry(null);
                                    }}
                                    className="px-4 py-2 bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] text-xs font-bold uppercase tracking-wider hover:opacity-90"
                                >
                                    Download & Import
                                </button>
                            )}
                        </ModalFooter>
                    </>
                )}
            </Modal>

            {/* Add Custom Catalog Modal */}
            <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)}>
                <form onSubmit={handleAddCatalogSubmit}>
                    <ModalHeader title="Add Custom OPDS Catalog" onClose={() => setIsAddModalOpen(false)} />
                    <ModalBody className="space-y-4">
                        <div>
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-text-muted)] mb-1.5">
                                Catalog Name
                            </label>
                            <input
                                type="text"
                                value={newCatalogTitle}
                                onChange={(e) => setNewCatalogTitle(e.target.value)}
                                placeholder="e.g. My Calibre Server"
                                className="w-full h-9 bg-[var(--color-surface)] border border-[var(--color-border)] px-3 text-xs text-[color:var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-text-muted)] mb-1.5">
                                OPDS Feed URL
                            </label>
                            <input
                                type="url"
                                value={newCatalogUrl}
                                onChange={(e) => setNewCatalogUrl(e.target.value)}
                                placeholder="http://192.168.1.100:8080/opds"
                                className="w-full h-9 bg-[var(--color-surface)] border border-[var(--color-border)] px-3 text-xs text-[color:var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
                                required
                            />
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button
                            type="button"
                            onClick={() => setIsAddModalOpen(false)}
                            className="px-4 py-2 border border-[var(--color-border)] text-xs font-semibold text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] text-xs font-bold uppercase tracking-wider hover:opacity-90"
                        >
                            Add Catalog
                        </button>
                    </ModalFooter>
                </form>
            </Modal>
        </div>
    );
}
