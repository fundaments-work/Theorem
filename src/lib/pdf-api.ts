/**
 * PDF API Layer
 * TypeScript interface for PDF operations via Tauri backend
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * PDF document information returned from the backend
 */
export interface PdfInfo {
    id: string;
    pageCount: number;
    metadata: {
        title?: string;
        author?: string;
        subject?: string;
    };
}

/**
 * Options for rendering a PDF page
 */
export interface RenderOptions {
    page: number;
    scale?: number;
    maxWidth?: number;
}

/**
 * Extract error message from Tauri invoke error
 * Rust errors are serialized as objects like { "BindError": "message" }
 */
function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    if (typeof error === "object" && error !== null) {
        // Handle Rust enum serialization: { "ErrorVariant": "message" }
        const values = Object.values(error);
        if (values.length > 0 && typeof values[0] === "string") {
            return values[0];
        }
        // Try JSON stringifying for complex objects
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }
    return String(error);
}

/**
 * PDF API functions using Tauri invoke
 * Communicates with Rust backend for PDF processing
 */
export const pdfApi = {
    /**
     * Load a PDF document from bytes
     * @param id - Unique identifier for the document
     * @param bytes - Raw PDF bytes as Uint8Array
     * @returns Promise resolving to PdfInfo
     */
    loadDocument: async (id: string, bytes: Uint8Array): Promise<PdfInfo> => {
        try {
            // Convert Uint8Array to number array for Tauri IPC
            const bytesArray = Array.from(bytes);
            console.log("[pdfApi] Loading document, id:", id, "bytes:", bytes.length);
            const result = await invoke<PdfInfo>("pdf_load", {
                id,
                bytes: bytesArray,
            });
            console.log("[pdfApi] Document loaded successfully:", result);
            return result;
        } catch (error) {
            const message = extractErrorMessage(error);
            console.error("[pdfApi] Failed to load document:", message);
            throw new Error(`Failed to load PDF document: ${message}`);
        }
    },

    /**
     * Render a specific page as base64 encoded image
     * @param id - Document identifier
     * @param page - Page number (1-indexed)
     * @param scale - Optional scale factor (default: 1.0)
     * @returns Promise resolving to base64 encoded image string
     */
    renderPage: async (
        id: string,
        page: number,
        scale?: number
    ): Promise<string> => {
        try {
            const result = await invoke<string>("pdf_render_page", {
                id,
                page,
                scale: scale ?? 1.0,
            });
            return result;
        } catch (error) {
            const message = extractErrorMessage(error);
            console.error("[pdfApi] Failed to render page:", message);
            throw new Error(`Failed to render page ${page}: ${message}`);
        }
    },

    /**
     * Get document information
     * @param id - Document identifier
     * @returns Promise resolving to PdfInfo
     */
    getInfo: async (id: string): Promise<PdfInfo> => {
        try {
            const result = await invoke<PdfInfo>("pdf_get_info", { id });
            return result;
        } catch (error) {
            const message = extractErrorMessage(error);
            console.error("[pdfApi] Failed to get document info:", message);
            throw new Error(`Failed to get PDF info: ${message}`);
        }
    },

    /**
     * Close and cleanup a PDF document
     * @param id - Document identifier
     */
    close: async (id: string): Promise<void> => {
        try {
            await invoke("pdf_close", { id });
        } catch (error) {
            const message = extractErrorMessage(error);
            console.error("[pdfApi] Failed to close document:", message);
            throw new Error(`Failed to close PDF: ${message}`);
        }
    },
};

/**
 * Page cache entry
 */
interface CacheEntry {
    base64: string;
    scale: number;
    timestamp: number;
}

/**
 * Hook return type
 */
export interface UsePDFReturn {
    /** Whether a document is currently loading */
    isLoading: boolean;
    /** Current error state */
    error: Error | null;
    /** PDF document information */
    info: PdfInfo | null;
    /** Currently rendered page as base64 */
    currentPageImage: string | null;
    /** Current page number (1-indexed) */
    currentPage: number;
    /** Render a specific page */
    renderPage: (page: number, scale?: number) => Promise<void>;
    /** Navigate to next page */
    nextPage: () => void;
    /** Navigate to previous page */
    prevPage: () => void;
    /** Go to a specific page */
    goToPage: (page: number) => void;
    /** Check if can go to next page */
    canGoNext: boolean;
    /** Check if can go to previous page */
    canGoPrev: boolean;
    /** Clear the page cache */
    clearCache: () => void;
    /** Load a PDF document */
    loadDocument: (id: string, bytes: Uint8Array) => Promise<void>;
    /** Close the current document */
    close: () => Promise<void>;
}

/**
 * Maximum number of cached pages
 */
const MAX_CACHE_SIZE = 10;

/**
 * React hook for managing PDF document state and operations
 * Handles document loading, page rendering, caching, and cleanup
 *
 * @param id - Optional initial document ID
 * @returns UsePDFReturn object with state and methods
 *
 * @example
 * ```typescript
 * const {
 *   isLoading,
 *   info,
 *   currentPageImage,
 *   renderPage,
 *   nextPage,
 *   prevPage
 * } = usePDF();
 *
 * // Load a document
 * await loadDocument('doc-1', pdfBytes);
 *
 * // Render page 1
 * await renderPage(1, 1.5);
 * ```
 */
