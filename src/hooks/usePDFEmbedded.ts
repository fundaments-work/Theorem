/**
 * usePDFEmbedded - React hook to control embedded PDF.js viewer via postMessage API
 *
 * This hook provides programmatic control over a PDF.js viewer embedded in an iframe,
 * allowing navigation, zoom, and state tracking through the postMessage API.
 */

import { useState, useEffect, useCallback, useRef } from "react";

// Scale constants matching PDF.js behavior
const DEFAULT_SCALE_DELTA = 1.1;
const MIN_SCALE = 0.25;
const MAX_SCALE = 10.0;

export interface UsePDFEmbeddedOptions {
    /** Ref to the iframe element containing the PDF.js viewer */
    iframeRef: React.RefObject<HTMLIFrameElement | null>;
    /** Callback when page changes */
    onPageChange?: (page: number, totalPages: number) => void;
    /** Callback when zoom level changes */
    onZoomChange?: (scale: number) => void;
    /** Callback when document is loaded */
    onDocumentLoad?: (numPages: number) => void;
    /** Callback when an error occurs */
    onError?: (error: string) => void;
}

export interface UsePDFEmbeddedReturn {
    // Navigation
    /** Navigate to a specific page */
    goToPage: (page: number) => void;
    /** Navigate to next page */
    nextPage: () => void;
    /** Navigate to previous page */
    prevPage: () => void;

    // Zoom
    /** Zoom in by DEFAULT_SCALE_DELTA factor */
    zoomIn: () => void;
    /** Zoom out by DEFAULT_SCALE_DELTA factor */
    zoomOut: () => void;
    /** Set zoom to a specific scale */
    setZoom: (scale: number) => void;
    /** Fit page width to viewport */
    fitWidth: () => void;
    /** Fit entire page in viewport */
    fitPage: () => void;

    // State
    /** Current page number (1-indexed) */
    currentPage: number;
    /** Total number of pages in the document */
    totalPages: number;
    /** Current zoom scale */
    scale: number;
    /** Whether the viewer is ready/loaded */
    isReady: boolean;
}

/**
 * Send a postMessage to the embedded PDF.js viewer
 */
function postMessageToViewer(
    iframeRef: React.RefObject<HTMLIFrameElement | null>,
    message: { type: string; [key: string]: unknown }
): void {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    // Use '*' for origin - in production, consider restricting this
    iframe.contentWindow.postMessage(message, "*");
}

/**
 * Hook to control an embedded PDF.js viewer via postMessage API
 */
export function usePDFEmbedded(options: UsePDFEmbeddedOptions): UsePDFEmbeddedReturn {
    const { iframeRef, onPageChange, onZoomChange, onDocumentLoad, onError } = options;

    // State
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [scale, setScale] = useState(1.0);
    const [isReady, setIsReady] = useState(false);

    // Use refs to store callbacks to avoid dependency issues
    const callbacksRef = useRef({
        onPageChange,
        onZoomChange,
        onDocumentLoad,
        onError,
    });

    // Update callbacks ref when they change
    useEffect(() => {
        callbacksRef.current = {
            onPageChange,
            onZoomChange,
            onDocumentLoad,
            onError,
        };
    }, [onPageChange, onZoomChange, onDocumentLoad, onError]);

    // Listen for messages from the embedded viewer
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Verify message is from our iframe
            if (event.source !== iframeRef.current?.contentWindow) return;

            const { type, data } = event.data as {
                type: string;
                data?: Record<string, unknown>;
            };

            switch (type) {
                case "documentload": {
                    const numPages = (data?.numPages as number) || 0;
                    setTotalPages(numPages);
                    setCurrentPage(1);
                    setIsReady(true);
                    callbacksRef.current.onDocumentLoad?.(numPages);
                    break;
                }

                case "pagechange": {
                    const page = (data?.page as number) || 1;
                    setCurrentPage(page);
                    callbacksRef.current.onPageChange?.(page, totalPages);
                    break;
                }

                case "zoomchange": {
                    const newScale = (data?.zoom as number) || 1.0;
                    setScale(newScale);
                    callbacksRef.current.onZoomChange?.(newScale);
                    break;
                }

                case "error": {
                    const message = (data?.message as string) || "Unknown error";
                    callbacksRef.current.onError?.(message);
                    break;
                }

                default:
                    // Unknown message type - ignore
                    break;
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [iframeRef, totalPages]);

    // Reset state when iframe changes
    useEffect(() => {
        setIsReady(false);
        setCurrentPage(1);
        setTotalPages(0);
        setScale(1.0);
    }, [iframeRef.current?.src]);

    // Navigation functions
    const goToPage = useCallback(
        (page: number) => {
            if (!isReady || page < 1 || page > totalPages) return;

            postMessageToViewer(iframeRef, {
                type: "pageChange",
                page,
            });
        },
        [iframeRef, isReady, totalPages]
    );

    const nextPage = useCallback(() => {
        if (!isReady || currentPage >= totalPages) return;

        postMessageToViewer(iframeRef, {
            type: "pageChange",
            page: currentPage + 1,
        });
    }, [iframeRef, isReady, currentPage, totalPages]);

    const prevPage = useCallback(() => {
        if (!isReady || currentPage <= 1) return;

        postMessageToViewer(iframeRef, {
            type: "pageChange",
            page: currentPage - 1,
        });
    }, [iframeRef, isReady, currentPage]);

    // Zoom functions
    const zoomIn = useCallback(() => {
        if (!isReady) return;

        const newScale = Math.min(scale * DEFAULT_SCALE_DELTA, MAX_SCALE);
        postMessageToViewer(iframeRef, {
            type: "zoomChange",
            zoom: newScale,
        });
    }, [iframeRef, isReady, scale]);

    const zoomOut = useCallback(() => {
        if (!isReady) return;

        const newScale = Math.max(scale / DEFAULT_SCALE_DELTA, MIN_SCALE);
        postMessageToViewer(iframeRef, {
            type: "zoomChange",
            zoom: newScale,
        });
    }, [iframeRef, isReady, scale]);

    const setZoom = useCallback(
        (newScale: number) => {
            if (!isReady) return;

            const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
            postMessageToViewer(iframeRef, {
                type: "zoomChange",
                zoom: clampedScale,
            });
        },
        [iframeRef, isReady]
    );

    const fitWidth = useCallback(() => {
        if (!isReady) return;

        postMessageToViewer(iframeRef, {
            type: "zoomChange",
            zoom: "page-width",
        });
    }, [iframeRef, isReady]);

    const fitPage = useCallback(() => {
        if (!isReady) return;

        postMessageToViewer(iframeRef, {
            type: "zoomChange",
            zoom: "page-fit",
        });
    }, [iframeRef, isReady]);

    return {
        // Navigation
        goToPage,
        nextPage,
        prevPage,

        // Zoom
        zoomIn,
        zoomOut,
        setZoom,
        fitWidth,
        fitPage,

        // State
        currentPage,
        totalPages,
        scale,
        isReady,
    };
}

export default usePDFEmbedded;
