/**
 * PDFReader Component
 *
 * A complete PDF reader page component that integrates PDFJsEngine with
 * a toolbar, theme support, loading states, and error handling.
 *
 * @module components/reader/PDFReader
 */

import {
    useRef,
    useState,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from "react";
import {
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    RotateCw,
    Search,
    FileText,
    Loader2,
    AlertCircle,
} from "lucide-react";
import { PDFJsEngine, type PDFJsEngineRef, type PDFDocumentInfo } from "@/engines/pdfjs-engine";
import { cn } from "@/lib/utils";
import type { ReaderTheme } from "@/types";

// ============================================================================
// Types
// ============================================================================

interface PDFReaderProps {
    /** Absolute path to the PDF file */
    pdfPath: string;
    /** Optional PDF data as Uint8Array (takes precedence over pdfPath) */
    pdfData?: Uint8Array;
    /** Theme mode for the reader */
    theme?: ReaderTheme;
    /** Callback when page changes */
    onPageChange?: (page: number, totalPages: number) => void;
    /** Callback when PDF is loaded */
    onLoad?: (info: PDFDocumentInfo) => void;
    /** Callback when an error occurs */
    onError?: (error: Error) => void;
}

interface PDFToolbarProps {
    /** Current page number */
    currentPage: number;
    /** Total number of pages */
    totalPages: number;
    /** Current zoom scale (1.0 = 100%) */
    scale: number;
    /** Document title */
    title?: string;
    /** Whether the PDF is loading */
    isLoading: boolean;
    /** Navigate to previous page */
    onPrevPage: () => void;
    /** Navigate to next page */
    onNextPage: () => void;
    /** Zoom in */
    onZoomIn: () => void;
    /** Zoom out */
    onZoomOut: () => void;
    /** Reset zoom to 100% */
    onZoomReset: () => void;
    /** Rotate pages clockwise */
    onRotate: () => void;
    /** Toggle search panel */
    onToggleSearch?: () => void;
    /** Navigate to specific page */
    onPageInput?: (page: number) => void;
}

// ============================================================================
// PDF Toolbar Component
// ============================================================================

/**
 * Toolbar component for PDF controls including navigation, zoom, and rotation
 */
function PDFToolbar({
    currentPage,
    totalPages,
    scale,
    title,
    isLoading,
    onPrevPage,
    onNextPage,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onRotate,
    onToggleSearch,
    onPageInput,
}: PDFToolbarProps) {
    const [inputPage, setInputPage] = useState<string>("");
    const [showPageInput, setShowPageInput] = useState(false);

    const handlePageSubmit = useCallback(
        (e: React.FormEvent) => {
            e.preventDefault();
            const page = parseInt(inputPage, 10);
            if (page >= 1 && page <= totalPages) {
                onPageInput?.(page);
            }
            setShowPageInput(false);
            setInputPage("");
        },
        [inputPage, totalPages, onPageInput]
    );

    const zoomPercentage = Math.round(scale * 100);

    return (
        <div
            className={cn(
                "h-14 px-4 flex items-center justify-between flex-shrink-0",
                "bg-[var(--color-surface)]/95 backdrop-blur-lg",
                "border-b border-[var(--color-border)]",
                "transition-colors duration-200"
            )}
        >
            {/* Left: Title */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="p-2 rounded-lg bg-[var(--color-accent)]/10">
                    <FileText className="w-5 h-5 text-[var(--color-accent)]" />
                </div>
                <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {title || "PDF Document"}
                </span>
            </div>

            {/* Center: Page Navigation */}
            <div className="flex items-center gap-2">
                <button
                    onClick={onPrevPage}
                    disabled={isLoading || currentPage <= 1}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                        "text-[var(--color-text-primary)]"
                    )}
                    title="Previous page"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>

                {showPageInput ? (
                    <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
                        <input
                            type="number"
                            min={1}
                            max={totalPages}
                            value={inputPage}
                            onChange={(e) => setInputPage(e.target.value)}
                            onBlur={() => {
                                setShowPageInput(false);
                                setInputPage("");
                            }}
                            autoFocus
                            className={cn(
                                "w-16 px-2 py-1 text-sm text-center rounded",
                                "bg-[var(--color-background)]",
                                "border border-[var(--color-border)]",
                                "text-[var(--color-text-primary)]",
                                "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20"
                            )}
                        />
                        <span className="text-sm text-[var(--color-text-secondary)]">
                            / {totalPages}
                        </span>
                    </form>
                ) : (
                    <button
                        onClick={() => {
                            setInputPage(currentPage.toString());
                            setShowPageInput(true);
                        }}
                        className="px-3 py-1.5 rounded-lg hover:bg-[var(--color-background)] transition-colors min-w-[80px]"
                        title="Click to jump to page"
                    >
                        <span className="text-sm text-[var(--color-text-primary)]">
                            {currentPage} / {totalPages}
                        </span>
                    </button>
                )}

                <button
                    onClick={onNextPage}
                    disabled={isLoading || currentPage >= totalPages}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                        "text-[var(--color-text-primary)]"
                    )}
                    title="Next page"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>

            {/* Right: Zoom & Tools */}
            <div className="flex items-center gap-1 flex-1 justify-end">
                {onToggleSearch && (
                    <button
                        onClick={onToggleSearch}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-background)]",
                            "text-[var(--color-text-primary)]"
                        )}
                        title="Search"
                    >
                        <Search className="w-5 h-5" />
                    </button>
                )}

                <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

                <button
                    onClick={onZoomOut}
                    disabled={isLoading}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                        "text-[var(--color-text-primary)]"
                    )}
                    title="Zoom out"
                >
                    <ZoomOut className="w-5 h-5" />
                </button>

                <button
                    onClick={onZoomReset}
                    disabled={isLoading}
                    className={cn(
                        "px-3 py-1.5 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                        "text-sm font-medium text-[var(--color-text-primary)]",
                        "min-w-[60px]"
                    )}
                    title="Reset zoom"
                >
                    {zoomPercentage}%
                </button>

                <button
                    onClick={onZoomIn}
                    disabled={isLoading}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                        "text-[var(--color-text-primary)]"
                    )}
                    title="Zoom in"
                >
                    <ZoomIn className="w-5 h-5" />
                </button>

                <div className="w-px h-6 bg-[var(--color-border)] mx-1" />

                <button
                    onClick={onRotate}
                    disabled={isLoading}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-[var(--color-background)]",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                        "text-[var(--color-text-primary)]"
                    )}
                    title="Rotate"
                >
                    <RotateCw className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}

