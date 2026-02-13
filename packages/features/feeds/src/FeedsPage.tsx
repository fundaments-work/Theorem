/**
 * Feeds Page
 * RSS feed subscription management and article browsing
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { cn } from "@theorem/core";
import { useRssStore } from "@theorem/core";
import type { RssFeed, RssArticle } from "@theorem/core";
import {
    Rss, Plus, RefreshCw, Trash2, Loader2,
    ExternalLink, Heart, Clock, ChevronRight,
    AlertCircle, Globe, LayoutTemplate, ArrowLeft
} from "lucide-react";
import { AddFeedModal } from "./AddFeedModal";

// ── Helper ──

const FEEDS_SELECTED_FEED_STORAGE_KEY = "theorem-feeds:selected-feed-id";
const FEEDS_MOBILE_LIST_STORAGE_KEY = "theorem-feeds:show-mobile-list";

function formatArticleDate(date: Date | string | undefined): string {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function stripHtml(html: string): string {
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
}

// ── Feed List Item ──

function FeedListItem({
    feed,
    isSelected,
    onSelect,
    onDelete,
}: {
    feed: RssFeed;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
}) {
    return (
        <div
            onClick={onSelect}
            className={cn(
                "group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                isSelected
                    ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)]"
                    : "hover:bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]",
                "active:bg-[var(--color-surface-muted)]"
            )}
        >
            {/* Feed Icon */}
            <div className={cn(
                "w-6 h-6 rounded flex items-center justify-center flex-shrink-0 overlay",
                isSelected
                    ? "text-[color:var(--color-accent)]"
                    : "text-[color:var(--color-text-muted)]",
            )}>
                {feed.iconUrl ? (
                    <img
                        src={feed.iconUrl}
                        alt=""
                        className="w-4 h-4 rounded-sm"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                ) : (
                    <Rss className="w-4 h-4" />
                )}
            </div>

            {/* Feed Info */}
            <div className="flex-1 min-w-0">
                <p className={cn(
                    "text-sm font-medium truncate",
                )}>
                    {feed.title}
                </p>
            </div>

            {/* Unread badge */}
            {feed.unreadCount > 0 && (
                <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0",
                    isSelected
                        ? "bg-[var(--color-accent)] ui-text-accent-contrast"
                        : "bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)]",
                )}>
                    {feed.unreadCount}
                </span>
            )}

            {/* Delete button (on hover) or always on mobile? Interaction is touch, so hover fails. 
                Maybe add a swipe action or a separate menu. For now sticking to hover for desktop consistency, 
                and maybe long-press? Or explicit delete mode (later). */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                }}
                className="opacity-0 group-hover:opacity-100 p-2 rounded hover:bg-[var(--color-error)]/10 transition-all flex-shrink-0"
                title="Remove feed"
            >
                <Trash2 className="w-3.5 h-3.5 text-[color:var(--color-error)]" />
            </button>
        </div>
    );
}

// ── Article Card ──

