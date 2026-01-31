/**
 * Foliate Engine
 * Main engine for rendering EPUBs using foliate-js
 * Replaces epubjs-engine.ts completely
 */

import type {
    DocLocation,
    DocMetadata,
    TocItem,
    HighlightColor,
    Annotation,
    SearchResult,
    ReadingFlow,
    PageLayout,
    ThemeSettings,
    ReaderTheme,
} from '@/types';
import { getTheme } from '@/foliate/themes';

export interface FoliateEngineOptions {
    onLocationChange?: (location: DocLocation) => void;
    onReady?: (metadata: DocMetadata, toc: TocItem[]) => void;
    onError?: (error: Error) => void;
    onTextSelected?: (cfi: string, text: string, range: Range) => void;
}

export class FoliateEngine {
    private container: HTMLElement | null = null;
    private view: any = null;
    private book: any = null;
    private options: FoliateEngineOptions = {};
    private annotations: Map<string, Annotation> = new Map();
    private currentLocation: DocLocation | null = null;
    private sectionFractions: number[] = [];

    // Settings - matching Foliate GTK implementation
    private layout: PageLayout = 'single';
    private flow: ReadingFlow = 'paged';
    private zoom_level = 1; // Foliate GTK: 0.2 to 4.0, default 1.0, step 0.1
    private _marginValue = 10;
    private theme: ReaderTheme = 'light';
    private settings: ThemeSettings = {};

    // History tracking for navigation
    private _navigationHistory: string[] = [];
    private _currentHistoryIndex = -1;

    constructor(options: FoliateEngineOptions = {}) {
        this.options = options;
    }

    async init(container: HTMLElement): Promise<void> {
        this.container = container;
    }

    async open(
        source: File | Blob | ArrayBuffer | string,
        _filename: string = 'document.epub',
        initialLocation?: string,
        layout: PageLayout = 'single',
        _savedLocations?: string,
        flow: ReadingFlow = 'paged',
        zoom: number = 100,
        margins: number = 10
    ): Promise<void> {
        if (!this.container) {
            throw new Error('Engine not initialized');
        }

        try {
            // Dynamically import foliate-js
            const { makeBook } = await import('../foliate-js/view.js');

            // Open book - ensure we pass a File object with name for foliate-js
            let file: File | Blob;
            if (source instanceof File) {
                file = source;
            } else if (source instanceof Blob) {
                // Convert Blob to File with proper name
                file = new File([source], _filename, { type: source.type || 'application/epub+zip' });
            } else {
                // ArrayBuffer or string
                const buffer = typeof source === 'string' ? new TextEncoder().encode(source) : source;
                file = new File([buffer], _filename, { type: 'application/epub+zip' });
            }
            
            // Create the book first
            this.book = await makeBook(file);

            // Create foliate-view element
            this.view = document.createElement('foliate-view');
            // Ensure foliate-view fills container
            this.view.style.width = '100%';
            this.view.style.height = '100%';
            this.view.style.display = 'block';
            this.container.appendChild(this.view);
            console.log('[FoliateEngine] Created foliate-view element');

            // Set up event listeners on the view
            this.setupEventListeners();

            // Open the book in the view - this creates the renderer
            console.log('[FoliateEngine] Opening book in view...');
            await this.view.open(this.book);
            console.log('[FoliateEngine] Book opened, renderer:', this.view.renderer);

            // Get section fractions for progress calculation
            this.sectionFractions = this.view.getSectionFractions();
            console.log('[FoliateEngine] Section fractions:', this.sectionFractions.length);

            // Apply initial settings
            this.layout = layout;
            this.flow = flow;
            // Convert percentage zoom (100) to Foliate GTK zoom_level (1.0)
            this.zoom_level = Math.max(0.2, Math.min(4.0, zoom / 100));
            this._marginValue = margins;

            await this.applySettings();

            // Navigate to initial location or start of book
            console.log('[FoliateEngine] Navigating to location...');
            if (initialLocation) {
                await this.view.goTo(initialLocation);
            } else {
                // Go to start of book
                await this.view.goTo({ index: 0, fraction: 0 });
            }
            console.log('[FoliateEngine] Navigation complete');

            // Extract metadata and TOC
            const metadata = this.extractMetadata();
            const toc = this.extractToc();

            this.options.onReady?.(metadata, toc);

        } catch (error) {
            this.options.onError?.(error as Error);
            throw error;
        }
    }

