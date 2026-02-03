/**
 * PDFTitlebar - Professional PDF-specific title bar
 * 
 * Features:
 * - Zoom controls (in/out/percentage/fit)
 * - Page navigation with input
 * - Presentation mode
 * - Professional layout like Adobe Reader/Evince
 */

import { useState, useEffect, useCallback } from "react";
import {
    ArrowLeft,
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    Maximize,
    Minus,
    Square,
    X,
    Search,
    RotateCw,
    Download,
    Printer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DocMetadata } from "@/types";

export interface PDFTitlebarProps {
    metadata: DocMetadata | null;
    currentPage: number;
    totalPages: number;
    zoom: number;
    onBack: () => void;
    onPageChange: (page: number) => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomChange: (zoom: number) => void;
    onFitPage: () => void;
    onFitWidth: () => void;
    onRotate?: () => void;
    onSearch?: () => void;
    isSearchOpen?: boolean;
    className?: string;
}

// Zoom presets like professional PDF viewers
const ZOOM_PRESETS = [
    { label: "25%", value: 0.25 },
    { label: "50%", value: 0.5 },
    { label: "75%", value: 0.75 },
    { label: "100%", value: 1 },
    { label: "125%", value: 1.25 },
    { label: "150%", value: 1.5 },
    { label: "200%", value: 2 },
    { label: "300%", value: 3 },
    { label: "400%", value: 4 },
    { label: "Fit Page", value: -1 },
    { label: "Fit Width", value: -2 },
];

function ToolbarButton({
    onClick,
    active,
    disabled,
    title,
    children,
}: {
    onClick?: () => void;
    active?: boolean;
    disabled?: boolean;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={cn(
                "p-1.5 rounded transition-all duration-200 flex items-center justify-center",
                active
                    ? "bg-black/10 dark:bg-white/10 opacity-100"
                    : "opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5",
                disabled && "opacity-30 cursor-not-allowed hover:bg-transparent"
            )}
            style={{ color: "var(--reader-fg)" }}
            title={title}
        >
            {children}
        </button>
    );
}

