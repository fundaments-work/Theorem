/**
 * PDFViewer - High-performance PDF rendering with smooth zoom
 *
 * Key optimizations (based on Mozilla PDF.js and Obsidian):
 * 1. CSS-only zoom during gesture - no re-renders until gesture ends (800ms idle)
 * 2. Double-buffering - old canvas stays visible until new render completes
 * 3. Page virtualization - only visible + buffer pages are mounted
 * 4. Stable dimensions - wrapper size doesn't change during CSS zoom
 * 5. Cached page dimensions - placeholders use actual rendered sizes
 */

import React, {
    useRef,
    useEffect,
    useState,
    useCallback,
    useImperativeHandle,
    forwardRef,
    memo,
    useMemo,
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

// Constants
const MIN_SCALE = 0.25;
const MAX_SCALE = 5.0;
const SCALE_STEP = 0.1;
const ZOOM_COMMIT_DELAY_MS = 300; // Wait 800ms after last wheel event before re-rendering
const BUFFER_PAGES_AHEAD = 5; // Pre-render 5 pages ahead to prevent blank canvas during scroll
const BUFFER_PAGES_BEHIND = 3; // Keep 3 pages behind
const SCROLL_UPDATE_DELAY_MS = 50; // Fast scroll detection (was 150ms - too slow)
const PAGE_CLEANUP_DELAY_MS = 3000; // Delay before releasing invisible pages

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
// TEXT LAYER
// ============================================

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
                inset: 0,
                overflow: "hidden",
                opacity: 1,
                // @ts-ignore - CSS custom property
                "--scale-factor": scale,
            }}
        >
            {textItems.map((item, index) => (
                <span
                    key={index}
                    style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        transform: `translate(${item.left * scale}px, ${item.top * scale}px)`,
                        transformOrigin: "0 0",
                        fontSize: `${item.fontSize * scale}px`,
                        fontFamily: item.fontFamily || "sans-serif",
                        lineHeight: 1,
                        whiteSpace: "pre",
                        color: "transparent",
                        cursor: "text",
                        userSelect: "text",
                        WebkitUserSelect: "text",
                        pointerEvents: "auto",
                        paddingBottom: "0.1em",
                        zIndex: 1,
                    }}
                >
                    {item.text}
                </span>
            ))}
        </div>
    );
});

// ============================================
// PAGE COMPONENT - With double-buffering and crossfade
// ============================================

// Crossfade duration in milliseconds
const CROSSFADE_DURATION_MS = 100;

interface PDFPageProps {
    pageNumber: number;
    baseScale: number; // The actual render scale
    cssZoomFactor: number; // Additional CSS zoom (1.0 = no zoom)
    rotation: number;
    document: any;
    isZooming: boolean; // Whether a zoom gesture is in progress
    isCommittingZoom: boolean; // Whether we're transitioning from CSS zoom to rendered
    zoomAnchorOrigin?: string; // Dynamic transform-origin for zoom (e.g., "center 150px")
    renderPage: (
        pageNumber: number,
        canvas: HTMLCanvasElement,
        scale: number,
        rotation: number
    ) => Promise<{ width: number; height: number }>;
    getTextContent: (pageNumber: number) => Promise<TextLayerItem[]>;
    cancelRender: (pageNumber: number) => void;
    onDimensionsKnown?: (pageNumber: number, width: number, height: number) => void;
    onRenderComplete?: (pageNumber: number) => void; // Called when page finishes rendering at new scale
}

