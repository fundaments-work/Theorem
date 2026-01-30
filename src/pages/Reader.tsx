/**
 * Reader Page
 * Full-screen reading experience with document viewer and controls
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useUIStore, useLibraryStore, useSettingsStore } from '@/store';
import {
    ReaderViewport,
    ReaderToolbar,
    ReaderProgressBar,
    TableOfContents,
    ReaderSettings,
    ReaderBookmarks,
    ReaderSearch,
    BookInfoPopover,
    ReaderViewportHandle,
} from '@/components/reader';
import { DocLocation, DocMetadata, TocItem } from '@/types';
import { readBookFile } from '@/lib/import';

export function ReaderPage() {
    const { currentBookId, setRoute } = useUIStore();
    const { getBook, updateProgress } = useLibraryStore();
    const { settings, updateReaderSettings } = useSettingsStore();
    const readerRef = useRef<ReaderViewportHandle>(null);
    const loadedBookIdRef = useRef<string | null>(null);

    // File state
    const [file, setFile] = useState<File | null>(null);
    const [metadata, setMetadata] = useState<DocMetadata | null>(null);
    const [toc, setToc] = useState<TocItem[]>([]);
    const [location, setLocation] = useState<DocLocation | null>(null);
    const [sectionFractions, setSectionFractions] = useState<number[]>([]);

    // UI state
    const [showToolbar, setShowToolbar] = useState(true);
    type ReaderPanel = 'toc' | 'settings' | 'bookmarks' | 'search' | 'info' | null;
    const [activePanel, setActivePanel] = useState<ReaderPanel>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [initialLocation, setInitialLocation] = useState<string | undefined>(undefined);

    const togglePanel = useCallback((panel: ReaderPanel) => {
        setActivePanel(current => current === panel ? null : panel);
    }, []);

    // Load book file
    useEffect(() => {
        console.log('[Reader] Book loading effect triggered, currentBookId:', currentBookId, 'already loaded:', loadedBookIdRef.current);

        // Skip if we've already loaded this book (using ref to avoid dependency issues)
        if (currentBookId && loadedBookIdRef.current === currentBookId) {
            console.log('[Reader] Book already loaded, skipping');
            return;
        }

        // Reset loaded tracking when book ID changes or becomes null
        if (!currentBookId || loadedBookIdRef.current !== currentBookId) {
            loadedBookIdRef.current = null;
        }

        let isCancelled = false;

        const loadBook = async () => {
            if (!currentBookId) {
                console.log('[Reader] No currentBookId, skipping load');
                return;
            }

            const book = getBook(currentBookId);
            console.log('[Reader] Got book from store:', book?.id, 'storagePath:', book?.storagePath);
            if (!book) {
                setLoadError('Book not found in library');
                return;
            }

            // Reset state for new book
            setFile(null);
            setMetadata(null);
            setToc([]);
            setLocation(null);
            setInitialLocation(book.currentLocation);
            setLoadError(null);

            try {
                console.log('[Reader] Loading book file for:', book.id);
                const buffer = await readBookFile(book.storagePath || book.filePath, book.id);

                if (isCancelled) {
                    console.log('[Reader] Load cancelled');
                    return;
                }

                if (!buffer) {
                    throw new Error('Could not read book file from storage.');
                }

                // Create a proper File object
                const filename = book.filePath.split(/[/\\]/).pop() || 'book.epub';
                const mimeType = book.format === 'epub' ? 'application/epub+zip' :
                    book.format === 'pdf' ? 'application/pdf' :
                        'application/octet-stream';

                const fileObj = new File([buffer], filename, { type: mimeType });
                console.log('[Reader] File created, setting state...', fileObj.size, 'bytes');

                if (!isCancelled) {
                    loadedBookIdRef.current = book.id;
                    setFile(fileObj);
                }
            } catch (err) {
                if (isCancelled) return;
                console.error('[Reader] Failed to load book file:', err);
                setLoadError(err instanceof Error ? err.message : 'Unknown error loading book');
            }
        };

        loadBook();

        return () => {
            console.log('[Reader] Cleanup - setting cancelled for book:', currentBookId);
            isCancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentBookId]);

    // Auto-hide toolbar
    useEffect(() => {
        if (!settings.readerSettings.toolbarAutoHide) return;

        let timeout: ReturnType<typeof setTimeout>;
        let lastActivity = Date.now();

        const hideToolbar = () => {
            if (!activePanel && Date.now() - lastActivity > settings.readerSettings.autoHideDelay * 1000) {
                setShowToolbar(false);
            }
        };

        const showToolbarAndReset = () => {
            lastActivity = Date.now();
            setShowToolbar(true);
            clearTimeout(timeout);
            timeout = setTimeout(hideToolbar, settings.readerSettings.autoHideDelay * 1000);
        };

        window.addEventListener('mousemove', showToolbarAndReset, { passive: true });
        window.addEventListener('touchstart', showToolbarAndReset, { passive: true });

        timeout = setTimeout(hideToolbar, settings.readerSettings.autoHideDelay * 1000);

        return () => {
            clearTimeout(timeout);
            window.removeEventListener('mousemove', showToolbarAndReset);
            window.removeEventListener('touchstart', showToolbarAndReset);
        };
    }, [settings.readerSettings.toolbarAutoHide, settings.readerSettings.autoHideDelay, activePanel]);

    // Fullscreen effect - fixed
    useEffect(() => {
        const handleFullscreen = async () => {
            try {
                if (settings.readerSettings.fullscreen) {
                    if (!document.fullscreenElement) {
                        await document.documentElement.requestFullscreen();
                    }
                } else {
                    if (document.fullscreenElement) {
                        await document.exitFullscreen();
                    }
                }
            } catch (err) {
                console.error('Fullscreen error:', err);
            }
        };

        handleFullscreen();

        const onFullscreenChange = () => {
            if (!document.fullscreenElement && settings.readerSettings.fullscreen) {
                updateReaderSettings({ fullscreen: false });
            }
        };

        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, [settings.readerSettings.fullscreen, updateReaderSettings]);

    // Handle ready event
    const handleReady = useCallback((meta: DocMetadata, tocItems: TocItem[]) => {
        console.log('[Reader] Book ready:', meta.title);
        setMetadata(meta);
        setToc(tocItems);
    }, []);

    const handleSectionFractions = useCallback((fractions: number[]) => {
        setSectionFractions(fractions);
    }, []);

    // Handle location change
    const locationUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // Cleanup timeout on unmount
        return () => {
            if (locationUpdateRef.current) {
                clearTimeout(locationUpdateRef.current);
                locationUpdateRef.current = null;
            }
        };
    }, []);

    const handleLocationChange = useCallback((loc: DocLocation) => {
        setLocation(loc);

        // Debounced progress update
        if (locationUpdateRef.current) {
            clearTimeout(locationUpdateRef.current);
        }
        locationUpdateRef.current = setTimeout(() => {
            if (currentBookId) {
                updateProgress(currentBookId, loc.percentage, loc.cfi);
            }
        }, 500);
    }, [currentBookId, updateProgress]);

    // Handle navigation
    const goTo = useCallback(async (target: string) => {
        if (readerRef.current) {
            await readerRef.current.goTo(target);
        }
        setActivePanel(null);
    }, []);

    const handleSeek = useCallback((fraction: number) => {
        readerRef.current?.goToFraction(fraction);
    }, []);

    const handleBack = useCallback(() => {
        setRoute('library');
    }, [setRoute]);

    const handleTextSelected = useCallback((cfi: string, text: string) => {
        console.log('Text selected:', { cfi, text });
    }, []);

    // Error state
    if (loadError) {
        return (
            <div className="fixed inset-0 flex flex-col items-center justify-center p-8 text-center bg-[var(--color-background)]">
                <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-6 text-red-500">
                    <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
                    Failed to Load Book
                </h2>
                <p className="text-[var(--color-text-secondary)] mb-8 max-w-md">
                    {loadError}
                </p>
                <button
                    onClick={() => setRoute('library')}
                    className="px-6 py-2 bg-[var(--color-accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                    Back to Library
                </button>
            </div>
        );
    }

    return (
        <div
            className={cn(
                "fixed inset-0 flex flex-col",
                "bg-[var(--reader-bg,var(--color-background))]",
                `theme-${settings.readerSettings.theme}`
            )}
            style={{
                // Ensure proper background in fullscreen
                backgroundColor: 'var(--reader-bg, var(--color-background, #fff))',
            }}
        >
            {/* Toolbar - Absolutely positioned */}
            <div
                className={cn(
                    "absolute top-0 left-0 right-0 z-50 transition-transform duration-300",
                    showToolbar ? "translate-y-0" : "-translate-y-full"
                )}
            >
                <ReaderToolbar
                    metadata={metadata}
                    location={location}
                    visible={true}
                    onBack={handleBack}
                    onToggleToc={() => togglePanel('toc')}
                    onToggleSettings={() => togglePanel('settings')}
                    onToggleBookmarks={() => togglePanel('bookmarks')}
                    onToggleSearch={() => togglePanel('search')}
                    onToggleInfo={() => togglePanel('info')}
                    activePanel={activePanel}
                    fullscreen={settings.readerSettings.fullscreen}
                    onToggleFullscreen={() => updateReaderSettings({ fullscreen: !settings.readerSettings.fullscreen })}
                />
            </div>

            {/* Reader Viewport - fills full height with padding for toolbars */}
            <div className="flex-1 min-h-0 pt-14 pb-12">
                <ReaderViewport
                    key={currentBookId || 'no-book'}
                    ref={readerRef}
                    file={file}
                    settings={settings.readerSettings}
                    initialLocation={initialLocation}
                    onReady={handleReady}
                    onLocationChange={handleLocationChange}
                    onTextSelected={handleTextSelected}
                    onSectionFractions={handleSectionFractions}
                    className="w-full h-full"
                />
            </div>

            {/* Progress Bar - Full width like top toolbar */}
            <div className="fixed bottom-0 left-0 right-0 z-[100] pointer-events-none">
                <div className="pointer-events-auto bg-[var(--color-surface)]/95 backdrop-blur-lg border-t border-[var(--color-border)] px-4 py-2">
                    <ReaderProgressBar
                        location={location}
                        toc={toc}
                        sectionFractions={sectionFractions}
                        visible={true}
                        onSeek={handleSeek}
                        onNavigate={goTo}
                    />
                </div>
            </div>

            {/* Panels */}
            <TableOfContents
                toc={toc}
                visible={activePanel === 'toc'}
                onClose={() => setActivePanel(null)}
                onNavigate={goTo}
                currentHref={location?.tocItem?.href}
            />

            <ReaderSettings
                settings={settings.readerSettings}
                visible={activePanel === 'settings'}
                onClose={() => setActivePanel(null)}
                onUpdate={updateReaderSettings}
            />

            <ReaderBookmarks
                bookId={currentBookId || ''}
                visible={activePanel === 'bookmarks'}
                onClose={() => setActivePanel(null)}
                onNavigate={goTo}
            />

            <ReaderSearch
                visible={activePanel === 'search'}
                onClose={() => setActivePanel(null)}
                onNavigate={goTo}
                onSearch={(q) => readerRef.current?.search(q) || (async function* () { })()}
                onClearSearch={() => readerRef.current?.clearSearch()}
            />

            <BookInfoPopover
                metadata={metadata}
                visible={activePanel === 'info'}
                onClose={() => setActivePanel(null)}
            />

            {/* Brightness Overlay - REMOVED to fix interaction blocking */}
            {/* The brightness is now handled by CSS filters on the viewport container */}
        </div>
    );
}

export default ReaderPage;
