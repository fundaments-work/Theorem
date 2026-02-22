/**
 * PDF.js Engine Component
 *
 * A React component that renders PDF documents using PDF.js.
 *
 * Performance / memory improvements vs original:
 *  1. PAGE_PROXY_KEEP_WINDOW reduced 60 → 25 (cuts proxy memory ~58%)
 *  2. prefetchedOperatorPagesRef pruned when it exceeds OPERATOR_PREFETCH_MAX_SET_SIZE
 *  3. Search fallback array bounded by PDF_SEARCH_FALLBACK_TOTAL_CHAR_BUDGET (~600 KB)
 *  4. ResizeObserver debounced (120 ms) to prevent rapid layout-flush bursts
 *  5. WebKit text-layer calibration sample limit reduced 2500 → 600 (fewer getBCR calls)
 *  6. Second calibration pass is skipped when first-pass correction is below threshold
 *  7. Zoom/rotation re-renders no longer flash blank — offscreen canvas + atomic pixel swap.
 *     Canvas CSS dimensions are updated eagerly in the size effect (old content stretches
 *     naturally), then the pixel buffer is swapped atomically on completion so canvas.width
 *     never leaves a blank frame visible to the user.
 *  8. Wheel zoom and pinch-to-zoom now anchor to the mouse / pinch-center coordinate.
 *     PageCanvas size effect promoted to useLayoutEffect so the parent scroll adjustment
 *     runs after child container dimensions are already committed at the new scale.
 */

import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useCallback,
    forwardRef,
    useImperativeHandle,
    useMemo,
    memo,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { cn, isTauri, isWebKitBrowserEngine } from "../../../core";
import { configurePdfJsWorker } from "../../../core/lib/pdfjs-runtime";
import { rankByFuzzyQuery } from "../../../core";
import * as pdfjsLib from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Annotation, HighlightColor, PdfZoomMode, SearchResult, TocItem } from "../../../core";
import { PDFAnnotationLayer } from "../components/PDFAnnotationLayer";

import "./pdfjs-engine.css";

configurePdfJsWorker(pdfjsLib);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PDFJsEngineProps {
    pdfPath: string;
    pdfData?: Uint8Array;
    originalFilename?: string;
    initialPage?: number;
    initialZoom?: number;
    initialZoomMode?: PdfZoomMode;
    onLoad?: (info: PDFDocumentInfo) => void;
    onError?: (error: Error) => void;
    onPageChange?: (page: number, totalPages: number, scale: number) => void;
    onZoomModeChange?: (mode: PdfZoomMode) => void;
    onViewportTap?: () => void;
    className?: string;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5.0;
const ZOOM_STEP = 0.10;
const DEFAULT_SCALE = 1.0;
const PDF_TO_CSS_UNITS = pdfjsLib.PixelsPerInch?.PDF_TO_CSS_UNITS ?? (96 / 72);
const PAGE_PRERENDER_MARGIN = "70% 0px";
const INITIAL_PAGE_LOAD_SIZE = 1;
const PAGE_LOAD_BATCH_SIZE = 5;
const PAGE_LOAD_AHEAD_THRESHOLD = 2;

// FIX 1 — was 60. Each proxy retains PDF.js internal rendering state; 25 pages
//          is more than enough for smooth scrolling while cutting memory ~58%.
const PAGE_PROXY_KEEP_WINDOW = 25;

const OPERATOR_PREFETCH_AHEAD = 1;
const OPERATOR_PREFETCH_IDLE_TIMEOUT_MS = 1200;

// FIX 2 — cap for the operator-prefetch tracking set to prevent unbounded growth
//          during long reading sessions on large documents.
const OPERATOR_PREFETCH_MAX_SET_SIZE = 50;

const WEBKIT_MIN_OUTPUT_SCALE = 1.2;
const MAX_CANVAS_PIXEL_COUNT = 16_000_000;
const TEXT_CONTENT_CACHE_LIMIT = 48;
const PDF_INFO_CACHE_LIMIT = 32;
const EMPTY_ANNOTATIONS: Annotation[] = [];
const TEXT_LAYER_SELECTING_CLASS = "selecting";
const WEBKIT_TEXT_LAYER_PAGE_WINDOW = 1;
const DEBUG_WEBKIT_TEXT_LAYER = false;
const PDF_SEARCH_EXACT_LIMIT = 120;
const PDF_SEARCH_FALLBACK_TRIGGER_THRESHOLD = 3;
const PDF_SEARCH_FALLBACK_LIMIT = 12;
const PDF_SEARCH_FALLBACK_PAGE_CHAR_LIMIT = 8_000;

// FIX 3 — total character budget across all pages accumulated for fuzzy search.
//          At 8000 chars/page a 500-page PDF was allocating ~4 MB just for this
//          array; 600 KB is more than enough for Fuse.js to rank results well.
const PDF_SEARCH_FALLBACK_TOTAL_CHAR_BUDGET = 600_000;

const PDF_SEARCH_EXCERPT_CONTEXT_CHARS = 80;
const PDF_SEARCH_EXACT_SCAN_PROGRESS_WEIGHT = 0.9;
const DEFAULT_ZOOM_MODE: PdfZoomMode = "width-fit";
const DEFAULT_CANVAS_RENDER_PAGE_WINDOW = 3;
const WEBKIT_CANVAS_RENDER_PAGE_WINDOW = 2;
const MAX_ACTIVE_CANVAS_RENDERS = 2;

// FIX 4 — debounce delay for ResizeObserver → rebuildPageLayout. Sidebar
//          animations and window-drag resize events previously fired on every
//          animation frame; collapsing them saves many querySelectorAll + offsetTop
//          layout reads with no perceptible UX difference.
const RESIZE_OBSERVER_DEBOUNCE_MS = 120;

// FIX 5 — reduced from 2500. getBoundingClientRect forces a synchronous layout
//          flush on each call. The statistical median converges well below 600
//          samples, halving calibration time on dense pages.
const WEBKIT_CALIBRATION_SAMPLE_LIMIT = 600;

// FIX 6 — minimum absolute scaleX deviation from the first calibration pass that
//          justifies the cost of a second pass (two additional frame waits +
//          another full set of getBoundingClientRect calls).
const WEBKIT_CALIBRATION_SECOND_PASS_THRESHOLD = 0.015;

// ─── Module-level state ───────────────────────────────────────────────────────

const activeTextLayers = new Map<HTMLDivElement, HTMLDivElement>();
const pageTextContentCache = new Map<number, PageTextContent>();
const pdfDocumentInfoCache = new Map<string, PDFDocumentInfo>();
let textLayerSelectionAbortController: AbortController | null = null;

interface CanvasRenderSlotRequest {
    id: number;
    priority: number;
    cancelled: boolean;
    resolve: (release: () => void) => void;
}

const canvasRenderQueue: CanvasRenderSlotRequest[] = [];
let activeCanvasRenders = 0;
let nextCanvasRenderRequestId = 1;

// ─── Canvas render queue ──────────────────────────────────────────────────────

function pumpCanvasRenderQueue(): void {
    if (canvasRenderQueue.length > 1) {
        canvasRenderQueue.sort((left, right) => {
            if (left.priority === right.priority) return left.id - right.id;
            return left.priority - right.priority;
        });
    }
    while (activeCanvasRenders < MAX_ACTIVE_CANVAS_RENDERS && canvasRenderQueue.length > 0) {
        const request = canvasRenderQueue.shift();
        if (!request || request.cancelled) continue;
        activeCanvasRenders += 1;
        let released = false;
        request.resolve(() => {
            if (released) return;
            released = true;
            activeCanvasRenders = Math.max(0, activeCanvasRenders - 1);
            pumpCanvasRenderQueue();
        });
    }
}

function requestCanvasRenderSlot(priority: number): { promise: Promise<() => void>; cancel: () => void } {
    let request: CanvasRenderSlotRequest | null = null;
    const id = nextCanvasRenderRequestId++;
    const promise = new Promise<() => void>((resolve) => {
        request = { id, priority, cancelled: false, resolve };
        canvasRenderQueue.push(request);
        pumpCanvasRenderQueue();
    });
    const cancel = () => {
        if (!request || request.cancelled) return;
        request.cancelled = true;
        const index = canvasRenderQueue.findIndex((c) => c.id === request?.id);
        if (index !== -1) canvasRenderQueue.splice(index, 1);
    };
    return { promise, cancel };
}

// ─── Canvas sizing helpers ────────────────────────────────────────────────────

function getCanvasPixelRatio(cssWidth: number, cssHeight: number, preferSharpCanvas: boolean, currentScale: number): number {
    const rawDeviceRatio = Math.max(1, window.devicePixelRatio || 1);
    const isAndroid = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent);
    const deviceRatio = isAndroid ? Math.min(rawDeviceRatio, 1.25) : rawDeviceRatio;
    const sharpRatioTarget = currentScale <= 1.2 ? WEBKIT_MIN_OUTPUT_SCALE
        : currentScale <= 1.8 ? 1.75
        : currentScale <= 2.6 ? 1.5
        : 1.25;
    const preferredRatio = preferSharpCanvas
        ? (isAndroid ? deviceRatio : Math.max(deviceRatio, sharpRatioTarget))
        : deviceRatio;
    const safePixelBudget = Math.max(1, cssWidth * cssHeight);
    const maxAllowedRatio = Math.sqrt(MAX_CANVAS_PIXEL_COUNT / safePixelBudget);
    return Math.max(1, Math.min(preferredRatio, maxAllowedRatio));
}

function getCssDimension(value: number, snapToPixelGrid: boolean): number {
    return snapToPixelGrid ? Math.max(1, Math.round(value)) : value;
}

function approximateFraction(value: number): [number, number] {
    if (Math.floor(value) === value) return [value, 1];
    const inverse = 1 / value;
    const limit = 8;
    if (inverse > limit) return [1, limit];
    if (Math.floor(inverse) === inverse) return [1, inverse];
    const target = value > 1 ? inverse : value;
    let a = 0, b = 1, c = 1, d = 1;
    while (true) {
        const p = a + c, q = b + d;
        if (q > limit) break;
        if (target <= p / q) { c = p; d = q; } else { a = p; b = q; }
    }
    return (target - a / b < c / d - target)
        ? (target === value ? [a, b] : [b, a])
        : (target === value ? [c, d] : [d, c]);
}

