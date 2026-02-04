/**
 * PDF.js Engine Component
 *
 * A React component that renders PDF documents using PDF.js Components API.
 * Features text selection, annotations, links, zoom, navigation, and search.
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

// Import PDF.js official CSS
import "pdfjs-dist/web/pdf_viewer.css";
import "./pdfjs-engine.css";

// Dynamic imports for PDF.js to avoid SSR issues
let pdfjsLib: typeof import("pdfjs-dist") | null = null;
let pdfjsViewer: typeof import("pdfjs-dist/web/pdf_viewer.mjs") | null = null;

async function initPdfJs() {
    if (pdfjsLib && pdfjsViewer) {
        return { pdfjsLib, pdfjsViewer };
    }
    
    const [lib, viewer] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/web/pdf_viewer.mjs"),
    ]);
    
    pdfjsLib = lib;
    pdfjsViewer = viewer;
    
    // Set worker
    const workerUrl = new URL(
        "pdfjs-dist/build/pdf.worker.mjs",
        import.meta.url
    ).href;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    
    return { pdfjsLib, pdfjsViewer };
}

// Types
export interface PDFJsEngineProps {
    pdfPath: string;
    pdfData?: Uint8Array;
    initialPage?: number;
    onLoad?: (info: PDFDocumentInfo) => void;
    onError?: (error: Error) => void;
    onPageChange?: (page: number, totalPages: number) => void;
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
    find: (query: string, options?: Partial<PDFSearchState>) => void;
    findNext: () => void;
    findPrevious: () => void;
    clearSearch: () => void;
    rotateClockwise: () => void;
    rotateCounterClockwise: () => void;
}

// Constants
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.25;

// Text and annotation layer modes
const TEXT_LAYER_MODE = {
    DISABLE: 0,
    ENABLE: 1,
    ENABLE_PERMISSIONS: 2,
} as const;

const ANNOTATION_MODE = {
    DISABLE: 0,
    ENABLE: 1,
    ENABLE_FORMS: 2,
    ENABLE_STORAGE: 3,
} as const;

/**
 * PDF.js Engine Component
 */
