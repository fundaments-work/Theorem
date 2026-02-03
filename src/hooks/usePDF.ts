/**
 * usePDF - Simple React hook for PDF.js
 */

import { useRef, useCallback, useState, useEffect } from "react";
import { PDFEngine } from "@/engines/pdf";
import type { PDFDocument, PageDimensions, TextLayerItem } from "@/engines/pdf";

export interface UsePDFReturn {
    isLoading: boolean;
    loadProgress: { loaded: number; total: number } | null;
    error: Error | null;
    document: PDFDocument | null;
    loadDocument: (file: File | Blob) => Promise<void>;
    renderPage: (pageNumber: number, canvas: HTMLCanvasElement, scale?: number, rotation?: number) => Promise<{ width: number; height: number }>;
    getTextContent: (pageNumber: number) => Promise<TextLayerItem[]>;
    getPageDimensions: (pageNumber: number) => PageDimensions | null;
    cancelRender: (pageNumber: number) => void;
    cleanup: () => Promise<void>;
}

export function usePDF(): UsePDFReturn {
    const engineRef = useRef<PDFEngine | null>(null);
    const mountedRef = useRef(true);

    const [isLoading, setIsLoading] = useState(false);
    const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [document, setDocument] = useState<PDFDocument | null>(null);

    // Initialize engine
    useEffect(() => {
        mountedRef.current = true;
        engineRef.current = new PDFEngine();

        return () => {
            mountedRef.current = false;
            engineRef.current?.destroy();
            engineRef.current = null;
        };
    }, []);

    const loadDocument = useCallback(async (file: File | Blob): Promise<void> => {
        const engine = engineRef.current;
        if (!engine) {
            throw new Error("PDF engine not initialized");
        }

        setIsLoading(true);
        setError(null);
        setLoadProgress(null);

        try {
            const doc = await engine.loadDocument(file, (progress) => {
                if (mountedRef.current) {
                    setLoadProgress(progress);
                }
            });

            if (mountedRef.current) {
                setDocument(doc);
            }
        } catch (err) {
            if (mountedRef.current) {
                const error = err instanceof Error ? err : new Error(String(err));
                setError(error);
                throw error;
            }
        } finally {
            if (mountedRef.current) {
                setIsLoading(false);
            }
        }
    }, []);

    const renderPage = useCallback(
        async (pageNumber: number, canvas: HTMLCanvasElement, scale = 1.0, rotation = 0): Promise<{ width: number; height: number }> => {
            const engine = engineRef.current;
            if (!engine) return { width: 0, height: 0 };
            return await engine.renderPage(pageNumber, canvas, scale, rotation);
        },
        []
    );

    const getTextContent = useCallback(async (pageNumber: number): Promise<TextLayerItem[]> => {
        const engine = engineRef.current;
        if (!engine) return [];
        return await engine.getTextContent(pageNumber);
    }, []);

    const getPageDimensions = useCallback((pageNumber: number): PageDimensions | null => {
        return engineRef.current?.getPageDimensions(pageNumber) || null;
    }, []);

    const cancelRender = useCallback((pageNumber: number): void => {
        engineRef.current?.cancelRender(pageNumber);
    }, []);

    const cleanup = useCallback(async (): Promise<void> => {
        await engineRef.current?.cleanup();
        setDocument(null);
    }, []);

    return {
        isLoading,
        loadProgress,
        error,
        document,
        loadDocument,
        renderPage,
        getTextContent,
        getPageDimensions,
        cancelRender,
        cleanup,
    };
}

export default usePDF;