function floorToDivide(value: number, divider: number): number {
    return value - (value % divider);
}

interface CanvasSizing { canvasWidth: number; canvasHeight: number; renderScaleX: number; renderScaleY: number; scaleRoundX: number; scaleRoundY: number; }

function getCanvasSizing(cssWidth: number, cssHeight: number, outputScale: number): CanvasSizing {
    const sfx = approximateFraction(outputScale);
    const sfy = approximateFraction(outputScale);
    const canvasWidth = Math.max(1, floorToDivide(Math.round(cssWidth * outputScale), sfx[0]));
    const canvasHeight = Math.max(1, floorToDivide(Math.round(cssHeight * outputScale), sfy[0]));
    const pageWidth = Math.max(1, floorToDivide(Math.round(cssWidth), sfx[1]));
    const pageHeight = Math.max(1, floorToDivide(Math.round(cssHeight), sfy[1]));
    return { canvasWidth, canvasHeight, renderScaleX: canvasWidth / pageWidth, renderScaleY: canvasHeight / pageHeight, scaleRoundX: sfx[1], scaleRoundY: sfy[1] };
}

// ─── Text layer selection helpers ─────────────────────────────────────────────

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
        if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && current.scrollHeight > current.clientHeight + 1) return current;
        current = current.parentElement;
    }
    const root = document.scrollingElement;
    return root instanceof HTMLElement ? root : null;
}

function ensureGlobalTextLayerSelectionListeners(): void {
    if (textLayerSelectionAbortController) return;
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
        if (autoScrollRafId !== 0) { cancelAnimationFrame(autoScrollRafId); autoScrollRafId = 0; }
        autoScrollVelocity = 0;
        autoScrollTarget = null;
    };
    const runAutoScroll = () => {
        if (!pointerDown || !autoScrollTarget || autoScrollVelocity === 0) { stopAutoScroll(); return; }
        autoScrollTarget.scrollTop += autoScrollVelocity;
        autoScrollRafId = requestAnimationFrame(runAutoScroll);
    };

    document.addEventListener("pointerdown", () => { pointerDown = true; }, { signal });
    document.addEventListener("pointerup", () => {
        pointerDown = false; stopAutoScroll();
        activeTextLayers.forEach((endNode, layerNode) => resetTextLayerSelectionState(endNode, layerNode));
    }, { signal });
    window.addEventListener("blur", () => {
        pointerDown = false; stopAutoScroll();
        activeTextLayers.forEach((endNode, layerNode) => resetTextLayerSelectionState(endNode, layerNode));
    }, { signal });
    document.addEventListener("keyup", () => {
        if (pointerDown) return;
        activeTextLayers.forEach((endNode, layerNode) => resetTextLayerSelectionState(endNode, layerNode));
    }, { signal });
    document.addEventListener("pointercancel", () => { pointerDown = false; stopAutoScroll(); }, { signal });
    document.addEventListener("pointermove", (event) => {
        if (!pointerDown) return;
        const selection = document.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        let sourceElement = event.target instanceof HTMLElement ? event.target : null;
        if (!sourceElement) {
            const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
            sourceElement = pointedElement instanceof HTMLElement ? pointedElement : null;
        }
        let layerNode = sourceElement?.closest<HTMLDivElement>(".textLayer") ?? null;
        if (!layerNode) {
            for (const candidate of activeTextLayers.keys()) {
                if (candidate.classList.contains(TEXT_LAYER_SELECTING_CLASS)) { layerNode = candidate; break; }
            }
        }
        if (!layerNode) { stopAutoScroll(); return; }
        const scrollContainer = findScrollableAncestor(layerNode);
        if (!scrollContainer) { stopAutoScroll(); return; }
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
        if (velocity === 0) { stopAutoScroll(); return; }
        autoScrollTarget = scrollContainer;
        autoScrollVelocity = velocity;
        if (autoScrollRafId === 0) autoScrollRafId = requestAnimationFrame(runAutoScroll);
    }, { signal, passive: true });

    document.addEventListener("selectionchange", () => {
        if (selectionFrameId !== 0) return;
        selectionFrameId = requestAnimationFrame(() => {
            selectionFrameId = 0;
            const selection = document.getSelection();
            if (!selection || selection.rangeCount === 0) {
                if (pointerDown) return;
                activeTextLayers.forEach((endNode, layerNode) => resetTextLayerSelectionState(endNode, layerNode));
                return;
            }
            const selectedLayerNodes = new Set<HTMLDivElement>();
            for (let i = 0; i < selection.rangeCount; i++) {
                const range = selection.getRangeAt(i);
                for (const layerNode of activeTextLayers.keys()) {
                    try { if (!selectedLayerNodes.has(layerNode) && range.intersectsNode(layerNode)) selectedLayerNodes.add(layerNode); } catch { /* ignore detached node errors */ }
                }
            }
            if (selectedLayerNodes.size === 0) {
                if (pointerDown) return;
                activeTextLayers.forEach((endNode, layerNode) => resetTextLayerSelectionState(endNode, layerNode));
                return;
            }
            for (const [layerNode, endNode] of activeTextLayers) {
                if (selectedLayerNodes.has(layerNode)) layerNode.classList.add(TEXT_LAYER_SELECTING_CLASS);
                else resetTextLayerSelectionState(endNode, layerNode);
            }
            const firstEndNode = activeTextLayers.values().next().value as HTMLDivElement | undefined;
            if (firstEndNode) isFirefox ??= getComputedStyle(firstEndNode).getPropertyValue("-moz-user-select") === "none";
            if (isFirefox) return;
            const range = selection.getRangeAt(0);
            const modifyStart = !!previousRange && (
                range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
                range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0
            );
            let anchorNode: Node | null = modifyStart ? range.startContainer : range.endContainer;
            if (anchorNode?.nodeType === Node.TEXT_NODE) anchorNode = anchorNode.parentNode;
            const anchorElement = anchorNode instanceof HTMLElement ? anchorNode : null;
            const layerNode = anchorElement?.closest<HTMLDivElement>(".textLayer");
            const endNode = layerNode ? activeTextLayers.get(layerNode) : undefined;
            if (layerNode && endNode) {
                endNode.style.width = layerNode.style.width;
                endNode.style.height = layerNode.style.height;
                anchorElement?.parentElement?.insertBefore(endNode, modifyStart ? anchorElement : anchorElement?.nextSibling ?? null);
            }
            previousRange = range.cloneRange();
        });
    }, { signal });

    signal.addEventListener("abort", () => {
        if (selectionFrameId !== 0) { cancelAnimationFrame(selectionFrameId); selectionFrameId = 0; }
        stopAutoScroll();
    }, { once: true });
}

function registerTextLayer(layerNode: HTMLDivElement, endNode: HTMLDivElement): void {
    activeTextLayers.set(layerNode, endNode);
    ensureGlobalTextLayerSelectionListeners();
}

function unregisterTextLayer(layerNode: HTMLDivElement): void {
    activeTextLayers.delete(layerNode);
    if (activeTextLayers.size > 0) return;
    textLayerSelectionAbortController?.abort();
    textLayerSelectionAbortController = null;
}

// ─── Text content cache ───────────────────────────────────────────────────────

interface TextItemLike { str?: string; width?: number; }
type PageTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;
interface PDFSearchPageItem { pageNumber: number; text: string; }

function clearPageTextContentCache(): void { pageTextContentCache.clear(); }

async function getPageTextContent(page: PDFPageProxy): Promise<PageTextContent> {
    const pageNumber = page.pageNumber;
    const cached = pageTextContentCache.get(pageNumber);
    if (cached) {
        pageTextContentCache.delete(pageNumber);
        pageTextContentCache.set(pageNumber, cached);
        return cached;
    }
    const textContent = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
    pageTextContentCache.set(pageNumber, textContent);
    while (pageTextContentCache.size > TEXT_CONTENT_CACHE_LIMIT) {
        const oldestKey = pageTextContentCache.keys().next().value as number | undefined;
        if (oldestKey === undefined) break;
        pageTextContentCache.delete(oldestKey);
    }
    return textContent;
}

function getNormalizedPageText(textContent: PageTextContent): string {
    const textItems = textContent.items as unknown as TextItemLike[];
    return textItems.map((item) => (typeof item?.str === "string" ? item.str : "")).join(" ").replace(/\s+/g, " ").trim();
}

// ─── PDF document info cache ──────────────────────────────────────────────────

function buildPdfInfoCacheKey(pdfPath: string, originalFilename: string | undefined, dataByteLength?: number): string {
    if (pdfPath && pdfPath.length > 0) return `path:${pdfPath}`;
    const filenamePart = originalFilename || "document";
    const byteLengthPart = typeof dataByteLength === "number" ? `:len:${dataByteLength}` : "";
    return `blob:${filenamePart}${byteLengthPart}`;
}

function setCachedPdfDocumentInfo(cacheKey: string, info: PDFDocumentInfo): void {
    if (!cacheKey) return;
    pdfDocumentInfoCache.delete(cacheKey);
    pdfDocumentInfoCache.set(cacheKey, info);
    while (pdfDocumentInfoCache.size > PDF_INFO_CACHE_LIMIT) {
        const oldestKey = pdfDocumentInfoCache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        pdfDocumentInfoCache.delete(oldestKey);
    }
}

function getCachedPdfDocumentInfo(cacheKey: string, totalPages: number): PDFDocumentInfo | null {
    const cached = pdfDocumentInfoCache.get(cacheKey);
    if (!cached || cached.totalPages !== totalPages) return null;
    pdfDocumentInfoCache.delete(cacheKey);
    pdfDocumentInfoCache.set(cacheKey, cached);
    return cached;
}

// ─── Zoom helpers ─────────────────────────────────────────────────────────────

function getFitWidthScale(container: HTMLElement, page: PDFPageProxy): number {
    const viewportPadding = container.clientWidth < 768 ? 12 : 32;
    const containerWidth = container.clientWidth - viewportPadding;
    if (containerWidth <= 0) return DEFAULT_SCALE;
    const viewport = page.getViewport({ scale: PDF_TO_CSS_UNITS });
    if (viewport.width <= 0) return DEFAULT_SCALE;
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, containerWidth / viewport.width));
}

