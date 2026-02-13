import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    cn,
    HIGHLIGHT_COLOR_TOKENS,
    useLearningStore,
    useSettingsStore,
    vocabularyTermFromLookup,
    type DictionaryLookupResult,
    type DocLocation,
    type DocMetadata,
    type HighlightColor,
    type ReaderSettings as ReaderSettingsState,
    type ReaderTheme,
    type RssArticle,
} from "@theorem/core";
import { Backdrop } from "@theorem/ui";
import { DictionaryResultPopover } from "@theorem/feature-learning";
import { WindowTitlebar } from "@theorem/feature-reader";
import {
    ArticleReaderContent,
    ArticleReaderHighlightsPanel,
    ArticleReaderInfoPanel,
    ArticleReaderOutlinePanel,
    ArticleReaderSearchPanel,
    ArticleReaderSettingsPanel,
    ArticleSelectionPopover,
    type ArticleHeading,
    type ArticleHighlight,
    type ArticleReaderPanel,
    type ArticleScrollBookmark,
} from "./article-reader";
import { buildArticleDescription, formatArticleDate } from "./article-reader/utils";

interface ArticleViewerProps {
    article: RssArticle | null;
    feedTitle?: string;
    isOpen: boolean;
    onClose: () => void;
    onToggleFavorite?: () => void;
}

const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 32;
const MIN_LINE_HEIGHT = 1.2;
const MAX_LINE_HEIGHT = 2.2;
const MIN_BRIGHTNESS = 20;
const MAX_BRIGHTNESS = 100;
const BOOKMARK_SNAP_THRESHOLD = 0.012;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function applyHighlightToRange(
    range: Range,
    contentRoot: HTMLElement,
    highlightId: string,
    color: HighlightColor,
): boolean {
    const workingRange = range.cloneRange();
    const selectedText = workingRange.toString().trim();
    if (!selectedText) {
        return false;
    }

    const mark = document.createElement("mark");
    mark.className = "article-highlight";
    mark.dataset.highlightId = highlightId;
    mark.dataset.highlightColor = color;
    mark.style.backgroundColor = HIGHLIGHT_COLOR_TOKENS[color].soft;
    mark.style.borderRadius = "2px";
    mark.style.padding = "0 1px";
    mark.style.color = "inherit";
    mark.style.setProperty("box-decoration-break", "clone");
    mark.style.setProperty("-webkit-box-decoration-break", "clone");

    try {
        // Fast path for simple inline selections.
        workingRange.surroundContents(mark);
        return true;
    } catch {
        // Fallback for complex selections (for example full paragraph selections).
        try {
            const fragment = workingRange.extractContents();
            if (!fragment.textContent?.trim()) {
                return false;
            }
            mark.appendChild(fragment);
            workingRange.insertNode(mark);
            return contentRoot.contains(mark);
        } catch {
            return false;
        }
    }
}

