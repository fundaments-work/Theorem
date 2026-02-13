/**
 * useDocumentReader hook
 * React-friendly interface for the document engine - optimized for performance
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { FoliateEngine } from '../engines';
import type {
    Annotation,
    BookFormat,
    DocLocation,
    DocMetadata,
    HighlightColor,
    PageLayout,
    ReadingFlow,
    SearchResult,
    ThemeSettings,
    TocItem,
} from "@theorem/core";

export interface UseDocumentReaderOptions {
    onLocationChange?: (location: DocLocation) => void;
    onReady?: (metadata: DocMetadata, toc: TocItem[]) => void;
    onLocationsGenerated?: () => void;
    onError?: (error: Error) => void;
    onTextSelected?: (cfi: string, text: string, rangeOrEvent: Range | MouseEvent) => void;
    onLocationsSaved?: (locations: string) => void;
    onViewportTap?: () => void;
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
    open: (source: File | Blob | ArrayBuffer | string, filename?: string, initialLocation?: string, layout?: PageLayout, savedLocations?: string, flow?: ReadingFlow, zoom?: number, margins?: number, format?: BookFormat) => Promise<void>;
    goTo: (target: string | number) => Promise<void>;
    goToFraction: (fraction: number) => Promise<void>;
    next: (distance?: number) => Promise<void>;
    prev: (distance?: number) => Promise<void>;
    goLeft: () => Promise<void>;
    goRight: () => Promise<void>;
    goBack: () => void;
    goForward: () => void;

    // Annotations
    addHighlight: (cfi: string, text: string, color: HighlightColor) => Promise<Annotation>;
    addAnnotation: (annotation: Annotation) => Promise<void>;
    removeHighlight: (id: string) => Promise<void>;
    loadAnnotations: (annotations: Annotation[]) => Promise<void>;
    goToAnnotation: (annotation: Annotation) => Promise<void>;
    
    // Text selection
    getSelection: () => { text: string; cfi: string } | null;
    clearSelection: () => void;

    // Search
    search: (query: string) => AsyncGenerator<SearchResult | { progress: number } | 'done'>;
    clearSearch: () => void;

    // Settings
    setLayout: (layout: PageLayout) => void;
    setFlow: (flow: ReadingFlow) => void;
    setZoom: (zoom: number) => void;
    setMargins: (margins: number) => void;
    applyTheme: (settings: ThemeSettings) => void;

    // Cleanup
    close: () => void;

    // Get engine instance for advanced usage
    getEngine: () => FoliateEngine | null;

    // Force location update - useful for keyboard navigation
    forceLocationUpdate: () => void;
}

// Stable empty array to avoid re-renders
const EMPTY_TOC: TocItem[] = [];
const EMPTY_ANNOTATIONS: Annotation[] = [];
const EMPTY_FRACTIONS: number[] = [];

/**
 * React hook for document reading 
 * 
 * Features:
 * - Lazy engine initialization
 * - Batched state updates
 * - Automatic cleanup
 * - Minimal re-renders through stable references
 */
/**
 * React hook for document reading.
 * Provides a React-friendly interface for the document engine with performance optimizations.
 */