function getFitPageScale(container: HTMLElement, page: PDFPageProxy): number {
    const viewportPadding = container.clientWidth < 768 ? 12 : 32;
    const containerHeight = container.clientHeight - viewportPadding;
    const containerWidth = container.clientWidth - viewportPadding;
    if (containerWidth <= 0 || containerHeight <= 0) return DEFAULT_SCALE;
    const viewport = page.getViewport({ scale: PDF_TO_CSS_UNITS });
    if (viewport.width <= 0 || viewport.height <= 0) return DEFAULT_SCALE;
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(containerWidth / viewport.width, containerHeight / viewport.height)));
}

// ─── Search helpers ───────────────────────────────────────────────────────────

function getPdfSearchLocation(pageNumber: number): string { return `pdf:page:${pageNumber}`; }

function createPdfSearchExcerpt(pageText: string, query: string, knownMatchIndex?: number): string {
    const normalizedText = pageText.replace(/\s+/g, " ").trim();
    if (!normalizedText) return "";
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return normalizedText.slice(0, PDF_SEARCH_EXCERPT_CONTEXT_CHARS * 2);
    const matchIndex = typeof knownMatchIndex === "number" ? knownMatchIndex : normalizedText.toLowerCase().indexOf(normalizedQuery.toLowerCase());
    if (matchIndex === -1) return normalizedText.slice(0, PDF_SEARCH_EXCERPT_CONTEXT_CHARS * 2);
    const excerptStart = Math.max(0, matchIndex - PDF_SEARCH_EXCERPT_CONTEXT_CHARS);
    const excerptEnd = Math.min(normalizedText.length, matchIndex + normalizedQuery.length + PDF_SEARCH_EXCERPT_CONTEXT_CHARS);
    return `${excerptStart > 0 ? "…" : ""}${normalizedText.slice(excerptStart, excerptEnd)}${excerptEnd < normalizedText.length ? "…" : ""}`;
}

// ─── WebKit text-layer width calibration ──────────────────────────────────────

