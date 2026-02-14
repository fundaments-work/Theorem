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
    PenLine,
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
import { HIGHLIGHT_SOLID_COLORS } from "../../../core";
import { cn, normalizeAuthor } from "../../../core";
import { isTauri } from "../../../core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DocMetadata, DocLocation, HighlightColor } from "../../../core";

interface WindowTitlebarProps {
    metadata: DocMetadata | null;
    location?: DocLocation | null;
    onBack: () => void;
    onPrevPage?: () => void;
    onNextPage?: () => void;
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
    /** When true, switches the center toolbar to PDF-specific controls */
    hideReaderControls?: boolean;
    /** PDF-specific controls - only used when hideReaderControls is true */
    pdfControls?: {
        currentPage: number;
        totalPages: number;
        zoom: number;
        zoomMode?: 'custom' | 'page-fit' | 'width-fit';
        annotationMode?: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
        highlightColor?: HighlightColor;
        penColor?: HighlightColor;
        penWidth?: number;
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
        onHighlightColorChange?: (color: HighlightColor) => void;
        onPenColorChange?: (color: HighlightColor) => void;
        onPenWidthChange?: (width: number) => void;
        isCurrentPageBookmarked?: boolean;
    };
}

const ICON_BUTTON_CLASS = "inline-flex h-9 w-9 shrink-0 items-center justify-center border border-transparent bg-transparent p-0 text-[color:var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)]";
const ICON_BUTTON_ACTIVE_CLASS = "border-[var(--color-text-primary)] bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]";
const ICON_BUTTON_INACTIVE_CLASS = "border-transparent text-[color:var(--color-text-secondary)]";

function ToolbarButton({
    onClick,
    active,
    title,
    className,
    children,
}: {
    onClick?: () => void;
    active?: boolean;
    title: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                ICON_BUTTON_CLASS,
                active ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_INACTIVE_CLASS,
                className,
            )}
            style={{ color: "var(--reader-fg)" }}
            title={title}
        >
            {children}
        </button>
    );
}

function WindowControlButton({
    onClick,
    title,
    danger = false,
    children,
}: {
    onClick: () => void;
    title: string;
    danger?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "inline-flex h-8 w-8 items-center justify-center border border-transparent bg-transparent p-0 text-[color:var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)]",
                danger
                    ? "hover:bg-[color:color-mix(in_srgb,var(--color-error)_14%,transparent)] hover:text-[color:var(--color-error)]"
                    : "text-[color:var(--color-text-secondary)]",
            )}
            style={{ color: "var(--reader-fg)" }}
            title={title}
        >
            {children}
        </button>
    );
}

const annotationColorSwatches: Array<{ color: HighlightColor; label: string; fill: string }> = [
    { color: "yellow", label: "Yellow", fill: HIGHLIGHT_SOLID_COLORS.yellow },
    { color: "green", label: "Green", fill: HIGHLIGHT_SOLID_COLORS.green },
    { color: "blue", label: "Blue", fill: HIGHLIGHT_SOLID_COLORS.blue },
    { color: "red", label: "Red", fill: HIGHLIGHT_SOLID_COLORS.red },
    { color: "orange", label: "Orange", fill: HIGHLIGHT_SOLID_COLORS.orange },
    { color: "purple", label: "Purple", fill: HIGHLIGHT_SOLID_COLORS.purple },
];
const BRUSH_WIDTH_OPTIONS = [1, 2, 4, 6];

