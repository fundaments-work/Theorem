/**
 * Foliate Engine - Optimized Version
 * 
 * Key optimizations based on Foliate GTK research:
 * 1. CSS variables for instant visual feedback (no async/debounce needed)
 * 2. Batched engine updates using requestAnimationFrame
 * 3. Synchronous zoom application
 * 4. Minimal re-renders through efficient change detection
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
    ReaderSettings,
} from '@/types';
import { getTheme } from '@/foliate/themes';
import { 
    getEngineSettings, 
    createReaderCSS, 
    registerEngineStyleCallback,
    getCurrentReaderSettings,
    getThemeColors,
} from '@/lib/reader-styles';

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

    // Settings cache
    private layout: PageLayout = 'single';
    private flow: ReadingFlow = 'paged';
    private zoom_level = 1;
    private _marginValue = 10;
    private theme: ReaderTheme = 'light';
    private settings: ThemeSettings = {};
    
    // Batch update mechanism
    private pendingUpdateFrame: number | null = null;
    private pendingSettingsUpdate = false;
    
    // Style update unsubscribe
    private unsubscribeFromStyles: (() => void) | null = null;

    // History tracking
    private _navigationHistory: string[] = [];
    private _currentHistoryIndex = -1;

    constructor(options: FoliateEngineOptions = {}) {
        this.options = options;
    }

    async init(container: HTMLElement): Promise<void> {
        this.container = container;
        
        // Register for style updates from the main app
        this.unsubscribeFromStyles = registerEngineStyleCallback(() => {
            this.handleExternalStyleChange();
        });
    }

    async open(
        source: File | Blob | ArrayBuffer | string,
        _filename: string = 'document.epub',
        initialLocation?: string,
        layout: PageLayout = 'double',
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
                file = new File([source], _filename, { type: source.type || 'application/epub+zip' });
            } else {
                const buffer = typeof source === 'string' ? new TextEncoder().encode(source) : source;
                file = new File([buffer], _filename, { type: 'application/epub+zip' });
            }
            
            this.book = await makeBook(file);

            // Create foliate-view element
            this.view = document.createElement('foliate-view');
            this.view.style.width = '100%';
            this.view.style.height = '100%';
            this.view.style.display = 'block';
            this.container.appendChild(this.view);

            // Set up event listeners
            this.setupEventListeners();

            // Open the book in the view
            await this.view.open(this.book);

            // Get section fractions for progress calculation
            this.sectionFractions = this.view.getSectionFractions();

            // Apply initial settings
            this.layout = layout;
            this.flow = flow;
            this.zoom_level = Math.max(0.2, Math.min(4.0, zoom / 100));
            this._marginValue = margins;

            // Apply settings synchronously where possible
            this.applySettingsSync();
            
            // Apply CSS with current settings to all iframes
            this.applyCSSToAllIframes();
            
            // Async settings application
            await this.applySettingsAsync();

            // Navigate to initial location
            if (initialLocation) {
                await this.view.goTo(initialLocation);
            } else {
                await this.view.goTo({ index: 0, fraction: 0 });
            }

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

        // Load event - apply styles to newly loaded sections
        this.view.addEventListener('load', (e: any) => {
            const detail = e.detail;
            if (detail?.doc?.documentElement) {
                // Apply zoom immediately
                detail.doc.documentElement.style.zoom = String(this.zoom_level);
                
                // Inject CSS with current settings
                this.injectCSSIntoIframe(detail.doc);
            }
        });

        // Relocate event - location changed
        this.view.addEventListener('relocate', (e: any) => {
            const detail = e.detail;
            
            // Validate index before calling getCFI - index can be -1 during initial render
            let cfi = '';
            if (detail.index != null && detail.index >= 0 && this.view?.getCFI) {
                try {
                    cfi = this.view.getCFI(detail.index, detail.range) || '';
                } catch (err) {
                    // Silently ignore getCFI errors during initial render
                    console.debug('[FoliateEngine] getCFI failed, likely during initial render:', err);
                }
            }
            
            const location: DocLocation = {
                cfi,
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

    /**
     * Handle style changes from the main app (when CSS variables are updated)
     */
    private handleExternalStyleChange(): void {
        // Get current settings from the main app
        const currentSettings = getCurrentReaderSettings();
        if (!currentSettings) return;
        
        // Update internal theme reference
        this.theme = currentSettings.theme;
        
        // Apply CSS to all iframes
        this.applyCSSToAllIframes();
        
        // Schedule async settings update for things that need foliate's renderer
        this.scheduleSettingsUpdate();
    }

    /**
     * Apply CSS with current settings to all iframes
     */
    private applyCSSToAllIframes(): void {
        if (!this.view?.renderer) return;
        
        const currentSettings = getCurrentReaderSettings();
        if (!currentSettings) return;
        
        const contents = this.view.renderer.getContents?.() || [];
        for (const content of contents) {
            const doc = content.doc;
            if (doc) {
                this.injectCSSIntoIframe(doc, currentSettings);
            }
        }
    }

    /**
     * Inject CSS with current settings into an iframe document
     */
    private injectCSSIntoIframe(doc: Document, settings?: ReaderSettings | null): void {
        const s = settings || getCurrentReaderSettings();
        if (!s) return;
        
        // Find or create the style element
        let style = doc.getElementById('lion-reader-styles') as HTMLStyleElement;
        if (!style) {
            style = doc.createElement('style');
            style.id = 'lion-reader-styles';
            doc.head?.appendChild(style);
        }
        
        // Update the CSS content with current values
        style.textContent = createReaderCSS(s);
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

    /**
     * Synchronous settings application - for instant feedback
     */
    private applySettingsSync(): void {
        if (!this.view?.renderer) return;

        const renderer = this.view.renderer;
        
        // These can be applied synchronously
        renderer.setAttribute('flow', this.flow === 'scroll' ? 'scrolled' : 'paginated');
        renderer.setAttribute('gap', '5%');
        // Auto layout: use double columns for paged mode on larger screens, single for scroll or small screens
        const columnCount = this.layout === 'single' ? 1 : 
                           this.layout === 'double' ? 2 :
                           this.flow === 'scroll' ? 1 : 2; // auto: 2 columns for paged, 1 for scroll
        renderer.setAttribute('max-column-count', columnCount);
        
        // Apply zoom synchronously to existing contents
        this.applyZoomSync();
    }

    /**
     * Asynchronous settings application - for CSS that needs compilation
     */
    private async applySettingsAsync(): Promise<void> {
        if (!this.view?.renderer) return;

        const currentSettings = getCurrentReaderSettings();
        if (!currentSettings) return;

        // Compute text alignment value for CSS
        const alignValue = currentSettings.textAlign === 'justify' ? 'justify' :
                          currentSettings.textAlign === 'center' ? 'center' : 'left';

        const theme = getTheme(this.theme);
        const { getCSS } = await import('../foliate/reader.js');

        const readerStyle = {
            spacing: currentSettings.lineHeight,
            justify: currentSettings.textAlign === 'justify',
            hyphenate: currentSettings.hyphenation,
            invert: false,
            theme,
            overrideFont: currentSettings.forcePublisherStyles,
        };

        const renderer = this.view.renderer;
        
        if (renderer.setStyles) {
            // Create CSS with current actual values, not CSS variables
            const colors = getThemeColors(this.theme);
            
            // Build font-family CSS only if not using original book font
            const fontFamilyCSS = currentSettings.fontFamily === 'original' ? '' : `
                /* Font family override - applies to ALL elements with !important */
                html, body, 
                p, div, span, 
                h1, h2, h3, h4, h5, h6,
                li, ul, ol,
                blockquote, q,
                td, th, tr, table,
                dd, dt, dl,
                pre, code, samp, kbd,
                em, strong, b, i, u,
                small, sub, sup,
                label, figcaption,
                a, abbr, cite,
                input, textarea, button,
                ::before, ::after {
                    font-family: ${currentSettings.fontFamily === 'serif' ? 'Georgia, "Times New Roman", serif' : currentSettings.fontFamily === 'sans' ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif' : currentSettings.fontFamily === 'mono' ? '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace' : 'inherit'} !important;
                }
                
                /* Override inline styles that specify font-family */
                [style*="font-family"] {
                    font-family: ${currentSettings.fontFamily === 'serif' ? 'Georgia, "Times New Roman", serif' : currentSettings.fontFamily === 'sans' ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif' : currentSettings.fontFamily === 'mono' ? '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace' : 'inherit'} !important;
                }
            `;
            
            // Build text alignment CSS
            const textAlignCSS = `
                /* Text alignment - comprehensive selector coverage */
                body, p, div, 
                h1, h2, h3, h4, h5, h6,
                li, 
                blockquote, q,
                td, th,
                dd, dt,
                figcaption {
                    text-align: ${alignValue} !important;
                }
                
                /* Don't justify headers and captions */
                h1, h2, h3, h4, h5, h6, figcaption {
                    text-align: ${currentSettings.textAlign === 'justify' || currentSettings.textAlign === 'left' ? 'left' : currentSettings.textAlign} !important;
                }
                
                /* Override align attributes */
                [align="left"] { text-align: left !important; }
                [align="right"] { text-align: right !important; }
                [align="center"] { text-align: center !important; }
                [align="justify"] { text-align: justify !important; }
                
                /* Override inline text-align styles */
                [style*="text-align"] {
                    text-align: ${alignValue} !important;
                }
            `;
            
            const customCSS = `
                @namespace epub "http://www.idpf.org/2007/ops";
                
                :root {
                    --reader-bg: ${colors.bg};
                    --reader-fg: ${colors.fg};
                    --reader-link: ${colors.link};
                }
                
                @media screen {
                    html {
                        font-size: ${currentSettings.fontSize}px !important;
                        line-height: ${currentSettings.lineHeight} !important;
                        color: ${colors.fg} !important;
                        background: ${colors.bg} !important;
                        letter-spacing: ${currentSettings.letterSpacing}em !important;
                        word-spacing: ${currentSettings.wordSpacing}em !important;
                    }
                    
                    body {
                        font-size: inherit !important;
                        line-height: inherit !important;
                        color: inherit !important;
                        background: ${colors.bg} !important;
                        letter-spacing: inherit !important;
                        word-spacing: inherit !important;
                    }
                    
                    ${fontFamilyCSS}
                    
                    ${textAlignCSS}
                    
                    a:any-link {
                        color: ${colors.link} !important;
                    }
                    
                    /* Typography elements */
                    p, li, blockquote, dd {
                        line-height: ${currentSettings.lineHeight} !important;
                        hyphens: ${currentSettings.hyphenation ? 'auto' : 'none'} !important;
                    }
                    
                    ::selection {
                        background: color-mix(in srgb, ${colors.fg} 20%, transparent) !important;
                        color: ${colors.fg} !important;
                    }
                }
            `;
            
            const foliateCSS = getCSS(readerStyle);
            renderer.setStyles([customCSS, ...foliateCSS]);
        }
    }

    /**
     * Batched settings update - schedules update for next frame
     */
    private scheduleSettingsUpdate(): void {
        if (this.pendingUpdateFrame) {
            cancelAnimationFrame(this.pendingUpdateFrame);
        }
        
        this.pendingSettingsUpdate = true;
        this.pendingUpdateFrame = requestAnimationFrame(() => {
            this.pendingSettingsUpdate = false;
            this.pendingUpdateFrame = null;
            this.applySettingsSync();
            this.applySettingsAsync().catch(console.error);
        });
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

    async next(distance?: number): Promise<void> {
        if (!this.view?.renderer) return;
        try {
            await this.view.next(distance);
        } catch (e) {
            console.error('[FoliateEngine] next() error:', e);
        }
    }

    async prev(distance?: number): Promise<void> {
        if (!this.view?.renderer) return;
        try {
            await this.view.prev(distance);
        } catch (e) {
            console.error('[FoliateEngine] prev() error:', e);
        }
    }

    /**
     * Scroll up by a specified distance (used in scroll mode)
     * Falls back to prev() in paginated mode
     */
    async scrollUp(distance?: number): Promise<void> {
        if (this.flow === 'scroll') {
            // In scroll mode, use foliate-js's scroll methods if available
            const scrollDistance = distance ?? this.getScrollDistance();
            await this.view?.prev?.(scrollDistance);
        } else {
            // In paginated mode, go to previous page
            await this.prev();
        }
    }

    /**
     * Scroll down by a specified distance (used in scroll mode)
     * Falls back to next() in paginated mode
     */
    async scrollDown(distance?: number): Promise<void> {
        if (this.flow === 'scroll') {
            // In scroll mode, use foliate-js's scroll methods if available
            const scrollDistance = distance ?? this.getScrollDistance();
            await this.view?.next?.(scrollDistance);
        } else {
            // In paginated mode, go to next page
            await this.next();
        }
    }

    /**
     * Calculate default scroll distance based on font size and line height
     * Similar to Foliate GTK4's implementation
     */
    private getScrollDistance(): number {
        // Get current settings from the store
        const currentSettings = getCurrentReaderSettings();
        if (!currentSettings) return 48; // Default fallback
        
        // Scroll distance = fontSize * lineHeight * 3 lines
        return currentSettings.fontSize * currentSettings.lineHeight * 3;
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

    // Settings methods - optimized for speed
    setLayout(layout: PageLayout): void {
        if (this.layout === layout) return;
        this.layout = layout;
        this.scheduleSettingsUpdate();
    }

    setFlow(flow: ReadingFlow): void {
        if (this.flow === flow) return;
        this.flow = flow;
        this.scheduleSettingsUpdate();
    }

    // Zoom methods - synchronous for instant feedback
    zoomIn(): void {
        this.setZoomLevel(Math.min(4.0, this.zoom_level + 0.1));
    }

    zoomOut(): void {
        this.setZoomLevel(Math.max(0.2, this.zoom_level - 0.1));
    }

    zoomRestore(): void {
        this.setZoomLevel(1.0);
    }

    setZoomLevel(level: number): void {
        const newLevel = Math.max(0.2, Math.min(4.0, level));
        if (this.zoom_level === newLevel) return;
        
        this.zoom_level = newLevel;
        this.applyZoomSync();
    }

    setZoom(zoom: number): void {
        this.setZoomLevel(zoom / 100);
    }

    getZoomLevel(): number {
        return this.zoom_level;
    }

    /**
     * Synchronous zoom application - instant visual feedback
     */
    private applyZoomSync(): void {
        if (!this.view?.renderer) return;

        const contents = this.view.renderer.getContents?.() || [];
        for (const content of contents) {
            const doc = content.doc;
            if (doc?.documentElement) {
                doc.documentElement.style.zoom = String(this.zoom_level);
            }
        }
    }

    setMargins(margins: number): void {
        this._marginValue = margins;
    }

    /**
     * Apply theme/settings - optimized with batching
     */
    applyTheme(settings: ThemeSettings): void {
        const currentSettings = getCurrentReaderSettings();
        const hadChanges = 
            currentSettings?.fontSize !== settings.fontSize ||
            currentSettings?.lineHeight !== settings.lineHeight ||
            currentSettings?.textAlign !== settings.textAlign ||
            currentSettings?.hyphenation !== settings.hyphenation ||
            currentSettings?.forcePublisherStyles !== settings.forcePublisherStyles;
        
        this.settings = settings;
        
        if (settings.flow) this.flow = settings.flow;
        if (settings.layout) this.layout = settings.layout;
        if (settings.zoom) this.zoom_level = settings.zoom / 100;
        
        if (hadChanges) {
            this.scheduleSettingsUpdate();
        }
        
        // Apply zoom immediately if changed
        if (settings.zoom) {
            this.applyZoomSync();
        }
        
        // Apply CSS to all iframes with new settings
        this.applyCSSToAllIframes();
    }

    setTheme(theme: ReaderTheme): void {
        if (this.theme === theme) return;
        this.theme = theme;
        this.scheduleSettingsUpdate();
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

        const sections = this.book.sections || [];
        const totalSections = sections.length;

        for (let i = 0; i < totalSections; i++) {
            const section = sections[i];
            try {
                const doc = await section.createDocument?.();
                if (doc) {
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
        // Cancel pending updates
        if (this.pendingUpdateFrame) {
            cancelAnimationFrame(this.pendingUpdateFrame);
            this.pendingUpdateFrame = null;
        }
        
        // Unsubscribe from style updates
        if (this.unsubscribeFromStyles) {
            this.unsubscribeFromStyles();
            this.unsubscribeFromStyles = null;
        }
        
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
