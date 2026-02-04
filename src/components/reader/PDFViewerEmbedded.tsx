/**
 * PDFViewerEmbedded - iframe-based PDF viewer using PDF.js
 *
 * Embeds the PDF.js viewer in an iframe for full-featured PDF rendering
 * with support for Tauri file protocols and postMessage communication.
 */

import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    useCallback,
} from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/env";
import { Loader2, AlertCircle } from "lucide-react";

export interface PDFViewerEmbeddedProps {
    file: File | Blob | string | null;
    initialPage?: number;
    scale?: number;
    className?: string;
    onReady?: () => void;
    onPageChange?: (page: number, totalPages: number) => void;
    onZoomChange?: (scale: number) => void;
    onError?: (error: Error) => void;
}

export interface PDFViewerHandle {
    goToPage: (page: number) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    setZoom: (scale: number) => void;
    fitWidth: () => void;
    fitPage: () => void;
    getCurrentPage: () => number;
    getTotalPages: () => number;
}

interface ViewerState {
    page: number;
    totalPages: number;
    scale: number;
    loaded: boolean;
}

const MIN_SCALE = 0.25;
const MAX_SCALE = 5.0;
const SCALE_STEP = 0.25;

/**
 * Get URL for the PDF file
 */
async function getFileUrl(file: File | Blob | string): Promise<string> {
    // If it's already a string (URL or path), handle it
    if (typeof file === "string") {
        // Check if it's a remote URL
        if (file.startsWith("http://") || file.startsWith("https://")) {
            return file;
        }
        // Check if it's a data URL
        if (file.startsWith("data:")) {
            return file;
        }
        // Assume it's a local file path
        if (isTauri()) {
            return convertFileSrc(file);
        }
        // In web mode, we can't access local file paths directly
        throw new Error("Local file paths are only supported in Tauri mode");
    }

    // For File or Blob, create an object URL
    return URL.createObjectURL(file);
}

/**
 * PDFViewerEmbedded component - Renders PDF using PDF.js iframe viewer
 */
