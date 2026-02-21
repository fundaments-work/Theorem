/**
 * ReaderViewport Component - Optimized
 * 
 * Key optimizations:
 * - CSS variable-based instant theme/setting changes
 * - Batched engine updates using requestAnimationFrame
 * - Minimal re-renders through efficient change detection
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { useDocumentReader } from '../hooks/useDocumentReader';
import type { DocLocation, DocMetadata, TocItem, HighlightColor, Annotation, BookFormat } from '../../../core';
import type { ReaderSettings } from '../../../core';
import { cn } from '../../../core';
import { getSettingsChanges } from '../../../core';

const FORMAT_EXTENSION_MAP: Record<BookFormat, string> = {
    epub: 'epub',
    mobi: 'mobi',
    azw: 'azw',
    azw3: 'azw3',
    fb2: 'fb2',
    cbz: 'cbz',
    cbr: 'cbr',
    pdf: 'pdf',
};

export interface ReaderViewportHandle {
    next: () => void;
    prev: () => void;
    goToFraction: (fraction: number) => void;
    goTo: (location: string) => Promise<void>;
    search: (query: string) => AsyncGenerator<any>;
    clearSearch: () => void;
    // Highlight methods
    addHighlight: (cfi: string, text: string, color: HighlightColor) => Promise<Annotation>;
    addAnnotation: (annotation: Annotation) => Promise<void>;
    removeHighlight: (id: string) => Promise<void>;
    loadAnnotations: (annotations: Annotation[]) => Promise<void>;
    clearSelection: () => void;
    // Progress data
    getSectionFractions: () => number[];
}

interface ReaderViewportProps {
    file: File | Blob | null;
    settings: ReaderSettings;
    format?: BookFormat;
    className?: string;
    onReady?: (metadata: DocMetadata, toc: TocItem[]) => void;
    onLocationChange?: (location: DocLocation) => void;
    onError?: (error: Error) => void;
    onTextSelected?: (cfi: string, text: string, rangeOrEvent?: Range | MouseEvent) => void;
    onLocationsSaved?: (locations: string) => void;
    onViewportTap?: () => void;
    shouldForceViewportTap?: () => boolean;
    onZoomGestureChange?: (zoom: number) => void;
    initialLocation?: string;
    savedLocations?: string;
}

export const ReaderViewport = forwardRef<ReaderViewportHandle, ReaderViewportProps>(({
    file,
    settings,
    format = 'epub',
    className,
    onReady,
    onLocationChange,
    onError,
    onTextSelected,
    onLocationsSaved,
    onViewportTap,
    shouldForceViewportTap,
    onZoomGestureChange,
    initialLocation,
    savedLocations,
}, ref) => {
    // Navigation feedback state
    const [navDirection, setNavDirection] = useState<'next' | 'prev' | null>(null);
    const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Engine update batching
    const pendingEngineUpdateRef = useRef<number | null>(null);
    const lastAppliedSettingsRef = useRef<ReaderSettings | null>(null);
    const pinchAnimationFrameRef = useRef<number | null>(null);
    const pendingPinchZoomRef = useRef<number | null>(null);
    const pinchActiveRef = useRef(false);
    const pinchStartDistanceRef = useRef(0);
    const pinchStartZoomRef = useRef(settings.zoom);
    const suppressSwipeRef = useRef(false);
    const previousNonDefaultZoomRef = useRef(settings.zoom !== 100 ? settings.zoom : 130);
    const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
    const currentZoomRef = useRef(settings.zoom);

    const showNavFeedback = useCallback((direction: 'next' | 'prev') => {
        setNavDirection(direction);
        if (navTimeoutRef.current) {
            clearTimeout(navTimeoutRef.current);
        }
        navTimeoutRef.current = setTimeout(() => {
            setNavDirection(null);
        }, 150);
    }, []);

    const {
        containerRef,
        isLoading,
        isInitialized,
        error,
        open,
        close,
        next,
        prev,
        goTo,
        goToFraction,
        search,
        clearSearch,
        getEngine,
        setLayout,
        setFlow,
        setZoom,
        setMargins,
        applyTheme,
        addHighlight,
        addAnnotation,
        removeHighlight,
        loadAnnotations,
        clearSelection,
        getSelection,
    } = useDocumentReader({
        onReady,
        onLocationsGenerated: () => {},
        onLocationChange,
        onError,
        onTextSelected: onTextSelected ? (cfi, text, rangeOrEvent) => {
            onTextSelected(cfi, text, rangeOrEvent);
        } : undefined,
        onLocationsSaved,
        onViewportTap,
        shouldForceViewportTap,
    });

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        next: () => next(),
        prev: () => prev(),
        goToFraction: (fraction) => goToFraction(fraction),
        goTo: async (location) => { await goTo(location); },
        search: (query: string) => search(query) as AsyncGenerator<any>,
        clearSearch: () => clearSearch(),
        addHighlight: (cfi: string, text: string, color: HighlightColor) => addHighlight(cfi, text, color),
        addAnnotation: (annotation: Annotation) => addAnnotation(annotation),
        removeHighlight: (id: string) => removeHighlight(id),
        loadAnnotations: (annotations: Annotation[]) => loadAnnotations(annotations),
        clearSelection: () => clearSelection(),
        getSectionFractions: () => getEngine()?.getSectionFractions() ?? [],
    }), [next, prev, goToFraction, goTo, search, clearSearch, addHighlight, addAnnotation, removeHighlight, loadAnnotations, clearSelection, getEngine]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            close();
            if (navTimeoutRef.current) {
                clearTimeout(navTimeoutRef.current);
            }
            if (pendingEngineUpdateRef.current) {
                cancelAnimationFrame(pendingEngineUpdateRef.current);
            }
            if (pinchAnimationFrameRef.current) {
                cancelAnimationFrame(pinchAnimationFrameRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        currentZoomRef.current = settings.zoom;
        if (settings.zoom !== 100) {
            previousNonDefaultZoomRef.current = settings.zoom;
        }
    }, [settings.zoom]);

    // Open file when it changes
    useEffect(() => {
        if (!file || !isInitialized) {
            return;
        }

        let cancelled = false;

        const openFile = async () => {
            try {
                const extension = FORMAT_EXTENSION_MAP[format] ?? 'epub';
                const filename = file instanceof File ? file.name : `document.${extension}`;
                await open(
                    file,
                    filename,
                    initialLocation,
                    settings.layout,
                    savedLocations,
                    settings.flow,
                    settings.zoom,
                    settings.margins,
                    format
                );
                
                if (!cancelled) {
                    lastAppliedSettingsRef.current = { ...settings };
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('[ReaderViewport] Failed to open file:', err);
                }
            }
        };

        openFile();

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file, format, initialLocation, isInitialized, savedLocations]);

    // Apply settings changes - optimized with batching
    useEffect(() => {
        const engine = getEngine();
        if (!engine || !lastAppliedSettingsRef.current) {
            // First load, settings will be applied during open
            lastAppliedSettingsRef.current = { ...settings };
            return;
        }

        const { cssChanged, engineChanged, changedKeys } = getSettingsChanges(
            lastAppliedSettingsRef.current,
            settings
        );

        if (!cssChanged && !engineChanged) return;

        // CSS changes are already applied instantly via the store's applyReaderStyles
        // We only need to sync settings that affect the rendering engine

        if (engineChanged) {
            // Cancel any pending update
            if (pendingEngineUpdateRef.current) {
                cancelAnimationFrame(pendingEngineUpdateRef.current);
            }

            // Batch engine updates
            pendingEngineUpdateRef.current = requestAnimationFrame(async () => {
                pendingEngineUpdateRef.current = null;

                // Apply settings that need engine coordination
                if (changedKeys.includes('layout')) {
                    setLayout(settings.layout);
                }

                if (changedKeys.includes('flow')) {
                    setFlow(settings.flow);
                }

                if (changedKeys.includes('zoom')) {
                    setZoom(settings.zoom);
                }

                if (changedKeys.includes('margins')) {
                    setMargins(settings.margins);
                }

                // Apply theme changes that need CSS regeneration
                const needsThemeUpdate = 
                    changedKeys.includes('fontSize') ||
                    changedKeys.includes('lineHeight') ||
                    changedKeys.includes('fontFamily') ||
                    changedKeys.includes('textAlign') ||
                    changedKeys.includes('hyphenation') ||
                    changedKeys.includes('theme') ||
                    changedKeys.includes('forcePublisherStyles');

                if (needsThemeUpdate) {
                    const { getThemeColors } = await import('../../../core');
                    const themeColors = getThemeColors(settings.theme);

                    applyTheme({
                        fontSize: settings.fontSize,
                        lineHeight: settings.lineHeight,
                        fontFamily: settings.fontFamily,
                        letterSpacing: settings.letterSpacing,
                        wordSpacing: settings.wordSpacing,
                        paragraphSpacing: settings.paragraphSpacing,
                        textAlign: settings.textAlign,
                        hyphenation: settings.hyphenation,
                        flow: settings.flow,
                        layout: settings.layout,
                        margins: settings.margins,
                        zoom: settings.zoom,
                        backgroundColor: themeColors.bg,
                        textColor: themeColors.fg,
                        linkColor: themeColors.link,
                        forcePublisherStyles: settings.forcePublisherStyles,
                    });
                }

                lastAppliedSettingsRef.current = { ...settings };
            });
        }

        // Always update the ref for CSS changes
        if (cssChanged && !engineChanged) {
            lastAppliedSettingsRef.current = { ...settings };
        }

        return () => {
            if (pendingEngineUpdateRef.current) {
                cancelAnimationFrame(pendingEngineUpdateRef.current);
            }
        };
    }, [settings, getEngine, setLayout, setFlow, setZoom, setMargins, applyTheme]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement) {
                return;
            }

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    showNavFeedback('prev');
                    prev();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    showNavFeedback('next');
                    next();
                    break;
                case 'ArrowUp':
                case 'PageUp':
                    e.preventDefault();
                    showNavFeedback('prev');
                    prev();
                    break;
                case 'ArrowDown':
                case 'PageDown':
                case ' ':
                    e.preventDefault();
                    showNavFeedback('next');
                    next();
                    break;
                case 'Home':
                    e.preventDefault();
                    goToFraction(0);
                    break;
                case 'End':
                    e.preventDefault();
                    goToFraction(0.999);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown, { passive: false });
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [next, prev, goToFraction, showNavFeedback]);

    // Scroll wheel navigation - DISABLED in paged mode per user request
    // User wants to use keyboard/touch only for navigation in paged mode
    // Wheel scrolling allowed only in scroll mode
    useEffect(() => {
        // Wheel navigation is disabled - foliate-js handles scrolling internally
        // This allows TOC and other panels to scroll with wheel
        return;
    }, []);

    // Text selection handling - Fixed version with iframe support
    useEffect(() => {
        if (!onTextSelected || !isInitialized) return;

        const engine = getEngine();
        if (!engine) return;

        // Set up iframe selection listener - this is crucial!
        engine.setupIframeSelectionListener((cfi, text, event) => {
            onTextSelected(cfi, text, event);
        });

        // Also handle load events to set up listeners on new sections
        const handleLoad = () => {
            engine.setupIframeSelectionListener((cfi, text, event) => {
                onTextSelected(cfi, text, event);
            });
        };

        // Listen for section load events
        const engineInstance = engine as any;
        if (engineInstance.view) {
            engineInstance.view.addEventListener('load', handleLoad);
        }
        
        return () => {
            if (engineInstance.view) {
                engineInstance.view.removeEventListener('load', handleLoad);
            }
        };
    }, [onTextSelected, getEngine, isInitialized]);

    // Touch gestures: swipe navigation, pinch zoom, and double-tap zoom toggle.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const MIN_ZOOM = settings.flow === "paged" ? 100 : 50;
        const MAX_ZOOM = 200;
        const SWIPE_THRESHOLD = 50;
        const DOUBLE_TAP_MAX_DELAY = 280;
        const DOUBLE_TAP_MAX_DISTANCE = 28;
        const TAP_MOVE_THRESHOLD = 12;
        const TAP_DURATION_THRESHOLD = 280;

        let touchStartX = 0;
        let touchStartY = 0;
        let touchStartTime = 0;

        const clampZoom = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
        const getTouchDistance = (touchA: Touch, touchB: Touch) =>
            Math.hypot(touchA.clientX - touchB.clientX, touchA.clientY - touchB.clientY);

        const emitZoom = (nextZoom: number) => {
            const clampedZoom = clampZoom(Math.round(nextZoom));
            pendingPinchZoomRef.current = clampedZoom;
            if (pinchAnimationFrameRef.current !== null) {
                return;
            }
            pinchAnimationFrameRef.current = requestAnimationFrame(() => {
                pinchAnimationFrameRef.current = null;
                const pendingZoom = pendingPinchZoomRef.current;
                pendingPinchZoomRef.current = null;
                if (pendingZoom === null) {
                    return;
                }
                if (pendingZoom !== 100) {
                    previousNonDefaultZoomRef.current = pendingZoom;
                }
                onZoomGestureChange?.(pendingZoom);
            });
        };

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                pinchActiveRef.current = true;
                suppressSwipeRef.current = true;
                pinchStartDistanceRef.current = getTouchDistance(e.touches[0], e.touches[1]);
                pinchStartZoomRef.current = currentZoomRef.current;
                return;
            }

            if (e.touches.length !== 1) {
                return;
            }

            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = performance.now();
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (e.touches.length !== 2) {
                return;
            }

            if (!pinchActiveRef.current) {
                pinchActiveRef.current = true;
                pinchStartDistanceRef.current = getTouchDistance(e.touches[0], e.touches[1]);
                pinchStartZoomRef.current = currentZoomRef.current;
            }

            const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
            if (pinchStartDistanceRef.current <= 0) {
                pinchStartDistanceRef.current = currentDistance;
                return;
            }

            const scaleFactor = currentDistance / pinchStartDistanceRef.current;
            suppressSwipeRef.current = true;
            emitZoom(pinchStartZoomRef.current * scaleFactor);
            e.preventDefault();
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (pinchActiveRef.current) {
                if (e.touches.length < 2) {
                    pinchActiveRef.current = false;
                    pinchStartDistanceRef.current = 0;
                    pinchStartZoomRef.current = currentZoomRef.current;
                    if (e.touches.length === 0) {
                        setTimeout(() => {
                            suppressSwipeRef.current = false;
                        }, 0);
                    }
                }
                return;
            }

            if (e.changedTouches.length !== 1) {
                return;
            }

            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const now = performance.now();
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;

            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);
            const isTap = absDeltaX <= TAP_MOVE_THRESHOLD
                && absDeltaY <= TAP_MOVE_THRESHOLD
                && (now - touchStartTime) <= TAP_DURATION_THRESHOLD;

            if (isTap) {
                const previousTap = lastTapRef.current;
                if (previousTap) {
                    const distanceSinceLastTap = Math.hypot(
                        touchEndX - previousTap.x,
                        touchEndY - previousTap.y,
                    );
                    if ((now - previousTap.time) <= DOUBLE_TAP_MAX_DELAY
                        && distanceSinceLastTap <= DOUBLE_TAP_MAX_DISTANCE) {
                        const targetZoom = currentZoomRef.current === 100
                            ? previousNonDefaultZoomRef.current || 130
                            : 100;
                        emitZoom(targetZoom);
                        suppressSwipeRef.current = true;
                        lastTapRef.current = null;
                        e.preventDefault();
                        setTimeout(() => {
                            suppressSwipeRef.current = false;
                        }, 0);
                        return;
                    }
                }

                lastTapRef.current = { time: now, x: touchEndX, y: touchEndY };
            } else {
                lastTapRef.current = null;
            }

            if (suppressSwipeRef.current || settings.flow === "scroll") {
                suppressSwipeRef.current = false;
                return;
            }

            const currentSelection = getSelection();
            if (currentSelection?.text?.trim()) {
                suppressSwipeRef.current = false;
                return;
            }

            if (absDeltaX > absDeltaY && absDeltaX > SWIPE_THRESHOLD) {
                e.preventDefault();
                if (deltaX > 0) {
                    showNavFeedback('prev');
                    prev();
                } else {
                    showNavFeedback('next');
                    next();
                }
            }

            suppressSwipeRef.current = false;
        };

        const handleTouchCancel = () => {
            pinchActiveRef.current = false;
            pinchStartDistanceRef.current = 0;
            suppressSwipeRef.current = false;
            lastTapRef.current = null;
        };

        const listenerTargets = [container, container.parentElement].filter(
            (target, index, list): target is HTMLElement => Boolean(target) && list.indexOf(target) === index,
        );

        for (const target of listenerTargets) {
            target.addEventListener('touchstart', handleTouchStart, { passive: true });
            target.addEventListener('touchmove', handleTouchMove, { passive: false });
            target.addEventListener('touchend', handleTouchEnd, { passive: false });
            target.addEventListener('touchcancel', handleTouchCancel, { passive: true });
        }
        
        return () => {
            for (const target of listenerTargets) {
                target.removeEventListener('touchstart', handleTouchStart);
                target.removeEventListener('touchmove', handleTouchMove);
                target.removeEventListener('touchend', handleTouchEnd);
                target.removeEventListener('touchcancel', handleTouchCancel);
            }
        };
    }, [getSelection, next, onZoomGestureChange, prev, settings.flow, showNavFeedback]);

    const displayError = error?.message?.replace(/\s+/g, " ").trim();

    return (
        <div className={cn('relative w-full h-full overflow-hidden', className)}>
            {/* Loading Overlay */}
            {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)] z-20">
                    <div className="w-12 h-12 border-3 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
                    <p className="mt-4 text-sm text-[color:var(--color-text-muted)]">
                        Loading book...
                    </p>
                </div>
            )}

            {/* Error Display */}
            {displayError && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-background)] z-30">
                    <div className="mx-auto w-full max-w-[26rem] min-w-0 flex flex-col items-center gap-4 p-8 text-center">
                        <div className="w-16 h-16 bg-[var(--color-error)]/10 flex items-center justify-center">
                            <svg className="w-8 h-8 text-[color:var(--color-error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h3 className="w-full break-words text-balance text-lg font-semibold text-[color:var(--color-text-primary)]">
                            Failed to load book
                        </h3>
                        <p className="mx-auto w-full max-w-[24rem] break-words text-sm text-[color:var(--color-text-muted)] leading-relaxed">
                            {displayError}
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="ui-btn-primary"
                        >
                            Retry
                        </button>
                    </div>
                </div>
            )}

            {/* Container with brightness filter applied via CSS variable */}
            <div
                ref={containerRef}
                className={cn(
                    'absolute inset-2 transition-opacity duration-300 z-0 reader-viewport',
                    isLoading ? 'opacity-0' : 'opacity-100',
                )}
                style={{ 
                    touchAction: settings.flow === 'scroll' ? 'pan-y pinch-zoom' : 'manipulation',
                    overflow: settings.flow === 'scroll' ? 'auto' : 'hidden',
                    filter: `brightness(${settings.brightness}%)`,
                }}
            />
            
            {/* Click zones - only in paginated mode */}
            {!isLoading && !error && settings.flow !== 'scroll' && (
                <>
                    <button
                        className="absolute inset-y-2 left-2 w-10 md:w-12 lg:w-16 z-20 opacity-0 hover:opacity-100 transition-opacity cursor-w-resize bg-transparent border-0 p-0"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            showNavFeedback('prev');
                            prev();
                        }}
                        aria-label="Previous page"
                        type="button"
                    />
                    <button
                        className="absolute inset-y-2 right-2 w-10 md:w-12 lg:w-16 z-20 opacity-0 hover:opacity-100 transition-opacity cursor-e-resize bg-transparent border-0 p-0"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            showNavFeedback('next');
                            next();
                        }}
                        aria-label="Next page"
                        type="button"
                    />
                </>
            )}

            {/* Navigation Feedback Overlay */}
            {navDirection && (
                <div
                    className={cn(
                        'absolute inset-y-0 w-16 pointer-events-none z-30 transition-opacity duration-150',
                        navDirection === 'next' ? 'right-0' : 'left-0',
                    )}
                    style={{
                        background: navDirection === 'next'
                            ? 'linear-gradient(to left, var(--color-overlay-subtle), transparent)'
                            : 'linear-gradient(to right, var(--color-overlay-subtle), transparent)'
                    }}
                />
            )}
        </div>
    );
});

ReaderViewport.displayName = 'ReaderViewport';

export default ReaderViewport;
