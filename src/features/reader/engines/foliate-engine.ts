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
    BookFormat,
} from '../../../core';
import { isFixedLayout, isReflowable } from '../../../core';
import { getTheme } from '../foliate/themes';
import { 
    registerEngineStyleCallback,
    getCurrentReaderSettings,
    getThemeColors,
} from '../../../core';
import { HIGHLIGHT_SOLID_COLORS } from "../../../core";
import { rankByFuzzyQuery } from "../../../core";
import { normalizeAuthor } from '../../../core';

const READER_SEARCH_EXACT_LIMIT = 120;
const READER_SEARCH_FALLBACK_TRIGGER_THRESHOLD = 3;
const READER_SEARCH_FALLBACK_LIMIT = 12;
const READER_SEARCH_FALLBACK_MAX_SECTIONS = 300;
const READER_SEARCH_FALLBACK_SECTION_CHAR_LIMIT = 8000;
const READER_SEARCH_EXCERPT_CONTEXT_CHARS = 80;
const MIN_READER_ZOOM_LEVEL = 0.2;
const MIN_PAGED_READER_ZOOM_LEVEL = 1.0;
const MAX_READER_ZOOM_LEVEL = 4.0;
const READER_ZOOM_STEP = 0.1;

interface ReaderSearchExcerpt {
    pre?: string;
    match?: string;
    post?: string;
}

interface ReaderSearchSectionCacheItem {
    cfi: string;
    text: string;
}

export interface FoliateEngineOptions {
    onLocationChange?: (location: DocLocation) => void;
    onReady?: (metadata: DocMetadata, toc: TocItem[]) => void;
    onError?: (error: Error) => void;
    onTextSelected?: (cfi: string, text: string, rangeOrEvent: Range | MouseEvent) => void;
    onViewportTap?: () => void;
}

export class FoliateEngine {
    private container: HTMLElement | null = null;
    private view: any = null;
    private book: any = null;
    private options: FoliateEngineOptions = {};
    private annotations: Map<string, Annotation> = new Map();
    private currentLocation: DocLocation | null = null;
    private sectionFractions: number[] = [];

    // Format tracking for format-specific behavior
    private format: BookFormat = 'epub';
    private isFixedLayoutFormat = false;

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

    // CFI cache to avoid re-parsing
    private cfiCache = new Map<string, string>();
    private cfiCacheMaxSize = 100;
    private searchSectionCache: ReaderSearchSectionCacheItem[] | null = null;
    private searchCacheBookRef: unknown = null;

    constructor(options: FoliateEngineOptions = {}) {
        this.options = options;
    }

    private getMinZoomLevelForFlow(flow: ReadingFlow = this.flow): number {
        return flow === 'scroll' ? MIN_READER_ZOOM_LEVEL : MIN_PAGED_READER_ZOOM_LEVEL;
    }

