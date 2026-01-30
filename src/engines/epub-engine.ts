/**
 * Document Engine Wrapper for foliate-js
 * Optimized for Tauri desktop with smooth performance
 */

import type {
    DocLocation,
    TocItem,
    DocMetadata,
    SearchResult,
    ThemeSettings,
    HighlightColor,
    Annotation as AnnotationType
} from '@/types';
import { HIGHLIGHT_COLORS } from '@/types';

// Re-export types for backwards compatibility
export type { DocLocation, TocItem, DocMetadata, SearchResult, ThemeSettings, HighlightColor };
export { HIGHLIGHT_COLORS };

export interface Annotation extends AnnotationType { }

// Debounce utility
const debounce = <T extends (...args: any[]) => void>(fn: T, ms: number) => {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
};

/**
 * Performance-optimized Document Engine
 */
export class DocumentEngine {
    private view: any = null;
    private container: HTMLElement | null = null;
    private book: any = null;
    private annotations: Map<string, Annotation> = new Map();
    private lastSettings: ThemeSettings | null = null;
    private isInitialized = false;
    private initPromise: Promise<void> | null = null;

    // Caching
    private metadataCache: Map<string, DocMetadata> = new Map();
    private locationCache: Map<string, string> = new Map();
    private sectionCache: Map<number, any> = new Map();
    private currentBookId: string | null = null;
    private debouncedApplyTheme: ((settings: ThemeSettings) => void) | null = null;

    // Resize handler
    private resizeObserver: ResizeObserver | null = null;
    private debouncedRender: (() => void) | null = null;

    // Event handlers (stored for cleanup)
    private relocateHandler: ((e: any) => void) | null = null;
    private loadHandler: ((e: any) => void) | null = null;
    private externalLinkHandler: ((e: any) => void) | null = null;
    private textSelectionHandlers: Map<Document, () => void> = new Map();

    // Event callbacks
    public onLocationChange?: (location: DocLocation) => void;
    public onReady?: (metadata: DocMetadata, toc: TocItem[]) => void;
    public onError?: (error: Error) => void;
    public onLoad?: (doc: Document, index: number) => void;
    public onTextSelected?: (cfi: string, text: string, range: Range) => void;

    constructor() {
        this.debouncedRender = debounce(() => {
            if (this.view?.renderer) {
                this.view.renderer.render?.();
            }
        }, 100);

        // Initialize debounced theme application to prevent excessive re-renders
        this.debouncedApplyTheme = debounce((settings: ThemeSettings) => {
            this.doApplyTheme(settings);
        }, 50);
    }