// ============================================================================
// Loading State Component
// ============================================================================

/**
 * Loading spinner with message
 */
function LoadingState({ message = "Loading PDF..." }: { message?: string }) {
    return (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface)] z-20">
            <div className="flex flex-col items-center gap-4">
                <div className="relative">
                    <Loader2 className="w-10 h-10 animate-spin text-[var(--color-accent)]" />
                </div>
                <span className="text-sm text-[var(--color-text-secondary)]">{message}</span>
            </div>
        </div>
    );
}

// ============================================================================
// Error State Component
// ============================================================================

/**
 * Error display with message
 */
function ErrorState({
    error,
    onRetry,
}: {
    error: string;
    onRetry?: () => void;
}) {
    return (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface)] z-20">
            <div className="flex flex-col items-center gap-4 max-w-md text-center p-8">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                    <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                </div>
                <h3 className="text-lg font-medium text-[var(--color-text-primary)]">
                    Failed to load PDF
                </h3>
                <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
                {onRetry && (
                    <button
                        onClick={onRetry}
                        className={cn(
                            "mt-4 px-4 py-2 rounded-lg",
                            "bg-[var(--color-accent)] text-white",
                            "hover:bg-[var(--color-accent-hover)]",
                            "transition-colors text-sm font-medium"
                        )}
                    >
                        Try Again
                    </button>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// Main PDFReader Component
// ============================================================================

/**
 * PDFReader - A complete PDF reader page component
 *
 * Features:
 * - Full PDF rendering with PDF.js
 * - Toolbar with navigation, zoom, and rotation controls
 * - Theme integration (light/sepia/dark)
 * - Loading and error states
 * - Exposes PDFJsEngine methods via ref
 *
 * @example
 * ```tsx
 * const pdfRef = useRef<PDFJsEngineRef>(null);
 *
 * return (
 *   <PDFReader
 *     ref={pdfRef}
 *     pdfPath="/path/to/document.pdf"
 *     theme="dark"
 *     onPageChange={(page, total) => console.log(`Page ${page} of ${total}`)}
 *     onLoad={(info) => console.log(`Loaded ${info.title}`)}
 *     onError={(err) => console.error(err)}
 *   />
 * );
 * ```
 */
export const PDFReader = forwardRef<PDFJsEngineRef, PDFReaderProps>(
    function PDFReader(
        {
            pdfPath,
            pdfData,
            theme = "light",
            onPageChange,
            onLoad,
            onError,
        },
        ref
    ) {
        // Ref to the PDFJsEngine component
        const engineRef = useRef<PDFJsEngineRef>(null);

        // Local state for UI
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [currentPage, setCurrentPage] = useState(1);
        const [totalPages, setTotalPages] = useState(0);
        const [scale, setScale] = useState(1);
        const [documentTitle, setDocumentTitle] = useState<string>("");

        // Expose the engine's imperative handle through our ref
        useImperativeHandle(ref, () => ({
            goToPage: (page: number) => engineRef.current?.goToPage(page),
            nextPage: () => engineRef.current?.nextPage(),
            prevPage: () => engineRef.current?.prevPage(),
            zoomIn: () => engineRef.current?.zoomIn(),
            zoomOut: () => engineRef.current?.zoomOut(),
            zoomReset: () => engineRef.current?.zoomReset(),
            setZoom: (s: number) => engineRef.current?.setZoom(s),
            getZoom: () => engineRef.current?.getZoom() ?? 1,
            getCurrentPage: () => engineRef.current?.getCurrentPage() ?? 1,
            getTotalPages: () => engineRef.current?.getTotalPages() ?? 0,
            find: (query: string, options?) => engineRef.current?.find(query, options),
            findNext: () => engineRef.current?.findNext(),
            findPrevious: () => engineRef.current?.findPrevious(),
            clearSearch: () => engineRef.current?.clearSearch(),
            rotateClockwise: () => engineRef.current?.rotateClockwise(),
            rotateCounterClockwise: () => engineRef.current?.rotateCounterClockwise(),
        }));

        // Handle page change from engine
        const handlePageChange = useCallback(
            (page: number, total: number) => {
                setCurrentPage(page);
                setTotalPages(total);
                onPageChange?.(page, total);
            },
            [onPageChange]
        );

        // Handle load from engine
        const handleLoad = useCallback(
            (info: PDFDocumentInfo) => {
                setIsLoading(false);
                setTotalPages(info.totalPages);
                setDocumentTitle(info.title || info.filename);
                onLoad?.(info);
            },
            [onLoad]
        );

        // Handle error from engine
        const handleError = useCallback(
            (err: Error) => {
                setIsLoading(false);
                setError(err.message);
                onError?.(err);
            },
            [onError]
        );

        // Toolbar action handlers
        const handlePrevPage = useCallback(() => {
            engineRef.current?.prevPage();
        }, []);

        const handleNextPage = useCallback(() => {
            engineRef.current?.nextPage();
        }, []);

        const handlePageInput = useCallback((page: number) => {
            engineRef.current?.goToPage(page);
        }, []);

        const handleZoomIn = useCallback(() => {
            engineRef.current?.zoomIn();
            // Update scale after zoom (with small delay for engine to update)
            setTimeout(() => {
                setScale(engineRef.current?.getZoom() ?? 1);
            }, 50);
        }, []);

        const handleZoomOut = useCallback(() => {
            engineRef.current?.zoomOut();
            setTimeout(() => {
                setScale(engineRef.current?.getZoom() ?? 1);
            }, 50);
        }, []);

        const handleZoomReset = useCallback(() => {
            engineRef.current?.zoomReset();
            setScale(1);
        }, []);

        const handleRotate = useCallback(() => {
            engineRef.current?.rotateClockwise();
        }, []);

        // Theme class mapping
        const themeClass = {
            light: "theme-light",
            sepia: "theme-sepia",
            dark: "theme-dark",
        }[theme];

        return (
            <div
                className={cn(
                    "flex flex-col h-full w-full overflow-hidden",
                    themeClass,
                    "transition-colors duration-200"
                )}
                data-reading-mode="pdf"
            >
                {/* Toolbar */}
                <PDFToolbar
                    currentPage={currentPage}
                    totalPages={totalPages}
                    scale={scale}
                    title={documentTitle}
                    isLoading={isLoading}
                    onPrevPage={handlePrevPage}
                    onNextPage={handleNextPage}
                    onZoomIn={handleZoomIn}
                    onZoomOut={handleZoomOut}
                    onZoomReset={handleZoomReset}
                    onRotate={handleRotate}
                    onPageInput={handlePageInput}
                />

                {/* PDF Viewer Area */}
                <div className="flex-1 relative overflow-hidden">
                    {/* Error State */}
                    {error && <ErrorState error={error} />}

                    {/* PDF Engine */}
                    <PDFJsEngine
                        ref={engineRef}
                        pdfPath={pdfPath}
                        pdfData={pdfData}
                        onPageChange={handlePageChange}
                        onLoad={handleLoad}
                        onError={handleError}
                        className="w-full h-full"
                    />
                </div>
            </div>
        );
    }
);

export default PDFReader;
export type { PDFReaderProps };
