/**
 * PDF Engine - Correct PDF.js implementation with proper canvas sizing and text layer support
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

export interface TextLayerItem {
    text: string;
    left: number;
    top: number;
    width: number;
    height: number;
    fontSize: number;
    fontFamily: string;
    transform: number[];
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
     * Get text content for a page (for text layer)
     */
    async getTextContent(pageNumber: number): Promise<TextLayerItem[]> {
        if (!this.pdfDocument || this.destroyed) {
            return [];
        }

        try {
            // Don't cache for text content - get fresh page to avoid cleanup issues
            const page = await this.pdfDocument.getPage(pageNumber);
            const textContent = await page.getTextContent();
            const viewport = page.getViewport({ scale: 1 });

            return textContent.items.map((item: any) => {
                try {
                    const tx = pdfjsLib.Util.transform(
                        viewport.transform,
                        item.transform
                    );

                    const fontHeight = Math.hypot(tx[0], tx[1]);
                    const fontWidth = Math.hypot(tx[2], tx[3]);

                    // Safe width calculation - avoid division by zero
                    const itemWidth = item.width || fontWidth || 0;
                    
                    return {
                        text: item.str || '',
                        left: tx[4] || 0,
                        top: (tx[5] || 0) - fontHeight, // Adjust baseline
                        width: itemWidth,
                        height: fontHeight || 12,
                        fontSize: fontHeight || 12,
                        fontFamily: item.fontName || 'sans-serif',
                        transform: item.transform,
                    };
                } catch (err) {
                    // Return fallback item if transform fails
                    return {
                        text: item.str || '',
                        left: 0,
                        top: 0,
                        width: item.width || 0,
                        height: 12,
                        fontSize: 12,
                        fontFamily: 'sans-serif',
                        transform: item.transform || [1, 0, 0, 1, 0, 0],
                    };
                }
            });
        } catch (error) {
            console.warn(`Failed to get text content for page ${pageNumber}:`, error);
            return [];
        }
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

    /**
     * Render a page to a Blob (for cover extraction)
     */
    async renderToBlob(
        pageNumber: number,
        scale: number = 1.0,
        type: string = "image/jpeg",
        quality: number = 0.85
    ): Promise<Blob | null> {
        if (!this.pdfDocument || this.destroyed) {
            throw new Error("Engine not ready");
        }

        const page = await this.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        // Create offscreen canvas
        const canvas = document.createElement("canvas");
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
            throw new Error("Could not get canvas context");
        }

        // Fill white background
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (outputScale !== 1) {
            ctx.scale(outputScale, outputScale);
        }

        const renderContext = {
            canvasContext: ctx,
            viewport,
            annotationMode: 0,
        };

        const renderTask = page.render(renderContext as any);
        await renderTask.promise;

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Failed to create blob from canvas"));
                }
            }, type, quality);
        });
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
        this.activeRenders.forEach((renderTask) => {
            try {
                renderTask.cancel();
            } catch (err) {
                // Ignore
            }
        });
        this.activeRenders.clear();
    }

    private async extractMetadata(): Promise<DocMetadata> {
        if (!this.pdfDocument) {
            return { title: "", author: "" };
        }

        try {
            const metadata = await this.pdfDocument.getMetadata();
            return {
                title: (metadata?.info as any)?.Title || "",
                author: (metadata?.info as any)?.Author || "",
                description: (metadata?.info as any)?.Subject || "",
            };
        } catch (err) {
            console.warn("Failed to extract metadata:", err);
            return { title: "", author: "" };
        }
    }

    private async extractTOC(): Promise<TocItem[]> {
        if (!this.pdfDocument) {
            return [];
        }

        try {
            const outline = await this.pdfDocument.getOutline();
            if (!outline) return [];

            const convertOutline = (items: any[]): TocItem[] => {
                return items.map((item) => ({
                    id: item.dest?.toString() || item.title,
                    label: item.title,
                    href: item.dest ? `#${item.dest}` : `#page=1`,
                    children: item.items ? convertOutline(item.items) : undefined,
                }));
            };

            return convertOutline(outline);
        } catch (err) {
            console.warn("Failed to extract TOC:", err);
            return [];
        }
    }

    async cleanup(): Promise<void> {
        this.cancelAllRenders();

        // Clean up page cache
        for (const page of this.pageCache.values()) {
            try {
                page.cleanup();
            } catch (err) {
                // Ignore
            }
        }
        this.pageCache.clear();
        this.pageDimensions.clear();

        if (this.pdfDocument) {
            try {
                await this.pdfDocument.destroy();
            } catch (err) {
                // Ignore
            }
            this.pdfDocument = null;
        }

        this.loadingTask = null;
    }

    destroy(): void {
        this.destroyed = true;
        this.cleanup();
    }
}

export default PDFEngine;