export function ArticleViewer({
    article,
    feedTitle,
    isOpen,
    onClose,
    onToggleFavorite,
}: ArticleViewerProps) {
    const globalReaderSettings = useSettingsStore((state) => state.settings.readerSettings);
    const updateReaderSettings = useSettingsStore((state) => state.updateReaderSettings);
    const learningSettings = useSettingsStore((state) => state.settings.learning);
    const lookupTerm = useLearningStore((state) => state.lookupTerm);
    const saveVocabularyTerm = useLearningStore((state) => state.saveVocabularyTerm);

    const [activePanel, setActivePanel] = useState<ArticleReaderPanel>(null);
    const [fontSize, setFontSize] = useState(18);
    const [lineHeight, setLineHeight] = useState(1.6);
    const [brightness, setBrightness] = useState(100);
    const [theme, setTheme] = useState<ReaderTheme>("light");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [readingProgress, setReadingProgress] = useState(0);
    const [toolbarHeight, setToolbarHeight] = useState(56);
    const [headings, setHeadings] = useState<ArticleHeading[]>([]);
    const [highlights, setHighlights] = useState<ArticleHighlight[]>([]);
    const [bookmarks, setBookmarks] = useState<ArticleScrollBookmark[]>([]);

    const [selectionPopover, setSelectionPopover] = useState<{
        isOpen: boolean;
        text: string;
        position: { x: number; y: number };
    }>({ isOpen: false, text: "", position: { x: 0, y: 0 } });

    const [dictionaryState, setDictionaryState] = useState<{
        isOpen: boolean;
        term: string;
        position: { x: number; y: number };
        result: DictionaryLookupResult | null;
        loading: boolean;
        error: string | null;
        saved: boolean;
    }>({
        isOpen: false,
        term: "",
        position: { x: 0, y: 0 },
        result: null,
        loading: false,
        error: null,
        saved: false,
    });

    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const toolbarContainerRef = useRef<HTMLDivElement>(null);
    const selectedRangeRef = useRef<Range | null>(null);

    useEffect(() => {
        if (!isOpen || !article) {
            return;
        }

        setFontSize(clamp(globalReaderSettings.fontSize ?? 18, MIN_FONT_SIZE, MAX_FONT_SIZE));
        setLineHeight(clamp(globalReaderSettings.lineHeight ?? 1.6, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT));
        setBrightness(clamp(globalReaderSettings.brightness ?? 100, MIN_BRIGHTNESS, MAX_BRIGHTNESS));
        setTheme(globalReaderSettings.theme ?? "light");
        setIsFullscreen(Boolean(globalReaderSettings.fullscreen));
    }, [
        article,
        globalReaderSettings.brightness,
        globalReaderSettings.fontSize,
        globalReaderSettings.fullscreen,
        globalReaderSettings.lineHeight,
        globalReaderSettings.theme,
        isOpen,
    ]);

    useEffect(() => {
        setActivePanel(null);
        setHeadings([]);
        setHighlights([]);
        setBookmarks([]);
        setReadingProgress(0);
        selectedRangeRef.current = null;
        setSelectionPopover({ isOpen: false, text: "", position: { x: 0, y: 0 } });
        setDictionaryState({
            isOpen: false,
            term: "",
            position: { x: 0, y: 0 },
            result: null,
            loading: false,
            error: null,
            saved: false,
        });

        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = 0;
        }
    }, [article?.id]);

    useLayoutEffect(() => {
        if (!isOpen) {
            return;
        }

        const element = toolbarContainerRef.current;
        if (!element) {
            return;
        }

        const updateToolbarHeight = () => {
            const nextHeight = Math.round(element.getBoundingClientRect().height);
            if (nextHeight > 0) {
                setToolbarHeight(nextHeight);
            }
        };

        updateToolbarHeight();

        const windowResizeHandler = () => updateToolbarHeight();
        window.addEventListener("resize", windowResizeHandler);

        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(updateToolbarHeight);
            observer.observe(element);
            return () => {
                observer.disconnect();
                window.removeEventListener("resize", windowResizeHandler);
            };
        }

        return () => {
            window.removeEventListener("resize", windowResizeHandler);
        };
    }, [isOpen]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container || !isOpen) {
            return;
        }

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container;
            const denominator = scrollHeight - clientHeight;
            const progress = denominator > 0 ? scrollTop / denominator : 0;
            setReadingProgress(clamp(progress, 0, 1));
        };

        handleScroll();
        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            container.removeEventListener("scroll", handleScroll);
        };
    }, [article?.id, isOpen]);

    const updateReaderSetting = useCallback((updates: Partial<ReaderSettingsState>) => {
        updateReaderSettings(updates);
    }, [updateReaderSettings]);

    const handleToggleFullscreen = useCallback(() => {
        setIsFullscreen((current) => {
            const next = !current;
            updateReaderSetting({ fullscreen: next });
            return next;
        });
    }, [updateReaderSetting]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const runFullscreen = async () => {
            try {
                if (isFullscreen) {
                    if (!document.fullscreenElement) {
                        await document.documentElement.requestFullscreen();
                    }
                } else if (document.fullscreenElement) {
                    await document.exitFullscreen();
                }
            } catch (error) {
                console.error("[ArticleViewer] Fullscreen error:", error);
            }
        };

        void runFullscreen();

        const onFullscreenChange = () => {
            if (!document.fullscreenElement && isFullscreen) {
                setIsFullscreen(false);
                updateReaderSetting({ fullscreen: false });
            }
        };

        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", onFullscreenChange);
        };
    }, [isFullscreen, isOpen, updateReaderSetting]);

    const togglePanel = useCallback((panel: Exclude<ArticleReaderPanel, null>) => {
        setActivePanel((current) => (current === panel ? null : panel));
    }, []);

    const closePanel = useCallback(() => {
        setActivePanel(null);
    }, []);

    const clearBrowserSelection = useCallback(() => {
        window.getSelection()?.removeAllRanges();
    }, []);

    const handleThemeChange = useCallback((nextTheme: ReaderTheme) => {
        setTheme(nextTheme);
        updateReaderSetting({ theme: nextTheme });
    }, [updateReaderSetting]);

    const handleFontSizeChange = useCallback((value: number) => {
        const next = clamp(value, MIN_FONT_SIZE, MAX_FONT_SIZE);
        setFontSize(next);
        updateReaderSetting({ fontSize: next });
    }, [updateReaderSetting]);

    const handleLineHeightChange = useCallback((value: number) => {
        const next = clamp(value, MIN_LINE_HEIGHT, MAX_LINE_HEIGHT);
        setLineHeight(next);
        updateReaderSetting({ lineHeight: next });
    }, [updateReaderSetting]);

    const handleBrightnessChange = useCallback((value: number) => {
        const next = clamp(value, MIN_BRIGHTNESS, MAX_BRIGHTNESS);
        setBrightness(next);
        updateReaderSetting({ brightness: next });
    }, [updateReaderSetting]);

    const scrollByViewport = useCallback((direction: -1 | 1) => {
        const container = scrollContainerRef.current;
        if (!container) {
            return;
        }

        const step = Math.max(220, Math.floor(container.clientHeight * 0.86));
        container.scrollBy({
            top: direction * step,
            behavior: "smooth",
        });
    }, []);

    const getCurrentHeadingLabel = useCallback((): string => {
        const contentElement = contentRef.current;
        const container = scrollContainerRef.current;
        if (!contentElement || !container) {
            return `${Math.round(readingProgress * 100)}%`;
        }

        const headingElements = Array.from(contentElement.querySelectorAll<HTMLElement>("h1, h2, h3, h4"));
        if (headingElements.length === 0) {
            return `${Math.round(readingProgress * 100)}%`;
        }

        const containerTop = container.getBoundingClientRect().top;
        let currentHeading: HTMLElement | null = null;

        for (const heading of headingElements) {
            const offset = heading.getBoundingClientRect().top - containerTop;
            if (offset <= 72) {
                currentHeading = heading;
            } else {
                break;
            }
        }

        return currentHeading?.textContent?.trim() || `${Math.round(readingProgress * 100)}%`;
    }, [readingProgress]);

    const currentBookmark = useMemo(() => (
        bookmarks.find((bookmark) => Math.abs(bookmark.progress - readingProgress) <= BOOKMARK_SNAP_THRESHOLD) || null
    ), [bookmarks, readingProgress]);

    const handleAddScrollBookmark = useCallback(() => {
        const progress = clamp(readingProgress, 0, 1);

        setBookmarks((current) => {
            const existing = current.find(
                (bookmark) => Math.abs(bookmark.progress - progress) <= BOOKMARK_SNAP_THRESHOLD,
            );

            if (existing) {
                return current.filter((bookmark) => bookmark.id !== existing.id);
            }

            const bookmark: ArticleScrollBookmark = {
                id: crypto.randomUUID(),
                progress,
                label: getCurrentHeadingLabel(),
                createdAt: new Date(),
            };

            return [...current, bookmark].sort((left, right) => left.progress - right.progress);
        });
    }, [getCurrentHeadingLabel, readingProgress]);

    const handleDeleteBookmark = useCallback((bookmarkId: string) => {
        setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId));
    }, []);

    const handleJumpToBookmark = useCallback((bookmarkId: string) => {
        const container = scrollContainerRef.current;
        if (!container) {
            return;
        }

        const bookmark = bookmarks.find((entry) => entry.id === bookmarkId);
        if (!bookmark) {
            return;
        }

        const maxScroll = container.scrollHeight - container.clientHeight;
        container.scrollTo({
            top: Math.max(0, Math.floor(maxScroll * bookmark.progress)),
            behavior: "smooth",
        });
        setActivePanel(null);
    }, [bookmarks]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
                event.preventDefault();
                setActivePanel((current) => (current === "search" ? null : "search"));
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
                event.preventDefault();
                handleAddScrollBookmark();
                return;
            }

            if (event.key !== "Escape") {
                return;
            }

            if (activePanel) {
                setActivePanel(null);
                return;
            }
            if (selectionPopover.isOpen) {
                selectedRangeRef.current = null;
                setSelectionPopover((previous) => ({ ...previous, isOpen: false }));
                clearBrowserSelection();
                return;
            }
            if (dictionaryState.isOpen) {
                setDictionaryState((previous) => ({ ...previous, isOpen: false }));
                return;
            }
            onClose();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [
        activePanel,
        clearBrowserSelection,
        dictionaryState.isOpen,
        handleAddScrollBookmark,
        isOpen,
        onClose,
        selectionPopover.isOpen,
    ]);

    const handleTextSelect = useCallback((text: string, position: { x: number; y: number }, range: Range) => {
        selectedRangeRef.current = range;
        setSelectionPopover({ isOpen: true, text, position });
    }, []);

    const handleHighlight = useCallback((color: HighlightColor) => {
        if (!selectionPopover.text.trim()) {
            return;
        }

        const contentRoot = contentRef.current;
        const selectedRange = selectedRangeRef.current;
        if (!contentRoot || !selectedRange) {
            return;
        }
        if (!contentRoot.contains(selectedRange.commonAncestorContainer)) {
            return;
        }

        const highlightId = crypto.randomUUID();
        const applied = applyHighlightToRange(selectedRange, contentRoot, highlightId, color);
        if (!applied) {
            return;
        }

        const nextHighlight: ArticleHighlight = {
            id: highlightId,
            text: selectionPopover.text.trim(),
            color,
            createdAt: new Date(),
        };

        setHighlights((current) => [...current, nextHighlight]);
        selectedRangeRef.current = null;
        setSelectionPopover((previous) => ({ ...previous, isOpen: false }));
        clearBrowserSelection();
    }, [clearBrowserSelection, selectionPopover.text]);

    const handleDeleteHighlight = useCallback((highlightId: string) => {
        setHighlights((current) => current.filter((highlight) => highlight.id !== highlightId));

        const marks = contentRef.current?.querySelectorAll(`mark.article-highlight[data-highlight-id="${highlightId}"]`) || [];
        marks.forEach((mark) => {
            const parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
                parent.normalize();
            }
        });
    }, []);

    const handleJumpToHeading = useCallback((headingId: string) => {
        const target = document.getElementById(headingId);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        setActivePanel(null);
    }, []);

    const handleJumpToHighlight = useCallback((highlightId: string) => {
        const target = contentRef.current?.querySelector<HTMLElement>(
            `mark.article-highlight[data-highlight-id="${highlightId}"]`,
        );
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        setActivePanel(null);
    }, []);

    const handleDefine = useCallback(async () => {
        const term = selectionPopover.text.trim();
        if (!term) {
            return;
        }

        selectedRangeRef.current = null;
        setSelectionPopover((previous) => ({ ...previous, isOpen: false }));
        clearBrowserSelection();
        setDictionaryState({
            isOpen: true,
            term,
            position: selectionPopover.position,
            result: null,
            loading: true,
            error: null,
            saved: false,
        });

        try {
            const result = await lookupTerm(term, "en");
            setDictionaryState((previous) => ({
                ...previous,
                loading: false,
                result,
            }));
        } catch (error) {
            setDictionaryState((previous) => ({
                ...previous,
                loading: false,
                error: error instanceof Error ? error.message : "Lookup failed",
            }));
        }
    }, [clearBrowserSelection, lookupTerm, selectionPopover.position, selectionPopover.text]);

    const handleCopy = useCallback(() => {
        const text = selectionPopover.text.trim();
        if (!text) {
            return;
        }

        void navigator.clipboard.writeText(text).catch((error) => {
            console.error("[ArticleViewer] Failed to copy selected text:", error);
        });

        selectedRangeRef.current = null;
        setSelectionPopover((previous) => ({ ...previous, isOpen: false }));
        clearBrowserSelection();
    }, [clearBrowserSelection, selectionPopover.text]);

    const handleSaveToVocabulary = useCallback(() => {
        if (!dictionaryState.result || !article) {
            return;
        }

        const term = vocabularyTermFromLookup(dictionaryState.result);
        saveVocabularyTerm(term, {
            sourceType: "site",
            sourceId: article.id,
            label: article.title,
        });

        setDictionaryState((previous) => ({ ...previous, saved: true }));
    }, [article, dictionaryState.result, saveVocabularyTerm]);

    const metadata = useMemo<DocMetadata | null>(() => {
        if (!article) {
            return null;
        }

        return {
            title: article.title || "Untitled Article",
            author: article.author || feedTitle || "Unknown Source",
            description: buildArticleDescription(article),
            publisher: feedTitle,
            pubdate: formatArticleDate(article.publishedAt ?? article.fetchedAt) || undefined,
        };
    }, [article, feedTitle]);

    const location = useMemo<DocLocation | null>(() => {
        if (!article) {
            return null;
        }

        return {
            cfi: `rss:${article.id}`,
            percentage: readingProgress,
        };
    }, [article, readingProgress]);

    if (!article) {
        return null;
    }

    return (
        <div
            className={cn(
                "fixed inset-0 z-[var(--z-modal)]",
                isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
            )}
        >
            <div
                className={cn(
                    "absolute inset-0 flex flex-col overflow-hidden",
                    `theme-${theme}`,
                )}
                style={{
                    backgroundColor: "var(--reader-bg)",
                    filter: `brightness(${brightness}%)`,
                    overscrollBehavior: "none",
                }}
                data-reading-mode="scroll"
            >
                <div ref={toolbarContainerRef} className="absolute top-0 left-0 right-0 z-50">
                    <WindowTitlebar
                        metadata={metadata}
                        location={location}
                        onBack={onClose}
                        onPrevPage={() => scrollByViewport(-1)}
                        onNextPage={() => scrollByViewport(1)}
                        onToggleToc={() => togglePanel("toc")}
                        onToggleSettings={() => togglePanel("settings")}
                        onToggleBookmarks={() => togglePanel("bookmarks")}
                        onToggleSearch={() => togglePanel("search")}
                        onToggleInfo={() => togglePanel("info")}
                        onAddBookmark={handleAddScrollBookmark}
                        isCurrentPageBookmarked={Boolean(currentBookmark)}
                        activePanel={activePanel}
                        fullscreen={isFullscreen}
                        onToggleFullscreen={handleToggleFullscreen}
                    />
                </div>

                <Backdrop visible={activePanel !== null} onClick={closePanel} blur />

                <ArticleReaderOutlinePanel
                    visible={activePanel === "toc"}
                    headings={headings}
                    onJumpToHeading={handleJumpToHeading}
                    onClose={closePanel}
                />

                <ArticleReaderSearchPanel
                    visible={activePanel === "search"}
                    contentRef={contentRef}
                    onClose={closePanel}
                />

                <ArticleReaderHighlightsPanel
                    visible={activePanel === "bookmarks"}
                    bookmarks={bookmarks}
                    highlights={highlights}
                    articleUrl={article.url}
                    isFavorite={Boolean(article.isFavorite)}
                    onToggleFavorite={onToggleFavorite}
                    onJumpToBookmark={handleJumpToBookmark}
                    onDeleteBookmark={handleDeleteBookmark}
                    onJumpToHighlight={handleJumpToHighlight}
                    onDeleteHighlight={handleDeleteHighlight}
                    onClose={closePanel}
                />

                <ArticleReaderSettingsPanel
                    visible={activePanel === "settings"}
                    fontSize={fontSize}
                    lineHeight={lineHeight}
                    brightness={brightness}
                    theme={theme}
                    onFontSizeChange={handleFontSizeChange}
                    onLineHeightChange={handleLineHeightChange}
                    onBrightnessChange={handleBrightnessChange}
                    onThemeChange={handleThemeChange}
                    onClose={closePanel}
                />

                <ArticleReaderInfoPanel
                    visible={activePanel === "info"}
                    article={article}
                    feedTitle={feedTitle}
                    onClose={closePanel}
                />

                <div className="flex-1 min-h-0 overflow-hidden" style={{ paddingTop: toolbarHeight }}>
                    <ArticleReaderContent
                        article={article}
                        feedTitle={feedTitle}
                        fontSize={fontSize}
                        lineHeight={lineHeight}
                        contentRef={contentRef}
                        scrollContainerRef={scrollContainerRef}
                        onTextSelect={handleTextSelect}
                        onHeadingsChange={setHeadings}
                    />
                </div>
            </div>

            <ArticleSelectionPopover
                isOpen={selectionPopover.isOpen}
                position={selectionPopover.position}
                selectedText={selectionPopover.text}
                onHighlight={handleHighlight}
                onDefine={handleDefine}
                onCopy={handleCopy}
                onClose={() => {
                    selectedRangeRef.current = null;
                    setSelectionPopover((previous) => ({ ...previous, isOpen: false }));
                    clearBrowserSelection();
                }}
            />

            <DictionaryResultPopover
                isOpen={dictionaryState.isOpen}
                position={dictionaryState.position}
                term={dictionaryState.term}
                result={dictionaryState.result}
                loading={dictionaryState.loading}
                error={dictionaryState.error}
                saved={dictionaryState.saved}
                canSaveToVocabulary={learningSettings.vocabularyEnabled}
                onSave={handleSaveToVocabulary}
                onClose={() => setDictionaryState((previous) => ({ ...previous, isOpen: false }))}
            />
        </div>
    );
}
