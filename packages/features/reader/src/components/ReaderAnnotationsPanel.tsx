/**
 * ReaderAnnotationsPanel Component
 * Unified panel for Bookmarks and Highlights with tabs
 */

import { useState } from 'react';
import { Bookmark, X, Trash2, ExternalLink, Highlighter, MessageSquare } from 'lucide-react';
import { HIGHLIGHT_PICKER_COLORS } from "@theorem/core";
import { cn, useLibraryStore, useUIStore } from "@theorem/core";
import { format } from 'date-fns';
import { Backdrop, FloatingPanel } from "@theorem/ui";
import type { Annotation, HighlightColor } from "@theorem/core";

interface ReaderAnnotationsPanelProps {
    bookId: string;
    visible: boolean;
    onClose: () => void;
    onNavigate: (location: string) => void;
    onDelete?: (id: string) => void;
    className?: string;
}

type TabType = 'bookmarks' | 'highlights';

export function ReaderAnnotationsPanel({
    bookId,
    visible,
    onClose,
    onNavigate,
    onDelete,
    className,
}: ReaderAnnotationsPanelProps) {
    const [activeTab, setActiveTab] = useState<TabType>('bookmarks');
    const { getBookAnnotations, removeAnnotation } = useLibraryStore();
    const vaultSyncStatus = useUIStore((state) => state.vaultSyncStatus);
    const annotations = getBookAnnotations(bookId);
    
    const bookmarks = annotations.filter(a => a.type === 'bookmark');
    const highlights = annotations.filter(a => a.type === 'highlight' || a.type === 'note');

    const handleNavigate = (annotation: Annotation) => {
        onNavigate(annotation.location);
        onClose();
    };

    const renderBookmarkItem = (bookmark: Annotation) => (
        <div
            key={bookmark.id}
            className="group cursor-pointer border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-colors hover:border-black"
            onClick={() => handleNavigate(bookmark)}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Bookmark className="w-4 h-4 text-[color:var(--color-accent)] flex-shrink-0" />
                    <span className="text-[var(--font-size-caption)] font-medium text-[color:var(--color-text-primary)] truncate">
                        {bookmark.selectedText || 'Bookmark'}
                    </span>
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        removeAnnotation(bookmark.id);
                        onDelete?.(bookmark.id);
                    }}
                    className="reader-danger-action border border-[var(--color-border)] p-1.5 text-[color:var(--color-text-muted)] transition-colors opacity-0 group-hover:opacity-100"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="flex items-center justify-between pl-6 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-text-secondary)]">
                <span>{format(new Date(bookmark.createdAt), 'MMM d, yyyy')}</span>
                <div className="flex items-center gap-1 text-[color:var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Jump to</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                </div>
            </div>
        </div>
    );

    const renderHighlightItem = (highlight: Annotation) => (
        <div
            key={highlight.id}
            className="group cursor-pointer border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-colors hover:border-black"
            onClick={() => handleNavigate(highlight)}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                    {/* Color indicator */}
                    <div 
                        className="mt-0.5 h-3 w-3 flex-shrink-0 border border-[var(--color-border)]"
                        style={{ 
                            backgroundColor: getHighlightColor(highlight.color),
                            opacity: 0.6 
                        }}
                    />
                    <div className="flex-1 min-w-0">
                        <p className="font-serif text-sm leading-relaxed text-[color:var(--color-text-primary)] line-clamp-3">
                            {highlight.selectedText || 'Highlight'}
                        </p>
                        {highlight.noteContent && (
                            <div className="mt-1 border-l border-[var(--color-border)] pl-2 font-serif text-[13px] text-[color:var(--color-text-secondary)]">
                                <span className="line-clamp-2">{highlight.noteContent}</span>
                            </div>
                        )}
                    </div>
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        removeAnnotation(highlight.id);
                        onDelete?.(highlight.id);
                    }}
                    className="reader-danger-action border border-[var(--color-border)] p-1.5 text-[color:var(--color-text-muted)] transition-colors opacity-0 group-hover:opacity-100"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="flex items-center justify-between pl-6 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--color-text-secondary)]">
                <span>{format(new Date(highlight.createdAt), 'MMM d, yyyy')}</span>
                <div className="flex items-center gap-1 text-[color:var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Jump to</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                </div>
            </div>
        </div>
    );

    const getHighlightColor = (color?: HighlightColor): string => {
        return color ? HIGHLIGHT_PICKER_COLORS[color] : HIGHLIGHT_PICKER_COLORS.yellow;
    };

    const currentItems = activeTab === 'bookmarks' ? bookmarks : highlights;
    const emptyState = activeTab === 'bookmarks' ? (
        <div className="w-full flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-background)] flex items-center justify-center mb-4 text-[color:var(--color-text-muted)]">
                <Bookmark className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-[color:var(--color-text-primary)] mb-1">No bookmarks yet</h3>
            <p className="w-full max-w-[17rem] text-xs text-[color:var(--color-text-muted)] leading-relaxed">
                Click the bookmark button in the toolbar to save your current page.
            </p>
        </div>
    ) : (
        <div className="w-full flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-background)] flex items-center justify-center mb-4 text-[color:var(--color-text-muted)]">
                <Highlighter className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-[color:var(--color-text-primary)] mb-1">No highlights yet</h3>
            <p className="w-full max-w-[17rem] text-xs text-[color:var(--color-text-muted)] leading-relaxed">
                Select text and choose a color to highlight important passages.
            </p>
        </div>
    );

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={cn("overflow-hidden", className)}>
                {/* Header with Tabs */}
                <div className="reader-panel-header flex flex-col">
                    <div className="flex items-center justify-between p-4">
                        <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">Annotations</h2>
                        <button
                            onClick={onClose}
                            className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80 text-[color:var(--color-text-secondary)]"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="mx-4 mb-3 border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
                        {vaultSyncStatus === "synced" && "STATUS: SYNCED_TO_VAULT"}
                        {vaultSyncStatus === "syncing" && "STATUS: APPENDING_TO_MARKDOWN"}
                        {vaultSyncStatus === "error" && "STATUS: SYNC_ERROR"}
                        {vaultSyncStatus === "idle" && "STATUS: IDLE"}
                    </div>
                    
                    {/* Tabs */}
                    <div className="flex px-4 pb-3 gap-2">
                        <button
                            onClick={() => setActiveTab('bookmarks')}
                            className={cn(
                                "reader-chip px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                                activeTab === 'bookmarks'
                                    ? "bg-[var(--color-accent)] ui-text-accent-contrast border-[var(--color-accent)]"
                                    : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                            )}
                            data-active={activeTab === "bookmarks"}
                        >
                            [ BOOKMARKS: {bookmarks.length} ]
                        </button>
                        <button
                            onClick={() => setActiveTab('highlights')}
                            className={cn(
                                "reader-chip px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] transition-colors",
                                activeTab === 'highlights'
                                    ? "bg-[var(--color-accent)] ui-text-accent-contrast border-[var(--color-accent)]"
                                    : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                            )}
                            data-active={activeTab === "highlights"}
                        >
                            [ HIGHLIGHTS: {highlights.length} ]
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4 custom-scrollbar">
                    {currentItems.length === 0 ? (
                        emptyState
                    ) : (
                        <div className="space-y-2">
                            {activeTab === 'bookmarks' 
                                ? bookmarks.map(renderBookmarkItem)
                                : highlights.map(renderHighlightItem)
                            }
                        </div>
                    )}
                </div>
            </FloatingPanel>
        </>
    );
}

export default ReaderAnnotationsPanel;
