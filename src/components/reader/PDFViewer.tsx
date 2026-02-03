/**
 * PDFViewer Component
 *
 * A complete PDF viewer component with page navigation, zoom controls,
 * keyboard shortcuts, and rendered page caching.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    RotateCcw,
    Loader2,
    AlertCircle,
} from "lucide-react";

// PDF API interface matching PDFium integration guide
export interface PdfInfo extends PdfInfoType {}

export interface PDFViewerProps {
    file: File | Blob;
    initialPage?: number;
    onPageChange?: (page: number) => void;
    onReady?: (info: PdfInfo) => void;
}

// PDF API - now integrated with Tauri backend
import { pdfApi, type PdfInfo as PdfInfoType } from "@/lib/pdf-api";
import { v4 as uuidv4 } from "uuid";

// Scale configuration
const MIN_SCALE = 0.25;
const MAX_SCALE = 4.0;
const SCALE_STEP = 0.25;

/**
 * Inner PDF Viewer component
 */
function PDFViewerInner({ file, initialPage = 1, onPageChange, onReady }: PDFViewerProps) {
    // State management
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(initialPage);
    const [scale, setScale] = useState(1.0);
    const [pdfInfo, setPdfInfo] = useState<PdfInfo | null>(null);
    const [renderingPages, setRenderingPages] = useState<Set<number>>(new Set());
    const [pageImages, setPageImages] = useState<Map<number, string>>(new Map());

    // Document ID for backend communication - stable across renders
    const docIdRef = useRef<string>("");
    
    // Store callbacks in refs to avoid re-triggering effects
    const onReadyRef = useRef(onReady);
    const onPageChangeRef = useRef(onPageChange);
    useEffect(() => {
        onReadyRef.current = onReady;
        onPageChangeRef.current = onPageChange;
    }, [onReady, onPageChange]);

    // Track failed pages to prevent infinite retry loops
    const failedPagesRef = useRef<Set<number>>(new Set());
    
    // Track if component is mounted
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Container ref for calculating dimensions
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Load PDF on mount - only depends on file
    useEffect(() => {
        let cancelled = false;

        const loadPdf = async () => {
            setIsLoading(true);
            setError(null);
            setPageImages(new Map());

            try {
                // Generate document ID
                const newDocId = uuidv4();
                docIdRef.current = newDocId;
                
                console.log("[PDFViewer] Loading document with ID:", newDocId);

                // Convert file to bytes
                const arrayBuffer = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);

                // Load document via API
                const info = await pdfApi.loadDocument(newDocId, bytes);

                if (cancelled) {
                    // Clean up if cancelled
                    pdfApi.close(newDocId).catch(() => {});
                    return;
                }

                setPdfInfo(info);

                // Validate initial page
                const validPage = Math.max(1, Math.min(initialPage, info.pageCount));
                setCurrentPage(validPage);

                // Notify parent using ref
                onReadyRef.current?.(info);

                // Render initial page directly
                console.log("[PDFViewer] Rendering initial page:", validPage, "with docId:", newDocId);
                try {
                    const base64Image = await pdfApi.renderPage(newDocId, validPage, 1.0);
                    if (!cancelled && mountedRef.current) {
                        setPageImages(prev => new Map(prev).set(validPage, base64Image));
                    }
                } catch (renderErr) {
                    console.error(`[PDFViewer] Failed to render initial page:`, renderErr);
                    if (!cancelled) {
                        failedPagesRef.current.add(validPage);
                        setError(renderErr instanceof Error ? renderErr.message : `Failed to render page ${validPage}`);
                    }
                }
            } catch (err) {
                if (cancelled) return;
                console.error("[PDFViewer] Failed to load PDF:", err);
                setError(err instanceof Error ? err.message : "Failed to load PDF");
            } finally {
                if (!cancelled && mountedRef.current) {
                    setIsLoading(false);
                }
            }
        };

        // Reset state when file changes
        failedPagesRef.current.clear();
        setRenderingPages(new Set());
        loadPdf();

        return () => {
            cancelled = true;
            const docId = docIdRef.current;
            if (docId) {
                pdfApi.close(docId).catch(() => {});
            }
        };
    }, [file]); // Only depend on file, not initialPage or callbacks

    // Render a specific page
    const renderPage = useCallback(async (pageNumber: number): Promise<void> => {
        const docId = docIdRef.current;
        if (!docId || !pdfInfo || pageNumber < 1 || pageNumber > pdfInfo.pageCount) return;

        // Check cache first
        if (pageImages.has(pageNumber)) return;

        // Don't retry failed pages
        if (failedPagesRef.current.has(pageNumber)) return;

        // Check if already rendering
        if (renderingPages.has(pageNumber)) return;

        console.log("[PDFViewer] Rendering page:", pageNumber, "with docId:", docId);

        // Mark as rendering
        setRenderingPages((prev) => new Set(prev).add(pageNumber));

        try {
            // Render page via API using the current docId
            const base64Image = await pdfApi.renderPage(docId, pageNumber, scale);

            if (mountedRef.current) {
                // Store in state (not just ref) to trigger re-render
                setPageImages(prev => new Map(prev).set(pageNumber, base64Image));
            }
        } catch (err) {
            console.error(`[PDFViewer] Failed to render page ${pageNumber}:`, err);
            // Mark as failed to prevent infinite retries
            failedPagesRef.current.add(pageNumber);
        } finally {
            if (mountedRef.current) {
                setRenderingPages((prev) => {
                    const next = new Set(prev);
                    next.delete(pageNumber);
                    return next;
                });
            }
        }
    }, [pdfInfo, scale, pageImages, renderingPages]);

    // Render adjacent pages when current page changes
    useEffect(() => {
        if (!pdfInfo || !docIdRef.current) return;

        // Pre-render adjacent pages (but not in the main effect to avoid loops)
        const preRenderAdjacent = async () => {
            const pagesToRender: number[] = [];
            
            if (currentPage > 1 && !pageImages.has(currentPage - 1) && !failedPagesRef.current.has(currentPage - 1)) {
                pagesToRender.push(currentPage - 1);
            }
            if (currentPage < pdfInfo.pageCount && !pageImages.has(currentPage + 1) && !failedPagesRef.current.has(currentPage + 1)) {
                pagesToRender.push(currentPage + 1);
            }

            for (const page of pagesToRender) {
                if (!renderingPages.has(page)) {
                    await renderPage(page);
                }
            }
        };

        // Delay pre-rendering to avoid blocking
        const timer = setTimeout(preRenderAdjacent, 100);
        return () => clearTimeout(timer);
    }, [currentPage, pdfInfo]); // Only depend on currentPage and pdfInfo

    // Navigation handlers
    const goToPage = useCallback(
        (page: number) => {
            if (!pdfInfo) return;

            const validPage = Math.max(1, Math.min(page, pdfInfo.pageCount));
            setCurrentPage(validPage);
            onPageChangeRef.current?.(validPage);
        },
        [pdfInfo]
    );

    const goToPrevious = useCallback(() => {
        goToPage(currentPage - 1);
    }, [currentPage, goToPage]);

    const goToNext = useCallback(() => {
        goToPage(currentPage + 1);
    }, [currentPage, goToPage]);

    // Zoom handlers
    const zoomIn = useCallback(() => {
        setScale((prev) => Math.min(MAX_SCALE, prev + SCALE_STEP));
        // Clear cache and failed pages on zoom change to re-render at new scale
        setPageImages(new Map());
        failedPagesRef.current.clear();
    }, []);

    const zoomOut = useCallback(() => {
        setScale((prev) => Math.max(MIN_SCALE, prev - SCALE_STEP));
        // Clear cache and failed pages on zoom change to re-render at new scale
        setPageImages(new Map());
        failedPagesRef.current.clear();
    }, []);

    const zoomReset = useCallback(() => {
        setScale(1.0);
        setPageImages(new Map());
        failedPagesRef.current.clear();
    }, []);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input
            if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement
            ) {
                return;
            }

            switch (e.key) {
                case "ArrowLeft":
                case "ArrowUp":
                case "PageUp":
                    e.preventDefault();
                    goToPrevious();
                    break;
                case "ArrowRight":
                case "ArrowDown":
                case "PageDown":
                case " ":
                    e.preventDefault();
                    goToNext();
                    break;
                case "Home":
                    e.preventDefault();
                    goToPage(1);
                    break;
                case "End":
                    e.preventDefault();
                    goToPage(pdfInfo?.pageCount || 1);
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyDown, { passive: false });
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [goToPrevious, goToNext, goToPage, pdfInfo]);

    // Get current page image from cache
    const currentPageImage = useMemo(() => {
        return pageImages.get(currentPage);
    }, [currentPage, pageImages]);

    // Format scale as percentage
    const scalePercent = Math.round(scale * 100);

    // Loading state
    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-[var(--color-background)]">
                <Loader2 className="w-10 h-10 animate-spin text-[var(--color-accent)]" />
                <p className="mt-4 text-sm text-[var(--color-text-muted)]">Loading PDF...</p>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-[var(--color-background)] p-8">
                <div className="flex flex-col items-center gap-4 text-center max-w-md">
                    <div className="w-16 h-16 rounded-full bg-[var(--color-error)]/10 flex items-center justify-center">
                        <AlertCircle className="w-8 h-8 text-[var(--color-error)]" />
                    </div>
                    <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                        Failed to load PDF
                    </h3>
                    <p className="text-sm text-[var(--color-text-muted)]">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="flex flex-col h-full bg-[var(--color-background)] overflow-hidden"
        >
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                {/* Navigation controls */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={goToPrevious}
                        disabled={currentPage <= 1}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-accent-light)]",
                            "disabled:opacity-40 disabled:cursor-not-allowed"
                        )}
                        aria-label="Previous page"
                    >
                        <ChevronLeft className="w-5 h-5 text-[var(--color-text-primary)]" />
                    </button>

                    {/* Page counter */}
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--color-background)] border border-[var(--color-border)]">
                        <span className="text-sm font-medium text-[var(--color-text-primary)] min-w-[2ch] text-center">
                            {currentPage}
                        </span>
                        <span className="text-sm text-[var(--color-text-muted)]">/</span>
                        <span className="text-sm text-[var(--color-text-muted)] min-w-[2ch] text-center">
                            {pdfInfo?.pageCount || 0}
                        </span>
                    </div>

                    <button
                        onClick={goToNext}
                        disabled={!pdfInfo || currentPage >= pdfInfo.pageCount}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-accent-light)]",
                            "disabled:opacity-40 disabled:cursor-not-allowed"
                        )}
                        aria-label="Next page"
                    >
                        <ChevronRight className="w-5 h-5 text-[var(--color-text-primary)]" />
                    </button>
                </div>

                {/* Zoom controls */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={zoomOut}
                        disabled={scale <= MIN_SCALE}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-accent-light)]",
                            "disabled:opacity-40 disabled:cursor-not-allowed"
                        )}
                        aria-label="Zoom out"
                    >
                        <ZoomOut className="w-5 h-5 text-[var(--color-text-primary)]" />
                    </button>

                    <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] min-w-[5rem] justify-center">
                        <button
                            onClick={zoomReset}
                            className="text-sm font-medium text-[var(--color-text-primary)] hover:text-[var(--color-accent)] transition-colors"
                            title="Reset zoom"
                        >
                            {scalePercent}%
                        </button>
                    </div>

                    <button
                        onClick={zoomIn}
                        disabled={scale >= MAX_SCALE}
                        className={cn(
                            "p-2 rounded-lg transition-colors",
                            "hover:bg-[var(--color-accent-light)]",
                            "disabled:opacity-40 disabled:cursor-not-allowed"
                        )}
                        aria-label="Zoom in"
                    >
                        <ZoomIn className="w-5 h-5 text-[var(--color-text-primary)]" />
                    </button>

                    <button
                        onClick={zoomReset}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--color-accent-light)]"
                        aria-label="Reset zoom"
                        title="Reset zoom"
                    >
                        <RotateCcw className="w-4 h-4 text-[var(--color-text-muted)]" />
                    </button>
                </div>
            </div>

            {/* Page viewer */}
            <div className="flex-1 overflow-auto bg-[var(--color-border-subtle)] relative">
                <div
                    className="min-h-full flex items-center justify-center p-8"
                    style={{
                        transform: `scale(${scale})`,
                        transformOrigin: "center top",
                        transition: "transform 0.15s ease-out",
                    }}
                >
                    {/* Page container */}
                    <div className="relative shadow-lg">
                        {/* Loading state for page */}
                        {(!currentPageImage || renderingPages.has(currentPage)) && (
                            <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface)]">
                                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)]" />
                            </div>
                        )}

                        {/* Rendered page image */}
                        {currentPageImage && (
                            <img
                                src={currentPageImage}
                                alt={`Page ${currentPage}`}
                                className={cn(
                                    "block max-w-full h-auto bg-white",
                                    "transition-opacity duration-200",
                                    renderingPages.has(currentPage)
                                        ? "opacity-50"
                                        : "opacity-100"
                                )}
                                style={{
                                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                                }}
                            />
                        )}

                        {/* Canvas overlay for future annotations */}
                        <canvas
                            ref={canvasRef}
                            className="absolute inset-0 pointer-events-auto"
                            style={{
                                width: "100%",
                                height: "100%",
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Bottom status bar */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)]">
                <span>
                    Page {currentPage} of {pdfInfo?.pageCount || 0}
                </span>
                {pdfInfo?.metadata?.title && (
                    <span className="truncate max-w-md text-center">
                        {pdfInfo.metadata.title}
                    </span>
                )}
                <span>{scalePercent}%</span>
            </div>
        </div>
    );
}

/**
 * PDFViewer component with error boundary
 */
export function PDFViewer(props: PDFViewerProps) {
    return (
        <ErrorBoundary>
            <PDFViewerInner {...props} />
        </ErrorBoundary>
    );
}

export default PDFViewer;
