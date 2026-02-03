/**
 * PDF Engine - Correct PDF.js implementation with proper canvas sizing
 */

import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { DocMetadata, TocItem } from "@/types";

// Set worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PDFDocument {
    numPages: number;
    metadata: DocMetadata;
    toc: TocItem[];
    getPage: (pageNumber: number) => Promise<PDFPageProxy>;
    destroy: () => Promise<void>;
}

export interface PageDimensions {
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
}

export class PDFEngine {
    private pdfDocument: PDFDocumentProxy | null = null;
    private loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    private destroyed = false;
    private activeRenders: Map<number, RenderTask> = new Map();
    private pageCache: Map<number, PDFPageProxy> = new Map();
    private pageDimensions: Map<number, PageDimensions> = new Map();

    async loadDocument(
        file: File | Blob,
        onProgress?: (progress: { loaded: number; total: number }) => void
    ): Promise<PDFDocument> {
        this.cancelAllRenders();
        await this.cleanup();

        if (this.destroyed) {
            throw new Error("Engine has been destroyed");
        }

        const arrayBuffer = await file.arrayBuffer();

        this.loadingTask = pdfjsLib.getDocument({
            data: arrayBuffer,
            useSystemFonts: true,
            isEvalSupported: false,
        });

        if (onProgress) {
            this.loadingTask.onProgress = onProgress;
        }

        this.pdfDocument = await this.loadingTask.promise;

        // Pre-fetch first page to get dimensions
        await this.cachePageDimensions(1);

        const metadata = await this.extractMetadata();
        const toc = await this.extractTOC();

        return {
            numPages: this.pdfDocument.numPages,
            metadata,
            toc,
            getPage: (pageNumber: number) => this.getPage(pageNumber),
            destroy: () => this.cleanup(),
        };
    }

    private async cachePageDimensions(pageNumber: number): Promise<PageDimensions | null> {
        if (!this.pdfDocument) return null;
        
        const cached = this.pageDimensions.get(pageNumber);
        if (cached) return cached;

        try {
            const page = await this.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1 });
            
            const dims: PageDimensions = {
                width: viewport.width,
                height: viewport.height,
                originalWidth: viewport.width,
                originalHeight: viewport.height,
            };
            
