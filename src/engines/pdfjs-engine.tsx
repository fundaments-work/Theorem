/**
 * PDF.js Engine Component - Simplified Stable Version
 *
 * A React component that renders PDF documents using PDF.js.
 * This version uses a simpler, more stable rendering approach
 * without the full PDFViewer class to avoid initialization issues.
 */

import {
    useEffect,
    useRef,
    useState,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/env";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";

// Import CSS (our custom styles only, not pdf_viewer.css which conflicts)
import "./pdfjs-engine.css";

// Configure worker using Vite's URL handling
// This creates a proper URL that works in both dev and production
const workerUrl = new URL(
    "pdfjs-dist/build/pdf.worker.mjs",
    import.meta.url
).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Types
export interface PDFJsEngineProps {
    pdfPath: string;
    pdfData?: Uint8Array;
    /** Original filename for display fallback (without extension) */
    originalFilename?: string;
    initialPage?: number;
    onLoad?: (info: PDFDocumentInfo) => void;
    onError?: (error: Error) => void;
    onPageChange?: (page: number, totalPages: number, scale: number) => void;
    className?: string;
}

export interface PDFDocumentInfo {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
    totalPages: number;
    filename: string;
}

export interface PDFSearchState {
    query: string;
    highlightAll: boolean;
    caseSensitive: boolean;
    entireWord: boolean;
}

export interface PDFJsEngineRef {
    goToPage: (page: number) => void;
    nextPage: () => void;
    prevPage: () => void;
    zoomIn: () => void;
    zoomOut: () => void;
    zoomReset: () => void;
    setZoom: (scale: number) => void;
    getZoom: () => number;
    getCurrentPage: () => number;
    getTotalPages: () => number;
    rotateClockwise: () => void;
    rotateCounterClockwise: () => void;
}

// Constants
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.25;
const DEFAULT_SCALE = 1.0;

// Page render component
interface PageCanvasProps {
    page: PDFPageProxy;
    scale: number;
    rotation: number;
    onRenderComplete?: () => void;
}

function PageCanvas({ page, scale, rotation, onRenderComplete }: PageCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null);
    const textLayerInstanceRef = useRef<TextLayer | null>(null);
    const [isRendering, setIsRendering] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        if (!canvas || !textLayerDiv) return;

        const renderPage = async () => {
            // Cancel any ongoing render operation first
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch {
                    // Ignore cancel errors
                }
                renderTaskRef.current = null;
            }

            // Cancel any existing text layer
            if (textLayerInstanceRef.current) {
                textLayerInstanceRef.current.cancel();
                textLayerInstanceRef.current = null;
            }

            setIsRendering(true);

            try {
                // Get viewport at the requested scale
                const viewport = page.getViewport({ scale, rotation });
                const outputScale = window.devicePixelRatio || 1;

                // Canvas dimensions
                const cssWidth = Math.floor(viewport.width);
                const cssHeight = Math.floor(viewport.height);

                // Set canvas for HiDPI
                canvas.width = Math.floor(cssWidth * outputScale);
                canvas.height = Math.floor(cssHeight * outputScale);
                canvas.style.width = `${cssWidth}px`;
                canvas.style.height = `${cssHeight}px`;

                // Set container size
                if (containerRef.current) {
                    containerRef.current.style.width = `${cssWidth}px`;
                    containerRef.current.style.height = `${cssHeight}px`;
                }

                // Text layer matches canvas exactly
                textLayerDiv.style.width = `${cssWidth}px`;
                textLayerDiv.style.height = `${cssHeight}px`;

                const ctx = canvas.getContext("2d");
                if (!ctx || cancelled) return;

                // Clear and set transform for HiDPI
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);

                // Render canvas
                const renderTask = page.render({
                    canvasContext: ctx,
                    viewport: viewport,
                });
                renderTaskRef.current = renderTask;

                await renderTask.promise;
                if (cancelled) return;

                // Clear and render text layer
                textLayerDiv.innerHTML = '';
                
                try {
                    const textContent: TextContent = await page.getTextContent();
                    if (cancelled) return;

                    const textLayer = new TextLayer({
                        textContentSource: textContent,
                        container: textLayerDiv,
                        viewport: viewport,
                    });

                    textLayerInstanceRef.current = textLayer;
                    await textLayer.render();
                } catch (textError) {
                    console.warn("[PageCanvas] Text layer error:", textError);
                }

                if (!cancelled) {
                    renderTaskRef.current = null;
                    setIsRendering(false);
                    onRenderComplete?.();
                }
            } catch (error: unknown) {
                const isCancelled = error instanceof Error && 
                    (error.message.includes('cancelled') || error.message.includes('Rendering cancelled'));
                
                if (!isCancelled) {
                    console.error("[PageCanvas] Render error:", error);
                }
                
                if (!cancelled) {
                    renderTaskRef.current = null;
                    setIsRendering(false);
                }
            }
        };

        renderPage();

        return () => {
            cancelled = true;
            if (renderTaskRef.current) {
                try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
                renderTaskRef.current = null;
            }
            if (textLayerInstanceRef.current) {
                textLayerInstanceRef.current.cancel();
                textLayerInstanceRef.current = null;
            }
        };
    }, [page, scale, rotation, onRenderComplete]);

    return (
        <div 
            ref={containerRef}
            className="pdf-page-container"
        >
            <canvas ref={canvasRef} className="block" />
            <div ref={textLayerRef} className="textLayer" />
            {isRendering && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent)]" />
                </div>
            )}
        </div>
    );
}

