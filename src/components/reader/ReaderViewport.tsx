/**
 * ReaderViewport Component
 * Optimized reading area with smooth performance
 */

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo } from 'react';
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
  onSectionFractions?: (fractions: number[]) => void;
  initialLocation?: string;
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
  onSectionFractions,
  initialLocation,
}, ref) => {
  const {
    containerRef,
    isLoading,
    isInitialized,
    isReady,
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
  } = useDocumentReader({
    onReady: (meta, tocItems) => {
      onReady?.(meta, tocItems);
      // Pass section fractions when ready
      const engine = getEngine();
      if (engine) {
        onSectionFractions?.(engine.getSectionFractions());
      }
    },
    onLocationChange,
    onError,
    onTextSelected: onTextSelected ? (cfi, text, _range) => {
      onTextSelected(cfi, text);
    } : undefined,
  });

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
      // Clear touch start ref to prevent memory leaks
      touchStartRef.current = null;
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
        await open(file, filename, initialLocation);
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
  }, [file, initialLocation, isInitialized]);

  // Memoize theme settings to prevent unnecessary re-renders
  const themeSettings = useMemo(() => {
    const colors = themeColors[settings.theme] || themeColors.light;
    return {
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      fontFamily: settings.fontFamily,
      flow: settings.flow,
      layout: settings.layout,
      margins: settings.margins,
      backgroundColor: colors.bg,
      textColor: colors.fg,
    };
  }, [
    settings.theme,
    settings.fontSize,
    settings.lineHeight,
    settings.fontFamily,
    settings.flow,
    settings.layout,
    settings.margins,
  ]);

  // Apply settings when they change - apply immediately when engine is available
  // This ensures theme is set before book loads for consistent loading experience
  useEffect(() => {
    const engine = getEngine();
    if (!engine) return;

    engine.applyTheme(themeSettings);
  }, [themeSettings, getEngine]);

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
          prev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          next();
          break;
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          prev();
          break;
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          e.preventDefault();
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
  }, [next, prev, goToFraction]);

  // Click navigation zones
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || isLoading) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const zoneWidth = rect.width / 3;

    if (x < zoneWidth) {
      e.preventDefault();
      prev();
    } else if (x > rect.width - zoneWidth) {
      e.preventDefault();
      next();
    }
  }, [isLoading, prev, next, containerRef]);

  // Touch swipe handling
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    const start = touchStartRef.current;
    const diffX = start.x - touch.clientX;
    const diffY = start.y - touch.clientY;

    touchStartRef.current = null;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
      if (diffX > 0) {
        next();
      } else {
        prev();
      }
    }
  }, [next, prev]);

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

      {/* Document Container */}
      <div
        ref={containerRef}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={cn(
          'absolute inset-0 transition-opacity duration-300',
          isLoading ? 'opacity-0' : 'opacity-100',
          '[&>foliate-view]:w-full [&>foliate-view]:h-full [&>foliate-view]:block',
        )}
      />
    </div>
  );
});

ReaderViewport.displayName = 'ReaderViewport';

export default ReaderViewport;
