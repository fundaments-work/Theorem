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
    forwardRef,
    useImperativeHandle,
    useMemo,
    memo,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/env";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Annotation } from "@/types";
import { PDFAnnotationLayer } from "@/components/reader/PDFAnnotationLayer";

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
    // Annotations
    annotations?: Annotation[];
    annotationMode?: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
    onAnnotationAdd?: (annotation: Partial<Annotation>) => void;
    onAnnotationChange?: (annotation: Annotation) => void;
    onAnnotationRemove?: (id: string) => void;
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
    zoomFitPage: () => void;
    zoomFitWidth: () => void;
}

// Constants
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.25;
const DEFAULT_SCALE = 1.0;
const PDF_TO_CSS_UNITS = pdfjsLib.PixelsPerInch?.PDF_TO_CSS_UNITS ?? (96 / 72);
const PAGE_PRERENDER_MARGIN = "200% 0px";
const PAGE_LOAD_BATCH_SIZE = 5;
const WEBKIT_MIN_OUTPUT_SCALE = 2;
const MAX_CANVAS_PIXEL_COUNT = 18_000_000;
const EMPTY_ANNOTATIONS: Annotation[] = [];
const TEXT_LAYER_SELECTING_CLASS = "selecting";

const activeTextLayers = new Map<HTMLDivElement, HTMLDivElement>();
let textLayerSelectionAbortController: AbortController | null = null;

function getCanvasPixelRatio(
    cssWidth: number,
    cssHeight: number,
    preferSharpCanvas: boolean,
): number {
    const deviceRatio = Math.max(1, window.devicePixelRatio || 1);
    const preferredRatio = preferSharpCanvas
        ? Math.max(deviceRatio, WEBKIT_MIN_OUTPUT_SCALE)
        : deviceRatio;
    const safePixelBudget = Math.max(1, cssWidth * cssHeight);
    const maxAllowedRatio = Math.sqrt(MAX_CANVAS_PIXEL_COUNT / safePixelBudget);
    return Math.max(1, Math.min(preferredRatio, maxAllowedRatio));
}

function getCssDimension(value: number, snapToPixelGrid: boolean): number {
    if (!snapToPixelGrid) {
        return value;
    }
    return Math.max(1, Math.round(value));
}

function resetTextLayerSelectionState(endNode: HTMLDivElement, layerNode: HTMLDivElement): void {
    layerNode.append(endNode);
    endNode.style.width = "";
    endNode.style.height = "";
    layerNode.classList.remove(TEXT_LAYER_SELECTING_CLASS);
}

