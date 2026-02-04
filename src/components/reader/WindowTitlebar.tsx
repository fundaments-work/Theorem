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
    Highlighter,
    Search,
    MoreVertical,
    Maximize2,
    Minimize2,
    Minus,
    Square,
    X,
    LineSquiggle,
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    RotateCw,
    Pencil,
    Type,
    Eraser,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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
    onAddBookmark?: () => void;
    isCurrentPageBookmarked?: boolean;
    activePanel: string | null;
    fullscreen?: boolean;
    onToggleFullscreen?: () => void;
    className?: string;
    /** When true, hides reader-specific controls (TOC, search, bookmarks, settings) - used for PDFs */
    hideReaderControls?: boolean;
    /** PDF-specific controls - only used when hideReaderControls is true */
    pdfControls?: {
        currentPage: number;
        totalPages: number;
        zoom: number;
        zoomMode?: 'custom' | 'page-fit' | 'width-fit';
        annotationMode?: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
        onPrevPage: () => void;
        onNextPage: () => void;
        onZoomIn: () => void;
        onZoomOut: () => void;
        onZoomReset: () => void;
        onZoomFitPage?: () => void;
        onZoomFitWidth?: () => void;
        onRotate: () => void;
        onPageInput?: (page: number) => void;
        onAddBookmark?: () => void;
        onAnnotationModeChange?: (mode: 'none' | 'highlight' | 'pen' | 'text' | 'erase') => void;
        isCurrentPageBookmarked?: boolean;
    };
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
    onAddBookmark,
    isCurrentPageBookmarked,
    activePanel,
    fullscreen,
    onToggleFullscreen,
    className,
    hideReaderControls = false,
    pdfControls,
}: WindowTitlebarProps) {
    const [isMaximized, setIsMaximized] = useState(false);
    const [showPageInput, setShowPageInput] = useState(false);
    const [inputPage, setInputPage] = useState("");
    const [showZoomMenu, setShowZoomMenu] = useState(false);
    const currentChapter = location?.tocItem?.label || location?.pageItem?.label;

    const isPdfMode = hideReaderControls && pdfControls;

    // Listen for window state changes
    useEffect(() => {
        const updateMaximizedState = async () => {
            try {
                const win = getCurrentWebviewWindow();
                const maximized = await win.isMaximized();
                setIsMaximized(maximized);
            } catch (err) {
                // Fallback to window size detection if Tauri API fails
                const isMax = window.innerWidth === window.screen.availWidth && 
                             window.innerHeight === window.screen.availHeight;
                setIsMaximized(isMax);
            }
        };

        const handleResize = () => {
            updateMaximizedState();
        };

        window.addEventListener("resize", handleResize);
        updateMaximizedState();

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

    const handleMinimize = async () => {
        try {
            const win = getCurrentWebviewWindow();
            await win.minimize();
        } catch (err) {
            console.error("Failed to minimize window:", err);
        }
    };

    const handleMaximize = async () => {
        try {
            const win = getCurrentWebviewWindow();
            if (isMaximized) {
                await win.unmaximize();
            } else {
                await win.maximize();
            }
        } catch (err) {
            console.error("Failed to maximize window:", err);
        }
    };

    const handleClose = async () => {
        try {
            const win = getCurrentWebviewWindow();
            await win.close();
        } catch (err) {
            console.error("Failed to close window:", err);
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

            {/* Center - PDF Controls or Spacer */}
            {isPdfMode ? (
                <div className="flex items-center gap-1 shrink-0" data-tauri-drag-region>
                    <button
                        onClick={pdfControls!.onPrevPage}
                        disabled={pdfControls!.currentPage <= 1}
                        className="p-1.5 rounded transition-opacity opacity-60 hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ color: 'var(--reader-fg)' }}
                        title="Previous page"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>

                    {showPageInput ? (
                        <form 
                            onSubmit={(e) => {
                                e.preventDefault();
                                const page = parseInt(inputPage, 10);
                                if (page >= 1 && page <= pdfControls!.totalPages) {
                                    pdfControls!.onPageInput?.(page);
                                }
                                setShowPageInput(false);
                                setInputPage("");
                            }}
                            className="flex items-center gap-1"
                        >
                            <input
                                type="number"
                                min={1}
                                max={pdfControls!.totalPages}
                                value={inputPage}
                                onChange={(e) => setInputPage(e.target.value)}
                                onBlur={() => {
                                    setShowPageInput(false);
                                    setInputPage("");
                                }}
                                autoFocus
                                className="w-12 px-1 py-0.5 text-xs text-center rounded"
                                style={{ 
                                    backgroundColor: 'var(--color-background)',
                                    color: 'var(--reader-fg)',
                                    border: '1px solid var(--color-border)'
                                }}
                            />
                            <span className="text-xs opacity-60" style={{ color: 'var(--reader-fg)' }}>
                                / {pdfControls!.totalPages}
                            </span>
                        </form>
                    ) : (
                        <button
                            onClick={() => {
                                setInputPage(pdfControls!.currentPage.toString());
                                setShowPageInput(true);
                            }}
                            className="px-2 py-0.5 rounded transition-opacity opacity-60 hover:opacity-100"
                            style={{ color: 'var(--reader-fg)' }}
                            title="Click to jump to page"
                        >
                            <span className="text-xs">
                                {pdfControls!.currentPage} / {pdfControls!.totalPages}
                            </span>
                        </button>
                    )}

                    <button
                        onClick={pdfControls!.onNextPage}
                        disabled={pdfControls!.currentPage >= pdfControls!.totalPages}
                        className="p-1.5 rounded transition-opacity opacity-60 hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ color: 'var(--reader-fg)' }}
                        title="Next page"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>

                    <div 
                        className="w-px h-4 mx-1" 
                        style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                    />

                    <button
                        onClick={pdfControls!.onZoomOut}
                        className="p-1.5 rounded transition-opacity opacity-60 hover:opacity-100"
                        style={{ color: 'var(--reader-fg)' }}
                        title="Zoom out"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>

                    {/* Zoom with dropdown menu */}
                    <div className="relative">
                        <button
                            onClick={() => setShowZoomMenu(!showZoomMenu)}
                            className="px-2 py-0.5 rounded transition-opacity opacity-60 hover:opacity-100 text-xs font-medium flex items-center gap-0.5"
                            style={{ color: 'var(--reader-fg)' }}
                            title="Zoom options"
                        >
                            {pdfControls!.zoomMode === 'page-fit' ? 'Fit Page' :
                             pdfControls!.zoomMode === 'width-fit' ? 'Fit Width' :
                             `${Math.round(pdfControls!.zoom * 100)}%`}
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        
                        {showZoomMenu && (
                            <>
                                <div 
                                    className="fixed inset-0 z-40"
                                    onClick={() => setShowZoomMenu(false)}
                                />
                                <div 
                                    className="absolute top-full right-0 mt-1 py-1 rounded-lg shadow-lg border z-50 min-w-[120px]"
                                    style={{
                                        backgroundColor: 'var(--color-surface)',
                                        borderColor: 'var(--color-border)',
                                    }}
                                >
                                    <button
                                        onClick={() => {
                                            pdfControls!.onZoomFitPage?.();
                                            setShowZoomMenu(false);
                                        }}
                                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-background)] transition-colors"
                                        style={{ color: 'var(--reader-fg)' }}
                                    >
                                        Fit to Page
                                    </button>
                                    <button
                                        onClick={() => {
                                            pdfControls!.onZoomFitWidth?.();
                                            setShowZoomMenu(false);
                                        }}
                                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-background)] transition-colors"
                                        style={{ color: 'var(--reader-fg)' }}
                                    >
                                        Fit to Width
                                    </button>
                                    <div className="h-px my-1" style={{ backgroundColor: 'var(--color-border)' }} />
                                    <button
                                        onClick={() => {
                                            pdfControls!.onZoomReset();
                                            setShowZoomMenu(false);
                                        }}
                                        className="w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-background)] transition-colors"
                                        style={{ color: 'var(--reader-fg)' }}
                                    >
                                        100%
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    <button
                        onClick={pdfControls!.onZoomIn}
                        className="p-1.5 rounded transition-opacity opacity-60 hover:opacity-100"
                        style={{ color: 'var(--reader-fg)' }}
                        title="Zoom in"
                    >
                        <ZoomIn className="w-4 h-4" />
                    </button>

                    <div 
                        className="w-px h-4 mx-1" 
                        style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                    />

                    {/* Annotation Tools */}
                    <button
                        onClick={() => pdfControls!.onAnnotationModeChange?.(
                            pdfControls!.annotationMode === 'highlight' ? 'none' : 'highlight'
                        )}
                        className={cn(
                            "p-1.5 rounded transition-opacity",
                            pdfControls!.annotationMode === 'highlight' ? "opacity-100 bg-[var(--color-accent)]/20" : "opacity-60 hover:opacity-100"
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Highlight text"
                    >
                        <Highlighter className="w-4 h-4" />
                    </button>

                    <button
                        onClick={() => pdfControls!.onAnnotationModeChange?.(
                            pdfControls!.annotationMode === 'pen' ? 'none' : 'pen'
                        )}
                        className={cn(
                            "p-1.5 rounded transition-opacity",
                            pdfControls!.annotationMode === 'pen' ? "opacity-100 bg-[var(--color-accent)]/20" : "opacity-60 hover:opacity-100"
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Draw with pen"
                    >
                        <Pencil className="w-4 h-4" />
                    </button>

                    <button
                        onClick={() => pdfControls!.onAnnotationModeChange?.(
                            pdfControls!.annotationMode === 'text' ? 'none' : 'text'
                        )}
                        className={cn(
                            "p-1.5 rounded transition-opacity",
                            pdfControls!.annotationMode === 'text' ? "opacity-100 bg-[var(--color-accent)]/20" : "opacity-60 hover:opacity-100"
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Add text annotation"
                    >
                        <Type className="w-4 h-4" />
                    </button>

                    <button
                        onClick={() => pdfControls!.onAnnotationModeChange?.(
                            pdfControls!.annotationMode === 'erase' ? 'none' : 'erase'
                        )}
                        className={cn(
                            "p-1.5 rounded transition-opacity",
                            pdfControls!.annotationMode === 'erase' ? "opacity-100 bg-[var(--color-accent)]/20" : "opacity-60 hover:opacity-100"
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Eraser"
                    >
                        <Eraser className="w-4 h-4" />
                    </button>

                    <div 
                        className="w-px h-4 mx-1" 
                        style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                    />

                    {/* Bookmark for PDF */}
                    {pdfControls!.onAddBookmark && (
                        <button
                            onClick={pdfControls!.onAddBookmark}
                            className={cn(
                                "p-1.5 rounded transition-opacity",
                                pdfControls!.isCurrentPageBookmarked ? "opacity-100" : "opacity-60 hover:opacity-100"
                            )}
                            style={{ color: 'var(--reader-fg)' }}
                            title={pdfControls!.isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark page"}
                        >
                            <BookmarkIcon className={cn("w-4 h-4", pdfControls!.isCurrentPageBookmarked && "fill-current")} />
                        </button>
                    )}

                    <button
                        onClick={pdfControls!.onRotate}
                        className="p-1.5 rounded transition-opacity opacity-60 hover:opacity-100"
                        style={{ color: 'var(--reader-fg)' }}
                        title="Rotate"
                    >
                        <RotateCw className="w-4 h-4" />
                    </button>
                </div>
            ) : (
                <div className="flex-1 h-full" data-tauri-drag-region />
            )}

            {/* Right side - Reader controls */}
            <div className="flex items-center gap-1 shrink-0">
                {!hideReaderControls && (
                    <>
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

                        {/* Add Bookmark - Quick add/remove current page */}
                        {onAddBookmark && (
                            <ToolbarButton
                                onClick={onAddBookmark}
                                title={isCurrentPageBookmarked ? "Remove bookmark (Ctrl+D)" : "Bookmark current page (Ctrl+D)"}
                            >
                                <BookmarkIcon 
                                    className={cn("w-4 h-4", isCurrentPageBookmarked && "fill-current")} 
                                />
                            </ToolbarButton>
                        )}

                        {/* View Annotations (Bookmarks & Highlights) */}
                        <ToolbarButton
                            onClick={onToggleBookmarks}
                            active={activePanel === "bookmarks"}
                            title="View Annotations"
                        >
                            <LineSquiggle className="w-4 h-4" />
                        </ToolbarButton>

                        <ToolbarButton
                            onClick={onToggleSettings}
                            active={activePanel === "settings"}
                            title="Reading Settings"
                        >
                            <span className="text-sm font-serif font-bold">Aa</span>
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
                    </>
                )}

                <ToolbarButton
                    onClick={onToggleFullscreen}
                    active={fullscreen}
                    title={fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                >
                    {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
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
