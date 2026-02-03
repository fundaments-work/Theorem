/**
 * PDFViewer - Optimized PDF rendering with smooth zoom and native-like text selection
 * 
 * Architecture based on research of Obsidian and Mozilla's PDF.js implementation:
 * 1. Wrapper container holds both canvas and text layer
 * 2. CSS transform scale applied to wrapper for smooth zoom (not canvas directly)
 * 3. GPU-accelerated transforms during zoom gesture
 * 4. Re-render after gesture completes
 * 5. Improved text layer with proper CSS for native-like selection
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
import type { TextLayerItem } from "@/engines/pdf";

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
const ZOOM_DEBOUNCE_MS = 150; // Time to wait before committing zoom

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

// ============================================
// TEXT LAYER - Improved for native-like selection
// ============================================

interface TextLayerProps {
    textItems: TextLayerItem[];
    scale: number;
}

/**
 * Improved TextLayer with better selection behavior
 * Based on PDF.js best practices and Obsidian's approach
 */
const TextLayer = memo(function TextLayer({ textItems, scale }: TextLayerProps) {
    return (
        <div
            className="textLayer"
            style={{
                position: "absolute",
                inset: 0,
                overflow: "hidden",
                // Critical: opacity 0.2 for debugging, 0 for production
                opacity: 1,
                // CSS custom property for scale factor (used by child spans)
                // @ts-ignore - CSS custom property
                '--scale-factor': scale,
            }}
        >
            {textItems.map((item, index) => {
                // Apply transform for positioning (more accurate than left/top)
                const transform = `scale(${scale}) translate(${item.left}px, ${item.top}px)`;
                
                return (
                    <span
                        key={index}
                        style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            // Use transform for positioning - GPU accelerated and more precise
                            transform: `translate(${item.left * scale}px, ${item.top * scale}px)`,
                            transformOrigin: "0 0",
                            fontSize: `${item.fontSize * scale}px`,
                            fontFamily: item.fontFamily || 'sans-serif',
                            // Line height to match PDF
                            lineHeight: 1,
                            whiteSpace: "pre",
                            // Transparent color but selectable
                            color: "transparent",
                            // Ensure text is selectable
                            cursor: "text",
                            userSelect: "text",
                            WebkitUserSelect: "text",
                            // Pointer events must be auto for selection to work
                            pointerEvents: "auto",
                            // Extend height slightly to cover gaps between lines
                            // This prevents selection from jumping
                            paddingBottom: "0.1em",
                            // Ensure proper z-index
                            zIndex: 1,
                        }}
                    >
                        {item.text}
                    </span>
                );
            })}
        </div>
    );
});

// ============================================
// PAGE COMPONENT - Wrapper architecture for smooth zoom
// ============================================

interface PDFPageProps {
    pageNumber: number;
    scale: number;
    cssScale: number; // For CSS transform during zoom gesture
    rotation: number;
    document: any;
    renderPage: (pageNumber: number, canvas: HTMLCanvasElement, scale: number, rotation: number) => Promise<{ width: number; height: number }>;
    getTextContent: (pageNumber: number) => Promise<TextLayerItem[]>;
    cancelRender: (pageNumber: number) => void;
}

/**
 * PDFPage with wrapper architecture for smooth zoom
 * 
 * Structure:
 * ┌─ pageWrapper (fixed size, no transform) ─┐
 * │  ┌─ layerContainer (CSS transform here) ─┐│
 * │  │  ┌─ canvas ─┐ ┌─ textLayer ─┐        ││
 * │  │  └──────────┘ └─────────────┘        ││
 * │  └───────────────────────────────────────┘│
 * └───────────────────────────────────────────┘
 */
