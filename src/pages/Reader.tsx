/**
 * Reader Page
 * Full-screen reading experience with document viewer and controls
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useUIStore, useLibraryStore, useSettingsStore } from '@/store';
import { HighlightColorPicker, HighlightMenu, NoteEditor, ResumeReadingDialog } from '@/components/reader';
import {
    ReaderViewport,
    WindowTitlebar,
    TableOfContents,
    ReaderSettings,
    ReaderBookmarks,
    ReaderSearch,
    BookInfoPopover,
    ReaderViewportHandle,
} from '@/components/reader';
import { DocLocation, DocMetadata, TocItem, HighlightColor, Annotation } from '@/types';
import { getBookBlob } from '@/lib/storage';

export function ReaderPage() {
    const { currentBookId, setRoute } = useUIStore();
    const { getBook, updateProgress, saveBookLocations } = useLibraryStore();
    const { settings, updateReaderSettings } = useSettingsStore();
    const readerRef = useRef<ReaderViewportHandle>(null);
    const loadedBookIdRef = useRef<string | null>(null);

    // File state
    const [file, setFile] = useState<File | Blob | null>(null);
    const [metadata, setMetadata] = useState<DocMetadata | null>(null);
    const [toc, setToc] = useState<TocItem[]>([]);
    const [location, setLocation] = useState<DocLocation | null>(null);
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
        if (currentBookId && loadedBookIdRef.current === currentBookId) {
            return;
        }

        if (!currentBookId || loadedBookIdRef.current !== currentBookId) {
            loadedBookIdRef.current = null;
        }

        let isCancelled = false;

        const loadBook = async () => {
            if (!currentBookId) return;

            const book = getBook(currentBookId);
            if (!book) {
                setLoadError('Book not found in library');
                return;
            }

            setFile(null);
            setMetadata(null);
            setToc([]);
            setLocation(null);
            setIsBookReady(false);
            setInitialLocation(book.currentLocation);
            setLoadError(null);
            
            // Check if we should show resume dialog
            if (book.progress && book.progress > 0.05 && book.progress < 0.99) {
                setSavedProgress(book.progress);
                setShowResumeDialog(true);
            } else {
                setShowResumeDialog(false);
            }

            try {
                const blob = await getBookBlob(book.id, book.storagePath || book.filePath);
                if (isCancelled) return;
                if (!blob) {
                    throw new Error('Could not read book file from storage.');
                }
                if (!isCancelled) {
                    loadedBookIdRef.current = book.id;
                    setFile(blob);
                }
            } catch (err) {
                if (!isCancelled) {
                    setLoadError(err instanceof Error ? err.message : 'Unknown error loading book');
                }
            }
        };

        loadBook();
        return () => { isCancelled = true; };
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

    // Fullscreen effect
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

    const handleReady = useCallback((meta: DocMetadata, tocItems: TocItem[]) => {
        setMetadata(meta);
        setToc(tocItems);
        setIsBookReady(true);
    }, []);

    const lastClickFractionRef = useRef<number | null>(null);

    const handleLocationChange = useCallback((loc: DocLocation) => {
        setLocation(loc);
        if (currentBookId) {
            const safePercentage = Math.max(0, Math.min(1, loc.percentage || 0));
            const safeCfi = loc.cfi || '';
            const lastClickFraction = lastClickFractionRef.current ?? undefined;
            const pageProgress = loc.pageInfo ? {
                currentPage: loc.pageInfo.currentPage,
                endPage: loc.pageInfo.endPage,
                totalPages: loc.pageInfo.totalPages,
                range: loc.pageInfo.range || `${loc.pageInfo.currentPage}`,
            } : undefined;

            queueMicrotask(() => {
                updateProgress(currentBookId, safePercentage, safeCfi, lastClickFraction, pageProgress);
            });
            lastClickFractionRef.current = null;
        }
    }, [currentBookId, updateProgress]);

    const goTo = useCallback(async (target: string) => {
        if (readerRef.current) {
            await readerRef.current.goTo(target);
        }
        setActivePanel(null);
    }, []);

    const handleSeek = useCallback((fraction: number) => {
        lastClickFractionRef.current = fraction;
        if (readerRef.current) {
            readerRef.current.goToFraction(fraction);
        }
    }, []);

    const handleBack = useCallback(() => {
        setRoute('library');
    }, [setRoute]);

    // Highlight state
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [colorPickerPosition, setColorPickerPosition] = useState({ x: 0, y: 0 });
    const [selectedText, setSelectedText] = useState('');
    const [selectedCfi, setSelectedCfi] = useState('');
    const [showHighlightMenu, setShowHighlightMenu] = useState(false);
    const [highlightMenuPosition, setHighlightMenuPosition] = useState({ x: 0, y: 0 });
    const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    
    // Note editor state
    const [showNoteEditor, setShowNoteEditor] = useState(false);
    const [noteEditorPosition, setNoteEditorPosition] = useState({ x: 0, y: 0 });
    const [editingNote, setEditingNote] = useState('');
    const [pendingHighlightColor, setPendingHighlightColor] = useState<HighlightColor>('yellow');
    
    // Resume reading state
    const [showResumeDialog, setShowResumeDialog] = useState(false);
    const [savedProgress, setSavedProgress] = useState(0);

    const { addAnnotation, removeAnnotation, getBookAnnotations, updateAnnotation } = useLibraryStore();

    // Track when book is ready
    const [isBookReady, setIsBookReady] = useState(false);

    // Load annotations when book changes and is ready
    useEffect(() => {
        if (currentBookId && isBookReady) {
            const bookAnnotations = getBookAnnotations(currentBookId);
            setAnnotations(bookAnnotations);
            // Load annotations into viewport (with delay to ensure foliate is ready)
            const timer = setTimeout(() => {
                readerRef.current?.loadAnnotations?.(bookAnnotations).catch((err: Error) => {
                    console.warn('[Reader] Failed to load annotations:', err);
                });
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [currentBookId, getBookAnnotations, isBookReady]);

    const handleTextSelected = useCallback((cfi: string, text: string, rangeOrEvent?: Range | MouseEvent) => {
        console.debug('[Reader] Text selected:', { cfi: cfi.substring(0, 50), text: text.substring(0, 50) });
        
        if (!cfi || !text.trim()) {
            console.debug('[Reader] Empty selection, ignoring');
            return;
        }
        
        setSelectedCfi(cfi);
        setSelectedText(text);
        
        // Position color picker near selection
        if (rangeOrEvent && 'clientX' in rangeOrEvent) {
            // It's a MouseEvent
            setColorPickerPosition({ x: rangeOrEvent.clientX, y: rangeOrEvent.clientY - 60 });
        } else if (rangeOrEvent && 'getBoundingClientRect' in rangeOrEvent) {
            // It's a Range - use the rect for positioning
            const rect = rangeOrEvent.getBoundingClientRect();
            setColorPickerPosition({ x: rect.left + rect.width / 2, y: rect.top - 60 });
        } else {
            // Fallback to center of screen
            setColorPickerPosition({ x: window.innerWidth / 2 - 100, y: 100 });
        }
        
        console.debug('[Reader] Showing color picker at:', colorPickerPosition);
        setShowColorPicker(true);
    }, []);

    const handleColorSelect = useCallback((color: HighlightColor) => {
        if (!selectedCfi || !currentBookId) return;

        const annotation: Annotation = {
            id: crypto.randomUUID(),
            bookId: currentBookId,
            type: 'highlight',
            location: selectedCfi,
            selectedText,
            color,
            createdAt: new Date(),
        };

        addAnnotation(annotation);
        setAnnotations(prev => [...prev, annotation]);
        
        // Add to viewport
        readerRef.current?.addHighlight?.(selectedCfi, selectedText, color);
        
        setShowColorPicker(false);
        setSelectedText('');
        setSelectedCfi('');
        
        // Clear selection
        readerRef.current?.clearSelection?.();
    }, [selectedCfi, selectedText, currentBookId, addAnnotation]);

    const handleAddNote = useCallback(() => {
        if (!selectedCfi || !currentBookId) return;

        // Close color picker and open note editor
        setShowColorPicker(false);
        setNoteEditorPosition(colorPickerPosition);
        setEditingNote('');
        setPendingHighlightColor('yellow');
        setShowNoteEditor(true);
    }, [selectedCfi, currentBookId, colorPickerPosition]);

    const handleSaveNote = useCallback((noteContent: string) => {
        if (!selectedCfi || !currentBookId) return;

        const annotation: Annotation = {
            id: crypto.randomUUID(),
            bookId: currentBookId,
            type: noteContent ? 'note' : 'highlight',
            location: selectedCfi,
            selectedText,
            color: pendingHighlightColor,
            noteContent: noteContent || undefined,
            createdAt: new Date(),
        };

        addAnnotation(annotation);
        setAnnotations(prev => [...prev, annotation]);
        
        // Add highlight to viewport
        readerRef.current?.addHighlight?.(selectedCfi, selectedText, pendingHighlightColor);
        
        setShowNoteEditor(false);
        setSelectedText('');
        setSelectedCfi('');
        setEditingNote('');
        
        // Clear selection
        readerRef.current?.clearSelection?.();
    }, [selectedCfi, selectedText, currentBookId, addAnnotation, pendingHighlightColor]);

    const handleBookmarkFromSelection = useCallback(() => {
        if (!selectedCfi || !currentBookId) return;

        const annotation: Annotation = {
            id: crypto.randomUUID(),
            bookId: currentBookId,
            type: 'bookmark',
            location: selectedCfi,
            selectedText,
            createdAt: new Date(),
        };

        addAnnotation(annotation);
        setAnnotations(prev => [...prev, annotation]);
        
        setShowColorPicker(false);
        setSelectedText('');
        setSelectedCfi('');
        
        readerRef.current?.clearSelection?.();
    }, [selectedCfi, selectedText, currentBookId, addAnnotation]);

    const handleDeleteAnnotation = useCallback(() => {
        if (!activeAnnotation) return;
        
        removeAnnotation(activeAnnotation.id);
        setAnnotations(prev => prev.filter(a => a.id !== activeAnnotation.id));
        
        // Remove from viewport
        readerRef.current?.removeHighlight?.(activeAnnotation.id);
        
        setShowHighlightMenu(false);
        setActiveAnnotation(null);
    }, [activeAnnotation, removeAnnotation]);

    const handleCopyText = useCallback(() => {
        if (activeAnnotation?.selectedText) {
            navigator.clipboard.writeText(activeAnnotation.selectedText);
        }
        setShowHighlightMenu(false);
    }, [activeAnnotation]);

    const handleLocationsSaved = useCallback((locations: string) => {
        if (currentBookId) {
            saveBookLocations(currentBookId, locations);
        }
    }, [currentBookId, saveBookLocations]);

    // Error state
    if (loadError) {
        return (
            <div className="fixed inset-0 flex flex-col items-center justify-center p-8 text-center bg-[var(--color-background)]">
                <div className="w-16 h-16 rounded-full bg-[var(--color-error)]/10 flex items-center justify-center mb-6 text-[var(--color-error)]">
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
                    className="px-6 py-2 bg-[var(--color-accent)] text-[var(--color-surface)] rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                    Back to Library
                </button>
            </div>
        );
    }

    return (
        <div
            className={cn(
                "fixed inset-0 flex flex-col overflow-hidden",
                `theme-${settings.readerSettings.theme}`
            )}
            style={{
                backgroundColor: 'var(--reader-bg)',
                overscrollBehavior: 'none',
                // Brightness applied to ENTIRE screen including all UI
                filter: `brightness(${settings.readerSettings.brightness}%)`,
            }}
            data-reading-mode={settings.readerSettings.flow}
        >
            {/* Toolbar */}
            <div
                className={cn(
                    "absolute top-0 left-0 right-0 z-50 transition-transform duration-300",
                    showToolbar ? "translate-y-0" : "-translate-y-full"
                )}
            >
                <WindowTitlebar
                    metadata={metadata}
                    location={location}
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

            {/* Reader Viewport */}
            <div className="flex-1 min-h-0 pt-14 pb-12">
                <ReaderViewport
                    key={currentBookId || 'no-book'}
                    ref={readerRef}
                    file={file}
                    settings={settings.readerSettings}
                    initialLocation={initialLocation}
                    savedLocations={getBook(currentBookId || '')?.locations}
                    onReady={handleReady}
                    onLocationChange={handleLocationChange}
                    onLocationsSaved={handleLocationsSaved}
                    onTextSelected={handleTextSelected}
                    className="w-full h-full"
                />
            </div>

            {/* Panels - All affected by brightness filter */}
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

            {/* Resume Reading Dialog */}
            <ResumeReadingDialog
                isVisible={showResumeDialog}
                progress={savedProgress}
                onDismiss={() => setShowResumeDialog(false)}
                onRestart={() => {
                    // Go to beginning of book
                    readerRef.current?.goToFraction?.(0);
                    setShowResumeDialog(false);
                }}
            />

            {/* Highlight Color Picker Popup */}
            <HighlightColorPicker
                isOpen={showColorPicker}
                position={colorPickerPosition}
                selectedText={selectedText}
                onSelectColor={handleColorSelect}
                onAddNote={handleAddNote}
                onBookmark={handleBookmarkFromSelection}
                onClose={() => {
                    setShowColorPicker(false);
                    readerRef.current?.clearSelection?.();
                }}
            />

            {/* Highlight Menu (for existing highlights) */}
            <HighlightMenu
                isOpen={showHighlightMenu}
                position={highlightMenuPosition}
                annotation={activeAnnotation}
                onEditNote={() => {
                    if (activeAnnotation) {
                        setNoteEditorPosition(highlightMenuPosition);
                        setEditingNote(activeAnnotation.noteContent || '');
                        setSelectedCfi(activeAnnotation.location);
                        setSelectedText(activeAnnotation.selectedText || '');
                        setPendingHighlightColor(activeAnnotation.color || 'yellow');
                        setShowNoteEditor(true);
                        setShowHighlightMenu(false);
                    }
                }}
                onDelete={handleDeleteAnnotation}
                onCopyText={handleCopyText}
                onClose={() => {
                    setShowHighlightMenu(false);
                    setActiveAnnotation(null);
                }}
            />

            {/* Note Editor */}
            <NoteEditor
                isOpen={showNoteEditor}
                position={noteEditorPosition}
                initialNote={editingNote}
                selectedText={selectedText}
                onSave={handleSaveNote}
                onClose={() => {
                    setShowNoteEditor(false);
                    setEditingNote('');
                    readerRef.current?.clearSelection?.();
                }}
            />
        </div>
    );
}

export default ReaderPage;
