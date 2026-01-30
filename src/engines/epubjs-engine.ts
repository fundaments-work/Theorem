/**
 * EPUB.js Engine with Byte-Based Pagination (Foliate-style)
 * Fast page numbers without slow locations.generate()
 */

import type {
    DocLocation,
    TocItem,
    DocMetadata,
    ThemeSettings,
    HighlightColor,
    Annotation as AnnotationType,
    BookSection,
    SearchResult,
    ReadingFlow,
    PageLayout,
} from '@/types';

export type { DocLocation, TocItem, DocMetadata, ThemeSettings, HighlightColor, BookSection };
export interface Annotation extends AnnotationType { }

// Import epub.js dynamically
let ePub: any = null;

async function loadEPubJS(): Promise<any> {
    if (!ePub) {
        const module = await import('epubjs');
        ePub = module.default;
    }
    return ePub;
}

// Throttle utility
function throttle<T extends (...args: unknown[]) => unknown>(
    func: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false;
    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

export class EpubjsEngine {
    private book: any = null;
    private rendition: any = null;
    private container: HTMLElement | null = null;
    private isInitialized = false;

    // State tracking
    private locationsGenerated = false;
    private currentThemeSettings: ThemeSettings | null = null;
    private themeUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
    private resizeHandler: (() => void) | null = null;

    // Cached values
    private totalPageCount: number = 0;

    // Byte-based pagination (Foliate-style instant calculation)
    private sectionSizes: Map<string, number> = new Map();
    private cumulativeSizes: number[] = [0];
    private linearSectionIndices: number[] = []; // Maps linear index -> spine index
    private totalBytes: number = 0;
    private bytesPerPage: number = 1500; // ~1 page of formatted text

    // Layout and flow settings
    private currentLayout: PageLayout = 'auto';
    private currentFlow: ReadingFlow = 'paged';
    private currentZoom: number = 100;
    private currentMargins: number = 10;

    // Container size for auto layout


    // Callbacks
    public onLocationChange?: (location: DocLocation) => void;
    public onReady?: (metadata: DocMetadata, toc: TocItem[]) => void;
    public onLocationsGenerated?: () => void;
    public onLocationsSaved?: (locations: string) => void;
    public onError?: (error: Error) => void;
    public onTextSelected?: (cfi: string, text: string, range: Range) => void;

    async init(container: HTMLElement): Promise<void> {
        if (this.isInitialized) return;
        this.container = container;

        this.isInitialized = true;
    }

    async open(
        source: File | Blob | ArrayBuffer | string,
        _filename: string = 'document.epub',
        initialLocation?: string,
        layout: PageLayout = 'auto',
        savedLocations?: string,
        flow: ReadingFlow = 'paged',
        zoom: number = 100,
        margins: number = 10
    ): Promise<void> {
        const startTime = performance.now();

        if (!this.container) {
            throw new Error('Engine not initialized');
        }

        try {
            // Close previous book
            this.destroy();

            // Store settings
            this.currentLayout = layout;
            this.currentFlow = flow;
            this.currentZoom = zoom;
            this.currentMargins = margins;

            // Load epub.js
            const ePub = await loadEPubJS();

            // Create book
            this.book = ePub(source);

            // Wait for book to be ready
            await this.book.ready;

            // Initialize byte-based pagination (INSTANT)
            this.initializeByteBasedPagination();

            // Get metadata
            const meta = this.book.packaging.metadata;
            const metadata: DocMetadata = {
                title: meta.title || 'Unknown Title',
                author: meta.creator || meta.author || 'Unknown Author',
                description: meta.description,
                language: meta.language,
                publisher: meta.publisher,
                pubdate: meta.pubdate,
                identifier: meta.identifier,
            };

            // Get cover asynchronously
            this.book.coverUrl().then((coverUrl: string | null) => {
                if (coverUrl && this.book) {
                    metadata.cover = coverUrl;
                }
            }).catch(() => { /* No cover, ignore */ });

            // Get TOC
            let toc: TocItem[] = [];
            try {
                const navigation = await this.book.loaded.navigation;
                toc = this.convertToc(navigation?.toc || []);
            } catch (e) {
                toc = [];
            }

            // Determine actual layout based on settings and viewport
            const actualLayout = this.resolveLayout(layout, zoom);

            // Get container dimensions
            const { width, height } = this.container.getBoundingClientRect();

            // Apply zoom factor to dimensions
            const zoomFactor = zoom / 100;
            const effectiveWidth = width / zoomFactor;
            const effectiveHeight = height / zoomFactor;

            // Determine spread mode and flow
            const spreadMode = actualLayout === 'double' ? 'always' : 'none';
            const minSpreadWidth = actualLayout === 'double' ? 400 : 800;
            const flowMode = flow === 'scroll' ? 'scrolled-doc' : 'paginated';

            // Calculate margins in pixels
            const marginPx = (margins / 100) * Math.min(width, height);

            // Create rendition with proper settings
            this.rendition = this.book.renderTo(this.container, {
                width: effectiveWidth,
                height: effectiveHeight,
                spread: spreadMode,
                minSpreadWidth,
                flow: flowMode,
                manager: 'default',
                snap: flow !== 'scroll',
                allowScriptedContent: false,
            });

            // Store rendition reference for zoom/margin updates
            this.rendition._zoom = zoomFactor;
            this.rendition._margins = marginPx;

            // Hook into iframe creation for styling and navigation fixes
            if (this.rendition.hooks?.content) {
                this.rendition.hooks.content.register((contents: any) => {
                    try {
                        // Apply zoom transform to content
                        this.applyZoomToContent(contents, zoomFactor);

                        // Apply margins to content body
                        this.applyMarginsToContent(contents, marginPx);

                        // Fix click handling - ensure internal links work
                        const doc = contents?.document;
                        if (doc) {
                            // Handle internal link clicks
                            doc.querySelectorAll('a[href]').forEach((link: Element) => {
                                link.addEventListener('click', (e: Event) => {
                                    const href = (link as HTMLAnchorElement).getAttribute('href');
                                    if (href && !href.startsWith('http')) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        this.goTo(href);
                                    }
                                });
                            });
                        }
                    } catch (e) {
                        // Ignore iframe access errors
                    }
                });
            }

            // Use MutationObserver to remove sandbox from iframes as soon as they're added
            // This is more reliable than hooks which may fire too late
            if (this.container) {
                const observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node instanceof HTMLIFrameElement) {
                                if (node.hasAttribute('sandbox')) {
                                    node.removeAttribute('sandbox');
                                    console.log('[EpubjsEngine] Removed sandbox from iframe via MutationObserver');
                                }
                            }
                        }
                    }
                });
                observer.observe(this.container, { childList: true, subtree: true });
                
                // Store observer for cleanup
                (this as any)._sandboxObserver = observer;
            }

            // Also try the render hook as backup
            if (this.rendition.hooks?.render) {
                this.rendition.hooks.render.register((iframe: HTMLIFrameElement) => {
                    try {
                        if (iframe.hasAttribute('sandbox')) {
                            iframe.removeAttribute('sandbox');
                            console.log('[EpubjsEngine] Removed sandbox from iframe via render hook');
                        }
                    } catch (e) {
                        // Ignore
                    }
                });
            }

            // Apply default theme
            this.applyTheme({
                fontSize: 18,
                lineHeight: 1.6,
                fontFamily: 'serif',
            });

            // Setup event listeners
            this.setupEventListeners();

            // Display first page
            await this.rendition.display(initialLocation || undefined);

            // Emit initial location with byte-based page count (INSTANT)
            const currentLoc = this.getCurrentLocation();
            if (currentLoc) {
                this.onLocationChange?.(currentLoc);
            }

            // Load saved locations if available
            if (savedLocations && this.book.locations) {
                try {
                    this.book.locations.load(savedLocations);
                    this.locationsGenerated = true;
                    const accurateCount = this.book.locations.length() || 0;
                    if (accurateCount > 0) {
                        this.totalPageCount = accurateCount;
                    }
                } catch (e) {
                    console.warn('[EpubjsEngine] Failed to load saved locations:', e);
                }
            }

            console.log(`[EpubjsEngine] Ready in ${(performance.now() - startTime).toFixed(0)}ms`);
            console.log(`[EpubjsEngine] Byte-based pagination: ${this.totalPageCount} pages (${this.totalBytes} bytes)`);

            this.onReady?.(metadata, toc);
        } catch (error) {
            this.onError?.(error as Error);
            throw error;
        }
    }

    /**
     * Resolve 'auto' layout to actual 'single' or 'double' based on viewport and zoom
     */
    private resolveLayout(layout: PageLayout, zoom: number): 'single' | 'double' {
        if (layout !== 'auto') {
            return layout;
        }

        if (!this.container) return 'single';

        const { width } = this.container.getBoundingClientRect();
        const zoomFactor = zoom / 100;
        const effectiveWidth = width / zoomFactor;

        // Threshold for double page: at least 900px effective width
        // This ensures we have enough space for two readable columns
        return effectiveWidth >= 900 ? 'double' : 'single';
    }

    /**
     * Apply zoom transform to content iframe
     */
    private applyZoomToContent(contents: any, zoomFactor: number): void {
        try {
            const doc = contents?.document;
            if (!doc) return;

            const body = doc.body;
            if (!body) return;

            // Apply CSS zoom/scale
            if (zoomFactor !== 1) {
                // Use transform scale for smooth zooming
                body.style.transform = `scale(${zoomFactor})`;
                body.style.transformOrigin = 'top left';
                // Adjust body size to prevent overflow
                body.style.width = `${100 / zoomFactor}%`;
            }
        } catch (e) {
            console.warn('[EpubjsEngine] Failed to apply zoom:', e);
        }
    }

    /**
     * Apply margins to content body
     */
    private applyMarginsToContent(contents: any, marginPx: number): void {
        try {
            const doc = contents?.document;
            if (!doc) return;

            const body = doc.body;
            if (!body) return;

            if (marginPx > 0) {
                body.style.padding = `${marginPx}px`;
            }
        } catch (e) {
            console.warn('[EpubjsEngine] Failed to apply margins:', e);
        }
    }

    /**
     * Initialize byte-based pagination (Foliate-style)
     * Provides INSTANT page numbers without parsing content
     */
    private initializeByteBasedPagination(): void {
        if (!this.book) return;

        try {
            this.sectionSizes.clear();
            let totalBytes = 0;

            // Iterate through spine items
            this.book.spine.each((item: any) => {
                if (!item.linear) return;

                let size = 0;

                // Try to get size from various sources
                if (item.size && item.size > 0) {
                    size = item.size;
                } else if (item.bytes && item.bytes > 0) {
                    size = item.bytes;
                } else if (this.book.archive?.entries) {
                    const entry = this.book.archive.entries[item.href];
                    if (entry) {
                        size = entry.uncompressedSize || entry.size || 0;
                    }
                }

                // Fallback: estimate based on file type
                if (size === 0) {
                    const href = item.href || '';
                    if (href.endsWith('.html') || href.endsWith('.htm') || href.endsWith('.xhtml')) {
                        size = 50000; // ~50KB average chapter
                    } else if (href.endsWith('.xml')) {
                        size = 10000;
                    }
                }

                // Ensure minimum size
                size = Math.max(size, 1000);

                this.sectionSizes.set(item.href || item.idref, size);
                totalBytes += size;
            });

            this.totalBytes = totalBytes;

            // Build cumulative size array for O(1) lookups
            this.cumulativeSizes = [0];
            this.linearSectionIndices = []; // Maps linear index -> spine index
            let sum = 0;
            this.book.spine.each((item: any, index: number) => {
                if (!item.linear) return;
                
                const size = this.sectionSizes.get(item.href || item.idref) || 0;
                sum += size;
                this.cumulativeSizes.push(sum);
                this.linearSectionIndices.push(index); // Store spine index
            });

            // Calculate total pages
            this.totalPageCount = Math.max(1, Math.ceil(totalBytes / this.bytesPerPage));

        } catch (e) {
            console.warn('[EpubjsEngine] Failed to initialize byte-based pagination:', e);
            // Fallback
            const spineCount = this.book.spine?.items?.length || 1;
            this.totalPageCount = spineCount * 15;
            this.totalBytes = this.totalPageCount * this.bytesPerPage;
        }
    }

    /**
     * Get page number from section index and fraction (byte-based)
     * O(1) operation - instant calculation
     */
    private getByteBasedPage(spineIndex: number, fractionInSection: number): number {
        if (this.totalBytes === 0) return 1;

        // Find the position of this spine index in our linear sections
        const linearIndex = this.linearSectionIndices.indexOf(spineIndex);
        if (linearIndex === -1) {
            // Section not found in linear items - estimate position
            return Math.max(1, Math.min(this.totalPageCount, 
                Math.floor((spineIndex / (this.book?.spine?.items?.length || 1)) * this.totalPageCount) + 1));
        }

        const bytesBefore = this.cumulativeSizes[linearIndex] || 0;
        const sectionItem = this.book?.spine?.items?.[spineIndex];
        const sectionSize = sectionItem ? (this.sectionSizes.get(sectionItem.href || sectionItem.idref) || 0) : 0;
        
        const currentBytes = bytesBefore + (sectionSize * fractionInSection);
        return Math.floor(currentBytes / this.bytesPerPage) + 1;
    }

    /**
     * Estimate fraction through section based on CFI
     */
    private estimateFractionInSection(cfi: string, _sectionIndex: number): number {
        try {
            // Try percentage from book locations
            if (this.book?.locations?.percentageFromCfi) {
                const pct = this.book.locations.percentageFromCfi(cfi);
                if (typeof pct === 'number' && !isNaN(pct)) {
                    return Math.max(0, Math.min(1, pct));
                }
            }

            // Parse CFI offset
            const offsetMatch = cfi.match(/:\s*(\d+)\s*\)?$/);
            if (offsetMatch) {
                const offset = parseInt(offsetMatch[1], 10);
                return Math.min(1, offset / 30000);
            }

            // Estimate from CFI path depth
            const pathMatch = cfi.match(/!(.+)$/);
            if (pathMatch) {
                const steps = pathMatch[1].split('/').filter(s => s && !s.includes('['));
                return Math.min(1, steps.length / 20);
            }
        } catch (e) {
            // Ignore
        }
        return 0;
    }

    /**
     * Get page info using byte-based calculation (INSTANT)
     */
    public getPageInfo(startCfi: string | null, endCfi?: string | null, percentage?: number): {
        currentPage: number;
        endPage?: number;
        totalPages: number;
        range?: string;
        isEstimated?: boolean;
    } | null {
        const totalPages = this.totalPageCount > 0
            ? this.totalPageCount
            : (this.book?.spine?.items?.length || 1) * 10;

        if (!startCfi || !this.book) {
            return { currentPage: 1, totalPages, range: '1', isEstimated: true };
        }

        // Use byte-based calculation if available
        if (this.totalBytes > 0) {
            try {
                const spineItem = this.book.spine?.get(startCfi);
                if (spineItem) {
                    const sectionIndex = typeof spineItem.index === 'number' && spineItem.index >= 0
                        ? spineItem.index
                        : this.book.spine.items.findIndex((item: any) =>
                            item.idref === spineItem.idref || item.href === spineItem.href);

                    if (sectionIndex >= 0) {
                        const fraction = typeof percentage === 'number'
                            ? percentage
                            : this.estimateFractionInSection(startCfi, sectionIndex);

                        const currentPage = this.getByteBasedPage(sectionIndex, fraction);

                        // Handle double layout
                        let endPage: number | undefined;
                        const actualLayout = this.resolveLayout(this.currentLayout, this.currentZoom);
                        if (actualLayout === 'double' && endCfi && endCfi !== startCfi) {
                            const endSpineItem = this.book.spine?.get(endCfi);
                            if (endSpineItem) {
                                const endIndex = typeof endSpineItem.index === 'number' && endSpineItem.index >= 0
                                    ? endSpineItem.index
                                    : this.book.spine.items.findIndex((item: any) =>
                                        item.idref === endSpineItem.idref || item.href === endSpineItem.href);
                                const endFraction = this.estimateFractionInSection(endCfi, endIndex);
                                endPage = this.getByteBasedPage(endIndex, endFraction);
                            }
                        }

                        const range = endPage && endPage > currentPage
                            ? `${currentPage}-${endPage}`
                            : `${currentPage}`;

                        return {
                            currentPage,
                            endPage,
                            totalPages,
                            range,
                            isEstimated: !this.locationsGenerated
                        };
                    }
                }
            } catch (e) {
                console.warn('[EpubjsEngine] Byte-based calculation failed:', e);
            }
        }

        // Fallback to spine-based
        const spineItem = this.book.spine?.get(startCfi);
        if (spineItem && this.book.spine?.items) {
            const items = this.book.spine.items;
            const index = typeof spineItem.index === 'number' && spineItem.index >= 0
                ? spineItem.index
                : items.findIndex((item: any) => item.idref === spineItem.idref || item.href === spineItem.href);

            if (index >= 0 && items.length > 0) {
                const estimatedPage = Math.floor((index / items.length) * totalPages) + 1;
                return {
                    currentPage: estimatedPage,
                    totalPages,
                    range: `${estimatedPage}`,
                    isEstimated: true
                };
            }
        }

        return { currentPage: 1, totalPages, range: '1', isEstimated: true };
    }

    /**
     * Parse location from EPUB.js format
     */
    private parseLocation(location: any): DocLocation {
        let startCfi: string | null = null;
        let endCfi: string | null = null;

        if (typeof location?.start === 'string' && location.start.startsWith('epubcfi(')) {
            startCfi = location.start;
        } else if (typeof location?.start?.cfi === 'string') {
            startCfi = location.start.cfi;
        } else if (typeof location?.cfi === 'string') {
            startCfi = location.cfi;
        }

        if (typeof location?.end?.cfi === 'string') {
            endCfi = location.end.cfi;
        }

        if (!startCfi && this.rendition) {
            try {
                const currentLoc = this.rendition.currentLocation();
                startCfi = currentLoc?.start?.cfi || currentLoc?.start || null;
                endCfi = currentLoc?.end?.cfi || null;
            } catch { /* ignore */ }
        }

        const locationPercentage = typeof location?.percentage === 'number' ? location.percentage : null;
        const pageInfo = this.getPageInfo(startCfi, endCfi, locationPercentage ?? undefined);

        // Calculate percentage from pages
        let percentage: number;
        if (pageInfo && pageInfo.totalPages > 0) {
            if (pageInfo.currentPage >= pageInfo.totalPages) {
                percentage = 1;
            } else {
                percentage = (pageInfo.currentPage - 1) / pageInfo.totalPages;
            }
        } else {
            percentage = this.calculatePercentage(location, startCfi);
        }

        return {
            cfi: startCfi || '',
            percentage: Math.max(0, Math.min(1, percentage)),
            pageInfo: pageInfo || undefined,
        };
    }

    private calculatePercentage(location: any, cfi: string | null): number {
        if (cfi && this.book?.spine) {
            try {
                const spineItem = this.book.spine.get(cfi);
                if (spineItem) {
                    const items = this.book.spine.items || [];
                    const index = typeof spineItem.index === 'number' && spineItem.index >= 0
                        ? spineItem.index
                        : items.findIndex((item: any) => item.id === spineItem.id || item.href === spineItem.href);
                    if (index >= 0 && items.length > 0) {
                        return index / items.length;
                    }
                }
            } catch { /* fall through */ }
        }
        return typeof location?.percentage === 'number' ? location.percentage : 0;
    }

    private setupEventListeners(): void {
        if (!this.rendition || !this.container) return;

        this.rendition.on('relocated', (location: any) => {
            const loc = this.parseLocation(location);
            this.onLocationChange?.(loc);
        });

        this.rendition.on('selected', (cfi: string, contents: any) => {
            try {
                const range = contents.range(cfi);
                const text = range.toString();
                this.onTextSelected?.(cfi, text, range);
            } catch (e) {
                console.warn('[EpubjsEngine] Error handling selection:', e);
            }
        });

        // Handle internal link clicks
        this.rendition.on('click', (_e: any) => {
            console.debug('[EpubjsEngine] Rendition click event');
        });

        // Handle navigation through EPUB.js internal swipe/click
        this.rendition.on('touchstart', () => {
            console.debug('[EpubjsEngine] Rendition touchstart event');
        });

        this.resizeHandler = throttle(() => {
            if (this.container && this.rendition) {
                const { width, height } = this.container.getBoundingClientRect();


                // Check if auto layout needs to change
                const newLayout = this.resolveLayout(this.currentLayout, this.currentZoom);
                const currentActualLayout = this.resolveLayout(this.currentLayout, this.currentZoom);

                // If layout changed, re-render with new settings
                if (newLayout !== currentActualLayout && this.currentLayout === 'auto') {
                    this.setLayout('auto');
                } else {
                    const zoomFactor = this.currentZoom / 100;
                    this.rendition.resize(width / zoomFactor, height / zoomFactor);
                }
            }
        }, 100);

        window.addEventListener('resize', this.resizeHandler);
    }

    private convertToc(toc: any[]): TocItem[] {
        return toc.map(item => ({
            label: item.label,
            href: item.href,
            subitems: item.subitems ? this.convertToc(item.subitems) : undefined,
        }));
    }

    // Navigation
    async next(): Promise<void> {
        console.debug('[EpubjsEngine] next() called, flow:', this.currentFlow);
        if (!this.rendition || !this.book) {
            console.warn('[EpubjsEngine] next() failed - no rendition or book');
            return;
        }

        // In scroll mode, use fraction-based navigation for better control
        if (this.currentFlow === 'scroll') {
            const currentLoc = this.getCurrentLocation();
            if (currentLoc) {
                // Move forward by ~1 page worth of content (2% of book)
                const newFraction = Math.min(1, currentLoc.percentage + 0.02);
                console.debug('[EpubjsEngine] Scroll mode next, going to fraction:', newFraction);
                await this.goToFraction(newFraction);
            }
            return;
        }

        console.debug('[EpubjsEngine] Calling rendition.next()');
        await this.rendition.next();
    }

    async prev(): Promise<void> {
        console.debug('[EpubjsEngine] prev() called, flow:', this.currentFlow);
        if (!this.rendition || !this.book) {
            console.warn('[EpubjsEngine] prev() failed - no rendition or book');
            return;
        }

        // In scroll mode, use fraction-based navigation for better control
        if (this.currentFlow === 'scroll') {
            const currentLoc = this.getCurrentLocation();
            if (currentLoc) {
                // Move backward by ~1 page worth of content (2% of book)
                const newFraction = Math.max(0, currentLoc.percentage - 0.02);
                console.debug('[EpubjsEngine] Scroll mode prev, going to fraction:', newFraction);
                await this.goToFraction(newFraction);
            }
            return;
        }

        console.debug('[EpubjsEngine] Calling rendition.prev()');
        await this.rendition.prev();
    }

    async goTo(target: string | number): Promise<void> {
        if (!this.rendition || !this.book) return;

        try {
            if (typeof target === 'string') {
                if (target.startsWith('epubcfi(') || target.includes('#') || target.includes('.')) {
                    await this.rendition.display(target);
                }
            } else {
                // Convert page number to CFI using byte-based calculation
                const [sectionIndex, fraction] = this.getSectionFromPage(target);
                const section = this.book.spine.get(sectionIndex);
                if (section?.cfi) {
                    // Build CFI with character offset based on fraction
                    const charOffset = Math.floor(fraction * 30000);
                    const cfi = charOffset > 0
                        ? `${section.cfi}!/4/2[${charOffset}]`
                        : `${section.cfi}!/4/2`;
                    await this.rendition.display(cfi);
                }
            }
        } catch (error) {
            console.error('[EpubjsEngine] Navigation failed:', error);
        }
    }

    /**
     * Find section index from page number (binary search)
     * Returns [spineIndex, fractionWithinSection]
     */
    private getSectionFromPage(targetPage: number): [number, number] {
        if (this.totalBytes === 0) return [0, 0];

        const targetBytes = (targetPage - 1) * this.bytesPerPage;

        let left = 0;
        let right = this.cumulativeSizes.length - 1;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.cumulativeSizes[mid] <= targetBytes) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        const linearIndex = Math.max(0, left - 1);
        const spineIndex = this.linearSectionIndices[linearIndex] ?? 0;
        const bytesInSection = targetBytes - this.cumulativeSizes[linearIndex];
        const sectionSize = this.cumulativeSizes[linearIndex + 1] - this.cumulativeSizes[linearIndex];
        const fraction = sectionSize > 0 ? bytesInSection / sectionSize : 0;

        return [spineIndex, Math.max(0, Math.min(1, fraction))];
    }

    // Theme - Enhanced with full settings support
    applyTheme(settings: ThemeSettings): void {
        if (!this.rendition) return;

        if (this.themeUpdateTimeout) {
            clearTimeout(this.themeUpdateTimeout);
        }

        const settingsHash = JSON.stringify(settings);
        if (settingsHash === JSON.stringify(this.currentThemeSettings)) {
            return;
        }

        this.currentThemeSettings = { ...settings };

        this.themeUpdateTimeout = setTimeout(() => {
            if (!this.rendition?.themes) return;

            try {
                // Resolve font family
                const fontFamily = settings.fontFamily === 'serif' ? 'Georgia, serif' :
                    settings.fontFamily === 'sans' ? 'system-ui, sans-serif' :
                        settings.fontFamily === 'mono' ? 'monospace' :
                            settings.fontFamily === 'original' ? 'inherit' : 'Georgia, serif';

                const bg = settings.backgroundColor || '#ffffff';
                const fg = settings.textColor || '#1a1a1a';

                // Build CSS rules object
                const bodyRules: Record<string, string> = {
                    background: bg,
                    color: fg,
                    'font-family': fontFamily,
                    transition: 'none',
                };

                // Font size - only apply if not using original font
                if (settings.fontSize && settings.fontFamily !== 'original') {
                    bodyRules['font-size'] = `${settings.fontSize}px`;
                }

                // Line height - use unit-less value for better inheritance
                if (settings.lineHeight) {
                    bodyRules['line-height'] = settings.lineHeight.toString();
                }

                // Word spacing
                if (settings.wordSpacing !== undefined && settings.wordSpacing !== 0) {
                    bodyRules['word-spacing'] = `${settings.wordSpacing}em`;
                }

                // Letter spacing
                if (settings.letterSpacing !== undefined && settings.letterSpacing !== 0) {
                    bodyRules['letter-spacing'] = `${settings.letterSpacing}em`;
                }

                // Text alignment
                if (settings.textAlign) {
                    bodyRules['text-align'] = settings.textAlign;
                }

                // Hyphenation
                if (settings.hyphenation !== undefined) {
                    bodyRules['hyphens'] = settings.hyphenation ? 'auto' : 'none';
                    bodyRules['-webkit-hyphens'] = settings.hyphenation ? 'auto' : 'none';
                    bodyRules['-moz-hyphens'] = settings.hyphenation ? 'auto' : 'none';
                }

                // Paragraph spacing
                const paragraphRules: Record<string, string> = {};
                if (settings.paragraphSpacing !== undefined && settings.paragraphSpacing !== 1) {
                    paragraphRules['margin-bottom'] = `${settings.paragraphSpacing}em`;
                }

                // Register theme with body rules
                this.rendition.themes.register('lion-reader-theme', {
                    body: bodyRules,
                    p: paragraphRules,
                    '::selection': {
                        background: 'highlight',
                        color: 'highlighttext',
                    },
                });

                this.rendition.themes.select('lion-reader-theme');

                // Apply force publisher styles override if requested
                if (settings.forcePublisherStyles) {
                    this.rendition.themes.override('font-family', fontFamily, true);
                    if (settings.fontSize && settings.fontFamily !== 'original') {
                        this.rendition.themes.override('font-size', `${settings.fontSize}px`, true);
                    }
                }

                // Re-apply zoom and margins after theme change
                const contents = this.rendition?.getContents?.()[0];
                if (contents) {
                    this.applyZoomToContent(contents, this.currentZoom / 100);
                    const marginPx = (this.currentMargins / 100) * Math.min(
                        this.container?.getBoundingClientRect().width || 800,
                        this.container?.getBoundingClientRect().height || 600
                    );
                    this.applyMarginsToContent(contents, marginPx);
                }

            } catch (e) {
                console.warn('[EpubjsEngine] Theme application failed:', e);
            }
        }, 50);
    }

    // Getters
    getCurrentLocation(): DocLocation | null {
        if (!this.rendition || !this.book) return null;

        try {
            const location = this.rendition.currentLocation();
            if (!location?.start) return null;

            return this.parseLocation(location);
        } catch (e) {
            console.warn('[EpubjsEngine] Error getting current location:', e);
            return null;
        }
    }

    getMetadata(): DocMetadata | null {
        if (!this.book) return null;

        const meta = this.book.packaging.metadata;
        return {
            title: meta.title || 'Unknown Title',
            author: meta.creator || meta.author || 'Unknown Author',
            description: meta.description,
            language: meta.language,
            publisher: meta.publisher,
            pubdate: meta.pubdate,
            identifier: meta.identifier,
        };
    }

    getTableOfContents(): TocItem[] {
        if (!this.book) return [];
        return this.convertToc(this.book.navigation?.toc || []);
    }

    // Layout - Enhanced with 'auto' support
    setLayout(layout: PageLayout): void {
        if (!this.rendition || this.currentLayout === layout) {
            this.currentLayout = layout;
            return;
        }

        this.currentLayout = layout;

        // Resolve actual layout
        const actualLayout = this.resolveLayout(layout, this.currentZoom);
        const spreadMode = actualLayout === 'double' ? 'always' : 'none';
        const minSpreadWidth = actualLayout === 'double' ? 400 : 800;

        // Update settings
        this.rendition.settings.spread = spreadMode;
        this.rendition.settings.minSpreadWidth = minSpreadWidth;

        // Save current location
        const currentLocation = this.rendition.currentLocation();

        // Clear and restart with new layout
        this.rendition.clear();

        // Re-apply hooks for zoom/margins
        if (this.rendition.hooks?.content) {
            this.rendition.hooks.content.register((contents: any) => {
                try {
                    const zoomFactor = this.currentZoom / 100;
                    this.applyZoomToContent(contents, zoomFactor);
                    const marginPx = (this.currentMargins / 100) * Math.min(
                        this.container?.getBoundingClientRect().width || 800,
                        this.container?.getBoundingClientRect().height || 600
                    );
                    this.applyMarginsToContent(contents, marginPx);
                } catch (e) {
                    // Ignore
                }
            });
        }

        this.rendition.start(currentLocation);
    }

    getLayout(): PageLayout {
        return this.currentLayout;
    }

    // Flow setting
    setFlow(flow: ReadingFlow): void {
        if (!this.rendition || this.currentFlow === flow) {
            this.currentFlow = flow;
            return;
        }

        this.currentFlow = flow;

        // Flow change requires re-rendering
        const currentLocation = this.rendition.currentLocation();
        this.rendition.settings.flow = flow === 'scroll' ? 'scrolled-doc' : 'paginated';
        this.rendition.settings.snap = flow !== 'scroll';

        this.rendition.clear();
        this.rendition.start(currentLocation);
    }

    // Zoom setting
    setZoom(zoom: number): void {
        if (this.currentZoom === zoom) return;

        this.currentZoom = zoom;

        if (!this.rendition || !this.container) return;

        const { width, height } = this.container.getBoundingClientRect();
        const zoomFactor = zoom / 100;

        // Resize the rendition with new zoom
        this.rendition.resize(width / zoomFactor, height / zoomFactor);

        // Apply zoom to current content
        const contents = this.rendition.getContents?.()[0];
        if (contents) {
            this.applyZoomToContent(contents, zoomFactor);
        }

        // Check if auto layout needs to change due to zoom
        if (this.currentLayout === 'auto') {
            const newLayout = this.resolveLayout('auto', zoom);
            const currentActualLayout = this.resolveLayout('auto', this.currentZoom);
            if (newLayout !== currentActualLayout) {
                this.setLayout('auto');
            }
        }
    }

    // Margins setting
    setMargins(margins: number): void {
        if (this.currentMargins === margins) return;

        this.currentMargins = margins;

        // Apply margins to current content
        if (this.rendition) {
            const contents = this.rendition.getContents?.()[0];
            if (contents && this.container) {
                const { width, height } = this.container.getBoundingClientRect();
                const marginPx = (margins / 100) * Math.min(width, height);
                this.applyMarginsToContent(contents, marginPx);
            }
        }
    }

    // Search (requires accurate locations)
    async *search(query: string): AsyncGenerator<SearchResult | { progress: number } | 'done'> {
        if (!this.book) return;

        // For search, we need accurate locations - generate them if needed
        if (!this.locationsGenerated && this.book.locations) {
            console.log('[EpubjsEngine] Generating locations for search...');
            await this.book.locations.generate(1500);
            this.locationsGenerated = true;
        }

        try {
            const results = await this.book.search(query);
            for (const result of results) {
                yield { cfi: result.cfi, excerpt: result.excerpt };
            }
        } catch (e) {
            console.warn('[EpubjsEngine] Search failed:', e);
        }
        yield 'done';
    }

    // Annotations
    async addHighlight(cfi: string, text: string, color: HighlightColor): Promise<Annotation> {
        if (!this.rendition) {
            throw new Error('Rendition not ready');
        }

        this.rendition.annotations.highlight(cfi, {}, () => { }, 'highlight', { fill: color });

        return {
            id: crypto.randomUUID(),
            bookId: '',
            type: 'highlight',
            location: cfi,
            selectedText: text,
            color,
            createdAt: new Date(),
        };
    }

    async removeHighlight(id: string): Promise<void> {
        this.rendition?.annotations.remove(id, 'highlight');
    }

    // Section fractions for progress bar - byte based
    getSectionFractions(): number[] {
        if (!this.book?.spine?.items) return [];

        const items = this.book.spine.items;
        if (this.totalBytes > 0) {
            // Use byte-based fractions
            return this.cumulativeSizes.slice(0, -1).map(size => size / this.totalBytes);
        }
        // Fallback: equal fractions
        return items.map((_: any, i: number) => i / items.length);
    }

    // Navigation methods - SIMPLIFIED and ACCURATE
    async goToFraction(fraction: number): Promise<void> {
        console.log(`[EpubjsEngine] goToFraction called with ${fraction}`);

        if (!this.rendition || !this.book) {
            console.warn('[EpubjsEngine] Cannot navigate - rendition or book not available');
            return;
        }

        const validFraction = Math.max(0, Math.min(1, fraction));

        // Handle edge case: go to end of book
        if (validFraction >= 0.995) {
            const lastIndex = this.book.spine?.items?.length - 1;
            if (lastIndex >= 0) {
                const lastSection = this.book.spine.get(lastIndex);
                if (lastSection?.cfi) {
                    console.log(`[EpubjsEngine] Navigating to end of book at section ${lastIndex}`);
                    await this.rendition.display(lastSection.cfi);
                }
            }
            return;
        }

        // Convert fraction to section using byte-based calculation
        const [sectionIndex, sectionFraction] = this.getSectionFromFraction(validFraction);
        const section = this.book.spine.get(sectionIndex);

        const targetBytes = Math.floor(validFraction * this.totalBytes);
        console.log(`[EpubjsEngine] Navigation:`, {
            fraction: validFraction,
            targetBytes,
            totalBytes: this.totalBytes,
            sectionIndex,
            sectionFraction: sectionFraction.toFixed(3),
            sectionHref: section?.href,
            sectionCfi: section?.cfi?.substring(0, 50)
        });

        if (!section) {
            console.warn('[EpubjsEngine] Section not found for index:', sectionIndex);
            return;
        }

        // Navigate using section CFI for most reliable results
        if (section.cfi) {
            try {
                // For section start, just use the CFI directly
                if (sectionFraction < 0.01) {
                    console.log(`[EpubjsEngine] Navigating to section start: ${section.cfi.substring(0, 50)}`);
                    await this.rendition.display(section.cfi);
                    return;
                }

                // For within-section navigation, try to create an offset CFI
                // First navigate to section to load it
                await this.rendition.display(section.cfi);
                
                // Then try to advance within the section
                if (sectionFraction > 0.05) {
                    // Wait for content to load
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                    // Try to calculate a more precise CFI
                    try {
                        const preciseCfi = await this.calculatePreciseCfi(section, sectionFraction);
                        if (preciseCfi && preciseCfi !== section.cfi) {
                            console.log(`[EpubjsEngine] Using precise CFI`);
                            await this.rendition.display(preciseCfi);
                            return;
                        }
                    } catch (e) {
                        // Ignore precision errors, we already loaded the section
                    }
                }
                
                console.log(`[EpubjsEngine] Navigated to section`);
                return;
            } catch (err) {
                console.warn('[EpubjsEngine] CFI navigation failed:', err);
            }
        }

        // Fallback to href
        if (section.href) {
            console.log(`[EpubjsEngine] Falling back to href: ${section.href}`);
            await this.rendition.display(section.href);
            return;
        }

        // Last resort: use idref
        if (section.idref) {
            console.log(`[EpubjsEngine] Navigating using idref: ${section.idref}`);
            await this.rendition.display(section.idref);
            return;
        }

        console.warn(`[EpubjsEngine] Section ${sectionIndex} has no navigable property`);
    }

    /**
     * Calculate a more precise CFI within a section using EPUB.js APIs
     */
    private async calculatePreciseCfi(section: any, fraction: number): Promise<string | null> {
        try {
            // Render the section temporarily to access its content
            const doc = section.document;
            if (!doc) return null;

            // Get all text nodes
            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
            const textNodes: Text[] = [];
            let node: Node | null;
            while ((node = walker.nextNode())) {
                if (node.textContent && node.textContent.trim().length > 0) {
                    textNodes.push(node as Text);
                }
            }

            if (textNodes.length === 0) return null;

            // Calculate target character position
            const totalText = textNodes.reduce((sum, node) => sum + node.textContent!.length, 0);
            const targetChar = Math.floor(fraction * totalText);

            // Find the text node containing the target character
            let charCount = 0;
            for (const textNode of textNodes) {
                const nodeLength = textNode.textContent!.length;
                if (charCount + nodeLength >= targetChar) {
                    const offset = targetChar - charCount;
                    // Use section's CFI generation if available
                    if (section.cfiFromElement) {
                        return section.cfiFromElement(textNode, { offset });
                    }
                    break;
                }
                charCount += nodeLength;
            }

            return null;
        } catch (err) {
            console.warn('[EpubjsEngine] calculatePreciseCfi failed:', err);
            return null;
        }
    }

    /**
     * Find section index and fraction within section from overall fraction
     * Uses byte-based calculation for accurate navigation
     * Returns [spineIndex, fractionWithinSection]
     */
    private getSectionFromFraction(fraction: number): [number, number] {
        if (this.totalBytes === 0 || this.cumulativeSizes.length <= 1) {
            // Fallback to spine-based
            const totalSections = this.book?.spine?.items?.length || 1;
            const sectionIndex = Math.min(totalSections - 1, Math.floor(fraction * totalSections));
            const sectionFraction = (fraction * totalSections) - sectionIndex;
            return [sectionIndex, Math.max(0, Math.min(1, sectionFraction))];
        }

        const targetBytes = fraction * this.totalBytes;

        // Binary search to find the section containing this byte position
        let left = 0;
        let right = this.cumulativeSizes.length - 1;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.cumulativeSizes[mid] <= targetBytes) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        const linearIndex = Math.max(0, left - 1);
        const spineIndex = this.linearSectionIndices[linearIndex] ?? 0;
        const bytesBefore = this.cumulativeSizes[linearIndex];
        const sectionSize = this.cumulativeSizes[linearIndex + 1] - bytesBefore;
        const sectionFraction = sectionSize > 0
            ? (targetBytes - bytesBefore) / sectionSize
            : 0;

        return [spineIndex, Math.max(0, Math.min(1, sectionFraction))];
    }

    async goLeft(): Promise<void> {
        const dir = this.book?.packaging?.metadata?.direction;
        if (dir === 'rtl') {
            await this.next();
        } else {
            await this.prev();
        }
    }

    async goRight(): Promise<void> {
        const dir = this.book?.packaging?.metadata?.direction;
        if (dir === 'rtl') {
            await this.prev();
        } else {
            await this.next();
        }
    }

    goBack(): void {
        // Not implemented in EPUB.js
    }

    goForward(): void {
        // Not implemented in EPUB.js
    }

    canGoBack(): boolean {
        return false;
    }

    canGoForward(): boolean {
        return false;
    }

    // Annotations
    getAnnotations(): Annotation[] {
        return []; // EPUB.js manages internally
    }

    clearSearch(): void {
        // EPUB.js handles this automatically
    }

    // Status
    isCalculatingPages(): boolean {
        return false; // Byte-based is instant
    }

    getPageEstimationStatus(): 'accurate' | 'estimated' | 'unknown' {
        if (this.locationsGenerated) return 'accurate';
        if (this.totalBytes > 0) return 'estimated';
        return 'unknown';
    }

    // Cleanup
    destroy(): void {
        if (this.themeUpdateTimeout) {
            clearTimeout(this.themeUpdateTimeout);
            this.themeUpdateTimeout = null;
        }

        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
            this.resizeHandler = null;
        }

        // Disconnect MutationObserver
        const observer = (this as any)._sandboxObserver;
        if (observer) {
            observer.disconnect();
            (this as any)._sandboxObserver = null;
        }

        if (this.rendition) {
            this.rendition.destroy();
            this.rendition = null;
        }

        if (this.book) {
            this.book.destroy();
            this.book = null;
        }

        // Reset state
        this.locationsGenerated = false;
        this.currentThemeSettings = null;
        this.isInitialized = false;
        this.totalPageCount = 0;

        // Reset byte-based pagination
        this.sectionSizes.clear();
        this.cumulativeSizes = [0];
        this.linearSectionIndices = [];
        this.totalBytes = 0;

        // Reset settings
        this.currentLayout = 'auto';
        this.currentFlow = 'paged';
        this.currentZoom = 100;
        this.currentMargins = 10;
    }

    getView(): any {
        return this.rendition;
    }

    getIsInitialized(): boolean {
        return this.isInitialized;
    }
}

export default EpubjsEngine;