    /**
     * Initialize the engine with a container element
     */
    async init(container: HTMLElement): Promise<void> {
        if (this.isInitialized) {
            console.log('[DocumentEngine] Already initialized');
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.doInit(container);
        return this.initPromise;
    }

    private async doInit(container: HTMLElement): Promise<void> {
        console.log('[DocumentEngine] Initializing...');
        this.container = container;

        try {
            // Import foliate-js view component
            // @ts-ignore - foliate-js is plain JS
            await import('../lib/foliate-js/view.js');

            // Create the foliate-view element
            const view = document.createElement('foliate-view');
            this.view = view;
            view.setAttribute('autohide-cursor', '');
            view.setAttribute('animated', '');

            // Set up event listeners
            this.setupEventListeners();

            // Set up resize observer
            this.setupResizeObserver();

            // Append to container
            container.appendChild(view);

            this.isInitialized = true;
            console.log('[DocumentEngine] Initialized successfully');
        } catch (error) {
            console.error('[DocumentEngine] Initialization failed:', error);
            this.onError?.(error as Error);
            throw error;
        } finally {
            this.initPromise = null;
        }
    }

    private setupEventListeners() {
        if (!this.view) return;

        let lastLocationTime = 0;

        // Store handlers for cleanup
        this.relocateHandler = (e: any) => {
            const now = performance.now();
            if (now - lastLocationTime < 50) return;
            lastLocationTime = now;

            const detail = e.detail;
            if (this.onLocationChange) {
                this.onLocationChange({
                    cfi: detail.cfi || '',
                    percentage: detail.fraction ?? 0,
                    tocItem: detail.tocItem,
                    pageItem: detail.pageItem,
                });
            }
        };

        this.loadHandler = (e: any) => {
            const { doc, index } = e.detail;
            this.setupTextSelection(doc, index);
            this.onLoad?.(doc, index);
        };

        this.externalLinkHandler = (e: any) => {
            e.preventDefault();
        };

        this.view.addEventListener('relocate', this.relocateHandler);
        this.view.addEventListener('load', this.loadHandler);
        this.view.addEventListener('external-link', this.externalLinkHandler);
    }

    private cleanupEventListeners() {
        if (!this.view) return;

        if (this.relocateHandler) {
            this.view.removeEventListener('relocate', this.relocateHandler);
            this.relocateHandler = null;
        }
        if (this.loadHandler) {
            this.view.removeEventListener('load', this.loadHandler);
            this.loadHandler = null;
        }
        if (this.externalLinkHandler) {
            this.view.removeEventListener('external-link', this.externalLinkHandler);
            this.externalLinkHandler = null;
        }

        // Clean up text selection handlers
        this.textSelectionHandlers.forEach((handler, doc) => {
            doc.removeEventListener('mouseup', handler);
        });
        this.textSelectionHandlers.clear();
    }

    private setupResizeObserver() {
        if (!this.container || !window.ResizeObserver) return;

        let lastWidth = this.container.clientWidth;
        let lastHeight = this.container.clientHeight;

        this.resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;

            const { width, height } = entry.contentRect;

            // Only re-render if dimensions actually changed significantly
            if (Math.abs(width - lastWidth) > 10 || Math.abs(height - lastHeight) > 10) {
                lastWidth = width;
                lastHeight = height;
                this.debouncedRender?.();
            }
        });