const PDFPage = memo(
    function PDFPage({
        pageNumber,
        baseScale,
        cssZoomFactor,
        rotation,
        document,
        isZooming,
        isCommittingZoom,
        zoomAnchorOrigin,
        renderPage,
        getTextContent,
        cancelRender,
        onDimensionsKnown,
        onRenderComplete,
    }: PDFPageProps) {
        // Double-buffering: two canvases for smooth transitions
        const frontCanvasRef = useRef<HTMLCanvasElement>(null);
        const backCanvasRef = useRef<HTMLCanvasElement>(null);
        const wrapperRef = useRef<HTMLDivElement>(null);
        
        const [textItems, setTextItems] = useState<TextLayerItem[]>([]);
        const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
        const [isRendering, setIsRendering] = useState(false);
        const [showFront, setShowFront] = useState(true);
        const [isCrossfading, setIsCrossfading] = useState(false);
        
        const renderedScaleRef = useRef<number>(0); // Track what scale we've rendered at
        const pendingRenderRef = useRef<boolean>(false);
        const textLoadedRef = useRef(false);
        const crossfadeTimeoutRef = useRef<number | null>(null);
        // Track which canvas has valid content to prevent blank states
        const frontHasContentRef = useRef(false);
        const backHasContentRef = useRef(false);

        // Cleanup crossfade timeout on unmount
        useEffect(() => {
            return () => {
                if (crossfadeTimeoutRef.current) {
                    clearTimeout(crossfadeTimeoutRef.current);
                }
            };
        }, []);

        // Render canvas at base scale - with double-buffering and crossfade
        useEffect(() => {
            // Check if we need to render at this scale
            if (renderedScaleRef.current === baseScale && dimensions) {
                // Already rendered at this scale - notify parent if committing
                if (isCommittingZoom) {
                    onRenderComplete?.(pageNumber);
                }
                return;
            }
            
            // Don't re-render during zoom gesture if we already have content at a different scale
            // But DO render if this is the first time (no content yet)
            const hasAnyContent = frontHasContentRef.current || backHasContentRef.current;
            if (isZooming && hasAnyContent) {
                return;
            }

            // Get the back buffer (the one not currently showing)
            const targetCanvas = showFront ? backCanvasRef.current : frontCanvasRef.current;
            if (!document || !targetCanvas) return;

            // Don't start another render if one is pending
            if (pendingRenderRef.current) return;
            pendingRenderRef.current = true;
            setIsRendering(true);

            const doRender = async () => {
                try {
                    const result = await renderPage(pageNumber, targetCanvas, baseScale, rotation);
                    
                    // Mark the target canvas as having content
                    if (showFront) {
                        backHasContentRef.current = true;
                    } else {
                        frontHasContentRef.current = true;
                    }
                    
                    // Update dimensions immediately
                    renderedScaleRef.current = baseScale;
                    setDimensions(result);
                    onDimensionsKnown?.(pageNumber, result.width, result.height);
                    
                    // Start crossfade transition
                    setIsCrossfading(true);
                    
                    // After crossfade duration, complete the swap
                    crossfadeTimeoutRef.current = window.setTimeout(() => {
                        // Swap buffers - show the newly rendered canvas
                        setShowFront(!showFront);
                        setIsCrossfading(false);
                        
                        // Notify parent that this page has finished rendering at the new scale
                        onRenderComplete?.(pageNumber);
                    }, CROSSFADE_DURATION_MS);
                    
                } catch (err) {
                    if (err instanceof Error && !err.message.includes("cancelled")) {
                        console.error(`Page ${pageNumber} render error:`, err);
                    }
                } finally {
                    pendingRenderRef.current = false;
                    setIsRendering(false);
                }
            };

            doRender();

            return () => {
                cancelRender(pageNumber);
                pendingRenderRef.current = false;
                if (crossfadeTimeoutRef.current) {
                    clearTimeout(crossfadeTimeoutRef.current);
                }
            };
        }, [pageNumber, baseScale, rotation, document, isZooming, isCommittingZoom, showFront, dimensions, renderPage, cancelRender, onDimensionsKnown, onRenderComplete]);

        // Load text content once
        useEffect(() => {
            if (!document || textLoadedRef.current) return;

            getTextContent(pageNumber)
                .then((items) => {
                    if (items.length > 0) {
                        setTextItems(items);
                        textLoadedRef.current = true;
                    }
                })
                .catch((err) => {
                    console.warn(`Failed to load text for page ${pageNumber}:`, err);
                });
        }, [pageNumber, document, getTextContent]);

        // Calculate wrapper dimensions - STABLE during CSS zoom
        const wrapperWidth = dimensions ? dimensions.width : 200;
        const wrapperHeight = dimensions ? dimensions.height : 280;

        // Determine transform-origin for wrapper
        // Use provided anchor origin, or default to center
        const transformOrigin = zoomAnchorOrigin || "center center";
        
        // Wrapper transform for CSS zoom (moved from individual canvases)
        const wrapperTransform = cssZoomFactor !== 1 ? `scale(${cssZoomFactor})` : "none";

        // Calculate canvas opacity based on crossfade state
        // During crossfade: both canvases visible, new one fades in
        // Normal: only active buffer visible
        const getFrontCanvasOpacity = () => {
            if (isCrossfading) {
                // During crossfade, old canvas (currently showing) stays visible
                // New canvas fades in. Since we haven't swapped yet, showFront is old state
                return showFront ? 1 : 1; // Keep visible
            }
            // Normal state: show only the active buffer
            return showFront ? 1 : 0;
        };
        
        const getBackCanvasOpacity = () => {
            if (isCrossfading) {
                // During crossfade, new canvas (back buffer) fades in
                return showFront ? 1 : 1; // Both visible during crossfade
            }
            // Normal state: show only the active buffer
            return !showFront ? 1 : 0;
        };
        
        // Determine z-index: new content should be on top during crossfade
        const getFrontCanvasZIndex = () => {
            if (isCrossfading) {
                // During crossfade: if front is old (showFront=true), put new (back) on top
                return showFront ? 1 : 2;
            }
            return showFront ? 2 : 1;
        };
        
        const getBackCanvasZIndex = () => {
            if (isCrossfading) {
                // During crossfade: if back is new (showFront=true), put it on top
                return showFront ? 2 : 1;
            }
            return !showFront ? 2 : 1;
        };

        return (
            <div
                ref={wrapperRef}
                data-page-number={pageNumber}
                className="pdf-page-wrapper"
                style={{
                    position: "relative",
                    margin: "10px auto",
                    width: `${wrapperWidth}px`,
                    height: `${wrapperHeight}px`,
                    backgroundColor: "white",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                    // Apply zoom transform to wrapper with dynamic origin
                    transform: wrapperTransform,
                    transformOrigin: transformOrigin,
                    overflow: "visible",
                    // GPU acceleration during zoom
                    willChange: cssZoomFactor !== 1 ? "transform" : "auto",
                }}
            >
                {/* Front canvas */}
                <canvas
                    ref={frontCanvasRef}
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        opacity: getFrontCanvasOpacity(),
                        zIndex: getFrontCanvasZIndex(),
                        // Smooth opacity transition during crossfade
                        transition: isCrossfading 
                            ? `opacity ${CROSSFADE_DURATION_MS}ms ease-out` 
                            : "none",
                        pointerEvents: showFront ? "auto" : "none",
                        backgroundColor: "white",
                    }}
                />
                {/* Back canvas (for double-buffering) */}
                <canvas
                    ref={backCanvasRef}
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        opacity: getBackCanvasOpacity(),
                        zIndex: getBackCanvasZIndex(),
                        // Smooth opacity transition during crossfade
                        transition: isCrossfading 
                            ? `opacity ${CROSSFADE_DURATION_MS}ms ease-out` 
                            : "none",
                        pointerEvents: showFront ? "none" : "auto",
                        backgroundColor: "white",
                    }}
                />
                {/* Text layer - scales with wrapper */}
                {textItems.length > 0 && (
                    <div style={{ position: "absolute", inset: 0 }}>
                        <TextLayer textItems={textItems} scale={baseScale} />
                    </div>
                )}
                {/* Loading indicator - only show if no content yet */}
                {!dimensions && (
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "rgba(0,0,0,0.3)",
                            fontSize: "14px",
                        }}
                    >
                        {isRendering ? "..." : ""}
                    </div>
                )}
            </div>
        );
    },
    (prevProps, nextProps) => {
        // Only re-render when these change
        return (
            prevProps.pageNumber === nextProps.pageNumber &&
            prevProps.baseScale === nextProps.baseScale &&
            prevProps.cssZoomFactor === nextProps.cssZoomFactor &&
            prevProps.rotation === nextProps.rotation &&
            prevProps.document === nextProps.document &&
            prevProps.isZooming === nextProps.isZooming &&
            prevProps.isCommittingZoom === nextProps.isCommittingZoom &&
            prevProps.zoomAnchorOrigin === nextProps.zoomAnchorOrigin
        );
    }
);

