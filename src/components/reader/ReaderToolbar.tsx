/**
 * ReaderToolbar Component
 * Auto-hiding top toolbar with navigation and settings
 */

import {
    ArrowLeft,
    List,
    Bookmark as BookmarkIcon,
    Search,
    MoreVertical,
    Maximize2,
    Minimize2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DocMetadata, DocLocation } from '@/types';

interface ReaderToolbarProps {
    metadata: DocMetadata | null;
    location?: DocLocation | null;
    onBack: () => void;
    onToggleToc: () => void;
    onToggleSettings: () => void;
    onToggleBookmarks: () => void;
    onToggleSearch: () => void;
    onToggleInfo: () => void;
    activePanel: string | null;
    fullscreen?: boolean;
    onToggleFullscreen?: () => void;
    className?: string;
}

export function ReaderToolbar({
    metadata,
    location,
    onBack,
    onToggleToc,
    onToggleSettings,
    onToggleBookmarks,
    onToggleSearch,
    onToggleInfo,
    activePanel,
    fullscreen,
    onToggleFullscreen,
    className,
}: ReaderToolbarProps) {
    // Get current chapter title from location
    const currentChapter = location?.tocItem?.label || location?.pageItem?.label;
    
    // Format location display (e.g., "Page 42 / 300" or "Loc. 123 / 500")
    const formatLocation = () => {
        if (!location) return null;
        
        if (location.pageInfo) {
            return `Page ${location.pageInfo.currentPage}${location.pageInfo.totalPages ? ` / ${location.pageInfo.totalPages}` : ''}`;
        }
        
        if (location.pageItem?.label) {
            return location.pageItem.label;
        }
        
        // Fallback to percentage
        const percentage = Math.round((location.percentage || 0) * 100);
        return `${percentage}%`;
    };

    return (
        <div
            className={cn(
                'relative w-full z-20',
                'h-14 px-4 flex items-center justify-between flex-shrink-0',
                'bg-[var(--color-surface)]/95 backdrop-blur-lg',
                'border-b border-[var(--color-border)]',
                className
            )}
        >
            {/* Left Section: Back + Navigation */}
            <div className="flex items-center gap-1.5">
                {/* Back to Library */}
                <button
                    onClick={onBack}
                    className="p-2 rounded-lg hover:bg-[var(--color-background)] transition-colors"
                    title="Back to Library"
                >
                    <ArrowLeft className="w-5 h-5 text-[var(--color-text)]" />
                </button>

            </div>

            {/* Center: Book Title, Chapter & Location */}
            <div className="flex-1 mx-4 text-center overflow-hidden">
                <h1 className="text-sm font-medium text-[var(--color-text)] truncate">
                    {metadata?.title || 'Loading...'}
                </h1>
                <div className="flex items-center justify-center gap-2 text-xs">
                    {currentChapter ? (
                        <span className="text-[var(--color-accent)] font-medium truncate">
                            {currentChapter}
                        </span>
                    ) : metadata?.author ? (
                        <span className="text-[var(--color-text-muted)] truncate">
                            {metadata.author}
                        </span>
                    ) : null}
                    {formatLocation() && (
                        <span className="text-[var(--color-text-muted)]">
                            • {formatLocation()}
                        </span>
                    )}
                </div>
            </div>

            {/* Right Section */}
            <div className="flex items-center gap-1.5">
                {/* Table of Contents */}
                <button
                    onClick={onToggleToc}
                    className={cn(
                        "p-2 rounded-xl transition-all duration-200",
                        activePanel === 'toc'
                            ? "bg-[var(--color-accent)] text-[var(--color-background)] shadow-lg shadow-[var(--color-accent)]/10"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Table of Contents"
                >
                    <List className="w-5 h-5" />
                </button>

                {/* Search */}
                <button
                    onClick={onToggleSearch}
                    className={cn(
                        "p-2 rounded-xl transition-all duration-200",
                        activePanel === 'search'
                            ? "bg-[var(--color-accent)] text-[var(--color-background)] shadow-lg shadow-[var(--color-accent)]/10"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Search"
                >
                    <Search className="w-5 h-5" />
                </button>

                {/* Bookmarks */}
                <button
                    onClick={onToggleBookmarks}
                    className={cn(
                        "p-2 rounded-xl transition-all duration-200",
                        activePanel === 'bookmarks'
                            ? "bg-[var(--color-accent)] text-[var(--color-background)] shadow-lg shadow-[var(--color-accent)]/10"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Bookmarks"
                >
                    <BookmarkIcon className="w-5 h-5" />
                </button>

                {/* Settings (Aa) */}
                <button
                    onClick={onToggleSettings}
                    className={cn(
                        "p-2 rounded-xl transition-all duration-200 min-w-[40px] flex items-center justify-center",
                        activePanel === 'settings'
                            ? "bg-[var(--color-accent)] text-[var(--color-background)] shadow-lg shadow-[var(--color-accent)]/10"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Reading Settings"
                >
                    <span className="text-base font-serif font-bold">Aa</span>
                </button>

                {/* Fullscreen */}
                <button
                    onClick={onToggleFullscreen}
                    className={cn(
                        "p-2 rounded-xl transition-all duration-200",
                        fullscreen
                            ? "bg-[var(--color-accent)] text-[var(--color-background)] shadow-lg shadow-[var(--color-accent)]/10"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title={fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                    {fullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>

                <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

                {/* More Options */}
                <button
                    onClick={onToggleInfo}
                    className={cn(
                        "p-2 rounded-xl transition-all duration-200",
                        activePanel === 'info'
                            ? "bg-[var(--color-accent)] text-white shadow-lg shadow-[var(--color-accent)]/20"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Book Information"
                >
                    <MoreVertical className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}

export default ReaderToolbar;