export function PDFTitlebar({
    metadata,
    currentPage,
    totalPages,
    zoom,
    onBack,
    onPageChange,
    onZoomIn,
    onZoomOut,
    onZoomChange,
    onFitPage,
    onFitWidth,
    onRotate,
    onSearch,
    isSearchOpen,
    className,
}: PDFTitlebarProps) {
    const [isMaximized, setIsMaximized] = useState(false);
    const [showZoomMenu, setShowZoomMenu] = useState(false);
    const [pageInput, setPageInput] = useState(String(currentPage));

    // Sync page input with current page
    useEffect(() => {
        setPageInput(String(currentPage));
    }, [currentPage]);

    // Window state
    useEffect(() => {
        const updateMaximizedState = async () => {
            try {
                const win = getCurrentWebviewWindow();
                const maximized = await win.isMaximized();
                setIsMaximized(maximized);
            } catch {
                const isMax =
                    window.innerWidth === window.screen.availWidth &&
                    window.innerHeight === window.screen.availHeight;
                setIsMaximized(isMax);
            }
        };

        window.addEventListener("resize", updateMaximizedState);
        updateMaximizedState();

        return () => window.removeEventListener("resize", updateMaximizedState);
    }, []);

    const handleMinimize = async () => {
        try {
            const win = getCurrentWebviewWindow();
            await win.minimize();
        } catch (err) {
            console.error("Failed to minimize:", err);
        }
    };

    const handleMaximize = async () => {
        try {
            const win = getCurrentWebviewWindow();
            if (isMaximized) await win.unmaximize();
            else await win.maximize();
        } catch (err) {
            console.error("Failed to maximize:", err);
        }
    };

    const handleClose = async () => {
        try {
            const win = getCurrentWebviewWindow();
            await win.close();
        } catch (err) {
            console.error("Failed to close:", err);
        }
    };

    const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPageInput(e.target.value);
    };

    const handlePageInputSubmit = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            const page = parseInt(pageInput, 10);
            if (!isNaN(page) && page >= 1 && page <= totalPages) {
                onPageChange(page);
            } else {
                setPageInput(String(currentPage));
            }
        }
    };

    const handleZoomSelect = (value: number) => {
        if (value === -1) {
            onFitPage();
        } else if (value === -2) {
            onFitWidth();
        } else {
            onZoomChange(value);
        }
        setShowZoomMenu(false);
    };

    // Format zoom percentage
    const zoomPercent = Math.round(zoom * 100);
    const zoomLabel =
        zoomPercent === Math.round(zoom * 100)
            ? `${zoomPercent}%`
            : `${zoomPercent}%`;

    return (
        <div
            className={cn(
                "w-full z-50 select-none border-b",
                "h-11 flex items-center justify-between px-2",
                className
            )}
            style={{
                backgroundColor: "var(--reader-bg)",
                borderBottomColor:
                    "color-mix(in srgb, var(--reader-fg) 15%, transparent)",
                color: "var(--reader-fg)",
            }}
            data-tauri-drag-region
        >
            {/* Left - Back button and Title */}
            <div
                className="flex items-center gap-2 flex-1 min-w-0"
                data-tauri-drag-region
            >
                <ToolbarButton onClick={onBack} title="Back to Library">
                    <ArrowLeft className="w-4 h-4" />
                </ToolbarButton>

                <div
                    className="w-px h-4 mx-1 shrink-0"
                    style={{
                        backgroundColor:
                            "color-mix(in srgb, var(--reader-fg) 15%, transparent)",
                    }}
                />

                <div
                    className="flex-1 min-w-0 text-left overflow-hidden"
                    data-tauri-drag-region
                >
                    <h1 className="text-sm font-medium truncate">
                        {metadata?.title || "PDF Document"}
                    </h1>
                    {metadata?.author && (
                        <div
                            className="text-xs truncate opacity-60"
                            style={{ color: "var(--reader-fg)" }}
                        >
                            {metadata.author}
                        </div>
                    )}
                </div>
            </div>

            {/* Center - Page Navigation */}
            <div
                className="flex items-center gap-1 px-4"
                data-tauri-drag-region
            >
                <ToolbarButton
                    onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                    disabled={currentPage <= 1}
                    title="Previous page (PageUp)"
                >
                    <ChevronLeft className="w-4 h-4" />
                </ToolbarButton>

                <div className="flex items-center gap-1 mx-1">
                    <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={pageInput}
                        onChange={handlePageInputChange}
                        onKeyDown={handlePageInputSubmit}
                        onBlur={() => setPageInput(String(currentPage))}
                        className="h-7 text-center text-sm rounded border bg-transparent"
                        style={{
                            width: "3rem",
                            borderColor:
                                "color-mix(in srgb, var(--reader-fg) 20%, transparent)",
                            color: "var(--reader-fg)",
                        }}
                    />
                    <span className="text-sm opacity-60 whitespace-nowrap">
                        / {totalPages > 0 ? totalPages : "-"}
                    </span>
                </div>

                <ToolbarButton
                    onClick={() =>
                        onPageChange(Math.min(totalPages, currentPage + 1))
                    }
                    disabled={currentPage >= totalPages}
                    title="Next page (PageDown)"
                >
                    <ChevronRight className="w-4 h-4" />
                </ToolbarButton>
            </div>

            {/* Right - Zoom Controls and Window */}
            <div className="flex items-center gap-1 shrink-0">
                {/* Zoom Out */}
                <ToolbarButton onClick={onZoomOut} title="Zoom out (Ctrl+-)">
                    <ZoomOut className="w-4 h-4" />
                </ToolbarButton>

                {/* Zoom Dropdown */}
                <div className="relative">
                    <button
                        onClick={() => setShowZoomMenu(!showZoomMenu)}
                        className="h-7 px-2 text-sm rounded border min-w-[80px] text-center transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        style={{
                            borderColor:
                                "color-mix(in srgb, var(--reader-fg) 20%, transparent)",
                            color: "var(--reader-fg)",
                        }}
                        title="Select zoom level"
                    >
                        {zoomLabel}
                    </button>

                    {showZoomMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-40"
                                onClick={() => setShowZoomMenu(false)}
                            />
                            <div
                                className="absolute right-0 top-full mt-1 py-1 rounded-lg border shadow-lg z-50 min-w-[120px]"
                                style={{
                                    backgroundColor: "var(--reader-bg)",
                                    borderColor:
                                        "color-mix(in srgb, var(--reader-fg) 15%, transparent)",
                                }}
                            >
                                {ZOOM_PRESETS.map((preset) => (
                                    <button
                                        key={preset.value}
                                        onClick={() =>
                                            handleZoomSelect(preset.value)
                                        }
                                        className={cn(
                                            "w-full px-3 py-1.5 text-sm text-left transition-colors",
                                            "hover:bg-black/5 dark:hover:bg-white/5"
                                        )}
                                        style={{ color: "var(--reader-fg)" }}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Zoom In */}
                <ToolbarButton onClick={onZoomIn} title="Zoom in (Ctrl++)">
                    <ZoomIn className="w-4 h-4" />
                </ToolbarButton>

                <div
                    className="w-px h-4 mx-1"
                    style={{
                        backgroundColor:
                            "color-mix(in srgb, var(--reader-fg) 15%, transparent)",
                    }}
                />

                {/* Fit Page */}
                <ToolbarButton onClick={onFitPage} title="Fit page to window">
                    <Maximize className="w-4 h-4" />
                </ToolbarButton>

                {/* Search */}
                {onSearch && (
                    <ToolbarButton
                        onClick={onSearch}
                        active={isSearchOpen}
                        title="Find (Ctrl+F)"
                    >
                        <Search className="w-4 h-4" />
                    </ToolbarButton>
                )}

                {/* Rotate */}
                {onRotate && (
                    <ToolbarButton onClick={onRotate} title="Rotate clockwise">
                        <RotateCw className="w-4 h-4" />
                    </ToolbarButton>
                )}

                <div
                    className="w-px h-4 mx-1"
                    style={{
                        backgroundColor:
                            "color-mix(in srgb, var(--reader-fg) 15%, transparent)",
                    }}
                />

                {/* Window Controls */}
                <div className="flex items-center gap-0.5">
                    <ToolbarButton onClick={handleMinimize} title="Minimize">
                        <Minus className="w-4 h-4" />
                    </ToolbarButton>
                    <ToolbarButton
                        onClick={handleMaximize}
                        title={isMaximized ? "Restore" : "Maximize"}
                    >
                        <Square className="w-3.5 h-3.5" />
                    </ToolbarButton>
                    <ToolbarButton onClick={handleClose} title="Close">
                        <X className="w-4 h-4" />
                    </ToolbarButton>
                </div>
            </div>
        </div>
    );
}
