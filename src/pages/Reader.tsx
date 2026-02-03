/**
 * Reader Page
 * Full-screen reading experience with document viewer and controls
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useUIStore, useLibraryStore, useSettingsStore } from '@/store';
import { HighlightColorPicker, NoteEditor } from '@/components/reader';
import {
    ReaderViewport,
    WindowTitlebar,
    TableOfContents,
    ReaderSettings,
    ReaderAnnotationsPanel,
    ReaderSearch,
    BookInfoPopover,
    ReaderViewportHandle,
    ReaderNavbar,
} from '@/components/reader';
import { DocLocation, DocMetadata, TocItem, HighlightColor, Annotation } from '@/types';
import { getBookBlob } from '@/lib/storage';

export function ReaderPage() {
    const { currentBookId, setRoute } = useUIStore();
    const { getBook, updateProgress, saveBookLocations, addReadingTime, markBookCompleted } = useLibraryStore();
    const { settings, updateReaderSettings, stats, updateStats } = useSettingsStore();
    const readerRef = useRef<ReaderViewportHandle>(null);
    const loadedBookIdRef = useRef<string | null>(null);

    // Reading time tracking
    const readingStartTimeRef = useRef<number | null>(null);
    const readingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // File state
    const [file, setFile] = useState<File | Blob | null>(null);
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
    const [initialFraction, setInitialFraction] = useState<number | undefined>(undefined);
    const suppressProgressRef = useRef(false);
    const resumeTargetRef = useRef<string | null>(null);
    const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasAppliedInitialLocationRef = useRef(false);

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
            const nextLocation = book.currentLocation || undefined;
            setInitialLocation(nextLocation);
            // Use lastClickFraction if available, otherwise use progress but NOT if book is nearly complete
            // This prevents jumping to the end when reopening a completed book
            const progressFallback = book.progress !== undefined && book.progress < 0.95 ? book.progress : undefined;
            const fractionToUse = book.lastClickFraction ?? progressFallback;
            setInitialFraction(fractionToUse);
            console.debug('[Reader] Resume state:', {
                currentLocation: nextLocation?.substring(0, 50),
                lastClickFraction: book.lastClickFraction,
                progress: book.progress,
                usingFraction: fractionToUse,
            });
            suppressProgressRef.current = !!nextLocation || fractionToUse !== undefined;
            resumeTargetRef.current = nextLocation || null;
            hasAppliedInitialLocationRef.current = false;
            if (resumeTimeoutRef.current) {
                clearTimeout(resumeTimeoutRef.current);
            }
            setLoadError(null);

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

    // Track reading time
    useEffect(() => {
        if (!currentBookId) return;

        // Start tracking when book is loaded
        readingStartTimeRef.current = Date.now();
        
        // Update every minute
        readingIntervalRef.current = setInterval(() => {
            if (currentBookId && readingStartTimeRef.current) {
                const elapsedMinutes = Math.floor((Date.now() - readingStartTimeRef.current) / 60000);
                if (elapsedMinutes > 0) {
                    // Add reading time to book
                    addReadingTime(currentBookId, 1);
                    
                    // Update global stats
                    const today = new Date().toISOString().split('T')[0];
                    const existingActivity = stats.dailyActivity.find(a => a.date === today);
                    
                    let newDailyActivity;
                    if (existingActivity) {
                        newDailyActivity = stats.dailyActivity.map(a => 
                            a.date === today 
                                ? { ...a, minutes: a.minutes + 1, booksRead: [...new Set([...a.booksRead, currentBookId])] }
                                : a
                        );
                    } else {
                        newDailyActivity = [...stats.dailyActivity, {
                            date: today,
                            minutes: 1,
                            booksRead: [currentBookId]
                        }];
                    }
                    
                    // Keep only last 84 days (12 weeks)
                    if (newDailyActivity.length > 84) {
                        newDailyActivity = newDailyActivity.slice(-84);
                    }
                    
                    // Calculate streak
                    const sortedActivity = [...newDailyActivity].sort((a, b) => 
                        new Date(b.date).getTime() - new Date(a.date).getTime()
                    );
                    
                    let currentStreak = 0;
                    const todayStr = new Date().toISOString().split('T')[0];
                    const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];
                    
                    // Check if read today or yesterday to maintain streak
                    const lastReadDate = sortedActivity[0]?.date;
                    if (lastReadDate === todayStr || lastReadDate === yesterdayStr) {
                        currentStreak = 1;
                        for (let i = 1; i < sortedActivity.length; i++) {
                            const prevDate = new Date(sortedActivity[i - 1].date);
                            const currDate = new Date(sortedActivity[i].date);
                            const diffDays = (prevDate.getTime() - currDate.getTime()) / 86400000;
                            if (diffDays === 1) {
                                currentStreak++;
                            } else {
                                break;
                            }
                        }
                    }
                    
                    updateStats({
                        totalReadingTime: stats.totalReadingTime + 1,
                        dailyActivity: newDailyActivity,
                        currentStreak,
                        longestStreak: Math.max(stats.longestStreak, currentStreak),
                        lastReadDate: today,
                    });
                    
                    // Reset start time for next minute
                    readingStartTimeRef.current = Date.now();
                }
            }
        }, 60000); // Every minute

        return () => {
            if (readingIntervalRef.current) {
                clearInterval(readingIntervalRef.current);
            }
            
            // Save any remaining partial minute on unmount
            if (currentBookId && readingStartTimeRef.current) {
                const elapsedMinutes = Math.floor((Date.now() - readingStartTimeRef.current) / 60000);
                if (elapsedMinutes > 0) {
                    addReadingTime(currentBookId, elapsedMinutes);
                }
            }
        };
    }, [currentBookId, addReadingTime, updateStats, stats]);

    useEffect(() => {
        return () => {
            if (resumeTimeoutRef.current) {
                clearTimeout(resumeTimeoutRef.current);
            }
        };
    }, []);

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
        // Get section fractions from the reader after it's ready
        // Use a small delay to ensure the engine has processed the book
        setTimeout(() => {
            const fractions = readerRef.current?.getSectionFractions() ?? [];
            setSectionFractions(fractions);
        }, 100);
    }, []);

    const lastClickFractionRef = useRef<number | null>(null);

    const handleLocationChange = useCallback((loc: DocLocation) => {
        setLocation(loc);
        
        // Suppress the first few location updates to avoid overwriting saved progress
        // The engine navigates to the saved location, which triggers relocate events
        if (suppressProgressRef.current) {
            const target = resumeTargetRef.current;
            
            console.debug('[Reader] Location change while suppressed:', {
                hasTarget: !!target,
                targetCfi: target?.substring(0, 50),
                currentCfi: loc.cfi?.substring(0, 50),
                percentage: loc.percentage,
            });
            
            // If we have a target CFI and current location matches it, we've arrived
            if (target && loc.cfi && loc.cfi.startsWith(target)) {
                console.debug('[Reader] ✓ Arrived at resume target, clearing suppression');
                suppressProgressRef.current = false;
                resumeTargetRef.current = null;
                hasAppliedInitialLocationRef.current = true;
                if (resumeTimeoutRef.current) {
                    clearTimeout(resumeTimeoutRef.current);
                    resumeTimeoutRef.current = null;
                }
                return; // Don't save this location change
            }
            
            // If we have a target CFI but current location doesn't match, CFI is invalid
            if (target && loc.cfi && !loc.cfi.startsWith(target)) {
                console.warn('[Reader] ✗ Invalid CFI target, clearing saved location');
                if (currentBookId) {
                    updateProgress(currentBookId, 0, '', undefined);
                }
                suppressProgressRef.current = false;
                resumeTargetRef.current = null;
                hasAppliedInitialLocationRef.current = true;
                if (resumeTimeoutRef.current) {
                    clearTimeout(resumeTimeoutRef.current);
                    resumeTimeoutRef.current = null;
                }
                return; // Don't save this location change
            }
            
            // If no target (using fraction) or first location update, clear suppression after a timeout
            if (!resumeTimeoutRef.current) {
                console.debug('[Reader] Starting suppression timeout (1000ms)');
                resumeTimeoutRef.current = setTimeout(() => {
                    console.debug('[Reader] Suppression timeout expired');
                    suppressProgressRef.current = false;
                    resumeTargetRef.current = null;
                    resumeTimeoutRef.current = null;
                }, 1000);
            }
            
            return; // Don't save while suppressed
        }
        
        if (currentBookId) {
            console.debug('[Reader] Saving location update:', {
                cfi: loc.cfi?.substring(0, 50),
                percentage: loc.percentage,
            });
            
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
                
                // Check if book is completed (>= 99% progress)
                if (safePercentage >= 0.99 && currentBookId) {
                    const result = markBookCompleted(currentBookId);
                    if (result && !result.wasAlreadyCompleted) {
                        const currentYear = new Date().getFullYear();
                        updateStats({
                            booksCompleted: stats.booksCompleted + 1,
                            booksReadThisYear: result.completedYear === currentYear 
                                ? stats.booksReadThisYear + 1 
                                : stats.booksReadThisYear
                        });
                    }
                }
            });
            lastClickFractionRef.current = null;
        }
    }, [currentBookId, updateProgress, markBookCompleted, updateStats, stats]);

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
    const [activeAnnotation, setActiveAnnotation] = useState<Annotation | null>(null);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [editingHighlightId, setEditingHighlightId] = useState<string | null>(null);

    // Note editor state
    const [showNoteEditor, setShowNoteEditor] = useState(false);
    const [noteEditorPosition, setNoteEditorPosition] = useState({ x: 0, y: 0 });
    const [editingNote, setEditingNote] = useState('');
    const [pendingHighlightColor, setPendingHighlightColor] = useState<HighlightColor>('yellow');

    const { addAnnotation, removeAnnotation, getBookAnnotations, updateAnnotation } = useLibraryStore();

    // Track when book is ready
    const [isBookReady, setIsBookReady] = useState(false);

    // Check if current page is bookmarked
    const isCurrentPageBookmarked = annotations.some(
        a => a.type === 'bookmark' && a.location === location?.cfi
    );

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

    useEffect(() => {
        if (!isBookReady || !readerRef.current || hasAppliedInitialLocationRef.current) return;
        
        // If we have a CFI location, the engine should have handled it during open()
        // We only need to use fraction fallback if there's no CFI
        if (initialLocation) {
            console.debug('[Reader] CFI was provided, engine should have navigated');
            hasAppliedInitialLocationRef.current = true;
            return;
        }
        
        if (typeof initialFraction === 'number') {
            console.debug('[Reader] No CFI, using fraction fallback:', initialFraction);
            hasAppliedInitialLocationRef.current = true;
            // Small delay to ensure view is fully ready
            setTimeout(() => {
                readerRef.current?.goToFraction(initialFraction);
            }, 100);
        }
    }, [isBookReady, initialLocation, initialFraction]);

    const handleTextSelected = useCallback((cfi: string, text: string, rangeOrEvent?: Range | MouseEvent) => {
        console.debug('[Reader] Text selected:', { cfi: cfi.substring(0, 50), text: text.substring(0, 50) });
        
        // Always fetch fresh annotations from store to avoid stale state
        const freshAnnotations = currentBookId ? getBookAnnotations(currentBookId) : [];
        console.debug('[Reader] Fresh annotations from store:', freshAnnotations.length);
        console.debug('[Reader] Available highlight/note annotations:', freshAnnotations.filter(a => a.type === 'highlight' || a.type === 'note').map(a => ({ id: a.id.substring(0, 8), loc: a.location?.substring(0, 40), text: a.selectedText?.substring(0, 30) })));

        if (!cfi) {
            console.debug('[Reader] Empty CFI, ignoring');
            return;
        }

        // Robust duplicate detection: check CFI (exact or partial), then text content
        // This prevents duplicates when CFIs vary slightly for the same text
        let existingAnnotation = freshAnnotations.find(a => {
            // Match by exact CFI for highlights/notes
            if (a.location === cfi && (a.type === 'highlight' || a.type === 'note')) {
                console.debug('[Reader] Matched annotation by exact CFI:', a.id);
                return true;
            }
            // Partial CFI match: one is prefix of the other (handles CFI variations)
            if (a.location && cfi && (a.type === 'highlight' || a.type === 'note')) {
                const isPrefixMatch = cfi.startsWith(a.location) || a.location.startsWith(cfi);
                if (isPrefixMatch) {
                    console.debug('[Reader] Matched annotation by partial CFI:', a.id, { cfi: cfi.substring(0, 40), stored: a.location.substring(0, 40) });
                    return true;
                }
            }
            // Fallback: match by text content if text is provided and long enough
            // This handles cases where CFIs differ slightly for the same selection
            if (text && text.length > 3 && a.selectedText && 
                a.type !== 'bookmark' &&
                a.selectedText.trim() === text.trim()) {
                console.debug('[Reader] Matched annotation by text content:', a.id);
                return true;
            }
            return false;
        });

        // If no highlight/note found, check for bookmark at exact location
        if (!existingAnnotation) {
            existingAnnotation = freshAnnotations.find(a => a.location === cfi);
        }

        if (existingAnnotation) {
            // Show color picker for existing annotation
            console.debug('[Reader] ✓ Found existing annotation:', existingAnnotation.id, existingAnnotation.type, '- setting editingHighlightId');
            setActiveAnnotation(existingAnnotation);
            setEditingHighlightId(existingAnnotation.id);
            console.debug('[Reader] editingHighlightId set to:', existingAnnotation.id);
            setSelectedCfi(existingAnnotation.location); // Use stored location for consistency
            setSelectedText(existingAnnotation.selectedText || text || '');

            // Position color picker - improved positioning logic
            if (rangeOrEvent && 'clientX' in rangeOrEvent) {
                // Mouse event - position near click
                const mouseEvent = rangeOrEvent as MouseEvent;
                console.debug('[Reader] Positioning color picker from mouse event:', mouseEvent.clientX, mouseEvent.clientY);
                setColorPickerPosition({ x: mouseEvent.clientX, y: mouseEvent.clientY });
            } else if (rangeOrEvent && 'getBoundingClientRect' in rangeOrEvent) {
                // Range object - position at top-center of range
                const rect = rangeOrEvent.getBoundingClientRect();
                console.debug('[Reader] Positioning color picker from range rect:', rect.left, rect.top, rect.width, rect.height);
                setColorPickerPosition({ x: rect.left + rect.width / 2, y: rect.top });
            } else {
                // Fallback to center of screen
                console.debug('[Reader] Positioning color picker at screen center (fallback)');
                setColorPickerPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
            }

            setShowColorPicker(true);
        } else {
            // Show color picker for new text selection
            console.debug('[Reader] ✗ No existing annotation found - treating as new selection');
            if (!text.trim()) {
                console.debug('[Reader] Empty text selection, ignoring');
                return;
            }
            
            // Clear any previous editing state for new selections
            setEditingHighlightId(null);
            setActiveAnnotation(null);
            setSelectedCfi(cfi);
            setSelectedText(text);
            
            // Position color picker near selection - improved positioning logic
            if (rangeOrEvent && 'clientX' in rangeOrEvent) {
                const mouseEvent = rangeOrEvent as MouseEvent;
                console.debug('[Reader] Positioning color picker for new selection from mouse:', mouseEvent.clientX, mouseEvent.clientY);
                setColorPickerPosition({ x: mouseEvent.clientX, y: mouseEvent.clientY });
            } else if (rangeOrEvent && 'getBoundingClientRect' in rangeOrEvent) {
                const rect = rangeOrEvent.getBoundingClientRect();
                console.debug('[Reader] Positioning color picker for new selection from range:', rect.left, rect.top);
                setColorPickerPosition({ x: rect.left + rect.width / 2, y: rect.top });
            } else {
                console.debug('[Reader] Positioning color picker at screen center (fallback)');
                setColorPickerPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
            }
            
            console.debug('[Reader] Showing color picker at calculated position');
            setShowColorPicker(true);
        }
    }, [currentBookId, getBookAnnotations, colorPickerPosition]);

    const handleColorSelect = useCallback(async (color: HighlightColor) => {
        if (!selectedCfi || !currentBookId) return;

        // Get fresh annotations from store
        const freshAnnotations = getBookAnnotations(currentBookId);

        // If editing an existing highlight, update it
        if (editingHighlightId) {
            const existingAnnotation = freshAnnotations.find(a => a.id === editingHighlightId);
            if (existingAnnotation) {
                // Update the annotation color in store
                updateAnnotation(editingHighlightId, { color });
                setAnnotations(prev => prev.map(a =>
                    a.id === editingHighlightId ? { ...a, color, updatedAt: new Date() } : a
                ));

                // Update in viewport - remove and re-add with new color (preserve ID)
                // Must await to ensure operations complete in order
                try {
                    await readerRef.current?.removeHighlight?.(editingHighlightId);
                    const updatedAnnotation: Annotation = { ...existingAnnotation, color, updatedAt: new Date() };
                    await readerRef.current?.addAnnotation?.(updatedAnnotation);
                    console.debug('[Reader] Updated existing highlight color:', editingHighlightId, color);
                } catch (err) {
                    console.warn('[Reader] Failed to update highlight in viewport:', err);
                }
            }

            setShowColorPicker(false);
            setEditingHighlightId(null);
            setActiveAnnotation(null);
            setSelectedText('');
            setSelectedCfi('');
            // Clear selection
            readerRef.current?.clearSelection?.();
            return;
        }

        // Check for existing highlight at this location/text before creating new
        // This is a safety net in case handleTextSelected missed it
        const existingHighlight = freshAnnotations.find(a => 
            (a.type === 'highlight' || a.type === 'note') &&
            (a.location === selectedCfi || (a.selectedText && a.selectedText.trim() === selectedText.trim()))
        );

        if (existingHighlight) {
            // Update existing highlight with new color instead of creating duplicate
            console.debug('[Reader] Found existing highlight, updating color instead of creating duplicate:', existingHighlight.id);
            updateAnnotation(existingHighlight.id, { color });
            setAnnotations(prev => prev.map(a =>
                a.id === existingHighlight.id ? { ...a, color, updatedAt: new Date() } : a
            ));

            // Update in viewport - must await
            try {
                await readerRef.current?.removeHighlight?.(existingHighlight.id);
                const updatedAnnotation: Annotation = { ...existingHighlight, color, updatedAt: new Date() };
                await readerRef.current?.addAnnotation?.(updatedAnnotation);
            } catch (err) {
                console.warn('[Reader] Failed to update highlight in viewport:', err);
            }
        } else {
            // Create new highlight - get annotation from engine with its ID
            try {
                const annotation = await readerRef.current?.addHighlight?.(selectedCfi, selectedText, color);
                if (annotation) {
                    // Ensure the annotation has the correct bookId
                    const annotationWithBookId = { ...annotation, bookId: currentBookId };
                    // Use the annotation from the engine (which has the correct ID)
                    addAnnotation(annotationWithBookId);
                    setAnnotations(prev => [...prev, annotationWithBookId]);
                    console.debug('[Reader] Created new highlight:', annotationWithBookId.id);
                } else {
                    console.warn('[Reader] addHighlight returned null/undefined');
                }
            } catch (err) {
                console.warn('[Reader] Failed to add highlight to viewport:', err);
            }
        }

        setShowColorPicker(false);
        setEditingHighlightId(null);
        setActiveAnnotation(null);
        setSelectedText('');
        setSelectedCfi('');

        // Clear selection
        readerRef.current?.clearSelection?.();
    }, [selectedCfi, selectedText, currentBookId, addAnnotation, editingHighlightId, annotations, updateAnnotation]);

    const handleAddNote = useCallback(() => {
        if (!selectedCfi || !currentBookId) return;

        console.debug('[Reader] Opening note editor, editingHighlightId:', editingHighlightId, 'activeAnnotation:', activeAnnotation?.id);

        // Close color picker and open note editor
        setShowColorPicker(false);
        setNoteEditorPosition(colorPickerPosition);

        // If editing existing highlight, use its note content and color
        // Preserve editingHighlightId for handleSaveNote to use
        if (editingHighlightId && activeAnnotation) {
            setEditingNote(activeAnnotation.noteContent || '');
            setPendingHighlightColor(activeAnnotation.color || 'yellow');
            console.debug('[Reader] Editing existing highlight, preserving ID:', editingHighlightId);
        } else {
            setEditingNote('');
            setPendingHighlightColor('yellow');
            console.debug('[Reader] Creating new highlight with note');
        }

        setShowNoteEditor(true);
    }, [selectedCfi, currentBookId, colorPickerPosition, editingHighlightId, activeAnnotation]);

    const handleSaveNote = useCallback(async (noteContent: string) => {
        if (!selectedCfi || !currentBookId) return;

        // PRIORITY 1: Use editingHighlightId if available (most reliable)
        let existingHighlight = editingHighlightId
            ? annotations.find(a => a.id === editingHighlightId)
            : null;

        // PRIORITY 2: Fallback to CFI match
        if (!existingHighlight) {
            existingHighlight = annotations.find(a => 
                (a.type === 'highlight' || a.type === 'note') && 
                a.location === selectedCfi
            );
        }

        // PRIORITY 3: Text content match as last resort
        if (!existingHighlight && selectedText) {
            existingHighlight = annotations.find(a => 
                (a.type === 'highlight' || a.type === 'note') &&
                a.selectedText?.trim() === selectedText.trim()
            );
        }

        if (existingHighlight) {
            // Update existing highlight with note using updateAnnotation to preserve ID
            console.debug('[Reader] Adding note to existing highlight:', existingHighlight.id);
            updateAnnotation(existingHighlight.id, {
                type: noteContent ? 'note' : 'highlight',
                noteContent: noteContent || undefined,
            });

            // Update local state to reflect changes immediately
            setAnnotations(prev => prev.map(a =>
                a.id === existingHighlight!.id
                    ? { ...a, type: noteContent ? 'note' : 'highlight', noteContent: noteContent || undefined, updatedAt: new Date() }
                    : a
            ));

            // Re-render in viewport to show note indicator
            // Must await to ensure remove completes before add
            try {
                await readerRef.current?.removeHighlight?.(existingHighlight.id);
                const updatedAnnotation: Annotation = { 
                    ...existingHighlight, 
                    type: noteContent ? 'note' : 'highlight',
                    noteContent: noteContent || undefined, 
                    updatedAt: new Date() 
                };
                await readerRef.current?.addAnnotation?.(updatedAnnotation);
                console.debug('[Reader] Re-rendered highlight with note in viewport');
            } catch (err) {
                console.warn('[Reader] Failed to re-render highlight with note:', err);
            }
        } else {
            // Create new highlight with note
            console.debug('[Reader] Creating new highlight with note');
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
            try {
                await readerRef.current?.addHighlight?.(selectedCfi, selectedText, pendingHighlightColor);
            } catch (err) {
                console.warn('[Reader] Failed to add highlight with note to viewport:', err);
            }
        }

        setShowNoteEditor(false);
        setEditingHighlightId(null);
        setActiveAnnotation(null);
        setSelectedText('');
        setSelectedCfi('');
        setEditingNote('');
        setPendingHighlightColor('yellow');

        // Clear selection
        readerRef.current?.clearSelection?.();
    }, [selectedCfi, selectedText, currentBookId, annotations, addAnnotation, updateAnnotation, editingHighlightId, pendingHighlightColor]);

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

    const handleAddPageBookmark = useCallback(() => {
        if (!currentBookId || !location) return;

        // Check if bookmark already exists for this location
        const existingBookmark = annotations.find(
            a => a.type === 'bookmark' && a.location === location.cfi
        );

        if (existingBookmark) {
            // Remove existing bookmark (toggle off)
            removeAnnotation(existingBookmark.id);
            setAnnotations(prev => prev.filter(a => a.id !== existingBookmark.id));
        } else {
            // Add new bookmark
            const annotation: Annotation = {
                id: crypto.randomUUID(),
                bookId: currentBookId,
                type: 'bookmark',
                location: location.cfi || '',
                selectedText: location.tocItem?.label || `Page ${location.pageInfo?.currentPage || 0}`,
                createdAt: new Date(),
            };

            addAnnotation(annotation);
            setAnnotations(prev => [...prev, annotation]);
        }
    }, [currentBookId, location, annotations, addAnnotation, removeAnnotation]);

    const handleDeleteFromColorPicker = useCallback(async () => {
        if (!editingHighlightId) {
            console.warn('[Reader] Delete called but no editingHighlightId set');
            return;
        }

        console.debug('[Reader] Deleting highlight:', editingHighlightId);

        // Remove from viewport FIRST (before removing from store)
        // This is important because the engine needs to find the annotation in its internal map
        try {
            await readerRef.current?.removeHighlight?.(editingHighlightId);
            console.debug('[Reader] Successfully removed highlight from viewport');
        } catch (err) {
            console.warn('[Reader] Failed to remove highlight from viewport:', err);
        }

        // Then remove from store
        removeAnnotation(editingHighlightId);
        
        // Update local state
        setAnnotations(prev => prev.filter(a => a.id !== editingHighlightId));

        // Clear all related state
        setShowColorPicker(false);
        setEditingHighlightId(null);
        setActiveAnnotation(null);
        setSelectedText('');
        setSelectedCfi('');
        
        // Clear selection
        readerRef.current?.clearSelection?.();
    }, [editingHighlightId, removeAnnotation]);

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
                    onAddBookmark={handleAddPageBookmark}
                    isCurrentPageBookmarked={isCurrentPageBookmarked}
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

            {/* Bottom Progress Navbar */}
            {isBookReady && (
                <ReaderNavbar
                    location={location}
                    toc={toc}
                    sectionFractions={sectionFractions}
                    onSeek={handleSeek}
                    totalPages={location?.pageInfo?.totalPages}
                    className="fixed bottom-0 left-0 right-0 z-40"
                />
            )}

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

            <ReaderAnnotationsPanel
                bookId={currentBookId || ''}
                visible={activePanel === 'bookmarks'}
                onClose={() => setActivePanel(null)}
                onNavigate={goTo}
                onDelete={(id) => readerRef.current?.removeHighlight?.(id)}
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

            {/* Highlight Color Picker Popup */}
            {(() => {
                console.debug('[Reader] RENDER: showColorPicker=', showColorPicker, 'editingHighlightId=', editingHighlightId, 'onDelete=', editingHighlightId ? 'SET' : 'UNDEFINED');
                return null;
            })()}
            <HighlightColorPicker
                isOpen={showColorPicker}
                position={colorPickerPosition}
                selectedText={selectedText}
                currentColor={activeAnnotation?.color}
                onSelectColor={handleColorSelect}
                onAddNote={handleAddNote}
                onBookmark={handleBookmarkFromSelection}
                onDelete={editingHighlightId ? handleDeleteFromColorPicker : undefined}
                onClose={() => {
                    console.debug('[Reader] Color picker closing, clearing state');
                    setShowColorPicker(false);
                    setEditingHighlightId(null);
                    setActiveAnnotation(null);
                    readerRef.current?.clearSelection?.();
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
                    // Don't clear editingHighlightId here - let handleSaveNote do it
                    // This allows canceling without losing editing state
                    if (!editingHighlightId) {
                        // Only clear selection if not editing an existing highlight
                        readerRef.current?.clearSelection?.();
                    }
                }}
            />
        </div>
    );
}

