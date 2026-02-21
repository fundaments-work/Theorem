/**
 * Reader Page
 * Full-screen reading experience with document viewer and controls
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
    cn,
    getBookMaterializedPath,
    getBookBlob,
    getBookData,
    isMobile,
    isTauri,
    isTauriMobile,
    useAndroidBackButton,
    useVocabularyStore,
    useLibraryStore,
    useRssStore,
    useSettingsStore,
    useUIStore,
    vocabularyTermFromLookup,
    type Annotation,
    type BookFormat,
    type DictionaryLookupResult,
    type DocLocation,
    type DocMetadata,
    type HighlightColor,
    type PdfZoomMode,
    type ReaderSettings as ReaderSettingsState,
    type TocItem,
} from "../../core";
import { List } from "lucide-react";
import { WindowTitlebar } from "./components/WindowTitlebar";
import { TableOfContents } from "./components/TableOfContents";
import { ReaderSettings } from "./components/ReaderSettings";
import { PDFViewSettingsPanel } from "./components/PDFViewSettingsPanel";
import { ReaderAnnotationsPanel } from "./components/ReaderAnnotationsPanel";
import { ReaderSearch } from "./components/ReaderSearch";
import { BookInfoPopover } from "./components/BookInfoPopover";
import { ReaderNavbar } from "./components/progress/ReaderNavbar";
import { ReaderViewport } from "./components/ReaderViewport";
import { HighlightColorPicker } from "./components/highlights/HighlightColorPicker";
import { NoteEditor } from "./components/highlights/NoteEditor";
import { PDFReader } from "./components/PDFReader";
import { ArticleViewer } from "./article-reader/ArticleViewer";
import { useReaderFullscreen, useToolbarHeight } from "./hooks";
import type { PDFJsEngineRef } from "./engines/pdfjs-engine";
import type { ReaderViewportHandle } from "./components/ReaderViewport";
import { PDFFloatingToolbar } from "./components/PDFFloatingToolbar";

const MOBILE_READER_MEDIA_QUERY = '(max-width: 768px)';
const MIN_READER_ZOOM = 50;
const MIN_PAGED_READER_ZOOM = 100;
const MAX_READER_ZOOM = 200;
const PDF_STATE_SAVE_DEBOUNCE_MS = 900;
const READER_PROGRESS_SAVE_DEBOUNCE_MS = 1200;
const DEFAULT_PDF_ZOOM = 1;
const DEFAULT_PDF_ZOOM_MODE: PdfZoomMode = 'width-fit';
const PDF_ZOOM_PERSIST_PRECISION = 100;

type PendingProgressUpdate = {
    bookId: string;
    percentage: number;
    cfi: string;
    lastClickFraction?: number;
    pageProgress?: {
        currentPage: number;
        endPage?: number;
        totalPages: number;
        range: string;
    };
};

function clampReaderZoomByFlow(zoom: number, flow: ReaderSettingsState['flow']): number {
    const minZoom = flow === 'paged' ? MIN_PAGED_READER_ZOOM : MIN_READER_ZOOM;
    return Math.max(minZoom, Math.min(MAX_READER_ZOOM, Math.round(zoom)));
}

function resolvePdfTargetPage(target: string): number | null {
    const directMatch = target.match(/pdf:page:(\d+)/i);
    if (directMatch) {
        return Number(directMatch[1]);
    }
    const hashMatch = target.match(/[?#&]page=(\d+)/i);
    if (hashMatch) {
        return Number(hashMatch[1]);
    }
    const numericValue = Number(target);
    if (Number.isFinite(numericValue) && numericValue > 0) {
        return Math.floor(numericValue);
    }
    return null;
}

function getMimeTypeForBookFormat(format: BookFormat): string {
    switch (format) {
        case "epub":
            return "application/epub+zip";
        case "mobi":
        case "azw":
        case "azw3":
            return "application/x-mobipocket-ebook";
        case "fb2":
            return "application/x-fictionbook+xml";
        case "cbz":
            return "application/vnd.comicbook+zip";
        case "pdf":
            return "application/pdf";
        case "cbr":
        default:
            return "application/octet-stream";
    }
}

function BookReaderPage() {
    const currentBookId = useUIStore((state) => state.currentBookId);
    const setRoute = useUIStore((state) => state.setRoute);
    const goBack = useUIStore((state) => state.goBack);

    const getBook = useLibraryStore((state) => state.getBook);
    const updateProgress = useLibraryStore((state) => state.updateProgress);
    const updatePdfReadingState = useLibraryStore((state) => state.updatePdfReadingState);
    const saveBookLocations = useLibraryStore((state) => state.saveBookLocations);
    const addReadingTime = useLibraryStore((state) => state.addReadingTime);
    const markBookCompleted = useLibraryStore((state) => state.markBookCompleted);
    const lookupTerm = useVocabularyStore((state) => state.lookupTerm);
    const saveVocabularyTerm = useVocabularyStore((state) => state.saveVocabularyTerm);
    const installedDictionaryCount = useVocabularyStore((state) => state.installedDictionaries.length);

    const settings = useSettingsStore((state) => state.settings);
    const updateReaderSettings = useSettingsStore((state) => state.updateReaderSettings);
    const stats = useSettingsStore((state) => state.stats);
    const updateStats = useSettingsStore((state) => state.updateStats);
    const readerZoomRef = useRef(settings.readerSettings.zoom);
    const readerRef = useRef<ReaderViewportHandle>(null);
    const pdfReaderRef = useRef<PDFJsEngineRef>(null);
    const loadedBookIdRef = useRef<string | null>(null);
    const toolbarContainerRef = useRef<HTMLDivElement>(null);
    const toolbarHeight = useToolbarHeight(toolbarContainerRef, {
        defaultHeight: 56,
        minHeight: 44,
    });

    // PDF-specific state for titlebar controls
    const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
    const [pdfTotalPages, setPdfTotalPages] = useState(0);
    const [pdfZoom, setPdfZoom] = useState(DEFAULT_PDF_ZOOM);
    const [pdfZoomMode, setPdfZoomMode] = useState<PdfZoomMode>(DEFAULT_PDF_ZOOM_MODE);
    const [pdfInitialPage, setPdfInitialPage] = useState(1);
    const [pdfInitialZoom, setPdfInitialZoom] = useState(DEFAULT_PDF_ZOOM);
    const [pdfInitialZoomMode, setPdfInitialZoomMode] = useState<PdfZoomMode>(DEFAULT_PDF_ZOOM_MODE);
    const [resolvedPdfPath, setResolvedPdfPath] = useState("");
    const [pdfAnnotationMode, setPdfAnnotationMode] = useState<'none' | 'highlight' | 'pen' | 'text' | 'erase'>('none');
    const [pdfHighlightColor, setPdfHighlightColor] = useState<HighlightColor>("yellow");
    const [pdfBrushColor, setPdfBrushColor] = useState<HighlightColor>("blue");
    const [pdfBrushWidth, setPdfBrushWidth] = useState(2);
    const [pdfHasOutline, setPdfHasOutline] = useState(false);

    // Reading time tracking
    const readingStartTimeRef = useRef<number | null>(null);
    const readingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Use ref to access latest stats without causing re-renders
    const statsRef = useRef(stats);
    statsRef.current = stats;
    useEffect(() => {
        readerZoomRef.current = settings.readerSettings.zoom;
    }, [settings.readerSettings.zoom]);

    // File state
    const [file, setFile] = useState<File | Blob | null>(null);
    const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
    const [metadata, setMetadata] = useState<DocMetadata | null>(null);
    const [toc, setToc] = useState<TocItem[]>([]);
    const [location, setLocation] = useState<DocLocation | null>(null);
    const [sectionFractions, setSectionFractions] = useState<number[]>([]);
    // UI state
    const [isMobileViewport, setIsMobileViewport] = useState(() => (
        typeof window !== 'undefined'
            ? window.matchMedia(MOBILE_READER_MEDIA_QUERY).matches
            : false
    ));
    const [showToolbar, setShowToolbar] = useState(true);
    type ReaderPanel = 'toc' | 'settings' | 'bookmarks' | 'search' | 'info' | 'menu' | null;
    const [activePanel, setActivePanel] = useState<ReaderPanel>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [initialLocation, setInitialLocation] = useState<string | undefined>(undefined);
    const [initialFraction, setInitialFraction] = useState<number | undefined>(undefined);
    const suppressProgressRef = useRef(false);
    const resumeTargetRef = useRef<string | null>(null);
    const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pdfProgressSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastPersistedPdfStateRef = useRef<{
        bookId: string;
        page: number;
        totalPages: number;
        zoom: number;
        zoomMode: PdfZoomMode;
    } | null>(null);
    const progressSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingProgressUpdateRef = useRef<PendingProgressUpdate | null>(null);
    const hasAppliedInitialLocationRef = useRef(false);
    const debug = useCallback((...args: unknown[]) => {
        if (import.meta.env.DEV) {
            console.debug(...args);
        }
    }, []);

    const togglePanel = useCallback((panel: ReaderPanel) => {
        setActivePanel(current => current === panel ? null : panel);
    }, []);

    // Get current book format
    const currentBook = currentBookId ? getBook(currentBookId) : null;
    const isPdfFormat = currentBook?.format === 'pdf';

    const effectiveReaderSettings = useMemo<ReaderSettingsState>(() => {
        if (isPdfFormat) {
            return settings.readerSettings;
        }

        const effectiveLayout = isMobileViewport ? 'single' : settings.readerSettings.layout;
        const effectiveZoom = clampReaderZoomByFlow(
            settings.readerSettings.zoom,
            settings.readerSettings.flow,
        );

        if (
            effectiveLayout !== settings.readerSettings.layout
            || effectiveZoom !== settings.readerSettings.zoom
        ) {
            return {
                ...settings.readerSettings,
                layout: effectiveLayout,
                zoom: effectiveZoom,
            };
        }

        return settings.readerSettings;
    }, [isMobileViewport, isPdfFormat, settings.readerSettings]);

    useEffect(() => {
        if (isPdfFormat || settings.readerSettings.flow !== 'paged') {
            return;
        }

        if (settings.readerSettings.zoom >= MIN_PAGED_READER_ZOOM) {
            return;
        }

        updateReaderSettings({ zoom: MIN_PAGED_READER_ZOOM });
    }, [
        isPdfFormat,
        settings.readerSettings.flow,
        settings.readerSettings.zoom,
        updateReaderSettings,
    ]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const mediaQuery = window.matchMedia(MOBILE_READER_MEDIA_QUERY);
        const updateViewportState = (matches: boolean) => {
            setIsMobileViewport(matches);
            setShowToolbar(activePanel !== null);
        };

        updateViewportState(mediaQuery.matches);

        const handleChange = (event: MediaQueryListEvent) => {
            updateViewportState(event.matches);
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => {
            mediaQuery.removeEventListener('change', handleChange);
        };
    }, [activePanel]);

    // PDF callbacks - memoized to prevent infinite re-renders
    const handlePdfLoad = useCallback((info: import('./engines/pdfjs-engine').PDFDocumentInfo) => {
        // Get current book data for fallback
        const currentBookData = currentBookId ? getBook(currentBookId) : null;

        // Priority: 1. PDF metadata title, 2. Book title from library, 3. Filename, 4. 'Untitled'
        // Only use PDF title if it differs from the filename (meaning it came from actual metadata)
        const isPdfTitleFromMetadata = info.title && info.title !== info.filename;
        const displayTitle = (isPdfTitleFromMetadata
            ? info.title
            : (currentBookData?.title || info.title || 'Untitled')) || 'Untitled';
        const displayAuthor = info.author || currentBookData?.author || 'Unknown';

        setMetadata({
            title: displayTitle,
            author: displayAuthor,
            description: currentBookData?.description || '',
            language: currentBookData?.language || '',
            publisher: currentBookData?.publisher || '',
            pubdate: currentBookData?.publishedDate,
            identifier: currentBookData?.isbn,
        });
        setToc(Array.isArray(info.toc) ? info.toc : []);
        setPdfHasOutline(Boolean(info.hasOutline ?? ((info.toc?.length || 0) > 0)));
        // Ensure titlebar page indicator has total pages immediately on load.
        setPdfCurrentPage((currentPage) => Math.max(1, currentPage));
        setPdfTotalPages(Math.max(0, info.totalPages || 0));
        setIsBookReady(true);
    }, [currentBookId, getBook]);

    const handlePdfError = useCallback((err: Error) => {
        setLoadError(err.message);
    }, []);

    const handlePdfPageChange = useCallback((page: number, total: number, scale: number) => {
        // console.log('[PDF] Page changed:', page, 'of', total, 'zoom:', scale);
        setPdfCurrentPage(Math.max(1, page));
        setPdfTotalPages((prevTotal) => {
            if (total > 0) {
                return total;
            }
            return prevTotal;
        });
        setPdfZoom(scale);
    }, []);

    // Load book file
    useEffect(() => {
        // Guard: already loaded this book
        if (currentBookId && loadedBookIdRef.current === currentBookId) {
            return;
        }

        // Guard: no book ID
        if (!currentBookId) {
            loadedBookIdRef.current = null;
            return;
        }

        // Set immediately to prevent duplicate loads during async operations
        loadedBookIdRef.current = currentBookId;
        setShowToolbar(true);

        let isCancelled = false;

        const loadBook = async () => {
            const book = getBook(currentBookId);
            if (!book) {
                setLoadError('Book not found in library');
                return;
            }
            if (book.format === 'cbr') {
                setLoadError('CBR archives are not supported in this build. Convert to CBZ and re-import.');
                loadedBookIdRef.current = null;
                return;
            }

            setFile(null);
            setPdfData(null);
            setPdfCurrentPage(1);
            setPdfTotalPages(0);
            setPdfZoom(DEFAULT_PDF_ZOOM);
            setPdfZoomMode(DEFAULT_PDF_ZOOM_MODE);
            setPdfInitialPage(1);
            setPdfInitialZoom(DEFAULT_PDF_ZOOM);
            setPdfInitialZoomMode(DEFAULT_PDF_ZOOM_MODE);
            setResolvedPdfPath("");
            setPdfHasOutline(false);
            setMetadata(null);
            setToc([]);
            setLocation(null);
            setIsBookReady(false);
            if (book.format === 'pdf') {
                const fallbackPage = resolvePdfTargetPage(book.currentLocation || '') ?? 1;
                const savedPdfState = book.pdfViewState;
                const nextInitialPage = Math.max(
                    1,
                    Math.floor(savedPdfState?.page ?? fallbackPage),
                );
                const nextInitialZoom = Math.max(
                    0.25,
                    Math.min(
                        5,
                        savedPdfState?.zoom ?? DEFAULT_PDF_ZOOM,
                    ),
                );
                const nextInitialZoomMode = savedPdfState?.zoomMode ?? DEFAULT_PDF_ZOOM_MODE;

                setPdfInitialPage(nextInitialPage);
                setPdfInitialZoom(nextInitialZoom);
                setPdfInitialZoomMode(nextInitialZoomMode);
                setPdfCurrentPage(nextInitialPage);
                setPdfZoom(nextInitialZoom);
                setPdfZoomMode(nextInitialZoomMode);

                setInitialLocation(undefined);
                setInitialFraction(undefined);
                suppressProgressRef.current = false;
                resumeTargetRef.current = null;
                hasAppliedInitialLocationRef.current = true;
            } else {
                const nextLocation = book.currentLocation || undefined;
                setInitialLocation(nextLocation);
                // Use lastClickFraction if available, otherwise use progress but NOT if book is nearly complete
                // This prevents jumping to the end when reopening a completed book
                const progressFallback = book.progress !== undefined && book.progress < 0.95 ? book.progress : undefined;
                const fractionToUse = book.lastClickFraction ?? progressFallback;
                setInitialFraction(fractionToUse);
                suppressProgressRef.current = !!nextLocation || fractionToUse !== undefined;
                resumeTargetRef.current = nextLocation || null;
                hasAppliedInitialLocationRef.current = false;
            }
            if (resumeTimeoutRef.current) {
                clearTimeout(resumeTimeoutRef.current);
            }
            setLoadError(null);

            try {
                const storagePath = book.storagePath || book.filePath;

                if (book.format === 'pdf') {
                    if (isTauri()) {
                        const materializedPath = await getBookMaterializedPath(book.id, storagePath);
                        if (materializedPath) {
                            if (!isCancelled) {
                                setResolvedPdfPath(materializedPath);
                            }
                            return;
                        }
                    }

                    console.log('[Reader] Loading PDF data into memory for mobile compatibility');
                    const data = await getBookData(book.id, storagePath);
                    if (isCancelled) return;
                    if (!data || data.byteLength === 0) {
                        throw new Error('Could not read PDF file from storage - data is empty.');
                    }
                    console.log('[Reader] PDF data loaded, size:', data.byteLength);
                    setResolvedPdfPath("");
                    setPdfData(new Uint8Array(data));
                    return;
                }

                const blob = await getBookBlob(book.id, storagePath);
                if (isCancelled) return;
                if (!blob) {
                    throw new Error('Could not read book file from storage.');
                }
                const expectedMimeType = getMimeTypeForBookFormat(book.format);
                const typedBlob = blob.type === expectedMimeType
                    ? blob
                    : blob.slice(0, blob.size, expectedMimeType);
                setFile(typedBlob);
            } catch (err) {
                if (!isCancelled) {
                    setLoadError(err instanceof Error ? err.message : 'Unknown error loading book');
                    // Reset loaded book ID on error so user can retry
                    loadedBookIdRef.current = null;
                }
            }
        };

        loadBook();
        return () => { isCancelled = true; };
    }, [currentBookId, getBook]);

    // Preload the next few books to keep tap-to-open latency low on mobile.
    useEffect(() => {
        if (!currentBookId) {
            return;
        }

        const allBooks = useLibraryStore.getState().books;
        const currentBookIndex = allBooks.findIndex((book) => book.id === currentBookId);
        if (currentBookIndex === -1) {
            return;
        }

        const upcomingBooks = allBooks.slice(currentBookIndex + 1, currentBookIndex + 4);
        for (const book of upcomingBooks) {
            if (book.format === 'pdf') {
                continue;
            }

            const storagePath = book.storagePath || book.filePath;
            void getBookBlob(book.id, storagePath).catch((error) => {
                console.debug('[Reader] Prefetch skipped for book:', book.id, error);
            });
        }
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

                    // Update global stats - use ref to access latest stats without dependency issues
                    const currentStats = statsRef.current;
                    const today = new Date().toISOString().split('T')[0];
                    const existingActivity = currentStats.dailyActivity.find(a => a.date === today);

                    let newDailyActivity;
                    if (existingActivity) {
                        newDailyActivity = currentStats.dailyActivity.map(a =>
                            a.date === today
                                ? { ...a, minutes: a.minutes + 1, booksRead: [...new Set([...a.booksRead, currentBookId])] }
                                : a
                        );
                    } else {
                        newDailyActivity = [...currentStats.dailyActivity, {
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
                        totalReadingTime: currentStats.totalReadingTime + 1,
                        dailyActivity: newDailyActivity,
                        currentStreak,
                        longestStreak: Math.max(currentStats.longestStreak, currentStreak),
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentBookId, addReadingTime, updateStats]);

    useEffect(() => {
        return () => {
            if (resumeTimeoutRef.current) {
                clearTimeout(resumeTimeoutRef.current);
            }
            if (pdfProgressSaveTimeoutRef.current) {
                clearTimeout(pdfProgressSaveTimeoutRef.current);
            }
            if (progressSaveTimeoutRef.current) {
                clearTimeout(progressSaveTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        lastPersistedPdfStateRef.current = null;
    }, [currentBookId]);

    // Auto-hide toolbar
    useEffect(() => {
        if (isMobileViewport) return;
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

        if (isPdfFormat) {
            showToolbarAndReset();
        } else {
            timeout = setTimeout(hideToolbar, settings.readerSettings.autoHideDelay * 1000);
        }

        window.addEventListener('mousemove', showToolbarAndReset, { passive: true });
        window.addEventListener('touchstart', showToolbarAndReset, { passive: true });
        window.addEventListener('keydown', showToolbarAndReset);

        return () => {
            clearTimeout(timeout);
            window.removeEventListener('mousemove', showToolbarAndReset);
            window.removeEventListener('touchstart', showToolbarAndReset);
            window.removeEventListener('keydown', showToolbarAndReset);
        };
    }, [activePanel, isMobileViewport, isPdfFormat, settings.readerSettings.autoHideDelay]);

    const handleReaderExitFullscreen = useCallback(() => {
        updateReaderSettings({ fullscreen: false });
    }, [updateReaderSettings]);

    useReaderFullscreen({
        fullscreen: settings.readerSettings.fullscreen,
        onExitFullscreen: handleReaderExitFullscreen,
        errorLabel: "[Reader]",
    });

    const handleReady = useCallback((meta: DocMetadata, tocItems: TocItem[]) => {
        const loadedBook = currentBookId ? getBook(currentBookId) : null;
        const mergedMetadata: DocMetadata = {
            ...meta,
            pubdate: loadedBook?.publishedDate || meta.pubdate,
        };

        setMetadata(mergedMetadata);
        setToc(Array.isArray(tocItems) ? tocItems : []);
        setIsBookReady(true);
        // Get section fractions from the reader after it's ready
        // Use a small delay to ensure the engine has processed the book
        setTimeout(() => {
            const fractions = readerRef.current?.getSectionFractions() ?? [];
            setSectionFractions(fractions);
        }, 100);
    }, [currentBookId, getBook]);

    const lastClickFractionRef = useRef<number | null>(null);
    const handleBookCompletionProgress = useCallback((bookId: string, progress: number) => {
        if (progress < 0.99) {
            return;
        }

        const result = markBookCompleted(bookId, "auto");
        if (!result || result.wasAlreadyCompleted) {
            return;
        }

        const currentYear = new Date().getFullYear();
        const currentStats = statsRef.current;
        updateStats({
            booksCompleted: currentStats.booksCompleted + 1,
            booksReadThisYear: result.completedYear === currentYear
                ? currentStats.booksReadThisYear + 1
                : currentStats.booksReadThisYear,
        });
    }, [markBookCompleted, updateStats]);

    const flushPendingProgressUpdate = useCallback(() => {
        const pendingUpdate = pendingProgressUpdateRef.current;
        if (!pendingUpdate) {
            return;
        }

        pendingProgressUpdateRef.current = null;
        if (progressSaveTimeoutRef.current) {
            clearTimeout(progressSaveTimeoutRef.current);
            progressSaveTimeoutRef.current = null;
        }

        updateProgress(
            pendingUpdate.bookId,
            pendingUpdate.percentage,
            pendingUpdate.cfi,
            pendingUpdate.lastClickFraction,
            pendingUpdate.pageProgress,
        );
        handleBookCompletionProgress(pendingUpdate.bookId, pendingUpdate.percentage);
    }, [handleBookCompletionProgress, updateProgress]);

    const scheduleProgressUpdate = useCallback((nextUpdate: PendingProgressUpdate) => {
        pendingProgressUpdateRef.current = nextUpdate;

        if (progressSaveTimeoutRef.current) {
            clearTimeout(progressSaveTimeoutRef.current);
        }

        progressSaveTimeoutRef.current = setTimeout(() => {
            progressSaveTimeoutRef.current = null;
            flushPendingProgressUpdate();
        }, READER_PROGRESS_SAVE_DEBOUNCE_MS);
    }, [flushPendingProgressUpdate]);

    useEffect(() => {
        flushPendingProgressUpdate();
    }, [currentBookId, flushPendingProgressUpdate]);

    useEffect(() => {
        return () => {
            flushPendingProgressUpdate();
        };
    }, [flushPendingProgressUpdate]);

    const handleLocationChange = useCallback((loc: DocLocation) => {
        setLocation(loc);

        // Suppress the first few location updates to avoid overwriting saved progress
        // The engine navigates to the saved location, which triggers relocate events
        if (suppressProgressRef.current) {
            const target = resumeTargetRef.current;

            debug('[Reader] Location change while suppressed:', {
                hasTarget: !!target,
                targetCfi: target?.substring(0, 50),
                currentCfi: loc.cfi?.substring(0, 50),
                percentage: loc.percentage,
            });

            // If we have a target CFI and current location matches it, we've arrived
            if (target && loc.cfi && loc.cfi.startsWith(target)) {
                debug('[Reader] ✓ Arrived at resume target, clearing suppression');
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
                debug('[Reader] Starting suppression timeout (1000ms)');
                resumeTimeoutRef.current = setTimeout(() => {
                    debug('[Reader] Suppression timeout expired');
                    suppressProgressRef.current = false;
                    resumeTargetRef.current = null;
                    resumeTimeoutRef.current = null;
                }, 1000);
            }

            return; // Don't save while suppressed
        }

        if (currentBookId) {
            debug('[Reader] Saving location update:', {
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

            scheduleProgressUpdate({
                bookId: currentBookId,
                percentage: safePercentage,
                cfi: safeCfi,
                lastClickFraction,
                pageProgress,
            });
            lastClickFractionRef.current = null;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentBookId, scheduleProgressUpdate, updateProgress]);

    useEffect(() => {
        if (!isPdfFormat || !currentBookId || pdfTotalPages <= 0) {
            return;
        }

        if (pdfProgressSaveTimeoutRef.current) {
            clearTimeout(pdfProgressSaveTimeoutRef.current);
        }

        pdfProgressSaveTimeoutRef.current = setTimeout(() => {
            const safeTotalPages = Math.max(1, Math.floor(pdfTotalPages));
            const safeCurrentPage = Math.max(1, Math.min(Math.floor(pdfCurrentPage), safeTotalPages));
            const safeZoom = Math.round(
                Math.max(0.25, Math.min(5, pdfZoom)) * PDF_ZOOM_PERSIST_PRECISION,
            ) / PDF_ZOOM_PERSIST_PRECISION;
            const nextPersistedState = {
                bookId: currentBookId,
                page: safeCurrentPage,
                totalPages: safeTotalPages,
                zoom: safeZoom,
                zoomMode: pdfZoomMode,
            } as const;

            const previousPersistedState = lastPersistedPdfStateRef.current;
            if (
                previousPersistedState
                && previousPersistedState.bookId === nextPersistedState.bookId
                && previousPersistedState.page === nextPersistedState.page
                && previousPersistedState.totalPages === nextPersistedState.totalPages
                && previousPersistedState.zoom === nextPersistedState.zoom
                && previousPersistedState.zoomMode === nextPersistedState.zoomMode
            ) {
                return;
            }

            lastPersistedPdfStateRef.current = nextPersistedState;

            updatePdfReadingState(currentBookId, {
                page: safeCurrentPage,
                totalPages: safeTotalPages,
                zoom: safeZoom,
                zoomMode: pdfZoomMode,
            });

            handleBookCompletionProgress(currentBookId, safeCurrentPage / safeTotalPages);
        }, PDF_STATE_SAVE_DEBOUNCE_MS);

        return () => {
            if (pdfProgressSaveTimeoutRef.current) {
                clearTimeout(pdfProgressSaveTimeoutRef.current);
                pdfProgressSaveTimeoutRef.current = null;
            }
        };
    }, [
        currentBookId,
        handleBookCompletionProgress,
        isPdfFormat,
        pdfCurrentPage,
        pdfTotalPages,
        pdfZoom,
        pdfZoomMode,
        updatePdfReadingState,
    ]);

    const goTo = useCallback(async (target: string) => {
        if (isPdfFormat) {
            const pageNumber = resolvePdfTargetPage(target);
            if (pageNumber) {
                pdfReaderRef.current?.goToPage(pageNumber);
            }
            setActivePanel(null);
            return;
        }

        if (readerRef.current) {
            await readerRef.current.goTo(target);
        }
        setActivePanel(null);
    }, [isPdfFormat]);

    const handleSeek = useCallback((fraction: number) => {
        lastClickFractionRef.current = fraction;
        if (readerRef.current) {
            readerRef.current.goToFraction(fraction);
        }
    }, []);

    const handleError = useCallback((err: Error) => {
        setLoadError(err.message);
    }, []);

    const handleZoomGestureChange = useCallback((zoom: number) => {
        const clampedZoom = clampReaderZoomByFlow(zoom, settings.readerSettings.flow);
        if (readerZoomRef.current === clampedZoom) {
            return;
        }
        updateReaderSettings({ zoom: clampedZoom });
    }, [settings.readerSettings.flow, updateReaderSettings]);

    const handleReaderSettingsUpdate = useCallback((updates: Partial<ReaderSettingsState>) => {
        const nextFlow = updates.flow ?? settings.readerSettings.flow;
        const nextZoomInput = updates.zoom ?? settings.readerSettings.zoom;
        const shouldNormalizeZoom =
            updates.zoom !== undefined
            || updates.flow !== undefined
            || (nextFlow === 'paged' && settings.readerSettings.zoom < MIN_PAGED_READER_ZOOM);

        if (!shouldNormalizeZoom) {
            updateReaderSettings(updates);
            return;
        }

        updateReaderSettings({
            ...updates,
            zoom: clampReaderZoomByFlow(nextZoomInput, nextFlow),
        });
    }, [
        settings.readerSettings.flow,
        settings.readerSettings.zoom,
        updateReaderSettings,
    ]);

    const handlePdfZoomModeChange = useCallback((mode: PdfZoomMode) => {
        setPdfZoomMode(mode);
    }, []);

    const shouldShowReaderChrome = showToolbar || activePanel !== null;
    const readerPopoverPadding = useMemo(() => {
        const defaultInset = 12;
        if (!isMobileViewport) {
            return {
                top: defaultInset,
                right: defaultInset,
                bottom: defaultInset,
                left: defaultInset,
            };
        }

        const topInset = shouldShowReaderChrome
            ? Math.max(defaultInset, toolbarHeight + 8)
            : 16;
        const bottomInset = (!isPdfFormat && shouldShowReaderChrome)
            ? 84
            : 16;

        return {
            top: topInset,
            right: 12,
            bottom: bottomInset,
            left: 12,
        };
    }, [isMobileViewport, isPdfFormat, shouldShowReaderChrome, toolbarHeight]);
    const colorPickerViewportPadding = useMemo(() => {
        if (!isMobileViewport) {
            return readerPopoverPadding;
        }
        return {
            ...readerPopoverPadding,
            // Keep enough room for chrome, but avoid forcing overlap near selections.
            bottom: Math.max(16, Math.min(readerPopoverPadding.bottom, 24)),
        };
    }, [isMobileViewport, readerPopoverPadding]);

    // Highlight state
    const [showColorPicker, setShowColorPicker] = useState(false);
    const [colorPickerMode, setColorPickerMode] = useState<"actions" | "dictionary">("actions");
    const [colorPickerPosition, setColorPickerPosition] = useState<{ x: number; y: number; height?: number }>({ x: 0, y: 0 });
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
    const [dictionaryLookupTerm, setDictionaryLookupTerm] = useState('');
    const [dictionaryLookupResult, setDictionaryLookupResult] = useState<DictionaryLookupResult | null>(null);
    const [dictionaryLookupError, setDictionaryLookupError] = useState<string | null>(null);
    const [dictionaryLookupLoading, setDictionaryLookupLoading] = useState(false);
    const [dictionaryLookupSaved, setDictionaryLookupSaved] = useState(false);

    // Handle Android back button
    const handleAndroidBack = useCallback(() => {
        // Check if any panel is open - close them first
        if (activePanel) {
            setActivePanel(null);
            return true; // Handled, re-push interceptor
        }

        // Close color picker if open
        if (showColorPicker) {
            setShowColorPicker(false);
            return true;
        }

        // Close note editor if open
        if (showNoteEditor) {
            setShowNoteEditor(false);
            return true;
        }

        // No panels open - go back to library
        // We return false to the hook so it doesn't re-push the dummy state
        // allowing the system back action to proceed to the previous route.
        flushPendingProgressUpdate();
        goBack();
        return false;
    }, [activePanel, showColorPicker, showNoteEditor, goBack, flushPendingProgressUpdate]);

    useAndroidBackButton(handleAndroidBack);

    // Web-based back button handling for desktop browsers and mobile web
    useEffect(() => {
        if (typeof window === "undefined" || isTauriMobile()) {
            return;
        }

        const state = window.history.state;
        // Use consistent interceptor flag
        if (!(state && typeof state === "object" && state.__theorem_back === true)) {
            window.history.pushState(
                {
                    ...(state && typeof state === "object" ? state : {}),
                    __theorem_back: true,
                },
                "",
            );
        }

        const handlePopState = (event: PopStateEvent) => {
            // If the state we popped to is our reader entry state, we want to exit
            // but we check if we were already handled by another listener
            if (useUIStore.getState().currentRoute === "reader") {
                flushPendingProgressUpdate();
                setRoute("library");
            }
        };

        window.addEventListener("popstate", handlePopState);
        return () => {
            window.removeEventListener("popstate", handlePopState);
        };
    }, [setRoute, flushPendingProgressUpdate]);

    const handleBack = useCallback(() => {
        flushPendingProgressUpdate();
        // If we have a history stack, going back will be caught by our popstate listeners
        if (typeof window !== "undefined" && window.history.length > 1) {
            window.history.back();
        } else {
            // Fallback for direct entry
            setRoute("library");
        }
    }, [setRoute, flushPendingProgressUpdate]);

    useEffect(() => {
        if (!isPdfFormat || !isMobileViewport || !showToolbar || activePanel !== null) {
            return;
        }

        const timeout = setTimeout(() => {
            setShowToolbar(false);
        }, settings.readerSettings.autoHideDelay * 1000);

        return () => clearTimeout(timeout);
    }, [
        activePanel,
        isMobileViewport,
        isPdfFormat,
        settings.readerSettings.autoHideDelay,
        showToolbar,
    ]);

    const handleViewportTap = useCallback(() => {
        if (showColorPicker || showNoteEditor) {
            setShowColorPicker(false);
            setColorPickerMode("actions");
            setShowNoteEditor(false);
            setEditingHighlightId(null);
            setActiveAnnotation(null);
            setSelectedText('');
            setSelectedCfi('');
            setEditingNote('');
            setDictionaryLookupTerm('');
            setDictionaryLookupResult(null);
            setDictionaryLookupError(null);
            setDictionaryLookupLoading(false);
            setDictionaryLookupSaved(false);
            readerRef.current?.clearSelection?.();
            return;
        }

        if (activePanel) {
            setActivePanel(null);
            return;
        }

        if (!isMobileViewport) {
            return;
        }
        setShowToolbar((previous) => !previous);
    }, [activePanel, isMobileViewport, showColorPicker, showNoteEditor]);

    const shouldForceViewportTap = useCallback(() => {
        return showColorPicker || showNoteEditor;
    }, [showColorPicker, showNoteEditor]);

    const addAnnotation = useLibraryStore((state) => state.addAnnotation);
    const removeAnnotation = useLibraryStore((state) => state.removeAnnotation);
    const getBookAnnotations = useLibraryStore((state) => state.getBookAnnotations);
    const updateAnnotation = useLibraryStore((state) => state.updateAnnotation);

    // PDF Controls - Defined here to access annotations and store actions
    const handlePdfZoomFitPage = useCallback(() => {
        pdfReaderRef.current?.zoomFitPage();
        setPdfZoomMode('page-fit');
    }, []);

    const handlePdfZoomFitWidth = useCallback(() => {
        pdfReaderRef.current?.zoomFitWidth();
        setPdfZoomMode('width-fit');
    }, []);

    const handlePdfZoomIn = useCallback(() => {
        pdfReaderRef.current?.zoomIn();
        setPdfZoomMode('custom');
    }, []);

    const handlePdfZoomOut = useCallback(() => {
        pdfReaderRef.current?.zoomOut();
        setPdfZoomMode('custom');
    }, []);

    const handlePdfZoomReset = useCallback(() => {
        pdfReaderRef.current?.zoomReset();
        setPdfZoomMode('custom');
    }, []);

    const handlePdfAnnotationAdd = useCallback((partialAnnotation: Partial<Annotation>) => {
        if (!currentBookId) {
            return;
        }

        const annotationId = partialAnnotation.id || crypto.randomUUID();
        const pageNumber = partialAnnotation.pageNumber ?? pdfCurrentPage;
        const annotationColor = partialAnnotation.color
            || (
                partialAnnotation.pdfAnnotationType === "highlight"
                    || partialAnnotation.type === "highlight"
                    ? pdfHighlightColor
                    : partialAnnotation.pdfAnnotationType === "drawing"
                        || partialAnnotation.pdfAnnotationType === "textNote"
                        ? pdfBrushColor
                        : undefined
            );
        const annotationStrokeWidth = partialAnnotation.strokeWidth
            ?? (
                partialAnnotation.pdfAnnotationType === "drawing"
                    ? pdfBrushWidth
                    : undefined
            );
        const normalizedAnnotation: Annotation = {
            id: annotationId,
            bookId: currentBookId,
            referenceId: partialAnnotation.referenceId || currentBookId,
            type: partialAnnotation.type
                || (partialAnnotation.pdfAnnotationType === "highlight" ? "highlight" : "note"),
            location: partialAnnotation.location || `pdf:page:${pageNumber}`,
            selectedText: partialAnnotation.selectedText,
            noteContent: partialAnnotation.noteContent,
            color: annotationColor,
            createdAt: partialAnnotation.createdAt ? new Date(partialAnnotation.createdAt) : new Date(),
            updatedAt: partialAnnotation.updatedAt ? new Date(partialAnnotation.updatedAt) : undefined,
            pageNumber,
            pdfAnnotationType: partialAnnotation.pdfAnnotationType,
            drawingData: partialAnnotation.drawingData,
            textNoteContent: partialAnnotation.textNoteContent,
            rect: partialAnnotation.rect,
            rects: partialAnnotation.rects,
            strokeWidth: annotationStrokeWidth,
        };

        const existingAnnotation = getBookAnnotations(currentBookId).find((annotation) => annotation.id === annotationId);
        if (existingAnnotation) {
            updateAnnotation(annotationId, {
                ...normalizedAnnotation,
                updatedAt: new Date(),
            });
        } else {
            addAnnotation(normalizedAnnotation);
        }

        setAnnotations((previousAnnotations) => {
            const existingIndex = previousAnnotations.findIndex((annotation) => annotation.id === annotationId);
            if (existingIndex === -1) {
                return [...previousAnnotations, normalizedAnnotation];
            }
            const nextAnnotations = [...previousAnnotations];
            nextAnnotations[existingIndex] = {
                ...nextAnnotations[existingIndex],
                ...normalizedAnnotation,
                updatedAt: new Date(),
            };
            return nextAnnotations;
        });

    }, [
        addAnnotation,
        currentBookId,
        getBookAnnotations,
        pdfBrushColor,
        pdfBrushWidth,
        pdfCurrentPage,
        pdfHighlightColor,
        updateAnnotation,
    ]);

    const handlePdfAnnotationChange = useCallback((annotation: Annotation) => {
        if (!currentBookId) {
            return;
        }

        updateAnnotation(annotation.id, {
            ...annotation,
            updatedAt: new Date(),
        });

        setAnnotations((previousAnnotations) => previousAnnotations.map((currentAnnotation) =>
            currentAnnotation.id === annotation.id
                ? { ...currentAnnotation, ...annotation, updatedAt: new Date() }
                : currentAnnotation
        ));

    }, [
        currentBookId,
        updateAnnotation,
    ]);

    const handlePdfAnnotationRemove = useCallback((annotationId: string) => {
        removeAnnotation(annotationId);
        setAnnotations((previousAnnotations) => previousAnnotations.filter(
            (annotation) => annotation.id !== annotationId,
        ));
    }, [removeAnnotation]);

    const handlePdfAddBookmark = useCallback(() => {
        if (!currentBookId) return;
        const pageLocation = `pdf:page:${pdfCurrentPage}`;

        // Check if already bookmarked
        const existing = annotations.find(a =>
            a.type === 'bookmark' && a.pageNumber === pdfCurrentPage
        );

        if (existing) {
            handlePdfAnnotationRemove(existing.id);
        } else {
            const bookmark: Annotation = {
                id: crypto.randomUUID(),
                bookId: currentBookId,
                referenceId: currentBookId,
                type: 'bookmark',
                location: pageLocation,
                pageNumber: pdfCurrentPage,
                createdAt: new Date(),
            };
            handlePdfAnnotationAdd(bookmark);
        }
    }, [annotations, currentBookId, handlePdfAnnotationAdd, handlePdfAnnotationRemove, pdfCurrentPage]);

    // Check if current PDF page is bookmarked
    const isPdfPageBookmarked = annotations.some(
        a => a.type === 'bookmark' && a.pageNumber === pdfCurrentPage
    );

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
            if (isPdfFormat) {
                return;
            }
            // Load annotations into viewport (with delay to ensure foliate is ready)
            const timer = setTimeout(() => {
                readerRef.current?.loadAnnotations?.(bookAnnotations).catch((err: Error) => {
                    console.warn('[Reader] Failed to load annotations:', err);
                });
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [currentBookId, getBookAnnotations, isBookReady, isPdfFormat]);

    useEffect(() => {
        if (!isBookReady || !readerRef.current || hasAppliedInitialLocationRef.current) return;

        // If we have a CFI location, the engine should have handled it during open()
        // We only need to use fraction fallback if there's no CFI
        if (initialLocation) {
            debug('[Reader] CFI was provided, engine should have navigated');
            hasAppliedInitialLocationRef.current = true;
            return;
        }

        if (typeof initialFraction === 'number') {
            debug('[Reader] No CFI, using fraction fallback:', initialFraction);
            hasAppliedInitialLocationRef.current = true;
            // Small delay to ensure view is fully ready
            setTimeout(() => {
                readerRef.current?.goToFraction(initialFraction);
            }, 100);
        }
    }, [isBookReady, initialLocation, initialFraction]);

    // Memoized highlight selection handler
    const handleTextSelected = useCallback((cfi: string, text: string, rangeOrEvent?: Range | MouseEvent) => {
        debug('[Reader] Text selected:', { cfi: cfi.substring(0, 50), text: text.substring(0, 50) });

        // Always fetch fresh annotations from store to avoid stale state
        const freshAnnotations = currentBookId ? getBookAnnotations(currentBookId) : [];
        debug('[Reader] Fresh annotations from store:', freshAnnotations.length);
        debug('[Reader] Available highlight/note annotations:', freshAnnotations.filter(a => a.type === 'highlight' || a.type === 'note').map(a => ({ id: a.id.substring(0, 8), loc: a.location?.substring(0, 40), text: a.selectedText?.substring(0, 30) })));

        if (!cfi) {
            debug('[Reader] Empty CFI, ignoring');
            return;
        }

        const resolvePickerPosition = (anchor?: Range | MouseEvent) => {
            if (anchor && 'getBoundingClientRect' in anchor) {
                const rect = anchor.getBoundingClientRect();
                let normalizedLeft = rect.left;
                let normalizedTop = rect.top;

                // Ranges from foliate iframes report coordinates in iframe space.
                // Convert to top-level viewport so fixed overlays align correctly.
                const rangeDocument = anchor.startContainer?.ownerDocument;
                const frameElement = rangeDocument?.defaultView?.frameElement;
                if (frameElement instanceof HTMLElement) {
                    const frameRect = frameElement.getBoundingClientRect();
                    normalizedLeft += frameRect.left;
                    normalizedTop += frameRect.top;
                }

                return {
                    x: normalizedLeft + rect.width / 2,
                    y: normalizedTop,
                    height: Math.max(rect.height, 24),
                };
            }

            if (anchor && 'clientX' in anchor) {
                return {
                    x: anchor.clientX,
                    y: anchor.clientY,
                };
            }

            return {
                x: window.innerWidth / 2,
                y: window.innerHeight / 3,
            };
        };

        // Robust duplicate detection: check CFI (exact or partial), then text content
        // This prevents duplicates when CFIs vary slightly for the same text
        let existingAnnotation = freshAnnotations.find(a => {
            // Match by exact CFI for highlights/notes
            if (a.location === cfi && (a.type === 'highlight' || a.type === 'note')) {
                debug('[Reader] Matched annotation by exact CFI:', a.id);
                return true;
            }
            // Partial CFI match: one is prefix of the other (handles CFI variations)
            if (a.location && cfi && (a.type === 'highlight' || a.type === 'note')) {
                const isPrefixMatch = cfi.startsWith(a.location) || a.location.startsWith(cfi);
                if (isPrefixMatch) {
                    debug('[Reader] Matched annotation by partial CFI:', a.id, { cfi: cfi.substring(0, 40), stored: a.location.substring(0, 40) });
                    return true;
                }
            }
            // Fallback: match by text content if text is provided and long enough
            // This handles cases where CFIs differ slightly for the same selection
            if (text && text.length > 3 && a.selectedText &&
                a.type !== 'bookmark' &&
                a.selectedText.trim() === text.trim()) {
                debug('[Reader] Matched annotation by text content:', a.id);
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
            debug('[Reader] ✓ Found existing annotation:', existingAnnotation.id, existingAnnotation.type, '- setting editingHighlightId');
            setActiveAnnotation(existingAnnotation);
            setEditingHighlightId(existingAnnotation.id);
            debug('[Reader] editingHighlightId set to:', existingAnnotation.id);
            setSelectedCfi(existingAnnotation.location); // Use stored location for consistency
            setSelectedText(existingAnnotation.selectedText || text || '');

            const pickerPosition = resolvePickerPosition(rangeOrEvent);
            debug('[Reader] Positioning color picker:', pickerPosition);
            setColorPickerPosition(pickerPosition);

            setColorPickerMode("actions");
            setDictionaryLookupTerm('');
            setDictionaryLookupResult(null);
            setDictionaryLookupError(null);
            setDictionaryLookupLoading(false);
            setDictionaryLookupSaved(false);
            setShowColorPicker(true);
        } else {
            // Show color picker for new text selection
            debug('[Reader] ✗ No existing annotation found - treating as new selection');
            if (!text.trim()) {
                debug('[Reader] Empty text selection, ignoring');
                return;
            }

            // Clear any previous editing state for new selections
            setEditingHighlightId(null);
            setActiveAnnotation(null);
            setSelectedCfi(cfi);
            setSelectedText(text);

            const pickerPosition = resolvePickerPosition(rangeOrEvent);
            debug('[Reader] Positioning color picker:', pickerPosition);
            setColorPickerPosition(pickerPosition);

            setColorPickerMode("actions");
            setDictionaryLookupTerm('');
            setDictionaryLookupResult(null);
            setDictionaryLookupError(null);
            setDictionaryLookupLoading(false);
            setDictionaryLookupSaved(false);
            setShowColorPicker(true);
        }
    }, [currentBookId, getBookAnnotations]); // Remove colorPickerPosition dependency

    const handleDefineSelection = useCallback(async () => {
        const term = selectedText.trim();
        if (!term) {
            return;
        }

        // Hide native selection handles before showing the larger dictionary panel.
        readerRef.current?.clearSelection?.();
        if (typeof window !== "undefined") {
            window.getSelection?.()?.removeAllRanges?.();
        }

        setColorPickerMode("dictionary");
        setShowColorPicker(true);
        setDictionaryLookupTerm(term);
        setDictionaryLookupResult(null);
        setDictionaryLookupError(null);
        setDictionaryLookupSaved(false);
        setDictionaryLookupLoading(true);

        try {
            const result = await lookupTerm(term, "en");
            setDictionaryLookupResult(result);
            if (!result) {
                if (
                    settings.vocabulary.dictionaryMode === "offline"
                    && installedDictionaryCount === 0
                ) {
                    setDictionaryLookupError(
                        "Offline mode is enabled but no dictionaries are installed. Import a StarDict dictionary in Settings > Dictionary.",
                    );
                } else {
                    setDictionaryLookupError("No dictionary result found for this selection.");
                }
            }
        } catch (error) {
            console.error("[Reader] Dictionary lookup failed:", error);
            setDictionaryLookupError("Dictionary lookup failed. Try again when online or install offline dictionaries.");
        } finally {
            setDictionaryLookupLoading(false);
        }
    }, [
        installedDictionaryCount,
        lookupTerm,
        selectedText,
        settings.vocabulary.dictionaryMode,
    ]);

    const handleSaveDictionaryResult = useCallback(() => {
        if (!dictionaryLookupResult || !settings.vocabulary.vocabularyEnabled) {
            return;
        }

        saveVocabularyTerm(
            vocabularyTermFromLookup(dictionaryLookupResult),
            currentBook
                ? {
                    sourceType: "book",
                    sourceId: currentBook.id,
                    label: currentBook.title,
                }
                : undefined,
        );
        setDictionaryLookupSaved(true);
    }, [currentBook, dictionaryLookupResult, saveVocabularyTerm, settings.vocabulary.vocabularyEnabled]);

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
                    debug('[Reader] Updated existing highlight color:', editingHighlightId, color);
                } catch (err) {
                    console.warn('[Reader] Failed to update highlight in viewport:', err);
                }
            }

            setShowColorPicker(false);
            setColorPickerMode("actions");
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
            debug('[Reader] Found existing highlight, updating color instead of creating duplicate:', existingHighlight.id);
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
                    const annotationWithBookId = {
                        ...annotation,
                        bookId: currentBookId,
                        referenceId: annotation.referenceId || currentBookId,
                    };
                    // Use the annotation from the engine (which has the correct ID)
                    addAnnotation(annotationWithBookId);
                    setAnnotations(prev => [...prev, annotationWithBookId]);
                    debug('[Reader] Created new highlight:', annotationWithBookId.id);
                } else {
                    console.warn('[Reader] addHighlight returned null/undefined');
                }
            } catch (err) {
                console.warn('[Reader] Failed to add highlight to viewport:', err);
            }
        }

        setShowColorPicker(false);
        setColorPickerMode("actions");
        setEditingHighlightId(null);
        setActiveAnnotation(null);
        setSelectedText('');
        setSelectedCfi('');

        // Clear selection
        readerRef.current?.clearSelection?.();
    }, [selectedCfi, selectedText, currentBookId, addAnnotation, editingHighlightId, annotations, updateAnnotation]);

    const handleAddNote = useCallback(() => {
        if (!selectedCfi || !currentBookId) return;

        debug('[Reader] Opening note editor, editingHighlightId:', editingHighlightId, 'activeAnnotation:', activeAnnotation?.id);

        // Close color picker and open note editor
        setShowColorPicker(false);
        setColorPickerMode("actions");
        setNoteEditorPosition(colorPickerPosition);

        // If editing existing highlight, use its note content and color
        // Preserve editingHighlightId for handleSaveNote to use
        if (editingHighlightId && activeAnnotation) {
            setEditingNote(activeAnnotation.noteContent || '');
            setPendingHighlightColor(activeAnnotation.color || 'yellow');
            debug('[Reader] Editing existing highlight, preserving ID:', editingHighlightId);
        } else {
            setEditingNote('');
            setPendingHighlightColor('yellow');
            debug('[Reader] Creating new highlight with note');
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
            debug('[Reader] Adding note to existing highlight:', existingHighlight.id);
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
            const updatedAnnotation: Annotation = {
                ...existingHighlight,
                type: noteContent ? 'note' : 'highlight',
                noteContent: noteContent || undefined,
                updatedAt: new Date()
            };
            try {
                await readerRef.current?.removeHighlight?.(existingHighlight.id);
                await readerRef.current?.addAnnotation?.(updatedAnnotation);
                debug('[Reader] Re-rendered highlight with note in viewport');
            } catch (err) {
                console.warn('[Reader] Failed to re-render highlight with note:', err);
            }
        } else {
            // Create new highlight with note
            debug('[Reader] Creating new highlight with note');
            const annotation: Annotation = {
                id: crypto.randomUUID(),
                bookId: currentBookId,
                referenceId: currentBookId,
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
    }, [
        selectedCfi,
        selectedText,
        currentBookId,
        annotations,
        addAnnotation,
        editingHighlightId,
        pendingHighlightColor,
        updateAnnotation,
    ]);

    const handleBookmarkFromSelection = useCallback(() => {
        if (!selectedCfi || !currentBookId) return;

        const annotation: Annotation = {
            id: crypto.randomUUID(),
            bookId: currentBookId,
            referenceId: currentBookId,
            type: 'bookmark',
            location: selectedCfi,
            selectedText,
            createdAt: new Date(),
        };

        addAnnotation(annotation);
        setAnnotations(prev => [...prev, annotation]);

        setShowColorPicker(false);
        setColorPickerMode("actions");
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
                referenceId: currentBookId,
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

        debug('[Reader] Deleting highlight:', editingHighlightId);

        // Remove from viewport FIRST (before removing from store)
        // This is important because the engine needs to find the annotation in its internal map
        try {
            await readerRef.current?.removeHighlight?.(editingHighlightId);
            debug('[Reader] Successfully removed highlight from viewport');
        } catch (err) {
            console.warn('[Reader] Failed to remove highlight from viewport:', err);
        }

        // Then remove from store
        removeAnnotation(editingHighlightId);

        // Update local state
        setAnnotations(prev => prev.filter(a => a.id !== editingHighlightId));

        // Clear all related state
        setShowColorPicker(false);
        setColorPickerMode("actions");
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
        const displayLoadError = loadError.replace(/\s+/g, " ").trim();

        return (
            <div className="fixed inset-0 flex items-center justify-center bg-[var(--color-background)] px-4 sm:px-8 py-8">
                <div className="mx-auto w-full max-w-[26rem] min-w-0 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-[var(--color-error)]/10 flex items-center justify-center mb-6 text-[color:var(--color-error)]">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h2 className="w-full break-words text-balance text-xl font-semibold text-[color:var(--color-text-primary)] mb-2">
                        Failed to Load Book
                    </h2>
                    <p className="mx-auto w-full max-w-[24rem] break-words text-[color:var(--color-text-secondary)] mb-8 leading-relaxed">
                        {displayLoadError}
                    </p>
                    <button
                        onClick={() => setRoute('library')}
                        className="ui-btn-primary"
                    >
                        Back to Library
                    </button>
                </div>
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
                ref={toolbarContainerRef}
                className={cn(
                    "absolute top-0 left-0 right-0 z-[140] transition-transform duration-300",
                    shouldShowReaderChrome ? "translate-y-0" : "-translate-y-full"
                )}
            >
                <WindowTitlebar
                    metadata={metadata}
                    location={location}
                    onBack={handleBack}
                    onPrevPage={() => readerRef.current?.prev()}
                    onNextPage={() => readerRef.current?.next()}
                    onToggleToc={() => togglePanel('toc')}
                    onToggleSettings={() => togglePanel('settings')}
                    onToggleBookmarks={() => togglePanel('bookmarks')}
                    onToggleSearch={() => togglePanel('search')}
                    onToggleInfo={() => togglePanel('info')}
                    onToggleMenu={() => togglePanel('menu')}
                    onAddBookmark={isPdfFormat ? handlePdfAddBookmark : handleAddPageBookmark}
                    isCurrentPageBookmarked={isPdfFormat ? isPdfPageBookmarked : isCurrentPageBookmarked}
                    activePanel={activePanel}
                    fullscreen={settings.readerSettings.fullscreen}
                    onToggleFullscreen={() => updateReaderSettings({ fullscreen: !settings.readerSettings.fullscreen })}

                />
            </div>

            {/* Reader Viewport - Use PDFReader for PDF, ReaderViewport for others */}
            <div
                className={cn(
                    "flex-1 min-h-0 overflow-hidden relative",
                    !isPdfFormat && (
                        shouldShowReaderChrome ? "pb-14 sm:pb-12" : "pb-[env(safe-area-inset-bottom,var(--spacing-md))]"
                    ),
                )}
                style={{
                    paddingTop: shouldShowReaderChrome
                        ? `${toolbarHeight}px`
                        : "max(env(safe-area-inset-top, 0px), var(--spacing-md, 16px))",
                    paddingBottom: shouldShowReaderChrome
                        ? undefined
                        : "max(env(safe-area-inset-bottom, 0px), var(--spacing-lg, 32px))"
                }}
            >
                {isPdfFormat ? (
                    <PDFReader
                        ref={pdfReaderRef}
                        pdfPath={resolvedPdfPath}
                        pdfData={pdfData ?? undefined}
                        originalFilename={currentBook?.title}
                        initialPage={pdfInitialPage}
                        initialZoom={pdfInitialZoom}
                        initialZoomMode={pdfInitialZoomMode}
                        theme={settings.readerSettings.theme}
                        onPageChange={handlePdfPageChange}
                        onZoomModeChange={handlePdfZoomModeChange}
                        onLoad={handlePdfLoad}
                        onError={handlePdfError}
                        onViewportTap={handleViewportTap}
                        annotations={annotations}
                        annotationMode={pdfAnnotationMode}
                        highlightColor={pdfHighlightColor}
                        penColor={pdfBrushColor}
                        penWidth={pdfBrushWidth}
                        onAnnotationAdd={handlePdfAnnotationAdd}
                        onAnnotationChange={handlePdfAnnotationChange}
                        onAnnotationRemove={handlePdfAnnotationRemove}
                    />
                ) : (
                    <ReaderViewport
                        key={currentBookId || 'no-book'}
                        ref={readerRef}
                        file={file}
                        settings={effectiveReaderSettings}
                        format={currentBook?.format}
                        initialLocation={initialLocation}
                        savedLocations={getBook(currentBookId || '')?.locations}
                        onReady={handleReady}
                        onLocationChange={handleLocationChange}
                        onLocationsSaved={handleLocationsSaved}
                        onTextSelected={handleTextSelected}
                        onViewportTap={handleViewportTap}
                        shouldForceViewportTap={shouldForceViewportTap}
                        onZoomGestureChange={handleZoomGestureChange}
                        className="w-full h-full"
                    />
                )}
            </div>

            {/* PDF Floating Toolbar & TOC Button */}
            {isBookReady && isPdfFormat && (
                <>
                    <button
                        onClick={() => togglePanel('toc')}
                        className={cn(
                            "fixed bottom-6 z-[100]",
                            isMobileViewport ? "left-4" : "left-8",
                            "flex items-center justify-center w-12 h-12 shadow-xl transition-all duration-300",
                            "bg-[var(--color-surface)]/90 backdrop-blur-xl text-[var(--color-text-primary)] border border-[var(--color-border)]",
                            "hover:scale-105 active:scale-95 hover:bg-[var(--color-surface)]",
                            (shouldShowReaderChrome || pdfAnnotationMode !== 'none') ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0 pointer-events-none"
                        )}
                        aria-label="Table of Contents"
                    >
                        <List className="w-5 h-5" />
                    </button>
                    <PDFFloatingToolbar
                        annotationMode={pdfAnnotationMode}
                        highlightColor={pdfHighlightColor}
                        penColor={pdfBrushColor}
                        penWidth={pdfBrushWidth}
                        onAnnotationModeChange={setPdfAnnotationMode}
                        onHighlightColorChange={setPdfHighlightColor}
                        onPenColorChange={setPdfBrushColor}
                        onPenWidthChange={setPdfBrushWidth}
                        className={cn(
                            "bottom-6 transition-all duration-300",
                            isMobileViewport ? "right-4" : "right-8",
                            (shouldShowReaderChrome || pdfAnnotationMode !== 'none') ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0 pointer-events-none"
                        )}
                    />
                </>
            )}

            {/* Bottom Progress Navbar - only for non-PDF formats */}
            {isBookReady && !isPdfFormat && (
                <ReaderNavbar
                    location={location}
                    toc={toc}
                    sectionFractions={sectionFractions}
                    onSeek={handleSeek}
                    totalPages={location?.pageInfo?.totalPages}
                    onToggleToc={() => togglePanel('toc')}
                    className={cn(
                        "fixed bottom-0 left-0 right-0 z-40 transition-transform duration-300",
                        shouldShowReaderChrome ? "translate-y-0" : "translate-y-full pointer-events-none",
                    )}
                />
            )}

            {/* Panels - TOC + annotations available for all formats */}
            <TableOfContents
                toc={toc}
                visible={activePanel === 'toc'}
                onClose={() => setActivePanel(null)}
                onNavigate={goTo}
                currentHref={isPdfFormat ? `pdf:page:${pdfCurrentPage}` : location?.tocItem?.href}
                isPdf={isPdfFormat}
                pdfHasOutline={pdfHasOutline}
            />

            <ReaderAnnotationsPanel
                bookId={currentBookId || ''}
                visible={activePanel === 'bookmarks'}
                onClose={() => setActivePanel(null)}
                onNavigate={goTo}
                onDelete={(id) => {
                    if (isPdfFormat) {
                        handlePdfAnnotationRemove(id);
                        return;
                    }
                    readerRef.current?.removeHighlight?.(id);
                }}
            />

            {/* Reader settings/info panels */}
            {isPdfFormat ? (
                <PDFViewSettingsPanel
                    visible={activePanel === "settings"}
                    onClose={() => setActivePanel(null)}
                    zoom={pdfZoom}
                    zoomMode={pdfZoomMode}
                    onZoomIn={handlePdfZoomIn}
                    onZoomOut={handlePdfZoomOut}
                    onZoomReset={handlePdfZoomReset}
                    onFitPage={handlePdfZoomFitPage}
                    onFitWidth={handlePdfZoomFitWidth}
                    onRotate={() => pdfReaderRef.current?.rotateClockwise()}
                />
            ) : (
                <ReaderSettings
                    settings={effectiveReaderSettings}
                    visible={activePanel === 'settings'}
                    onClose={() => setActivePanel(null)}
                    onUpdate={handleReaderSettingsUpdate}
                    format={getBook(currentBookId || '')?.format}
                />
            )}

            <BookInfoPopover
                metadata={metadata}
                visible={activePanel === 'info'}
                onClose={() => setActivePanel(null)}
            />

            {/* Search panel available for EPUB/PDF */}
            <ReaderSearch
                visible={activePanel === 'search'}
                onClose={() => setActivePanel(null)}
                onNavigate={goTo}
                onSearch={(q) => {
                    if (isPdfFormat) {
                        return pdfReaderRef.current?.search(q) || (async function* () {
                            yield 'done' as const;
                        })();
                    }
                    return readerRef.current?.search(q) || (async function* () {
                        yield 'done' as const;
                    })();
                }}
                onClearSearch={() => {
                    if (isPdfFormat) {
                        pdfReaderRef.current?.clearSearch();
                        return;
                    }
                    readerRef.current?.clearSearch();
                }}
            />

            {/* Highlight Color Picker Popup - only for non-PDF formats */}
            {!isPdfFormat && (
                <>
                    <HighlightColorPicker
                        isOpen={showColorPicker}
                        position={colorPickerPosition}
                        currentColor={activeAnnotation?.color}
                        onSelectColor={handleColorSelect}
                        onAddNote={handleAddNote}
                        onDefine={handleDefineSelection}
                        onBookmark={handleBookmarkFromSelection}
                        onDelete={editingHighlightId ? handleDeleteFromColorPicker : undefined}
                        viewportPadding={colorPickerViewportPadding}
                        dictionary={colorPickerMode === "dictionary"
                            ? {
                                term: dictionaryLookupTerm,
                                result: dictionaryLookupResult,
                                loading: dictionaryLookupLoading,
                                error: dictionaryLookupError,
                                saved: dictionaryLookupSaved,
                                canSaveToVocabulary: settings.vocabulary.vocabularyEnabled,
                                saveDisabledMessage: "Enable Vocabulary Builder in Settings to save terms.",
                                onSave: handleSaveDictionaryResult,
                                onBack: () => {
                                    setColorPickerMode("actions");
                                },
                            }
                            : undefined}
                        onClose={() => {
                            setShowColorPicker(false);
                            setColorPickerMode("actions");
                            setEditingHighlightId(null);
                            setActiveAnnotation(null);
                            setSelectedText('');
                            setSelectedCfi('');
                            setDictionaryLookupTerm('');
                            setDictionaryLookupResult(null);
                            setDictionaryLookupError(null);
                            setDictionaryLookupLoading(false);
                            setDictionaryLookupSaved(false);
                            readerRef.current?.clearSelection?.();
                        }}
                    />

                    {/* Note Editor */}
                    <NoteEditor
                        isOpen={showNoteEditor}
                        position={noteEditorPosition}
                        initialNote={editingNote}
                        selectedText={selectedText}
                        viewportPadding={readerPopoverPadding}
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

                </>
            )}
        </div>
    );
}

export function ReaderPage() {
    const currentRoute = useUIStore((state) => state.currentRoute);
    const currentBookId = useUIStore((state) => state.currentBookId);
    const setRoute = useUIStore((state) => state.setRoute);
    const currentArticle = useRssStore((state) => state.currentArticle);
    const feeds = useRssStore((state) => state.feeds);
    const closeArticleViewer = useRssStore((state) => state.closeArticleViewer);

    useEffect(() => {
        if (currentRoute === "reader" && !currentArticle && !currentBookId) {
            setRoute("feeds");
        }
    }, [currentArticle, currentBookId, currentRoute, setRoute]);

    if (currentRoute === "reader" && currentArticle) {
        const feedTitle = feeds.find((feed) => feed.id === currentArticle.feedId)?.title;

        return (
            <ArticleViewer
                article={currentArticle}
                feedTitle={feedTitle}
                isOpen={true}
                onClose={closeArticleViewer}
            />
        );
    }

    return <BookReaderPage />;
}
