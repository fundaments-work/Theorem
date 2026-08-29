import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ArrowLeft,
    BookOpen,
    ChevronRight,
    Download,
    Folder,
    Globe,
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
    const removeCatalog = useOpdsStore((state) => state.removeCatalog);

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
            console.error("Feed load error:", err);
            setError("Could not load catalog. Please check your internet connection or URL.");
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
                toast.error("Could not find results for that query.");
            } finally {
                setIsSearching(false);
            }
        }
    };

    const handleDownload = async (entry: OpdsEntry) => {
        setDownloadingEntryId(entry.id);
        const toastId = toast.loading(`Adding "${entry.title}" to library…`);
        try {
            await OpdsService.downloadAndImportBook(entry, (msg) => {
                toast.loading(msg, { id: toastId });
            });
            toast.success(`"${entry.title}" added to Library`, {
                id: toastId,
                action: {
                    label: "View Library",
                    onClick: () => setRoute("library"),
                },
            });
        } catch (err: any) {
            toast.error(err.message || "Failed to download book", { id: toastId });
        } finally {
            setDownloadingEntryId(null);
        }
    };

    const handleAddCatalogSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCatalogTitle.trim() || !newCatalogUrl.trim()) return;

        let cleanUrl = newCatalogUrl.trim();
        if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
            cleanUrl = `https://${cleanUrl}`;
        }

        addCatalog({
            title: newCatalogTitle.trim(),
            url: cleanUrl,
        });

        setIsAddModalOpen(false);
        setNewCatalogTitle("");
        setNewCatalogUrl("");
        toast.success(`Added "${newCatalogTitle}" catalog`);
    };

    const navigationEntries = useMemo(() => {
        return feed?.entries.filter((e) => e.isNavigation) || [];
    }, [feed]);

    const bookEntries = useMemo(() => {
        return feed?.entries.filter((e) => !e.isNavigation) || [];
    }, [feed]);

    return (
        <div className="flex flex-col min-h-full px-4 sm:px-6 md:px-8 py-6 space-y-6 max-w-7xl mx-auto w-full">
            {/* Header & Catalog Tabs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-border)] pb-5">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[color:var(--color-text-primary)]">
                        Catalogs
                    </h1>
                    <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
                        Browse and download free books directly into your library.
                    </p>
                </div>

                {/* Catalog Pills Selector */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                    {catalogs.map((catalog) => {
                        const isActive = activeCatalog?.id === catalog.id;
                        return (
                            <div key={catalog.id} className="relative group shrink-0">
                                <button
                                    onClick={() => setActiveCatalog(catalog.id)}
                                    className={cn(
                                        "px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5",
                                        isActive
                                            ? "bg-[var(--color-text-primary)] text-[var(--color-background)]"
                                            : "bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-border)] hover:text-[color:var(--color-text-primary)]"
                                    )}
                                >
                                    <Globe className="h-3 w-3" />
                                    <span>{catalog.title}</span>
                                </button>
                                {!catalog.isPreset && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeCatalog(catalog.id);
                                            toast.success("Catalog removed");
                                        }}
                                        className="hidden group-hover:flex absolute -top-1 -right-1 h-4 w-4 bg-zinc-800 text-white rounded-full items-center justify-center text-[9px] hover:bg-red-600"
                                        title="Remove catalog"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                )}
                            </div>
                        );
                    })}

                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="px-3 py-1.5 rounded-full border border-dashed border-[var(--color-border)] text-xs font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] hover:border-[var(--color-text-secondary)] flex items-center gap-1 shrink-0"
                    >
                        <Plus className="h-3 w-3" />
                        <span>Add Library</span>
                    </button>
                </div>
            </div>

            {/* Navigation & Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    {feedHistory.length > 0 && (
                        <button
                            onClick={navigateBack}
                            className="p-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors shrink-0"
                            aria-label="Back"
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </button>
                    )}
                    <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)] truncate">
                        {feed?.title || activeCatalog?.title || "Catalog"}
                    </h2>
                </div>

                {feed?.searchUrlTemplate && (
                    <form onSubmit={handleSearch} className="relative sm:w-72 md:w-80 shrink-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[color:var(--color-text-muted)]" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search books or authors…"
                            className="w-full h-8 pl-8 pr-7 text-xs bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[color:var(--color-text-primary)] placeholder-[color:var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]"
                        />
                        {searchQuery && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchQuery("");
                                    if (targetUrl) void loadFeed(targetUrl);
                                }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </form>
                )}
            </div>

            {/* Main Content Area */}
            {isLoading || isSearching ? (
                <div className="flex flex-col items-center justify-center py-20">
                    <PageLoader message="Loading books…" />
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 bg-[var(--color-surface-muted)] rounded-xl border border-[var(--color-border)] p-6">
                    <Globe className="h-8 w-8 text-[color:var(--color-text-muted)]" />
                    <p className="text-xs text-[color:var(--color-text-muted)] max-w-sm">{error}</p>
                    <button
                        onClick={() => targetUrl && void loadFeed(targetUrl)}
                        className="mt-2 px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] text-xs font-semibold rounded-md hover:bg-[var(--color-surface-muted)] flex items-center gap-1.5"
                    >
                        <RefreshCw className="h-3 w-3" />
                        <span>Try Again</span>
                    </button>
                </div>
            ) : (
                <div className="space-y-8">
                    {/* Category / Sub-feed Tiles */}
                    {navigationEntries.length > 0 && (
                        <div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {navigationEntries.map((entry) => (
                                    <button
                                        key={entry.id}
                                        onClick={() => {
                                            if (entry.navUrl) navigateToFeed(entry.navUrl);
                                        }}
                                        className="flex items-center justify-between p-3.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-muted)] text-left transition-colors group"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="h-8 w-8 rounded bg-[var(--color-surface-muted)] flex items-center justify-center shrink-0 group-hover:bg-[var(--color-border)]">
                                                <Folder className="h-4 w-4 text-[color:var(--color-text-secondary)]" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-xs font-semibold text-[color:var(--color-text-primary)] truncate">
                                                    {entry.title}
                                                </div>
                                                {entry.summary && (
                                                    <div className="text-[11px] text-[color:var(--color-text-muted)] truncate mt-0.5">
                                                        {entry.summary}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <ChevronRight className="h-4 w-4 text-[color:var(--color-text-muted)] group-hover:text-[color:var(--color-text-primary)] shrink-0 ml-2" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Book Cards Grid */}
                    {bookEntries.length > 0 ? (
                        <div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                {bookEntries.map((entry) => {
                                    const isDownloading = downloadingEntryId === entry.id;
                                    return (
                                        <div
                                            key={entry.id}
                                            onClick={() => {
                                                if (entry.navUrl && !entry.downloadUrl) {
                                                    navigateToFeed(entry.navUrl);
                                                } else {
                                                    setSelectedEntry(entry);
                                                }
                                            }}
                                            className="group flex flex-col cursor-pointer"
                                        >
                                            {/* Cover Container */}
                                            <div className="relative aspect-[2/3] w-full rounded-md overflow-hidden bg-[var(--color-surface-muted)] border border-[var(--color-border)] shadow-sm group-hover:shadow-md transition-shadow">
                                                {entry.coverUrl || entry.thumbnailUrl ? (
                                                    <img
                                                        src={entry.thumbnailUrl || entry.coverUrl}
                                                        alt={entry.title}
                                                        loading="lazy"
                                                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-200"
                                                    />
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center h-full w-full p-3 text-center bg-[var(--color-surface-muted)]">
                                                        <BookOpen className="h-6 w-6 text-[color:var(--color-text-muted)] mb-1.5" />
                                                        <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-text-secondary)] line-clamp-3">
                                                            {entry.title}
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Download Button Overlay */}
                                                {(entry.downloadUrl || entry.navUrl) && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            void handleDownload(entry);
                                                        }}
                                                        disabled={isDownloading}
                                                        className="absolute bottom-2 right-2 p-2 rounded-full bg-black/80 text-white hover:bg-black shadow-md transition-transform transform active:scale-95 disabled:opacity-50"
                                                        title="Add to Library"
                                                        aria-label="Add to Library"
                                                    >
                                                        {isDownloading ? (
                                                            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                                        ) : (
                                                            <Download className="h-3.5 w-3.5" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>

                                            {/* Title & Author */}
                                            <div className="mt-2 flex flex-col min-w-0">
                                                <h3 className="text-xs font-semibold text-[color:var(--color-text-primary)] truncate group-hover:text-[color:var(--color-accent)] transition-colors">
                                                    {entry.title}
                                                </h3>
                                                <p className="text-[11px] text-[color:var(--color-text-muted)] truncate mt-0.5">
                                                    {entry.author || "Public Domain"}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : navigationEntries.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                            <BookOpen className="h-8 w-8 text-[color:var(--color-text-muted)]" />
                            <p className="text-xs font-medium text-[color:var(--color-text-secondary)]">No books found in this catalog.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Book Details Modal */}
            <Modal isOpen={!!selectedEntry} onClose={() => setSelectedEntry(null)}>
                {selectedEntry && (
                    <>
                        <ModalHeader title={selectedEntry.title} onClose={() => setSelectedEntry(null)} />
                        <ModalBody className="space-y-4">
                            <div className="flex flex-col sm:flex-row gap-4">
                                {selectedEntry.coverUrl && (
                                    <div className="aspect-[2/3] w-24 shrink-0 bg-[var(--color-surface-muted)] overflow-hidden rounded border border-[var(--color-border)]">
                                        <img src={selectedEntry.coverUrl} alt={selectedEntry.title} className="h-full w-full object-cover" />
                                    </div>
                                )}
                                <div className="flex flex-col gap-1 min-w-0">
                                    <h4 className="text-sm font-bold text-[color:var(--color-text-primary)]">{selectedEntry.title}</h4>
                                    <p className="text-xs text-[color:var(--color-text-secondary)] font-medium">{selectedEntry.author || "Public Domain"}</p>
                                    {selectedEntry.publisher && (
                                        <p className="text-[11px] text-[color:var(--color-text-muted)]">Source: {selectedEntry.publisher}</p>
                                    )}
                                </div>
                            </div>
                            {selectedEntry.summary && (
                                <div className="border-t border-[var(--color-border)] pt-3">
                                    <p className="text-xs text-[color:var(--color-text-secondary)] leading-relaxed whitespace-pre-line max-h-48 overflow-y-auto">
                                        {selectedEntry.summary}
                                    </p>
                                </div>
                            )}
                        </ModalBody>
                        <ModalFooter>
                            <button
                                onClick={() => setSelectedEntry(null)}
                                className="px-4 py-2 border border-[var(--color-border)] text-xs font-semibold text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] rounded"
                            >
                                Close
                            </button>
                            {(selectedEntry.downloadUrl || selectedEntry.navUrl) && (
                                <button
                                    onClick={() => {
                                        void handleDownload(selectedEntry);
                                        setSelectedEntry(null);
                                    }}
                                    className="px-4 py-2 bg-[var(--color-text-primary)] text-[var(--color-background)] text-xs font-bold rounded hover:opacity-90 flex items-center gap-1.5"
                                >
                                    <Download className="h-3 w-3" />
                                    <span>Add to Library</span>
                                </button>
                            )}
                        </ModalFooter>
                    </>
                )}
            </Modal>

            {/* Add Custom Library Modal */}
            <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)}>
                <form onSubmit={handleAddCatalogSubmit}>
                    <ModalHeader title="Add Custom Library" onClose={() => setIsAddModalOpen(false)} />
                    <ModalBody className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-[color:var(--color-text-secondary)] mb-1.5">
                                Library Name
                            </label>
                            <input
                                type="text"
                                value={newCatalogTitle}
                                onChange={(e) => setNewCatalogTitle(e.target.value)}
                                placeholder="e.g. My Calibre Server"
                                className="w-full h-9 bg-[var(--color-surface)] border border-[var(--color-border)] px-3 text-xs text-[color:var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-accent)]"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[color:var(--color-text-secondary)] mb-1.5">
                                Catalog URL
                            </label>
                            <input
                                type="text"
                                value={newCatalogUrl}
                                onChange={(e) => setNewCatalogUrl(e.target.value)}
                                placeholder="http://192.168.1.100:8080/opds"
                                className="w-full h-9 bg-[var(--color-surface)] border border-[var(--color-border)] px-3 text-xs text-[color:var(--color-text-primary)] rounded focus:outline-none focus:border-[var(--color-accent)]"
                                required
                            />
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <button
                            type="button"
                            onClick={() => setIsAddModalOpen(false)}
                            className="px-4 py-2 border border-[var(--color-border)] text-xs font-medium text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] rounded"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-[var(--color-text-primary)] text-[var(--color-background)] text-xs font-bold rounded hover:opacity-90"
                        >
                            Add Library
                        </button>
                    </ModalFooter>
                </form>
            </Modal>
        </div>
    );
}