    private clampZoomLevel(level: number, flow: ReadingFlow = this.flow): number {
        return Math.max(
            this.getMinZoomLevelForFlow(flow),
            Math.min(MAX_READER_ZOOM_LEVEL, level),
        );
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
        margins: number = 10,
        format: BookFormat = 'epub'
    ): Promise<void> {
        // Store format for format-specific behavior
        this.format = format;
        this.isFixedLayoutFormat = isFixedLayout(format);
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
            this.searchSectionCache = null;
            this.searchCacheBookRef = this.book;

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
            // Add delay to ensure view is fully ready
            await new Promise(resolve => setTimeout(resolve, 100));
            
            this.sectionFractions = this.view.getSectionFractions() || [];
            
            console.debug('[FoliateEngine] Section fractions:', {
                count: this.sectionFractions.length,
                fractions: this.sectionFractions.slice(0, 3), // Show first 3 fractions
            });
            
            if (this.sectionFractions.length === 0) {
                console.warn('[FoliateEngine] No section fractions found, using fallback');
                // Fallback: assume single section
                this.sectionFractions = [0, 1];
            }

            // Apply initial settings
            this.layout = layout;
            this.flow = flow;
            this.zoom_level = this.clampZoomLevel(zoom / 100, this.flow);
            this._marginValue = margins;

            // Apply settings synchronously where possible
            this.applySettingsSync();
            
            // Async settings application
            await this.applySettingsAsync();

            // Extract metadata and TOC
            const metadata = this.extractMetadata();
            const toc = this.extractToc();

            // Navigate to initial location or beginning
            console.debug('[FoliateEngine] Initial navigation:', {
                hasInitialLocation: !!initialLocation,
                initialLocation: initialLocation?.substring(0, 50),
            });
            
            if (initialLocation) {
                console.debug('[FoliateEngine] Navigating to initial CFI location:', initialLocation.substring(0, 50));
                try {
                    const result = await this.view.goTo(initialLocation);
                    console.debug('[FoliateEngine] goTo result:', result ? 'success' : 'undefined/null');
                    if (!result) {
                        console.warn('[FoliateEngine] Initial CFI navigation returned undefined, CFI may be invalid');
                        // Fall back to beginning if CFI is invalid
                        await this.view.goTo({ index: 0, fraction: 0 });
                    } else {
                        console.debug('[FoliateEngine] Successfully navigated to initial location');
                    }
            } catch (err) {
                console.warn('<FoliateEngine> Initial CFI navigation failed:', err);
                // Fall back to beginning if CFI navigation throws
                await this.view.goTo({ index: 0, fraction: 0 });
                // Clear invalid CFI by navigating to beginning
                if (this.options.onLocationChange) {
                    this.options.onLocationChange({ cfi: '', percentage: 0, tocItem: undefined, pageItem: undefined, pageInfo: undefined });
                }
            }
            } else {
                console.debug('[FoliateEngine] No initial location, starting at beginning');
                await this.view.goTo({ index: 0, fraction: 0 });
            }

            console.debug('[FoliateEngine] Signaling book ready');
            // Signal that book is ready
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
            }
        });

        // Relocate event - location changed
        // The view.js already calculates and provides CFI in the event detail
        // See foliate-js view.js #onRelocate: this.lastLocation = { ...progress, tocItem, pageItem, cfi, range }
        this.view.addEventListener('relocate', (e: any) => {
            const detail = e.detail;
            
            // Use CFI directly from event detail (already calculated by view.js)
            // The view.js getCFI is called in #onRelocate and included in lastLocation
            let cfi = detail.cfi || '';
            
            // Fallback: if CFI is empty but we have section info, try to regenerate
            // detail.section.current contains the section index (from progress.js getProgress)
            if (!cfi && detail.section?.current != null && detail.section.current >= 0 && this.view?.getCFI) {
                try {
                    cfi = this.view.getCFI(detail.section.current, detail.range) || '';
                    if (!cfi) {
                        console.debug('[FoliateEngine] getCFI returned empty, using section fallback');
                        cfi = `section-${detail.section.current}`;
                    }
                } catch (err) {
                    console.debug('[FoliateEngine] getCFI fallback failed:', err);
                    cfi = `section-${detail.section.current}`;
                }
            }
            
            const pageInfo = detail.location ? {
                currentPage: detail.location.current + 1,
                endPage: detail.location.next + 1,
                totalPages: detail.location.total,
                range:
                    detail.location.current !== detail.location.next
                        ? `${detail.location.current + 1}-${detail.location.next + 1}`
                        : `${detail.location.current + 1}`,
                isEstimated: true,
            } : undefined;

            // Clamp fraction to valid range [0, 1].
            // Prefer foliate's global fraction, but derive a robust fallback when it is missing.
            const rawFraction = detail.fraction;
            let fraction = typeof rawFraction === 'number' && isFinite(rawFraction)
                ? Math.max(0, Math.min(1, rawFraction))
                : NaN;
            if (!isFinite(fraction)) {
                if (pageInfo && pageInfo.totalPages > 1) {
                    fraction = Math.max(
                        0,
                        Math.min(1, (pageInfo.currentPage - 1) / (pageInfo.totalPages - 1)),
                    );
                } else if (
                    typeof detail.section?.current === 'number'
                    && detail.section.current >= 0
                    && this.sectionFractions.length > detail.section.current + 1
                ) {
                    const start = this.sectionFractions[detail.section.current];
                    const end = this.sectionFractions[detail.section.current + 1];
                    if (isFinite(start) && isFinite(end)) {
                        fraction = Math.max(0, Math.min(1, (start + end) / 2));
                    }
                }
            }
            if (!isFinite(fraction)) {
                fraction = this.currentLocation?.percentage ?? 0;
            }
            
            console.debug('[FoliateEngine] Relocate event:', {
                section: detail.section?.current,
                rawFraction,
                fraction,
                cfi: cfi?.substring(0, 50),
            });
            
            const location: DocLocation = {
                cfi,
                percentage: fraction,
                tocItem: detail.tocItem,
                pageItem: detail.pageItem,
                pageInfo,
            };

            this.currentLocation = location;
            this.options.onLocationChange?.(location);
        });

        // Handle history changes
        this.view.history?.addEventListener('popstate', (e: any) => {
            this._navigationHistory = this.view?.history?.items || [];
            this._currentHistoryIndex = this.view?.history?.index || -1;
        });

        // Handle section load - re-attach selection listeners for new sections
        this.view.addEventListener('load', (e: any) => {
            const detail = e.detail;
            console.debug('[FoliateEngine] Section loaded:', detail?.index);
            
            // Clear the attached listeners set for new sections
            if (detail?.doc) {
                this.iframeListenersAttached.delete(detail.doc);
            }
            
            // Re-setup selection listeners and re-render highlights after a short delay
            setTimeout(() => {
                console.debug('[FoliateEngine] Section load timeout fired, onTextSelected:', !!this.options.onTextSelected);
                if (this.options.onTextSelected) {
                    console.debug('[FoliateEngine] Re-attaching selection listeners after section load for section', detail?.index);
                    this.setupIframeSelectionListener(this.options.onTextSelected);
                } else {
                    console.warn('[FoliateEngine] onTextSelected callback not set!');
                }
                
                // Re-render all annotations for this section
                console.debug('[FoliateEngine] Re-rendering annotations for section', detail?.index, 'total annotations:', this.annotations.size);
                this.renderAnnotationsForSection(detail?.index);
            }, 500);
        });

        // Handle annotation drawing
        this.view.addEventListener('draw-annotation', (e: any) => {
            const { draw, annotation, doc, range } = e.detail;
            console.debug('[FoliateEngine] draw-annotation event:', { color: annotation?.color, hasDraw: !!draw, hasDoc: !!doc, hasRange: !!range });
            
            if (!draw || !annotation) {
                console.warn('[FoliateEngine] draw-annotation missing draw or annotation');
                return;
            }

            // Get the color for the highlight
            const color = this.getHighlightColor(annotation.color || 'yellow');
            console.debug('[FoliateEngine] Drawing highlight with color:', color);
            
            // Draw the highlight using the overlayer
            try {
                // Store annotation value for click handler
                const annotationValue = annotation.value;
                
                draw((rects: DOMRectList) => {
                    console.debug('[FoliateEngine] Drawing', rects.length, 'rects');
                    const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
                    g.setAttribute('fill', color);
                    g.style.opacity = '0.4';
                    g.style.mixBlendMode = 'multiply';
                    // Enable pointer events so the highlight is clickable
                    g.style.pointerEvents = 'all';
                    g.style.cursor = 'pointer';
                    
                    for (const rect of rects) {
                        const el = doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        el.setAttribute('x', String(rect.left));
                        el.setAttribute('y', String(rect.top));
                        el.setAttribute('width', String(rect.width));
                        el.setAttribute('height', String(rect.height));
                        el.setAttribute('rx', '2');
                        g.appendChild(el);
                    }
                    
                    // Add click handler directly to the highlight group
                    // This ensures clicks on highlights are properly detected
                    g.addEventListener('click', (e: Event) => {
                        const mouseEvent = e as MouseEvent;
                        console.debug('[FoliateEngine] Highlight clicked:', annotationValue);
                        e.stopPropagation();
                        e.preventDefault();
                        
                        // Find the annotation
                        const clickedAnnotation = Array.from(this.annotations.values())
                            .find(a => a.location === annotationValue);
                        
                        if (clickedAnnotation && this.options.onTextSelected) {
                            // Get bounding rect for positioning
                            const firstRect = rects[0];
                            const syntheticEvent = new MouseEvent('click', {
                                clientX: firstRect ? firstRect.left + firstRect.width / 2 : mouseEvent.clientX,
                                clientY: firstRect ? firstRect.top : mouseEvent.clientY,
                                bubbles: true
                            });
                            
                            console.debug('[FoliateEngine] Triggering onTextSelected for clicked highlight:', clickedAnnotation.id);
                            this.options.onTextSelected(clickedAnnotation.location, clickedAnnotation.selectedText || '', syntheticEvent);
                        }
                    });
                    
                    console.debug('[FoliateEngine] Created SVG group with', g.childElementCount, 'rects');
                    return g;
                }, annotation);
                console.debug('[FoliateEngine] draw() completed successfully');
            } catch (err) {
                console.error('[FoliateEngine] Error in draw-annotation:', err);
            }
        });

        // Handle annotation click
        this.view.addEventListener('show-annotation', (e: any) => {
            const { value, index, range } = e.detail;
            console.debug('[FoliateEngine] show-annotation event:', { value: value?.substring(0, 50), index, hasRange: !!range });
            
            // Find the annotation by CFI
            let annotation = Array.from(this.annotations.values())
                .find(a => a.location === value);
            
            // Fallback: find by partial CFI match (in case of slight variations)
            if (!annotation && value) {
                annotation = Array.from(this.annotations.values())
                    .find(a => a.location && value.startsWith(a.location));
            }
            
            if (annotation) {
                console.debug('[FoliateEngine] Found annotation for click:', annotation.id, annotation.type);
                // Create synthetic event for positioning
                const rect = range?.getBoundingClientRect();
                console.debug('[FoliateEngine] Annotation click rect:', rect);
                const syntheticEvent = new MouseEvent('click', {
                    clientX: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
                    clientY: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
                    bubbles: true
                });
                
                // Call the callback with annotation data
                if (this.options.onTextSelected) {
                    this.options.onTextSelected(annotation.location, annotation.selectedText || '', syntheticEvent);
                }
            } else {
                console.warn('[FoliateEngine] No annotation found for CFI:', value?.substring(0, 50));
                console.debug('[FoliateEngine] Available annotations:', Array.from(this.annotations.values()).map(a => ({ id: a.id, loc: a.location?.substring(0, 50) })));
            }
        });
    }

    private getHighlightColor(colorName: string): string {
        const colorMap: Record<string, string> = HIGHLIGHT_SOLID_COLORS;
        return colorMap[colorName] || colorMap.yellow;
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
        
        // Schedule async settings update for things that need foliate's renderer
        this.scheduleSettingsUpdate();
    }

    private extractMetadata(): DocMetadata {
        if (!this.book) {
            return { title: '', author: '' };
        }

        const meta = this.book.metadata || {};
        return {
            title: this.formatLanguageMap(meta.title) || 'Unknown Title',
            // Author can be string, {name, sortAs, role}, or array - normalize it
            author: normalizeAuthor(meta.author) || 'Unknown Author',
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
        const currentSettings = getCurrentReaderSettings();
        
        // These can be applied synchronously
        renderer.setAttribute('flow', this.flow === 'scroll' ? 'scrolled' : 'paginated');
        renderer.setAttribute('gap', '5%');
        renderer.setAttribute(
            'max-inline-size',
            `${currentSettings?.fontSize ? Math.max(480, currentSettings.fontSize * 40) : 720}px`,
        );
        renderer.setAttribute('max-block-size', '800px');
        // Auto layout: use double columns for paged mode on larger screens, single for scroll or small screens
        const columnCount = this.layout === 'single' ? 1 : 
                           this.layout === 'double' ? 2 :
                           this.flow === 'scroll' ? 1 : 2; // auto: 2 columns for paged, 1 for scroll
        renderer.setAttribute('max-column-count', columnCount);
        if (currentSettings?.enableAnimations) {
            renderer.setAttribute('animated', '');
        } else {
            renderer.removeAttribute('animated');
        }
        
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
            lineHeight: currentSettings.lineHeight,
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
            if (Array.isArray(foliateCSS)) {
                const [beforeStyle = '', style = ''] = foliateCSS;
                renderer.setStyles([beforeStyle, `${style}\n${customCSS}`]);
            } else {
                renderer.setStyles(`${foliateCSS}\n${customCSS}`);
            }
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
        
        // Clamp fraction to valid range
        const clampedFraction = Math.max(0, Math.min(1, fraction));
        
        console.debug('[FoliateEngine] goToFraction:', { fraction: clampedFraction });
        
        // Use foliate-js's built-in goToFraction which correctly calculates
        // section index and anchor fraction internally using its sectionProgress
        await this.view.goToFraction(clampedFraction);
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
        const clampedZoom = this.clampZoomLevel(this.zoom_level);
        if (clampedZoom !== this.zoom_level) {
            this.zoom_level = clampedZoom;
            this.applyZoomSync();
        }
        this.scheduleSettingsUpdate();
    }

    // Zoom methods - synchronous for instant feedback
    zoomIn(): void {
        this.setZoomLevel(this.zoom_level + READER_ZOOM_STEP);
    }

    zoomOut(): void {
        this.setZoomLevel(this.zoom_level - READER_ZOOM_STEP);
    }

    zoomRestore(): void {
        this.setZoomLevel(1.0);
    }

    setZoomLevel(level: number): void {
        const newLevel = this.clampZoomLevel(level);
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
        this.settings = settings;
        
        if (settings.flow) {
            this.flow = settings.flow;
            this.zoom_level = this.clampZoomLevel(this.zoom_level, this.flow);
        }
        if (settings.layout) this.layout = settings.layout;
        if (settings.zoom) this.zoom_level = this.clampZoomLevel(settings.zoom / 100);

        this.scheduleSettingsUpdate();
        
        // Apply zoom immediately if changed
        if (settings.zoom) {
            this.applyZoomSync();
        }
    }

    setTheme(theme: ReaderTheme): void {
        if (this.theme === theme) return;
        this.theme = theme;
        this.scheduleSettingsUpdate();
    }

    // Annotation methods
    async addHighlight(cfi: string, text: string, color: HighlightColor, bookId?: string): Promise<Annotation> {
        console.debug('[FoliateEngine] addHighlight called:', { cfi: cfi.substring(0, 30), text: text.substring(0, 30), color });
        
        const annotation: Annotation = {
            id: crypto.randomUUID(),
            bookId: bookId || '',
            type: 'highlight',
            location: cfi,
            selectedText: text,
            color,
            createdAt: new Date(),
        };

        this.annotations.set(annotation.id, annotation);
        console.debug('[FoliateEngine] Annotation stored, total annotations:', this.annotations.size);
        
        // Add to view for rendering
        try {
            console.debug('[FoliateEngine] Calling view.addAnnotation with cfi:', cfi.substring(0, 30));
            await this.view?.addAnnotation?.({
                value: cfi,
                color: color,
            });
            console.debug('[FoliateEngine] view.addAnnotation completed');
        } catch (e) {
            console.warn('[FoliateEngine] Failed to add annotation to view:', e);
        }

        return annotation;
    }

    async addAnnotation(annotation: Annotation): Promise<void> {
        this.annotations.set(annotation.id, annotation);
        
        // Render highlights for both 'highlight' and 'note' types
        // Notes should still show the highlighted text with a note indicator
        if ((annotation.type === 'highlight' || annotation.type === 'note') && annotation.location) {
            try {
                await this.view?.addAnnotation?.({
                    value: annotation.location,
                    color: annotation.color,
                });
            } catch (e) {
                console.warn('[FoliateEngine] Failed to add annotation to view:', e);
            }
        }
    }

    async removeHighlight(id: string): Promise<void> {
        console.debug('[FoliateEngine] removeHighlight called with id:', id);
        const annotation = this.annotations.get(id);
        if (!annotation) {
            console.warn('[FoliateEngine] Annotation not found for id:', id);
            return;
        }
        
        console.debug('[FoliateEngine] Found annotation to delete:', {
            id: annotation.id,
            type: annotation.type,
            location: annotation.location?.substring(0, 50),
        });
        
        // Delete from internal map first
        this.annotations.delete(id);
        console.debug('[FoliateEngine] Deleted from annotations map, remaining:', this.annotations.size);
        
        // Remove from foliate view
        try {
            if (this.view?.deleteAnnotation) {
                console.debug('[FoliateEngine] Calling view.deleteAnnotation with location:', annotation.location?.substring(0, 50));
                await this.view.deleteAnnotation({ value: annotation.location });
                console.debug('[FoliateEngine] Successfully called view.deleteAnnotation');
            } else {
                console.warn('<FoliateEngine> Initial CFI navigation returned undefined, CFI may be invalid');
                // Fall back to beginning if CFI is invalid
                await this.view.goTo({ index: 0, fraction: 0 });
                // Clear invalid CFI by navigating to beginning
                if (this.options.onLocationChange) {
                    this.options.onLocationChange({ cfi: '', percentage: 0, tocItem: undefined, pageItem: undefined, pageInfo: undefined });
                }
            }
        } catch (e) {
            console.error('[FoliateEngine] Failed to remove annotation from view:', e);
        }
    }

    async removeAnnotation(id: string): Promise<void> {
        await this.removeHighlight(id);
    }

    getAnnotations(): Annotation[] {
        return Array.from(this.annotations.values());
    }

    getAnnotationsByBookId(bookId: string): Annotation[] {
        return Array.from(this.annotations.values()).filter(a => a.bookId === bookId);
    }

    /**
     * Re-render all annotations for a specific section
     * Called when a section reloads (e.g., when navigating back to a previous page)
     */
    async renderAnnotationsForSection(sectionIndex: number): Promise<void> {
        if (!this.view || !this.book) {
            console.warn('[FoliateEngine] Cannot render annotations - view not ready');
            return;
        }

        console.debug('[FoliateEngine] Rendering annotations for section', sectionIndex);
        
        // Get all annotations and filter by section
        const allAnnotations = Array.from(this.annotations.values());
        console.debug('[FoliateEngine] Total annotations to check:', allAnnotations.length);
        
        // We need to determine which annotations belong to this section
        // Since we don't have an easy way to check, we'll try to render all
        // and let foliate-js handle the ones that don't match
        for (const annotation of allAnnotations) {
            // Render highlights for both 'highlight' and 'note' types
            if ((annotation.type === 'highlight' || annotation.type === 'note') && annotation.location) {
                try {
                    console.debug('[FoliateEngine] Re-rendering annotation for section', sectionIndex, ':', annotation.location.substring(0, 30));
                    await this.view?.addAnnotation?.({
                        value: annotation.location,
                        color: annotation.color,
                    });
                } catch (e) {
                    // Silently ignore errors for annotations that don't belong to this section
                    console.debug('[FoliateEngine] Annotation not in section', sectionIndex, ':', e);
                }
            }
        }
        
        console.debug('[FoliateEngine] Finished rendering annotations for section', sectionIndex);
    }

    /**
     * Load and render all annotations for a book
     */
    async loadAnnotations(annotations: Annotation[]): Promise<void> {
        // Wait for view to be ready
        if (!this.view || !this.book) {
            console.warn('[FoliateEngine] Cannot load annotations - view not ready');
            return;
        }

        // Clear existing
        for (const annotation of this.annotations.values()) {
            try {
                await this.view?.deleteAnnotation?.({ value: annotation.location });
            } catch (e) {
                // Ignore errors for non-existent annotations
            }
        }
        this.annotations.clear();

        // Add new annotations with delay between each to avoid overwhelming the renderer
        for (const annotation of annotations) {
            this.annotations.set(annotation.id, annotation);
            
            // Render highlights for both 'highlight' and 'note' types
            // Notes should still show the highlighted text
            if (annotation.location && (annotation.type === 'highlight' || annotation.type === 'note')) {
                try {
                    await this.view?.addAnnotation?.({
                        value: annotation.location,
                        color: annotation.color,
                    });
                    // Small delay to allow renderer to process
                    await new Promise(resolve => setTimeout(resolve, 10));
                } catch (e) {
                    console.warn('[FoliateEngine] Failed to load annotation:', annotation.id, e);
                }
            }
        }
    }

    /**
     * Go to an annotation's location
     */
    async goToAnnotation(annotation: Annotation): Promise<void> {
        if (annotation.location) {
            await this.goTo(annotation.location);
        }
    }

    // Search
    async *search(query: string): AsyncGenerator<SearchResult | { progress: number } | 'done'> {
        if (!this.book || !this.view) return;

        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
            yield 'done';
            return;
        }

        let exactMatchCount = 0;
        const yieldedCFIs = new Set<string>();

        try {
            const searchIterator = this.view.search({
                query: normalizedQuery,
                matchCase: false,
                matchDiacritics: false,
                matchWholeWords: false,
            });

            for await (const result of searchIterator) {
                if (result === 'done') {
                    break;
                }

                if (
                    result
                    && typeof result === 'object'
                    && 'progress' in result
                    && typeof result.progress === 'number'
                ) {
                    yield { progress: result.progress };
                    continue;
                }

                if (!result || typeof result !== 'object') {
                    continue;
                }

                if ('cfi' in result && typeof result.cfi === 'string' && result.cfi) {
                    if (!yieldedCFIs.has(result.cfi)) {
                        yieldedCFIs.add(result.cfi);
                        yield {
                            cfi: result.cfi,
                            excerpt: this.normalizeSearchExcerpt((result as { excerpt?: unknown }).excerpt),
                        };
                        exactMatchCount++;
                    }
                }

                if ('subitems' in result && Array.isArray(result.subitems)) {
                    for (const subitem of result.subitems) {
                        if (!subitem || typeof subitem !== 'object') {
                            continue;
                        }
                        if (!('cfi' in subitem) || typeof subitem.cfi !== 'string' || !subitem.cfi) {
                            continue;
                        }

                        if (yieldedCFIs.has(subitem.cfi)) {
                            continue;
                        }

                        yieldedCFIs.add(subitem.cfi);
                        yield {
                            cfi: subitem.cfi,
                            excerpt: this.normalizeSearchExcerpt(
                                (subitem as { excerpt?: unknown }).excerpt,
                            ),
                        };
                        exactMatchCount++;

                        if (exactMatchCount >= READER_SEARCH_EXACT_LIMIT) {
                            break;
                        }
                    }
                }

                if (exactMatchCount >= READER_SEARCH_EXACT_LIMIT) {
                    break;
                }
            }
        } catch (error) {
            console.warn('[FoliateEngine] Exact search failed:', error);
        }

        if (exactMatchCount === 0) {
            const sectionNumber = Number(normalizedQuery);
            const sections = this.book.sections || [];
            const targetSectionIndex = sectionNumber - 1;
            if (Number.isInteger(sectionNumber) && targetSectionIndex >= 0 && targetSectionIndex < sections.length) {
                const cfi = this.view.getCFI?.(targetSectionIndex) || `section-${targetSectionIndex}`;
                if (cfi && !yieldedCFIs.has(cfi)) {
                    yieldedCFIs.add(cfi);
                    const fallbackText = this.createSectionFallbackSearchText(
                        sections[targetSectionIndex],
                        targetSectionIndex,
                    );
                    yield {
                        cfi,
                        excerpt: fallbackText || `Page ${sectionNumber}`,
                    };
                    exactMatchCount++;
                }
            }
        }

        if (exactMatchCount < READER_SEARCH_FALLBACK_TRIGGER_THRESHOLD) {
            const sectionCache = await this.getSearchSectionCache();
            const fallbackResults = rankByFuzzyQuery(sectionCache, normalizedQuery, {
                keys: [{ name: 'text', weight: 1 }],
                limit: READER_SEARCH_FALLBACK_LIMIT,
            });

            for (const { item } of fallbackResults) {
                if (yieldedCFIs.has(item.cfi)) {
                    continue;
                }

                yieldedCFIs.add(item.cfi);
                yield {
                    cfi: item.cfi,
                    excerpt: this.createSearchExcerpt(item.text, normalizedQuery),
                };
            }
        }

        yield 'done';
    }

    private normalizeSearchExcerpt(excerpt: unknown): string {
        if (typeof excerpt === 'string') {
            return excerpt;
        }

        if (excerpt && typeof excerpt === 'object') {
            const parsedExcerpt = excerpt as ReaderSearchExcerpt;
            const pre = parsedExcerpt.pre || '';
            const match = parsedExcerpt.match || '';
            const post = parsedExcerpt.post || '';
            const normalized = `${pre}${match}${post}`.trim();
            if (normalized) {
                return normalized;
            }
        }

        return '';
    }

    private createSearchExcerpt(sectionText: string, query: string): string {
        const normalizedText = sectionText.replace(/\s+/g, ' ').trim();
        if (!normalizedText) {
            return '';
        }

        const queryIndex = normalizedText.toLowerCase().indexOf(query.toLowerCase());
        if (queryIndex === -1) {
            return normalizedText.slice(0, READER_SEARCH_EXCERPT_CONTEXT_CHARS * 2);
        }

        const excerptStart = Math.max(0, queryIndex - READER_SEARCH_EXCERPT_CONTEXT_CHARS);
        const excerptEnd = Math.min(
            normalizedText.length,
            queryIndex + query.length + READER_SEARCH_EXCERPT_CONTEXT_CHARS,
        );
        const needsLeadingEllipsis = excerptStart > 0;
        const needsTrailingEllipsis = excerptEnd < normalizedText.length;

        return `${needsLeadingEllipsis ? '…' : ''}${normalizedText.slice(excerptStart, excerptEnd)}${needsTrailingEllipsis ? '…' : ''}`;
    }

    private async getSearchSectionCache(): Promise<ReaderSearchSectionCacheItem[]> {
        if (!this.book || !this.view) {
            return [];
        }

        if (this.searchSectionCache && this.searchCacheBookRef === this.book) {
            return this.searchSectionCache;
        }

        const sections = this.book.sections || [];
        const sectionCache: ReaderSearchSectionCacheItem[] = [];
        const sectionsToCache = Math.min(sections.length, READER_SEARCH_FALLBACK_MAX_SECTIONS);

        for (let i = 0; i < sectionsToCache; i++) {
            const section = sections[i];
            try {
                const sectionDocument = await section.createDocument?.();
                const rawText = sectionDocument?.body?.textContent || '';
                const normalizedText = rawText.replace(/\s+/g, ' ').trim();
                const cfi = this.view.getCFI?.(i) || `section-${i}`;
                if (!cfi) {
                    continue;
                }

                const sectionSearchText = normalizedText
                    ? normalizedText.slice(0, READER_SEARCH_FALLBACK_SECTION_CHAR_LIMIT)
                    : this.createSectionFallbackSearchText(section, i);
                if (!sectionSearchText) {
                    continue;
                }

                sectionCache.push({
                    cfi,
                    text: sectionSearchText,
                });
            } catch (error) {
                console.warn('[FoliateEngine] Failed to cache section text for search:', i, error);
            }
        }

        this.searchSectionCache = sectionCache;
        this.searchCacheBookRef = this.book;
        return sectionCache;
    }

    private createSectionFallbackSearchText(section: any, sectionIndex: number): string {
        const sectionPositionLabel = this.isFixedLayoutFormat
            ? `Page ${sectionIndex + 1}`
            : `Section ${sectionIndex + 1}`;
        const candidates = [
            this.normalizeSectionSearchLabel(section?.id),
            this.normalizeSectionSearchLabel(section?.href),
            this.normalizeSectionSearchLabel(section?.name),
            this.normalizeSectionSearchLabel(section?.label),
            this.normalizeSectionSearchLabel(section?.filename),
        ];
        const parts = new Set<string>([sectionPositionLabel]);
        for (const candidate of candidates) {
            if (candidate) {
                parts.add(candidate);
            }
        }
        return Array.from(parts).join(' | ');
    }

    private normalizeSectionSearchLabel(value: unknown): string {
        if (typeof value !== 'string') {
            return '';
        }
        return value
            .replace(/^.*[\\/]/, '')
            .replace(/[#?].*$/, '')
            .replace(/\.[a-z0-9]{1,5}$/i, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
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

    /**
     * Get CFI from a range in the current document
     */
    getCFIFromRange(index: number, range: Range): string {
        if (!this.view?.getCFI) return '';
        try {
            return this.view.getCFI(index, range);
        } catch (e) {
            console.warn('[FoliateEngine] Failed to get CFI from range:', e);
            return '';
        }
    }

    /**
     * Get the currently selected text and its CFI from the active document
     */
    getSelectionFromDocument(): { text: string; cfi: string; range: Range } | null {
        // Guard against accessing view during transitions
        if (!this.view || !this.book) {
            return null;
        }

        try {
            const contents = this.view.renderer?.getContents?.() || [];
            
            for (const content of contents) {
                // Check if content is valid
                if (!content || typeof content.index !== 'number') continue;
                
                const doc = content.doc;
                if (!doc) continue;

                const selection = doc.getSelection();
                if (selection && !selection.isCollapsed) {
                    const text = selection.toString().trim();
                    if (text) {
                        const range = selection.getRangeAt(0);
                        const cfi = this.getCFIFromRange(content.index, range);
                        if (cfi) {
                            console.debug('[FoliateEngine] Selection found:', { text: text.substring(0, 50), cfi });
                            return { text, cfi, range };
                        }
                    }
                }
            }
        } catch (e) {
            // Silently ignore errors during transitions
            console.debug('[FoliateEngine] getSelectionFromDocument error:', e);
        }
        return null;
    }

    private iframeListenersAttached = new WeakSet<Document>();
    private selectionCheckInterval: ReturnType<typeof setInterval> | null = null;

    private postMessageHandler: ((event: MessageEvent) => void) | null = null;

    private isInteractiveTapTarget(target: EventTarget | null): boolean {
        if (!(target instanceof Element)) {
            return false;
        }

        if (
            target.closest(
                'a,button,input,textarea,select,summary,label,[role="button"],[contenteditable="true"],[data-no-viewport-tap]',
            )
        ) {
            return true;
        }

        if (target instanceof SVGElement) {
            return true;
        }

        return false;
    }

    private notifyViewportTap(target: EventTarget | null): void {
        if (!this.options.onViewportTap) {
            return;
        }
        if (this.isInteractiveTapTarget(target)) {
            return;
        }
        this.options.onViewportTap();
    }

    /**
     * Setup selection listeners inside iframe documents
     * This is needed because selectionchange doesn't bubble from iframes
     */
    setupIframeSelectionListener(callback: (cfi: string, text: string, rangeOrEvent: Range | MouseEvent) => void): void {
        if (!this.view?.renderer) return;

        // Setup postMessage listener for iframe selections (Tauri WebView compatible)
        if (!this.postMessageHandler) {
            this.postMessageHandler = (event: MessageEvent) => {
                if (event.data?.type === 'foliate-selection') {
                    console.debug('[FoliateEngine] Received selection from iframe via postMessage:', event.data);
                    
                    const { sectionIndex, text, clientX, clientY, rect } = event.data;
                    
                    // Get the document for this section
                    const contents = this.view?.renderer?.getContents?.() || [];
                    const content = contents.find((c: any) => c.index === sectionIndex);
                    
                    if (content?.doc) {
                        // Try to find the range for CFI generation
                        const doc = content.doc;
                        const selection = doc.getSelection();
                        
                        if (selection && !selection.isCollapsed) {
                            try {
                                const range = selection.getRangeAt(0);
                                const cfi = this.getCFIFromRange(sectionIndex, range);
                                
                                if (cfi) {
                                    // Create synthetic mouse event
                                    const syntheticEvent = new MouseEvent('mouseup', {
                                        clientX: clientX || (rect?.left + rect?.width / 2) || 0,
                                        clientY: clientY || (rect?.top) || 0,
                                        bubbles: true
                                    });
                                    
                                    console.debug('[FoliateEngine] Calling callback with CFI:', cfi);
                                    callback(cfi, text, syntheticEvent);
                                }
                            } catch (err) {
                                console.warn('[FoliateEngine] Error getting CFI from postMessage selection:', err);
                            }
                        }
                    }
                } else if (event.data?.type === 'foliate-tap') {
                    this.notifyViewportTap(null);
                }
            };
            
            window.addEventListener('message', this.postMessageHandler);
            console.debug('[FoliateEngine] Setup postMessage listener for iframe selections');
        }

        const contents = this.view.renderer.getContents?.() || [];
        
        console.debug('[FoliateEngine] Setting up listeners for', contents.length, 'sections');
        
        for (const content of contents) {
            const doc = content.doc;
            const win = doc?.defaultView;
            if (!doc || !win) {
                console.debug('[FoliateEngine] No doc or window for section', content.index);
                continue;
            }

            // Skip if already has listeners
            if (this.iframeListenersAttached.has(doc)) {
                console.debug('[FoliateEngine] Already has listeners for section', content.index);
                continue;
            }

            console.debug('[FoliateEngine] Attaching selection listener to iframe:', content.index);

            // Mark as having listeners
            this.iframeListenersAttached.add(doc);

            // Log document info for debugging
            console.debug('[FoliateEngine] Document info for section', content.index, {
                url: doc.URL,
                title: doc.title,
                bodyExists: !!doc.body,
                windowExists: !!win,
            });

            // Try to access iframe element directly and add load listener
            // This is more reliable than injected scripts in sandboxed iframes
            const iframeElement = doc.defaultView?.frameElement as HTMLIFrameElement;
            if (iframeElement) {
                console.debug('[FoliateEngine] Found iframe element for section', content.index);
                
                // Listen for iframe load to re-attach listeners
                iframeElement.addEventListener('load', () => {
                    console.debug('[FoliateEngine] Iframe reloaded for section', content.index);
                    this.attachSelectionListenersToIframe(iframeElement, content.index, callback);
                });
                
                // Attach listeners now
                this.attachSelectionListenersToIframe(iframeElement, content.index, callback);
            } else {
                console.debug('[FoliateEngine] No iframe element found for section', content.index, 'using script injection');
                // Fallback to script injection
                this.injectSelectionScript(doc, content.index, callback);
            }

        }

        // Setup polling as fallback
        this.setupSelectionPolling(callback);
    }

    /**
     * Attach selection listeners directly to an iframe element
     * This tries to access the iframe's contentDocument and attach listeners
     */
    private attachSelectionListenersToIframe(
        iframe: HTMLIFrameElement,
        index: number,
        callback: (cfi: string, text: string, rangeOrEvent: Range | MouseEvent) => void
    ): void {
        try {
            const doc = iframe.contentDocument;
            const win = iframe.contentWindow;
            
            if (!doc || !win) {
                console.warn('[FoliateEngine] Cannot access iframe content for section', index);
                return;
            }
            
            console.debug('[FoliateEngine] Attaching listeners to iframe element for section', index);
            
            // Track last selection to avoid duplicates
            let lastSelection = '';
            let pointerDownX = 0;
            let pointerDownY = 0;
            let pointerDownAt = 0;
            let pointerMoved = false;
            const TAP_MAX_DISTANCE = 12;
            const TAP_MAX_DURATION = 350;

            win.addEventListener(
                'pointerdown',
                (event: PointerEvent) => {
                    if (!event.isPrimary || event.button !== 0) {
                        return;
                    }
                    pointerDownX = event.clientX;
                    pointerDownY = event.clientY;
                    pointerDownAt = Date.now();
                    pointerMoved = false;
                },
                true,
            );

            win.addEventListener(
                'pointermove',
                (event: PointerEvent) => {
                    if (pointerDownAt === 0) {
                        return;
                    }
                    const distance = Math.hypot(
                        event.clientX - pointerDownX,
                        event.clientY - pointerDownY,
                    );
                    if (distance > TAP_MAX_DISTANCE) {
                        pointerMoved = true;
                    }
                },
                true,
            );

            win.addEventListener(
                'pointercancel',
                () => {
                    pointerDownAt = 0;
                    pointerMoved = false;
                },
                true,
            );
            
            // Listen for mouseup on the iframe window
            win.addEventListener('mouseup', (e: MouseEvent) => {
                console.debug('[FoliateEngine] IFRAME MOUSEUP in section', index);
                
                setTimeout(() => {
                    try {
                        const selection = doc.getSelection();
                        console.debug('[FoliateEngine] Checking selection in iframe', index, {
                            rangeCount: selection?.rangeCount,
                            isCollapsed: selection?.isCollapsed
                        });
                        
                        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
                            const text = selection.toString().trim();
                            
                            if (text && text !== lastSelection && text.length > 0) {
                                lastSelection = text;
                                console.debug('[FoliateEngine] TEXT SELECTED in iframe', index, ':', text.substring(0, 50));
                                
                                const range = selection.getRangeAt(0);
                                const cfi = this.getCFIFromRange(index, range);
                                
                                if (cfi) {
                                    console.debug('[FoliateEngine] Calling callback from iframe listener');
                                    callback(cfi, text, e);
                                }
                            }
                        }
                    } catch (err) {
                        console.warn('[FoliateEngine] Error in iframe mouseup handler:', err);
                    }
                }, 100);
            });

            win.addEventListener(
                'pointerup',
                (event: PointerEvent) => {
                    if (!event.isPrimary || event.button !== 0) {
                        pointerDownAt = 0;
                        pointerMoved = false;
                        return;
                    }

                    const elapsed = Date.now() - pointerDownAt;
                    const distance = Math.hypot(
                        event.clientX - pointerDownX,
                        event.clientY - pointerDownY,
                    );
                    const isTap =
                        pointerDownAt > 0
                        && !pointerMoved
                        && elapsed <= TAP_MAX_DURATION
                        && distance <= TAP_MAX_DISTANCE;

                    pointerDownAt = 0;
                    pointerMoved = false;

                    if (!isTap) {
                        return;
                    }

                    window.setTimeout(() => {
                        const selection = doc.getSelection();
                        const hasSelection = Boolean(
                            selection
                            && !selection.isCollapsed
                            && selection.toString().trim().length > 0,
                        );
                        if (hasSelection) {
                            return;
                        }
                        this.notifyViewportTap(event.target);
                    }, 0);
                },
                true,
            );
            
            console.debug('[FoliateEngine] Successfully attached iframe listeners for section', index);
        } catch (err) {
            console.warn('[FoliateEngine] Failed to attach iframe listeners:', err);
        }
    }

    /**
     * Inject a script into the iframe to detect selection and send via postMessage
     * This is necessary for Tauri WebView which restricts cross-frame access
     */
    private injectSelectionScript(
        doc: Document, 
        index: number, 
        _callback: (cfi: string, text: string, event: MouseEvent) => void
    ): void {
        const script = doc.createElement('script');
        script.textContent = `
            (function() {
                let lastSelection = '';
                let pointerDownX = 0;
                let pointerDownY = 0;
                let pointerDownAt = 0;
                let pointerMoved = false;
                const TAP_MAX_DISTANCE = 12;
                const TAP_MAX_DURATION = 350;
                
                document.addEventListener('pointerdown', function(e) {
                    if (!e.isPrimary || e.button !== 0) {
                        return;
                    }
                    pointerDownX = e.clientX;
                    pointerDownY = e.clientY;
                    pointerDownAt = Date.now();
                    pointerMoved = false;
                });

                document.addEventListener('pointermove', function(e) {
                    if (pointerDownAt === 0) {
                        return;
                    }
                    var distance = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
                    if (distance > TAP_MAX_DISTANCE) {
                        pointerMoved = true;
                    }
                });

                document.addEventListener('pointercancel', function() {
                    pointerDownAt = 0;
                    pointerMoved = false;
                });
                
                document.addEventListener('pointerup', function(e) {
                    const elapsed = Date.now() - pointerDownAt;
                    const distance = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
                    const isTap =
                        pointerDownAt > 0
                        && !pointerMoved
                        && elapsed <= TAP_MAX_DURATION
                        && distance <= TAP_MAX_DISTANCE;
                    pointerDownAt = 0;
                    pointerMoved = false;
                    
                    // Check selection after a short delay
                    setTimeout(function() {
                        var selection = document.getSelection();
                        
                        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
                            var text = selection.toString().trim();
                            
                            // Prevent duplicate selections
                            if (text && text !== lastSelection && text.length > 0) {
                                lastSelection = text;
                                
                                var range = selection.getRangeAt(0);
                                var rect = range.getBoundingClientRect();
                                
                                window.parent.postMessage({
                                    type: 'foliate-selection',
                                    sectionIndex: ${index},
                                    text: text,
                                    clientX: e.clientX,
                                    clientY: e.clientY,
                                    rect: {
                                        left: rect.left,
                                        top: rect.top,
                                        width: rect.width,
                                        height: rect.height
                                    }
                                }, '*');
                            }
                            return;
                        }

                        if (isTap) {
                            window.parent.postMessage({
                                type: 'foliate-tap',
                                sectionIndex: ${index},
                            }, '*');
                        }
                    }, 100);
                });
            })();
        `;
        
        if (doc.head) {
            doc.head.appendChild(script);
        } else if (doc.body) {
            doc.body.appendChild(script);
        }
    }

    private checkAndReportSelection(
        index: number, 
        doc: Document, 
        callback: (cfi: string, text: string, event: MouseEvent) => void,
        event: MouseEvent
    ): void {
        const selection = doc.getSelection();
        console.debug('[FoliateEngine] Checking selection in section', index, {
            rangeCount: selection?.rangeCount,
            isCollapsed: selection?.isCollapsed,
            type: selection?.type
        });
        
        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const text = selection.toString().trim();
            console.debug('[FoliateEngine] Found text in section', index, ':', text.substring(0, 50));
            
            if (text && text.length > 0) {
                try {
                    const range = selection.getRangeAt(0);
                    const cfi = this.getCFIFromRange(index, range);
                    if (cfi) {
                        console.debug('[FoliateEngine] Selection detected - calling callback:', { text: text.substring(0, 50), cfi });
                        callback(cfi, text, event);
                    } else {
                        console.warn('[FoliateEngine] Failed to get CFI from selection in section', index);
                    }
                } catch (err) {
                    console.warn('[FoliateEngine] Error getting selection in section', index, ':', err);
                }
            }
        }
    }

    private setupSelectionPolling(_callback: (cfi: string, text: string, event: MouseEvent) => void): void {
        // NOTE: Polling removed for performance. Event-based detection is sufficient.
        // This method is kept for API compatibility but does nothing.
    }

    /**
     * Clear any text selection in all documents
     */
    clearSelection(): void {
        if (!this.view) return;
        
        try {
            const contents = this.view.renderer?.getContents?.() || [];
            for (const content of contents) {
                const doc = content.doc;
                if (doc) {
                    doc.getSelection()?.removeAllRanges();
                }
            }
        } catch (e) {
            // Silently ignore errors during transitions
            console.debug('[FoliateEngine] clearSelection error:', e);
        }
    }

    /**
     * Get the current section index being displayed
     */
    getCurrentSectionIndex(): number {
        const contents = this.view?.renderer?.getContents?.() || [];
        if (contents.length > 0) {
            return contents[0].index;
        }
        return -1;
    }

    /**
     * Get the document for a specific section index
     */
    getDocumentForSection(index: number): Document | null {
        const contents = this.view?.renderer?.getContents?.() || [];
        const content = contents.find((c: { index: number }) => c.index === index);
        return content?.doc || null;
    }

    private findSectionIndex(fraction: number): number {
        // Handle edge cases
        if (this.sectionFractions.length === 0) {
            return 0;
        }
        
        if (fraction <= 0) {
            return 0;
        }
        
        if (fraction >= 1) {
            return this.sectionFractions.length - 1;
        }
        
        // Find the correct section - the section where fraction falls within [start, end)
        for (let i = 0; i < this.sectionFractions.length - 1; i++) {
            const start = this.sectionFractions[i];
            const end = this.sectionFractions[i + 1];
            
            // Check if fraction falls within this section
            if (fraction >= start && fraction < end) {
                return i;
            }
        }
        
        // If we get here, fraction is beyond the last section boundary - return last section
        return this.sectionFractions.length - 1;
    }

    private calculateSectionFraction(totalFraction: number, sectionIndex: number): number {
        // sectionFractions is structured as: [0, end_of_0, end_of_1, ..., 1]
        // So for section i: start = sectionFractions[i], end = sectionFractions[i+1]
        const sectionStart = this.sectionFractions[sectionIndex] ?? 0;
        const sectionEnd = this.sectionFractions[sectionIndex + 1] ?? 1;
        const sectionSize = sectionEnd - sectionStart;
        
        if (sectionSize <= 0) return 0;
        
        // Calculate the fraction within this section and clamp to [0, 1]
        const result = (totalFraction - sectionStart) / sectionSize;
        return Math.max(0, Math.min(1, result));
    }

    /**
     * Get the current document format
     */
    getFormat(): BookFormat {
        return this.format;
    }

    /**
     * Check if current document has fixed layout (CBZ/PDF, plus legacy CBR entries)
     * Fixed layouts use zoom instead of font settings
     */
    isFixedLayout(): boolean {
        return this.isFixedLayoutFormat;
    }

    /**
     * Check if current document is reflowable (EPUB, MOBI, FB2)
     * Reflowable documents support font/size controls
     */
    isReflowable(): boolean {
        return !this.isFixedLayoutFormat;
    }

    destroy(): void {
        // Cancel pending updates
        if (this.pendingUpdateFrame) {
            cancelAnimationFrame(this.pendingUpdateFrame);
            this.pendingUpdateFrame = null;
        }

        if (this.selectionCheckInterval) {
            clearInterval(this.selectionCheckInterval);
            this.selectionCheckInterval = null;
        }

        if (this.postMessageHandler) {
            window.removeEventListener('message', this.postMessageHandler);
            this.postMessageHandler = null;
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
        this.searchSectionCache = null;
        this.searchCacheBookRef = null;
        this.book = null;
        this.container = null;
    }
}

export default FoliateEngine;
