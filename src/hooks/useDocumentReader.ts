/**
 * useDocumentReader hook
 * React-friendly interface for the document engine with performance optimizations
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { DocumentEngine } from '@/engines';
import type { 
    DocLocation, 
    DocMetadata, 
    TocItem, 
    HighlightColor, 
    Annotation,
    SearchResult 
} from '@/types';

export interface UseDocumentReaderOptions {
    onLocationChange?: (location: DocLocation) => void;
    onReady?: (metadata: DocMetadata, toc: TocItem[]) => void;
    onError?: (error: Error) => void;
    onTextSelected?: (cfi: string, text: string, range: Range) => void;

}

export interface UseDocumentReaderReturn {
    containerRef: React.RefObject<HTMLDivElement | null>;
    isLoading: boolean;
    isInitialized: boolean;
    isReady: boolean;
    error: Error | null;
    metadata: DocMetadata | null;
    toc: TocItem[];
    location: DocLocation | null;
    sectionFractions: number[];
    annotations: Annotation[];
    canGoBack: boolean;
    canGoForward: boolean;

    // Actions
    open: (source: File | Blob | ArrayBuffer, filename?: string, initialLocation?: string) => Promise<void>;
    goTo: (target: string | number) => Promise<void>;
    goToFraction: (fraction: number) => Promise<void>;
    next: () => Promise<void>;
    prev: () => Promise<void>;
    goLeft: () => Promise<void>;
    goRight: () => Promise<void>;
    goBack: () => void;
    goForward: () => void;
    
    // Annotations
    addHighlight: (cfi: string, text: string, color: HighlightColor) => Promise<Annotation>;
    removeHighlight: (id: string) => Promise<void>;
    
    // Search
    search: (query: string) => AsyncGenerator<SearchResult | { progress: number } | 'done'>;
    clearSearch: () => void;
    
    // Cleanup
    close: () => void;
    
    // Get engine instance for advanced usage
    getEngine: () => DocumentEngine | null;
}

/**
 * React hook for document reading with performance optimizations
 * 
 * Features:
 * - Lazy engine initialization
 * - Debounced state updates
 * - Automatic cleanup
 * - Prefetching for smooth navigation
 */