            this.pageDimensions.set(pageNumber, dims);
            return dims;
        } catch (err) {
            console.warn('Failed to get page dimensions:', err);
            return null;
        }
    }

    getPageDimensions(pageNumber: number): PageDimensions | null {
        return this.pageDimensions.get(pageNumber) || null;
    }

    private async getPage(pageNumber: number): Promise<PDFPageProxy> {
        if (!this.pdfDocument) {
            throw new Error("No document loaded");
        }

        const cached = this.pageCache.get(pageNumber);
        if (cached) {
            return cached;
        }

        const page = await this.pdfDocument.getPage(pageNumber);
        this.pageCache.set(pageNumber, page);
        return page;
    }

    /**
     * Render a page to canvas with proper HiDPI support
     */
    async renderPage(
        pageNumber: number,
        canvas: HTMLCanvasElement,
        scale: number = 1.0,
        rotation: number = 0
    ): Promise<{ width: number; height: number }> {
        if (!this.pdfDocument || this.destroyed) {
            throw new Error("Engine not ready");
        }

        this.cancelRender(pageNumber);

        try {
            const page = await this.getPage(pageNumber);
            
            // Get viewport at the requested scale
            const viewport = page.getViewport({ scale, rotation });

            // Handle HiDPI displays
            const outputScale = window.devicePixelRatio || 1;
            
            // Set canvas pixel dimensions (scaled for HiDPI)
            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            
            // Set CSS dimensions (logical pixels)
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;

            const canvasContext = canvas.getContext("2d", { alpha: false });
            if (!canvasContext) {
                throw new Error("Could not get canvas context");
            }

            // Clear canvas
            canvasContext.fillStyle = "white";
            canvasContext.fillRect(0, 0, canvas.width, canvas.height);

            // Apply transform for HiDPI
            if (outputScale !== 1) {
                canvasContext.scale(outputScale, outputScale);
            }

            const renderContext = {
                canvasContext,
                viewport,
                annotationMode: 0,
            };

            const renderTask = page.render(renderContext as any);
            this.activeRenders.set(pageNumber, renderTask);
            await renderTask.promise;
            this.activeRenders.delete(pageNumber);

            return { width: viewport.width, height: viewport.height };

        } catch (error) {
            this.activeRenders.delete(pageNumber);
            
            if (error instanceof Error && 
                (error.message.includes("cancelled") || error.message.includes("aborted"))) {
                return { width: 0, height: 0 };
            }
            
            throw error;
        }
    }

    cancelRender(pageNumber: number): void {
        const renderTask = this.activeRenders.get(pageNumber);
        if (renderTask) {
            try {
                renderTask.cancel();
            } catch (err) {
                // Ignore
            }
            this.activeRenders.delete(pageNumber);
        }
    }

    cancelAllRenders(): void {
        for (const [pageNumber, renderTask] of this.activeRenders) {
            try {
                renderTask.cancel();
            } catch (err) {
                // Ignore
            }
        }
        this.activeRenders.clear();
    }

    releasePage(pageNumber: number): void {
        this.cancelRender(pageNumber);
        const page = this.pageCache.get(pageNumber);
        if (page) {
            page.cleanup();
            this.pageCache.delete(pageNumber);
        }
    }

    async renderToBlob(pageNumber: number, scale = 1.0): Promise<Blob | null> {
        if (!this.pdfDocument) return null;

        try {
            const page = await this.getPage(pageNumber);
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;

            canvas.width = viewport.width;
            canvas.height = viewport.height;

            await page.render({
                canvasContext: ctx,
                viewport,
                annotationMode: 0,
            } as any).promise;

            return new Promise((resolve) => {
                canvas.toBlob((blob) => {
                    canvas.width = 0;
                    canvas.height = 0;
                    resolve(blob);
                }, "image/jpeg", 0.85);
            });
        } catch (err) {
            console.warn('[PDFEngine] renderToBlob error:', err);
            return null;
        }
    }

    async cleanup(): Promise<void> {
        this.cancelAllRenders();

        for (const page of this.pageCache.values()) {
            page.cleanup();
        }
        this.pageCache.clear();
        this.pageDimensions.clear();

        if (this.pdfDocument) {
            await this.pdfDocument.destroy();
            this.pdfDocument = null;
        }

        if (this.loadingTask) {
            await this.loadingTask.destroy();
            this.loadingTask = null;
        }
    }

    async destroy(): Promise<void> {
        this.destroyed = true;
        await this.cleanup();
    }

    private async extractMetadata(): Promise<DocMetadata> {
        if (!this.pdfDocument) {
            return { title: "", author: "" };
        }

        try {
            const data = await this.pdfDocument.getMetadata();
            const info = data.info as Record<string, unknown>;

            return {
                title: (info.Title as string) || "",
                author: (info.Author as string) || "",
                language: (info.Language as string) || "",
                description: (info.Subject as string) || "",
                publisher: (info.Producer as string) || "",
                identifier: (info.PDFVersion as string) || "",
            };
        } catch {
            return { title: "", author: "" };
        }
    }

    private async extractTOC(): Promise<TocItem[]> {
        if (!this.pdfDocument) return [];

        try {
            const outline = await this.pdfDocument.getOutline();
            if (!outline) return [];

            const processItems = (items: typeof outline, level = 0): TocItem[] => {
                return items.map((item) => ({
                    label: item.title || "Untitled",
                    href: item.dest
                        ? typeof item.dest === "string"
                            ? item.dest
                            : JSON.stringify(item.dest)
                        : "",
                    level,
                    children: item.items ? processItems(item.items, level + 1) : [],
                }));
            };

            return processItems(outline);
        } catch {
            return [];
        }
    }
}

export default PDFEngine;