function computeMedian(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function parseScaleX(transform: string): number | null {
    const match = transform.match(/scaleX\(([-+0-9.eE]+)\)/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function mergeScaleX(transform: string, correction: number): string {
    const existing = parseScaleX(transform);
    if (existing === null) return `${transform} scaleX(${correction})`;
    return transform.replace(/scaleX\(([-+0-9.eE]+)\)/, `scaleX(${existing * correction})`);
}

/**
 * Calibrates WebKit text-layer span widths by measuring a sample of rendered
 * spans and applying per-font scaleX corrections.
 *
 * FIX 5+6: Sample limit reduced 2500 → WEBKIT_CALIBRATION_SAMPLE_LIMIT (600).
 * Returns the maximum absolute scaleX deviation applied so the caller can
 * decide whether a second pass is cost-effective.
 */
function calibrateWebKitTextLayerWidth(
    textDivs: HTMLSpanElement[],
    textItems: TextItemLike[],
    viewportScale: number,
): number {
    if (textDivs.length === 0 || textItems.length === 0 || viewportScale <= 0) return 0;

    const ratiosByFont = new Map<string, number[]>();
    const allRatios: number[] = [];
    let textDivIndex = 0;
    let sampledPairs = 0;

    for (const item of textItems) {
        if (sampledPairs >= WEBKIT_CALIBRATION_SAMPLE_LIMIT || textDivIndex >= textDivs.length) break;
        if (typeof item.str !== "string") continue;
        const span = textDivs[textDivIndex++];
        if (!span?.isConnected || !item.str.trim()) continue;
        const expectedWidth = Math.abs((item.width ?? 0) * viewportScale);
        const actualWidth = span.getBoundingClientRect().width;
        if (actualWidth <= 0.01 || expectedWidth <= 0.01) continue;
        const ratio = expectedWidth / actualWidth;
        if (ratio < 0.5 || ratio > 1.5) continue;
        sampledPairs++;
        allRatios.push(ratio);
        const fontKey = span.style.fontFamily || "__default__";
        const bucket = ratiosByFont.get(fontKey);
        if (bucket) bucket.push(ratio); else ratiosByFont.set(fontKey, [ratio]);
    }

    if (allRatios.length < 24) {
        if (import.meta.env.DEV && DEBUG_WEBKIT_TEXT_LAYER) console.debug("[PDF][TextLayer] WebKit font corrections skipped: insufficient samples", { sampledPairs });
        return 0;
    }

    const globalMedian = computeMedian(allRatios);
    if (!globalMedian) return 0;

    let globalCorrection: number | null = null;
    if (Math.abs(1 - globalMedian) >= 0.02) globalCorrection = Math.max(0.75, Math.min(1.25, globalMedian));

    const correctionsByFont = new Map<string, number>();
    for (const [fontKey, ratios] of ratiosByFont) {
        if (ratios.length < 8) continue;
        const medianRatio = computeMedian(ratios);
        if (!medianRatio || Math.abs(1 - medianRatio) < 0.02) continue;
        correctionsByFont.set(fontKey, Math.max(0.75, Math.min(1.25, medianRatio)));
    }

    if (correctionsByFont.size === 0 && !globalCorrection) return 0;

    if (import.meta.env.DEV && DEBUG_WEBKIT_TEXT_LAYER) {
        console.debug("[PDF][TextLayer] WebKit font corrections:", { sampledPairs, globalMedian, globalCorrection, fonts: Array.from(correctionsByFont.entries()) });
    }

    let maxAppliedDeviation = 0;
    for (const span of textDivs) {
        if (!span.isConnected) continue;
        const fontKey = span.style.fontFamily || "__default__";
        const correction = correctionsByFont.get(fontKey) ?? globalCorrection;
        if (!correction || !span.style.transform) continue;
        span.style.transform = mergeScaleX(span.style.transform, correction);
        const deviation = Math.abs(1 - correction);
        if (deviation > maxAppliedDeviation) maxAppliedDeviation = deviation;
    }

    return maxAppliedDeviation;
}

function waitForNextFrame(): Promise<void> {
    return new Promise((resolve) => { requestAnimationFrame(() => resolve()); });
}

// ─── PDF outline / TOC ────────────────────────────────────────────────────────

interface PdfOutlineItemLike { title?: string | null; dest?: unknown; items?: PdfOutlineItemLike[] | null; }

async function resolvePdfDestPageNumber(pdfDocument: PDFDocumentProxy, destination: unknown): Promise<number | null> {
    try {
        const explicitDestination = typeof destination === "string" ? await pdfDocument.getDestination(destination) : destination;
        if (!Array.isArray(explicitDestination) || explicitDestination.length === 0) return null;
        const ref = explicitDestination[0];
        if (typeof ref === "number") return ref + 1;
        if (!ref || typeof ref !== "object") return null;
        const pageIndex = await pdfDocument.getPageIndex(ref as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
        return pageIndex + 1;
    } catch { return null; }
}

function sanitizeTocLabel(label?: string | null, fallback?: string): string {
    const trimmed = (label || "").replace(/\s+/g, " ").trim();
    return trimmed.length > 0 ? trimmed : (fallback || "Section");
}

async function convertPdfOutlineItems(pdfDocument: PDFDocumentProxy, items: PdfOutlineItemLike[], depth: number, maxDepth: number): Promise<TocItem[]> {
    if (depth > maxDepth) return [];
    return Promise.all(items.map(async (item, index) => {
        const pageNumber = await resolvePdfDestPageNumber(pdfDocument, item.dest);
        const subitems = item.items && item.items.length > 0 ? await convertPdfOutlineItems(pdfDocument, item.items, depth + 1, maxDepth) : undefined;
        const href = pageNumber ? `pdf:page:${pageNumber}` : (subitems && subitems.length > 0 ? subitems[0].href : "pdf:page:1");
        return { label: sanitizeTocLabel(item.title, `Section ${index + 1}`), href, subitems: subitems && subitems.length > 0 ? subitems : undefined } satisfies TocItem;
    }));
}

async function buildPdfToc(pdfDocument: PDFDocumentProxy): Promise<{ tocItems: TocItem[]; hasOutline: boolean }> {
    try {
        const outline = await pdfDocument.getOutline();
        if (outline && outline.length > 0) {
            const convertedOutline = await convertPdfOutlineItems(pdfDocument, outline as unknown as PdfOutlineItemLike[], 0, 8);
            if (convertedOutline.length > 0) return { tocItems: convertedOutline, hasOutline: true };
        }
    } catch (error) { console.warn("[PDFJsEngine] Failed to build PDF outline TOC:", error); }
    return { tocItems: [], hasOutline: false };
}

function toSerializablePdfData(data: Uint8Array): Uint8Array {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data;
    if (!isWebKitBrowserEngine()) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data);
}

// ─── PageCanvas component ─────────────────────────────────────────────────────

interface PageCanvasProps {
    page: PDFPageProxy;
    scale: number;
    rotation: number;
    isRenderActive: boolean;
    getRenderPriority: (pageNumber: number) => number;
    onRenderComplete?: () => void;
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
    page, scale, rotation, isRenderActive, getRenderPriority, onRenderComplete,
    annotations = [], annotationMode = "none", highlightColor, penColor, penWidth,
    enableTextLayer, preferSharpCanvas, snapCssToPixels, useStreamTextLayer,
    calibrateTextLayerWidths, onAnnotationAdd, onAnnotationChange, onAnnotationRemove,
}: PageCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const textLayerRef = useRef<HTMLDivElement>(null);
    const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
    const textLayerInstanceRef = useRef<TextLayer | null>(null);
    const lastCanvasRenderKeyRef = useRef<string>("");
    const hasRenderedCanvasRef = useRef(false);
    const [isNearViewport, setIsNearViewport] = useState(page.pageNumber <= 3);
    const [isRendering, setIsRendering] = useState(page.pageNumber <= 3);
    const shouldRenderAnnotationLayer = annotationMode !== "none" || annotations.length > 0;
    const shouldRender = isNearViewport || isRenderActive;

    // FIX 7+8 — Promoted from useEffect to useLayoutEffect.
    //
    // Why useLayoutEffect:
    //   React flushes child useLayoutEffects before parent useLayoutEffects. The
    //   parent (PDFJsEngine) has a useLayoutEffect that applies a pending scroll
    //   adjustment after zoom. For that adjustment to land correctly the scroll
    //   container must already reflect its new scrollable dimensions — which only
    //   happens once these container/canvas style writes are committed to the DOM.
    //   Using useEffect (async, post-paint) meant the parent's scroll adjustment
    //   ran against stale layout metrics, causing the anchor point to be wrong.
    //
    // Why canvas.style.width/height are updated here (not deferred to the swap):
    //   Updating CSS dimensions eagerly makes the old pixel content stretch to the
    //   new size while the off-screen re-render is in progress. This looks natural
    //   (like a native zoom gesture settling) and gives the user immediate visual
    //   feedback. The actual pixel buffer (canvas.width / canvas.height) is swapped
    //   atomically in the render effect below, so no blank frame ever occurs.
    useLayoutEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        if (!container || !canvas) return;
        if (enableTextLayer && !textLayerDiv) return;
        const viewport = page.getViewport({ scale: scale * PDF_TO_CSS_UNITS, rotation });
        const cssWidth = getCssDimension(viewport.width, snapCssToPixels);
        const cssHeight = getCssDimension(viewport.height, snapCssToPixels);
        container.style.width = `${cssWidth}px`;
        container.style.height = `${cssHeight}px`;
        container.style.setProperty("--scale-factor", `${viewport.scale}`);
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
    }, [page, scale, rotation, enableTextLayer, snapCssToPixels]);

    // Intersection observer for deferred rendering
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        if (typeof IntersectionObserver === "undefined") { setIsNearViewport(true); return; }
        const observer = new IntersectionObserver(
            (entries) => { const next = Boolean(entries[0]?.isIntersecting); setIsNearViewport((prev) => prev === next ? prev : next); },
            { root: null, rootMargin: PAGE_PRERENDER_MARGIN },
        );
        observer.observe(container);
        return () => { observer.disconnect(); };
    }, []);

    // Tear down when page leaves render window
    useEffect(() => {
        if (shouldRender) return;
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
        renderTaskRef.current = null;
        try { textLayerInstanceRef.current?.cancel(); } catch { /* ignore */ }
        textLayerInstanceRef.current = null;
        if (enableTextLayer && textLayerDiv) { unregisterTextLayer(textLayerDiv); textLayerDiv.innerHTML = ""; }
        if (canvas && hasRenderedCanvasRef.current) {
            canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
            canvas.width = 1; canvas.height = 1;
        }
        hasRenderedCanvasRef.current = false;
        lastCanvasRenderKeyRef.current = "";
        setIsRendering(false);
    }, [enableTextLayer, shouldRender]);

    // Main render effect
    useEffect(() => {
        if (!shouldRender) return;
        let cancelled = false;
        let cancelQueuedRenderSlot: (() => void) | null = null;
        let releaseRenderSlot: (() => void) | null = null;
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        if (!canvas) return;
        if (enableTextLayer && !textLayerDiv) return;

        const renderPage = async () => {
            try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
            renderTaskRef.current = null;
            try { textLayerInstanceRef.current?.cancel(); } catch { /* ignore */ }
            textLayerInstanceRef.current = null;

            try {
                const viewport = page.getViewport({ scale: scale * PDF_TO_CSS_UNITS, rotation });
                const cssWidth = getCssDimension(viewport.width, snapCssToPixels);
                const cssHeight = getCssDimension(viewport.height, snapCssToPixels);
                const outputScale = getCanvasPixelRatio(cssWidth, cssHeight, preferSharpCanvas, scale);
                const sizing = getCanvasSizing(cssWidth, cssHeight, outputScale);
                const canvasRenderKey = [page.pageNumber, viewport.scale.toFixed(4), rotation, sizing.canvasWidth, sizing.canvasHeight].join(":");
                const shouldRenderCanvas = !hasRenderedCanvasRef.current || lastCanvasRenderKeyRef.current !== canvasRenderKey;

                // Show the spinner during all canvas re-renders (initial load AND zoom/rotate).
                // The canvas CSS dimensions were already updated synchronously in the
                // useLayoutEffect above, so the user sees the old content stretched to the
                // new size while the spinner overlay signals a sharper render is coming.
                if (shouldRenderCanvas) setIsRendering(true);

                containerRef.current?.style.setProperty("--scale-factor", `${viewport.scale}`);
                containerRef.current?.style.setProperty("--scale-round-x", `${sizing.scaleRoundX}px`);
                containerRef.current?.style.setProperty("--scale-round-y", `${sizing.scaleRoundY}px`);

                if (shouldRenderCanvas) {
                    const slotRequest = requestCanvasRenderSlot(getRenderPriority(page.pageNumber));
                    cancelQueuedRenderSlot = slotRequest.cancel;
                    releaseRenderSlot = await slotRequest.promise;
                    cancelQueuedRenderSlot = null;
                    if (cancelled) { releaseRenderSlot(); releaseRenderSlot = null; return; }

                    // FIX 7 — Render into an off-screen canvas while the on-screen canvas
                    // continues showing old content (stretched to the new CSS size via the
                    // useLayoutEffect above). Once PDF.js finishes we do an atomic swap:
                    //   canvas.width = x  ← clears the buffer (blank for ~0 ns)
                    //   drawImage(temp)   ← immediately refills it
                    // Both operations run synchronously before the browser's next paint
                    // commit, so the on-screen canvas is never in a blank/white state.
                    const tempCanvas = document.createElement("canvas");
                    tempCanvas.width = sizing.canvasWidth;
                    tempCanvas.height = sizing.canvasHeight;
                    const ctx = tempCanvas.getContext("2d", { alpha: false });
                    if (!ctx || cancelled) { releaseRenderSlot(); releaseRenderSlot = null; return; }
                    const renderTask = page.render({ canvasContext: ctx, viewport, transform: [sizing.renderScaleX, 0, 0, sizing.renderScaleY, 0, 0] });
                    renderTaskRef.current = renderTask;
                    await renderTask.promise;
                    if (cancelled) return;

                    // Atomic pixel-buffer swap
                    canvas.width = sizing.canvasWidth;
                    canvas.height = sizing.canvasHeight;
                    const mainCtx = canvas.getContext("2d", { alpha: false });
                    if (mainCtx) mainCtx.drawImage(tempCanvas, 0, 0);

                    hasRenderedCanvasRef.current = true;
                    lastCanvasRenderKeyRef.current = canvasRenderKey;
                    releaseRenderSlot();
                    releaseRenderSlot = null;
                }

                if (enableTextLayer && textLayerDiv) {
                    unregisterTextLayer(textLayerDiv);
                    textLayerDiv.innerHTML = "";
                    textLayerDiv.tabIndex = 0;
                    if (textLayerDiv.dataset.textSelectionBound !== "1") {
                        textLayerDiv.addEventListener("pointerdown", () => { textLayerDiv.classList.add(TEXT_LAYER_SELECTING_CLASS); });
                        textLayerDiv.addEventListener("copy", (event) => {
                            const selection = document.getSelection();
                            if (!selection) return;
                            event.preventDefault();
                            event.clipboardData?.setData("text/plain", selection.toString());
                        });
                        textLayerDiv.dataset.textSelectionBound = "1";
                    }

                    try {
                        let textItemsForCalibration: TextItemLike[] | null = null;
                        let textContentSource: PageTextContent | ReturnType<PDFPageProxy["streamTextContent"]>;
                        if (useStreamTextLayer) {
                            textContentSource = page.streamTextContent({ includeMarkedContent: true, disableNormalization: true });
                        } else {
                            const textContent = await getPageTextContent(page);
                            textContentSource = textContent;
                            textItemsForCalibration = (textContentSource.items as unknown as TextItemLike[]) ?? null;
                        }
                        if (cancelled) return;

                        const textLayer = new TextLayer({ textContentSource, container: textLayerDiv, viewport });
                        textLayerInstanceRef.current = textLayer;
                        await textLayer.render();

                        // FIX 6: Only perform the second calibration pass when the first
                        //         pass found a large enough correction to be worth two more
                        //         frame waits and a full second round of getBoundingClientRect.
                        if (calibrateTextLayerWidths && textItemsForCalibration) {
                            const renderedSpans = textLayer.textDivs as unknown as HTMLSpanElement[];
                            const firstPassMaxDeviation = calibrateWebKitTextLayerWidth(renderedSpans, textItemsForCalibration, viewport.scale);
                            if (firstPassMaxDeviation >= WEBKIT_CALIBRATION_SECOND_PASS_THRESHOLD) {
                                await waitForNextFrame();
                                await waitForNextFrame();
                                if (!cancelled) calibrateWebKitTextLayerWidth(renderedSpans, textItemsForCalibration, viewport.scale);
                            }
                        }

                        const endOfContent = document.createElement("div");
                        endOfContent.className = "endOfContent";
                        textLayerDiv.append(endOfContent);
                        registerTextLayer(textLayerDiv, endOfContent);
                    } catch (textError) {
                        const isAbortError = textError instanceof Error && (textError.name === "AbortException" || textError.message.toLowerCase().includes("abort") || textError.message.toLowerCase().includes("cancel"));
                        if (!isAbortError) console.warn("[PageCanvas] Text layer error:", textError);
                    }
                }

                if (!cancelled) { renderTaskRef.current = null; setIsRendering(false); onRenderComplete?.(); }
            } catch (error: unknown) {
                const isCancelled = error instanceof Error && (error.message.includes("cancelled") || error.message.includes("Rendering cancelled"));
                if (!isCancelled) console.error(error);
                if (!cancelled) setIsRendering(false);
            } finally {
                cancelQueuedRenderSlot?.(); cancelQueuedRenderSlot = null;
                releaseRenderSlot?.(); releaseRenderSlot = null;
            }
        };

        renderPage();

        return () => {
            cancelled = true;
            cancelQueuedRenderSlot?.();
            releaseRenderSlot?.();
            setIsRendering(false);
            try { renderTaskRef.current?.cancel(); } catch { /* ignore */ }
            if (enableTextLayer) {
                try { textLayerInstanceRef.current?.cancel(); } catch { /* ignore */ }
                if (textLayerRef.current) unregisterTextLayer(textLayerRef.current);
            }
        };
    }, [page, scale, rotation, shouldRender, onRenderComplete, enableTextLayer, preferSharpCanvas, snapCssToPixels, useStreamTextLayer, calibrateTextLayerWidths, getRenderPriority]);

    return (
        <div ref={containerRef} className="pdf-page-container">
            <canvas ref={canvasRef} className="block absolute inset-0" />
            {enableTextLayer && <div ref={textLayerRef} className="textLayer" />}
            {shouldRender && shouldRenderAnnotationLayer && (
                <PDFAnnotationLayer
                    pageNumber={page.pageNumber} annotations={annotations} mode={annotationMode}
                    scale={scale} highlightColor={highlightColor} penColor={penColor} penWidth={penWidth}
                    onAnnotationAdd={(ann) => onAnnotationAdd?.(ann)}
                    onAnnotationChange={(annotation) => onAnnotationChange?.(annotation)}
                    onAnnotationRemove={(id) => onAnnotationRemove?.(id)}
                />
            )}
            {shouldRender && isRendering && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                    <div className="animate-spin h-8 w-8 border-b-2 border-[var(--color-accent)]" />
                </div>
            )}
        </div>
    );
});

