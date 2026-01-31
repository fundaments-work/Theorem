/**
 * ReaderViewport Component
 * Optimized reading area with smooth performance
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { useDocumentReader } from '@/hooks';
import type { DocLocation, DocMetadata, TocItem } from '@/types';
import type { ReaderSettings } from '@/types';
import { cn } from '@/lib/utils';

export interface ReaderViewportHandle {
    next: () => void;
    prev: () => void;
    goToFraction: (fraction: number) => void;
    goTo: (location: string) => Promise<void>;
    search: (query: string) => AsyncGenerator<any>;
    clearSearch: () => void;
}

interface ReaderViewportProps {
    file: File | Blob | null;
    settings: ReaderSettings;
    className?: string;
    onReady?: (metadata: DocMetadata, toc: TocItem[]) => void;
    onLocationChange?: (location: DocLocation) => void;
    onError?: (error: Error) => void;
    onTextSelected?: (cfi: string, text: string) => void;
    onLocationsSaved?: (locations: string) => void;
    initialLocation?: string;
    savedLocations?: string;
}

// Memoized theme color mapping
const themeColors: Record<string, { bg: string; fg: string }> = {
    light: { bg: '#ffffff', fg: '#1a1a1a' },
    sepia: { bg: '#f4ecd8', fg: '#5f4b32' },
    dark: { bg: '#1a1a1a', fg: '#e0e0e0' },
};

export const ReaderViewport = forwardRef<ReaderViewportHandle, ReaderViewportProps>(({
    file,
    settings,
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

    // Helper to show navigation feedback
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
        forceLocationUpdate,
    } = useDocumentReader({
        onReady,
        onLocationsGenerated: () => {
            // Locations generated callback
        },
        onLocationChange,
        onError,
        onTextSelected: onTextSelected ? (cfi, text, _range) => {
            onTextSelected(cfi, text);
        } : undefined,
        onLocationsSaved,
    });

    // Track previous settings for comparison
    const prevSettingsRef = useRef<ReaderSettings | null>(null);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        next: () => next(),
        prev: () => prev(),
        goToFraction: (fraction) => goToFraction(fraction),
        goTo: async (location) => { await goTo(location); },
        search: (query: string) => search(query) as AsyncGenerator<any>,
        clearSearch: () => clearSearch(),
    }), [next, prev, goToFraction, goTo, search, clearSearch]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            console.log('[ReaderViewport] Cleaning up...');
            close();
            // Clear nav feedback timeout
            if (navTimeoutRef.current) {
                clearTimeout(navTimeoutRef.current);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Open file when it changes (only when engine is initialized)
    useEffect(() => {
        // Only open if we have a file and engine is initialized
        if (!file || !isInitialized) {
            return;
        }

        let cancelled = false;

        const openFile = async () => {
            try {
                const filename = file instanceof File ? file.name : 'document.epub';
                console.log('[ReaderViewport] Opening file:', filename);
                await open(
                    file,
                    filename,
                    initialLocation,
                    settings.layout,
                    savedLocations,
                    settings.flow,
                    settings.zoom,
                    settings.margins
                );
                if (!cancelled) {
                    console.log('[ReaderViewport] File opened successfully');
                }
            } catch (err) {
                if (!cancelled) {
                    console.error('[ReaderViewport] Failed to open file:', err);
                }
            }
        };

        openFile();

        // Cleanup: cancel any ongoing operations when file changes or unmounts
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file, initialLocation, isInitialized, savedLocations !== undefined]);

    // Memoize theme settings to prevent unnecessary re-renders
    const themeSettings = useMemo(() => {
        const colors = themeColors[settings.theme] || themeColors.light;
        return {
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
            backgroundColor: colors.bg,
            textColor: colors.fg,
            forcePublisherStyles: settings.forcePublisherStyles,
        };
    }, [
        settings.theme,
        settings.fontSize,
        settings.lineHeight,
        settings.fontFamily,
        settings.letterSpacing,
        settings.wordSpacing,
        settings.paragraphSpacing,
        settings.textAlign,
        settings.hyphenation,
        settings.flow,
        settings.layout,
        settings.margins,
        settings.zoom,
        settings.forcePublisherStyles,
    ]);

    // Apply individual settings when they change
    useEffect(() => {
        const prev = prevSettingsRef.current;
        const engine = getEngine();
        if (!engine) return;

        // Apply theme for font/color related changes
        if (!prev ||
            prev.fontSize !== settings.fontSize ||
            prev.fontFamily !== settings.fontFamily ||
            prev.lineHeight !== settings.lineHeight ||
            prev.letterSpacing !== settings.letterSpacing ||
            prev.wordSpacing !== settings.wordSpacing ||
            prev.paragraphSpacing !== settings.paragraphSpacing ||
            prev.textAlign !== settings.textAlign ||
            prev.hyphenation !== settings.hyphenation ||
            prev.theme !== settings.theme ||
            prev.forcePublisherStyles !== settings.forcePublisherStyles) {
            applyTheme(themeSettings);
        }

        // Apply layout changes
        if (!prev || prev.layout !== settings.layout) {
            setLayout(settings.layout);
        }

        // Apply flow changes
        if (!prev || prev.flow !== settings.flow) {
            setFlow(settings.flow);
        }

        // Apply zoom changes
        if (!prev || prev.zoom !== settings.zoom) {
            setZoom(settings.zoom);
        }

        // Apply margin changes
        if (!prev || prev.margins !== settings.margins) {
            setMargins(settings.margins);
        }

        // Update ref for next comparison
        prevSettingsRef.current = { ...settings };
    }, [themeSettings, settings, applyTheme, setLayout, setFlow, setZoom, setMargins, getEngine]);

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
    }, [next, prev, goToFraction, forceLocationUpdate]);

    // Scroll wheel navigation (for paginated mode)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let wheelTimeout: ReturnType<typeof setTimeout> | null = null;
        let accumulatedDelta = 0;
        const WHEEL_THRESHOLD = 50; // Minimum scroll to trigger page change

        const handleWheel = (e: WheelEvent) => {
            // Only handle wheel in paged mode, let scroll mode handle naturally
            if (settings.flow === 'scroll') return;

            // Don't intercept if user is holding modifier keys (for zooming etc)
            if (e.ctrlKey || e.metaKey) return;

            // Prevent default to stop page scrolling
            e.preventDefault();

            // Accumulate delta for smooth trackpads
            accumulatedDelta += e.deltaY;

            // Clear previous timeout
            if (wheelTimeout) {
                clearTimeout(wheelTimeout);
            }

            // Check if we've accumulated enough scroll
            if (Math.abs(accumulatedDelta) >= WHEEL_THRESHOLD) {
                if (accumulatedDelta > 0) {
                    showNavFeedback('next');
                    next();
                } else {
                    showNavFeedback('prev');
                    prev();
                }
                accumulatedDelta = 0;
            }

            // Reset accumulated delta after a short delay
            wheelTimeout = setTimeout(() => {
                accumulatedDelta = 0;
            }, 150);
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => {
            container.removeEventListener('wheel', handleWheel);
            if (wheelTimeout) clearTimeout(wheelTimeout);
        };
    }, [settings.flow, next, prev, forceLocationUpdate]);

    // Note: Click navigation is now handled by overlay divs below

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
                        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
                            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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

            {/* Document Container - EPUB.js renders iframe here */}
            <div
                ref={containerRef}
                className={cn(
                    'absolute inset-0 transition-opacity duration-300',
                    isLoading ? 'opacity-0' : 'opacity-100',
                    '[&>iframe]:w-full [&>iframe]:h-full [&>iframe]:border-0',
                )}
                style={{ 
                    touchAction: 'pan-y pinch-zoom',
                }}
            />

            {/* Navigation Feedback Overlay - for keyboard navigation only */}
            {navDirection && (
                <div
                    className={cn(
                        'absolute inset-y-0 w-16 pointer-events-none z-20 transition-opacity duration-150',
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
