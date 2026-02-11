/**
 * ReaderAnnotationsPanel Component
 * Unified panel for Bookmarks and Highlights with tabs
 */

import { useState } from 'react';
import { Bookmark, X, Trash2, ExternalLink, Highlighter, MessageSquare } from 'lucide-react';
import { HIGHLIGHT_PICKER_COLORS } from "@/lib/design-tokens";
import { useLibraryStore } from '@/store';
import { format } from 'date-fns';
import { Backdrop, FloatingPanel } from '@/components/ui';
import type { Annotation, HighlightColor } from '@/types';
import { cn } from '@/lib/utils';

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
            className="group flex flex-col gap-2 p-3 rounded-xl border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-background)] transition-colors cursor-pointer"
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
                    className="reader-danger-action p-1.5 rounded-lg text-[color:var(--color-text-muted)] transition-colors opacity-0 group-hover:opacity-100"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="flex items-center justify-between text-[var(--font-size-3xs)] text-[color:var(--color-text-muted)] font-medium pl-6">
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
            className="group flex flex-col gap-2 p-3 rounded-xl border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-background)] transition-colors cursor-pointer"
            onClick={() => handleNavigate(highlight)}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                    {/* Color indicator */}
                    <div 
                        className="w-4 h-4 rounded flex-shrink-0 mt-0.5"
                        style={{ 
                            backgroundColor: getHighlightColor(highlight.color),
                            opacity: 0.6 
                        }}
                    />
                    <div className="flex-1 min-w-0">
                        <p className="text-[var(--font-size-caption)] text-[color:var(--color-text-primary)] line-clamp-2 leading-snug">
                            &ldquo;{highlight.selectedText || 'Highlight'}&rdquo;
                        </p>
                        {highlight.noteContent && (
                            <div className="flex items-center gap-1 mt-1 text-[var(--font-size-3xs)] text-[color:var(--color-text-muted)]">
                                <MessageSquare className="w-3 h-3" />
                                <span className="line-clamp-1">{highlight.noteContent}</span>
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
                    className="reader-danger-action p-1.5 rounded-lg text-[color:var(--color-text-muted)] transition-colors opacity-0 group-hover:opacity-100"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="flex items-center justify-between text-[var(--font-size-3xs)] text-[color:var(--color-text-muted)] font-medium pl-6">
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
                    
                    {/* Tabs */}
                    <div className="flex px-4 pb-3 gap-2">
                        <button
                            onClick={() => setActiveTab('bookmarks')}
                            className={cn(
                                "reader-chip flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-full transition-colors",
                                activeTab === 'bookmarks'
                                    ? "bg-[var(--color-accent)] ui-text-accent-contrast border-transparent"
                                    : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                            )}
                            data-active={activeTab === "bookmarks"}
                        >
                            <Bookmark className="w-3.5 h-3.5" />
                            Bookmarks ({bookmarks.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('highlights')}
                            className={cn(
                                "reader-chip flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-full transition-colors",
                                activeTab === 'highlights'
                                    ? "bg-[var(--color-accent)] ui-text-accent-contrast border-transparent"
                                    : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                            )}
                            data-active={activeTab === "highlights"}
                        >
                            <Highlighter className="w-3.5 h-3.5" />
                            Highlights ({highlights.length})
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