// ─── Page layout / scroll tracking ───────────────────────────────────────────

interface PageLayoutEntry { pageNumber: number; top: number; bottom: number; }

function findPageForScrollCenter(pageLayout: PageLayoutEntry[], centerY: number): number | null {
    if (pageLayout.length === 0) return null;
    let low = 0, high = pageLayout.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const entry = pageLayout[mid];
        if (centerY < entry.top) { high = mid - 1; continue; }
        if (centerY > entry.bottom) { low = mid + 1; continue; }
        return entry.pageNumber;
    }
    if (high < 0) return pageLayout[0].pageNumber;
    if (low >= pageLayout.length) return pageLayout[pageLayout.length - 1].pageNumber;
    const aboveEntry = pageLayout[high];
    const belowEntry = pageLayout[low];
    return Math.abs(centerY - aboveEntry.bottom) <= Math.abs(belowEntry.top - centerY) ? aboveEntry.pageNumber : belowEntry.pageNumber;
}

// ─── PDFJsEngine ─────────────────────────────────────────────────────────────

export const PDFJsEngine = forwardRef<PDFJsEngineRef, PDFJsEngineProps>(
    function PDFJsEngine({
        pdfPath, pdfData, originalFilename,
        initialPage = 1, initialZoom = DEFAULT_SCALE, initialZoomMode = DEFAULT_ZOOM_MODE,
        onLoad, onError, onPageChange, onZoomModeChange, onViewportTap, className,
        annotations = [], annotationMode = 'none',
        highlightColor = "yellow", penColor = "blue", penWidth = 2,
        onAnnotationAdd, onAnnotationChange, onAnnotationRemove
    }, ref) {
        const containerRef = useRef<HTMLDivElement>(null);
        const zoomContainerRef = useRef<HTMLDivElement>(null);
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [currentPage, setCurrentPage] = useState(initialPage);
        const [totalPages, setTotalPages] = useState(0);
        const [scale, setScale] = useState(DEFAULT_SCALE);
        const [rotation, setRotation] = useState(0);
        const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
        const [pages, setPages] = useState<PDFPageProxy[]>([]);
        const hasAppliedInitialViewStateRef = useRef(false);
        const initialPageRestoreTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        const pendingScrollPageRef = useRef<number | null>(null);
        const pendingScrollAdjustmentRef = useRef<{ left: number; top: number; scale: number } | null>(null);
        const loadingPageNumbersRef = useRef<Set<number>>(new Set());
        const prefetchedOperatorPagesRef = useRef<Set<number>>(new Set());
        const pageLayoutRef = useRef<PageLayoutEntry[]>([]);
        const currentPageRef = useRef(initialPage);
        const totalPagesRef = useRef(0);
        const scaleRef = useRef(DEFAULT_SCALE);
        const initialPageToRestoreRef = useRef(initialPage);
        const zoomModeRef = useRef<PdfZoomMode>(initialZoomMode);
        const searchSessionRef = useRef(0);
        // FIX 4: debounce timer for ResizeObserver bursts
        const resizeDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
        // FIX 8: last wheel-event mouse position (viewport-relative) used to anchor
        // the zoom to the cursor location in flushWheelZoom.
        const lastWheelMouseRef = useRef<{ x: number; y: number } | null>(null);

        const isDesktopWebKit = useMemo(() => isWebKitBrowserEngine(), []);
        const canvasRenderWindow = isDesktopWebKit ? WEBKIT_CANVAS_RENDER_PAGE_WINDOW : DEFAULT_CANVAS_RENDER_PAGE_WINDOW;
        const enableTextLayer = true;
        const useStreamTextLayer = !isDesktopWebKit;

        const callbacksRef = useRef({ onLoad, onError, onPageChange, onZoomModeChange });
        useEffect(() => { callbacksRef.current = { onLoad, onError, onPageChange, onZoomModeChange }; }, [onLoad, onError, onPageChange, onZoomModeChange]);

        useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
        useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
        useEffect(() => { scaleRef.current = scale; }, [scale]);

        const prunePageProxyCache = useCallback((existingPages: PDFPageProxy[], centerPage: number, pageCount: number) => {
            if (existingPages.length === 0) return existingPages;
            const keepStart = Math.max(1, centerPage - PAGE_PROXY_KEEP_WINDOW);
            const keepEnd = Math.min(pageCount, centerPage + PAGE_PROXY_KEEP_WINDOW);
            let changed = false;
            const nextPages: PDFPageProxy[] = [];
            for (const page of existingPages) {
                if (page.pageNumber < keepStart || page.pageNumber > keepEnd) { changed = true; page.cleanup(); continue; }
                nextPages.push(page);
            }
            return changed ? nextPages : existingPages;
        }, []);

        const rebuildPageLayout = useCallback(() => {
            const container = containerRef.current;
            if (!container) { pageLayoutRef.current = []; return; }
            const pageNodes = container.querySelectorAll<HTMLElement>(".pdf-page-wrapper");
            if (pageNodes.length === 0) { pageLayoutRef.current = []; return; }
            pageLayoutRef.current = Array.from(pageNodes)
                .map((node) => {
                    const pageNumber = Number(node.dataset.pageNumber);
                    if (!Number.isFinite(pageNumber)) return null;
                    return { pageNumber, top: node.offsetTop, bottom: node.offsetTop + node.offsetHeight } satisfies PageLayoutEntry;
                })
                .filter((entry): entry is PageLayoutEntry => entry !== null)
                .sort((l, r) => l.pageNumber - r.pageNumber);
        }, []);

        useLayoutEffect(() => {
            const rafId = window.requestAnimationFrame(() => { rebuildPageLayout(); });
            return () => { cancelAnimationFrame(rafId); };
        }, [pages, scale, rotation, totalPages, rebuildPageLayout]);

        // FIX 4: debounce ResizeObserver to prevent rapid layout-flush bursts
        useEffect(() => {
            const container = containerRef.current;
            if (!container || typeof ResizeObserver === "undefined") return;
            const observer = new ResizeObserver(() => {
                if (resizeDebounceTimerRef.current !== null) clearTimeout(resizeDebounceTimerRef.current);
                resizeDebounceTimerRef.current = setTimeout(() => {
                    resizeDebounceTimerRef.current = null;
                    window.requestAnimationFrame(() => { rebuildPageLayout(); });
                }, RESIZE_OBSERVER_DEBOUNCE_MS);
            });
            observer.observe(container);
            return () => {
                observer.disconnect();
                if (resizeDebounceTimerRef.current !== null) { clearTimeout(resizeDebounceTimerRef.current); resizeDebounceTimerRef.current = null; }
            };
        }, [rebuildPageLayout]);

        // FIX 8 — Apply the zoom-anchor scroll adjustment after scale changes.
        //
        // Ordering guarantee: React flushes child useLayoutEffects before parent
        // useLayoutEffects. PageCanvas's size useLayoutEffect (which writes
        // container.style.width/height) therefore always runs before this one,
        // meaning the scroll container already has its correct scrollable dimensions
        // when we reposition it here. This was the root cause of the broken anchor —
        // the old useEffect ran after paint, when the layout was still stale.
        useLayoutEffect(() => {
            const container = containerRef.current;
            const scrollAdjustment = pendingScrollAdjustmentRef.current;
            if (container && scrollAdjustment && Math.abs(scrollAdjustment.scale - scale) < 0.001) {
                container.scrollLeft = scrollAdjustment.left;
                container.scrollTop = scrollAdjustment.top;
                pendingScrollAdjustmentRef.current = null;
            }
        }, [scale]);

        const setZoomMode = useCallback((mode: PdfZoomMode, force = false) => {
            if (!force && zoomModeRef.current === mode) return;
            zoomModeRef.current = mode;
            callbacksRef.current.onZoomModeChange?.(mode);
        }, []);

        const applyZoom = useCallback((requestedScale: number, options?: { mode?: PdfZoomMode; preserveMode?: boolean }): number => {
            const clampedScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, requestedScale));
            if (options?.mode) setZoomMode(options.mode);
            else if (!options?.preserveMode) setZoomMode("custom");
            if (Math.abs(clampedScale - scaleRef.current) < 0.0001) return scaleRef.current;
            scaleRef.current = clampedScale;
            setScale(clampedScale);
            callbacksRef.current.onPageChange?.(currentPageRef.current, totalPagesRef.current, clampedScale);
            return clampedScale;
        }, [setZoomMode]);

        const getLoadedPageNumbers = useCallback(() => new Set(pages.map((page) => page.pageNumber)), [pages]);

        const loadSpecificPages = useCallback(async (pageNumbers: number[]) => {
            if (!pdfDocument) return false;
            const loadedPageNumbers = getLoadedPageNumbers();
            const numbersToLoad = pageNumbers
                .filter((pn) => pn >= 1 && pn <= pdfDocument.numPages)
                .filter((pn) => !loadedPageNumbers.has(pn))
                .filter((pn) => !loadingPageNumbersRef.current.has(pn));
            if (numbersToLoad.length === 0) return false;
            numbersToLoad.forEach((pn) => loadingPageNumbersRef.current.add(pn));
            try {
                const loadedPages: PDFPageProxy[] = [];
                for (const pn of numbersToLoad) loadedPages.push(await pdfDocument.getPage(pn));
                setPages((previousPages) => {
                    const pageMap = new Map(previousPages.map((p) => [p.pageNumber, p]));
                    for (const p of loadedPages) pageMap.set(p.pageNumber, p);
                    const mergedPages = Array.from(pageMap.values()).sort((l, r) => l.pageNumber - r.pageNumber);
                    return prunePageProxyCache(mergedPages, currentPageRef.current, pdfDocument.numPages);
                });
                return true;
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                if (!msg.includes("Transport") && !msg.includes("destroyed")) console.error("[PDFJsEngine] Error loading specific pages:", error);
                return false;
            } finally {
                numbersToLoad.forEach((pn) => loadingPageNumbersRef.current.delete(pn));
            }
        }, [getLoadedPageNumbers, pdfDocument, prunePageProxyCache]);

        const clearSearch = useCallback(() => { searchSessionRef.current += 1; }, []);

        const restoreInitialPageWithRetry = useCallback((targetPage: number, attempts = 0) => {
            const container = containerRef.current;
            if (!container) return;
            const pageNode = container.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page-number="${targetPage}"]`);
            if (pageNode) {
                container.scrollTo({ top: Math.max(0, pageNode.offsetTop - 8), behavior: "auto" });
                currentPageRef.current = targetPage;
                setCurrentPage(targetPage);
                callbacksRef.current.onPageChange?.(targetPage, totalPagesRef.current, scaleRef.current);
                return;
            }
            if (attempts >= 200) return;
            if (initialPageRestoreTimeoutRef.current) clearTimeout(initialPageRestoreTimeoutRef.current);
            initialPageRestoreTimeoutRef.current = setTimeout(() => { restoreInitialPageWithRetry(targetPage, attempts + 1); }, 75);
        }, []);

        const search = useCallback(async function* (query: string): AsyncGenerator<SearchResult | { progress: number } | "done"> {
            const normalizedQuery = query.trim();
            if (!normalizedQuery) { yield "done"; return; }
            const activePdfDocument = pdfDocument;
            if (!activePdfDocument) { yield "done"; return; }

            searchSessionRef.current += 1;
            const sessionId = searchSessionRef.current;
            const normalizedQueryLower = normalizedQuery.toLowerCase();
            const yieldedLocations = new Set<string>();
            const searchablePages: PDFSearchPageItem[] = [];
            // FIX 3: track total chars to enforce budget
            let searchablePagesCharTotal = 0;
            let exactMatchCount = 0;
            const totalPageCount = Math.max(1, activePdfDocument.numPages);

            for (let pageNumber = 1; pageNumber <= totalPageCount; pageNumber++) {
                if (searchSessionRef.current !== sessionId) return;
                let pageText = "";
                try {
                    if (!activePdfDocument || searchSessionRef.current !== sessionId) return;
                    const page = await activePdfDocument.getPage(pageNumber);
                    const pageTextContent = await getPageTextContent(page);
                    pageText = getNormalizedPageText(pageTextContent);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    if (msg.includes("Transport") || msg.includes("destroyed")) { console.warn("[PDFJsEngine] Search stopped: document destroyed"); return; }
                    console.warn("[PDFJsEngine] Failed to read page text for search:", pageNumber, error);
                }

                if (pageText) {
                    // FIX 3: only accumulate fuzzy search data while under char budget
                    if (searchablePagesCharTotal < PDF_SEARCH_FALLBACK_TOTAL_CHAR_BUDGET) {
                        const boundedPageText = pageText.slice(0, PDF_SEARCH_FALLBACK_PAGE_CHAR_LIMIT);
                        searchablePages.push({ pageNumber, text: boundedPageText });
                        searchablePagesCharTotal += boundedPageText.length;
                    }
                    const matchIndex = pageText.toLowerCase().indexOf(normalizedQueryLower);
                    if (matchIndex !== -1) {
                        const location = getPdfSearchLocation(pageNumber);
                        if (!yieldedLocations.has(location)) {
                            yieldedLocations.add(location);
                            exactMatchCount++;
                            yield { cfi: location, excerpt: createPdfSearchExcerpt(pageText, normalizedQuery, matchIndex) };
                        }
                    }
                }
                yield { progress: (pageNumber / totalPageCount) * PDF_SEARCH_EXACT_SCAN_PROGRESS_WEIGHT };
                if (exactMatchCount >= PDF_SEARCH_EXACT_LIMIT) break;
            }

            if (searchSessionRef.current !== sessionId) return;

            if (exactMatchCount < PDF_SEARCH_FALLBACK_TRIGGER_THRESHOLD && searchablePages.length > 0) {
                const fuzzyResults = rankByFuzzyQuery(searchablePages, normalizedQuery, { keys: [{ name: "text", weight: 1 }], limit: PDF_SEARCH_FALLBACK_LIMIT });
                const fallbackResultCount = Math.max(1, fuzzyResults.length);
                let fallbackResultIndex = 0;
                for (const { item } of fuzzyResults) {
                    if (searchSessionRef.current !== sessionId) return;
                    fallbackResultIndex++;
                    const location = getPdfSearchLocation(item.pageNumber);
                    if (!yieldedLocations.has(location)) {
                        yieldedLocations.add(location);
                        yield { cfi: location, excerpt: createPdfSearchExcerpt(item.text, normalizedQuery) };
                    }
                    yield { progress: PDF_SEARCH_EXACT_SCAN_PROGRESS_WEIGHT + ((fallbackResultIndex / fallbackResultCount) * (1 - PDF_SEARCH_EXACT_SCAN_PROGRESS_WEIGHT)) };
                }
            }

            if (searchSessionRef.current !== sessionId) return;
            yield "done";
        }, [pdfDocument]);

        const handleViewportClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
            if (!onViewportTap || isLoading || !!error || annotationMode !== "none") return;
            if (event.defaultPrevented || event.button !== 0) return;
            const target = event.target as Element | null;
            if (target?.closest('a,button,input,textarea,select,label,[role="button"],[contenteditable="true"],[data-no-viewport-tap]')) return;
            const selection = window.getSelection();
            if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return;
            onViewportTap();
        }, [annotationMode, error, isLoading, onViewportTap]);

        const annotationsByPage = useMemo(() => {
            const grouped = new Map<number, Annotation[]>();
            for (const annotation of annotations) {
                if (annotation.pageNumber == null) continue;
                const arr = grouped.get(annotation.pageNumber);
                if (arr) arr.push(annotation); else grouped.set(annotation.pageNumber, [annotation]);
            }
            return grouped;
        }, [annotations]);

        // Load PDF
        useEffect(() => {
            let cancelled = false;
            let loadedPdf: PDFDocumentProxy | null = null;

            const loadPdf = async () => {
                const isVirtualPath = pdfPath.startsWith("idb://") || pdfPath.startsWith("browser://") || pdfPath.startsWith("sqlite://");
                const requiresProvidedData = !isTauri() || isVirtualPath || !pdfPath;
                if (requiresProvidedData && !pdfData) return;

                try {
                    setIsLoading(true); setError(null); setPages([]);
                    pageLayoutRef.current = [];
                    prefetchedOperatorPagesRef.current.clear();
                    loadingPageNumbersRef.current.clear();
                    pendingScrollPageRef.current = null;
                    clearPageTextContentCache();
                    searchSessionRef.current += 1;
                    hasAppliedInitialViewStateRef.current = false;
                    if (initialPageRestoreTimeoutRef.current) { clearTimeout(initialPageRestoreTimeoutRef.current); initialPageRestoreTimeoutRef.current = null; }
                    zoomModeRef.current = initialZoomMode;

                    const canUseDirectAssetUrl = isTauri() && Boolean(pdfPath) && !isVirtualPath && !pdfData;
                    let data: Uint8Array | undefined;
                    let dataByteLength: number | undefined;
                    if (pdfData) { data = pdfData; dataByteLength = data.byteLength; }
                    else if (!canUseDirectAssetUrl && isTauri() && pdfPath && !isVirtualPath) { data = await invoke<Uint8Array>("read_pdf_file", { path: pdfPath }); dataByteLength = data.byteLength; }
                    else if (!canUseDirectAssetUrl) throw new Error("PDF data not provided. Please ensure the book is properly loaded.");

                    if (cancelled) return;

                    const displayFilename = originalFilename || pdfPath.split("/").pop()?.replace(/\.[^/.]+$/, "") || "document";
                    const infoCacheKey = buildPdfInfoCacheKey(pdfPath, originalFilename, dataByteLength);
                    const commonPdfOptions = { cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", isEvalSupported: false };

                    let pdf: PDFDocumentProxy;
                    if (canUseDirectAssetUrl) {
                        try {
                            const directUrl = convertFileSrc(pdfPath);
                            pdf = await pdfjsLib.getDocument({ ...commonPdfOptions, url: directUrl, rangeChunkSize: 65536 }).promise;
                        } catch (urlLoadError) {
                            console.warn("[PDFJsEngine] Asset URL loading failed, falling back to Tauri read:", urlLoadError);
                            const fallbackData = await invoke<Uint8Array>("read_pdf_file", { path: pdfPath });
                            pdf = await pdfjsLib.getDocument({ ...commonPdfOptions, data: toSerializablePdfData(fallbackData) }).promise;
                        }
                    } else {
                        pdf = await pdfjsLib.getDocument({ ...commonPdfOptions, data: toSerializablePdfData(data as Uint8Array) }).promise;
                    }

                    loadedPdf = pdf;
                    if (cancelled) { pdf.destroy(); return; }

                    setPdfDocument(pdf);
                    const totalPageCount = Math.max(1, pdf.numPages);
                    const clampedInitialPage = Math.max(1, Math.min(initialPage, totalPageCount));
                    initialPageToRestoreRef.current = clampedInitialPage;
                    currentPageRef.current = clampedInitialPage;
                    totalPagesRef.current = totalPageCount;
                    scaleRef.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialZoom));
                    setCurrentPage(clampedInitialPage); setTotalPages(totalPageCount); setScale(scaleRef.current);
                    setZoomMode(initialZoomMode, true);

                    const initialPages = [await pdf.getPage(clampedInitialPage)];
                    if (!cancelled) {
                        setPages(initialPages.sort((l, r) => l.pageNumber - r.pageNumber));
                        setIsLoading(false);
                        const cachedInfo = getCachedPdfDocumentInfo(infoCacheKey, totalPageCount);
                        const initialInfo: PDFDocumentInfo = cachedInfo ?? { title: displayFilename, totalPages: totalPageCount, filename: displayFilename, hasOutline: false, toc: [] };
                        callbacksRef.current.onLoad?.(initialInfo);
                        callbacksRef.current.onPageChange?.(clampedInitialPage, totalPageCount, scaleRef.current);
                        void loadSpecificPages([clampedInitialPage + 1, clampedInitialPage - 1]);
                    } else {
                        initialPages.forEach((p) => p.cleanup());
                        pdf.destroy();
                    }

                    if (!cancelled && !getCachedPdfDocumentInfo(infoCacheKey, totalPageCount)) {
                        void (async () => {
                            try {
                                const [metadata, { tocItems, hasOutline }] = await Promise.all([pdf.getMetadata(), buildPdfToc(pdf)]);
                                if (cancelled) return;
                                const metaInfo = metadata.info as Record<string, unknown>;
                                const finalInfo: PDFDocumentInfo = {
                                    title: (metaInfo?.Title as string) || displayFilename,
                                    author: metaInfo?.Author as string | undefined, subject: metaInfo?.Subject as string | undefined,
                                    keywords: metaInfo?.Keywords as string | undefined, creator: metaInfo?.Creator as string | undefined,
                                    producer: metaInfo?.Producer as string | undefined,
                                    creationDate: metaInfo?.CreationDate ? new Date(metaInfo.CreationDate as string) : undefined,
                                    modificationDate: metaInfo?.ModDate ? new Date(metaInfo.ModDate as string) : undefined,
                                    totalPages: totalPageCount, filename: displayFilename, hasOutline, toc: tocItems,
                                };
                                setCachedPdfDocumentInfo(infoCacheKey, finalInfo);
                                callbacksRef.current.onLoad?.(finalInfo);
                            } catch (metadataError) { console.warn("[PDFJsEngine] Deferred metadata load failed:", metadataError); }
                        })();
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
                loadingPageNumbersRef.current.clear();
                pendingScrollPageRef.current = null;
                if (initialPageRestoreTimeoutRef.current) { clearTimeout(initialPageRestoreTimeoutRef.current); initialPageRestoreTimeoutRef.current = null; }
                setPages((existingPages) => { existingPages.forEach((p) => p.cleanup()); return []; });
                pageLayoutRef.current = [];
                prefetchedOperatorPagesRef.current.clear();
                loadedPdf?.destroy();
                setPdfDocument(null);
                clearPageTextContentCache();
                searchSessionRef.current += 1;
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [initialPage, initialZoom, initialZoomMode, pdfPath, pdfData, originalFilename, setZoomMode]);

        // Apply initial zoom + restore initial page
        useEffect(() => {
            if (hasAppliedInitialViewStateRef.current) return;
            if (!containerRef.current || pages.length === 0) return;
            const rafId = window.requestAnimationFrame(() => {
                const container = containerRef.current;
                if (!container) return;
                const firstPage = pages[0];
                if (!firstPage) return;
                const normalizedMode = initialZoomMode;
                const nextScale = normalizedMode === "page-fit" ? getFitPageScale(container, firstPage)
                    : normalizedMode === "width-fit" ? getFitWidthScale(container, firstPage)
                    : Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialZoom));
                hasAppliedInitialViewStateRef.current = true;
                applyZoom(nextScale, { mode: normalizedMode, preserveMode: normalizedMode !== "custom" });
                const targetPage = Math.max(1, Math.min(initialPageToRestoreRef.current, totalPagesRef.current || 1));
                if (targetPage > 1) restoreInitialPageWithRetry(targetPage);
            });
            return () => { cancelAnimationFrame(rafId); };
        }, [pages, applyZoom, initialZoom, initialZoomMode, restoreInitialPageWithRetry]);

        // Load pages near current reading position
        useEffect(() => {
            if (!pdfDocument || totalPages <= 0) return;
            const rangeStart = Math.max(1, currentPage - PAGE_LOAD_AHEAD_THRESHOLD);
            const rangeEnd = Math.min(totalPagesRef.current, Math.max(INITIAL_PAGE_LOAD_SIZE, currentPage + PAGE_LOAD_AHEAD_THRESHOLD));
            const targetRange = Array.from({ length: rangeEnd - rangeStart + 1 }, (_, i) => rangeStart + i);
            if (targetRange.length === 0) return;
            const sortedByDistance = [...targetRange].sort((l, r) => Math.abs(l - currentPage) - Math.abs(r - currentPage));
            void loadSpecificPages(sortedByDistance.slice(0, PAGE_LOAD_BATCH_SIZE));
        }, [currentPage, loadSpecificPages, pdfDocument]);

        useEffect(() => {
            if (!pdfDocument || pages.length === 0) return;
            setPages((existingPages) => prunePageProxyCache(existingPages, currentPage, pdfDocument.numPages));
        }, [currentPage, pages.length, pdfDocument, prunePageProxyCache]);

        // Operator list prefetch
        useEffect(() => {
            if (!pdfDocument || totalPagesRef.current <= 0) return;
            const idleWindow = window as Window & typeof globalThis & { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number; cancelIdleCallback?: (h: number) => void; };
            const targets: number[] = [];
            for (let offset = 1; offset <= OPERATOR_PREFETCH_AHEAD; offset++) {
                const candidate = currentPage + offset;
                if (candidate >= 1 && candidate <= totalPages) targets.push(candidate);
            }
            if (targets.length === 0) return;

            const runPrefetch = () => {
                // FIX 2: prune the set to prevent unbounded growth during long sessions
                if (prefetchedOperatorPagesRef.current.size > OPERATOR_PREFETCH_MAX_SET_SIZE) {
                    const currentP = currentPageRef.current;
                    const keep = new Set<number>();
                    for (const pn of prefetchedOperatorPagesRef.current) {
                        if (Math.abs(pn - currentP) <= OPERATOR_PREFETCH_MAX_SET_SIZE / 2) keep.add(pn);
                    }
                    prefetchedOperatorPagesRef.current = keep;
                }
                for (const pageNumber of targets) {
                    if (prefetchedOperatorPagesRef.current.has(pageNumber)) continue;
                    prefetchedOperatorPagesRef.current.add(pageNumber);
                    void pdfDocument.getPage(pageNumber)
                        .then((page) => page.getOperatorList({ intent: "display" }))
                        .catch(() => { prefetchedOperatorPagesRef.current.delete(pageNumber); });
                }
            };

            let idleHandle: number | null = null;
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            if (idleWindow.requestIdleCallback) idleHandle = idleWindow.requestIdleCallback(runPrefetch, { timeout: OPERATOR_PREFETCH_IDLE_TIMEOUT_MS });
            else timeoutId = setTimeout(runPrefetch, 200);
            return () => {
                if (idleHandle !== null && idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(idleHandle);
                if (timeoutId !== null) clearTimeout(timeoutId);
            };
        }, [currentPage, pdfDocument, totalPages]);

        // Scroll tracking + wheel zoom
        useEffect(() => {
            const container = containerRef.current;
            if (!container || pages.length === 0) return;
            if (pageLayoutRef.current.length === 0) rebuildPageLayout();
            let rafId: number | null = null;
            let zoomRafId: number | null = null;
            let pendingWheelDelta = 0;

            const handleScroll = () => {
                if (rafId !== null) return;
                rafId = window.requestAnimationFrame(() => {
                    rafId = null;
                    const centerY = container.scrollTop + (container.clientHeight / 2);
                    const newPage = findPageForScrollCenter(pageLayoutRef.current, centerY) ?? currentPageRef.current;
                    const totalPageCount = totalPagesRef.current;
                    if (newPage !== currentPageRef.current && newPage >= 1 && newPage <= totalPageCount) {
                        currentPageRef.current = newPage; setCurrentPage(newPage);
                        callbacksRef.current.onPageChange?.(newPage, totalPageCount, scaleRef.current);
                    }
                });
            };

            // FIX 8 — Zoom-to-pointer for wheel zoom.
            //
            // The anchor math is the same for wheel and pinch:
            //   contentX = scrollLeft + mouseX   (the content-space point under the cursor)
            //   After scaling by ratio = newScale / oldScale, that point is at:
            //   contentX * ratio  in the new coordinate system.
            //   To keep it under the cursor we need:
            //   newScrollLeft = contentX * ratio - mouseX
            //
            // We capture the mouse position on every wheel event so the anchor reflects
            // the latest cursor position even when multiple wheel ticks are coalesced
            // into a single RAF-batched flushWheelZoom call.
            const flushWheelZoom = () => {
                zoomRafId = null;
                if (pendingWheelDelta === 0) return;
                const oldScale = scaleRef.current;
                const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldScale + pendingWheelDelta));
                pendingWheelDelta = 0;

                const mouse = lastWheelMouseRef.current;
                if (mouse && Math.abs(nextScale - oldScale) > 0.0001) {
                    const ratio = nextScale / oldScale;
                    const contentX = container.scrollLeft + mouse.x;
                    const contentY = container.scrollTop + mouse.y;
                    pendingScrollAdjustmentRef.current = {
                        left: contentX * ratio - mouse.x,
                        top: contentY * ratio - mouse.y,
                        scale: nextScale,
                    };
                }

                applyZoom(nextScale);
            };

            const handleWheel = (e: WheelEvent) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                    pendingWheelDelta = Math.max(-ZOOM_STEP * 3, Math.min(ZOOM_STEP * 3, pendingWheelDelta + delta));
                    // Record viewport-relative mouse position for the zoom anchor.
                    const rect = container.getBoundingClientRect();
                    lastWheelMouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
                    if (zoomRafId === null) zoomRafId = window.requestAnimationFrame(flushWheelZoom);
                }
            };

            container.addEventListener("scroll", handleScroll, { passive: true });
            container.addEventListener("wheel", handleWheel, { passive: false });
            return () => {
                container.removeEventListener("scroll", handleScroll);
                container.removeEventListener("wheel", handleWheel);
                if (rafId !== null) cancelAnimationFrame(rafId);
                if (zoomRafId !== null) cancelAnimationFrame(zoomRafId);
            };
        }, [pages.length, applyZoom, rebuildPageLayout]);

        // Touch pinch-to-zoom
        useEffect(() => {
            const container = containerRef.current;
            const zoomContainer = zoomContainerRef.current;
            if (!container || !zoomContainer || pages.length === 0) return;
            let isPinching = false, initialDistance = 0, initialScale = 1;
            let initialPinchCenterX = 0, initialPinchCenterY = 0, initialScrollLeft = 0, initialScrollTop = 0;

            const onTouchStart = (e: TouchEvent) => {
                if (e.touches.length === 2) {
                    e.preventDefault(); isPinching = true; initialScale = scaleRef.current;
                    const dx = e.touches[1].clientX - e.touches[0].clientX;
                    const dy = e.touches[1].clientY - e.touches[0].clientY;
                    initialDistance = Math.sqrt(dx * dx + dy * dy);
                    const rect = container.getBoundingClientRect();
                    initialPinchCenterX = ((e.touches[0].clientX + e.touches[1].clientX) / 2) - rect.left;
                    initialPinchCenterY = ((e.touches[0].clientY + e.touches[1].clientY) / 2) - rect.top;
                    initialScrollLeft = container.scrollLeft; initialScrollTop = container.scrollTop;
                    zoomContainer.style.transformOrigin = `${initialPinchCenterX + initialScrollLeft}px ${initialPinchCenterY + initialScrollTop}px`;
                }
            };
            const onTouchMove = (e: TouchEvent) => {
                if (isPinching && e.touches.length === 2) {
                    e.preventDefault();
                    const dx = e.touches[1].clientX - e.touches[0].clientX;
                    const dy = e.touches[1].clientY - e.touches[0].clientY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const targetScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialScale * (distance / initialDistance)));
                    zoomContainer.style.transform = `scale(${targetScale / initialScale})`;
                }
            };
            const onTouchEnd = (e: TouchEvent) => {
                if (isPinching && e.touches.length < 2) {
                    isPinching = false;
                    const transformValue = zoomContainer.style.transform;
                    zoomContainer.style.transform = ''; zoomContainer.style.transformOrigin = '';
                    if (transformValue) {
                        const match = transformValue.match(/scale\(([^)]+)\)/);
                        if (match && match[1]) {
                            const visualScale = parseFloat(match[1]);
                            const finalScale = initialScale * visualScale;
                            const ratio = finalScale / initialScale;
                            // FIX 8 — Anchor scroll adjustment for pinch (same math as wheel).
                            // contentCenter is the pinch midpoint in content-space coordinates.
                            // After scaling, we reposition so it stays at the same viewport position.
                            const contentCenterX = initialPinchCenterX + initialScrollLeft;
                            const contentCenterY = initialPinchCenterY + initialScrollTop;
                            pendingScrollAdjustmentRef.current = {
                                left: contentCenterX * ratio - initialPinchCenterX,
                                top: contentCenterY * ratio - initialPinchCenterY,
                                scale: finalScale,
                            };
                            applyZoom(finalScale);
                        }
                    }
                }
            };
            container.addEventListener("touchstart", onTouchStart, { passive: false });
            container.addEventListener("touchmove", onTouchMove, { passive: false });
            container.addEventListener("touchend", onTouchEnd);
            container.addEventListener("touchcancel", onTouchEnd);
            return () => {
                container.removeEventListener("touchstart", onTouchStart);
                container.removeEventListener("touchmove", onTouchMove);
                container.removeEventListener("touchend", onTouchEnd);
                container.removeEventListener("touchcancel", onTouchEnd);
            };
        }, [pages.length, applyZoom]);

        const scrollToPage = useCallback((targetPage: number, behavior: ScrollBehavior = "smooth"): boolean => {
            const container = containerRef.current;
            if (!container) return false;
            const pageNode = container.querySelector<HTMLElement>(`.pdf-page-wrapper[data-page-number="${targetPage}"]`);
            if (pageNode) { container.scrollTo({ top: Math.max(0, pageNode.offsetTop - 8), behavior }); return true; }
            return false;
        }, []);

        const navigateToPage = useCallback((targetPage: number, behavior: ScrollBehavior = "smooth") => {
            const totalPageCount = totalPagesRef.current;
            if (targetPage < 1 || targetPage > totalPageCount) return;
            if (targetPage !== currentPageRef.current && totalPageCount > 0) {
                currentPageRef.current = targetPage; setCurrentPage(targetPage);
                callbacksRef.current.onPageChange?.(targetPage, totalPageCount, scaleRef.current);
            }
            if (scrollToPage(targetPage, behavior)) { pendingScrollPageRef.current = null; return; }
            pendingScrollPageRef.current = targetPage;
            void loadSpecificPages([targetPage, targetPage + 1, targetPage - 1, targetPage + 2, targetPage - 2]);
        }, [loadSpecificPages, scrollToPage]);

        useEffect(() => {
            const pendingPage = pendingScrollPageRef.current;
            if (!pendingPage) return;
            if (!pages.some((page) => page.pageNumber === pendingPage)) return;
            if (scrollToPage(pendingPage, "auto")) pendingScrollPageRef.current = null;
        }, [pages, scrollToPage]);

        const firstLoadedPage = useMemo(() => pages.length > 0 ? pages[0] : undefined, [pages]);
        const getRenderPriority = useCallback((pageNumber: number) => Math.abs(pageNumber - currentPageRef.current), []);

        useImperativeHandle(ref, () => ({
            goToPage: (page: number) => { if (page >= 1 && page <= totalPages) navigateToPage(page, "smooth"); },
            nextPage: () => { if (currentPage < totalPages) navigateToPage(currentPage + 1, "smooth"); },
            prevPage: () => { if (currentPage > 1) navigateToPage(currentPage - 1, "smooth"); },
            zoomIn: () => { applyZoom(scaleRef.current + ZOOM_STEP); },
            zoomOut: () => { applyZoom(scaleRef.current - ZOOM_STEP); },
            zoomReset: () => { applyZoom(DEFAULT_SCALE, { mode: "custom" }); },
            setZoom: (newScale: number) => { applyZoom(newScale, { mode: "custom" }); },
            getZoom: () => scaleRef.current,
            getCurrentPage: () => currentPageRef.current,
            getTotalPages: () => totalPagesRef.current,
            rotateClockwise: () => { setRotation((prev) => (prev + 90) % 360); },
            rotateCounterClockwise: () => { setRotation((prev) => (prev - 90 + 360) % 360); },
            zoomFitPage: () => { if (!containerRef.current || !firstLoadedPage) return; applyZoom(getFitPageScale(containerRef.current, firstLoadedPage), { mode: "page-fit", preserveMode: true }); },
            zoomFitWidth: () => { if (!containerRef.current || !firstLoadedPage) return; applyZoom(getFitWidthScale(containerRef.current, firstLoadedPage), { mode: "width-fit", preserveMode: true }); },
            search: (query: string) => search(query),
            clearSearch: () => clearSearch(),
        }), [applyZoom, clearSearch, currentPage, firstLoadedPage, navigateToPage, search, totalPages]);

        const displayError = error?.replace(/\s+/g, " ").trim();

        return (
            <div className={cn("relative w-full h-full", className)}>
                {isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)]">
                        <div className="animate-spin h-12 w-12 border-b-2 border-[var(--color-accent)]"></div>
                        <p className="mt-4 text-[color:var(--color-text-secondary)]">Loading PDF...</p>
                    </div>
                )}
                {displayError && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)] p-8">
                        <div className="text-[color:var(--color-error)] text-4xl mb-4">⚠️</div>
                        <h3 className="w-full break-words text-balance text-lg font-semibold text-[color:var(--color-text-primary)] mb-2">Failed to load PDF</h3>
                        <p className="mx-auto w-full max-w-[24rem] break-words text-[color:var(--color-text-secondary)] text-center leading-relaxed">{displayError}</p>
                    </div>
                )}
                <div
                    ref={containerRef}
                    className={cn("absolute inset-0 overflow-auto bg-[var(--color-surface)]", (isLoading || error) && "invisible")}
                    onClick={handleViewportClick}
                >
                    <div ref={zoomContainerRef} className="pdf-zoom-container flex flex-col items-center justify-start min-h-full py-2 sm:py-4 space-y-2 sm:space-y-4 px-1 sm:px-0 mx-auto">
                        {pages.map((page) => {
                            const pageDistanceFromCurrent = Math.abs(page.pageNumber - currentPage);
                            const pageIsInCanvasRenderWindow = pageDistanceFromCurrent <= canvasRenderWindow;
                            const pageTextLayerEnabled = enableTextLayer && (isDesktopWebKit ? pageDistanceFromCurrent <= WEBKIT_TEXT_LAYER_PAGE_WINDOW : pageDistanceFromCurrent <= 1);
                            const pageUseStreamTextLayer = isDesktopWebKit ? page.pageNumber !== currentPage : useStreamTextLayer;
                            return (
                                <div key={`page-${page.pageNumber}`} className="pdf-page-wrapper" data-page-number={page.pageNumber}>
                                    <PageCanvas
                                        page={page} scale={scale} rotation={rotation}
                                        isRenderActive={pageIsInCanvasRenderWindow} getRenderPriority={getRenderPriority}
                                        enableTextLayer={pageTextLayerEnabled} preferSharpCanvas={isDesktopWebKit}
                                        snapCssToPixels={isDesktopWebKit} useStreamTextLayer={pageUseStreamTextLayer}
                                        calibrateTextLayerWidths={isDesktopWebKit && page.pageNumber === currentPage}
                                        annotations={annotationsByPage.get(page.pageNumber) ?? EMPTY_ANNOTATIONS}
                                        annotationMode={annotationMode} highlightColor={highlightColor} penColor={penColor} penWidth={penWidth}
                                        onAnnotationAdd={onAnnotationAdd} onAnnotationChange={onAnnotationChange} onAnnotationRemove={onAnnotationRemove}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>
                {!isLoading && !error && totalPages > 0 && (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none px-3 py-1.5 bg-[var(--color-surface)]/90 backdrop-blur-md border border-[var(--color-border)] text-xs sm:text-sm text-[color:var(--color-text-secondary)] shadow-lg shadow-black/5">
                        <span className="font-medium text-[color:var(--color-text-primary)]">{currentPage}</span>
                        <span className="mx-1 text-[color:var(--color-text-muted)]">/</span>
                        <span>{totalPages}</span>
                        <span className="mx-2 w-px h-3 bg-[var(--color-border)] hidden sm:inline-block" />
                        <span className="opacity-80 hidden sm:inline">{Math.round(scale * 100)}%</span>
                    </div>
                )}
            </div>
        );
    }
);

export default PDFJsEngine;