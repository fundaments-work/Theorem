/**
 * PDFViewer - Optimized PDF rendering with text layer support
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
import { VirtualScroller, type ViewportState } from "@/engines/pdf/virtual-scroller";
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
const SCROLL_THROTTLE_MS = 250;

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

// Text Layer Component - for text selection
interface TextLayerProps {
    textItems: TextLayerItem[];
    scale: number;
}

const TextLayer = memo(function TextLayer({ textItems, scale }: TextLayerProps) {
    return (
        <div
            className="textLayer"
            style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                overflow: "hidden",
                pointerEvents: "none",
            }}
        >
            {textItems.map((item, index) => (
                <span
                    key={index}
                    style={{
                        position: "absolute",
                        left: `${item.left * scale}px`,
                        top: `${item.top * scale}px`,
                        fontSize: `${item.fontSize * scale}px`,
                        fontFamily: item.fontFamily || 'sans-serif',
                        lineHeight: 1,
                        whiteSpace: "pre",
                        color: "transparent",
                        cursor: "text",
                        pointerEvents: "auto",
                        userSelect: "text",
                        WebkitUserSelect: "text",
                    }}
                >
                    {item.text}
                </span>
            ))}
        </div>
    );
});

// Single page component with text layer
interface PDFPageProps {
    pageNumber: number;
    scale: number;
    rotation: number;
    document: any;
    renderPage: (pageNumber: number, canvas: HTMLCanvasElement, scale: number, rotation: number) => Promise<{ width: number; height: number }>;
    getTextContent: (pageNumber: number) => Promise<TextLayerItem[]>;
    cancelRender: (pageNumber: number) => void;
}

const PDFPage = memo(function PDFPage({
    pageNumber,
    scale,
    rotation,
    document,
    renderPage,
    getTextContent,
    cancelRender,
}: PDFPageProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [textItems, setTextItems] = useState<TextLayerItem[]>([]);
    const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
    const isRenderingRef = useRef(false);

    // Render canvas
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

    // Load text content once
    useEffect(() => {
        if (!document) return;

        getTextContent(pageNumber).then(items => {
            if (items.length > 0) {
                setTextItems(items);
            }
        }).catch(err => {
            console.warn(`Failed to load text content for page ${pageNumber}:`, err);
        });
    }, [pageNumber, document, getTextContent]);

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
            {dimensions && textItems.length > 0 && (
                <TextLayer textItems={textItems} scale={scale} />
            )}
        </div>
    );
}, (prevProps, nextProps) => {
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
                        scaleRef.current = clamp(containerWidth / dims.width, MIN_SCALE, MAX_SCALE);
                        setScale(scaleRef.current);
                        onZoomChange?.(scaleRef.current);
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

            const handleScroll = () => {
                if (isProgrammaticScrollRef.current) return;
                
                isScrollingRef.current = true;
                
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

                if (container && viewer) {
                    const currentPageEl = viewer.querySelector(`[data-page-number="${currentPageRef.current}"]`) as HTMLElement;
                    if (currentPageEl) {
                        container.scrollTop = currentPageEl.offsetTop + (currentPageEl.offsetHeight * scrollRatio);
                    }
                }
            }, 0);
        }, [onZoomChange]);

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
                            key={pageNumber}
                            pageNumber={pageNumber}
                            scale={scale}
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
