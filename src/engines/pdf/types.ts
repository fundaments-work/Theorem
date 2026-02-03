/**
 * PDF Engine Types - Professional PDF rendering types
 */

import type { PDFDocumentProxy, PDFPageProxy, RenderTask, PageViewport } from "pdfjs-dist";
import type { DocMetadata, TocItem } from "@/types";

export interface PDFDocument {
    numPages: number;
    metadata: DocMetadata;
    toc: TocItem[];
    getPage: (pageNumber: number) => Promise<PDFPageProxy>;
    destroy: () => Promise<void>;
}

export interface RenderOptions {
    scale?: number;
    rotation?: number;
    enableTextLayer?: boolean;
    enableAnnotationLayer?: boolean;
}

export interface PageInfo {
    pageNumber: number;
    width: number;
    height: number;
    scale: number;
}

export interface RenderJob {
    pageNumber: number;
    page: PDFPageProxy;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    viewport: PageViewport;
    priority: number; // Higher = more important
    onComplete?: () => void;
    onError?: (error: Error) => void;
}

export interface VirtualScrollConfig {
    buffer: {
        ahead: number;
        behind: number;
    };
    threshold: {
        render: number;
        preload: number;
    };
    maxConcurrentRenders: number;
    renderDebounceMs: number;
    cleanupDelayMs: number;
}

export const DEFAULT_VIRTUAL_SCROLL_CONFIG: VirtualScrollConfig = {
    buffer: {
        ahead: 2,
        behind: 1,
    },
    threshold: {
        render: 0.1,
        preload: 200,
    },
    maxConcurrentRenders: 2,
    renderDebounceMs: 50,
    cleanupDelayMs: 5000,
};

export interface CanvasPoolStats {
    poolSize: number;
    activeCount: number;
    maxSize: number;
}

export interface RenderQueueStats {
    queueLength: number;
    activeRenders: number;
    maxConcurrent: number;
}

export interface PDFEngineStats {
    documentLoaded: boolean;
    numPages: number;
    cachedPages: number;
    maxCacheSize: number;
    canvasPool: CanvasPoolStats;
    renderQueue: RenderQueueStats;
    memoryEstimateMB: number;
}

// Event types for engine callbacks
export type PDFEngineEvent =
    | { type: 'documentLoaded'; numPages: number }
    | { type: 'pageRendered'; pageNumber: number; duration: number }
    | { type: 'pageRenderError'; pageNumber: number; error: Error }
    | { type: 'viewportChanged'; visiblePages: number[] }
    | { type: 'memoryPressure'; currentMB: number };

export type PDFEngineEventHandler = (event: PDFEngineEvent) => void;

// Re-export virtual scroller types for convenience
export type { ViewportState, ViewportChangeHandler } from "./virtual-scroller";