export function useDocumentReader(options: UseDocumentReaderOptions = {}): UseDocumentReaderReturn {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<FoliateEngine | null>(null);

    // Store callbacks in ref to avoid re-renders when options change
    const callbacksRef = useRef(options);
    useEffect(() => {
        callbacksRef.current = options;
    });

    // State - grouped by update frequency for optimal render performance
    const [initState, setInitState] = useState({
        isInitialized: false,
        isReady: false,
        isLoading: false,
    });

    const [dataState, setDataState] = useState({
        metadata: null as DocMetadata | null,
        toc: EMPTY_TOC,
        annotations: EMPTY_ANNOTATIONS,
    });

    const [locationState, setLocationState] = useState({
        location: null as DocLocation | null,
        sectionFractions: EMPTY_FRACTIONS,
        canGoBack: false,
        canGoForward: false,
    });

    // Ref for throttling location updates to prevent excessive re-renders
    const locationUpdatePendingRef = useRef(false);
    const pendingLocationRef = useRef<DocLocation | null>(null);

    const [error, setError] = useState<Error | null>(null);

    // Mounted ref for cleanup
    const mountedRef = useRef(true);
    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Initialize engine
    useEffect(() => {
        const container = containerRef.current;
        if (!container || engineRef.current) return;

        // Prevent double init
        const containerKey = '__theoremReaderInit';
        if ((container as any)[containerKey]) return;
        (container as any)[containerKey] = true;

        const engine = new FoliateEngine({
            onLocationChange: (loc: DocLocation) => {
                if (!mountedRef.current) return;
                pendingLocationRef.current = loc;
                if (!locationUpdatePendingRef.current) {
                    locationUpdatePendingRef.current = true;
                    requestAnimationFrame(() => {
                        locationUpdatePendingRef.current = false;
                        const locToUpdate = pendingLocationRef.current;
                        if (locToUpdate && mountedRef.current) {
                            setLocationState(prev => ({
                                ...prev,
                                location: locToUpdate,
                                canGoBack: engine.canGoBack(),
                                canGoForward: engine.canGoForward(),
                            }));
                            callbacksRef.current.onLocationChange?.(locToUpdate);
                        }
                    });
                }
            },
            onReady: (meta: DocMetadata, tocItems: TocItem[]) => {
                if (!mountedRef.current) return;
                setInitState(prev => ({ ...prev, isReady: true, isLoading: false }));
                setDataState({ metadata: meta, toc: tocItems, annotations: engine.getAnnotations() });
                setLocationState(prev => ({
                    ...prev,
                    sectionFractions: engine.getSectionFractions(),
                }));
                callbacksRef.current.onReady?.(meta, tocItems);
            },
            onError: (err: Error) => {
                if (!mountedRef.current) return;
                setError(err);
                setInitState(prev => ({ ...prev, isLoading: false }));
                callbacksRef.current.onError?.(err);
            },
            onTextSelected: callbacksRef.current.onTextSelected,
            onViewportTap: () => {
                callbacksRef.current.onViewportTap?.();
            },
        });

        let isCancelled = false;

        // Initialize
        engine.init(container)
            .then(() => {
                if (mountedRef.current && !isCancelled) {
                    engineRef.current = engine;
                    setInitState(prev => ({ ...prev, isInitialized: true }));
                } else {
                    engine.destroy();
                }
            })
            .catch((err: Error) => {
                if (mountedRef.current && !isCancelled) {
                    setError(err);
                    setInitState(prev => ({ ...prev, isLoading: false }));
                }
            });

        return () => {
            isCancelled = true;
            (container as any)[containerKey] = false;
            if (engineRef.current === engine) {
                engineRef.current = null;
            }
            engine.destroy();
            setInitState({ isInitialized: false, isReady: false, isLoading: false });
        };
    }, []);

    // Track open operations
    const openAbortRef = useRef<AbortController | null>(null);

    // Open document - with full settings support
    const open = useCallback(async (
        source: File | Blob | ArrayBuffer | string,
        filename: string = 'document.epub',
        initialLocation?: string,
        layout: PageLayout = 'auto',
        savedLocations?: string,
        flow: ReadingFlow = 'paged',
        zoom: number = 100,
        margins: number = 10,
        format: BookFormat = 'epub'
    ) => {
        const engine = engineRef.current;
        if (!engine) {
            setError(new Error('Engine not initialized'));
            return;
        }

        // Abort previous open
        openAbortRef.current?.abort();
        const abortController = new AbortController();
        openAbortRef.current = abortController;

        // Reset state
        setInitState({ isInitialized: true, isLoading: true, isReady: false });
        setDataState({ metadata: null, toc: EMPTY_TOC, annotations: EMPTY_ANNOTATIONS });
        setLocationState({
            location: null,
            sectionFractions: EMPTY_FRACTIONS,
            canGoBack: false,
            canGoForward: false,
        });
        setError(null);

        try {
            await engine.open(source, filename, initialLocation, layout, savedLocations, flow, zoom, margins, format);
            if (!abortController.signal.aborted && mountedRef.current) {
                setDataState(prev => ({ ...prev, annotations: engine.getAnnotations() }));
            }
        } catch (err) {
            if (!abortController.signal.aborted && mountedRef.current) {
                setError(err as Error);
                setInitState(prev => ({ ...prev, isLoading: false }));
            }
        } finally {
            if (!abortController.signal.aborted) {
                openAbortRef.current = null;
            }
        }
    }, []);

    // Navigation - stable references
    const goTo = useCallback(async (target: string | number) => {
        await engineRef.current?.goTo(target);
    }, []);

    const goToFraction = useCallback(async (fraction: number) => {
        const engine = engineRef.current;
        if (!engine) {
            console.warn('[useDocumentReader] goToFraction failed - engine not initialized');
            return;
        }
        try {
            await engine.goToFraction(fraction);
        } catch (err) {
            console.error('[useDocumentReader] goToFraction error:', err);
        }
    }, []);

    const next = useCallback(async (distance?: number) => {
        await engineRef.current?.next(distance);
    }, []);

    const prev = useCallback(async (distance?: number) => {
        await engineRef.current?.prev(distance);
    }, []);

    const goLeft = useCallback(async () => {
        await engineRef.current?.goLeft();
    }, []);

    const goRight = useCallback(async () => {
        await engineRef.current?.goRight();
    }, []);

    const goBack = useCallback(async () => {
        await engineRef.current?.goBack();
    }, []);

    const goForward = useCallback(async () => {
        await engineRef.current?.goForward();
    }, []);

    // Annotations
    const addHighlight = useCallback(async (cfi: string, text: string, color: HighlightColor) => {
        const engine = engineRef.current;
        if (!engine) throw new Error('Engine not initialized');

        const annotation = await engine.addHighlight(cfi, text, color);
        setDataState(prev => ({ ...prev, annotations: engine.getAnnotations() }));
        return annotation;
    }, []);

    const addAnnotation = useCallback(async (annotation: Annotation) => {
        const engine = engineRef.current;
        if (!engine) throw new Error('Engine not initialized');

        await engine.addAnnotation(annotation);
        setDataState(prev => ({ ...prev, annotations: engine.getAnnotations() }));
    }, []);

    const removeHighlight = useCallback(async (id: string) => {
        const engine = engineRef.current;
        if (!engine) return;

        await engine.removeHighlight(id);
        setDataState(prev => ({ ...prev, annotations: engine.getAnnotations() }));
    }, []);

    const loadAnnotations = useCallback(async (annotations: Annotation[]) => {
        const engine = engineRef.current;
        if (!engine) return;

        await engine.loadAnnotations(annotations);
        setDataState(prev => ({ ...prev, annotations: engine.getAnnotations() }));
    }, []);

    const goToAnnotation = useCallback(async (annotation: Annotation) => {
        await engineRef.current?.goToAnnotation(annotation);
    }, []);

    // Text selection
    const getSelection = useCallback(() => {
        return engineRef.current?.getSelectionFromDocument() || null;
    }, []);

    const clearSelection = useCallback(() => {
        engineRef.current?.clearSelection();
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

    // Settings methods
    const setLayout = useCallback((layout: PageLayout) => {
        engineRef.current?.setLayout(layout);
    }, []);

    const setFlow = useCallback((flow: ReadingFlow) => {
        engineRef.current?.setFlow(flow);
    }, []);

    const setZoom = useCallback((zoom: number) => {
        engineRef.current?.setZoom(zoom);
    }, []);

    const setMargins = useCallback((margins: number) => {
        engineRef.current?.setMargins(margins);
    }, []);

    const applyTheme = useCallback((settings: ThemeSettings) => {
        engineRef.current?.applyTheme(settings);
    }, []);

    // Cleanup
    const close = useCallback(() => {
        openAbortRef.current?.abort();
        openAbortRef.current = null;

        engineRef.current?.destroy();
        engineRef.current = null;

        setInitState({ isInitialized: false, isReady: false, isLoading: false });
        setDataState({ metadata: null, toc: EMPTY_TOC, annotations: EMPTY_ANNOTATIONS });
        setLocationState({
            location: null,
            sectionFractions: EMPTY_FRACTIONS,
            canGoBack: false,
            canGoForward: false,
        });
        setError(null);
    }, []);

    const getEngine = useCallback(() => engineRef.current, []);

    // Force location update - useful for keyboard navigation
    const forceLocationUpdate = useCallback(() => {
        const engine = engineRef.current;
        if (!engine) return;

        // Get current location directly from engine
        const loc = engine.getCurrentLocation();
        if (loc) {
            setLocationState(prev => ({
                ...prev,
                location: loc,
                canGoBack: engine.canGoBack(),
                canGoForward: engine.canGoForward(),
            }));
            callbacksRef.current.onLocationChange?.(loc);
        }
    }, []);

    // Memoized return value - minimal dependencies
    return useMemo(() => ({
        containerRef,
        isLoading: initState.isLoading,
        isInitialized: initState.isInitialized,
        isReady: initState.isReady,
        error,
        metadata: dataState.metadata,
        toc: dataState.toc,
        location: locationState.location,
        sectionFractions: locationState.sectionFractions,
        annotations: dataState.annotations,
        canGoBack: locationState.canGoBack,
        canGoForward: locationState.canGoForward,
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
        addAnnotation,
        removeHighlight,
        loadAnnotations,
        goToAnnotation,
        getSelection,
        clearSelection,
        search,
        clearSearch,
        close,
        getEngine,
        setLayout,
        setFlow,
        setZoom,
        setMargins,
        applyTheme,
        forceLocationUpdate,
    }), [
        initState.isLoading,
        initState.isInitialized,
        initState.isReady,
        error,
        dataState.metadata,
        dataState.toc,
        dataState.annotations,
        locationState.location,
        locationState.sectionFractions,
        locationState.canGoBack,
        locationState.canGoForward,
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
        addAnnotation,
        removeHighlight,
        loadAnnotations,
        goToAnnotation,
        getSelection,
        clearSelection,
        search,
        clearSearch,
        close,
        getEngine,
        setLayout,
        setFlow,
        setZoom,
        setMargins,
        applyTheme,
        forceLocationUpdate,
    ]);
}

export default useDocumentReader;
