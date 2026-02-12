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
    useCallback,
    forwardRef,
    useImperativeHandle,
    useMemo,
    memo,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/env";
import { rankByFuzzyQuery } from "@/lib/search/fuzzy";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Annotation, HighlightColor, SearchResult, TocItem } from "@/types";
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
    onViewportTap?: () => void;
    className?: string;
    // Annotations
    annotations?: Annotation[];
    annotationMode?: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
    highlightColor?: HighlightColor;
    penColor?: HighlightColor;
    penWidth?: number;
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
    hasOutline?: boolean;
    toc?: TocItem[];
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
    search: (query: string) => AsyncGenerator<SearchResult | { progress: number } | "done">;
    clearSearch: () => void;
}

// Constants
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.25;
const DEFAULT_SCALE = 1.0;
const PDF_TO_CSS_UNITS = pdfjsLib.PixelsPerInch?.PDF_TO_CSS_UNITS ?? (96 / 72);
const PAGE_PRERENDER_MARGIN = "220% 0px";
const INITIAL_PAGE_LOAD_SIZE = 2;
const PAGE_LOAD_BATCH_SIZE = 5;
const WEBKIT_MIN_OUTPUT_SCALE = 2;
const MAX_CANVAS_PIXEL_COUNT = 16_000_000;
const TEXT_CONTENT_CACHE_LIMIT = 8;
const EMPTY_ANNOTATIONS: Annotation[] = [];
const TEXT_LAYER_SELECTING_CLASS = "selecting";
const WEBKIT_TEXT_LAYER_PAGE_WINDOW = 1;
const DEBUG_WEBKIT_TEXT_LAYER = false;
const PDF_SEARCH_EXACT_LIMIT = 120;
const PDF_SEARCH_FALLBACK_TRIGGER_THRESHOLD = 3;
const PDF_SEARCH_FALLBACK_LIMIT = 12;
const PDF_SEARCH_FALLBACK_PAGE_CHAR_LIMIT = 8_000;
const PDF_SEARCH_EXCERPT_CONTEXT_CHARS = 80;
const PDF_SEARCH_EXACT_SCAN_PROGRESS_WEIGHT = 0.9;

const activeTextLayers = new Map<HTMLDivElement, HTMLDivElement>();
const pageTextContentCache = new Map<number, PageTextContent>();
let textLayerSelectionAbortController: AbortController | null = null;

