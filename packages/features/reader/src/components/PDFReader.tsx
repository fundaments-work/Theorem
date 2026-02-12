/**
 * PDFReader Component
 *
 * A streamlined PDF reader that renders PDFs without its own toolbar.
 * Controls are expected to be provided by the parent component (WindowTitlebar).
 *
 * @module components/reader/PDFReader
 */

import {
    useRef,
    useState,
    useEffect,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { PDFJsEngine, type PDFJsEngineRef, type PDFDocumentInfo } from "@/engines/pdfjs-engine";
import { cn } from "@lionreader/core";
import type { ReaderTheme, Annotation, HighlightColor, PdfZoomMode } from "@lionreader/core";

// ============================================================================
// Types
// ============================================================================

interface PDFReaderProps {
    /** Absolute path to the PDF file */
    pdfPath: string;
    /** Optional PDF data as Uint8Array (takes precedence over pdfPath) */
    pdfData?: Uint8Array;
    /** Original filename for display fallback (without extension) */
    originalFilename?: string;
    /** Initial page to open */
    initialPage?: number;
    /** Initial zoom level */
    initialZoom?: number;
    /** Initial zoom mode */
    initialZoomMode?: PdfZoomMode;
    /** Theme mode for the reader */
    theme?: ReaderTheme;
    /** Callback when page changes - provides page state for external controls */
    onPageChange?: (page: number, totalPages: number, scale: number) => void;
    /** Callback when PDF is loaded */
    /** Callback when PDF is loaded */
    onLoad?: (info: PDFDocumentInfo) => void;
    /** Callback when an error occurs */
    onError?: (error: Error) => void;
    /** Callback when the user taps the reading viewport */
    onViewportTap?: () => void;
    // Annotations
    annotations?: Annotation[];
    annotationMode?: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
    highlightColor?: HighlightColor;
    penColor?: HighlightColor;
    penWidth?: number;
    onAnnotationAdd?: (annotation: Partial<Annotation>) => void;
    onAnnotationChange?: (annotation: Annotation) => void;
    onAnnotationRemove?: (id: string) => void;
    onZoomModeChange?: (mode: PdfZoomMode) => void;
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
                    <Loader2 className="w-10 h-10 animate-spin text-[color:var(--color-accent)]" />
                </div>
                <span className="text-sm text-[color:var(--color-text-secondary)]">{message}</span>
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
    const displayError = error.replace(/\s+/g, " ").trim();

    return (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface)] z-20">
            <div className="ui-empty-state-stack flex flex-col items-center gap-4 text-center p-8">
                <div
                    className="w-16 h-16 rounded-full flex items-center justify-center"
                    style={{
                        backgroundColor: "color-mix(in srgb, var(--color-error) 14%, var(--color-surface))",
                    }}
                >
                    <AlertCircle
                        className="w-8 h-8"
                        style={{ color: "var(--color-error)" }}
                    />
                </div>
                <h3 className="ui-empty-state-title text-lg font-medium text-[color:var(--color-text-primary)]">
                    Failed to load PDF
                </h3>
                <p className="ui-empty-state-copy text-sm text-[color:var(--color-text-secondary)] leading-relaxed">{displayError}</p>
                {onRetry && (
                    <button
                        onClick={onRetry}
                        className={cn(
                            "ui-empty-state-action mt-4 px-4 py-2 rounded-lg",
                            "bg-[var(--color-accent)] ui-text-accent-contrast",
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
 * PDFReader - A streamlined PDF reader without its own toolbar.
 *
 * Features:
 * - Full PDF rendering with PDF.js
 * - No built-in toolbar (controls provided by parent)
 * - Exposes PDF state and methods via ref for external control
 * - Theme integration (light/sepia/dark)
 * - Loading and error states
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
 *     onPageChange={(page, total, scale) => console.log(`Page ${page} of ${total} at ${scale * 100}%`)}
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
            originalFilename,
            initialPage,
            initialZoom,
            initialZoomMode,
            theme = "light",
            onPageChange,
            onLoad,
            onError,
            onViewportTap,
            annotations,
            annotationMode,
            highlightColor = "yellow",
            penColor = "blue",
            penWidth = 2,
            onAnnotationAdd,
            onAnnotationChange,
            onAnnotationRemove,
            onZoomModeChange,
        },
        ref
    ) {
        // Ref to the PDFJsEngine component
        const engineRef = useRef<PDFJsEngineRef>(null);

        // Local state for UI
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [currentPage, setCurrentPage] = useState(initialPage ?? 1);
        const [totalPages, setTotalPages] = useState(0);
        const [scale, setScale] = useState(initialZoom ?? 1);

        useEffect(() => {
            setCurrentPage(initialPage ?? 1);
        }, [initialPage]);

        useEffect(() => {
            setScale(initialZoom ?? 1);
        }, [initialZoom]);

        // Expose the engine's imperative handle through our ref
        useImperativeHandle(ref, () => ({
            goToPage: (page: number) => engineRef.current?.goToPage(page),
            nextPage: () => engineRef.current?.nextPage(),
            prevPage: () => engineRef.current?.prevPage(),
            zoomIn: () => {
                engineRef.current?.zoomIn();
                const newScale = engineRef.current?.getZoom() ?? 1;
                setScale(newScale);
                onPageChange?.(currentPage, totalPages, newScale);
            },
            zoomOut: () => {
                engineRef.current?.zoomOut();
                const newScale = engineRef.current?.getZoom() ?? 1;
                setScale(newScale);
                onPageChange?.(currentPage, totalPages, newScale);
            },
            zoomReset: () => {
                engineRef.current?.zoomReset();
                setScale(1);
                onPageChange?.(currentPage, totalPages, 1);
            },
            setZoom: (s: number) => {
                engineRef.current?.setZoom(s);
                setScale(s);
                onPageChange?.(currentPage, totalPages, s);
            },
            getZoom: () => engineRef.current?.getZoom() ?? 1,
            getCurrentPage: () => engineRef.current?.getCurrentPage() ?? 1,
            getTotalPages: () => engineRef.current?.getTotalPages() ?? 0,
            rotateClockwise: () => engineRef.current?.rotateClockwise(),
            rotateCounterClockwise: () => engineRef.current?.rotateCounterClockwise(),
            zoomFitPage: () => {
                engineRef.current?.zoomFitPage();
                const newScale = engineRef.current?.getZoom() ?? 1;
                setScale(newScale);
                onPageChange?.(currentPage, totalPages, newScale);
            },
            zoomFitWidth: () => {
                engineRef.current?.zoomFitWidth();
                const newScale = engineRef.current?.getZoom() ?? 1;
                setScale(newScale);
                onPageChange?.(currentPage, totalPages, newScale);
            },
            search: (query: string) => engineRef.current?.search(query) || (async function* () {
                yield "done" as const;
            })(),
            clearSearch: () => engineRef.current?.clearSearch(),
        }));

        // Handle page change from engine
        const handlePageChange = useCallback(
            (page: number, total: number, reportedScale: number) => {
                setCurrentPage(page);
                setTotalPages(total);
                setScale(reportedScale);
                onPageChange?.(page, total, reportedScale);
            },
            [onPageChange]
        );

        // Handle load from engine
        const handleLoad = useCallback(
            (info: PDFDocumentInfo) => {
                setIsLoading(false);
                setTotalPages(info.totalPages);
                const loadedScale = engineRef.current?.getZoom() ?? scale;
                const loadedPage = engineRef.current?.getCurrentPage() ?? 1;
                onPageChange?.(loadedPage, info.totalPages, loadedScale);
                onLoad?.(info);
            },
            [onLoad, onPageChange, scale]
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
                {/* PDF Viewer Area - Full height, no toolbar */}
                <div className="flex-1 relative overflow-hidden">
                    {/* Loading State */}
                    {isLoading && <LoadingState />}

                    {/* Error State */}
                    {error && <ErrorState error={error} />}

                    {/* PDF Engine */}
                    <PDFJsEngine
                        ref={engineRef}
                        pdfPath={pdfPath}
                        pdfData={pdfData}
                        originalFilename={originalFilename}
                        initialPage={initialPage}
                        initialZoom={initialZoom}
                        initialZoomMode={initialZoomMode}
                        onPageChange={handlePageChange}
                        onZoomModeChange={onZoomModeChange}
                        onLoad={handleLoad}
                        onError={handleError}
                        onViewportTap={onViewportTap}
                        annotations={annotations}
                        annotationMode={annotationMode}
                        highlightColor={highlightColor}
                        penColor={penColor}
                        penWidth={penWidth}
                        onAnnotationAdd={onAnnotationAdd}
                        onAnnotationChange={onAnnotationChange}
                        onAnnotationRemove={onAnnotationRemove}
                        className="w-full h-full"
                    />
                </div>
            </div>
        );
    }
);

export default PDFReader;
export type { PDFReaderProps };