function ensureGlobalTextLayerSelectionListeners(): void {
    if (textLayerSelectionAbortController) {
        return;
    }

    textLayerSelectionAbortController = new AbortController();
    const { signal } = textLayerSelectionAbortController;
    let pointerDown = false;
    let isFirefox: boolean | undefined;
    let previousRange: Range | null = null;

    document.addEventListener(
        "pointerdown",
        () => {
            pointerDown = true;
        },
        { signal },
    );

    document.addEventListener(
        "pointerup",
        () => {
            pointerDown = false;
            activeTextLayers.forEach((endNode, layerNode) => {
                resetTextLayerSelectionState(endNode, layerNode);
            });
        },
        { signal },
    );

    window.addEventListener(
        "blur",
        () => {
            pointerDown = false;
            activeTextLayers.forEach((endNode, layerNode) => {
                resetTextLayerSelectionState(endNode, layerNode);
            });
        },
        { signal },
    );

    document.addEventListener(
        "keyup",
        () => {
            if (pointerDown) {
                return;
            }
            activeTextLayers.forEach((endNode, layerNode) => {
                resetTextLayerSelectionState(endNode, layerNode);
            });
        },
        { signal },
    );

    document.addEventListener(
        "selectionchange",
        () => {
            const selection = document.getSelection();
            if (!selection || selection.rangeCount === 0) {
                activeTextLayers.forEach((endNode, layerNode) => {
                    resetTextLayerSelectionState(endNode, layerNode);
                });
                return;
            }

            const selectedLayerNodes = new Set<HTMLDivElement>();
            for (let i = 0; i < selection.rangeCount; i++) {
                const range = selection.getRangeAt(i);
                for (const layerNode of activeTextLayers.keys()) {
                    try {
                        if (!selectedLayerNodes.has(layerNode) && range.intersectsNode(layerNode)) {
                            selectedLayerNodes.add(layerNode);
                        }
                    } catch {
                        // Ignore detached-node errors during rapid rerenders.
                    }
                }
            }

            for (const [layerNode, endNode] of activeTextLayers) {
                if (selectedLayerNodes.has(layerNode)) {
                    layerNode.classList.add(TEXT_LAYER_SELECTING_CLASS);
                } else {
                    resetTextLayerSelectionState(endNode, layerNode);
                }
            }

            const firstEndNode = activeTextLayers.values().next().value as HTMLDivElement | undefined;
            if (firstEndNode) {
                isFirefox ??= getComputedStyle(firstEndNode).getPropertyValue("-moz-user-select") === "none";
            }
            if (isFirefox) {
                return;
            }

            const range = selection.getRangeAt(0);
            const modifyStart = !!previousRange && (
                range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
                range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0
            );
            let anchorNode: Node | null = modifyStart ? range.startContainer : range.endContainer;
            if (anchorNode?.nodeType === Node.TEXT_NODE) {
                anchorNode = anchorNode.parentNode;
            }

            const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : null;
            const layerNode = anchorElement?.closest<HTMLDivElement>(".textLayer");
            const endNode = layerNode ? activeTextLayers.get(layerNode) : undefined;

            if (layerNode && endNode) {
                endNode.style.width = layerNode.style.width;
                endNode.style.height = layerNode.style.height;
                anchorElement?.parentElement?.insertBefore(
                    endNode,
                    modifyStart ? anchorElement : anchorElement?.nextSibling ?? null,
                );
            }

            previousRange = range.cloneRange();
        },
        { signal },
    );
}

function registerTextLayer(layerNode: HTMLDivElement, endNode: HTMLDivElement): void {
    activeTextLayers.set(layerNode, endNode);
    ensureGlobalTextLayerSelectionListeners();
}

function unregisterTextLayer(layerNode: HTMLDivElement): void {
    activeTextLayers.delete(layerNode);
    if (activeTextLayers.size > 0) {
        return;
    }
    textLayerSelectionAbortController?.abort();
    textLayerSelectionAbortController = null;
}

interface TextItemLike {
    str?: string;
    width?: number;
}

interface CanvasSizing {
    canvasWidth: number;
    canvasHeight: number;
    renderScaleX: number;
    renderScaleY: number;
    scaleRoundX: number;
    scaleRoundY: number;
}

function approximateFraction(value: number): [number, number] {
    if (Math.floor(value) === value) {
        return [value, 1];
    }

    const inverse = 1 / value;
    const limit = 8;

    if (inverse > limit) {
        return [1, limit];
    }
    if (Math.floor(inverse) === inverse) {
        return [1, inverse];
    }

    const target = value > 1 ? inverse : value;
    let a = 0;
    let b = 1;
    let c = 1;
    let d = 1;

    while (true) {
        const p = a + c;
        const q = b + d;
        if (q > limit) {
            break;
        }
        if (target <= p / q) {
            c = p;
            d = q;
        } else {
            a = p;
            b = q;
        }
    }

    if (target - a / b < c / d - target) {
        return target === value ? [a, b] : [b, a];
    }
    return target === value ? [c, d] : [d, c];
}

function floorToDivide(value: number, divider: number): number {
    return value - (value % divider);
}

