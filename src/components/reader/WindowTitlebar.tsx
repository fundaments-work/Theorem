/**
 * WindowTitlebar Component
 * Custom title bar with native-looking window controls and reader controls
 * Theme-aware - adapts to reader theme colors
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

function ToolbarButton({ onClick, active, title, children }: { onClick?: () => void; active?: boolean; title: string; children: React.ReactNode }) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "p-1.5 rounded transition-opacity duration-200",
                active ? "opacity-100" : "opacity-60 hover:opacity-100"
            )}
            style={{ color: 'var(--reader-fg)' }}
            title={title}
        >
            {children}
        </button>
    );
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
        const tauri = (window as any).__TAURI__;
        if (tauri) {
            tauri.window.getCurrentWindow().minimize();
        }
    };

    const handleMaximize = () => {
        const tauri = (window as any).__TAURI__;
        if (tauri) {
            const win = tauri.window.getCurrentWindow();
            if (isMaximized) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
    };

    const handleClose = () => {
        const tauri = (window as any).__TAURI__;
        if (tauri) {
            tauri.window.getCurrentWindow().close();
        }
    };

    return (
        <div
            className={cn(
                "w-full z-50 select-none border-b reader-toolbar",
                "h-11 flex items-center justify-between px-2",
                "bg-[var(--color-surface)] border-[var(--color-border)]",
                className
            )}
            style={{
                backgroundColor: 'var(--reader-bg, var(--color-surface))',
                borderBottomColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)',
            }}
            data-tauri-drag-region
        >
            {/* Left side - Title area */}
            <div className="flex items-center gap-2 flex-1 min-w-0" data-tauri-drag-region>
                <button
                    onClick={onBack}
                    className="p-1.5 rounded-lg transition-colors shrink-0 hover:opacity-70"
                    style={{ color: 'var(--reader-fg, var(--color-text))' }}
                    title="Back to Library"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>

                <div 
                    className="w-px h-4 mx-1 shrink-0" 
                    style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                />

                <div className="flex-1 min-w-0 text-left overflow-hidden" data-tauri-drag-region>
                    <h1 
                        className="text-sm font-medium truncate"
                        style={{ color: 'var(--reader-fg, var(--color-text))' }}
                    >
                        {metadata?.title || "Loading..."}
                    </h1>
                    <div className="flex items-center gap-1.5 text-xs">
                        {currentChapter ? (
                            <span 
                                className="font-medium truncate"
                                style={{ color: 'var(--reader-link, var(--color-accent))' }}
                            >
                                {currentChapter}
                            </span>
                        ) : metadata?.author ? (
                            <span 
                                className="truncate opacity-70"
                                style={{ color: 'var(--reader-fg, var(--color-text))' }}
                            >
                                {metadata.author}
                            </span>
                        ) : null}
                        {formatLocation() && (
                            <span style={{ color: 'var(--reader-fg, var(--color-text))', opacity: 0.5 }}>
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
                <ToolbarButton
                    onClick={onToggleToc}
                    active={activePanel === "toc"}
                    title="Table of Contents"
                >
                    <List className="w-4 h-4" />
                </ToolbarButton>

                <ToolbarButton
                    onClick={onToggleSearch}
                    active={activePanel === "search"}
                    title="Search"
                >
                    <Search className="w-4 h-4" />
                </ToolbarButton>

                <ToolbarButton
                    onClick={onToggleBookmarks}
                    active={activePanel === "bookmarks"}
                    title="Bookmarks"
                >
                    <BookmarkIcon className="w-4 h-4" />
                </ToolbarButton>

                <ToolbarButton
                    onClick={onToggleSettings}
                    active={activePanel === "settings"}
                    title="Reading Settings"
                >
                    <span className="text-sm font-serif font-bold">Aa</span>
                </ToolbarButton>

                <ToolbarButton
                    onClick={onToggleFullscreen}
                    active={fullscreen}
                    title={fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                    {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </ToolbarButton>

                <div 
                    className="w-px h-4 mx-1" 
                    style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                />

                <ToolbarButton
                    onClick={onToggleInfo}
                    active={activePanel === "info"}
                    title="Book Information"
                >
                    <MoreVertical className="w-4 h-4" />
                </ToolbarButton>

                {/* Window Controls */}
                <div className="flex items-center gap-0.5 ml-2">
                    <button onClick={handleMinimize} className="p-1.5 rounded opacity-50 hover:opacity-100 transition-opacity" style={{ color: 'var(--reader-fg)' }} title="Minimize">
                        <Minus className="w-4 h-4" />
                    </button>
                    <button onClick={handleMaximize} className="p-1.5 rounded opacity-50 hover:opacity-100 transition-opacity" style={{ color: 'var(--reader-fg)' }} title={isMaximized ? "Restore" : "Maximize"}>
                        <Square className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={handleClose} className="p-1.5 rounded opacity-50 hover:opacity-100 transition-opacity" style={{ color: 'var(--reader-fg)' }} title="Close">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default WindowTitlebar;
