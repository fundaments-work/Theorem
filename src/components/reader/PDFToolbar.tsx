/**
 * PDFToolbar Component
 * Toolbar for PDF viewer with page navigation, zoom controls, and search
 */

import { useState, useRef, useEffect } from "react";
import {
    ChevronLeft,
    ChevronRight,
    ZoomOut,
    ZoomIn,
    Search,
    RotateCw,
    RotateCcw,
    MonitorPlay,
    Download,
    Printer,
    ChevronDown,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Dropdown } from "@/components/ui";

interface PDFToolbarProps {
    currentPage: number;
    totalPages: number;
    zoom: number | string;
    onPageChange: (page: number) => void;
    onZoomChange: (zoom: string) => void;
    onSearch?: (query: string) => void;
    onRotateCW?: () => void;
    onRotateCCW?: () => void;
    presentationMode?: boolean;
    onTogglePresentation?: () => void;
    onDownload?: () => void;
    onPrint?: () => void;
    className?: string;
}

const ZOOM_OPTIONS = [
    { value: "auto", label: "Auto" },
    { value: "0.5", label: "50%" },
    { value: "0.75", label: "75%" },
    { value: "1", label: "100%" },
    { value: "1.25", label: "125%" },
    { value: "1.5", label: "150%" },
    { value: "2", label: "200%" },
    { value: "3", label: "300%" },
];

/**
 * PDFToolbar Component
 * Provides controls for PDF viewing: navigation, zoom, search, rotation
 */