function ArticleCard({
    article,
    feedTitle,
    onRead,
    onToggleFavorite,
}: {
    article: RssArticle;
    feedTitle?: string;
    onRead: () => void;
    onToggleFavorite: () => void;
}) {
    const summary = useMemo(() => {
        const text = article.summary || article.content;
        return stripHtml(text).substring(0, 200);
    }, [article.summary, article.content]);

    const dateStr = formatArticleDate(article.publishedAt ?? article.fetchedAt);

    return (
        <div
            onClick={onRead}
            className={cn(
                "group p-4 sm:p-5 rounded-2xl border transition-all duration-200 cursor-pointer",
                article.isRead
                    ? "border-transparent bg-[var(--color-surface-muted)]/30 opacity-70 hover:opacity-100"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/30 hover:shadow-sm",
                "active:scale-[0.99]"
            )}
        >
            <div className="flex gap-4 sm:gap-5">
                {/* Article Content */}
                <div className="flex-1 min-w-0">
                    {/* Meta line */}
                    <div className="flex items-center gap-2 mb-2">
                        {feedTitle && (
                            <span className="text-[10px] uppercase font-bold tracking-wider text-[color:var(--color-accent)]">
                                {feedTitle}
                            </span>
                        )}
                        {dateStr && (
                            <>
                                <span className="text-[color:var(--color-text-muted)] text-[10px]">•</span>
                                <span className="text-[10px] font-medium text-[color:var(--color-text-muted)] flex items-center gap-1 uppercase tracking-wide">
                                    {dateStr}
                                </span>
                            </>
                        )}
                    </div>

                    {/* Title */}
                    <h3 className={cn(
                        "text-base font-semibold line-clamp-2 mb-2 leading-tight",
                        article.isRead
                            ? "text-[color:var(--color-text-secondary)]"
                            : "text-[color:var(--color-text-primary)]",
                    )}>
                        {article.title}
                    </h3>

                    {/* Summary */}
                    {summary && (
                        <p className="text-sm text-[color:var(--color-text-muted)] line-clamp-2 leading-relaxed">
                            {summary}
                        </p>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-4">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite();
                            }}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                                article.isFavorite
                                    ? "text-[color:var(--color-accent)] bg-[var(--color-accent)]/10"
                                    : "text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                            )}
                        >
                            <Heart className={cn("w-3.5 h-3.5", article.isFavorite && "fill-current")} />
                            <span>Favorite</span>
                        </button>

                        {article.url && (
                            <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Original</span>
                            </a>
                        )}
                    </div>
                </div>

                {/* Thumbnail */}
                {article.imageUrl && (
                    <div className="hidden sm:block w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden bg-[var(--color-surface-muted)] border border-[var(--color-border)]">
                        <img
                            src={article.imageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                                (e.target as HTMLImageElement).parentElement!.style.display = 'none';
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Empty States ──

function EmptyFeeds({ onAddFeed }: { onAddFeed: () => void }) {
    return (
        <div className="ui-empty-state-stack px-4 sm:px-6 flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="ui-empty-icon">
                <Rss className="w-6 h-6" />
            </div>
            <h2 className="ui-empty-state-title text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                Your Feed Reader
            </h2>
            <p className="ui-empty-state-copy text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
                Subscribe to your favorite blogs, news sites, and newsletters to read them right here in Theorem.
            </p>
            <button
                onClick={onAddFeed}
                className={cn(
                    "ui-empty-state-action flex items-center gap-2 px-6 py-2.5 rounded-full",
                    "bg-[var(--color-accent)] ui-text-accent-contrast text-sm font-medium",
                    "hover:opacity-90 transition-opacity shadow-sm",
                )}
            >
                <Plus className="w-4 h-4" />
                <span>Add First Feed</span>
            </button>
        </div>
    );
}

function EmptyArticles({ feedTitle }: { feedTitle?: string }) {
    return (
        <div className="ui-empty-state-stack px-4 sm:px-6 flex flex-col items-center justify-center py-24 text-center animate-fade-in">
            <div className="ui-empty-icon">
                <LayoutTemplate className="w-6 h-6" />
            </div>
            <h3 className="ui-empty-state-title text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                No Articles Yet
            </h3>
            <p className="ui-empty-state-copy text-[color:var(--color-text-muted)] text-sm leading-relaxed">
                {feedTitle ? `We couldn't find any new articles for "${feedTitle}".` : "Select a feed from the sidebar to start reading."}
            </p>
        </div>
    );
}

// ── Main Page ──

export function FeedsPage() {
    const feeds = useRssStore((s) => s.feeds);
    const articles = useRssStore((s) => s.articles);
    const isLoading = useRssStore((s) => s.isLoading);
    const error = useRssStore((s) => s.error);
    const addFeed = useRssStore((s) => s.addFeed);
    const removeFeed = useRssStore((s) => s.removeFeed);
    const refreshAll = useRssStore((s) => s.refreshAll);
    const getArticlesForFeed = useRssStore((s) => s.getArticlesForFeed);
    const getAllArticles = useRssStore((s) => s.getAllArticles);
    const openArticleInReader = useRssStore((s) => s.openArticleInReader);
    const toggleArticleFavorite = useRssStore((s) => s.toggleArticleFavorite);
    const setError = useRssStore((s) => s.setError);

    const [selectedFeedId, setSelectedFeedId] = useState<string | null>(() => {
        if (typeof window === "undefined") {
            return null;
        }
        const value = window.sessionStorage.getItem(FEEDS_SELECTED_FEED_STORAGE_KEY);
        return value && value.trim().length > 0 ? value : null;
    });
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Mobile View State: 'feeds' (sidebar) or 'articles' (content)
    const [showMobileList, setShowMobileList] = useState(() => {
        if (typeof window === "undefined") {
            return true;
        }
        return window.sessionStorage.getItem(FEEDS_MOBILE_LIST_STORAGE_KEY) !== "false";
    });

    const selectedFeed = selectedFeedId ? feeds.find(f => f.id === selectedFeedId) : null;

    useEffect(() => {
        if (selectedFeedId && !feeds.some((feed) => feed.id === selectedFeedId)) {
            setSelectedFeedId(null);
        }
    }, [feeds, selectedFeedId]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }

        if (selectedFeedId) {
            window.sessionStorage.setItem(FEEDS_SELECTED_FEED_STORAGE_KEY, selectedFeedId);
            return;
        }

        window.sessionStorage.removeItem(FEEDS_SELECTED_FEED_STORAGE_KEY);
    }, [selectedFeedId]);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        window.sessionStorage.setItem(
            FEEDS_MOBILE_LIST_STORAGE_KEY,
            showMobileList ? "true" : "false",
        );
    }, [showMobileList]);

    const displayedArticles = useMemo(() => {
        if (selectedFeedId) {
            return getArticlesForFeed(selectedFeedId);
        }
        return getAllArticles();
    }, [selectedFeedId, articles, getArticlesForFeed, getAllArticles]);

    // Feed title lookup for article cards
    const feedTitleById = useMemo(() => {
        const map = new Map<string, string>();
        for (const feed of feeds) {
            map.set(feed.id, feed.title);
        }
        return map;
    }, [feeds]);

    const handleAddFeed = useCallback(async (url: string) => {
        try {
            const result = await addFeed(url);
            if (result) {
                setIsAddModalOpen(false);
                setSelectedFeedId(result.id);
                setShowMobileList(false); // Switch to articles view on mobile
            }
        } catch (e) {
            // Error handling in store
        }
    }, [addFeed]);

    const handleSelectFeed = useCallback((id: string | null) => {
        setSelectedFeedId(id);
        setShowMobileList(false); // Switch to articles view on mobile
    }, []);

    const handleRefreshAll = useCallback(async () => {
        setIsRefreshing(true);
        await refreshAll();
        setIsRefreshing(false);
    }, [refreshAll]);

    const handleDeleteFeed = useCallback((feedId: string) => {
        if (selectedFeedId === feedId) {
            setSelectedFeedId(null);
            setShowMobileList(true); // Go back to list if current feed deleted
        }
        removeFeed(feedId);
    }, [removeFeed, selectedFeedId]);

    // Back handler for mobile
    const handleBackToFeeds = () => {
        setShowMobileList(true);
    };

    // Initial Empty State
    if (feeds.length === 0 && !isLoading) {
        return (
            <div className="ui-page animate-fade-in">
                <EmptyFeeds onAddFeed={() => setIsAddModalOpen(true)} />
                <AddFeedModal
                    isOpen={isAddModalOpen}
                    onClose={() => { setIsAddModalOpen(false); setError(undefined); }}
                    onSubmit={handleAddFeed}
                    isLoading={isLoading}
                    error={error}
                />
            </div>
        );
    }

    return (
        <div className="h-full w-full flex overflow-hidden bg-[var(--color-background)]">
            {/* Left Sidebar: Feed List */}
            {/* Functional check: show if desktop OR (mobile and showMobileList is true) */}
            <div className={cn(
                "flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]/50",
                "h-full flex-shrink-0 transition-all duration-300",
                // Mobile: full width if visible, else hidden
                showMobileList ? "flex w-full" : "hidden",
                // Desktop: always flex, fixed width
                "md:flex md:w-64"
            )}>
                {/* Sidebar Header (Simplified) */}
                <div className="px-4 pt-8 pb-4 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">
                        Subscriptions
                    </h2>
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="p-1.5 rounded-lg text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors"
                        title="Add Feed"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                {/* Feed List */}
                <div className="flex-1 overflow-y-auto p-2">
                    <button
                        onClick={() => handleSelectFeed(null)}
                        className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors mb-2",
                            selectedFeedId === null
                                ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)]"
                                : "hover:bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]",
                        )}
                    >
                        <div className={cn(
                            "w-6 h-6 rounded flex items-center justify-center transition-colors",
                            selectedFeedId === null
                                ? "text-[color:var(--color-accent)]"
                                : "text-[color:var(--color-text-muted)]",
                        )}>
                            <LayoutTemplate className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-medium">All Articles</span>
                    </button>


                    <div className="space-y-0.5">
                        {feeds.map(feed => (
                            <FeedListItem
                                key={feed.id}
                                feed={feed}
                                isSelected={selectedFeedId === feed.id}
                                onSelect={() => handleSelectFeed(feed.id)}
                                onDelete={() => handleDeleteFeed(feed.id)}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Content: Articles */}
            {/* Functional check: show if desktop OR (mobile and showMobileList is false) */}
            <div className={cn(
                "flex-col min-w-0 bg-[var(--color-background)]",
                "h-full flex-1 transition-all duration-300",
                // Mobile: full width if visible, else hidden
                !showMobileList ? "flex" : "hidden",
                // Desktop: always flex
                "md:flex"
            )}>
                {/* Page Header Area */}
                <header className="shrink-0 px-6 pt-8 pb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                        {/* Mobile Back Button */}
                        <button
                            onClick={handleBackToFeeds}
                            className="md:hidden -ml-2 p-1.5 rounded-lg text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>

                        <div>
                            <h1 className="ui-page-title truncate">
                                {selectedFeed ? selectedFeed.title : "All Articles"}
                            </h1>
                            {!selectedFeed && (
                                <p className="ui-page-subtitle">
                                    {displayedArticles.length} articles
                                </p>
                            )}
                            {selectedFeed && (
                                <p className="ui-page-subtitle">
                                    {selectedFeed.url}
                                </p>
                            )}
                        </div>
                    </div>

                    <button
                        onClick={handleRefreshAll}
                        disabled={isRefreshing}
                        className={cn(
                            "ui-btn ui-btn-secondary",
                            "disabled:opacity-50",
                        )}
                        title="Refresh feeds"
                    >
                        <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </header>

                {/* Scrollable Article List */}
                <div className="flex-1 overflow-y-auto">
                    {isLoading && feeds.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-6 h-6 animate-spin text-[color:var(--color-text-muted)]" />
                        </div>
                    ) : displayedArticles.length === 0 ? (
                        <EmptyArticles feedTitle={selectedFeed?.title} />
                    ) : (
                        <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
                            {displayedArticles.map(article => (
                                <ArticleCard
                                    key={article.id}
                                    article={article}
                                    feedTitle={!selectedFeedId ? feedTitleById.get(article.feedId) : undefined}
                                    onRead={() => openArticleInReader(article)}
                                    onToggleFavorite={() => toggleArticleFavorite(article.id)}
                                />
                            ))}

                            <div className="py-8 text-center text-sm text-[color:var(--color-text-muted)]">
                                You've reached the end of the list.
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Error Toast */}
            {error && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 rounded-xl bg-[var(--color-error)] text-white text-sm font-medium shadow-xl animate-fade-in-up">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                    <button onClick={() => setError(undefined)} className="ml-2 p-0.5 hover:bg-white/20 rounded">✕</button>
                </div>
            )}

            <AddFeedModal
                isOpen={isAddModalOpen}
                onClose={() => { setIsAddModalOpen(false); setError(undefined); }}
                onSubmit={handleAddFeed}
                isLoading={isLoading}
                error={error}
            />
        </div>
    );
}
