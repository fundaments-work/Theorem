import { useMemo, useState } from "react";
import { Bookmark, ExternalLink, Heart, Highlighter, Trash2, X } from "lucide-react";
import { cn } from "@theorem/core";
import { FloatingPanel } from "@theorem/ui";
import type { ArticleHighlight, ArticleScrollBookmark } from "./types";

interface ArticleReaderHighlightsPanelProps {
    visible: boolean;
    bookmarks: ArticleScrollBookmark[];
    highlights: ArticleHighlight[];
    articleUrl?: string;
    isFavorite: boolean;
    onToggleFavorite?: () => void;
    onJumpToBookmark: (bookmarkId: string) => void;
    onDeleteBookmark: (bookmarkId: string) => void;
    onJumpToHighlight: (highlightId: string) => void;
    onDeleteHighlight: (highlightId: string) => void;
    onClose: () => void;
}

export function ArticleReaderHighlightsPanel({
    visible,
    bookmarks,
    highlights,
    articleUrl,
    isFavorite,
    onToggleFavorite,
    onJumpToBookmark,
    onDeleteBookmark,
    onJumpToHighlight,
    onDeleteHighlight,
    onClose,
}: ArticleReaderHighlightsPanelProps) {
    const [activeTab, setActiveTab] = useState<"bookmarks" | "highlights">("bookmarks");
    const hasItems = useMemo(
        () => (activeTab === "bookmarks" ? bookmarks.length > 0 : highlights.length > 0),
        [activeTab, bookmarks.length, highlights.length],
    );

    return (
        <FloatingPanel visible={visible} className="overflow-hidden">
            <div className="reader-panel-header px-4 pt-4 pb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Bookmark className="w-4 h-4 text-[color:var(--color-accent)]" />
                    <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">Bookmarks & Highlights</h2>
                </div>
                <button
                    onClick={onClose}
                    className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80"
                    title="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-4 border-b border-[var(--color-border-subtle)] space-y-2">
                {onToggleFavorite && (
                    <button
                        onClick={onToggleFavorite}
                        className={cn(
                            "w-full h-10 rounded-xl border text-sm font-medium transition-colors",
                            "flex items-center justify-center gap-2",
                            isFavorite
                                ? "border-[var(--color-accent)] bg-[var(--color-accent-light)] text-[color:var(--color-accent)]"
                                : "border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]",
                        )}
                    >
                        <Heart className={cn("w-4 h-4", isFavorite && "fill-current")} />
                        {isFavorite ? "Favorited" : "Add to Favorites"}
                    </button>
                )}

                {articleUrl && (
                    <a
                        href={articleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full h-10 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <ExternalLink className="w-4 h-4" />
                        Open Original Article
                    </a>
                )}
            </div>

            <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => setActiveTab("bookmarks")}
                        className={cn(
                            "reader-chip px-3 py-2 text-xs rounded-full transition-colors",
                            activeTab === "bookmarks" ? "opacity-100" : "opacity-70 hover:opacity-100",
                        )}
                        data-active={activeTab === "bookmarks"}
                    >
                        Bookmarks ({bookmarks.length})
                    </button>
                    <button
                        onClick={() => setActiveTab("highlights")}
                        className={cn(
                            "reader-chip px-3 py-2 text-xs rounded-full transition-colors",
                            activeTab === "highlights" ? "opacity-100" : "opacity-70 hover:opacity-100",
                        )}
                        data-active={activeTab === "highlights"}
                    >
                        Highlights ({highlights.length})
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3 custom-scrollbar">
                {!hasItems && activeTab === "bookmarks" && (
                    <p className="text-sm text-[color:var(--color-text-muted)] text-center py-10">
                        Use the top bookmark button to save this reading position.
                    </p>
                )}

                {!hasItems && activeTab === "highlights" && (
                    <p className="text-sm text-[color:var(--color-text-muted)] text-center py-10">
                        Select text and highlight to save snippets here.
                    </p>
                )}

                <div className="space-y-1">
                    {activeTab === "bookmarks" && bookmarks.map((bookmark) => (
                        <div
                            key={bookmark.id}
                            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2"
                        >
                            <button
                                onClick={() => onJumpToBookmark(bookmark.id)}
                                className="w-full text-left p-2 rounded-lg hover:bg-[var(--color-surface-muted)] transition-colors"
                            >
                                <p className="text-sm text-[color:var(--color-text-secondary)] line-clamp-2 leading-relaxed">
                                    {bookmark.label}
                                </p>
                                <p className="mt-1 text-[11px] text-[color:var(--color-text-muted)] uppercase tracking-wider">
                                    {Math.round(bookmark.progress * 100)}%
                                </p>
                            </button>
                            <div className="mt-1 flex items-center justify-between px-2">
                                <span className="text-[var(--font-size-3xs)] text-[color:var(--color-text-muted)] uppercase tracking-wider">
                                    {bookmark.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                                <button
                                    onClick={() => onDeleteBookmark(bookmark.id)}
                                    className="p-1.5 rounded-lg hover:bg-[var(--color-error)]/10 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)] transition-colors"
                                    title="Delete bookmark"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}

                    {activeTab === "highlights" && highlights.map((highlight) => (
                        <div
                            key={highlight.id}
                            className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-2"
                        >
                            <button
                                onClick={() => onJumpToHighlight(highlight.id)}
                                className="w-full text-left p-2 rounded-lg hover:bg-[var(--color-surface-muted)] transition-colors"
                            >
                                <p className="text-sm text-[color:var(--color-text-secondary)] line-clamp-3 leading-relaxed">
                                    {highlight.text}
                                </p>
                            </button>
                            <div className="mt-1 flex items-center justify-between px-2">
                                <span className="text-[var(--font-size-3xs)] text-[color:var(--color-text-muted)] uppercase tracking-wider">
                                    {highlight.createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                                <button
                                    onClick={() => onDeleteHighlight(highlight.id)}
                                    className="p-1.5 rounded-lg hover:bg-[var(--color-error)]/10 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)] transition-colors"
                                    title="Delete highlight"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </FloatingPanel>
    );
}