export function useDocumentReader(options: UseDocumentReaderOptions = {}): UseDocumentReaderReturn {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<DocumentEngine | null>(null);
    const optionsRef = useRef(options);
    
    // Keep options ref up to date
    useEffect(() => {
        optionsRef.current = options;
    }, [options]);

    // State
    const [isLoading, setIsLoading] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [metadata, setMetadata] = useState<DocMetadata | null>(null);
    const [toc, setToc] = useState<TocItem[]>([]);
    const [location, setLocation] = useState<DocLocation | null>(null);
    const [sectionFractions, setSectionFractions] = useState<number[]>([]);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [canGoBack, setCanGoBack] = useState(false);
    const [canGoForward, setCanGoForward] = useState(false);

    // Track mounted state to prevent state updates after unmount
    const mountedRef = useRef(true);
    
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Initialize engine once container is available
    useEffect(() => {
        const container = containerRef.current;
        if (!container || engineRef.current) return;

        // Mark as initializing to prevent double init
        if ((container as any).__engineInitializing) return;
        (container as any).__engineInitializing = true;

        const engine = new DocumentEngine();
        let isCancelled = false;

        // Set up callbacks with refs to avoid re-renders
        engine.onLocationChange = (loc) => {
            if (!mountedRef.current || isCancelled) return;
            setLocation(loc);
            setCanGoBack(engine.canGoBack());
            setCanGoForward(engine.canGoForward());
            optionsRef.current.onLocationChange?.(loc);
        };

        engine.onReady = (meta, tocItems) => {
            if (!mountedRef.current || isCancelled) return;
            setMetadata(meta);
            setToc(tocItems);
            setSectionFractions(engine.getSectionFractions());
            setIsReady(true);
            setIsLoading(false);
            optionsRef.current.onReady?.(meta, tocItems);
        };

        engine.onError = (err) => {
            if (!mountedRef.current || isCancelled) return;
            setError(err);
            setIsLoading(false);
            optionsRef.current.onError?.(err);
        };

        engine.onTextSelected = (cfi, text, range) => {
            if (!mountedRef.current || isCancelled) return;
            optionsRef.current.onTextSelected?.(cfi, text, range);
        };

        // Initialize
        engine.init(container)
            .then(() => {
                if (mountedRef.current && !isCancelled) {
                    engineRef.current = engine;
                    setIsInitialized(true);
                } else {
                    // Component unmounted during init, clean up
                    engine.destroy();
                }
            })
            .catch((err) => {
                if (mountedRef.current && !isCancelled) {
                    setError(err);
                    setIsLoading(false);
                }
            });

        // Cleanup
        return () => {
            isCancelled = true;
            (container as any).__engineInitializing = false;
            setIsInitialized(false);
            if (engineRef.current === engine) {
                engineRef.current = null;
            }
            engine.destroy();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Track open operation to handle race conditions
    const openAbortRef = useRef<AbortController | null>(null);

    // Open document
    const open = useCallback(async (
        source: File | Blob | ArrayBuffer, 
        filename: string = 'document.epub',
        initialLocation?: string
    ) => {
        const engine = engineRef.current;
        if (!engine) {
            setError(new Error('Engine not initialized'));
            return;
        }

        // Abort any previous open operation
        if (openAbortRef.current) {
            openAbortRef.current.abort();
        }
        
        const abortController = new AbortController();
        openAbortRef.current = abortController;

        // Reset state completely for new book
        setIsLoading(true);
        setError(null);
        setIsReady(false);
        setMetadata(null);
        setToc([]);
        setLocation(null);
        setSectionFractions([]);
        setAnnotations([]);
        setCanGoBack(false);
        setCanGoForward(false);

        try {
            await engine.open(source, filename, initialLocation);
            // Only update state if not aborted
            if (!abortController.signal.aborted && mountedRef.current) {
                setAnnotations(engine.getAnnotations());
            }
        } catch (err) {
            if (!abortController.signal.aborted && mountedRef.current) {
                setError(err as Error);
                setIsLoading(false);
            }
        } finally {
            if (!abortController.signal.aborted) {
                openAbortRef.current = null;
            }
        }
    }, []);

    // Navigation
    const goTo = useCallback(async (target: string | number) => {
        await engineRef.current?.goTo(target);
    }, []);

    const goToFraction = useCallback(async (fraction: number) => {
        await engineRef.current?.goToFraction(fraction);
    }, []);

    const next = useCallback(async () => {
        await engineRef.current?.next();
    }, []);

    const prev = useCallback(async () => {
        await engineRef.current?.prev();
    }, []);

    const goLeft = useCallback(async () => {
        await engineRef.current?.goLeft();
    }, []);

    const goRight = useCallback(async () => {
        await engineRef.current?.goRight();
    }, []);

    const goBack = useCallback(() => {
        engineRef.current?.goBack();
    }, []);

    const goForward = useCallback(() => {
        engineRef.current?.goForward();
    }, []);

    // Annotations
    const addHighlight = useCallback(async (cfi: string, text: string, color: HighlightColor) => {
        const engine = engineRef.current;
        if (!engine) throw new Error('Engine not initialized');

        const annotation = await engine.addHighlight(cfi, text, color);
        setAnnotations(engine.getAnnotations());
        return annotation;
    }, []);

    const removeHighlight = useCallback(async (id: string) => {
        const engine = engineRef.current;
        if (!engine) return;

        await engine.removeHighlight(id);
        setAnnotations(engine.getAnnotations());
    }, []);

    // Search
    const search = useCallback(async function* (query: string) {
        const engine = engineRef.current;
        if (!engine) return;
        
        yield* engine.search(query);
    }, []);

    const clearSearch = useCallback(() => {
        engineRef.current?.clearSearch();
    }, []);

    // Cleanup
    const close = useCallback(() => {
        // Abort any ongoing open operation
        if (openAbortRef.current) {
            openAbortRef.current.abort();
            openAbortRef.current = null;
        }
        
        engineRef.current?.destroy();
        engineRef.current = null;
        
        setMetadata(null);
        setToc([]);
        setLocation(null);
        setSectionFractions([]);
        setAnnotations([]);
        setIsReady(false);
        setCanGoBack(false);
        setCanGoForward(false);
        setIsLoading(false);
        setError(null);
    }, []);

    const getEngine = useCallback(() => engineRef.current, []);

    // Memoized return value
    return useMemo(() => ({
        containerRef,
        isLoading,
        isInitialized,
        isReady,
        error,
        metadata,
        toc,
        location,
        sectionFractions,
        annotations,
        canGoBack,
        canGoForward,
        open,
        goTo,
        goToFraction,
        next,
        prev,
        goLeft,
        goRight,
        goBack,
        goForward,
        addHighlight,
        removeHighlight,
        search,
        clearSearch,
        close,
        getEngine,
    }), [
        isLoading, isInitialized, isReady, error, metadata, toc, location, 
        sectionFractions, annotations, canGoBack, canGoForward,
        open, goTo, goToFraction, next, prev, goLeft, goRight,
        goBack, goForward, addHighlight, removeHighlight, 
        search, clearSearch, close, getEngine
    ]);
}

export default useDocumentReader;
