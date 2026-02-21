/**
 * Feeds Page
 * RSS feed subscription management and article browsing
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../../core";
import { useRssStore } from "../../core";
import type { RssFeed, RssArticle } from "../../core";
import {
    Rss, Plus, RefreshCw, Trash2, Loader2,
    ExternalLink, AlertCircle,
    LayoutTemplate, ArrowLeft, MoreHorizontal
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

function useTouchVisibleActions(): boolean {
    const [touchVisibleActions, setTouchVisibleActions] = useState(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return false;
        }
        return window.matchMedia("(hover: none), (pointer: coarse)").matches;
    });

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return;
        }

        const mediaQuery = window.matchMedia("(hover: none), (pointer: coarse)");
        const handleChange = () => setTouchVisibleActions(mediaQuery.matches);
        handleChange();

        if (typeof mediaQuery.addEventListener === "function") {
            mediaQuery.addEventListener("change", handleChange);
            return () => mediaQuery.removeEventListener("change", handleChange);
        }

        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
    }, []);

    return touchVisibleActions;
}

// ── Feed List Item ──

function FeedListItem({
    feed,
    isSelected,
    onSelect,
    onDelete,
    showTouchActions,
}: {
    feed: RssFeed;
    isSelected: boolean;
    onSelect: () => void;
    onDelete: () => void;
    showTouchActions: boolean;
}) {
    const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
    const actionMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!isActionMenuOpen) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (actionMenuRef.current?.contains(event.target as Node)) {
                return;
            }
            setIsActionMenuOpen(false);
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [isActionMenuOpen]);

    return (
        <div
            onClick={onSelect}
            className={cn(
                "group relative flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
                isSelected
                    ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)]"
                    : "hover:bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]",
                "active:bg-[var(--color-surface-muted)]"
            )}
        >
            {/* Feed Icon */}
            <div className={cn(
                "w-6 h-6 flex items-center justify-center flex-shrink-0 overlay",
                isSelected
                    ? "text-[color:var(--color-accent)]"
                    : "text-[color:var(--color-text-muted)]",
            )}>
                {feed.iconUrl ? (
                    <img
                        src={feed.iconUrl}
                        alt=""
                        className="w-4 h-4"
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
                    "text-[10px] font-bold px-1.5 py-0.5 flex-shrink-0",
                    isSelected
                        ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
                        : "bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)]",
                )}>
                    {feed.unreadCount}
                </span>
            )}

            <div ref={actionMenuRef} className="relative flex-shrink-0">
                <button
                    onClick={(event) => {
                        event.stopPropagation();
                        setIsActionMenuOpen((open) => !open);
                    }}
                    className={cn(
                        "p-1.5 transition-colors",
                        showTouchActions
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        isActionMenuOpen
                            ? "bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]"
                            : "text-[color:var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                    )}
                    title="Feed actions"
                    aria-label={`Actions for ${feed.title}`}
                    aria-expanded={isActionMenuOpen}
                >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                </button>

                {isActionMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 z-20 min-w-36 border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg">
                        <button
                            onClick={(event) => {
                                event.stopPropagation();
                                setIsActionMenuOpen(false);
                                onDelete();
                            }}
                            className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs font-medium text-[color:var(--color-error)] hover:bg-[var(--color-error)]/10"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Remove feed</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Article Card ──

function ArticleCard({
    article,
    feedTitle,
    onRead,
}: {
    article: RssArticle;
    feedTitle?: string;
    onRead: () => void;
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
                "group p-4 sm:p-5 border transition-all duration-200 cursor-pointer",
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
                        {article.url && (
                            <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors"
                            >
                                <ExternalLink className="w-3.5 h-3.5" />
                                <span>Original</span>
                            </a>
                        )}
                    </div>
                </div>

                {/* Thumbnail */}
                {article.imageUrl && (
                    <div className="hidden sm:block w-24 h-24 flex-shrink-0 overflow-hidden bg-[var(--color-surface-muted)] border border-[var(--color-border)]">
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
        <div className="mx-auto w-full max-w-[26rem] min-w-0 px-4 sm:px-6 flex flex-col items-center justify-center py-20 text-center animate-fade-in">
            <div className="mb-5 inline-flex h-16 w-16 items-center justify-center border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]">
                <Rss className="w-6 h-6" />
            </div>
            <h2 className="w-full break-words text-balance text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                Your Feed Reader
            </h2>
            <p className="mx-auto w-full max-w-[24rem] break-words text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
                Subscribe to your favorite blogs, news sites, and newsletters to read them right here in Theorem.
            </p>
            <button
                onClick={onAddFeed}
                className={cn(
                    "min-w-[10.5rem] whitespace-nowrap flex items-center gap-2 px-6 py-2.5",
                    "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] text-sm font-medium",
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
        <div className="mx-auto w-full max-w-[26rem] min-w-0 px-4 sm:px-6 flex flex-col items-center justify-center py-24 text-center animate-fade-in">
            <div className="mb-5 inline-flex h-16 w-16 items-center justify-center border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]">
                <LayoutTemplate className="w-6 h-6" />
            </div>
            <h3 className="w-full break-words text-balance text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                No Articles Yet
            </h3>
            <p className="mx-auto w-full max-w-[24rem] break-words text-[color:var(--color-text-muted)] text-sm leading-relaxed">
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
    const showTouchActions = useTouchVisibleActions();
    const feedListScrollRef = useRef<HTMLDivElement | null>(null);
    const articleListScrollRef = useRef<HTMLDivElement | null>(null);

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

    const feedListRows = useMemo(
        () => [{ kind: "all" as const }, ...feeds.map((feed) => ({ kind: "feed" as const, feed }))],
        [feeds],
    );

    const feedVirtualizer = useVirtualizer({
        count: feedListRows.length,
        getScrollElement: () => feedListScrollRef.current,
        estimateSize: () => 46,
        overscan: 10,
        getItemKey: (index) => (
            index === 0
                ? "all-articles"
                : feedListRows[index]?.kind === "feed"
                    ? feedListRows[index].feed.id
                    : String(index)
        ),
    });

    const articleVirtualItemCount = displayedArticles.length > 0
        ? displayedArticles.length + 1
        : 0;
    const articleVirtualizer = useVirtualizer({
        count: articleVirtualItemCount,
        getScrollElement: () => articleListScrollRef.current,
        estimateSize: () => 212,
        overscan: 6,
        getItemKey: (index) => (
            index === displayedArticles.length
                ? "end-of-list"
                : displayedArticles[index]?.id ?? String(index)
        ),
        measureElement: (element) => element?.getBoundingClientRect().height ?? 212,
    });

    useEffect(() => {
        feedVirtualizer.measure();
    }, [feedVirtualizer, feedListRows.length, showMobileList]);

    useEffect(() => {
        articleVirtualizer.measure();
    }, [articleVirtualizer, displayedArticles.length, selectedFeedId, showMobileList]);

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
            <div className="mx-auto min-h-full w-full max-w-[var(--layout-content-max-width)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 animate-fade-in">
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
                        className="p-1.5 text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] transition-colors"
                        title="Add Feed"
                    >
                        <Plus className="w-4 h-4" />
                    </button>
                </div>

                {/* Feed List */}
                <div ref={feedListScrollRef} className="flex-1 overflow-y-auto">
                    <div className="p-2">
                        <div
                            className="relative w-full"
                            style={{ height: `${feedVirtualizer.getTotalSize()}px` }}
                        >
                            {feedVirtualizer.getVirtualItems().map((virtualRow) => {
                                const row = feedListRows[virtualRow.index];
                                if (!row) {
                                    return null;
                                }

                                return (
                                    <div
                                        key={virtualRow.key}
                                        ref={feedVirtualizer.measureElement}
                                        data-index={virtualRow.index}
                                        className="absolute left-0 top-0 w-full pb-1"
                                        style={{
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}
                                    >
                                        {row.kind === "all" ? (
                                            <button
                                                onClick={() => handleSelectFeed(null)}
                                                className={cn(
                                                    "w-full flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
                                                    selectedFeedId === null
                                                        ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)]"
                                                        : "hover:bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]",
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-6 h-6 flex items-center justify-center transition-colors",
                                                    selectedFeedId === null
                                                        ? "text-[color:var(--color-accent)]"
                                                        : "text-[color:var(--color-text-muted)]",
                                                )}>
                                                    <LayoutTemplate className="w-4 h-4" />
                                                </div>
                                                <span className="text-sm font-medium">All Articles</span>
                                            </button>
                                        ) : (
                                            <FeedListItem
                                                feed={row.feed}
                                                isSelected={selectedFeedId === row.feed.id}
                                                onSelect={() => handleSelectFeed(row.feed.id)}
                                                onDelete={() => handleDeleteFeed(row.feed.id)}
                                                showTouchActions={showTouchActions}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
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
                            className="md:hidden -ml-2 p-1.5 text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>

                        <div>
                            <h1 className="m-0 font-sans text-[1.45rem] font-semibold uppercase tracking-[0.12em] leading-[1.1] text-[color:var(--color-text-primary)] sm:text-[1.6rem] truncate">
                                {selectedFeed ? selectedFeed.title : "All Articles"}
                            </h1>
                            <p className="mt-1 text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
                                {displayedArticles.length} articles
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={handleRefreshAll}
                        disabled={isRefreshing}
                        className={cn(
                            "ui-btn",
                            "disabled:opacity-50",
                        )}
                        title="Refresh feeds"
                    >
                        <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </header>

                {/* Scrollable Article List */}
                <div ref={articleListScrollRef} className="flex-1 overflow-y-auto">
                    {isLoading && feeds.length === 0 ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="w-6 h-6 animate-spin text-[color:var(--color-text-muted)]" />
                        </div>
                    ) : displayedArticles.length === 0 ? (
                        <EmptyArticles feedTitle={selectedFeed?.title} />
                    ) : (
                        <div className="p-4 sm:p-6">
                            <div className="mx-auto max-w-6xl">
                                <div
                                    className="relative w-full"
                                    style={{ height: `${articleVirtualizer.getTotalSize()}px` }}
                                >
                                    {articleVirtualizer.getVirtualItems().map((virtualRow) => {
                                        const article = displayedArticles[virtualRow.index];
                                        const style = { transform: `translateY(${virtualRow.start}px)` };

                                        if (!article) {
                                            return (
                                                <div
                                                    key={virtualRow.key}
                                                    ref={articleVirtualizer.measureElement}
                                                    data-index={virtualRow.index}
                                                    className="absolute left-0 top-0 w-full py-8 text-center text-sm text-[color:var(--color-text-muted)]"
                                                    style={style}
                                                >
                                                    You've reached the end of the list.
                                                </div>
                                            );
                                        }

                                        return (
                                            <div
                                                key={article.id}
                                                ref={articleVirtualizer.measureElement}
                                                data-index={virtualRow.index}
                                                className="absolute left-0 top-0 w-full pb-4"
                                                style={style}
                                            >
                                                <ArticleCard
                                                    article={article}
                                                    feedTitle={!selectedFeedId ? feedTitleById.get(article.feedId) : undefined}
                                                    onRead={() => openArticleInReader(article)}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Error Toast */}
            {error && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-[var(--color-error)] text-[color:var(--color-text-inverse)] text-sm font-medium shadow-xl animate-fade-in-up">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{error}</span>
                    <button onClick={() => setError(undefined)} className="ml-2 p-0.5 hover:bg-white/20">✕</button>
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