/**
 * PDF.js Engine Component
 */
export const PDFJsEngine = forwardRef<PDFJsEngineRef, PDFJsEngineProps>(
    function PDFJsEngine({ pdfPath, pdfData, originalFilename, initialPage = 1, onLoad, onError, onPageChange, className }, ref) {
        const containerRef = useRef<HTMLDivElement>(null);
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [pdfInfo, setPdfInfo] = useState<PDFDocumentInfo | null>(null);
        const [currentPage, setCurrentPage] = useState(initialPage);
        const [totalPages, setTotalPages] = useState(0);
        const [scale, setScale] = useState(DEFAULT_SCALE);
        const [rotation, setRotation] = useState(0);
        const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
        const [pages, setPages] = useState<PDFPageProxy[]>([]);
        
        // Debounce timer for zoom changes
        const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        // Pending scale during wheel zoom
        const pendingScaleRef = useRef<number | null>(null);

        // Use refs for callbacks to avoid re-triggering the load effect
        const callbacksRef = useRef({ onLoad, onError, onPageChange });
        useEffect(() => {
            callbacksRef.current = { onLoad, onError, onPageChange };
        }, [onLoad, onError, onPageChange]);

        // Load PDF
        useEffect(() => {
            let cancelled = false;

            const loadPdf = async () => {
                // In browser mode, wait for pdfData to be provided
                // This handles the race condition where component mounts before data is ready
                if (!isTauri() && !pdfData) {
                    // Keep loading state, data will arrive via props update
                    return;
                }

                try {
                    setIsLoading(true);
                    setError(null);
                    setPages([]);

                    // Get PDF data
                    let data: Uint8Array;
                    if (pdfData) {
                        // Use provided data (works in both browser and Tauri)
                        data = pdfData;
                    } else if (isTauri()) {
                        // Read via Tauri
                        data = await invoke<Uint8Array>("read_pdf_file", { path: pdfPath });
                    } else {
                        // Should not reach here due to early return above
                        throw new Error("PDF data not provided. Please ensure the book is properly loaded.");
                    }

                    if (cancelled) return;

                    // Load document
                    const loadingTask = pdfjsLib.getDocument({
                        data,
                        cMapUrl: "/pdfjs/cmaps/",
                        cMapPacked: true,
                        standardFontDataUrl: "/pdfjs/standard_fonts/",
                        isEvalSupported: false, // Security: disable eval
                    });

                    const pdf = await loadingTask.promise;

                    if (cancelled) {
                        pdf.destroy();
                        return;
                    }

                    setPdfDocument(pdf);

                    // Get metadata
                    const metadata = await pdf.getMetadata();
                    const metaInfo = metadata.info as Record<string, unknown>;
                    // Use original filename (without extension) as fallback for title
                    const displayFilename = originalFilename || pdfPath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "document";
                    const info: PDFDocumentInfo = {
                        title: (metaInfo?.Title as string) || displayFilename,
                        author: metaInfo?.Author as string | undefined,
                        subject: metaInfo?.Subject as string | undefined,
                        keywords: metaInfo?.Keywords as string | undefined,
                        creator: metaInfo?.Creator as string | undefined,
                        producer: metaInfo?.Producer as string | undefined,
                        creationDate: metaInfo?.CreationDate ? new Date(metaInfo.CreationDate as string) : undefined,
                        modificationDate: metaInfo?.ModDate ? new Date(metaInfo.ModDate as string) : undefined,
                        totalPages: pdf.numPages,
                        filename: displayFilename,
                    };

                    setPdfInfo(info);
                    setTotalPages(info.totalPages);

                    // Pre-load first few pages
                    const initialPages: PDFPageProxy[] = [];
                    const pagesToLoad = Math.min(3, pdf.numPages);
                    for (let i = 1; i <= pagesToLoad; i++) {
                        const page = await pdf.getPage(i);
                        initialPages.push(page);
                    }

                    if (!cancelled) {
                        setPages(initialPages);
                        setIsLoading(false);
                        callbacksRef.current.onLoad?.(info);
                        // Also call onPageChange with initial page to update parent state
                        callbacksRef.current.onPageChange?.(initialPage, info.totalPages, DEFAULT_SCALE);
                    } else {
                        // Cleanup if cancelled
                        initialPages.forEach(p => p.cleanup());
                        pdf.destroy();
                    }

                } catch (err) {
                    if (!cancelled) {
                        const errorMsg = err instanceof Error ? err.message : "Failed to load PDF";
                        console.error("[PDFJsEngine] Error loading PDF:", err);
                        setError(errorMsg);
                        callbacksRef.current.onError?.(err instanceof Error ? err : new Error(errorMsg));
                        setIsLoading(false);
                    }
                }
            };

            loadPdf();

            return () => {
                cancelled = true;
                // Cleanup
                pages.forEach(p => p.cleanup());
                pdfDocument?.destroy();
                setPdfDocument(null);
                setPages([]);
            };
            // Only reload when pdfPath, pdfData, or initialPage changes
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [pdfPath, pdfData, initialPage]);

        // Track loading state to prevent duplicate page loads
        const isLoadingPageRef = useRef(false);

        // Load additional pages as needed
        useEffect(() => {
            if (!pdfDocument || pages.length >= pdfDocument.numPages) return;
            if (isLoadingPageRef.current) return;

            let cancelled = false;
            isLoadingPageRef.current = true;

            const loadMorePages = async () => {
                const nextPageNum = pages.length + 1;
                if (nextPageNum > pdfDocument.numPages) {
                    isLoadingPageRef.current = false;
                    return;
                }

                try {
                    const page = await pdfDocument.getPage(nextPageNum);
                    if (!cancelled) {
                        setPages(prev => {
                            // Prevent duplicates
                            if (prev.some(p => p.pageNumber === page.pageNumber)) {
                                return prev;
                            }
                            return [...prev, page];
                        });
                    } else {
                        page.cleanup();
                    }
                } catch (error) {
                    console.error("[PDFJsEngine] Error loading page:", error);
                } finally {
                    isLoadingPageRef.current = false;
                }
            };

            // Load next page when we're near the end of loaded pages
            loadMorePages();

            return () => {
                cancelled = true;
                isLoadingPageRef.current = false;
            };
        }, [pdfDocument, pages.length]);

        // Handle scroll-based page tracking and wheel zoom
        useEffect(() => {
            const container = containerRef.current;
            if (!container || pages.length === 0) return;

            const handleScroll = () => {
                const scrollTop = container.scrollTop;
                const pageHeight = container.scrollHeight / pages.length;
                const newPage = Math.floor(scrollTop / pageHeight) + 1;

                if (newPage !== currentPage && newPage >= 1 && newPage <= totalPages) {
                    setCurrentPage(newPage);
                    callbacksRef.current.onPageChange?.(newPage, totalPages, scale);
                }
            };

            // Wheel zoom handler - debounced direct scale change
            const handleWheel = (e: WheelEvent) => {
                // Check if Ctrl or Meta key is pressed for zoom
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                    
                    // Calculate new scale from pending or current
                    const baseScale = pendingScaleRef.current ?? scale;
                    const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, baseScale + delta));
                    pendingScaleRef.current = newScale;
                    
                    // Clear existing debounce timer
                    if (zoomDebounceRef.current) {
                        clearTimeout(zoomDebounceRef.current);
                    }
                    
                    // Debounce - apply scale after zoom gesture stops
                    zoomDebounceRef.current = setTimeout(() => {
                        if (pendingScaleRef.current !== null) {
                            const finalScale = pendingScaleRef.current;
                            setScale(finalScale);
                            // Notify parent of zoom change
                            callbacksRef.current.onPageChange?.(currentPage, totalPages, finalScale);
                            pendingScaleRef.current = null;
                        }
                        zoomDebounceRef.current = null;
                    }, 150);
                }
            };

            container.addEventListener("scroll", handleScroll, { passive: true });
            container.addEventListener("wheel", handleWheel, { passive: false });
            
            return () => {
                container.removeEventListener("scroll", handleScroll);
                container.removeEventListener("wheel", handleWheel);
                // Clear zoom debounce on cleanup
                if (zoomDebounceRef.current) {
                    clearTimeout(zoomDebounceRef.current);
                    zoomDebounceRef.current = null;
                }
            };
        }, [pages.length, currentPage, totalPages, scale]);

        // Expose imperative methods
        useImperativeHandle(ref, () => ({
            goToPage: (page: number) => {
                if (page >= 1 && page <= totalPages && containerRef.current) {
                    const pageHeight = containerRef.current.scrollHeight / pages.length;
                    containerRef.current.scrollTo({
                        top: (page - 1) * pageHeight,
                        behavior: "smooth",
                    });
                }
            },
            nextPage: () => {
                if (currentPage < totalPages && containerRef.current) {
                    const pageHeight = containerRef.current.scrollHeight / pages.length;
                    containerRef.current.scrollTo({
                        top: currentPage * pageHeight,
                        behavior: "smooth",
                    });
                }
            },
            prevPage: () => {
                if (currentPage > 1 && containerRef.current) {
                    const pageHeight = containerRef.current.scrollHeight / pages.length;
                    containerRef.current.scrollTo({
                        top: (currentPage - 2) * pageHeight,
                        behavior: "smooth",
                    });
                }
            },
            zoomIn: () => {
                setScale(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
            },
            zoomOut: () => {
                setScale(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
            },
            zoomReset: () => {
                setScale(DEFAULT_SCALE);
            },
            setZoom: (newScale: number) => {
                setScale(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale)));
            },
            getZoom: () => scale,
            getCurrentPage: () => currentPage,
            getTotalPages: () => totalPages,
            rotateClockwise: () => {
                setRotation(prev => (prev + 90) % 360);
            },
            rotateCounterClockwise: () => {
                setRotation(prev => (prev - 90 + 360) % 360);
            },
        }), [currentPage, totalPages, pages.length, scale]);

        return (
            <div className={cn("relative w-full h-full", className)}>
                {/* Loading State */}
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)]">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-accent)]"></div>
                        <p className="mt-4 text-[var(--color-text-secondary)]">Loading PDF...</p>
                    </div>
                )}

                {/* Error State */}
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)] p-8">
                        <div className="text-[var(--color-error)] text-4xl mb-4">⚠️</div>
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
                            Failed to load PDF
                        </h3>
                        <p className="text-[var(--color-text-secondary)] text-center max-w-md">
                            {error}
                        </p>
                    </div>
                )}

                {/* PDF Pages Container */}
                <div
                    ref={containerRef}
                    className={cn(
                        "absolute inset-0 overflow-auto bg-[var(--color-surface)]",
                        (isLoading || error) && "invisible"
                    )}
                >
                    <div className="flex flex-col items-center justify-start min-h-full py-4 space-y-4 mx-auto">
                        {pages.map((page) => (
                            <div
                                key={`page-${page.pageNumber}`}
                                className="pdf-page-wrapper"
                                data-page-number={page.pageNumber}
                            >
                                <PageCanvas
                                    page={page}
                                    scale={scale}
                                    rotation={rotation}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Page Info Overlay */}
                {!isLoading && !error && totalPages > 0 && (
                    <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] shadow-sm">
                        Page {currentPage} of {totalPages} | {Math.round(scale * 100)}%
                    </div>
                )}
            </div>
        );
    }
);

export default PDFJsEngine;