export const PDFViewerEmbedded = forwardRef<PDFViewerHandle, PDFViewerEmbeddedProps>(
    (
        {
            file,
            initialPage = 1,
            scale: initialScale = 1.0,
            className,
            onReady,
            onPageChange,
            onZoomChange,
            onError,
        },
        ref
    ) => {
        const iframeRef = useRef<HTMLIFrameElement>(null);
        const fileUrlRef = useRef<string | null>(null);
        const mountedRef = useRef(true);
        const pendingActionsRef = useRef<Array<() => void>>([]);

        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<Error | null>(null);
        const [viewerState, setViewerState] = useState<ViewerState>({
            page: initialPage,
            totalPages: 0,
            scale: initialScale,
            loaded: false,
        });

        // Build the viewer URL with file and initial settings
        const [viewerUrl, setViewerUrl] = useState<string>("");

        // Initialize file URL
        useEffect(() => {
            let objectUrl: string | null = null;

            const initFile = async () => {
                if (!file) {
                    setViewerUrl("");
                    return;
                }

                try {
                    setIsLoading(true);
                    setError(null);

                    const fileUrl = await getFileUrl(file);
                    fileUrlRef.current = fileUrl;

                    // Check if it's a blob URL we created
                    if (fileUrl.startsWith("blob:")) {
                        objectUrl = fileUrl;
                    }

                    const encodedFile = encodeURIComponent(fileUrl);
                    const page = Math.max(1, initialPage);
                    const zoom = initialScale <= 0 ? "page-width" : String(initialScale);

                    const url = `/pdfjs/web/viewer.html?file=${encodedFile}#page=${page}&zoom=${zoom}`;
                    setViewerUrl(url);
                } catch (err) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    setError(error);
                    onError?.(error);
                    setIsLoading(false);
                }
            };

            initFile();

            return () => {
                // Cleanup object URL if we created one
                if (objectUrl) {
                    URL.revokeObjectURL(objectUrl);
                }
            };
        }, [file, initialPage, initialScale, onError]);

        // Handle messages from the viewer
        useEffect(() => {
            const handleMessage = (event: MessageEvent) => {
                // Only accept messages from our iframe
                if (event.source !== iframeRef.current?.contentWindow) {
                    return;
                }

                const { data } = event;
                if (!data || typeof data !== "object") return;

                switch (data.type) {
                    case "documentloaded":
                        setIsLoading(false);
                        setViewerState((prev) => ({
                            ...prev,
                            totalPages: data.totalPages || 0,
                            loaded: true,
                        }));
                        onReady?.();
                        // Execute any pending actions
                        pendingActionsRef.current.forEach((action) => action());
                        pendingActionsRef.current = [];
                        break;

                    case "pagechange":
                        setViewerState((prev) => ({
                            ...prev,
                            page: data.page,
                            totalPages: data.totalPages || prev.totalPages,
                        }));
                        onPageChange?.(data.page, data.totalPages || viewerState.totalPages);
                        break;

                    case "scalechange":
                        setViewerState((prev) => ({
                            ...prev,
                            scale: data.scale,
                        }));
                        onZoomChange?.(data.scale);
                        break;

                    case "documenterror":
                        const err = new Error(data.message || "Failed to load PDF");
                        setError(err);
                        setIsLoading(false);
                        onError?.(err);
                        break;
                }
            };

            window.addEventListener("message", handleMessage);
            return () => window.removeEventListener("message", handleMessage);
        }, [onReady, onPageChange, onZoomChange, onError, viewerState.totalPages]);

        // Send message to viewer
        const sendMessage = useCallback((message: object) => {
            const iframe = iframeRef.current;
            if (iframe?.contentWindow) {
                iframe.contentWindow.postMessage(message, "*");
            }
        }, []);

        // Execute action when viewer is ready, or queue it
        const executeWhenReady = useCallback((action: () => void) => {
            if (viewerState.loaded) {
                action();
            } else {
                pendingActionsRef.current.push(action);
            }
        }, [viewerState.loaded]);

        // Expose imperative handle
        useImperativeHandle(ref, () => ({
            goToPage: (page: number) => {
                executeWhenReady(() => {
                    sendMessage({ type: "page", page });
                });
            },
            zoomIn: () => {
                executeWhenReady(() => {
                    const newScale = Math.min(viewerState.scale + SCALE_STEP, MAX_SCALE);
                    sendMessage({ type: "scale", scale: newScale });
                });
            },
            zoomOut: () => {
                executeWhenReady(() => {
                    const newScale = Math.max(viewerState.scale - SCALE_STEP, MIN_SCALE);
                    sendMessage({ type: "scale", scale: newScale });
                });
            },
            setZoom: (scale: number) => {
                executeWhenReady(() => {
                    const clampedScale = Math.max(MIN_SCALE, Math.min(scale, MAX_SCALE));
                    sendMessage({ type: "scale", scale: clampedScale });
                });
            },
            fitWidth: () => {
                executeWhenReady(() => {
                    sendMessage({ type: "scale", scale: "page-width" });
                });
            },
            fitPage: () => {
                executeWhenReady(() => {
                    sendMessage({ type: "scale", scale: "page-fit" });
                });
            },
            getCurrentPage: () => viewerState.page,
            getTotalPages: () => viewerState.totalPages,
        }), [sendMessage, executeWhenReady, viewerState.page, viewerState.totalPages, viewerState.scale]);

        // Cleanup on unmount
        useEffect(() => {
            return () => {
                mountedRef.current = false;
                // Revoke object URL if we created one
                if (fileUrlRef.current?.startsWith("blob:")) {
                    URL.revokeObjectURL(fileUrlRef.current);
                }
            };
        }, []);

        return (
            <div
                className={cn(
                    "relative w-full h-full overflow-hidden",
                    className
                )}
            >
                {/* Loading state */}
                {isLoading && !error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-surface)] z-10">
                        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-accent)] mb-4" />
                        <span className="text-[var(--color-text-secondary)] text-sm">
                            Loading PDF...
                        </span>
                    </div>
                )}

                {/* Error state */}
                {error && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-surface)] z-10 p-8">
                        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                        <h3 className="text-[var(--color-text-primary)] font-medium mb-2">
                            Failed to load PDF
                        </h3>
                        <p className="text-[var(--color-text-secondary)] text-sm text-center max-w-md">
                            {error.message}
                        </p>
                    </div>
                )}

                {/* PDF Viewer iframe */}
                {viewerUrl && !error && (
                    <iframe
                        ref={iframeRef}
                        src={viewerUrl}
                        className="w-full h-full border-0"
                        title="PDF Viewer"
                        allow="fullscreen"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                    />
                )}
            </div>
        );
    }
);

PDFViewerEmbedded.displayName = "PDFViewerEmbedded";
