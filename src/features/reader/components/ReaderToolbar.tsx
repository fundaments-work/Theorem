/**
 * ReaderToolbar Component
 * Auto-hiding top toolbar with navigation and controls
 * Swiss Design Standard - Consistent across PDF, EPUB, and Article readers
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
import { cn, normalizeAuthor } from '../../../core';
import type { DocMetadata, DocLocation } from '../../../core';

interface ReaderToolbarProps {
    metadata: DocMetadata | null;
    location?: DocLocation | null;
    onBack: () => void;
    onToggleToc: () => void;
    onToggleSettings: () => void;
    onToggleBookmarks: () => void;
    onToggleSearch: () => void;
    onToggleInfo: () => void;
    onAddBookmark?: () => void;
    activePanel: string | null;
    fullscreen?: boolean;
    onToggleFullscreen?: () => void;
    className?: string;
}

const READER_BUTTON_CLASS =
    "inline-flex h-9 w-9 items-center justify-center border border-transparent bg-transparent text-[color:var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)] data-[active=true]:border-[var(--color-accent)] data-[active=true]:bg-[var(--color-accent)] data-[active=true]:text-[color:var(--color-accent-contrast)] data-[active=true]:hover:border-[var(--color-accent-hover)] data-[active=true]:hover:bg-[var(--color-accent-hover)]";

export function ReaderToolbar({
    metadata,
    location,
    onBack,
    onToggleToc,
    onToggleSettings,
    onToggleBookmarks,
    onToggleSearch,
    onToggleInfo,
    onAddBookmark,
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
                'flex h-[var(--layout-reader-toolbar-height)] items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-2 sm:px-4',
                className
            )}
        >
            {/* Left Section: Back + Navigation */}
            <div className="flex items-center gap-1">
                <button
                    onClick={onBack}
                    className={READER_BUTTON_CLASS}
                    title="Back to Library"
                    aria-label="Back to Library"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
            </div>

            {/* Center: Book Title, Chapter & Location */}
            <div className="flex-1 mx-4 text-center overflow-hidden">
                <h1 className="truncate text-sm font-medium text-[color:var(--color-text-primary)]">
                    {metadata?.title || 'Loading...'}
                </h1>
                <div className="flex items-center justify-center gap-2">
                    {currentChapter ? (
                        <span className="text-[color:var(--color-accent)] text-xs font-medium truncate">
                            {currentChapter}
                        </span>
                    ) : metadata?.author ? (
                        <span className="text-xs text-[color:var(--color-text-secondary)] truncate">
                            {normalizeAuthor(metadata.author)}
                        </span>
                    ) : null}
                    {formatLocation() && (
                        <span className="text-xs text-[color:var(--color-text-secondary)]">
                            • {formatLocation()}
                        </span>
                    )}
                </div>
            </div>

            {/* Right Section */}
            <div className="flex items-center gap-1">
                {/* Table of Contents */}
                <button
                    onClick={onToggleToc}
                    className={READER_BUTTON_CLASS}
                    data-active={activePanel === 'toc'}
                    title="Table of Contents"
                    aria-label="Table of Contents"
                >
                    <List className="w-5 h-5" />
                </button>

                {/* Search */}
                <button
                    onClick={onToggleSearch}
                    className={READER_BUTTON_CLASS}
                    data-active={activePanel === 'search'}
                    title="Search"
                    aria-label="Search"
                >
                    <Search className="w-5 h-5" />
                </button>

                {/* Add Bookmark - Quick add current page */}
                {onAddBookmark && (
                    <button
                        onClick={onAddBookmark}
                        className={READER_BUTTON_CLASS}
                        title="Bookmark current page (Ctrl+D)"
                        aria-label="Bookmark current page"
                    >
                        <BookmarkIcon className="w-5 h-5" />
                    </button>
                )}

                {/* Bookmarks Panel Toggle */}
                <button
                    onClick={onToggleBookmarks}
                    className={READER_BUTTON_CLASS}
                    data-active={activePanel === 'bookmarks'}
                    title="View Bookmarks & Highlights"
                    aria-label="View Bookmarks and Highlights"
                >
                    <BookmarkIcon className="w-5 h-5 fill-current" />
                </button>

                {/* Settings (Aa) */}
                <button
                    onClick={onToggleSettings}
                    className={cn(READER_BUTTON_CLASS, "min-w-[var(--control-icon-button-size)]")}
                    data-active={activePanel === 'settings'}
                    title="Reading Settings"
                    aria-label="Reading Settings"
                >
                    <span className="text-base font-serif font-bold">Aa</span>
                </button>

                {/* Fullscreen */}
                <button
                    onClick={onToggleFullscreen}
                    className={READER_BUTTON_CLASS}
                    data-active={fullscreen}
                    title={fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                    aria-label={fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                    {fullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>

                {/* Divider */}
                <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

                {/* More Options */}
                <button
                    onClick={onToggleInfo}
                    className={READER_BUTTON_CLASS}
                    data-active={activePanel === 'info'}
                    title="Book Information"
                    aria-label="Book Information"
                >
                    <MoreVertical className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}

export default ReaderToolbar;