export const PDFJsEngine = forwardRef<PDFJsEngineRef, PDFJsEngineProps>(
    function PDFJsEngine({ pdfPath, pdfData, initialPage = 1, onLoad, onError, onPageChange, className }, ref) {
        const containerRef = useRef<HTMLDivElement>(null);
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [pdfInfo, setPdfInfo] = useState<PDFDocumentInfo | null>(null);
        const [currentPage, setCurrentPage] = useState(initialPage);
        const [totalPages, setTotalPages] = useState(0);
        const [scale, setScale] = useState(1);
        const [rotation, setRotation] = useState(0);
        
        // Use refs for callbacks to avoid re-triggering the load effect
        const callbacksRef = useRef({ onLoad, onError, onPageChange });
        useEffect(() => {
            callbacksRef.current = { onLoad, onError, onPageChange };
        }, [onLoad, onError, onPageChange]);
        
        // PDF.js instances
        const pdfDocRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
        const eventBusRef = useRef<InstanceType<typeof import("pdfjs-dist/web/pdf_viewer.mjs").EventBus> | null>(null);
        const linkServiceRef = useRef<InstanceType<typeof import("pdfjs-dist/web/pdf_viewer.mjs").PDFLinkService> | null>(null);
        const findControllerRef = useRef<InstanceType<typeof import("pdfjs-dist/web/pdf_viewer.mjs").PDFFindController> | null>(null);
        const pdfViewerRef = useRef<InstanceType<typeof import("pdfjs-dist/web/pdf_viewer.mjs").PDFViewer> | null>(null);

        // Load PDF
        useEffect(() => {
            let cancelled = false;
            
            const loadPdf = async () => {
                try {
                    setIsLoading(true);
                    setError(null);
                    
                    // Initialize PDF.js
                    const { pdfjsLib, pdfjsViewer } = await initPdfJs();
                    if (cancelled) return;
                    
                    // Get PDF data
                    let data: Uint8Array;
                    if (pdfData) {
                        data = pdfData;
                    } else if (isTauri()) {
                        // Read via Tauri
                        data = await invoke<Uint8Array>("read_pdf_file", { path: pdfPath });
                    } else {
                        throw new Error("No PDF data provided and not running in Tauri");
                    }
                    
                    if (cancelled) return;
                    
                    // Load document
                    const loadingTask = pdfjsLib.getDocument({ data });
                    const pdfDocument = await loadingTask.promise;
                    
                    if (cancelled) {
                        pdfDocument.destroy();
                        return;
                    }
                    
                    pdfDocRef.current = pdfDocument;
                    
                    // Get metadata
                    const metadata = await pdfDocument.getMetadata();
                    const metaInfo = metadata.info as Record<string, unknown>;
                    const info: PDFDocumentInfo = {
                        title: (metaInfo?.Title as string) || pdfPath.split("/").pop()?.replace(".pdf", ""),
                        author: metaInfo?.Author as string | undefined,
                        subject: metaInfo?.Subject as string | undefined,
                        keywords: metaInfo?.Keywords as string | undefined,
                        creator: metaInfo?.Creator as string | undefined,
                        producer: metaInfo?.Producer as string | undefined,
                        creationDate: metaInfo?.CreationDate ? new Date(metaInfo.CreationDate as string) : undefined,
                        modificationDate: metaInfo?.ModDate ? new Date(metaInfo.ModDate as string) : undefined,
                        totalPages: pdfDocument.numPages,
                        filename: pdfPath.split("/").pop() || "document.pdf",
                    };
                    
                    setPdfInfo(info);
                    setTotalPages(info.totalPages);
                    
                    // Setup viewer components
                    if (!containerRef.current) return;
                    
                    // Create EventBus
                    const eventBus = new pdfjsViewer.EventBus();
                    eventBusRef.current = eventBus;
                    
                    // Create LinkService
                    const linkService = new pdfjsViewer.PDFLinkService({ eventBus });
                    linkServiceRef.current = linkService;
                    
                    // Create FindController
                    const findController = new pdfjsViewer.PDFFindController({
                        eventBus,
                        linkService,
                    });
                    findControllerRef.current = findController;
                    
                    // Create PDFViewer with performance optimizations
                    const pdfViewer = new pdfjsViewer.PDFViewer({
                        container: containerRef.current,
                        eventBus,
                        linkService,
                        findController,
                        textLayerMode: TEXT_LAYER_MODE.ENABLE,
                        annotationMode: ANNOTATION_MODE.ENABLE_FORMS,
                        removePageBorders: false,
                        // Performance optimizations
                        maxCanvasPixels: 4096 * 8192, // Limit canvas size (32MP)
                        enableHWA: true, // Enable hardware acceleration
                    });
                    pdfViewerRef.current = pdfViewer;
                    
                    // Set document
                    pdfViewer.setDocument(pdfDocument);
                    linkService.setDocument(pdfDocument);
                    findController.setDocument(pdfDocument);
                    
                    // Event listeners
                    eventBus.on("pagesinit", () => {
                        // Defer scale setting to ensure container is ready
                        requestAnimationFrame(() => {
                            if (!cancelled && pdfViewerRef.current) {
                                try {
                                    pdfViewer.currentScaleValue = "page-width";
                                } catch (e) {
                                    // Ignore scroll errors during initialization
                                    console.warn("[PDFJsEngine] Could not set initial scale:", e);
                                }
                            }
                        });
                    });
                    
                    eventBus.on("pagechanging", (evt: { pageNumber: number }) => {
                        setCurrentPage(evt.pageNumber);
                        callbacksRef.current.onPageChange?.(evt.pageNumber, info.totalPages);
                    });
                    
                    // Navigate to initial page (after a delay to ensure DOM is ready)
                    if (initialPage > 1 && initialPage <= info.totalPages) {
                        setTimeout(() => {
                            if (!cancelled && pdfViewerRef.current) {
                                try {
                                    pdfViewer.currentPageNumber = initialPage;
                                } catch (e) {
                                    console.warn("[PDFJsEngine] Could not navigate to initial page:", e);
                                }
                            }
                        }, 100);
                    }
                    
                    setIsLoading(false);
                    callbacksRef.current.onLoad?.(info);
                    
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
                try {
                    pdfViewerRef.current?.setDocument(null as unknown as import("pdfjs-dist").PDFDocumentProxy);
                    linkServiceRef.current?.setDocument(null as unknown as import("pdfjs-dist").PDFDocumentProxy, null);
                    findControllerRef.current?.setDocument(null as unknown as import("pdfjs-dist").PDFDocumentProxy);
                } catch {
                    // Ignore cleanup errors
                }
                pdfDocRef.current?.destroy();
                pdfViewerRef.current = null;
                linkServiceRef.current = null;
                findControllerRef.current = null;
                eventBusRef.current = null;
                pdfDocRef.current = null;
            };
        // Only reload when pdfPath, pdfData, or initialPage changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [pdfPath, pdfData, initialPage]);

        // Expose imperative methods
        useImperativeHandle(ref, () => ({
            goToPage: (page: number) => {
                if (pdfViewerRef.current && page >= 1 && page <= totalPages) {
                    pdfViewerRef.current.currentPageNumber = page;
                }
            },
            nextPage: () => {
                if (pdfViewerRef.current && currentPage < totalPages) {
                    pdfViewerRef.current.currentPageNumber = currentPage + 1;
                }
            },
            prevPage: () => {
                if (pdfViewerRef.current && currentPage > 1) {
                    pdfViewerRef.current.currentPageNumber = currentPage - 1;
                }
            },
            zoomIn: () => {
                if (pdfViewerRef.current) {
                    const newScale = Math.min(scale + ZOOM_STEP, MAX_ZOOM);
                    pdfViewerRef.current.currentScale = newScale;
                    setScale(newScale);
                }
            },
            zoomOut: () => {
                if (pdfViewerRef.current) {
                    const newScale = Math.max(scale - ZOOM_STEP, MIN_ZOOM);
                    pdfViewerRef.current.currentScale = newScale;
                    setScale(newScale);
                }
            },
            zoomReset: () => {
                if (pdfViewerRef.current) {
                    pdfViewerRef.current.currentScale = 1;
                    setScale(1);
                }
            },
            setZoom: (newScale: number) => {
                if (pdfViewerRef.current) {
                    const clampedScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newScale));
                    pdfViewerRef.current.currentScale = clampedScale;
                    setScale(clampedScale);
                }
            },
            getZoom: () => scale,
            getCurrentPage: () => currentPage,
            getTotalPages: () => totalPages,
            find: (query: string, options?: Partial<PDFSearchState>) => {
                if (eventBusRef.current) {
                    eventBusRef.current.dispatch("find", {
                        type: "",
                        query,
                        caseSensitive: options?.caseSensitive ?? false,
                        entireWord: options?.entireWord ?? false,
                        highlightAll: options?.highlightAll ?? true,
                        findPrevious: false,
                    });
                }
            },
            findNext: () => {
                if (eventBusRef.current) {
                    eventBusRef.current.dispatch("findagain", {
                        type: "",
                        findPrevious: false,
                    });
                }
            },
            findPrevious: () => {
                if (eventBusRef.current) {
                    eventBusRef.current.dispatch("findagain", {
                        type: "",
                        findPrevious: true,
                    });
                }
            },
            clearSearch: () => {
                if (eventBusRef.current) {
                    eventBusRef.current.dispatch("find", {
                        type: "",
                        query: "",
                    });
                }
            },
            rotateClockwise: () => {
                if (pdfViewerRef.current) {
                    const newRotation = (rotation + 90) % 360;
                    pdfViewerRef.current.pagesRotation = newRotation;
                    setRotation(newRotation);
                }
            },
            rotateCounterClockwise: () => {
                if (pdfViewerRef.current) {
                    const newRotation = (rotation - 90 + 360) % 360;
                    pdfViewerRef.current.pagesRotation = newRotation;
                    setRotation(newRotation);
                }
            },
        }), [currentPage, totalPages, scale, rotation]);

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
                
                {/* PDF Viewer Container - must be absolutely positioned for PDF.js */}
                <div
                    ref={containerRef}
                    className="absolute inset-0 overflow-auto"
                    style={{
                        backgroundColor: "var(--color-surface)",
                        opacity: isLoading || error ? 0 : 1,
                        pointerEvents: isLoading || error ? "none" : "auto",
                    }}
                >
                    <div className="pdfViewer" />
                </div>
                
                {/* Page Info Overlay */}
                {!isLoading && !error && totalPages > 0 && (
                    <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] shadow-sm">
                        Page {currentPage} of {totalPages}
                    </div>
                )}
            </div>
        );
    }
);

export default PDFJsEngine;