export function WindowTitlebar({
    metadata,
    location,
    onBack,
    onPrevPage,
    onNextPage,
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
    const activeHighlightColor = pdfControls?.highlightColor || "yellow";
    const activePenColor = pdfControls?.penColor || "blue";
    const activePenWidth = pdfControls?.penWidth || 2;
    const isTauriRuntime = isTauri();

    useEffect(() => {
        if (isPdfMode) {
            return;
        }
        setShowZoomMenu(false);
    }, [isPdfMode]);

    // Listen for window state changes
    useEffect(() => {
        if (!isTauriRuntime) {
            return;
        }

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
    }, [isTauriRuntime]);

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
        if (!isTauriRuntime) {
            return;
        }
        try {
            const win = getCurrentWebviewWindow();
            await win.minimize();
        } catch (err) {
            console.error("Failed to minimize window:", err);
        }
    };

    const handleMaximize = async () => {
        if (!isTauriRuntime) {
            return;
        }
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
        if (!isTauriRuntime) {
            return;
        }
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
                "w-full z-50 select-none border-b-2 reader-toolbar",
                "min-h-11 flex flex-col items-stretch gap-1 px-2 py-1",
                "pt-[max(var(--spacing-xxs),env(safe-area-inset-top))]",
                "lg:h-11 lg:min-h-0 lg:flex-row lg:items-center lg:justify-between lg:gap-0 lg:py-0",
                "bg-[var(--color-surface)] border-[var(--color-border)]",
                className
            )}
            style={{
                backgroundColor: 'var(--reader-bg, var(--color-surface))',
                borderBottomColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)',
            }}
        >
            {/* Left side - Title area */}
            <div className="flex items-center gap-2 w-full min-w-0 lg:flex-1">
                <button
                    onClick={onBack}
                    className={ICON_BUTTON_CLASS}
                    style={{ color: 'var(--reader-fg, var(--color-text))' }}
                    title="Back to Library"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>

                <div 
                    className="hidden lg:block w-px h-4 mx-1 shrink-0"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                />

                <div className="flex-1 min-w-0 text-left overflow-hidden">
                    <h1 
                        className="text-sm font-medium truncate"
                        style={{ color: 'var(--reader-fg, var(--color-text))' }}
                    >
                        {metadata?.title || "Loading..."}
                    </h1>
                    <div className="hidden sm:flex items-center gap-1.5 text-xs">
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
                                {normalizeAuthor(metadata.author)}
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

            {/* Center - Reader Controls */}
            {isPdfMode ? (
                <div className="w-full overflow-x-auto overflow-y-visible reader-toolbar-scroll lg:w-auto">
                    <div className="my-0.5 mr-1 flex items-center gap-1 shrink-0 min-w-max" data-toolbar-group>
                    <button
                        onClick={pdfControls!.onPrevPage}
                        disabled={pdfControls!.currentPage <= 1}
                        className={cn(
                            ICON_BUTTON_CLASS,
                            ICON_BUTTON_INACTIVE_CLASS,
                            "disabled:opacity-30 disabled:cursor-not-allowed",
                        )}
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
                                className="w-12 px-1 py-0.5 text-xs text-center rounded-lg"
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
                            className="px-3 py-1 border-2 border-transparent text-xs font-medium hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] transition-colors"
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
                        className={cn(
                            ICON_BUTTON_CLASS,
                            ICON_BUTTON_INACTIVE_CLASS,
                            "disabled:opacity-30 disabled:cursor-not-allowed",
                        )}
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
                        onClick={onToggleToc}
                        className={cn(
                            ICON_BUTTON_CLASS,
                            activePanel === "toc" ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_INACTIVE_CLASS,
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Table of contents"
                    >
                        <List className="w-4 h-4" />
                    </button>

                    <button
                        onClick={onToggleSearch}
                        className={cn(
                            ICON_BUTTON_CLASS,
                            activePanel === "search" ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_INACTIVE_CLASS,
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Search in document"
                    >
                        <Search className="w-4 h-4" />
                    </button>

                    <button
                        onClick={onToggleBookmarks}
                        className={cn(
                            ICON_BUTTON_CLASS,
                            activePanel === "bookmarks" ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_INACTIVE_CLASS,
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Annotations & bookmarks"
                    >
                        <PenLine className="w-4 h-4" />
                    </button>

                    <div 
                        className="w-px h-4 mx-1" 
                        style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                    />

                    <button
                        onClick={pdfControls!.onZoomOut}
                        className={cn(ICON_BUTTON_CLASS, ICON_BUTTON_INACTIVE_CLASS)}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Zoom out"
                    >
                        <ZoomOut className="w-4 h-4" />
                    </button>

                    {/* Zoom with dropdown menu */}
                    <div className="relative hidden sm:block">
                        <button
                            onClick={() => setShowZoomMenu(!showZoomMenu)}
                            className="px-3 py-1 border-2 border-transparent text-xs font-medium flex items-center gap-1 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] transition-colors"
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
                                    className="absolute top-full right-0 mt-1 py-1 border border-[var(--color-border)] bg-[var(--color-surface)] z-50 min-w-[var(--layout-popover-min-width)]"
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
                        onClick={pdfControls!.onZoomReset}
                        className="sm:hidden px-3 py-1 border-2 border-transparent text-xs font-medium hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] transition-colors"
                        style={{ color: 'var(--reader-fg)' }}
                        title="Reset zoom"
                    >
                        {Math.round(pdfControls!.zoom * 100)}%
                    </button>

                    <button
                        onClick={pdfControls!.onZoomIn}
                        className={cn(ICON_BUTTON_CLASS, ICON_BUTTON_INACTIVE_CLASS)}
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
                    <div className="relative">
                        <button
                            onClick={() => {
                                if (pdfControls!.annotationMode !== "highlight") {
                                    pdfControls!.onAnnotationModeChange?.("highlight");
                                    return;
                                }
                                pdfControls!.onAnnotationModeChange?.("none");
                            }}
                            className={cn(
                                "relative",
                                ICON_BUTTON_CLASS,
                                pdfControls!.annotationMode === 'highlight'
                                    ? ICON_BUTTON_ACTIVE_CLASS
                                    : ICON_BUTTON_INACTIVE_CLASS,
                            )}
                            style={{ color: 'var(--reader-fg)' }}
                            title="Highlight text"
                        >
                            <Highlighter className="w-4 h-4" />
                            <span
                                className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full border border-[var(--color-overlay-medium)]"
                                style={{
                                    backgroundColor: annotationColorSwatches.find(
                                        (swatch) => swatch.color === activeHighlightColor,
                                    )?.fill || HIGHLIGHT_SOLID_COLORS.yellow,
                                }}
                            />
                        </button>
                    </div>

                    {pdfControls!.annotationMode === "highlight" && (
                        <div
                            className="flex items-center gap-1 px-1 py-0.5 rounded-md"
                            style={{ backgroundColor: "color-mix(in srgb, var(--reader-fg, var(--color-text)) 8%, transparent)" }}
                        >
                            {annotationColorSwatches.map((swatch) => (
                                <button
                                    key={swatch.color}
                                    onClick={() => {
                                        pdfControls!.onHighlightColorChange?.(swatch.color);
                                        pdfControls!.onAnnotationModeChange?.("highlight");
                                    }}
                                    className={cn(
                                        "w-3.5 h-3.5 rounded-full  transition-transform",
                                        activeHighlightColor === swatch.color
                                            ? "scale-110"
                                            : "hover:scale-110",
                                    )}
                                    style={{
                                        backgroundColor: swatch.fill,
                                        borderColor: activeHighlightColor === swatch.color
                                            ? "color-mix(in srgb, var(--reader-fg, var(--color-text)) 45%, transparent)"
                                            : "color-mix(in srgb, var(--reader-fg, var(--color-text)) 20%, transparent)",
                                    }}
                                    title={swatch.label}
                                />
                            ))}
                        </div>
                    )}

                    <button
                        onClick={() => {
                            pdfControls!.onAnnotationModeChange?.(
                                pdfControls!.annotationMode === 'pen' ? 'none' : 'pen',
                            );
                        }}
                        className={cn(
                            "relative",
                            ICON_BUTTON_CLASS,
                            pdfControls!.annotationMode === 'pen' ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_INACTIVE_CLASS,
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Draw with pen"
                    >
                        <Pencil className="w-4 h-4" />
                        <span
                            className="absolute -right-0.5 -bottom-0.5 rounded-full border border-[var(--color-overlay-medium)]"
                            style={{
                                width: `${Math.max(5, Math.min(9, 3 + activePenWidth))}px`,
                                height: `${Math.max(5, Math.min(9, 3 + activePenWidth))}px`,
                                backgroundColor: annotationColorSwatches.find(
                                    (swatch) => swatch.color === activePenColor,
                                )?.fill || HIGHLIGHT_SOLID_COLORS.blue,
                            }}
                        />
                    </button>

                    {pdfControls!.annotationMode === "pen" && (
                        <div
                            className="flex items-center gap-1 px-1 py-0.5 rounded-md"
                            style={{ backgroundColor: "color-mix(in srgb, var(--reader-fg, var(--color-text)) 8%, transparent)" }}
                        >
                            {annotationColorSwatches.map((swatch) => (
                                <button
                                    key={`pen-${swatch.color}`}
                                    onClick={() => {
                                        pdfControls!.onPenColorChange?.(swatch.color);
                                        pdfControls!.onAnnotationModeChange?.("pen");
                                    }}
                                    className={cn(
                                        "w-3.5 h-3.5 rounded-full border transition-transform",
                                        activePenColor === swatch.color
                                            ? "scale-110"
                                            : "hover:scale-110",
                                    )}
                                    style={{
                                        backgroundColor: swatch.fill,
                                        borderColor: activePenColor === swatch.color
                                            ? "color-mix(in srgb, var(--reader-fg, var(--color-text)) 45%, transparent)"
                                            : "color-mix(in srgb, var(--reader-fg, var(--color-text)) 20%, transparent)",
                                    }}
                                    title={`${swatch.label} pen`}
                                />
                            ))}
                            <div
                                className="w-px h-3 mx-0.5"
                                style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 22%, transparent)' }}
                            />
                            {BRUSH_WIDTH_OPTIONS.map((width) => (
                                <button
                                    key={`brush-width-${width}`}
                                    onClick={() => {
                                        pdfControls!.onPenWidthChange?.(width);
                                        pdfControls!.onAnnotationModeChange?.("pen");
                                    }}
                                    className={cn(
                                        "h-5 px-1.5 rounded-lg border transition-colors",
                                        activePenWidth === width
                                            ? "opacity-100 bg-[var(--color-accent)]/20"
                                            : "opacity-75 hover:opacity-100",
                                    )}
                                    style={{
                                        borderColor: activePenWidth === width
                                            ? "color-mix(in srgb, var(--reader-fg, var(--color-text)) 35%, transparent)"
                                            : "color-mix(in srgb, var(--reader-fg, var(--color-text)) 18%, transparent)",
                                        color: "var(--reader-fg)",
                                    }}
                                    title={`Brush width ${width}px`}
                                >
                                    <span
                                        className="block rounded-full"
                                        style={{
                                            width: "10px",
                                            height: `${Math.max(2, width)}px`,
                                            backgroundColor: annotationColorSwatches.find(
                                                (swatch) => swatch.color === activePenColor,
                                            )?.fill || HIGHLIGHT_SOLID_COLORS.blue,
                                        }}
                                    />
                                </button>
                            ))}
                        </div>
                    )}

                    <button
                        onClick={() => {
                            pdfControls!.onAnnotationModeChange?.(
                                pdfControls!.annotationMode === 'text' ? 'none' : 'text',
                            );
                        }}
                        className={cn(
                            ICON_BUTTON_CLASS,
                            pdfControls!.annotationMode === 'text' ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_INACTIVE_CLASS,
                        )}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Add text annotation"
                    >
                        <Type className="w-4 h-4" />
                    </button>

                    <button
                        onClick={() => {
                            pdfControls!.onAnnotationModeChange?.(
                                pdfControls!.annotationMode === 'erase' ? 'none' : 'erase',
                            );
                        }}
                        className={cn(
                            ICON_BUTTON_CLASS,
                            pdfControls!.annotationMode === 'erase' ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_INACTIVE_CLASS,
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
                                ICON_BUTTON_CLASS,
                                pdfControls!.isCurrentPageBookmarked ? "opacity-100" : ICON_BUTTON_INACTIVE_CLASS,
                            )}
                            style={{ color: 'var(--reader-fg)' }}
                            title={pdfControls!.isCurrentPageBookmarked ? "Remove bookmark" : "Bookmark page"}
                        >
                            <BookmarkIcon className={cn("w-4 h-4", pdfControls!.isCurrentPageBookmarked && "fill-current")} />
                        </button>
                    )}

                    <button
                        onClick={pdfControls!.onRotate}
                        className={cn(ICON_BUTTON_CLASS, ICON_BUTTON_INACTIVE_CLASS)}
                        style={{ color: 'var(--reader-fg)' }}
                        title="Rotate"
                    >
                        <RotateCw className="w-4 h-4" />
                    </button>

                    </div>
                </div>
            ) : (
                <div className="w-full overflow-x-auto overflow-y-visible reader-toolbar-scroll lg:w-auto">
                    <div className="my-0.5 mr-1 flex items-center gap-1 shrink-0 min-w-max" data-toolbar-group="epub">
                        <button
                            onClick={onPrevPage}
                            disabled={!onPrevPage}
                            className={cn(
                                ICON_BUTTON_CLASS,
                                ICON_BUTTON_INACTIVE_CLASS,
                                "disabled:opacity-30 disabled:cursor-not-allowed",
                            )}
                            style={{ color: 'var(--reader-fg)' }}
                            title="Previous page"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        <button
                            onClick={onNextPage}
                            disabled={!onNextPage}
                            className={cn(
                                ICON_BUTTON_CLASS,
                                ICON_BUTTON_INACTIVE_CLASS,
                                "disabled:opacity-30 disabled:cursor-not-allowed",
                            )}
                            style={{ color: 'var(--reader-fg)' }}
                            title="Next page"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>

                        <div
                            className="w-px h-4 mx-1"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                        />

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
                            className="lg:hidden"
                        >
                            <Search className="w-4 h-4" />
                        </ToolbarButton>

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

                        <ToolbarButton
                            onClick={onToggleBookmarks}
                            active={activePanel === "bookmarks"}
                            title="View Annotations"
                        >
                            <PenLine className="w-4 h-4" />
                        </ToolbarButton>

                        <ToolbarButton
                            onClick={onToggleSettings}
                            active={activePanel === "settings"}
                            title="Reading Settings"
                        >
                            <Type className="w-4 h-4" />
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

                    </div>
                </div>
            )}

            {/* Right side - Window controls */}
            <div
                className={cn(
                    "overflow-x-auto overflow-y-visible reader-toolbar-scroll",
                    isTauriRuntime
                        ? "hidden lg:block lg:w-auto"
                        : onToggleFullscreen
                            ? "hidden xl:block xl:w-auto"
                            : "hidden",
                )}
            >
                <div
                    className={cn(
                        "flex items-center shrink-0 min-w-max mx-auto sm:mx-0",
                        "gap-1",
                    )}
                >
                    {/* Window Controls */}
                    {isTauriRuntime && (
                        <div
                            className="hidden lg:flex items-center gap-0.5 rounded-lg  px-1 py-0.5 mr-1"
                            style={{
                            }}
                        >
                            {onToggleFullscreen && (
                                <>
                                    <WindowControlButton
                                        onClick={onToggleFullscreen}
                                        title={fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                                    >
                                        {fullscreen ? (
                                            <Minimize2 className="w-4 h-4" />
                                        ) : (
                                            <Maximize2 className="w-4 h-4" />
                                        )}
                                    </WindowControlButton>
                                    <div
                                        className="w-px h-4 mx-0.5"
                                        style={{
                                            backgroundColor:
                                                "color-mix(in srgb, var(--reader-fg, var(--color-text)) 20%, transparent)",
                                        }}
                                    />
                                </>
                            )}
                            <WindowControlButton onClick={handleMinimize} title="Minimize">
                                <Minus className="w-4 h-4" />
                            </WindowControlButton>
                            <WindowControlButton
                                onClick={handleMaximize}
                                title={isMaximized ? "Restore" : "Maximize"}
                            >
                                <Square className="w-3.5 h-3.5" />
                            </WindowControlButton>
                            <WindowControlButton onClick={handleClose} title="Close" danger>
                                <X className="w-4 h-4" />
                            </WindowControlButton>
                        </div>
                    )}

                    {!isTauriRuntime && onToggleFullscreen && (
                        <div
                            className="hidden xl:flex items-center gap-0.5 rounded-lg border px-1 py-0.5 mr-1"
                            style={{
                                borderColor: "color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)",
                                backgroundColor: "color-mix(in srgb, var(--reader-fg, var(--color-text)) 5%, transparent)",
                            }}
                        >
                            <WindowControlButton
                                onClick={onToggleFullscreen}
                                title={fullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                            >
                                {fullscreen ? (
                                    <Minimize2 className="w-4 h-4" />
                                ) : (
                                    <Maximize2 className="w-4 h-4" />
                                )}
                            </WindowControlButton>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default WindowTitlebar;