export function PDFToolbar({
    currentPage,
    totalPages,
    zoom,
    onPageChange,
    onZoomChange,
    onSearch,
    onRotateCW,
    onRotateCCW,
    presentationMode,
    onTogglePresentation,
    onDownload,
    onPrint,
    className,
}: PDFToolbarProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [pageInput, setPageInput] = useState(String(currentPage));
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Sync page input with currentPage prop
    useEffect(() => {
        setPageInput(String(currentPage));
    }, [currentPage]);

    // Focus search input when opened
    useEffect(() => {
        if (isSearchOpen && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [isSearchOpen]);

    const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        // Only allow numbers
        if (/^\d*$/.test(value)) {
            setPageInput(value);
        }
    };

    const handlePageInputBlur = () => {
        const page = parseInt(pageInput, 10);
        if (page >= 1 && page <= totalPages) {
            onPageChange(page);
        } else {
            setPageInput(String(currentPage));
        }
    };

    const handlePageInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            handlePageInputBlur();
            (e.target as HTMLInputElement).blur();
        }
    };

    const handlePreviousPage = () => {
        if (currentPage > 1) {
            onPageChange(currentPage - 1);
        }
    };

    const handleNextPage = () => {
        if (currentPage < totalPages) {
            onPageChange(currentPage + 1);
        }
    };

    const handleZoomOut = () => {
        const currentZoom = typeof zoom === "string" ? parseFloat(zoom) : zoom;
        const zoomLevels = ZOOM_OPTIONS.filter((o) => o.value !== "auto").map((o) =>
            parseFloat(o.value)
        );
        const newZoom = zoomLevels.reverse().find((z) => z < currentZoom);
        if (newZoom) {
            onZoomChange(String(newZoom));
        }
    };

    const handleZoomIn = () => {
        const currentZoom = typeof zoom === "string" ? parseFloat(zoom) : zoom;
        const zoomLevels = ZOOM_OPTIONS.filter((o) => o.value !== "auto").map((o) =>
            parseFloat(o.value)
        );
        const newZoom = zoomLevels.find((z) => z > currentZoom);
        if (newZoom) {
            onZoomChange(String(newZoom));
        }
    };

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (onSearch && searchQuery.trim()) {
            onSearch(searchQuery.trim());
        }
    };

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Escape") {
            setIsSearchOpen(false);
            setSearchQuery("");
        }
    };

    const getZoomValue = () => {
        if (typeof zoom === "number") {
            return String(zoom);
        }
        return zoom;
    };

    const getZoomLabel = () => {
        const zoomValue = getZoomValue();
        const option = ZOOM_OPTIONS.find((o) => o.value === zoomValue);
        return option?.label || `${Math.round(parseFloat(zoomValue) * 100)}%`;
    };

    return (
        <div
            className={cn(
                "relative w-full z-20",
                "h-14 px-4 flex items-center justify-between flex-shrink-0",
                "bg-[var(--color-surface)]/95 backdrop-blur-lg",
                "border-b border-[var(--color-border)]",
                className
            )}
        >
            {/* Left Section: Page Navigation */}
            <div className="flex items-center gap-2">
                <button
                    onClick={handlePreviousPage}
                    disabled={currentPage <= 1}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]",
                        "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                    title="Previous page"
                >
                    <ChevronLeft className="w-5 h-5 text-[var(--color-text-primary)]" />
                </button>

                <div className="flex items-center gap-1.5 px-2">
                    <input
                        type="text"
                        value={pageInput}
                        onChange={handlePageInputChange}
                        onBlur={handlePageInputBlur}
                        onKeyDown={handlePageInputKeyDown}
                        className={cn(
                            "w-12 h-8 px-2 text-center text-sm",
                            "bg-[var(--color-background)]",
                            "border border-[var(--color-border)] rounded-md",
                            "text-[var(--color-text-primary)]",
                            "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
                        )}
                    />
                    <span className="text-sm text-[var(--color-text-muted)]">
                        / {totalPages}
                    </span>
                </div>

                <button
                    onClick={handleNextPage}
                    disabled={currentPage >= totalPages}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]",
                        "disabled:opacity-40 disabled:cursor-not-allowed"
                    )}
                    title="Next page"
                >
                    <ChevronRight className="w-5 h-5 text-[var(--color-text-primary)]" />
                </button>
            </div>

            {/* Center Section: Zoom Controls */}
            <div className="flex items-center gap-1">
                <button
                    onClick={handleZoomOut}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]"
                    )}
                    title="Zoom out"
                >
                    <ZoomOut className="w-5 h-5 text-[var(--color-text-primary)]" />
                </button>

                <Dropdown
                    options={ZOOM_OPTIONS}
                    value={getZoomValue()}
                    onChange={onZoomChange}
                    size="sm"
                    variant="filled"
                    className="w-24"
                    align="left"
                />

                <button
                    onClick={handleZoomIn}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]"
                    )}
                    title="Zoom in"
                >
                    <ZoomIn className="w-5 h-5 text-[var(--color-text-primary)]" />
                </button>
            </div>

            {/* Right Section: Search, Rotate, Presentation, Download/Print */}
            <div className="flex items-center gap-1">
                {/* Search */}
                <div className="relative">
                    {isSearchOpen ? (
                        <form
                            onSubmit={handleSearchSubmit}
                            className={cn(
                                "flex items-center gap-2",
                                "bg-[var(--color-background)]",
                                "border border-[var(--color-border)] rounded-lg",
                                "px-2 py-1.5 animate-fade-in"
                            )}
                        >
                            <Search className="w-4 h-4 text-[var(--color-text-muted)]" />
                            <input
                                ref={searchInputRef}
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                                placeholder="Find in document..."
                                className={cn(
                                    "w-40 bg-transparent text-sm",
                                    "text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                                    "focus:outline-none"
                                )}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    setIsSearchOpen(false);
                                    setSearchQuery("");
                                }}
                                className="p-1 rounded hover:bg-[var(--color-border-subtle)]"
                            >
                                <X className="w-4 h-4 text-[var(--color-text-muted)]" />
                            </button>
                        </form>
                    ) : (
                        <button
                            onClick={() => setIsSearchOpen(true)}
                            className={cn(
                                "p-2 rounded-lg transition-colors",
                                "hover:bg-[var(--color-background)]"
                            )}
                            title="Search in document"
                        >
                            <Search className="w-5 h-5 text-[var(--color-text-primary)]" />
                        </button>
                    )}
                </div>

                <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

                {/* Rotate Counter-Clockwise */}
                {onRotateCCW && (
                    <button
                        onClick={onRotateCCW}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-background)]"
                        )}
                        title="Rotate counter-clockwise"
                    >
                        <RotateCcw className="w-5 h-5 text-[var(--color-text-primary)]" />
                    </button>
                )}

                {/* Rotate Clockwise */}
                {onRotateCW && (
                    <button
                        onClick={onRotateCW}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-background)]"
                        )}
                        title="Rotate clockwise"
                    >
                        <RotateCw className="w-5 h-5 text-[var(--color-text-primary)]" />
                    </button>
                )}

                {/* Presentation Mode */}
                {onTogglePresentation && (
                    <button
                        onClick={onTogglePresentation}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            presentationMode
                                ? "bg-[var(--color-accent)] text-[var(--color-background)]"
                                : "hover:bg-[var(--color-background)] text-[var(--color-text-primary)]"
                        )}
                        title={presentationMode ? "Exit presentation mode" : "Presentation mode"}
                    >
                        <MonitorPlay className="w-5 h-5" />
                    </button>
                )}

                <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

                {/* Download */}
                {onDownload && (
                    <button
                        onClick={onDownload}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-background)]"
                        )}
                        title="Download PDF"
                    >
                        <Download className="w-5 h-5 text-[var(--color-text-primary)]" />
                    </button>
                )}

                {/* Print */}
                {onPrint && (
                    <button
                        onClick={onPrint}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-background)]"
                        )}
                        title="Print"
                    >
                        <Printer className="w-5 h-5 text-[var(--color-text-primary)]" />
                    </button>
                )}
            </div>
        </div>
    );
}

export default PDFToolbar;