function getCanvasSizing(cssWidth: number, cssHeight: number, outputScale: number): CanvasSizing {
    const sfx = approximateFraction(outputScale);
    const sfy = approximateFraction(outputScale);

    const canvasWidth = Math.max(
        1,
        floorToDivide(Math.round(cssWidth * outputScale), sfx[0]),
    );
    const canvasHeight = Math.max(
        1,
        floorToDivide(Math.round(cssHeight * outputScale), sfy[0]),
    );

    const pageWidth = Math.max(1, floorToDivide(Math.round(cssWidth), sfx[1]));
    const pageHeight = Math.max(1, floorToDivide(Math.round(cssHeight), sfy[1]));

    return {
        canvasWidth,
        canvasHeight,
        renderScaleX: canvasWidth / pageWidth,
        renderScaleY: canvasHeight / pageHeight,
        scaleRoundX: sfx[1],
        scaleRoundY: sfy[1],
    };
}

function computeMedian(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseScaleX(transform: string): number | null {
    const match = transform.match(/scaleX\(([-+0-9.eE]+)\)/);
    if (!match) {
        return null;
    }
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    return parsed;
}

function mergeScaleX(transform: string, correction: number): string {
    const existing = parseScaleX(transform);
    if (existing === null) {
        return `${transform} scaleX(${correction})`;
    }
    const merged = existing * correction;
    return transform.replace(
        /scaleX\(([-+0-9.eE]+)\)/,
        `scaleX(${merged})`,
    );
}

function calibrateWebKitTextLayerWidth(
    textDivs: HTMLSpanElement[],
    textItems: TextItemLike[],
    viewportScale: number,
): void {
    if (textDivs.length === 0 || textItems.length === 0 || viewportScale <= 0) {
        return;
    }

    const ratiosByFont = new Map<string, number[]>();
    const allRatios: number[] = [];
    const sampleLimit = 2500;

    let textDivIndex = 0;
    let sampledPairs = 0;

    for (const item of textItems) {
        if (sampledPairs >= sampleLimit || textDivIndex >= textDivs.length) {
            break;
        }
        if (typeof item.str !== "string") {
            continue;
        }

        const span = textDivs[textDivIndex];
        textDivIndex += 1;
        if (!span?.isConnected) {
            continue;
        }
        if (!item.str.trim()) {
            continue;
        }

        const expectedWidth = Math.abs((item.width ?? 0) * viewportScale);
        const actualWidth = span.getBoundingClientRect().width;
        if (actualWidth <= 0.01 || expectedWidth <= 0.01) {
            continue;
        }

        const ratio = expectedWidth / actualWidth;
        if (ratio < 0.5 || ratio > 1.5) {
            continue;
        }

        sampledPairs += 1;
        allRatios.push(ratio);
        const fontKey = span.style.fontFamily || "__default__";
        const bucket = ratiosByFont.get(fontKey);
        if (bucket) {
            bucket.push(ratio);
        } else {
            ratiosByFont.set(fontKey, [ratio]);
        }
    }

    if (allRatios.length < 24) {
        if (import.meta.env.DEV) {
            console.debug("[PDF][TextLayer] WebKit font corrections skipped: insufficient samples", {
                sampledPairs,
                textDivs: textDivs.length,
                textItems: textItems.length,
            });
        }
        return;
    }

    const globalMedian = computeMedian(allRatios);
    if (!globalMedian) {
        if (import.meta.env.DEV) {
            console.debug("[PDF][TextLayer] WebKit font corrections skipped: no global median", {
                sampledPairs,
            });
        }
        return;
    }

    let globalCorrection: number | null = null;
    if (Math.abs(1 - globalMedian) >= 0.02) {
        globalCorrection = Math.max(0.75, Math.min(1.25, globalMedian));
    }

    const correctionsByFont = new Map<string, number>();
    for (const [fontKey, ratios] of ratiosByFont) {
        if (ratios.length < 8) {
            continue;
        }
        const medianRatio = computeMedian(ratios);
        if (!medianRatio) {
            continue;
        }
        if (Math.abs(1 - medianRatio) < 0.02) {
            continue;
        }
        correctionsByFont.set(fontKey, Math.max(0.75, Math.min(1.25, medianRatio)));
    }

    if (correctionsByFont.size === 0 && !globalCorrection) {
        if (import.meta.env.DEV) {
            console.debug("[PDF][TextLayer] WebKit font corrections skipped: below threshold", {
                sampledPairs,
                globalMedian,
            });
        }
        return;
    }

    if (import.meta.env.DEV) {
        console.debug("[PDF][TextLayer] WebKit font corrections:", {
            sampledPairs,
            globalMedian,
            globalCorrection,
            fonts: Array.from(correctionsByFont.entries()).map(([fontKey, correction]) => ({
                fontKey,
                correction,
                samples: ratiosByFont.get(fontKey)?.length ?? 0,
            })),
        });
    }

    for (const span of textDivs) {
        if (!span.isConnected) {
            continue;
        }
        const fontKey = span.style.fontFamily || "__default__";
        const correction = correctionsByFont.get(fontKey) ?? globalCorrection;
        if (!correction) {
            continue;
        }
        const transform = span.style.transform;
        if (!transform) {
            continue;
        }
        span.style.transform = mergeScaleX(transform, correction);
    }
}

function waitForNextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => resolve());
    });
}


