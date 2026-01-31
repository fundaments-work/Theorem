/**
 * WindowTitlebar Component
 * Custom title bar with native-looking window controls and reader controls
 * Custom implementation without external dependencies
 */

import { useState, useEffect } from "react";
import {
    ArrowLeft,
    List,
    Bookmark as BookmarkIcon,
    Search,
    MoreVertical,
    Maximize2,
    Minimize2,
    Minus,
    Square,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocMetadata, DocLocation } from "@/types";

interface WindowTitlebarProps {
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

export function WindowTitlebar({
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
}: WindowTitlebarProps) {
    const [isMaximized, setIsMaximized] = useState(false);
    const currentChapter = location?.tocItem?.label || location?.pageItem?.label;

    // Listen for window state changes
    useEffect(() => {
        const handleResize = () => {
            // Check if window is maximized by comparing inner dimensions to screen
            const isMax = window.innerWidth === window.screen.availWidth && 
                         window.innerHeight === window.screen.availHeight;
            setIsMaximized(isMax);
        };

        window.addEventListener("resize", handleResize);
        handleResize();

        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const formatLocation = () => {
        if (!location) return null;
        if (location.pageInfo) {
            return `Page ${location.pageInfo.currentPage}${location.pageInfo.totalPages ? ` / ${location.pageInfo.totalPages}` : ""}`;
        }
        if (location.pageItem?.label) {
            return location.pageItem.label;
        }
        const percentage = Math.round((location.percentage || 0) * 100);
        return `${percentage}%`;
    };

    const handleMinimize = () => {
        // @ts-ignore - Tauri API available in Tauri environment
        if (window.__TAURI__) {
            // @ts-ignore
            window.__TAURI__.window.getCurrentWindow().minimize();
        }
    };

    const handleMaximize = () => {
        // @ts-ignore - Tauri API available in Tauri environment
        if (window.__TAURI__) {
            // @ts-ignore
            const win = window.__TAURI__.window.getCurrentWindow();
            if (isMaximized) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
    };

    const handleClose = () => {
        // @ts-ignore - Tauri API available in Tauri environment
        if (window.__TAURI__) {
            // @ts-ignore
            window.__TAURI__.window.getCurrentWindow().close();
        }
    };

    return (
        <div
            className={cn(
                "w-full z-50 select-none bg-[var(--color-surface)] border-b border-[var(--color-border)]",
                "h-11 flex items-center justify-between px-2",
                className
            )}
            data-tauri-drag-region
        >
            {/* Left side - Title area (draggable) */}
            <div className="flex items-center gap-2 flex-1 min-w-0" data-tauri-drag-region>
                <button
                    onClick={onBack}
                    className="p-1.5 rounded-lg hover:bg-[var(--color-background)] transition-colors shrink-0"
                    title="Back to Library"
                >
                    <ArrowLeft className="w-4 h-4 text-[var(--color-text)]" />
                </button>

                <div className="w-px h-4 bg-[var(--color-border)] mx-1 shrink-0" />

                <div className="flex-1 min-w-0 text-left overflow-hidden" data-tauri-drag-region>
                    <h1 className="text-sm font-medium text-[var(--color-text)] truncate">
                        {metadata?.title || "Loading..."}
                    </h1>
                    <div className="flex items-center gap-1.5 text-xs">
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
            </div>

            {/* Center - Spacer for dragging */}
            <div className="flex-1 h-full" data-tauri-drag-region />

            {/* Right side - Reader controls */}
            <div className="flex items-center gap-1 shrink-0">
                <button
                    onClick={onToggleToc}
                    className={cn(
                        "p-1.5 rounded-lg transition-all duration-200",
                        activePanel === "toc"
                            ? "bg-[var(--color-accent)] text-[var(--color-background)]"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Table of Contents"
                >
                    <List className="w-4 h-4" />
                </button>

                <button
                    onClick={onToggleSearch}
                    className={cn(
                        "p-1.5 rounded-lg transition-all duration-200",
                        activePanel === "search"
                            ? "bg-[var(--color-accent)] text-[var(--color-background)]"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Search"
                >
                    <Search className="w-4 h-4" />
                </button>

                <button
                    onClick={onToggleBookmarks}
                    className={cn(
                        "p-1.5 rounded-lg transition-all duration-200",
                        activePanel === "bookmarks"
                            ? "bg-[var(--color-accent)] text-[var(--color-background)]"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Bookmarks"
                >
                    <BookmarkIcon className="w-4 h-4" />
                </button>

                <button
                    onClick={onToggleSettings}
                    className={cn(
                        "p-1.5 rounded-lg transition-all duration-200 min-w-[32px] flex items-center justify-center",
                        activePanel === "settings"
                            ? "bg-[var(--color-accent)] text-[var(--color-background)]"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Reading Settings"
                >
                    <span className="text-sm font-serif font-bold">Aa</span>
                </button>

                <button
                    onClick={onToggleFullscreen}
                    className={cn(
                        "p-1.5 rounded-lg transition-all duration-200",
                        fullscreen
                            ? "bg-[var(--color-accent)] text-[var(--color-background)]"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title={fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                    {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>

                <div className="w-px h-4 bg-[var(--color-border)] mx-1" />

                <button
                    onClick={onToggleInfo}
                    className={cn(
                        "p-1.5 rounded-lg transition-all duration-200",
                        activePanel === "info"
                            ? "bg-[var(--color-accent)] text-white"
                            : "hover:bg-[var(--color-background)] text-[var(--color-text)]"
                    )}
                    title="Book Information"
                >
                    <MoreVertical className="w-4 h-4" />
                </button>

                {/* Window Controls */}
                <div className="flex items-center gap-0.5 ml-2">
                    <button
                        onClick={handleMinimize}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-background)] text-[var(--color-text)] transition-colors"
                        title="Minimize"
                    >
                        <Minus className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleMaximize}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-background)] text-[var(--color-text)] transition-colors"
                        title={isMaximized ? "Restore" : "Maximize"}
                    >
                        <Square className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handleClose}
                        className="p-1.5 rounded-lg hover:bg-red-500 hover:text-white text-[var(--color-text)] transition-colors"
                        title="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default WindowTitlebar;