    private setupEventListeners(): void {
        if (!this.view) return;

        // Load event - apply zoom to newly loaded sections
        this.view.addEventListener('load', (e: any) => {
            // Apply current zoom level to newly loaded content
            const detail = e.detail;
            if (detail?.doc?.documentElement) {
                detail.doc.documentElement.style.zoom = String(this.zoom_level);
            }
        });

        // Relocate event - location changed
        this.view.addEventListener('relocate', (e: any) => {
            const detail = e.detail;
            const location: DocLocation = {
                cfi: this.view?.getCFI?.(detail.index, detail.range) || '',
                percentage: detail.fraction || 0,
                tocItem: detail.tocItem,
                pageItem: detail.pageItem,
                pageInfo: detail.location ? {
                    currentPage: detail.location.current + 1,
                    endPage: detail.location.next + 1,
                    totalPages: detail.location.total,
                } : undefined,
            };

            this.currentLocation = location;
            this.options.onLocationChange?.(location);
        });

        // Handle history changes
        this.view.history?.addEventListener('popstate', (e: any) => {
            this._navigationHistory = this.view?.history?.items || [];
            this._currentHistoryIndex = this.view?.history?.index || -1;
        });
    }

    private extractMetadata(): DocMetadata {
        if (!this.book) {
            return { title: '', author: '' };
        }

        const meta = this.book.metadata || {};
        return {
            title: this.formatLanguageMap(meta.title) || 'Unknown Title',
            author: this.formatLanguageMap(meta.author) || 'Unknown Author',
            description: meta.description,
            publisher: meta.publisher,
            language: meta.language,
            pubdate: meta.published,
            identifier: meta.identifier,
        };
    }

    private extractToc(): TocItem[] {
        if (!this.book?.toc) {
            return [];
        }

        const convertToc = (items: any[]): TocItem[] => {
            return items.map(item => ({
                label: item.label || '',
                href: item.href || '',
                subitems: item.subitems ? convertToc(item.subitems) : undefined,
            }));
        };

        return convertToc(this.book.toc);
    }

    private formatLanguageMap(x: any): string {
        if (!x) return '';
        if (typeof x === 'string') return x;
        const keys = Object.keys(x);
        return x[keys[0]] || '';
    }

    private async applySettings(): Promise<void> {
        if (!this.view?.renderer) return;

        const theme = getTheme(this.theme);
        const { getCSS } = await import('../foliate/reader.js');

        const readerStyle = {
            spacing: this.settings.lineHeight || 1.4,
            justify: this.settings.textAlign === 'justify',
            hyphenate: this.settings.hyphenation || false,
            invert: false,
            theme,
            overrideFont: this.settings.forcePublisherStyles || false,
        };

        const layoutSettings = {
            flow: this.flow === 'scroll' ? 'scrolled' : 'paginated',
            animated: false,
            gap: 0.05,
            maxInlineSize: this.settings.fontSize ? this.settings.fontSize * 40 : 720,
            maxBlockSize: 800,
            maxColumnCount: this.layout === 'double' ? 2 : 1,
        };

        // Apply to view
        const renderer = this.view.renderer;
        renderer.setAttribute('flow', layoutSettings.flow);
        renderer.setAttribute('gap', (layoutSettings.gap * 100) + '%');
        renderer.setAttribute('max-inline-size', layoutSettings.maxInlineSize + 'px');
        renderer.setAttribute('max-block-size', layoutSettings.maxBlockSize + 'px');
        renderer.setAttribute('max-column-count', layoutSettings.maxColumnCount);

        if (layoutSettings.animated) {
            renderer.setAttribute('animated', '');
        } else {
            renderer.removeAttribute('animated');
        }

        if (renderer.setStyles) {
            renderer.setStyles(getCSS(readerStyle));
        }
    }

    // Navigation methods
    async goTo(target: string | number): Promise<void> {
        if (!this.view) return;
        await this.view.goTo(target);
    }

    async goToFraction(fraction: number): Promise<void> {
        if (!this.view) return;
        const index = this.findSectionIndex(fraction);
        const sectionFraction = this.calculateSectionFraction(fraction, index);
        await this.view.goTo({ index, fraction: sectionFraction });
    }

    async next(): Promise<void> {
        if (!this.view?.renderer) {
            console.warn('[FoliateEngine] next() called but renderer not ready');
            return;
        }
        try {
            await this.view.next();
        } catch (e) {
            console.error('[FoliateEngine] next() error:', e);
        }
    }

    async prev(): Promise<void> {
        if (!this.view?.renderer) {
            console.warn('[FoliateEngine] prev() called but renderer not ready');
            return;
        }
        try {
            await this.view.prev();
        } catch (e) {
            console.error('[FoliateEngine] prev() error:', e);
        }
    }

    async goLeft(): Promise<void> {
        if (!this.view?.renderer) return;
        await this.view.goLeft();
    }

    async goRight(): Promise<void> {
        if (!this.view?.renderer) return;
        await this.view.goRight();
    }

    goBack(): void {
        this.view?.history?.back();
    }

    goForward(): void {
        this.view?.history?.forward();
    }