const PDFPage = memo(function PDFPage({
    pageNumber,
    scale,
    cssScale,
    rotation,
    document,
    renderPage,
    getTextContent,
    cancelRender,
}: PDFPageProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [textItems, setTextItems] = useState<TextLayerItem[]>([]);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
    const isRenderingRef = useRef(false);
    const hasTextLoadedRef = useRef(false);

    // Render canvas at actual scale
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
                    setDimensions(result);
                }
            } catch (err) {
                if (err instanceof Error && !err.message.includes("cancelled")) {
                    console.error(`Page ${pageNumber} render error:`, err);
                }
            } finally {
                isRenderingRef.current = false;
            }
        };

        doRender();

        return () => {
            cancelRender(pageNumber);
        };
    }, [pageNumber, scale, rotation, document, renderPage, cancelRender]);

    // Load text content once per page
    useEffect(() => {
        if (!document || hasTextLoadedRef.current) return;

        getTextContent(pageNumber).then(items => {
            if (items.length > 0) {
                setTextItems(items);
                hasTextLoadedRef.current = true;
            }
        }).catch(err => {
            console.warn(`Failed to load text content for page ${pageNumber}:`, err);
        });
    }, [pageNumber, document, getTextContent]);

    // Calculate CSS transform for smooth zoom
    // When cssScale differs from 1, we're in a zoom gesture
    const containerTransform = cssScale !== 1 
        ? `scale(${cssScale})` 
        : 'none';

    return (
        <div
            ref={wrapperRef}
            data-page-number={pageNumber}
            className="pdf-page-wrapper"
            style={{
                position: "relative",
                margin: "10px auto",
                // Fixed dimensions based on rendered size
                width: dimensions ? `${dimensions.width}px` : 'auto',
                height: dimensions ? `${dimensions.height}px` : 'auto',
                // Minimum dimensions while loading
                minWidth: dimensions ? undefined : '200px',
                minHeight: dimensions ? undefined : '200px',
                backgroundColor: "white",
                boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                // Ensure wrapper doesn't transform
                transform: 'none',
            }}
        >
            {/* Layer container - CSS transform applied here for smooth zoom */}
            <div
                ref={containerRef}
                className="pdf-layer-container"
                style={{
                    position: "absolute",
                    inset: 0,
                    transform: containerTransform,
                    transformOrigin: "center center",
                    // GPU acceleration
                    willChange: cssScale !== 1 ? 'transform' : 'auto',
                    transition: cssScale !== 1 ? 'none' : 'transform 0.1s ease-out',
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
                {textItems.length > 0 && (
                    <TextLayer textItems={textItems} scale={scale} />
                )}
            </div>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison for memo
    return (
        prevProps.pageNumber === nextProps.pageNumber &&
        prevProps.scale === nextProps.scale &&
        prevProps.cssScale === nextProps.cssScale &&
        prevProps.rotation === nextProps.rotation &&
        prevProps.document === nextProps.document
    );
});

// ============================================
// MAIN VIEWER COMPONENT
// ============================================

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
        const isProgrammaticScrollRef = useRef(false);

        const currentPageRef = useRef(clamp(initialPage, 1, 10000));
        const totalPagesRef = useRef(0);
        const scaleRef = useRef(clamp(initialScale, MIN_SCALE, MAX_SCALE));
        const rotationRef = useRef(0);

        const [currentPage, setCurrentPage] = useState(currentPageRef.current);
        const [scale, setScale] = useState(scaleRef.current);
        
        // CSS scale for smooth zoom transitions
        const [cssScale, setCssScale] = useState(1);
        const isZoomingRef = useRef(false);
        const zoomCommitTimeoutRef = useRef<number | null>(null);
        const targetScaleRef = useRef(scale);

        const { isLoading, loadProgress, error, document, loadDocument, renderPage, getTextContent, getPageDimensions, cancelRender } = usePDF();

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
            setCssScale(1);

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

            setTimeout(() => {
                if (!mountedRef.current || !containerRef.current) return;
                
                const dims = getPageDimensions(1);
                if (dims) {
                    const containerWidth = containerRef.current.clientWidth - 40;
                    if (dims.width > containerWidth) {
                        const newScale = clamp(containerWidth / dims.width, MIN_SCALE, MAX_SCALE);
                        scaleRef.current = newScale;
                        targetScaleRef.current = newScale;
                        setScale(newScale);
                        onZoomChange?.(newScale);
                    }
                }

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

        const scrollToPage = useCallback((pageNumber: number, smooth = true) => {
            const container = containerRef.current;
            const viewer = viewerRef.current;
            if (!container || !viewer) return;

            const pageElement = viewer.querySelector(`[data-page-number="${pageNumber}"]`) as HTMLElement;
            if (pageElement) {
                isProgrammaticScrollRef.current = true;
                
                const containerRect = container.getBoundingClientRect();
                const pageRect = pageElement.getBoundingClientRect();
                const relativeTop = pageRect.top - containerRect.top + container.scrollTop;
                
                container.scrollTo({
                    top: relativeTop - 10,
                    behavior: smooth ? "smooth" : "auto"
                });
                
                setTimeout(() => {
                    isProgrammaticScrollRef.current = false;
                }, smooth ? 300 : 50);
            }
        }, []);

        const updateCurrentPageFromScroll = useCallback(() => {
            if (!document || !containerRef.current || !viewerRef.current) return;

            const container = containerRef.current;
            const viewer = viewerRef.current;
            const containerRect = container.getBoundingClientRect();
            const containerCenter = containerRect.top + containerRect.height / 2;
            
            let closestPage = 1;
            let closestDistance = Infinity;

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

        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            let rafId: number | null = null;
            let lastUpdateTime = 0;
            const SCROLL_THROTTLE_MS = 100;

            const handleScroll = () => {
                if (isProgrammaticScrollRef.current) return;
                
                if (scrollTimeoutRef.current) {
                    window.clearTimeout(scrollTimeoutRef.current);
                }

                if (rafId) {
                    cancelAnimationFrame(rafId);
                }

                const now = Date.now();
                if (now - lastUpdateTime >= SCROLL_THROTTLE_MS) {
                    lastUpdateTime = now;
                    updateCurrentPageFromScroll();
                } else {
                    rafId = requestAnimationFrame(() => {
                        lastUpdateTime = Date.now();
                        updateCurrentPageFromScroll();
                    });
                }

                scrollTimeoutRef.current = window.setTimeout(() => {
                    // Scroll settled
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

        /**
         * SMOOTH ZOOM IMPLEMENTATION
         * 
         * Strategy:
         * 1. Apply CSS transform to layer containers for immediate visual feedback
         * 2. Debounce the actual re-render
         * 3. Reset CSS transform and re-render at new scale after gesture completes
         */
        const commitZoom = useCallback(() => {
            if (!isZoomingRef.current) return;

            const newScale = targetScaleRef.current;
            
            // Reset CSS scale (removes the transform)
            setCssScale(1);
            
            // Update actual scale (triggers re-render)
            scaleRef.current = newScale;
            setScale(newScale);
            onZoomChange?.(newScale);
            
            // Clear canvas cache to force re-render at new scale
            if (viewerRef.current) {
                const canvases = viewerRef.current.querySelectorAll("canvas");
                canvases.forEach((canvas) => {
                    canvas.dataset.rendered = "";
                });
            }

            isZoomingRef.current = false;
        }, [onZoomChange]);

        const setZoomSmooth = useCallback((newScale: number) => {
            const safeScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
            const currentScale = scaleRef.current;
            
            if (Math.abs(safeScale - currentScale) < 0.01) return;

            isZoomingRef.current = true;
            targetScaleRef.current = safeScale;

            // Calculate CSS scale relative to current scale
            const relativeScale = safeScale / currentScale;
            setCssScale(relativeScale);

            // Debounce the commit
            if (zoomCommitTimeoutRef.current) {
                clearTimeout(zoomCommitTimeoutRef.current);
            }

            zoomCommitTimeoutRef.current = window.setTimeout(() => {
                commitZoom();
            }, ZOOM_DEBOUNCE_MS);
        }, [commitZoom]);

        const setZoomImmediate = useCallback((newScale: number) => {
            // Cancel any pending smooth zoom
            if (zoomCommitTimeoutRef.current) {
                clearTimeout(zoomCommitTimeoutRef.current);
            }
            
            targetScaleRef.current = clamp(newScale, MIN_SCALE, MAX_SCALE);
            setCssScale(1);
            commitZoom();
        }, [commitZoom]);

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
            zoomIn: () => setZoomSmooth(scaleRef.current + SCALE_STEP),
            zoomOut: () => setZoomSmooth(scaleRef.current - SCALE_STEP),
            setZoom: (newScale: number) => setZoomImmediate(newScale),
            fitPage: () => {
                if (!containerRef.current) return;
                const containerHeight = containerRef.current.clientHeight - 40;
                const dims = getPageDimensions(1);
                if (dims) {
                    setZoomSmooth(clamp(containerHeight / dims.height, MIN_SCALE, MAX_SCALE));
                }
            },
            fitWidth: () => {
                if (!containerRef.current) return;
                const containerWidth = containerRef.current.clientWidth - 40;
                const dims = getPageDimensions(1);
                if (dims) {
                    setZoomSmooth(clamp(containerWidth / dims.width, MIN_SCALE, MAX_SCALE));
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
        }), [scrollToPage, setZoomSmooth, setZoomImmediate, getPageDimensions, commitZoom]);

        // Wheel zoom with smooth scaling
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            const handleWheel = (e: WheelEvent) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP;
                    setZoomSmooth(scaleRef.current + delta);
                }
            };

            container.addEventListener("wheel", handleWheel, { passive: false });
            return () => container.removeEventListener("wheel", handleWheel);
        }, [setZoomSmooth]);

        // Cleanup on unmount
        useEffect(() => {
            return () => {
                if (zoomCommitTimeoutRef.current) {
                    clearTimeout(zoomCommitTimeoutRef.current);
                }
            };
        }, []);

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
                            key={`${pageNumber}-${scale}`}
                            pageNumber={pageNumber}
                            scale={scale}
                            cssScale={cssScale}
                            rotation={rotationRef.current}
                            document={document}
                            renderPage={renderPage}
                            getTextContent={getTextContent}
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