export function usePDF(id?: string): UsePDFReturn {
    // State
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [info, setInfo] = useState<PdfInfo | null>(null);
    const [currentPageImage, setCurrentPageImage] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);

    // Refs for mutable state that shouldn't trigger re-renders
    const documentIdRef = useRef<string | null>(id ?? null);
    const pageCacheRef = useRef<Map<number, CacheEntry>>(new Map());
    const mountedRef = useRef(true);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Track mounted state
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Cleanup document if loaded
            const docId = documentIdRef.current;
            if (docId) {
                pdfApi
                    .close(docId)
                    .catch((err) => console.error("[usePDF] Cleanup error:", err));
            }
            // Clear cache
            pageCacheRef.current.clear();
            // Abort any pending operations
            abortControllerRef.current?.abort();
        };
    }, []);

    /**
     * Clear the page cache
     */
    const clearCache = useCallback(() => {
        pageCacheRef.current.clear();
    }, []);

    /**
     * Manage cache size - remove oldest entries if over limit
     */
    const manageCacheSize = useCallback(() => {
        const cache = pageCacheRef.current;
        if (cache.size > MAX_CACHE_SIZE) {
            // Sort by timestamp and remove oldest
            const entries = Array.from(cache.entries()).sort(
                (a, b) => a[1].timestamp - b[1].timestamp
            );
            const toRemove = entries.slice(0, entries.length - MAX_CACHE_SIZE);
            toRemove.forEach(([page]) => cache.delete(page));
        }
    }, []);

    /**
     * Load a PDF document
     */
    const loadDocument = useCallback(
        async (docId: string, bytes: Uint8Array) => {
            // Abort any previous operation
            abortControllerRef.current?.abort();
            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            setIsLoading(true);
            setError(null);

            try {
                // Close previous document if any
                const prevId = documentIdRef.current;
                if (prevId && prevId !== docId) {
                    await pdfApi.close(prevId);
                }

                // Clear cache when loading new document
                pageCacheRef.current.clear();

                // Load new document
                const pdfInfo = await pdfApi.loadDocument(docId, bytes);

                if (!abortController.signal.aborted && mountedRef.current) {
                    documentIdRef.current = docId;
                    setInfo(pdfInfo);
                    setCurrentPage(1);
                    setCurrentPageImage(null);
                }
            } catch (err) {
                if (!abortController.signal.aborted && mountedRef.current) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                }
            } finally {
                if (!abortController.signal.aborted && mountedRef.current) {
                    setIsLoading(false);
                }
            }
        },
        []
    );

    /**
     * Render a specific page
     */
    const renderPage = useCallback(
        async (page: number, scale?: number) => {
            const docId = documentIdRef.current;
            if (!docId) {
                setError(new Error("No document loaded"));
                return;
            }

            // Validate page number
            const pageCount = info?.pageCount ?? 0;
            if (page < 1 || page > pageCount) {
                setError(new Error(`Invalid page number: ${page}`));
                return;
            }

            const effectiveScale = scale ?? 1.0;
            const cache = pageCacheRef.current;

            // Check cache first
            const cached = cache.get(page);
            if (cached && cached.scale === effectiveScale) {
                // Update timestamp for LRU
                cached.timestamp = Date.now();
                setCurrentPage(page);
                setCurrentPageImage(cached.base64);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const base64 = await pdfApi.renderPage(docId, page, effectiveScale);

                if (mountedRef.current) {
                    // Cache the result
                    cache.set(page, {
                        base64,
                        scale: effectiveScale,
                        timestamp: Date.now(),
                    });
                    manageCacheSize();

                    setCurrentPage(page);
                    setCurrentPageImage(base64);
                }
            } catch (err) {
                if (mountedRef.current) {
                    setError(err instanceof Error ? err : new Error(String(err)));
                }
            } finally {
                if (mountedRef.current) {
                    setIsLoading(false);
                }
            }
        },
        [info?.pageCount, manageCacheSize]
    );

    /**
     * Navigate to next page
     */
    const nextPage = useCallback(() => {
        const pageCount = info?.pageCount ?? 0;
        if (currentPage < pageCount) {
            renderPage(currentPage + 1);
        }
    }, [currentPage, info?.pageCount, renderPage]);

    /**
     * Navigate to previous page
     */
    const prevPage = useCallback(() => {
        if (currentPage > 1) {
            renderPage(currentPage - 1);
        }
    }, [currentPage, renderPage]);

    /**
     * Go to a specific page
     */
    const goToPage = useCallback(
        (page: number) => {
            const pageCount = info?.pageCount ?? 0;
            const clampedPage = Math.max(1, Math.min(page, pageCount));
            if (clampedPage !== currentPage) {
                renderPage(clampedPage);
            }
        },
        [currentPage, info?.pageCount, renderPage]
    );

    /**
     * Close the current document
     */
    const close = useCallback(async () => {
        const docId = documentIdRef.current;
        if (docId) {
            try {
                await pdfApi.close(docId);
            } catch (err) {
                console.error("[usePDF] Close error:", err);
            }
        }

        documentIdRef.current = null;
        pageCacheRef.current.clear();
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;

        setInfo(null);
        setCurrentPage(1);
        setCurrentPageImage(null);
        setError(null);
        setIsLoading(false);
    }, []);

    // Computed values
    const canGoNext = currentPage < (info?.pageCount ?? 0);
    const canGoPrev = currentPage > 1;

    return {
        isLoading,
        error,
        info,
        currentPageImage,
        currentPage,
        renderPage,
        nextPage,
        prevPage,
        goToPage,
        canGoNext,
        canGoPrev,
        clearCache,
        loadDocument,
        close,
    };
}

export default usePDF;