    canGoBack(): boolean {
        return this.view?.history?.canGoBack || false;
    }

    canGoForward(): boolean {
        return this.view?.history?.canGoForward || false;
    }

    // Settings methods
    async setLayout(layout: PageLayout): Promise<void> {
        this.layout = layout;
        await this.applySettings();
    }

    async setFlow(flow: ReadingFlow): Promise<void> {
        this.flow = flow;
        await this.applySettings();
    }

    // Zoom methods - matching Foliate GTK exactly
    zoomIn(): void {
        const newZoom = Math.min(4.0, this.zoom_level + 0.1);
        this.setZoomLevel(newZoom);
    }

    zoomOut(): void {
        const newZoom = Math.max(0.2, this.zoom_level - 0.1);
        this.setZoomLevel(newZoom);
    }

    zoomRestore(): void {
        this.setZoomLevel(1.0);
    }

    setZoomLevel(level: number): void {
        // Clamp to Foliate GTK range: 0.2 to 4.0
        this.zoom_level = Math.max(0.2, Math.min(4.0, level));
        this.applyZoom();
    }

    // Legacy method for compatibility - converts percentage to zoom_level
    setZoom(zoom: number): void {
        this.setZoomLevel(zoom / 100);
    }

    getZoomLevel(): number {
        return this.zoom_level;
    }

    private applyZoom(): void {
        // Apply zoom to the view's iframe contents
        // This matches how Foliate GTK's webView.zoom_level works
        if (!this.view?.renderer) return;

        // Get all iframe documents from the renderer
        const contents = this.view.renderer.getContents?.() || [];
        for (const content of contents) {
            const doc = content.doc;
            if (doc && doc.documentElement) {
                // Apply CSS zoom to match WebKit's zoom_level behavior
                doc.documentElement.style.zoom = String(this.zoom_level);
            }
        }

        // Also apply to any future iframes by storing the zoom level
        // The view will apply it when new sections load
    }

    setMargins(margins: number): void {
        this._marginValue = margins;
        // Apply margins to container
    }

    async applyTheme(settings: ThemeSettings): Promise<void> {
        this.settings = settings;
        if (settings.flow) this.flow = settings.flow;
        if (settings.layout) this.layout = settings.layout;
        await this.applySettings();
    }

    async setTheme(theme: ReaderTheme): Promise<void> {
        this.theme = theme;
        await this.applySettings();
    }

    // Annotation methods
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

        // Add to view
        this.view?.addAnnotation?.({
            value: cfi,
            color: color,
        });

        return annotation;
    }

    async removeHighlight(id: string): Promise<void> {
        this.annotations.delete(id);
        this.view?.removeAnnotation?.(id);
    }

    getAnnotations(): Annotation[] {
        return Array.from(this.annotations.values());
    }

    // Search
    async *search(query: string): AsyncGenerator<SearchResult | { progress: number } | 'done'> {
        if (!this.book) return;

        // Search through sections
        const sections = this.book.sections || [];
        const totalSections = sections.length;

        for (let i = 0; i < totalSections; i++) {
            const section = sections[i];
            try {
                const doc = await section.createDocument?.();
                if (doc) {
                    // Simple text search
                    const textContent = doc.body?.textContent || '';
                    const index = textContent.toLowerCase().indexOf(query.toLowerCase());
                    if (index !== -1) {
                        yield {
                            cfi: `section-${i}`,
                            excerpt: textContent.substring(index, index + 100),
                        };
                    }
                }
            } catch (e) {
                console.warn('Search error in section', i, e);
            }

            yield { progress: (i + 1) / totalSections };
        }

        yield 'done';
    }

    clearSearch(): void {
        this.view?.clearSearch?.();
    }

    // Utility methods
    getCurrentLocation(): DocLocation | null {
        return this.currentLocation;
    }

    getSectionFractions(): number[] {
        return this.sectionFractions;
    }

    private findSectionIndex(fraction: number): number {
        for (let i = 0; i < this.sectionFractions.length; i++) {
            if (this.sectionFractions[i] > fraction) {
                return Math.max(0, i - 1);
            }
        }
        return this.sectionFractions.length - 1;
    }

    private calculateSectionFraction(totalFraction: number, sectionIndex: number): number {
        const sectionStart = sectionIndex > 0 ? this.sectionFractions[sectionIndex - 1] : 0;
        const sectionEnd = this.sectionFractions[sectionIndex] || 1;
        const sectionSize = sectionEnd - sectionStart;
        
        if (sectionSize === 0) return 0;
        return (totalFraction - sectionStart) / sectionSize;
    }

    destroy(): void {
        if (this.view) {
            this.view.close?.();
            this.view.remove?.();
            this.view = null;
        }
        this.book = null;
        this.container = null;
    }
}

export default FoliateEngine;