        this.resizeObserver.observe(this.container);
    }

    /**
     * Open a document
     */
    async open(
        source: File | Blob | ArrayBuffer,
        filename: string = 'document.epub',
        initialLocation?: string,
        bookId?: string
    ): Promise<void> {
        console.log('[DocumentEngine] Opening book:', filename);

        if (!this.isInitialized || !this.view) {
            throw new Error('Engine not initialized. Call init() first.');
        }

        try {
            // Convert ArrayBuffer to File if needed
            let file: File | Blob;
            if (source instanceof ArrayBuffer) {
                file = new File([source], filename, {
                    type: this.getMimeType(filename)
                });
            } else {
                file = source;
            }

            // Close any previous book
            this.closeBook();

            // Set current book ID for caching
            this.currentBookId = bookId || filename;

            // Apply theme to container early for consistent loading experience
            if (this.lastSettings && this.container) {
                this.applyThemeToContainer(this.lastSettings);
            }

            // Check for cached location
            const cachedLocation = bookId ? this.locationCache.get(bookId) : undefined;
            const finalLocation = initialLocation || cachedLocation;

            // Reduced delay for faster book opening - still allows DOM cleanup but much quicker
            await new Promise(resolve => setTimeout(resolve, 50));

            // Ensure container has proper dimensions before opening
            if (this.container) {
                const rect = this.container.getBoundingClientRect();
                console.log('[DocumentEngine] Container dimensions:', rect.width, 'x', rect.height);
                if (rect.width === 0 || rect.height === 0) {
                    console.warn('[DocumentEngine] Container has zero dimensions, waiting...');
                    // Wait for container to be properly sized
                    await new Promise<void>((resolve, reject) => {
                        let attempts = 0;
                        const maxAttempts = 100; // 5 seconds max (100 * 50ms)

                        const checkDimensions = () => {
                            // Check if container still exists
                            if (!this.container) {
                                console.warn('[DocumentEngine] Container became null while waiting for dimensions');
                                reject(new Error('Container was destroyed while waiting for dimensions'));
                                return;
                            }

                            const r = this.container.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) {
                                console.log('[DocumentEngine] Container now has dimensions:', r.width, 'x', r.height);
                                resolve();
                            } else if (attempts >= maxAttempts) {
                                console.error('[DocumentEngine] Timeout waiting for container dimensions');
                                reject(new Error('Timeout waiting for container to have non-zero dimensions'));
                            } else {
                                attempts++;
                                setTimeout(checkDimensions, 50);
                            }
                        };
                        setTimeout(checkDimensions, 50);
                    });
                }
            }

            // Open the book
            console.log('[DocumentEngine] Calling view.open()...');
            await this.view.open(file);
            this.book = this.view.book;
            console.log('[DocumentEngine] Book opened, getting metadata...');

            // Get metadata
            const metadata = await this.getMetadata();
            const toc = this.getTableOfContents();

            // Initialize display
            console.log('[DocumentEngine] Initializing display...');
            await this.view.init({
                lastLocation: finalLocation,
                showTextStart: !finalLocation,
            });

            // Apply cached settings
            if (this.lastSettings) {
                this.applyTheme(this.lastSettings);
            }

            console.log('[DocumentEngine] Book ready');
            this.onReady?.(metadata, toc);
        } catch (error) {
            console.error('[DocumentEngine] Failed to open book:', error);
            this.onError?.(error as Error);
            throw error;
        }
    }

    private closeBook() {
        // Cache current location before closing
        if (this.currentBookId && this.view?.lastLocation?.cfi) {
            this.locationCache.set(this.currentBookId, this.view.lastLocation.cfi);
        }

        if (this.view?.close) {
            try {
                this.view.close();
            } catch (e) {
                console.error('Error closing previous book:', e);
            }
        }
        this.book = null;
        this.annotations.clear();
        this.lastSettings = null;
        this.sectionCache.clear();
        this.currentBookId = null;
    }

    private getMimeType(filename: string): string {
        const ext = filename.toLowerCase().split('.').pop();
        switch (ext) {
            case 'epub': return 'application/epub+zip';
            case 'pdf': return 'application/pdf';
            case 'mobi':
            case 'azw':
            case 'azw3': return 'application/x-mobipocket-ebook';
            case 'fb2': return 'application/x-fictionbook+xml';
            case 'cbz': return 'application/vnd.comicbook+zip';
            default: return 'application/octet-stream';
        }
    }

    /**
     * Prefetch sections for smoother navigation
     */
    async prefetchSections(currentIndex: number, distance: number = 1): Promise<void> {
        if (!this.book?.sections || !this.view) return;

        const sections = this.book.sections;
        const indicesToPrefetch: number[] = [];

        // Prefetch ahead
        for (let i = 1; i <= distance; i++) {
            const index = currentIndex + i;
            if (index < sections.length && sections[index]?.linear !== 'no') {
                indicesToPrefetch.push(index);
            }
        }

        // Prefetch behind
        for (let i = 1; i <= distance; i++) {
            const index = currentIndex - i;
            if (index >= 0 && sections[index]?.linear !== 'no') {
                indicesToPrefetch.push(index);
            }
        }

        // Load sections in background with low priority
        for (const index of indicesToPrefetch) {
            if (!this.sectionCache.has(index)) {
                try {
                    const section = sections[index];
                    if (section?.load) {
                        // Use requestIdleCallback if available, otherwise setTimeout
                        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                            window.requestIdleCallback(() => {
                                section.load().then((src: any) => {
                                    this.sectionCache.set(index, src);
                                }).catch(() => {
                                    // Silently fail prefetch errors
                                });
                            }, { timeout: 2000 });
                        } else {
                            setTimeout(() => {
                                section.load().then((src: any) => {
                                    this.sectionCache.set(index, src);
                                }).catch(() => {
                                    // Silently fail prefetch errors
                                });
                            }, 100);
                        }
                    }
                } catch {
                    // Silently fail prefetch errors
                }
            }
        }
    }

    // Navigation methods
    async goTo(target: string | number): Promise<void> {
        if (!this.view?.goTo) return;

        // Prefetch nearby sections after navigation
        const result = await this.view.goTo(target);

        // Get current index for prefetching
        if (typeof target === 'number') {
            this.prefetchSections(target, 1);
        }

        return result;
    }

    async goToFraction(fraction: number): Promise<void> {
        if (!this.view?.goToFraction) return;
        await this.view.goToFraction(fraction);
    }

    async next(): Promise<void> {
        if (!this.view?.next) return;
        await this.view.next();
    }

    async prev(): Promise<void> {
        if (!this.view?.prev) return;
        await this.view.prev();
    }

    async goLeft(): Promise<void> {
        if (!this.view?.goLeft) return;
        await this.view.goLeft();
    }

    async goRight(): Promise<void> {
        if (!this.view?.goRight) return;
        await this.view.goRight();
    }

    goBack(): void {
        this.view?.history?.back();
    }

    goForward(): void {
        this.view?.history?.forward();
    }

    canGoBack(): boolean {
        return this.view?.history?.canGoBack ?? false;
    }

    canGoForward(): boolean {
        return this.view?.history?.canGoForward ?? false;
    }

    /**
     * Get book metadata with caching
     */
    async getMetadata(): Promise<DocMetadata> {
        if (!this.book) {
            throw new Error('Book not loaded');
        }

        // Check cache first
        if (this.currentBookId && this.metadataCache.has(this.currentBookId)) {
            console.log('[DocumentEngine] Using cached metadata');
            return this.metadataCache.get(this.currentBookId)!;
        }

        const meta = this.book.metadata || {};

        let author = 'Unknown Author';
        if (meta.author) {
            if (typeof meta.author === 'string') {
                author = meta.author;
            } else if (Array.isArray(meta.author)) {
                author = meta.author.map((a: any) =>
                    typeof a === 'string' ? a : a.name || ''
                ).join(', ');
            } else if (meta.author.name) {
                author = meta.author.name;
            }
        }

        let title = 'Unknown Title';
        if (meta.title) {
            title = typeof meta.title === 'string'
                ? meta.title
                : Object.values(meta.title)[0] as string || 'Unknown Title';
        }

        let cover: string | undefined;
        try {
            if (this.book.getCover) {
                const coverBlob = await this.book.getCover();
                if (coverBlob) {
                    cover = URL.createObjectURL(coverBlob);
                }
            }
        } catch {
            // Cover not available
        }

        const metadata: DocMetadata = {
            title,
            author,
            description: meta.description,
            publisher: meta.publisher,
            language: meta.language,
            pubdate: meta.pubdate || meta.published,
            identifier: meta.identifier,
            cover,
        };

        // Cache metadata for this book
        if (this.currentBookId) {
            this.metadataCache.set(this.currentBookId, metadata);
        }

        return metadata;
    }

    /**
     * Get table of contents
     */
    getTableOfContents(): TocItem[] {
        if (!this.book) return [];

        const mapTocItem = (item: any): TocItem => ({
            label: item.label?.trim() || '',
            href: item.href || '',
            subitems: item.subitems?.map(mapTocItem),
        });

        return (this.book.toc || []).map(mapTocItem);
    }

    /**
     * Get current location
     */
    getCurrentLocation(): DocLocation | null {
        if (!this.view) return null;

        const loc = this.view.lastLocation;
        if (!loc) return null;

        return {
            cfi: loc.cfi || '',
            percentage: loc.fraction ?? 0,
            tocItem: loc.tocItem,
            pageItem: loc.pageItem,
        };
    }

    /**
     * Get section fractions for progress bar
     */
    getSectionFractions(): number[] {
        return this.view?.getSectionFractions?.() || [];
    }

    /**
     * Apply theme/styling settings (debounced wrapper)
     */
    applyTheme(settings: ThemeSettings): void {
        this.lastSettings = settings;
        this.debouncedApplyTheme?.(settings);
    }

    /**
     * Internal method to actually apply theme settings
     */
    private doApplyTheme(settings: ThemeSettings): void {
        // Always apply to container first for loading state
        this.applyThemeToContainer(settings);

        // Only apply to view if book is loaded
        if (!this.view || !this.book) return;

        const style = this.view.style;
        const bg = settings.backgroundColor || '#ffffff';
        const fg = settings.textColor || '#1a1a1a';

        style.setProperty('--reader-bg', bg);
        style.setProperty('--reader-text', fg);
        style.setProperty('--bg', bg);
        style.setProperty('--fg', fg);

        if (settings.fontSize) {
            style.setProperty('--reader-font-size', `${settings.fontSize}px`);
        }
        if (settings.lineHeight) {
            style.setProperty('--reader-line-height', settings.lineHeight.toString());
        }
        if (settings.margins !== undefined) {
            style.setProperty('--reader-margin-x', `${settings.margins}%`);
        }

        const fontMap: Record<string, string> = {
            'original': 'inherit',
            'serif': 'Georgia, "New York", serif',
            'sans': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            'mono': '"SF Mono", Menlo, Monaco, monospace',
        };

        const fontFamily = settings.fontFamily
            ? fontMap[settings.fontFamily] || 'inherit'
            : 'inherit';
        style.setProperty('--reader-font-family', fontFamily);

        const isDark = this.isColorDark(bg);
        this.view.setAttribute('theme', isDark ? 'dark' : 'light');
        style.colorScheme = isDark ? 'dark' : 'light';

        if (settings.flow) {
            const flowMap = { paged: 'paginated', scroll: 'scrolled', auto: 'auto' };
            this.view.setAttribute('flow', flowMap[settings.flow] as any);
        }

        if (settings.layout) {
            this.view.setAttribute(
                'max-column-count',
                settings.layout === 'single' ? '1' : '2'
            );
        }

        // Apply user stylesheet
        const userStyle = `
            :root, html, body {
                background-color: ${bg} !important;
                color: ${fg} !important;
                color-scheme: ${isDark ? 'dark' : 'light'} !important;
                font-family: ${fontFamily} !important;
                font-size: ${settings.fontSize ? `${settings.fontSize}px` : 'inherit'} !important;
                line-height: ${settings.lineHeight || 'inherit'} !important;
            }
            p, div, span, section, article {
                color: inherit !important;
                background-color: transparent !important;
            }
            a {
                color: ${isDark ? '#8ab4f8' : '#0066cc'} !important;
            }
            img, svg {
                max-width: 100%;
                height: auto;
                ${isDark ? 'filter: brightness(0.9) contrast(1.1);' : ''}
            }
        `;

        this.view.setStyles?.(userStyle);
    }

    private isColorDark(color: string): boolean {
        if (!color) return false;

        if (color.startsWith('#')) {
            let hex = color.slice(1);
            if (hex.length === 3) {
                hex = hex.split('').map(c => c + c).join('');
            }
            if (hex.length === 6) {
                const r = parseInt(hex.slice(0, 2), 16);
                const g = parseInt(hex.slice(2, 4), 16);
                const b = parseInt(hex.slice(4, 6), 16);
                const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                return luminance < 0.5;
            }
        }

        if (color.startsWith('rgb')) {
            const matches = color.match(/\d+/g);
            if (matches && matches.length >= 3) {
                const r = parseInt(matches[0]);
                const g = parseInt(matches[1]);
                const b = parseInt(matches[2]);
                const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
                return luminance < 0.5;
            }
        }

        return false;
    }

    /**
     * Apply theme colors to container element for loading state
     * This is called early, before the book content is ready
     */
    private applyThemeToContainer(settings: ThemeSettings): void {
        if (!this.container) return;

        const bg = settings.backgroundColor || '#ffffff';
        const fg = settings.textColor || '#1a1a1a';

        this.container.style.backgroundColor = bg;
        this.container.style.color = fg;

        // Also set CSS custom properties for any themed child elements
        this.container.style.setProperty('--reader-bg', bg);
        this.container.style.setProperty('--reader-text', fg);
    }

    /**
     * Set up text selection handling
     */
    private setupTextSelection(doc: Document, index: number): void {
        // Skip if already set up for this document
        if (this.textSelectionHandlers.has(doc)) return;

        let selectionTimeout: ReturnType<typeof setTimeout>;

        const handler = () => {
            clearTimeout(selectionTimeout);
            selectionTimeout = setTimeout(() => {
                const selection = doc.getSelection();
                if (selection && selection.rangeCount > 0) {
                    const range = selection.getRangeAt(0);
                    const text = selection.toString().trim();
                    if (text && text.length > 0) {
                        const cfi = this.view?.getCFI?.(index, range) || '';
                        this.onTextSelected?.(cfi, text, range);
                    }
                }
            }, 50);
        };

        doc.addEventListener('mouseup', handler);
        this.textSelectionHandlers.set(doc, handler);
    }

    /**
     * Search within the book
     */
    async *search(query: string): AsyncGenerator<SearchResult | { progress: number } | 'done'> {
        if (!this.view?.search) return;

        const iter = this.view.search({ query });

        for await (const result of iter) {
            if (result === 'done') {
                yield 'done';
            } else if (result.progress !== undefined) {
                yield { progress: result.progress };
            } else if (result.subitems) {
                for (const item of result.subitems) {
                    yield { cfi: item.cfi, excerpt: item.excerpt };
                }
            }
        }
    }

    clearSearch(): void {
        this.view?.clearSearch?.();
    }

    /**
     * Add a highlight annotation
     */
    async addHighlight(cfi: string, text: string, color: HighlightColor): Promise<Annotation> {
        const annotation: Annotation = {
            id: crypto.randomUUID(),
            bookId: '',
            type: 'highlight',
            location: cfi,
            selectedText: text,
            color,
            createdAt: new Date(),
        };

        this.annotations.set(annotation.id, annotation);

        if (this.view?.addAnnotation) {
            await this.view.addAnnotation({
                value: cfi,
                color: HIGHLIGHT_COLORS[color],
            });
        }

        return annotation;
    }

    /**
     * Remove a highlight annotation
     */
    async removeHighlight(id: string): Promise<void> {
        const annotation = this.annotations.get(id);
        if (!annotation) return;

        this.annotations.delete(id);

        if (this.view?.deleteAnnotation) {
            await this.view.deleteAnnotation({ value: annotation.location });
        }
    }

    getAnnotations(): Annotation[] {
        return Array.from(this.annotations.values());
    }

    /**
     * Check if the book is fixed layout
     */
    isFixedLayout(): boolean {
        return this.view?.isFixedLayout ?? false;
    }

    /**
     * Destroy the engine and clean up resources
     */
    destroy(): void {
        console.log('[DocumentEngine] Destroying...');

        // Clean up event listeners first
        this.cleanupEventListeners();

        // Disconnect resize observer
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;

        // Clear debounced functions
        this.debouncedRender = null;
        this.debouncedApplyTheme = null;

        this.closeBook();

        if (this.view) {
            if (this.view.destroy) {
                try {
                    this.view.destroy();
                } catch (e) {
                    console.error('Error destroying view:', e);
                }
            }
            this.view.remove?.();
            this.view = null;
        }

        // Clear all caches
        this.metadataCache.clear();
        this.locationCache.clear();
        this.sectionCache.clear();
        this.currentBookId = null;

        // Clear all callbacks
        this.onLocationChange = undefined;
        this.onReady = undefined;
        this.onError = undefined;
        this.onLoad = undefined;
        this.onTextSelected = undefined;

        this.container = null;
        this.isInitialized = false;
        this.initPromise = null;
        console.log('[DocumentEngine] Destroyed');
    }

    /**
     * Get the raw foliate-view element
     */
    getView(): any {
        return this.view;
    }

    /**
     * Check if engine is ready
     */
    getIsInitialized(): boolean {
        return this.isInitialized;
    }
}

export default DocumentEngine;