// ============================================
// PAGE PLACEHOLDER - For scroll height calculation
// ============================================

interface PagePlaceholderProps {
    pageNumber: number;
    width: number;
    height: number;
}

const PagePlaceholder = memo(function PagePlaceholder({
    pageNumber,
    width,
    height,
}: PagePlaceholderProps) {
    return (
        <div
            data-page-number={pageNumber}
            data-placeholder="true"
            className="pdf-page-placeholder"
            style={{
                width: `${width}px`,
                height: `${height}px`,
                margin: "10px auto",
                backgroundColor: "white",
                boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            }}
        />
    );
});

// ============================================
// MAIN VIEWER COMPONENT
// ============================================

export const PDFViewer = forwardRef<PDFViewerHandle, PDFViewerProps>(
    (
        {
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
        },
        ref
    ) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const viewerRef = useRef<HTMLDivElement>(null);
        const mountedRef = useRef(true);
        const isProgrammaticScrollRef = useRef(false);
        const isRestoringScrollRef = useRef(false);
        const safetyTimeoutRef = useRef<number | null>(null);

        // Core state
        const [currentPage, setCurrentPage] = useState(1);
        const baseScaleRef = useRef(clamp(initialScale, MIN_SCALE, MAX_SCALE));
        const [baseScale, setBaseScale] = useState(baseScaleRef.current);
        const rotationRef = useRef(0);

        // CSS zoom state (for smooth zooming without re-render)
        // Using a state machine to batch updates and prevent cascading re-renders
        type ZoomState = 
            | { type: 'idle' } 
            | { type: 'gesture'; factor: number } 
            | { type: 'committing'; factor: number };
        const [zoomState, setZoomState] = useState<ZoomState>({ type: 'idle' });
        
        // Derived values from zoomState - useMemo prevents recalculation on every render
        const isZooming = zoomState.type === 'gesture';
        const isCommittingZoom = zoomState.type === 'committing';
        const cssZoomFactor = zoomState.type === 'idle' ? 1 : zoomState.factor;
        
        const targetScaleRef = useRef(baseScale);
        const zoomCommitTimeoutRef = useRef<number | null>(null);
        const pendingRenderCountRef = useRef(0); // Track how many pages still need to render
        
        // Scroll preservation during zoom - stores state before zoom to adjust after
        const scrollStateBeforeZoomRef = useRef<{
            scrollTop: number;
            scrollLeft: number;
            containerHeight: number;
            containerWidth: number;
            scale: number;
        } | null>(null);
        
        // Zoom anchor tracking for cursor-anchored zoom
        // Stores the anchor point in content and container coordinates
        const zoomAnchorRef = useRef<{
            // Position of the anchor point in content coordinates (at the scale when captured)
            contentX: number;
            contentY: number;
            // Position of the anchor relative to the container viewport (fixed during zoom)
            containerX: number;
            containerY: number;
            // The effective scale when this anchor was captured
            capturedScale: number;
        } | null>(null);
        
        // Store cursor position from wheel events for zoom anchor
        const pendingZoomCursorRef = useRef<{ clientX: number; clientY: number } | null>(null);
        
        // Zoom anchor origin for transform-origin calculation
        // Stores the anchor position in content coordinates for each page to calculate its transform-origin
        const [zoomAnchorOrigin, setZoomAnchorOrigin] = useState<{
            contentX: number;
            contentY: number;
        } | null>(null);

        // Virtualization state
        const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));
        const scrollUpdateTimeoutRef = useRef<number | null>(null);

        // Page dimensions cache - persists actual rendered sizes
        const pageDimensionsCache = useRef<Map<number, { width: number; height: number }>>(new Map());
        const defaultPageDimensions = useRef<{ width: number; height: number }>({ width: 600, height: 800 });

        const {
            isLoading,
            loadProgress,
            error,
            document,
            loadDocument,
            renderPage,
            getTextContent,
            getPageDimensions,
            cancelRender,
            releasePages,
        } = usePDF();

        // Calculate which pages should be rendered
        const pagesToRender = useMemo(() => {
            const pages = new Set<number>();
            const sortedVisible = Array.from(visiblePages).sort((a, b) => a - b);

            if (sortedVisible.length === 0) {
                pages.add(1);
                return pages;
            }

            const firstVisible = sortedVisible[0];
            const lastVisible = sortedVisible[sortedVisible.length - 1];
            const totalPages = document?.numPages || 1;

            // Add visible pages
            for (const page of sortedVisible) {
                pages.add(page);
            }

            // Add buffer pages ahead
            for (let i = 1; i <= BUFFER_PAGES_AHEAD; i++) {
                const page = lastVisible + i;
                if (page <= totalPages) pages.add(page);
            }

            // Add buffer pages behind
            for (let i = 1; i <= BUFFER_PAGES_BEHIND; i++) {
                const page = firstVisible - i;
                if (page >= 1) pages.add(page);
            }

            return pages;
        }, [visiblePages, document?.numPages]);

        // Cleanup pages that are no longer needed (delayed)
        useEffect(() => {
            const cleanupTimeout = setTimeout(() => {
                releasePages(pagesToRender);
            }, PAGE_CLEANUP_DELAY_MS);

            return () => clearTimeout(cleanupTimeout);
        }, [pagesToRender, releasePages]);

        // Lifecycle
        useEffect(() => {
            mountedRef.current = true;
            return () => {
                mountedRef.current = false;
                if (zoomCommitTimeoutRef.current) {
                    clearTimeout(zoomCommitTimeoutRef.current);
                }
                if (scrollUpdateTimeoutRef.current) {
                    clearTimeout(scrollUpdateTimeoutRef.current);
                }
                if (safetyTimeoutRef.current) {
                    clearTimeout(safetyTimeoutRef.current);
                }
            };
        }, []);

        // Track previous scale prop to detect external changes (not from this component)
        const prevScalePropRef = useRef(initialScale);
        const isInternalChangeRef = useRef(false);
        
        // Handle external scale changes (from toolbar buttons in parent)
        useEffect(() => {
            // Skip if document not loaded
            if (!document || !file) return;
            
            // Skip if this change was triggered internally (via onZoomChange callback)
            if (isInternalChangeRef.current) {
                isInternalChangeRef.current = false;
                prevScalePropRef.current = initialScale;
                return;
            }
            
            // Only update if scale prop is significantly different from internal state
            const internalDiff = Math.abs(initialScale - baseScaleRef.current);
            
            if (internalDiff > 0.001) {
                // External scale change detected - sync internal state
                prevScalePropRef.current = initialScale;
                baseScaleRef.current = initialScale;
                targetScaleRef.current = initialScale;
                setBaseScale(initialScale);
                // Reset CSS zoom state for clean transition (single atomic update)
                setZoomState({ type: 'idle' });
                pendingRenderCountRef.current = 0;
            }
        }, [initialScale, document, file]);

        // Load document
        useEffect(() => {
            if (!file) return;

            setCurrentPage(1);
            baseScaleRef.current = initialScale;
            setBaseScale(initialScale);
            // Single atomic state update for zoom-related states
            setZoomState({ type: 'idle' });
            pendingRenderCountRef.current = 0;
            targetScaleRef.current = initialScale;
            setVisiblePages(new Set([1]));
            pageDimensionsCache.current.clear();
            prevScalePropRef.current = initialScale;

            loadDocument(file).catch((err) => {
                if (mountedRef.current) {
                    onError?.(err instanceof Error ? err : new Error(String(err)));
                }
            });
            // Note: initialScale is intentionally not in deps to avoid reload on zoom changes
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [file, loadDocument, onError]);

        // Handle document ready
        useEffect(() => {
            if (!document) return;

            onReady?.(document.metadata, document.toc);

            // Fit to width initially if needed
            setTimeout(() => {
                if (!mountedRef.current || !containerRef.current) return;

                const dims = getPageDimensions(1);
                if (dims) {
                    defaultPageDimensions.current = { width: dims.width, height: dims.height };
                    const containerWidth = containerRef.current.clientWidth - 40;
                    if (dims.width > containerWidth) {
                        const newScale = clamp(containerWidth / dims.width, MIN_SCALE, MAX_SCALE);
                        baseScaleRef.current = newScale;
                        targetScaleRef.current = newScale;
                        setBaseScale(newScale);
                        isInternalChangeRef.current = true;
                        onZoomChange?.(newScale);
                    }
                }

                // Navigate to initial page
                let targetPage = clamp(initialPage, 1, document.numPages);
                const locationPage = parsePageFromLocation(initialLocation);
                if (locationPage !== null) {
                    targetPage = clamp(locationPage, 1, document.numPages);
                }

                if (targetPage > 1) {
                    scrollToPage(targetPage, false);
                }
                setCurrentPage(targetPage);
            }, 100);
        }, [document, initialPage, initialLocation, onReady, getPageDimensions, onZoomChange]);

        // Scroll to page
        const scrollToPage = useCallback((pageNumber: number, smooth = true) => {
            const container = containerRef.current;
            const viewer = viewerRef.current;
            if (!container || !viewer) return;

            const pageElement = viewer.querySelector(
                `[data-page-number="${pageNumber}"]`
            ) as HTMLElement;
            if (pageElement) {
                isProgrammaticScrollRef.current = true;

                const containerRect = container.getBoundingClientRect();
                const pageRect = pageElement.getBoundingClientRect();
                const relativeTop = pageRect.top - containerRect.top + container.scrollTop;

                container.scrollTo({
                    top: relativeTop - 10,
                    behavior: smooth ? "smooth" : "auto",
                });

                setTimeout(
                    () => {
                        isProgrammaticScrollRef.current = false;
                    },
                    smooth ? 300 : 50
                );
            }
        }, []);

        // ============================================
        // SCROLL PRESERVATION DURING ZOOM
        // ============================================
        
        /**
         * Save current scroll state and zoom anchor before zooming.
         * This captures the anchor point that should remain stable after zoom.
         * 
         * @param anchorPoint - Optional cursor position to use as anchor (for wheel zoom).
         *                      If not provided, uses viewport center (for button zoom).
         */
        const saveScrollStateBeforeZoom = useCallback((anchorPoint?: { clientX: number; clientY: number }) => {
            const container = containerRef.current;
            if (!container) return;
            
            // Calculate the EFFECTIVE visual scale (baseScale × cssZoomFactor)
            // This is what determines the current on-screen content dimensions
            const currentCssZoom = zoomState.type === "idle" ? 1 : zoomState.factor;
            const visualScale = baseScaleRef.current * currentCssZoom;
            
            // Get container position for coordinate conversion
            const rect = container.getBoundingClientRect();
            
            // Determine anchor point in container-relative coordinates
            // Default: viewport center
            let anchorContainerX = container.clientWidth / 2;
            let anchorContainerY = container.clientHeight / 2;
            
            // If cursor position provided (wheel zoom), use it as anchor
            if (anchorPoint) {
                anchorContainerX = anchorPoint.clientX - rect.left;
                anchorContainerY = anchorPoint.clientY - rect.top;
                
                // Clamp to container bounds
                anchorContainerX = Math.max(0, Math.min(anchorContainerX, container.clientWidth));
                anchorContainerY = Math.max(0, Math.min(anchorContainerY, container.clientHeight));
            }
            
            // Calculate anchor position in content coordinates (at current visual scale)
            const anchorContentX = container.scrollLeft + anchorContainerX;
            const anchorContentY = container.scrollTop + anchorContainerY;
            
            // Store the zoom anchor
            zoomAnchorRef.current = {
                contentX: anchorContentX,
                contentY: anchorContentY,
                containerX: anchorContainerX,
                containerY: anchorContainerY,
                capturedScale: visualScale,
            };
            
            // Also save scroll state for reference
            scrollStateBeforeZoomRef.current = {
                scrollTop: container.scrollTop,
                scrollLeft: container.scrollLeft,
                containerHeight: container.clientHeight,
                containerWidth: container.clientWidth,
                scale: visualScale,
            };
        }, [zoomState]);
        
        /**
         * Restore scroll position after zoom to keep the anchor point stable.
         * 
         * The math:
         * 1. Convert anchor from old content coords to PDF coords (scale-independent)
         * 2. Convert PDF coords to new content coords at new scale
         * 3. Calculate scroll to keep anchor at same container position
         * 
         * Formula:
         *   anchorPdf = anchorContent / oldScale
         *   anchorNewContent = anchorPdf * newScale
         *   newScroll = anchorNewContent - anchorContainer
         */
        const restoreScrollPositionAfterZoom = useCallback(() => {
            const container = containerRef.current;
            const anchor = zoomAnchorRef.current;
            
            if (!container || !anchor) {
                // Clear refs even if we can't restore
                zoomAnchorRef.current = null;
                scrollStateBeforeZoomRef.current = null;
                return;
            }
            
            const newScale = baseScaleRef.current;
            const oldScale = anchor.capturedScale;
            
            // If scales are effectively equal, no adjustment needed
            // This happens when the visual scale before and after are the same
            if (Math.abs(newScale - oldScale) < 0.001) {
                zoomAnchorRef.current = null;
                scrollStateBeforeZoomRef.current = null;
                return;
            }
            
            // Step 1: Convert anchor from content coordinates to PDF coordinates
            // PDF coordinates are scale-independent (as if scale = 1.0)
            const anchorPdfX = anchor.contentX / oldScale;
            const anchorPdfY = anchor.contentY / oldScale;
            
            // Step 2: Convert PDF coordinates to new content coordinates
            const anchorNewContentX = anchorPdfX * newScale;
            const anchorNewContentY = anchorPdfY * newScale;
            
            // Step 3: Calculate scroll position to keep anchor at same container position
            // anchor.containerX/Y is where the anchor was in the viewport (fixed)
            const newScrollLeft = anchorNewContentX - anchor.containerX;
            const newScrollTop = anchorNewContentY - anchor.containerY;
            
            // Apply scroll with proper flags to prevent interference
            isRestoringScrollRef.current = true;
            isProgrammaticScrollRef.current = true;
            
            container.scrollLeft = Math.max(0, Math.round(newScrollLeft));
            container.scrollTop = Math.max(0, Math.round(newScrollTop));
            
            // Clear flags after a short delay to allow scroll to settle
            setTimeout(() => {
                isRestoringScrollRef.current = false;
                isProgrammaticScrollRef.current = false;
            }, 100);
            
            // Clear the anchor refs
            zoomAnchorRef.current = null;
            scrollStateBeforeZoomRef.current = null;
        }, []);

        // Update visible pages based on scroll position
        const updateVisiblePages = useCallback(() => {
            if (!document || !containerRef.current || !viewerRef.current) return;

            const container = containerRef.current;
            const containerRect = container.getBoundingClientRect();
            const newVisible = new Set<number>();
            let closestPage = 1;
            let closestDistance = Infinity;

            // Check each page element
            for (let i = 1; i <= document.numPages; i++) {
                const pageEl = viewerRef.current.querySelector(
                    `[data-page-number="${i}"]`
                ) as HTMLElement;
                if (!pageEl) continue;

                const pageRect = pageEl.getBoundingClientRect();

                // Check if page is in viewport (with some margin)
                const margin = 100;
                const isVisible =
                    pageRect.bottom > containerRect.top - margin &&
                    pageRect.top < containerRect.bottom + margin;

                if (isVisible) {
                    newVisible.add(i);

                    // Track closest to center
                    const pageCenter = pageRect.top + pageRect.height / 2;
                    const containerCenter = containerRect.top + containerRect.height / 2;
                    const distance = Math.abs(pageCenter - containerCenter);

                    if (distance < closestDistance) {
                        closestDistance = distance;
                        closestPage = i;
                    }
                }
            }

            // Update visible pages
            if (newVisible.size > 0) {
                setVisiblePages(newVisible);
            }

            // Update current page
            if (closestPage !== currentPage) {
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
        }, [document, currentPage, onPageChange, onLocationChange]);

        // Scroll handler - uses leading + trailing edge detection
        // Immediately updates on scroll start, then debounces subsequent updates
        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;

            let lastScrollTime = 0;
            const THROTTLE_MS = 100; // Minimum time between immediate updates

            const handleScroll = () => {
                // Skip scroll updates during programmatic scroll, zoom gesture/commit, or scroll restoration
                if (isProgrammaticScrollRef.current || isRestoringScrollRef.current || isZooming || isCommittingZoom) return;

                const now = performance.now();
                
                // Leading edge: update immediately if enough time has passed
                if (now - lastScrollTime > THROTTLE_MS) {
                    lastScrollTime = now;
                    updateVisiblePages();
                }

                // Clear existing trailing edge timeout
                if (scrollUpdateTimeoutRef.current) {
                    clearTimeout(scrollUpdateTimeoutRef.current);
                }

                // Trailing edge: update again when scrolling stops
                scrollUpdateTimeoutRef.current = window.setTimeout(() => {
                    updateVisiblePages();
                }, SCROLL_UPDATE_DELAY_MS);
            };

            container.addEventListener("scroll", handleScroll, { passive: true });
            return () => {
                container.removeEventListener("scroll", handleScroll);
                if (scrollUpdateTimeoutRef.current) {
                    clearTimeout(scrollUpdateTimeoutRef.current);
                }
            };
        }, [updateVisiblePages, isZooming, isCommittingZoom]);

        // ============================================
        // ZOOM IMPLEMENTATION - CSS-only during gesture
        // ============================================

        /**
         * Called when a page finishes rendering at the new scale.
         * When all visible pages have rendered, we can safely reset CSS zoom
         * and restore the scroll position to keep the same content visible.
         */
        const handlePageRenderComplete = useCallback((pageNumber: number) => {
            // Use ref to check state without dependency to prevent cascade
            if (pendingRenderCountRef.current <= 0) return;
            
            pendingRenderCountRef.current = Math.max(0, pendingRenderCountRef.current - 1);
            
            // When all pages have rendered, restore scroll and fade out CSS zoom
            if (pendingRenderCountRef.current <= 0) {
                // Restore scroll position first to prevent jarring jumps
                restoreScrollPositionAfterZoom();
                
                // Use requestAnimationFrame to ensure renders are painted before we reset CSS
                requestAnimationFrame(() => {
                    // Single atomic state update
                    setZoomState({ type: 'idle' });
                    // Clear zoom anchor origin now that zoom is complete
                    setZoomAnchorOrigin(null);
                });
            }
        }, [restoreScrollPositionAfterZoom]);



        /**
         * Commit the zoom - update base scale and trigger re-render
         * Only called after zoom gesture ends (300ms of no wheel events)
         * 
         * KEY FIX: We DON'T reset cssZoomFactor here. Instead, we:
         * 1. Set zoomState to 'committing' (starts rendering at new scale)
         * 2. Keep CSS zoom visible during render
         * 3. When pages report render complete, THEN reset zoomState to 'idle'
         */
        const commitZoom = useCallback(() => {
            const newScale = targetScaleRef.current;
            const currentBaseScale = baseScaleRef.current;
            const currentZoomFactor = newScale / currentBaseScale;
            
            // If scale didn't actually change, just reset
            if (Math.abs(newScale - currentBaseScale) < 0.001) {
                setZoomState({ type: 'idle' });
                pendingZoomCursorRef.current = null;
                return;
            }

            // Save scroll state with cursor anchor (from wheel events)
            // Falls back to viewport center if no cursor position stored
            saveScrollStateBeforeZoom(pendingZoomCursorRef.current || undefined);
            pendingZoomCursorRef.current = null;

            // Count how many visible pages need to render
            pendingRenderCountRef.current = pagesToRender.size;
            
            // Start the commit process - keep CSS zoom, allow renders to start
            setZoomState({ type: 'committing', factor: currentZoomFactor });

            // Update base scale (triggers re-render of visible pages)
            baseScaleRef.current = newScale;
            setBaseScale(newScale);
            isInternalChangeRef.current = true;
            onZoomChange?.(newScale);
            
            // Safety timeout: if renders take too long (> 2s), force reset
            if (safetyTimeoutRef.current) {
                clearTimeout(safetyTimeoutRef.current);
            }
            safetyTimeoutRef.current = window.setTimeout(() => {
                if (!mountedRef.current) return;
                if (pendingRenderCountRef.current > 0) {
                    setZoomState({ type: 'idle' });
                    pendingRenderCountRef.current = 0;
                    zoomAnchorRef.current = null;
                    scrollStateBeforeZoomRef.current = null;
                }
            }, 2000);
        }, [onZoomChange, pagesToRender.size, saveScrollStateBeforeZoom]);

        /**
         * Start or continue a zoom gesture with cursor-anchored scroll adjustment.
         * Uses CSS transform for immediate visual feedback, adjusts scroll in real-time
         * to keep the anchor point stationary, and debounces the actual re-render.
         * 
         * @param newScale - Target scale
         * @param cursorPosition - Optional cursor position for anchor (wheel zoom)
         */
        const zoomTo = useCallback(
            (newScale: number, cursorPosition?: { clientX: number; clientY: number }) => {
                const container = containerRef.current;
                if (!container) return;
                
                const safeScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
                const currentBaseScale = baseScaleRef.current;

                // Skip tiny changes
                if (Math.abs(safeScale - targetScaleRef.current) < 0.001) return;

                // Get anchor point in container coordinates
                const rect = container.getBoundingClientRect();
                let anchorContainerX = container.clientWidth / 2;
                let anchorContainerY = container.clientHeight / 2;
                
                if (cursorPosition) {
                    anchorContainerX = cursorPosition.clientX - rect.left;
                    anchorContainerY = cursorPosition.clientY - rect.top;
                    // Clamp to container bounds
                    anchorContainerX = Math.max(0, Math.min(anchorContainerX, container.clientWidth));
                    anchorContainerY = Math.max(0, Math.min(anchorContainerY, container.clientHeight));
                }
                
                // Calculate current and new visual scales
                const currentCssZoom = zoomState.type === 'idle' ? 1 : zoomState.factor;
                const currentVisualScale = currentBaseScale * currentCssZoom;
                const newCssZoomFactor = safeScale / currentBaseScale;
                const newVisualScale = currentBaseScale * newCssZoomFactor;
                
                // Get anchor position in current content coordinates
                const anchorContentX = container.scrollLeft + anchorContainerX;
                const anchorContentY = container.scrollTop + anchorContainerY;
                
                // Convert to PDF coordinates (scale-independent)
                const anchorPdfX = anchorContentX / currentVisualScale;
                const anchorPdfY = anchorContentY / currentVisualScale;
                
                // Calculate where this anchor point will be after CSS zoom change
                const anchorNewContentX = anchorPdfX * newVisualScale;
                const anchorNewContentY = anchorPdfY * newVisualScale;
                
                // Calculate new scroll position to keep anchor at same container position
                const newScrollLeft = anchorNewContentX - anchorContainerX;
                const newScrollTop = anchorNewContentY - anchorContainerY;
                
                // Update target scale and CSS zoom factor
                targetScaleRef.current = safeScale;
                setZoomState({ type: 'gesture', factor: newCssZoomFactor });
                
                // Set zoom anchor origin for transform-origin calculation
                // This tells each page where the zoom center should be
                setZoomAnchorOrigin({
                    contentX: anchorContentX,
                    contentY: anchorContentY,
                });
                
                // Apply scroll adjustment immediately to keep anchor stationary
                // Use requestAnimationFrame to ensure CSS transform is applied first
                requestAnimationFrame(() => {
                    if (!containerRef.current) return;
                    containerRef.current.scrollLeft = Math.max(0, Math.round(newScrollLeft));
                    containerRef.current.scrollTop = Math.max(0, Math.round(newScrollTop));
                });
                
                // Store cursor position for commit phase
                if (cursorPosition) {
                    pendingZoomCursorRef.current = cursorPosition;
                }

                // Clear existing timeout
                if (zoomCommitTimeoutRef.current) {
                    clearTimeout(zoomCommitTimeoutRef.current);
                }

                // Wait for gesture to end (300ms of no wheel events)
                zoomCommitTimeoutRef.current = window.setTimeout(() => {
                    if (!mountedRef.current) return;
                    commitZoom();
                }, ZOOM_COMMIT_DELAY_MS);
            },
            [commitZoom, zoomState]
        );

        /**
         * Immediate zoom (for preset buttons)
         * Uses viewport center as anchor since there's no cursor position
         */
        const setZoomImmediate = useCallback(
            (newScale: number) => {
                if (zoomCommitTimeoutRef.current) {
                    clearTimeout(zoomCommitTimeoutRef.current);
                }

                const safeScale = clamp(newScale, MIN_SCALE, MAX_SCALE);
                const currentBaseScale = baseScaleRef.current;

                // If scale didn't change, do nothing
                if (Math.abs(safeScale - currentBaseScale) < 0.001) return;

                // For button zoom, use viewport center as anchor (no cursor position)
                saveScrollStateBeforeZoom(undefined);

                targetScaleRef.current = safeScale;

                // Calculate CSS zoom factor to scale current content
                const zoomFactor = safeScale / currentBaseScale;

                // Count how many visible pages need to render
                pendingRenderCountRef.current = pagesToRender.size;

                // Start committing
                setZoomState({ type: 'committing', factor: zoomFactor });

                // Update base scale (triggers re-render of visible pages)
                baseScaleRef.current = safeScale;
                setBaseScale(safeScale);
                isInternalChangeRef.current = true;
                onZoomChange?.(safeScale);

                // Safety timeout: if renders take too long (> 2s), force reset
                if (safetyTimeoutRef.current) {
                    clearTimeout(safetyTimeoutRef.current);
                }
                safetyTimeoutRef.current = window.setTimeout(() => {
                    if (!mountedRef.current) return;
                    if (pendingRenderCountRef.current > 0) {
                        setZoomState({ type: 'idle' });
                        pendingRenderCountRef.current = 0;
                        zoomAnchorRef.current = null;
                        scrollStateBeforeZoomRef.current = null;
                    }
                }, 2000);
            },
            [onZoomChange, pagesToRender.size, saveScrollStateBeforeZoom]
        );

        // Expose methods via ref
        useImperativeHandle(
            ref,
            () => ({
                goTo: (location: string) => {
                    const page = parsePageFromLocation(location) || 1;
                    scrollToPage(clamp(page, 1, document?.numPages || 1));
                },
                goToPage: (pageNumber: number) => {
                    scrollToPage(clamp(pageNumber, 1, document?.numPages || 1));
                },
                goToFraction: (fraction: number) => {
                    const page = Math.max(
                        1,
                        Math.round(clamp(fraction, 0, 1) * (document?.numPages || 1))
                    );
                    scrollToPage(page);
                },
                getCurrentPage: () => currentPage,
                zoomIn: () => zoomTo(targetScaleRef.current + SCALE_STEP),
                zoomOut: () => zoomTo(targetScaleRef.current - SCALE_STEP),
                setZoom: (scale: number) => setZoomImmediate(scale),
                fitPage: () => {
                    if (!containerRef.current) return;
                    const containerHeight = containerRef.current.clientHeight - 40;
                    const dims = getPageDimensions(1);
                    if (dims) {
                        setZoomImmediate(clamp(containerHeight / dims.height, MIN_SCALE, MAX_SCALE));
                    }
                },
                fitWidth: () => {
                    if (!containerRef.current) return;
                    const containerWidth = containerRef.current.clientWidth - 40;
                    const dims = getPageDimensions(1);
                    if (dims) {
                        setZoomImmediate(clamp(containerWidth / dims.width, MIN_SCALE, MAX_SCALE));
                    }
                },
                rotate: () => {
                    rotationRef.current = (rotationRef.current + 90) % 360;
                    // Force re-render
                    setBaseScale((s) => s + 0.0001);
                    setTimeout(() => setBaseScale(baseScaleRef.current), 50);
                },
            }),
            [scrollToPage, document, currentPage, zoomTo, setZoomImmediate, getPageDimensions]
        );

        // ============================================
        // WHEEL ZOOM HANDLER
        // ============================================
        useEffect(() => {
            const handleWheel = (e: WheelEvent) => {
                if (!(e.ctrlKey || e.metaKey)) return;

                const container = containerRef.current;
                if (!container) return;

                // Check if mouse is over the PDF viewer using bounding rect
                const rect = container.getBoundingClientRect();
                const isOverContainer =
                    e.clientX >= rect.left &&
                    e.clientX <= rect.right &&
                    e.clientY >= rect.top &&
                    e.clientY <= rect.bottom;

                if (!isOverContainer) return;

                e.preventDefault();
                e.stopPropagation();

                // Pass cursor position to zoomTo for real-time anchor adjustment
                const cursorPosition = {
                    clientX: e.clientX,
                    clientY: e.clientY,
                };

                // Determine zoom direction and apply with cursor anchor
                const delta = e.deltaY > 0 ? -SCALE_STEP : SCALE_STEP;
                zoomTo(targetScaleRef.current + delta, cursorPosition);
            };

            window.addEventListener("wheel", handleWheel, { passive: false });
            return () => window.removeEventListener("wheel", handleWheel);
        }, [zoomTo]);

        // Callback when page dimensions are known
        const handleDimensionsKnown = useCallback(
            (pageNumber: number, width: number, height: number) => {
                // Store at scale=1 for consistent calculations
                pageDimensionsCache.current.set(pageNumber, {
                    width: width / baseScale,
                    height: height / baseScale,
                });
                // Update default if this is page 1
                if (pageNumber === 1) {
                    defaultPageDimensions.current = {
                        width: width / baseScale,
                        height: height / baseScale,
                    };
                }
            },
            [baseScale]
        );

        // Get dimensions for a page (cached or default)
        const getPageEstimatedDimensions = useCallback(
            (pageNumber: number) => {
                const cached = pageDimensionsCache.current.get(pageNumber);
                if (cached) {
                    return {
                        width: cached.width * baseScale,
                        height: cached.height * baseScale,
                    };
                }
                // Use page 1 dimensions as default, scaled by baseScale
                return {
                    width: defaultPageDimensions.current.width * baseScale,
                    height: defaultPageDimensions.current.height * baseScale,
                };
            },
            [baseScale]
        );

        // ============================================
        // RENDER
        // ============================================

        if (isLoading) {
            return (
                <div
                    className={cn("flex flex-col items-center justify-center h-full", className)}
                    style={{ backgroundColor: "var(--reader-bg)" }}
                >
                    <div className="space-y-4 w-64">
                        <div
                            className="h-2 rounded-full overflow-hidden"
                            style={{ backgroundColor: "var(--color-border)" }}
                        >
                            <div
                                className="h-full transition-all duration-300"
                                style={{
                                    width: loadProgress?.total
                                        ? `${clamp((loadProgress.loaded / loadProgress.total) * 100, 0, 100)}%`
                                        : "0%",
                                    backgroundColor: "var(--color-accent)",
                                }}
                            />
                        </div>
                        <p
                            className="text-center text-sm"
                            style={{ color: "var(--reader-fg)", opacity: 0.6 }}
                        >
                            Loading PDF...{" "}
                            {loadProgress?.total
                                ? `${Math.round((loadProgress.loaded / loadProgress.total) * 100)}%`
                                : ""}
                        </p>
                    </div>
                </div>
            );
        }

        if (error) {
            return (
                <div
                    className={cn("flex items-center justify-center h-full", className)}
                    style={{ backgroundColor: "var(--reader-bg)" }}
                >
                    <div className="text-center">
                        <p style={{ color: "var(--color-error)" }} className="mb-2">
                            Failed to load PDF
                        </p>
                        <p className="text-sm" style={{ color: "var(--reader-fg)", opacity: 0.6 }}>
                            {error.message}
                        </p>
                    </div>
                </div>
            );
        }

        if (!document) {
            return (
                <div
                    className={cn("flex items-center justify-center h-full", className)}
                    style={{ backgroundColor: "var(--reader-bg)" }}
                >
                    <p style={{ color: "var(--reader-fg)", opacity: 0.6 }}>No PDF loaded</p>
                </div>
            );
        }

        // Generate page list with virtualization
        const pageElements: React.ReactNode[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
            const dims = getPageEstimatedDimensions(pageNumber);

            if (pagesToRender.has(pageNumber)) {
                // Render actual page
                pageElements.push(
                    <PDFPage
                        key={pageNumber}
                        pageNumber={pageNumber}
                        baseScale={baseScale}
                        cssZoomFactor={cssZoomFactor}
                        rotation={rotationRef.current}
                        document={document}
                        isZooming={isZooming}
                        isCommittingZoom={isCommittingZoom}
                        renderPage={renderPage}
                        getTextContent={getTextContent}
                        cancelRender={cancelRender}
                        onDimensionsKnown={handleDimensionsKnown}
                        onRenderComplete={handlePageRenderComplete}
                    />
                );
            } else {
                // Render placeholder to maintain scroll position
                pageElements.push(
                    <PagePlaceholder
                        key={pageNumber}
                        pageNumber={pageNumber}
                        width={dims.width}
                        height={dims.height}
                    />
                );
            }
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
                    {pageElements}
                </div>
            </div>
        );
    }
);

PDFViewer.displayName = "PDFViewer";

export default PDFViewer;
