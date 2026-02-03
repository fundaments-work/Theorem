/**
 * PDFViewer - Optimized PDF rendering with throttled scroll handling
 */

import React, {
    useRef,
    useEffect,
    useState,
    useCallback,
    useImperativeHandle,
    forwardRef,
    memo,
} from "react";
import { cn } from "@/lib/utils";
import { usePDF } from "@/hooks/usePDF";
import type { DocMetadata, DocLocation, TocItem } from "@/types";

export interface PDFViewerProps {
    file: File | Blob | null;
    scale?: number;
    initialPage?: number;
    initialLocation?: string;
    onReady?: (meta: DocMetadata, toc: TocItem[]) => void;
    onLocationChange?: (location: DocLocation) => void;
    onError?: (error: Error) => void;
    onPageChange?: (page: number) => void;
    onZoomChange?: (zoom: number) => void;
    className?: string;
}

export interface PDFViewerHandle {
    goTo: (location: string) => void;
    goToPage: (pageNumber: number) => void;
    goToFraction: (fraction: number) => void;
    getCurrentPage: () => number;
    zoomIn: () => void;
    zoomOut: () => void;
    setZoom: (scale: number) => void;
    fitPage: () => void;
    fitWidth: () => void;
    rotate: () => void;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5.0;
const SCALE_STEP = 0.25;
const SCROLL_THROTTLE_MS = 250; // Increased to reduce update frequency

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function parsePageFromLocation(location?: string): number | null {
    if (!location) return null;
    const match = location.match(/page=(\d+)/);
    if (!match) return null;
    const page = parseInt(match[1], 10);
    return isFinite(page) && page > 0 ? page : null;
}

// Single page component - memoized to prevent unnecessary re-renders
interface PDFPageProps {
    pageNumber: number;
    scale: number;
    rotation: number;
    document: any;
    renderPage: (pageNumber: number, canvas: HTMLCanvasElement, scale: number, rotation: number) => Promise<{ width: number; height: number }>;
    cancelRender: (pageNumber: number) => void;
}

const PDFPage = memo(function PDFPage({
    pageNumber,
    scale,
    rotation,
    document,
    renderPage,
    cancelRender,
}: PDFPageProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<any>(null);
    const isRenderingRef = useRef(false);

    useEffect(() => {
        if (!document || !canvasRef.current || isRenderingRef.current) return;

        const canvas = canvasRef.current;
        const cacheKey = `${pageNumber}-${scale}-${rotation}`;
        
        // Skip if already rendered at this scale/rotation
        if (canvas.dataset.rendered === cacheKey) return;

        isRenderingRef.current = true;

        const doRender = async () => {
            try {
                const result = await renderPage(pageNumber, canvas, scale, rotation);
                
                if (canvasRef.current) {
                    canvasRef.current.dataset.rendered = cacheKey;
                    
                    if (containerRef.current) {
                        containerRef.current.style.width = `${result.width}px`;
                        containerRef.current.style.height = `${result.height}px`;
                    }
                }
            } catch (err) {
                // Ignore cancellation errors
                if (err instanceof Error && !err.message.includes("cancelled")) {
                    console.error(`Page ${pageNumber} render error:`, err);
                }
            } finally {
                isRenderingRef.current = false;
            }
        };

        doRender();

        return () => {
            if (renderTaskRef.current) {
                cancelRender(pageNumber);
            }
        };
    }, [pageNumber, scale, rotation, document, renderPage, cancelRender]);

    return (
        <div
            ref={containerRef}
            data-page-number={pageNumber}
            className="page"
            style={{
                position: "relative",
                margin: "10px auto",
                backgroundColor: "white",
                boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                overflow: "hidden",
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    display: "block",
                    width: "100%",
                    height: "100%",
                }}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison - only re-render if these actually changed
    return (
        prevProps.pageNumber === nextProps.pageNumber &&
        prevProps.scale === nextProps.scale &&
        prevProps.rotation === nextProps.rotation &&
        prevProps.document === nextProps.document
    );
});

export const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(
    ({
        file,
        scale: initialScale = 1.0,
        initialPage = 1,
        initialLocation,
        onReady,
        onLocationChange,
        onError,
        onPageChange,
        onZoomChange,
        className,
    }, ref) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const viewerRef = useRef<HTMLDivElement>(null);
        const mountedRef = useRef(true);
        const scrollTimeoutRef = useRef<number | null>(null);
        const lastPageRef = useRef<number>(1);
        const isScrollingRef = useRef(false);
        const isProgrammaticScrollRef = useRef(false);

        const currentPageRef = useRef(clamp(initialPage, 1, 10000));
        const totalPagesRef = useRef(0);
        const scaleRef = useRef(clamp(initialScale, MIN_SCALE, MAX_SCALE));
        const rotationRef = useRef(0);

        const [currentPage, setCurrentPage] = useState(currentPageRef.current);
        const [scale, setScale] = useState(scaleRef.current);

        const { isLoading, loadProgress, error, document, loadDocument, renderPage, getPageDimensions, cancelRender } = usePDF();

        useEffect(() => {
            mountedRef.current = true;
            return () => {
                mountedRef.current = false;
            };
        }, []);

        useEffect(() => {
            if (!file) return;

            currentPageRef.current = 1;
            lastPageRef.current = 1;
            setCurrentPage(1);
            scaleRef.current = initialScale;
            setScale(initialScale);

            loadDocument(file).catch((err) => {
                if (mountedRef.current) {
                    onError?.(err instanceof Error ? err : new Error(String(err)));
                }
            });
        }, [file, loadDocument, onError, initialScale]);

        useEffect(() => {
            if (!document) return;

            totalPagesRef.current = document.numPages;
            onReady?.(document.metadata, document.toc);

            // Auto-fit on load
            setTimeout(() => {
                if (!mountedRef.current || !containerRef.current) return;
                
                const dims = getPageDimensions(1);
                if (dims) {
                    const containerWidth = containerRef.current.clientWidth - 40;
                    if (dims.width > containerWidth) {
                        scaleRef.current = clamp(containerWidth / dims.width, MIN_SCALE, MAX_SCALE);
                        setScale(scaleRef.current);
                        onZoomChange?.(scaleRef.current);
                    }
                }

                // Scroll to initial page
                let targetPage = clamp(initialPage, 1, document.numPages);
                const locationPage = parsePageFromLocation(initialLocation);
                if (locationPage !== null) {
                    targetPage = clamp(locationPage, 1, document.numPages);
                }
                
                scrollToPage(targetPage, false);
                currentPageRef.current = targetPage;
                lastPageRef.current = targetPage;
                setCurrentPage(targetPage);
            }, 100);
        }, [document, initialPage, initialLocation, onReady, getPageDimensions, onZoomChange]);

        // Scroll to page
        const scrollToPage = useCallback((pageNumber: number, smooth = true) => {
            const container = containerRef.current;
            const viewer = viewerRef.current;
            if (!container || !viewer) return;

            const pageElement = viewer.querySelector(`[data-page-number="${pageNumber}"]`) as HTMLElement;
            if (pageElement) {
                // Mark as programmatic scroll to prevent scroll handler from firing
                isProgrammaticScrollRef.current = true;
                
                const containerRect = container.getBoundingClientRect();
                const pageRect = pageElement.getBoundingClientRect();
                const relativeTop = pageRect.top - containerRect.top + container.scrollTop;
                
                container.scrollTo({
                    top: relativeTop - 10,
                    behavior: smooth ? "smooth" : "auto"
                });
                
                // Reset flag after scroll animation (or immediately if not smooth)
                setTimeout(() => {
                    isProgrammaticScrollRef.current = false;
                }, smooth ? 300 : 50);
            }
        }, []);

        // Throttled scroll handler
        const updateCurrentPageFromScroll = useCallback(() => {
            if (!document || !containerRef.current || !viewerRef.current) return;

            const container = containerRef.current;
            const viewer = viewerRef.current;
            const containerRect = container.getBoundingClientRect();
            const containerCenter = containerRect.top + containerRect.height / 2;
            
            let closestPage = 1;
            let closestDistance = Infinity;

            // Find page closest to center of viewport
            for (let i = 1; i <= document.numPages; i++) {
                const pageEl = viewer.querySelector(`[data-page-number="${i}"]`) as HTMLElement;
                if (!pageEl) continue;

                const pageRect = pageEl.getBoundingClientRect();
                const pageCenter = pageRect.top + pageRect.height / 2;
                const distance = Math.abs(pageCenter - containerCenter);

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestPage = i;
                }
            }

            // Only update if page changed
            if (closestPage !== lastPageRef.current) {
                lastPageRef.current = closestPage;
                currentPageRef.current = closestPage;
                setCurrentPage(closestPage);
                onPageChange?.(closestPage);

                const total = document.numPages;
                const fraction = (closestPage - 1) / total;
                onLocationChange?.({
                    cfi: `pdf:page=${closestPage}`,
                    percentage: fraction,
                    pageInfo: {
                        currentPage: closestPage,
                        totalPages: total,
                        endPage: total,
                        range: `${closestPage}`,
                    },
                });
            }
        }, [document, onPageChange, onLocationChange]);

        // Scroll handler with throttling
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            let rafId: number | null = null;
            let lastUpdateTime = 0;

            const handleScroll = () => {
                // Skip if we're programmatically scrolling (scrollToPage)
                if (isProgrammaticScrollRef.current) return;
                
                isScrollingRef.current = true;
                
                // Clear existing timeout
                if (scrollTimeoutRef.current) {
                    window.clearTimeout(scrollTimeoutRef.current);
                }

                // Cancel any pending RAF
                if (rafId) {
                    cancelAnimationFrame(rafId);
                }

                // Throttle updates - only update every SCROLL_THROTTLE_MS
                const now = Date.now();
                if (now - lastUpdateTime >= SCROLL_THROTTLE_MS) {
                    lastUpdateTime = now;
                    updateCurrentPageFromScroll();
                } else {
                    // Schedule update for later
                    rafId = requestAnimationFrame(() => {
                        lastUpdateTime = Date.now();
                        updateCurrentPageFromScroll();
                    });
                }

                // Reset scrolling flag after throttle period
                scrollTimeoutRef.current = window.setTimeout(() => {
                    isScrollingRef.current = false;
                }, SCROLL_THROTTLE_MS);
            };

            container.addEventListener("scroll", handleScroll, { passive: true });
            return () => {
                container.removeEventListener("scroll", handleScroll);
                if (scrollTimeoutRef.current) {
                    window.clearTimeout(scrollTimeoutRef.current);
                }
                if (rafId) {
                    cancelAnimationFrame(rafId);
                }
            };
        }, [updateCurrentPageFromScroll]);

        // Zoom control
        const setZoomInternal = useCallback((newScale: number) => {
            const safeScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
            if (Math.abs(safeScale - scaleRef.current) < 0.01) return;

            const container = containerRef.current;
            const viewer = viewerRef.current;
            let scrollRatio = 0;
            
            if (container && viewer) {
                const currentPageEl = viewer.querySelector(`[data-page-number="${currentPageRef.current}"]`) as HTMLElement;
                if (currentPageEl) {
                    const pageTop = currentPageEl.offsetTop;
                    scrollRatio = (container.scrollTop - pageTop) / currentPageEl.offsetHeight;
                }
            }

            scaleRef.current = safeScale;
            setScale(safeScale);
            onZoomChange?.(safeScale);

            // Clear rendered cache to force re-render at new scale
            setTimeout(() => {
                if (!viewerRef.current) return;
                const canvases = viewerRef.current.querySelectorAll("canvas");
                canvases.forEach((canvas) => {
                    canvas.dataset.rendered = "";
                });

                // Restore scroll position
                if (container && viewer) {
                    const currentPageEl = viewer.querySelector(`[data-page-number="${currentPageRef.current}"]`) as HTMLElement;
                    if (currentPageEl) {
                        container.scrollTop = currentPageEl.offsetTop + (currentPageEl.offsetHeight * scrollRatio);
                    }
                }
            }, 0);
        }, [onZoomChange]);

        // Expose imperative handle
        useImperativeHandle(ref, () => ({
            goTo: (location: string) => {
                const page = parsePageFromLocation(location) || 1;
                scrollToPage(clamp(page, 1, totalPagesRef.current || 1));
            },
            goToPage: (pageNumber: number) => {
                scrollToPage(clamp(pageNumber, 1, totalPagesRef.current || 1));
            },
            goToFraction: (fraction: number) => {
                const page = Math.max(1, Math.round(clamp(fraction, 0, 1) * (totalPagesRef.current || 1)));
                scrollToPage(page);
            },
            getCurrentPage: () => currentPageRef.current,
            zoomIn: () => setZoomInternal(scaleRef.current + SCALE_STEP),
            zoomOut: () => setZoomInternal(scaleRef.current - SCALE_STEP),
            setZoom: (newScale: number) => setZoomInternal(newScale),
            fitPage: () => {
                if (!containerRef.current) return;
                const containerHeight = containerRef.current.clientHeight - 40;
                const dims = getPageDimensions(1);
                if (dims) {
                    setZoomInternal(clamp(containerHeight / dims.height, MIN_SCALE, MAX_SCALE));
                }
            },
            fitWidth: () => {
                if (!containerRef.current) return;
                const containerWidth = containerRef.current.clientWidth - 40;
                const dims = getPageDimensions(1);
                if (dims) {
                    setZoomInternal(clamp(containerWidth / dims.width, MIN_SCALE, MAX_SCALE));
                }
            },
            rotate: () => {
                rotationRef.current = (rotationRef.current + 90) % 360;
                if (!viewerRef.current) return;
                const canvases = viewerRef.current.querySelectorAll("canvas");
                canvases.forEach((canvas) => {
                    canvas.dataset.rendered = "";
                });
            },
        }), [scrollToPage, setZoomInternal, getPageDimensions]);

        // Wheel zoom
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            const handleWheel = (e: WheelEvent) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP;
                    setZoomInternal(scaleRef.current + delta);
                }
            };

            container.addEventListener("wheel", handleWheel, { passive: false });
            return () => container.removeEventListener("wheel", handleWheel);
        }, [setZoomInternal]);

        // Loading state
        if (isLoading) {
            return (
                <div
                    className={cn("flex flex-col items-center justify-center h-full", className)}
                    style={{ backgroundColor: "var(--reader-bg)" }}
                >
                    <div className="space-y-4 w-64">
                        <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--color-border)" }}>
                            <div
                                className="h-full transition-all duration-300"
                                style={{
                                    width: loadProgress?.total ? `${clamp((loadProgress.loaded / loadProgress.total) * 100, 0, 100)}%` : "0%",
                                    backgroundColor: "var(--color-accent)",
                                }}
                            />
                        </div>
                        <p className="text-center text-sm" style={{ color: "var(--reader-fg)", opacity: 0.6 }}>
                            Loading PDF... {loadProgress?.total ? `${Math.round((loadProgress.loaded / loadProgress.total) * 100)}%` : ""}
                        </p>
                    </div>
                </div>
            );
        }

        // Error state
        if (error) {
            return (
                <div className={cn("flex items-center justify-center h-full", className)} style={{ backgroundColor: "var(--reader-bg)" }}>
                    <div className="text-center">
                        <p style={{ color: "var(--color-error)" }} className="mb-2">Failed to load PDF</p>
                        <p className="text-sm" style={{ color: "var(--reader-fg)", opacity: 0.6 }}>{error.message}</p>
                    </div>
                </div>
            );
        }

        // Empty state
        if (!document) {
            return (
                <div className={cn("flex items-center justify-center h-full", className)} style={{ backgroundColor: "var(--reader-bg)" }}>
                    <p style={{ color: "var(--reader-fg)", opacity: 0.6 }}>No PDF loaded</p>
                </div>
            );
        }

        return (
            <div
                ref={containerRef}
                className={cn("overflow-auto", className)}
                style={{
                    width: "100%",
                    height: "100%",
                    backgroundColor: "var(--reader-bg)",
                    outline: "none",
                }}
            >
                <div
                    ref={viewerRef}
                    className="pdfViewer"
                    style={{
                        padding: "20px",
                        minHeight: "100%",
                    }}
                >
                    {Array.from({ length: document.numPages }, (_, i) => i + 1).map((pageNumber) => (
                        <PDFPage
                            key={pageNumber}
                            pageNumber={pageNumber}
                            scale={scale}
                            rotation={rotationRef.current}
                            document={document}
                            renderPage={renderPage}
                            cancelRender={cancelRender}
                        />
                    ))}
                </div>
            </div>
        );
    }
);

PDFViewer.displayName = "PDFViewer";

export default PDFViewer;
