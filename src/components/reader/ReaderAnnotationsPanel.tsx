/**
 * ReaderAnnotationsPanel Component
 * Unified panel for Bookmarks and Highlights with tabs
 */

import { useState } from 'react';
import { Bookmark, X, Trash2, ExternalLink, Highlighter, MessageSquare } from 'lucide-react';
import { useLibraryStore } from '@/store';
import { format } from 'date-fns';
import { Backdrop, FloatingPanel } from '@/components/ui';
import type { Annotation } from '@/types';
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
            className="group flex flex-col gap-2 p-3 rounded-xl border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-background)] transition-all cursor-pointer"
            onClick={() => handleNavigate(bookmark)}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Bookmark className="w-4 h-4 text-[var(--color-accent)] flex-shrink-0" />
                    <span className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
                        {bookmark.selectedText || 'Bookmark'}
                    </span>
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        removeAnnotation(bookmark.id);
                        onDelete?.(bookmark.id);
                    }}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] font-medium pl-6">
                <span>{format(new Date(bookmark.createdAt), 'MMM d, yyyy')}</span>
                <div className="flex items-center gap-1 text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Jump to</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                </div>
            </div>
        </div>
    );

    const renderHighlightItem = (highlight: Annotation) => (
        <div
            key={highlight.id}
            className="group flex flex-col gap-2 p-3 rounded-xl border border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-background)] transition-all cursor-pointer"
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
                        <p className="text-[13px] text-[var(--color-text-primary)] line-clamp-2 leading-snug">
                            &ldquo;{highlight.selectedText || 'Highlight'}&rdquo;
                        </p>
                        {highlight.noteContent && (
                            <div className="flex items-center gap-1 mt-1 text-[10px] text-[var(--color-text-muted)]">
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
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--color-text-muted)] font-medium pl-6">
                <span>{format(new Date(highlight.createdAt), 'MMM d, yyyy')}</span>
                <div className="flex items-center gap-1 text-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity">
                    <span>Jump to</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                </div>
            </div>
        </div>
    );

    const getHighlightColor = (color?: string): string => {
        const colors: Record<string, string> = {
            yellow: '#FFE082',
            green: '#A5D6A7',
            blue: '#90CAF9',
            red: '#EF9A9A',
            orange: '#FFCC80',
            purple: '#CE93D8',
        };
        return colors[color || 'yellow'];
    };

    const currentItems = activeTab === 'bookmarks' ? bookmarks : highlights;
    const emptyState = activeTab === 'bookmarks' ? (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-background)] flex items-center justify-center mb-4 text-[var(--color-text-muted)]">
                <Bookmark className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">No bookmarks yet</h3>
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                Click the bookmark button in the toolbar to save your current page.
            </p>
        </div>
    ) : (
        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--color-background)] flex items-center justify-center mb-4 text-[var(--color-text-muted)]">
                <Highlighter className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">No highlights yet</h3>
            <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                Select text and choose a color to highlight important passages.
            </p>
        </div>
    );

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={className}>
                {/* Header with Tabs */}
                <div className="flex flex-col border-b border-[var(--color-border)]">
                    <div className="flex items-center justify-between p-4">
                        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Annotations</h2>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-xl hover:bg-[var(--color-border-subtle)] transition-colors text-[var(--color-text-secondary)]"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    
                    {/* Tabs */}
                    <div className="flex px-4 pb-2 gap-1">
                        <button
                            onClick={() => setActiveTab('bookmarks')}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors",
                                activeTab === 'bookmarks'
                                    ? "bg-[var(--color-accent)] text-[var(--color-background)]"
                                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                            )}
                        >
                            <Bookmark className="w-3.5 h-3.5" />
                            Bookmarks ({bookmarks.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('highlights')}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg transition-colors",
                                activeTab === 'highlights'
                                    ? "bg-[var(--color-accent)] text-[var(--color-background)]"
                                    : "text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                            )}
                        >
                            <Highlighter className="w-3.5 h-3.5" />
                            Highlights ({highlights.length})
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar max-h-[60vh]">
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