interface PageCanvasProps {
    page: PDFPageProxy;
    scale: number;
    rotation: number;
    onRenderComplete?: () => void;
    // Annotations
    annotations?: Annotation[];
    annotationMode?: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
    enableTextLayer: boolean;
    preferSharpCanvas: boolean;
    snapCssToPixels: boolean;
    useStreamTextLayer: boolean;
    calibrateTextLayerWidths: boolean;
    onAnnotationAdd?: (annotation: Partial<Annotation>) => void;
    onAnnotationRemove?: (id: string) => void;
}

const PageCanvas = memo(function PageCanvas({
    page,
    scale,
    rotation,
    onRenderComplete,
    annotations = [],
    annotationMode = "none",
    enableTextLayer,
    preferSharpCanvas,
    snapCssToPixels,
    useStreamTextLayer,
    calibrateTextLayerWidths,
    onAnnotationAdd,
    onAnnotationRemove,
}: PageCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
    const textLayerInstanceRef = useRef<TextLayer | null>(null);
    const [shouldRender, setShouldRender] = useState(page.pageNumber <= 2);
    const [isRendering, setIsRendering] = useState(page.pageNumber <= 2);
    const shouldRenderAnnotationLayer = annotationMode !== "none" || annotations.length > 0;

    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;

        if (!container || !canvas) {
            return;
        }
        if (enableTextLayer && !textLayerDiv) {
            return;
        }

        const viewport = page.getViewport({
            scale: scale * PDF_TO_CSS_UNITS,
            rotation,
        });
        const cssWidth = getCssDimension(viewport.width, snapCssToPixels);
        const cssHeight = getCssDimension(viewport.height, snapCssToPixels);

        container.style.width = `${cssWidth}px`;
        container.style.height = `${cssHeight}px`;
        container.style.setProperty("--scale-factor", `${viewport.scale}`);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
    }, [page, scale, rotation, enableTextLayer, snapCssToPixels]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || shouldRender) {
            return;
        }
        if (typeof IntersectionObserver === "undefined") {
            setShouldRender(true);
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setShouldRender(true);
                    observer.disconnect();
                }
            },
            {
                root: null,
                rootMargin: PAGE_PRERENDER_MARGIN,
            },
        );

        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, [shouldRender]);

    useEffect(() => {
        if (!shouldRender) {
            return;
        }

        let cancelled = false;
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;

        if (!canvas) {
            return;
        }
        if (enableTextLayer && !textLayerDiv) {
            return;
        }

        const renderPage = async () => {
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch {
                    // Ignore cancellation errors.
                }
                renderTaskRef.current = null;
            }
            if (textLayerInstanceRef.current) {
                try {
                    textLayerInstanceRef.current.cancel();
                } catch {
                    // Ignore cancellation errors.
                }
                textLayerInstanceRef.current = null;
            }

            setIsRendering(true);

            try {
                const viewport = page.getViewport({
                    scale: scale * PDF_TO_CSS_UNITS,
                    rotation,
                });
                const cssWidth = getCssDimension(viewport.width, snapCssToPixels);
                const cssHeight = getCssDimension(viewport.height, snapCssToPixels);
                const outputScale = getCanvasPixelRatio(
                    cssWidth,
                    cssHeight,
                    preferSharpCanvas,
                );
                const sizing = getCanvasSizing(cssWidth, cssHeight, outputScale);
                canvas.width = sizing.canvasWidth;
                canvas.height = sizing.canvasHeight;
                containerRef.current?.style.setProperty("--scale-factor", `${viewport.scale}`);
                containerRef.current?.style.setProperty("--scale-round-x", `${sizing.scaleRoundX}px`);
                containerRef.current?.style.setProperty("--scale-round-y", `${sizing.scaleRoundY}px`);
                canvas.style.width = `${cssWidth}px`;
                canvas.style.height = `${cssHeight}px`;
                const renderScaleX = sizing.renderScaleX;
                const renderScaleY = sizing.renderScaleY;

                const ctx = canvas.getContext("2d", {
                    alpha: false,
                });

                if (!ctx || cancelled) {
                    return;
                }

                ctx.clearRect(0, 0, canvas.width, canvas.height);

                const renderTask = page.render({
                    canvasContext: ctx,
                    viewport,
                    transform: [renderScaleX, 0, 0, renderScaleY, 0, 0],
                });

                renderTaskRef.current = renderTask;

                await renderTask.promise;
                if (cancelled) {
                    return;
                }

                if (enableTextLayer && textLayerDiv) {
                    unregisterTextLayer(textLayerDiv);
                    textLayerDiv.innerHTML = "";
                    textLayerDiv.tabIndex = 0;
                    if (textLayerDiv.dataset.textSelectionBound !== "1") {
                        textLayerDiv.addEventListener("mousedown", () => {
                            textLayerDiv.classList.add(TEXT_LAYER_SELECTING_CLASS);
                        });
                        textLayerDiv.addEventListener("copy", (event) => {
                            const selection = document.getSelection();
                            if (!selection) {
                                return;
                            }
                            event.preventDefault();
                            event.clipboardData?.setData("text/plain", selection.toString());
                        });
                        textLayerDiv.dataset.textSelectionBound = "1";
                    }

                    try {
                        let textItemsForCalibration: TextItemLike[] | null = null;
                        const textContentSource = useStreamTextLayer
                            ? page.streamTextContent({
                                includeMarkedContent: true,
                                disableNormalization: true,
                            })
                            : await page.getTextContent({
                                includeMarkedContent: true,
                                disableNormalization: true,
                            });
                        if (!useStreamTextLayer) {
                            textItemsForCalibration =
                                (textContentSource as { items?: TextItemLike[] }).items ?? null;
                        }
                        if (cancelled) {
                            return;
                        }

                        const textLayer = new TextLayer({
                            textContentSource,
                            container: textLayerDiv,
                            viewport,
                        });

                        textLayerInstanceRef.current = textLayer;
                        await textLayer.render();

                        if (calibrateTextLayerWidths && textItemsForCalibration) {
                            const renderedSpans = textLayer.textDivs as unknown as HTMLSpanElement[];
                            calibrateWebKitTextLayerWidth(
                                renderedSpans,
                                textItemsForCalibration,
                                viewport.scale,
                            );

                            // A second pass after fonts/layout settle in WebKit reduces residual drift.
                            await waitForNextFrame();
                            await waitForNextFrame();
                            if (!cancelled) {
                                calibrateWebKitTextLayerWidth(
                                    renderedSpans,
                                    textItemsForCalibration,
                                    viewport.scale,
                                );
                            }
                        }

                        const endOfContent = document.createElement("div");
                        endOfContent.className = "endOfContent";
                        textLayerDiv.append(endOfContent);
                        registerTextLayer(textLayerDiv, endOfContent);
                    } catch (textError) {
                        console.warn("[PageCanvas] Text layer error:", textError);
                    }
                }

                if (!cancelled) {
                    renderTaskRef.current = null;
                    setIsRendering(false);
                    onRenderComplete?.();
                }
            } catch (error: unknown) {
                const isCancelled = error instanceof Error &&
                    (error.message.includes("cancelled") || error.message.includes("Rendering cancelled"));
                if (!isCancelled) {
                    console.error(error);
                }
            }
        };

        renderPage();

        return () => {
            cancelled = true;
            if (renderTaskRef.current) {
                try {
                    renderTaskRef.current.cancel();
                } catch {
                    // Ignore cancellation errors.
                }
            }
            if (enableTextLayer && textLayerInstanceRef.current) {
                try {
                    textLayerInstanceRef.current.cancel();
                } catch {
                    // Ignore cancellation errors.
                }
            }
            if (enableTextLayer && textLayerDiv) {
                unregisterTextLayer(textLayerDiv);
            }
        };
    }, [
        page,
        scale,
        rotation,
        shouldRender,
        onRenderComplete,
        enableTextLayer,
        preferSharpCanvas,
        snapCssToPixels,
        useStreamTextLayer,
        calibrateTextLayerWidths,
    ]);

    return (
        <div ref={containerRef} className="pdf-page-container">
            <canvas ref={canvasRef} className="block absolute inset-0" />
            {enableTextLayer && <div ref={textLayerRef} className="textLayer" />}
            {shouldRenderAnnotationLayer && (
                <PDFAnnotationLayer
                    pageNumber={page.pageNumber}
                    annotations={annotations}
                    mode={annotationMode}
                    scale={scale}
                    onAnnotationAdd={(ann) => onAnnotationAdd?.(ann)}
                    onAnnotationRemove={(id) => onAnnotationRemove?.(id)}
                />
            )}

            {/* Rendering Spinner */}
            {shouldRender && isRendering && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-accent)]" />
                </div>
            )}
        </div>
    );
});

