/**
 * ReaderViewport Component - Optimized
 * 
 * Key optimizations:
 * - CSS variable-based instant theme/setting changes
 * - Batched engine updates using requestAnimationFrame
 * - Minimal re-renders through efficient change detection
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { useDocumentReader } from '@/hooks';
import type { DocLocation, DocMetadata, TocItem, HighlightColor, Annotation, BookFormat } from '@/types';
import type { ReaderSettings } from '@/types';
import { cn } from '@/lib/utils';
import { getSettingsChanges } from '@/lib/reader-styles';

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
    initialLocation,
    savedLocations,
}, ref) => {
    // Navigation feedback state
    const [navDirection, setNavDirection] = useState<'next' | 'prev' | null>(null);
    const navTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    
    // Engine update batching
    const pendingEngineUpdateRef = useRef<number | null>(null);
    const lastAppliedSettingsRef = useRef<ReaderSettings | null>(null);

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
        onTextSelected: onTextSelected ? (cfi, text, _range) => {
            // We need to capture the mouse event separately
            onTextSelected(cfi, text);
        } : undefined,
        onLocationsSaved,
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
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Open file when it changes
    useEffect(() => {
        if (!file || !isInitialized) {
            return;
        }

        let cancelled = false;

        const openFile = async () => {
            try {
                const filename = file instanceof File ? file.name : 'document.epub';
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
                    
                    // Setup iframe selection listeners after book is loaded
                    if (onTextSelected) {
                        setTimeout(() => {
                            const engine = getEngine();
                            if (engine) {
                                console.debug('[ReaderViewport] Setting up iframe listeners after open');
                                engine.setupIframeSelectionListener((cfi, text, event) => {
                                    console.debug('[ReaderViewport] Selection from iframe:', { cfi: cfi.substring(0, 30), text: text.substring(0, 30) });
                                    onTextSelected(cfi, text, event);
                                });
                            }
                        }, 500);
                    }
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
    }, [file, initialLocation, isInitialized, savedLocations !== undefined]);

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
                    const { getThemeColors } = await import('@/lib/reader-styles');
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

        console.debug('[ReaderViewport] Setting up selection handlers');

        // Set up iframe selection listener - this is crucial!
        engine.setupIframeSelectionListener((cfi, text, event) => {
            console.debug('[ReaderViewport] Iframe selection detected:', { cfi: cfi.substring(0, 30), text: text.substring(0, 30) });
            onTextSelected(cfi, text, event);
        });

        // Also handle load events to set up listeners on new sections
        const handleLoad = () => {
            console.debug('[ReaderViewport] Section loaded, setting up selection listeners');
            engine.setupIframeSelectionListener((cfi, text, event) => {
                console.debug('[ReaderViewport] Iframe selection detected (after load):', { cfi: cfi.substring(0, 30), text: text.substring(0, 30) });
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

    // Touch/Swipe navigation
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let touchStartX = 0;
        let touchStartY = 0;
        const SWIPE_THRESHOLD = 50;

        const handleTouchStart = (e: TouchEvent) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        };

        const handleTouchEnd = (e: TouchEvent) => {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            
            const deltaX = touchEndX - touchStartX;
            const deltaY = touchEndY - touchStartY;
            
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > SWIPE_THRESHOLD) {
                e.preventDefault();
                if (deltaX > 0) {
                    showNavFeedback('prev');
                    prev();
                } else {
                    showNavFeedback('next');
                    next();
                }
            }
        };

        const parent = container.parentElement;
        if (parent) {
            parent.addEventListener('touchstart', handleTouchStart, { passive: true });
            parent.addEventListener('touchend', handleTouchEnd, { passive: false });
        }
        
        return () => {
            if (parent) {
                parent.removeEventListener('touchstart', handleTouchStart);
                parent.removeEventListener('touchend', handleTouchEnd);
            }
        };
    }, [next, prev, showNavFeedback]);

    const displayError = error?.message;

    return (
        <div className={cn('relative w-full h-full overflow-hidden', className)}>
            {/* Loading Overlay */}
            {isLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--color-background)] z-20">
                    <div className="w-12 h-12 border-3 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin" />
                    <p className="mt-4 text-sm text-[var(--color-text-muted)]">
                        Loading book...
                    </p>
                </div>
            )}

            {/* Error Display */}
            {displayError && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-background)] z-30">
                    <div className="flex flex-col items-center gap-4 p-8 text-center max-w-md">
                        <div className="w-16 h-16 rounded-full bg-[var(--color-error)]/10 flex items-center justify-center">
                            <svg className="w-8 h-8 text-[var(--color-error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
                            Failed to load book
                        </h3>
                        <p className="text-sm text-[var(--color-text-muted)]">
                            {displayError}
                        </p>
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 bg-[var(--color-accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
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
                    touchAction: settings.flow === 'scroll' ? 'auto' : 'none',
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
                            ? 'linear-gradient(to left, rgba(0,0,0,0.1), transparent)'
                            : 'linear-gradient(to right, rgba(0,0,0,0.1), transparent)'
                    }}
                />
            )}
        </div>
    );
});

ReaderViewport.displayName = 'ReaderViewport';

export default ReaderViewport;