function getCanvasPixelRatio(
    cssWidth: number,
    cssHeight: number,
    preferSharpCanvas: boolean,
    currentScale: number,
): number {
    const deviceRatio = Math.max(1, window.devicePixelRatio || 1);
    // Reduce supersampling at high zoom levels to keep WebKit memory/render cost bounded.
    const sharpRatioTarget = currentScale <= 1.2
        ? WEBKIT_MIN_OUTPUT_SCALE
        : currentScale <= 1.8
            ? 1.75
            : currentScale <= 2.6
                ? 1.5
                : 1.25;
    const preferredRatio = preferSharpCanvas
        ? Math.max(deviceRatio, sharpRatioTarget)
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

function findScrollableAncestor(node: HTMLElement | null): HTMLElement | null {
    let current: HTMLElement | null = node;
    while (current) {
        const style = getComputedStyle(current);
        const overflowY = style.overflowY;
        if (
            (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
            current.scrollHeight > current.clientHeight + 1
        ) {
            return current;
        }
        current = current.parentElement;
    }
    const root = document.scrollingElement;
    return root instanceof HTMLElement ? root : null;
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
    let selectionFrameId = 0;
    let autoScrollRafId = 0;
    let autoScrollVelocity = 0;
    let autoScrollTarget: HTMLElement | null = null;

    const stopAutoScroll = () => {
        if (autoScrollRafId !== 0) {
            cancelAnimationFrame(autoScrollRafId);
            autoScrollRafId = 0;
        }
        autoScrollVelocity = 0;
        autoScrollTarget = null;
    };

    const runAutoScroll = () => {
        if (!pointerDown || !autoScrollTarget || autoScrollVelocity === 0) {
            stopAutoScroll();
            return;
        }
        autoScrollTarget.scrollTop += autoScrollVelocity;
        autoScrollRafId = requestAnimationFrame(runAutoScroll);
    };

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
            stopAutoScroll();
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
            stopAutoScroll();
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
        "pointercancel",
        () => {
            pointerDown = false;
            stopAutoScroll();
        },
        { signal },
    );

    document.addEventListener(
        "pointermove",
        (event) => {
            if (!pointerDown) {
                return;
            }

            const selection = document.getSelection();
            if (!selection || selection.rangeCount === 0) {
                return;
            }

            let sourceElement = event.target instanceof HTMLElement ? event.target : null;
            if (!sourceElement) {
                const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
                sourceElement = pointedElement instanceof HTMLElement ? pointedElement : null;
            }

            let layerNode = sourceElement?.closest<HTMLDivElement>(".textLayer") ?? null;
            if (!layerNode) {
                for (const candidate of activeTextLayers.keys()) {
                    if (candidate.classList.contains(TEXT_LAYER_SELECTING_CLASS)) {
                        layerNode = candidate;
                        break;
                    }
                }
            }
            if (!layerNode) {
                stopAutoScroll();
                return;
            }

            const scrollContainer = findScrollableAncestor(layerNode);
            if (!scrollContainer) {
                stopAutoScroll();
                return;
            }

            const rect = scrollContainer.getBoundingClientRect();
            const edgeThreshold = 52;
            let velocity = 0;

            if (event.clientY < rect.top + edgeThreshold) {
                const ratio = Math.min(1, (rect.top + edgeThreshold - event.clientY) / edgeThreshold);
                velocity = -Math.max(2, Math.round(24 * ratio));
            } else if (event.clientY > rect.bottom - edgeThreshold) {
                const ratio = Math.min(1, (event.clientY - (rect.bottom - edgeThreshold)) / edgeThreshold);
                velocity = Math.max(2, Math.round(24 * ratio));
            }

            if (velocity === 0) {
                stopAutoScroll();
                return;
            }

            autoScrollTarget = scrollContainer;
            autoScrollVelocity = velocity;
            if (autoScrollRafId === 0) {
                autoScrollRafId = requestAnimationFrame(runAutoScroll);
            }
        },
        {
            signal,
            passive: true,
        },
    );

    document.addEventListener(
        "selectionchange",
        () => {
            if (selectionFrameId !== 0) {
                return;
            }
            selectionFrameId = requestAnimationFrame(() => {
                selectionFrameId = 0;

                const selection = document.getSelection();
                if (!selection || selection.rangeCount === 0) {
                    // WebKit can transiently clear selection while dragging outside text glyph bounds.
                    if (pointerDown) {
                        return;
                    }
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

                if (selectedLayerNodes.size === 0) {
                    if (pointerDown) {
                        return;
                    }
                    activeTextLayers.forEach((endNode, layerNode) => {
                        resetTextLayerSelectionState(endNode, layerNode);
                    });
                    return;
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
            });
        },
        { signal },
    );

    signal.addEventListener(
        "abort",
        () => {
            if (selectionFrameId !== 0) {
                cancelAnimationFrame(selectionFrameId);
                selectionFrameId = 0;
            }
            stopAutoScroll();
        },
        { once: true },
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
type PageTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

interface PDFSearchPageItem {
    pageNumber: number;
    text: string;
}

function clearPageTextContentCache(): void {
    pageTextContentCache.clear();
}

function toSerializablePdfData(data: Uint8Array): Uint8Array {
    // Some WebKit builds are sensitive to non-zero offsets in typed arrays.
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
        return data;
    }
    return new Uint8Array(data);
}

async function getPageTextContent(page: PDFPageProxy): Promise<PageTextContent> {
    const pageNumber = page.pageNumber;
    const cachedTextContent = pageTextContentCache.get(pageNumber);
    if (cachedTextContent) {
        // Refresh insertion order to keep this page hot in the small LRU cache.
        pageTextContentCache.delete(pageNumber);
        pageTextContentCache.set(pageNumber, cachedTextContent);
        return cachedTextContent;
    }

    const textContent = await page.getTextContent({
        includeMarkedContent: true,
        disableNormalization: true,
    });
    pageTextContentCache.set(pageNumber, textContent);

    while (pageTextContentCache.size > TEXT_CONTENT_CACHE_LIMIT) {
        const oldestKey = pageTextContentCache.keys().next().value as number | undefined;
        if (oldestKey === undefined) {
            break;
        }
        pageTextContentCache.delete(oldestKey);
    }

    return textContent;
}

function getNormalizedPageText(textContent: PageTextContent): string {
    const textItems = textContent.items as unknown as TextItemLike[];
    const rawText = textItems
        .map((item) => (typeof item?.str === "string" ? item.str : ""))
        .join(" ");
    return rawText.replace(/\s+/g, " ").trim();
}

function getPdfSearchLocation(pageNumber: number): string {
    return `pdf:page:${pageNumber}`;
}

function createPdfSearchExcerpt(pageText: string, query: string, knownMatchIndex?: number): string {
    const normalizedText = pageText.replace(/\s+/g, " ").trim();
    if (!normalizedText) {
        return "";
    }

    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return normalizedText.slice(0, PDF_SEARCH_EXCERPT_CONTEXT_CHARS * 2);
    }

    const matchIndex = typeof knownMatchIndex === "number"
        ? knownMatchIndex
        : normalizedText.toLowerCase().indexOf(normalizedQuery.toLowerCase());

    if (matchIndex === -1) {
        return normalizedText.slice(0, PDF_SEARCH_EXCERPT_CONTEXT_CHARS * 2);
    }

    const excerptStart = Math.max(0, matchIndex - PDF_SEARCH_EXCERPT_CONTEXT_CHARS);
    const excerptEnd = Math.min(
        normalizedText.length,
        matchIndex + normalizedQuery.length + PDF_SEARCH_EXCERPT_CONTEXT_CHARS,
    );
    const needsLeadingEllipsis = excerptStart > 0;
    const needsTrailingEllipsis = excerptEnd < normalizedText.length;

    return `${needsLeadingEllipsis ? "…" : ""}${normalizedText.slice(excerptStart, excerptEnd)}${needsTrailingEllipsis ? "…" : ""}`;
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
        if (import.meta.env.DEV && DEBUG_WEBKIT_TEXT_LAYER) {
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
        if (import.meta.env.DEV && DEBUG_WEBKIT_TEXT_LAYER) {
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
        if (import.meta.env.DEV && DEBUG_WEBKIT_TEXT_LAYER) {
            console.debug("[PDF][TextLayer] WebKit font corrections skipped: below threshold", {
                sampledPairs,
                globalMedian,
            });
        }
        return;
    }

    if (import.meta.env.DEV && DEBUG_WEBKIT_TEXT_LAYER) {
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

interface PdfOutlineItemLike {
    title?: string | null;
    dest?: unknown;
    items?: PdfOutlineItemLike[] | null;
}

async function resolvePdfDestPageNumber(
    pdfDocument: PDFDocumentProxy,
    destination: unknown,
): Promise<number | null> {
    try {
        const explicitDestination = typeof destination === "string"
            ? await pdfDocument.getDestination(destination)
            : destination;
        if (!Array.isArray(explicitDestination) || explicitDestination.length === 0) {
            return null;
        }

        const destinationReference = explicitDestination[0];
        if (typeof destinationReference === "number") {
            return destinationReference + 1;
        }
        if (!destinationReference || typeof destinationReference !== "object") {
            return null;
        }

        const pageIndex = await pdfDocument.getPageIndex(destinationReference as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
        return pageIndex + 1;
    } catch {
        return null;
    }
}

function sanitizeTocLabel(label?: string | null, fallback?: string): string {
    const trimmed = (label || "").replace(/\s+/g, " ").trim();
    if (trimmed.length > 0) {
        return trimmed;
    }
    return fallback || "Section";
}

async function convertPdfOutlineItems(
    pdfDocument: PDFDocumentProxy,
    items: PdfOutlineItemLike[],
    depth: number,
    maxDepth: number,
): Promise<TocItem[]> {
    if (depth > maxDepth) {
        return [];
    }

    const converted = await Promise.all(items.map(async (item, index) => {
        const pageNumber = await resolvePdfDestPageNumber(pdfDocument, item.dest);
        const subitems = item.items && item.items.length > 0
            ? await convertPdfOutlineItems(pdfDocument, item.items, depth + 1, maxDepth)
            : undefined;

        const href = pageNumber
            ? `pdf:page:${pageNumber}`
            : subitems && subitems.length > 0
                ? subitems[0].href
                : "pdf:page:1";

        return {
            label: sanitizeTocLabel(item.title, `Section ${index + 1}`),
            href,
            subitems: subitems && subitems.length > 0 ? subitems : undefined,
        } satisfies TocItem;
    }));

    return converted;
}

async function buildPdfToc(
    pdfDocument: PDFDocumentProxy,
): Promise<{ tocItems: TocItem[]; hasOutline: boolean }> {
    try {
        const outline = await pdfDocument.getOutline();
        if (outline && outline.length > 0) {
            const convertedOutline = await convertPdfOutlineItems(
                pdfDocument,
                outline as unknown as PdfOutlineItemLike[],
                0,
                8,
            );
            if (convertedOutline.length > 0) {
                return {
                    tocItems: convertedOutline,
                    hasOutline: true,
                };
            }
        }
    } catch (error) {
        console.warn("[PDFJsEngine] Failed to build PDF outline TOC:", error);
    }
    return {
        tocItems: [],
        hasOutline: false,
    };
}


interface PageCanvasProps {
    page: PDFPageProxy;
    scale: number;
    rotation: number;
    onRenderComplete?: () => void;
    // Annotations
    annotations?: Annotation[];
    annotationMode?: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
    highlightColor: HighlightColor;
    penColor: HighlightColor;
    penWidth: number;
    enableTextLayer: boolean;
    preferSharpCanvas: boolean;
    snapCssToPixels: boolean;
    useStreamTextLayer: boolean;
    calibrateTextLayerWidths: boolean;
    onAnnotationAdd?: (annotation: Partial<Annotation>) => void;
    onAnnotationChange?: (annotation: Annotation) => void;
    onAnnotationRemove?: (id: string) => void;
}

const PageCanvas = memo(function PageCanvas({
    page,
    scale,
    rotation,
    onRenderComplete,
    annotations = [],
    annotationMode = "none",
    highlightColor,
    penColor,
    penWidth,
    enableTextLayer,
    preferSharpCanvas,
    snapCssToPixels,
    useStreamTextLayer,
    calibrateTextLayerWidths,
    onAnnotationAdd,
    onAnnotationChange,
    onAnnotationRemove,
}: PageCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
    const textLayerInstanceRef = useRef<TextLayer | null>(null);
    const lastCanvasRenderKeyRef = useRef<string>("");
    const hasRenderedCanvasRef = useRef(false);
    const [shouldRender, setShouldRender] = useState(page.pageNumber <= 3);
    const [isRendering, setIsRendering] = useState(page.pageNumber <= 3);
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
                    scale,
                );
                const sizing = getCanvasSizing(cssWidth, cssHeight, outputScale);
                const canvasRenderKey = [
                    page.pageNumber,
                    viewport.scale.toFixed(4),
                    rotation,
                    sizing.canvasWidth,
                    sizing.canvasHeight,
                ].join(":");
                const shouldRenderCanvas =
                    !hasRenderedCanvasRef.current || lastCanvasRenderKeyRef.current !== canvasRenderKey;

                if (shouldRenderCanvas) {
                    setIsRendering(true);
                }

                containerRef.current?.style.setProperty("--scale-factor", `${viewport.scale}`);
                containerRef.current?.style.setProperty("--scale-round-x", `${sizing.scaleRoundX}px`);
                containerRef.current?.style.setProperty("--scale-round-y", `${sizing.scaleRoundY}px`);
                canvas.style.width = `${cssWidth}px`;
                canvas.style.height = `${cssHeight}px`;

                if (shouldRenderCanvas) {
                    canvas.width = sizing.canvasWidth;
                    canvas.height = sizing.canvasHeight;

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
                    hasRenderedCanvasRef.current = true;
                    lastCanvasRenderKeyRef.current = canvasRenderKey;
                }

                if (enableTextLayer && textLayerDiv) {
                    unregisterTextLayer(textLayerDiv);
                    textLayerDiv.innerHTML = "";
                    textLayerDiv.tabIndex = 0;
                    if (textLayerDiv.dataset.textSelectionBound !== "1") {
                        textLayerDiv.addEventListener("pointerdown", () => {
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
                        let textContentSource: PageTextContent | ReturnType<PDFPageProxy["streamTextContent"]>;
                        if (useStreamTextLayer) {
                            textContentSource = page.streamTextContent({
                                includeMarkedContent: true,
                                disableNormalization: true,
                            });
                        } else {
                            const textContent = await getPageTextContent(page);
                            textContentSource = textContent;
                            textItemsForCalibration =
                                (textContentSource.items as unknown as TextItemLike[]) ?? null;
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
                        const isAbortError = textError instanceof Error
                            && (
                                textError.name === "AbortException"
                                || textError.message.toLowerCase().includes("abort")
                                || textError.message.toLowerCase().includes("cancel")
                            );
                        if (!isAbortError) {
                            console.warn("[PageCanvas] Text layer error:", textError);
                        }
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
                if (!cancelled) {
                    setIsRendering(false);
                }
            }
        };

        renderPage();

        return () => {
            cancelled = true;
            setIsRendering(false);
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
                    highlightColor={highlightColor}
                    penColor={penColor}
                    penWidth={penWidth}
                    onAnnotationAdd={(ann) => onAnnotationAdd?.(ann)}
                    onAnnotationChange={(annotation) => onAnnotationChange?.(annotation)}
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
        onViewportTap,
        className,
        annotations = [],
        annotationMode = 'none',
        highlightColor = "yellow",
        penColor = "blue",
        penWidth = 2,
        onAnnotationAdd,
        onAnnotationChange,
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
        const currentPageRef = useRef(initialPage);
        const totalPagesRef = useRef(0);
        const scaleRef = useRef(DEFAULT_SCALE);
        const searchSessionRef = useRef(0);
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

        useEffect(() => {
            currentPageRef.current = currentPage;
        }, [currentPage]);

        useEffect(() => {
            totalPagesRef.current = totalPages;
        }, [totalPages]);

        useEffect(() => {
            scaleRef.current = scale;
        }, [scale]);

        const applyZoom = useCallback((requestedScale: number): number => {
            const clampedScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, requestedScale));
            if (Math.abs(clampedScale - scaleRef.current) < 0.0001) {
                return scaleRef.current;
            }
            scaleRef.current = clampedScale;
            setScale(clampedScale);
            callbacksRef.current.onPageChange?.(
                currentPageRef.current,
                totalPagesRef.current,
                clampedScale,
            );
            return clampedScale;
        }, []);

        const clearSearch = useCallback(() => {
            searchSessionRef.current += 1;
        }, []);

        const search = useCallback(
            async function* (
                query: string,
            ): AsyncGenerator<SearchResult | { progress: number } | "done"> {
                const normalizedQuery = query.trim();
                if (!normalizedQuery) {
                    yield "done";
                    return;
                }

                const activePdfDocument = pdfDocument;
                if (!activePdfDocument) {
                    yield "done";
                    return;
                }

                searchSessionRef.current += 1;
                const sessionId = searchSessionRef.current;
                const normalizedQueryLower = normalizedQuery.toLowerCase();
                const yieldedLocations = new Set<string>();
                const searchablePages: PDFSearchPageItem[] = [];
                let exactMatchCount = 0;
                const totalPageCount = Math.max(1, activePdfDocument.numPages);

                for (let pageNumber = 1; pageNumber <= totalPageCount; pageNumber++) {
                    if (searchSessionRef.current !== sessionId) {
                        return;
                    }

                    let pageText = "";
                    try {
                        const page = await activePdfDocument.getPage(pageNumber);
                        const pageTextContent = await getPageTextContent(page);
                        pageText = getNormalizedPageText(pageTextContent);
                    } catch (error) {
                        console.warn("[PDFJsEngine] Failed to read page text for search:", pageNumber, error);
                    }

                    if (pageText) {
                        const boundedPageText = pageText.slice(0, PDF_SEARCH_FALLBACK_PAGE_CHAR_LIMIT);
                        searchablePages.push({
                            pageNumber,
                            text: boundedPageText,
                        });

                        const matchIndex = pageText.toLowerCase().indexOf(normalizedQueryLower);
                        if (matchIndex !== -1) {
                            const location = getPdfSearchLocation(pageNumber);
                            if (!yieldedLocations.has(location)) {
                                yieldedLocations.add(location);
                                exactMatchCount += 1;
                                yield {
                                    cfi: location,
                                    excerpt: createPdfSearchExcerpt(pageText, normalizedQuery, matchIndex),
                                };
                            }
                        }
                    }

                    yield {
                        progress: (pageNumber / totalPageCount) * PDF_SEARCH_EXACT_SCAN_PROGRESS_WEIGHT,
                    };

                    if (exactMatchCount >= PDF_SEARCH_EXACT_LIMIT) {
                        break;
                    }
                }

                if (searchSessionRef.current !== sessionId) {
                    return;
                }

                if (exactMatchCount < PDF_SEARCH_FALLBACK_TRIGGER_THRESHOLD && searchablePages.length > 0) {
                    const fuzzyResults = rankByFuzzyQuery(searchablePages, normalizedQuery, {
                        keys: [{ name: "text", weight: 1 }],
                        limit: PDF_SEARCH_FALLBACK_LIMIT,
                    });
                    const fallbackResultCount = Math.max(1, fuzzyResults.length);
                    let fallbackResultIndex = 0;

                    for (const { item } of fuzzyResults) {
                        if (searchSessionRef.current !== sessionId) {
                            return;
                        }

                        fallbackResultIndex += 1;
                        const location = getPdfSearchLocation(item.pageNumber);
                        if (!yieldedLocations.has(location)) {
                            yieldedLocations.add(location);
                            yield {
                                cfi: location,
                                excerpt: createPdfSearchExcerpt(item.text, normalizedQuery),
                            };
                        }

                        yield {
                            progress: PDF_SEARCH_EXACT_SCAN_PROGRESS_WEIGHT
                                + ((fallbackResultIndex / fallbackResultCount)
                                    * (1 - PDF_SEARCH_EXACT_SCAN_PROGRESS_WEIGHT)),
                        };
                    }
                }

                if (searchSessionRef.current !== sessionId) {
                    return;
                }

                yield "done";
            },
            [pdfDocument],
        );

        const handleViewportClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
            if (!onViewportTap || isLoading || !!error || annotationMode !== "none") {
                return;
            }
            if (event.defaultPrevented || event.button !== 0) {
                return;
            }

            const target = event.target as Element | null;
            if (
                target?.closest(
                    'a,button,input,textarea,select,label,[role="button"],[contenteditable="true"],[data-no-viewport-tap]',
                )
            ) {
                return;
            }

            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
                return;
            }

            onViewportTap();
        }, [annotationMode, error, isLoading, onViewportTap]);

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
            let loadedPdf: PDFDocumentProxy | null = null;

            const loadPdf = async () => {
                const isVirtualPath = pdfPath.startsWith("idb://") || pdfPath.startsWith("browser://");
                const requiresProvidedData = !isTauri() || isVirtualPath || !pdfPath;

                // Wait for in-memory bytes when direct filesystem loading is not possible.
                // This prevents Tauri from attempting to read virtual idb:// paths.
                if (requiresProvidedData && !pdfData) {
                    // Keep loading state, data will arrive via props update
                    return;
                }

                try {
                    setIsLoading(true);
                    setError(null);
                    setPages([]);
                    clearPageTextContentCache();
                    searchSessionRef.current += 1;
                    hasAppliedInitialFitRef.current = false;

                    // Get PDF data
                    let data: Uint8Array;
                    if (pdfData) {
                        // Use provided data (works in both browser and Tauri)
                        data = pdfData;
                    } else if (isTauri() && pdfPath && !isVirtualPath) {
                        // Read via Tauri
                        data = await invoke<Uint8Array>("read_pdf_file", { path: pdfPath });
                    } else {
                        // Should not reach here due to early return above.
                        throw new Error("PDF data not provided. Please ensure the book is properly loaded.");
                    }

                    if (cancelled) return;

                    // Load document
                    // Fix: Ensure data is a "clean" Uint8Array to avoid DataCloneError in some WebKit environments
                    // By using subarray(0) or new Uint8Array(data) we ensure it's a serializable object
                    const loadingTask = pdfjsLib.getDocument({
                        data: toSerializablePdfData(data),
                        cMapUrl: "/pdfjs/cmaps/",
                        cMapPacked: true,
                        standardFontDataUrl: "/pdfjs/standard_fonts/",
                        isEvalSupported: false, // Security: disable eval
                    });

                    const pdf = await loadingTask.promise;
                    loadedPdf = pdf;

                    if (cancelled) {
                        pdf.destroy();
                        return;
                    }

                    setPdfDocument(pdf);

                    // Get metadata
                    const [metadata, { tocItems, hasOutline }] = await Promise.all([
                        pdf.getMetadata(),
                        buildPdfToc(pdf),
                    ]);
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
                        hasOutline,
                        toc: tocItems,
                    };

                    const clampedInitialPage = Math.max(1, Math.min(initialPage, info.totalPages || 1));
                    // Keep refs/state in sync before first callback so parent never receives 0 total pages.
                    currentPageRef.current = clampedInitialPage;
                    totalPagesRef.current = info.totalPages;
                    scaleRef.current = DEFAULT_SCALE;
                    setCurrentPage(clampedInitialPage);
                    setTotalPages(info.totalPages);
                    setScale(DEFAULT_SCALE);

                    // Pre-load first few pages
                    const pagesToLoad = Math.min(INITIAL_PAGE_LOAD_SIZE, pdf.numPages);
                    const initialPages = await Promise.all(
                        Array.from({ length: pagesToLoad }, (_, pageIndex) => pdf.getPage(pageIndex + 1)),
                    );

                    if (!cancelled) {
                        setPages(initialPages);
                        setIsLoading(false);
                        callbacksRef.current.onLoad?.(info);
                        // Also call onPageChange with initial page to update parent state
                        callbacksRef.current.onPageChange?.(clampedInitialPage, info.totalPages, DEFAULT_SCALE);
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
                setPages((existingPages) => {
                    existingPages.forEach((page) => page.cleanup());
                    return [];
                });
                loadedPdf?.destroy();
                setPdfDocument(null);
                clearPageTextContentCache();
                searchSessionRef.current += 1;
            };
            // Only reload when pdfPath, pdfData, or initialPage changes
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [pdfPath, pdfData, initialPage, originalFilename]);

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
                applyZoom(nextScale);
                if (totalPagesRef.current > 0) {
                    callbacksRef.current.onPageChange?.(
                        currentPageRef.current,
                        totalPagesRef.current,
                        nextScale,
                    );
                }
            });

            return () => {
                cancelAnimationFrame(rafId);
            };
        }, [pages, applyZoom]);

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
            let zoomRafId: number | null = null;
            let pendingWheelDelta = 0;

            const handleScroll = () => {
                if (rafId !== null) {
                    return;
                }

                rafId = window.requestAnimationFrame(() => {
                    rafId = null;
                    const centerY = container.scrollTop + (container.clientHeight / 2);
                    let newPage = currentPageRef.current;
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

                    const totalPageCount = totalPagesRef.current;
                    if (newPage !== currentPageRef.current && newPage >= 1 && newPage <= totalPageCount) {
                        currentPageRef.current = newPage;
                        setCurrentPage(newPage);
                        callbacksRef.current.onPageChange?.(newPage, totalPageCount, scaleRef.current);
                    }
                });
            };

            const flushWheelZoom = () => {
                zoomRafId = null;
                if (pendingWheelDelta === 0) {
                    return;
                }
                const nextScale = Math.max(
                    MIN_ZOOM,
                    Math.min(MAX_ZOOM, scaleRef.current + pendingWheelDelta),
                );
                pendingWheelDelta = 0;
                applyZoom(nextScale);
            };

            const handleWheel = (e: WheelEvent) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                    pendingWheelDelta += delta;
                    const maxStepPerFrame = ZOOM_STEP * 3;
                    if (pendingWheelDelta > maxStepPerFrame) {
                        pendingWheelDelta = maxStepPerFrame;
                    } else if (pendingWheelDelta < -maxStepPerFrame) {
                        pendingWheelDelta = -maxStepPerFrame;
                    }
                    if (zoomRafId === null) {
                        zoomRafId = window.requestAnimationFrame(flushWheelZoom);
                    }
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
                if (zoomRafId !== null) {
                    cancelAnimationFrame(zoomRafId);
                }
            };
        }, [pages.length, applyZoom]);

        const scrollToPage = useCallback((targetPage: number, behavior: ScrollBehavior = "smooth") => {
            const container = containerRef.current;
            if (!container) {
                return;
            }

            const pageNode = container.querySelector<HTMLElement>(
                `.pdf-page-wrapper[data-page-number="${targetPage}"]`,
            );
            if (pageNode) {
                container.scrollTo({
                    top: Math.max(0, pageNode.offsetTop - 8),
                    behavior,
                });
                return;
            }

            // Fallback while additional pages are still being loaded.
            const approximatePageHeight = container.scrollHeight / Math.max(1, pages.length);
            container.scrollTo({
                top: Math.max(0, (targetPage - 1) * approximatePageHeight),
                behavior,
            });
        }, [pages.length]);

        // Expose imperative methods
        useImperativeHandle(ref, () => ({
            goToPage: (page: number) => {
                if (page >= 1 && page <= totalPages) {
                    scrollToPage(page);
                }
            },
            nextPage: () => {
                if (currentPage < totalPages) {
                    scrollToPage(currentPage + 1);
                }
            },
            prevPage: () => {
                if (currentPage > 1) {
                    scrollToPage(currentPage - 1);
                }
            },
            zoomIn: () => {
                applyZoom(scaleRef.current + ZOOM_STEP);
            },
            zoomOut: () => {
                applyZoom(scaleRef.current - ZOOM_STEP);
            },
            zoomReset: () => {
                applyZoom(DEFAULT_SCALE);
            },
            setZoom: (newScale: number) => {
                applyZoom(newScale);
            },
            getZoom: () => scaleRef.current,
            getCurrentPage: () => currentPageRef.current,
            getTotalPages: () => totalPagesRef.current,
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
                const viewportPadding = container.clientWidth < 768 ? 12 : 32;
                const containerH = container.clientHeight - viewportPadding;
                const containerW = container.clientWidth - viewportPadding;
                const fitScale = Math.min(containerW / viewport.width, containerH / viewport.height);
                const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale));
                applyZoom(newScale);
            },
            zoomFitWidth: () => {
                if (!containerRef.current || pages.length === 0) return;
                const container = containerRef.current;
                const firstPage = pages[0];
                const viewport = firstPage.getViewport({ scale: PDF_TO_CSS_UNITS });
                const viewportPadding = container.clientWidth < 768 ? 12 : 32;
                const containerW = container.clientWidth - viewportPadding;
                const fitScale = containerW / viewport.width;
                const newScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitScale));
                applyZoom(newScale);
            },
            search: (query: string) => search(query),
            clearSearch: () => clearSearch(),
        }), [applyZoom, clearSearch, currentPage, pages.length, scrollToPage, search, totalPages]);

        const displayError = error?.replace(/\s+/g, " ").trim();

        return (
            <div className={cn("relative w-full h-full", className)}>
                {/* Loading State */}
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)]">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-accent)]"></div>
                        <p className="mt-4 text-[color:var(--color-text-secondary)]">Loading PDF...</p>
                    </div>
                )}

                {/* Error State */}
                {displayError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)] p-8">
                        <div className="text-[color:var(--color-error)] text-4xl mb-4">⚠️</div>
                        <h3 className="ui-empty-state-title text-lg font-semibold text-[color:var(--color-text-primary)] mb-2">
                            Failed to load PDF
                        </h3>
                        <p className="ui-empty-state-copy text-[color:var(--color-text-secondary)] text-center leading-relaxed">
                            {displayError}
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
                    onClick={handleViewportClick}
                >
                    <div
                        className="pdf-zoom-container flex flex-col items-center justify-start min-h-full py-2 sm:py-4 space-y-2 sm:space-y-4 px-1 sm:px-0 mx-auto"
                    >
                        {pages.map((page) => {
                            const pageTextLayerEnabled = enableTextLayer && (
                                isDesktopWebKit
                                    ? Math.abs(page.pageNumber - currentPage) <= WEBKIT_TEXT_LAYER_PAGE_WINDOW
                                    : Math.abs(page.pageNumber - currentPage) <= 1
                            );
                            const pageUseStreamTextLayer = isDesktopWebKit
                                ? page.pageNumber !== currentPage
                                : useStreamTextLayer;

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
                                        preferSharpCanvas={isDesktopWebKit}
                                        snapCssToPixels={isDesktopWebKit}
                                        useStreamTextLayer={pageUseStreamTextLayer}
                                        calibrateTextLayerWidths={isDesktopWebKit && page.pageNumber === currentPage}
                                        annotations={annotationsByPage.get(page.pageNumber) ?? EMPTY_ANNOTATIONS}
                                        annotationMode={annotationMode}
                                        highlightColor={highlightColor}
                                        penColor={penColor}
                                        penWidth={penWidth}
                                        onAnnotationAdd={onAnnotationAdd}
                                        onAnnotationChange={onAnnotationChange}
                                        onAnnotationRemove={onAnnotationRemove}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                {!isLoading && !error && totalPages > 0 && (
                    <div className="absolute bottom-2 right-2 sm:bottom-4 sm:right-4 z-50 pointer-events-none px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full bg-[var(--color-surface)] border border-[var(--color-border)] text-xs sm:text-sm text-[color:var(--color-text-secondary)] shadow-sm">
                        Page {currentPage} of {totalPages} | {Math.round(scale * 100)}%
                    </div>
                )}
            </div>
        );
    }
);

export default PDFJsEngine;