/**
 * PDF.js Engine Component
 */
export const PDFJsEngine = forwardRef<PDFJsEngineRef, PDFJsEngineProps>(
    function PDFJsEngine({
        pdfPath,
        pdfData,
        originalFilename,
        initialPage = 1,
        onLoad,
        onError,
        onPageChange,
        className,
        annotations = [],
        annotationMode = 'none',
        onAnnotationAdd,
        onAnnotationRemove
    }, ref) {
        const containerRef = useRef<HTMLDivElement>(null);
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [currentPage, setCurrentPage] = useState(initialPage);
        const [totalPages, setTotalPages] = useState(0);
        const [scale, setScale] = useState(DEFAULT_SCALE);
        const [rotation, setRotation] = useState(0);
        const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
        const [pages, setPages] = useState<PDFPageProxy[]>([]);
        const hasAppliedInitialFitRef = useRef(false);
        const isDesktopWebKit = useMemo(
            () => isTauri(),
            [],
        );
        const enableTextLayer = true;
        const useStreamTextLayer = !isDesktopWebKit;

        // Use refs for callbacks to avoid re-triggering the load effect
        const callbacksRef = useRef({ onLoad, onError, onPageChange });
        useEffect(() => {
            callbacksRef.current = { onLoad, onError, onPageChange };
        }, [onLoad, onError, onPageChange]);

        const annotationsByPage = useMemo(() => {
            const grouped = new Map<number, Annotation[]>();
            for (const annotation of annotations) {
                if (annotation.pageNumber == null) {
                    continue;
                }
                const pageAnnotations = grouped.get(annotation.pageNumber);
                if (pageAnnotations) {
                    pageAnnotations.push(annotation);
                    continue;
                }
                grouped.set(annotation.pageNumber, [annotation]);
            }
            return grouped;
        }, [annotations]);

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
                    hasAppliedInitialFitRef.current = false;

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
                    // Fix: Ensure data is a "clean" Uint8Array to avoid DataCloneError in some WebKit environments
                    // By using subarray(0) or new Uint8Array(data) we ensure it's a serializable object
                    const loadingTask = pdfjsLib.getDocument({
                        data: new Uint8Array(data), // Create a clean copy to ensure transferability and satisfy TS
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

                    setTotalPages(info.totalPages);

                    // Pre-load first few pages
                    const initialPages: PDFPageProxy[] = [];
                    const pagesToLoad = Math.min(PAGE_LOAD_BATCH_SIZE, pdf.numPages);
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

        // Apply an initial fit-width scale so PDF text is readable by default.
        useEffect(() => {
            if (hasAppliedInitialFitRef.current) {
                return;
            }
            if (!containerRef.current || pages.length === 0) {
                return;
            }

            const rafId = window.requestAnimationFrame(() => {
                const container = containerRef.current;
                if (!container) {
                    return;
                }

                const containerWidth = container.clientWidth - 32;
                if (containerWidth <= 0) {
                    return;
                }

                const firstPage = pages[0];
                const viewport = firstPage.getViewport({ scale: PDF_TO_CSS_UNITS });
                if (viewport.width <= 0) {
                    return;
                }

                const fitScale = containerWidth / viewport.width;
                const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale));

                hasAppliedInitialFitRef.current = true;
                setScale(nextScale);
                callbacksRef.current.onPageChange?.(currentPage, totalPages, nextScale);
            });

            return () => {
                cancelAnimationFrame(rafId);
            };
        }, [pages, currentPage, totalPages]);

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
                const endPageNum = Math.min(
                    nextPageNum + PAGE_LOAD_BATCH_SIZE - 1,
                    pdfDocument.numPages,
                );

                try {
                    const pagePromises: Promise<PDFPageProxy>[] = [];
                    for (let pageNum = nextPageNum; pageNum <= endPageNum; pageNum++) {
                        pagePromises.push(pdfDocument.getPage(pageNum));
                    }
                    const loadedPages = await Promise.all(pagePromises);
                    if (!cancelled) {
                        setPages((prev) => {
                            const existingPageNumbers = new Set(prev.map((existingPage) => existingPage.pageNumber));
                            const nextPages = loadedPages.filter(
                                (loadedPage) => !existingPageNumbers.has(loadedPage.pageNumber),
                            );
                            if (nextPages.length === 0) {
                                return prev;
                            }
                            return [...prev, ...nextPages];
                        });
                    } else {
                        loadedPages.forEach((loadedPage) => {
                            loadedPage.cleanup();
                        });
                    }
                } catch (error) {
                    console.error("[PDFJsEngine] Error loading page:", error);
                } finally {
                    isLoadingPageRef.current = false;
                }
            };

            // Load next page batch when we're near the end of loaded pages
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

            let rafId: number | null = null;

            const handleScroll = () => {
                if (rafId !== null) {
                    return;
                }

                rafId = window.requestAnimationFrame(() => {
                    rafId = null;
                    const centerY = container.scrollTop + (container.clientHeight / 2);
                    let newPage = currentPage;
                    const pageNodes = container.querySelectorAll<HTMLElement>(".pdf-page-wrapper");

                    for (const pageNode of pageNodes) {
                        const pageTop = pageNode.offsetTop;
                        const pageBottom = pageTop + pageNode.offsetHeight;
                        if (centerY >= pageTop && centerY <= pageBottom) {
                            const parsedPage = Number(pageNode.dataset.pageNumber);
                            if (!Number.isNaN(parsedPage)) {
                                newPage = parsedPage;
                            }
                            break;
                        }
                    }

                    if (newPage !== currentPage && newPage >= 1 && newPage <= totalPages) {
                        setCurrentPage(newPage);
                        callbacksRef.current.onPageChange?.(newPage, totalPages, scale);
                    }
                });
            };

            const handleWheel = (e: WheelEvent) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                    setScale((prev) => {
                        const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta));
                        callbacksRef.current.onPageChange?.(currentPage, totalPages, nextScale);
                        return nextScale;
                    });
                }
            };

            container.addEventListener("scroll", handleScroll, { passive: true });
            container.addEventListener("wheel", handleWheel, { passive: false });

            return () => {
                container.removeEventListener("scroll", handleScroll);
                container.removeEventListener("wheel", handleWheel);
                if (rafId !== null) {
                    cancelAnimationFrame(rafId);
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
            zoomFitPage: () => {
                if (!containerRef.current || pages.length === 0) return;
                const container = containerRef.current;
                const firstPage = pages[0];
                const viewport = firstPage.getViewport({ scale: PDF_TO_CSS_UNITS });
                const containerH = container.clientHeight - 32; // padding
                const containerW = container.clientWidth - 32;
                const fitScale = Math.min(containerW / viewport.width, containerH / viewport.height);
                const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale));
                setScale(newScale);
                callbacksRef.current.onPageChange?.(currentPage, totalPages, newScale);
            },
            zoomFitWidth: () => {
                if (!containerRef.current || pages.length === 0) return;
                const container = containerRef.current;
                const firstPage = pages[0];
                const viewport = firstPage.getViewport({ scale: PDF_TO_CSS_UNITS });
                const containerW = container.clientWidth - 32; // padding
                const fitScale = containerW / viewport.width;
                const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale));
                setScale(newScale);
                callbacksRef.current.onPageChange?.(currentPage, totalPages, newScale);
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
                    <div
                        className="pdf-zoom-container flex flex-col items-center justify-start min-h-full py-4 space-y-4 mx-auto"
                    >
                        {pages.map((page) => {
                            const pageTextLayerEnabled = enableTextLayer && (
                                isDesktopWebKit
                                    ? page.pageNumber === currentPage
                                    : Math.abs(page.pageNumber - currentPage) <= 1
                            );

                            return (
                                <div
                                    key={`page-${page.pageNumber}`}
                                    className="pdf-page-wrapper"
                                    data-page-number={page.pageNumber}
                                >
                                    <PageCanvas
                                        page={page}
                                        scale={scale}
                                        rotation={rotation}
                                        enableTextLayer={pageTextLayerEnabled}
                                        preferSharpCanvas={isDesktopWebKit && !pageTextLayerEnabled}
                                        snapCssToPixels={isDesktopWebKit && !pageTextLayerEnabled}
                                        useStreamTextLayer={useStreamTextLayer}
                                        calibrateTextLayerWidths={isDesktopWebKit && pageTextLayerEnabled}
                                        annotations={annotationsByPage.get(page.pageNumber) ?? EMPTY_ANNOTATIONS}
                                        annotationMode={annotationMode}
                                        onAnnotationAdd={onAnnotationAdd}
                                        onAnnotationRemove={onAnnotationRemove}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {!isLoading && !error && totalPages > 0 && (
                    <div className="absolute bottom-4 right-4 z-50 pointer-events-none px-3 py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)] shadow-sm">
                        Page {currentPage} of {totalPages} | {Math.round(scale * 100)}%
                    </div>
                )}
            </div>
        );
    }
);

export default PDFJsEngine;
