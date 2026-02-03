/**
 * Virtual Scroller - Efficient viewport tracking for PDF pages
 * 
 * Based on Mozilla PDF.js techniques:
 * - Binary search for O(log n) visible page detection (instead of IntersectionObserver)
 * - RAF-debounced scroll handling with velocity tracking
 * - Smart buffer calculation based on visible pages
 * - Backtracking algorithm for complex layouts (spreads/wrapped)
 * - Defensive programming against Infinity/NaN values
 */

import type { VirtualScrollConfig } from "./types";
import { DEFAULT_VIRTUAL_SCROLL_CONFIG } from "./types";

export interface ViewportState {
    visiblePages: Set<number>;
    bufferPages: Set<number>;
    allVisible: Set<number>; // visible + buffer
    firstVisible: number;
    lastVisible: number;
    scrollTop: number;
    scrollDirection: "up" | "down" | "none";
    scrollVelocity: number;
}

export type ViewportChangeHandler = (state: ViewportState) => void;

export interface PageView {
    id: number;
    div: HTMLElement;
}

/**
 * Binary search to find the first item that passes the condition.
 * Items must be sorted such that if condition is true for one item,
 * it's true for all following items.
 */
function binarySearchFirstItem<T>(
    items: T[],
    condition: (item: T) => boolean,
    start = 0
): number {
    let minIndex = start;
    let maxIndex = items.length - 1;

    if (maxIndex < 0 || !condition(items[maxIndex])) {
        return items.length;
    }
    if (condition(items[minIndex])) {
        return minIndex;
    }

    while (minIndex < maxIndex) {
        const currentIndex = (minIndex + maxIndex) >> 1;
        const currentItem = items[currentIndex];
        if (condition(currentItem)) {
            maxIndex = currentIndex;
        } else {
            minIndex = currentIndex + 1;
        }
    }
    return minIndex;
}

/**
 * Backtrack to find the first visible element in a row.
 * Handles complex layouts like spreads or wrapped scrolling where
 * binary search might return an element in the middle of a visible row.
 */
function backtrackBeforeAllVisibleElements(
    index: number,
    views: PageView[],
    top: number
): number {
    // If at the start, nothing to backtrack
    if (index < 2) {
        return index;
    }

    // Get the top of the current page
    let elt = views[index].div;
    let pageTop = elt.offsetTop + elt.clientTop;

    if (pageTop >= top) {
        // The found page is fully visible, might need to check previous row
        elt = views[index - 1].div;
        pageTop = elt.offsetTop + elt.clientTop;
    }

    // Backtrack to find the first page in this row
    for (let i = index - 2; i >= 0; i--) {
        elt = views[i].div;
        if (elt.offsetTop + elt.clientTop + elt.clientHeight <= pageTop) {
            // We've reached the previous row
            break;
        }
        index = i;
    }
    return index;
}

interface VisibleElement {
    id: number;
    x: number;
    y: number;
    view: PageView;
    percent: number;
}

interface VisibleElementsResult {
    first: VisibleElement | undefined;
    last: VisibleElement | undefined;
    views: VisibleElement[];
    ids: Set<number>;
}

/**
 * Get visible elements within a scroll container.
 * Based on PDF.js's getVisibleElements function.
 */
function getVisibleElements(
    scrollEl: HTMLElement,
    views: PageView[],
    horizontal = false
): VisibleElementsResult {
    // Guard against invalid inputs
    if (!scrollEl || !views || views.length === 0) {
        return { first: undefined, last: undefined, views: [], ids: new Set() };
    }

    const top = scrollEl.scrollTop;
    const bottom = top + scrollEl.clientHeight;
    const left = scrollEl.scrollLeft;
    const right = left + scrollEl.clientWidth;

    // Check for invalid scroll values (Infinity, NaN)
    if (!isFinite(top) || !isFinite(bottom) || !isFinite(left) || !isFinite(right)) {
        console.warn("[VirtualScroller] Invalid scroll values detected");
        return { first: undefined, last: undefined, views: [], ids: new Set() };
    }

    function isElementBottomAfterViewTop(view: PageView): boolean {
        const element = view.div;
        const elementBottom = element.offsetTop + element.clientTop + element.clientHeight;
        return elementBottom > top;
    }

    function isElementRightAfterViewLeft(view: PageView): boolean {
        const element = view.div;
        const elementRight = element.offsetLeft + element.clientLeft + element.clientWidth;
        return elementRight > left;
    }

    const visible: VisibleElement[] = [];
    const ids = new Set<number>();
    const numViews = views.length;

    // Find first potentially visible element using binary search
    let firstVisibleElementInd = binarySearchFirstItem(
        views,
        horizontal ? isElementRightAfterViewLeft : isElementBottomAfterViewTop
    );

    // Handle edge cases with complex layouts
    if (
        firstVisibleElementInd > 0 &&
        firstVisibleElementInd < numViews &&
        !horizontal
    ) {
        firstVisibleElementInd = backtrackBeforeAllVisibleElements(
            firstVisibleElementInd,
            views,
            top
        );
    }

    // Determine when to stop iterating
    let lastEdge = horizontal ? right : -1;

    // Iterate through potentially visible elements
    for (let i = firstVisibleElementInd; i < numViews; i++) {
        const view = views[i];
        const element = view.div;

        const currentWidth = element.offsetLeft + element.clientLeft;
        const currentHeight = element.offsetTop + element.clientTop;
        const viewWidth = element.clientWidth;
        const viewHeight = element.clientHeight;
        const viewRight = currentWidth + viewWidth;
        const viewBottom = currentHeight + viewHeight;

        // Set lastEdge on first visible element to detect row changes
        if (lastEdge === -1) {
            if (viewBottom >= bottom) {
                lastEdge = viewBottom;
            }
        } else if ((horizontal ? currentWidth : currentHeight) > lastEdge) {
            // We've passed the last visible row
            break;
        }

        // Skip if element is completely outside viewport
        if (
            viewBottom <= top ||
            currentHeight >= bottom ||
            viewRight <= left ||
            currentWidth >= right
        ) {
            continue;
        }

        // Calculate visible percentage
        const minY = Math.max(0, top - currentHeight);
        const minX = Math.max(0, left - currentWidth);
        const hiddenHeight = minY + Math.max(0, viewBottom - bottom);
        const hiddenWidth = minX + Math.max(0, viewRight - right);
        const fractionHeight = (viewHeight - hiddenHeight) / viewHeight;
        const fractionWidth = (viewWidth - hiddenWidth) / viewWidth;
        const percent = (fractionHeight * fractionWidth * 100) | 0;

        visible.push({
            id: view.id,
            x: currentWidth,
            y: currentHeight,
            view,
            percent,
        });
        ids.add(view.id);
    }

    // Sort by visibility percentage (descending) for priority rendering
    visible.sort((a, b) => {
        const pc = a.percent - b.percent;
        if (Math.abs(pc) > 0.001) {
            return -pc; // Higher percentage first
        }
        return a.id - b.id; // Stable sort by id
    });

    return {
        first: visible[0],
        last: visible[visible.length - 1],
        views: visible,
        ids,
    };
}

export class VirtualScroller {
    private container: HTMLElement;
    private config: VirtualScrollConfig;
    private pageElements: Map<number, HTMLElement> = new Map();
    private views: PageView[] = [];
    private visibleIds: Set<number> = new Set();
    private totalPages = 0;

    // Scroll tracking
    private lastScrollTop = 0;
    private lastScrollLeft = 0;
    private lastScrollTime = Date.now();
    private scrollVelocity = 0;
    private scrollDirection: "up" | "down" | "none" = "none";
    private scrollState: { right: boolean; down: boolean } = { right: true, down: true };

    // RAF handling
    private rafId: number | null = null;
    private scrollTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private updateTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private isUpdating = false;

    // Callback
    private onChange: ViewportChangeHandler;

    constructor(
        container: HTMLElement,
        onChange: ViewportChangeHandler,
        config: Partial<VirtualScrollConfig> = {}
    ) {
        this.container = container;
        this.onChange = onChange;
        this.config = { ...DEFAULT_VIRTUAL_SCROLL_CONFIG, ...config };

        this.setupScrollHandler();
    }

    /**
     * Register a page element for viewport tracking
     */
    registerPage(pageNumber: number, element: HTMLElement): void {
        this.pageElements.set(pageNumber, element);
        
        // Update views array maintaining order
        const existingIndex = this.views.findIndex(v => v.id === pageNumber);
        if (existingIndex >= 0) {
            this.views[existingIndex] = { id: pageNumber, div: element };
        } else {
            // Insert in order
            const insertIndex = this.views.findIndex(v => v.id > pageNumber);
            if (insertIndex >= 0) {
                this.views.splice(insertIndex, 0, { id: pageNumber, div: element });
            } else {
                this.views.push({ id: pageNumber, div: element });
            }
        }
    }

    /**
     * Unregister a page element
     */
    unregisterPage(pageNumber: number): void {
        this.pageElements.delete(pageNumber);
        const index = this.views.findIndex(v => v.id === pageNumber);
        if (index >= 0) {
            this.views.splice(index, 1);
        }
        this.visibleIds.delete(pageNumber);
    }

    /**
     * Update total pages (affects buffer calculation)
     */
    setTotalPages(total: number): void {
        // Guard against invalid values
        if (!isFinite(total) || total < 0) {
            console.warn("[VirtualScroller] Invalid total pages:", total);
            return;
        }
        this.totalPages = Math.max(0, Math.floor(total));
    }

    /**
     * Get current viewport state
     */
    getState(): ViewportState {
        const bufferPages = this.calculateBufferPages();
        const allVisible = new Set([...this.visibleIds, ...bufferPages]);

        // Calculate first and last visible with bounds checking
        let firstVisible = 1;
        let lastVisible = 1;
        
        if (this.visibleIds.size > 0) {
            const visibleArray = Array.from(this.visibleIds);
            firstVisible = Math.min(...visibleArray);
            lastVisible = Math.max(...visibleArray);
        } else {
            firstVisible = 1;
            lastVisible = 1;
        }

        // Clamp to valid range
        firstVisible = Math.max(1, Math.min(this.totalPages || 1, firstVisible));
        lastVisible = Math.max(1, Math.min(this.totalPages || 1, lastVisible));

        return {
            visiblePages: new Set(this.visibleIds),
            bufferPages,
            allVisible,
            firstVisible,
            lastVisible,
            scrollTop: this.container.scrollTop || 0,
            scrollDirection: this.scrollDirection,
            scrollVelocity: this.scrollVelocity,
        };
    }

    /**
     * Force an immediate update
     */
    forceUpdate(): void {
        this.handleScrollUpdate();
    }

    /**
     * Destroy the scroller
     */
    destroy(): void {
        // Cancel all pending operations
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.scrollTimeoutId) {
            clearTimeout(this.scrollTimeoutId);
            this.scrollTimeoutId = null;
        }
        if (this.updateTimeoutId) {
            clearTimeout(this.updateTimeoutId);
            this.updateTimeoutId = null;
        }

        this.pageElements.clear();
        this.views = [];
        this.visibleIds.clear();
    }

    /**
     * Scroll to a specific page
     */
    scrollToPage(pageNumber: number, behavior: ScrollBehavior = "smooth"): void {
        // Guard against invalid page numbers
        if (!isFinite(pageNumber) || pageNumber < 1) {
            pageNumber = 1;
        }
        if (this.totalPages > 0 && pageNumber > this.totalPages) {
            pageNumber = this.totalPages;
        }

        const element = this.pageElements.get(pageNumber);
        if (element) {
            element.scrollIntoView({ behavior, block: "start" });
        }
    }

    /**
     * Get the page number at a specific scroll position
     */
    getPageAtPosition(y: number): number {
        // Guard against invalid inputs
        if (!isFinite(y)) {
            return 1;
        }

        for (const [pageNumber, element] of this.pageElements) {
            const rect = element.getBoundingClientRect();
            const containerRect = this.container.getBoundingClientRect();
            const relativeTop = rect.top - containerRect.top + this.container.scrollTop;
            const relativeBottom = relativeTop + rect.height;

            if (y >= relativeTop && y < relativeBottom) {
                return pageNumber;
            }
        }
        
        // Return first visible or 1
        if (this.visibleIds.size > 0) {
            const visibleArray = Array.from(this.visibleIds);
            if (visibleArray.length > 0) {
                return Math.min(...visibleArray);
            }
        }
        return 1;
    }

    private setupScrollHandler(): void {
        // Store reference to bound handler for removal
        this.handleScrollEvent = this.handleScrollEvent.bind(this);

        this.container.addEventListener(
            "scroll",
            this.handleScrollEvent,
            { passive: true, capture: true }
        );
    }

    private handleScrollEvent(): void {
        // Debounce with RAF - skip if already scheduled
        if (this.rafId !== null) {
            return;
        }

        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.trackScrollDirection();
            this.handleScrollUpdate();
        });
    }

    private trackScrollDirection(): void {
        const currentX = this.container.scrollLeft;
        const currentY = this.container.scrollTop;

        // Update direction flags
        if (currentX !== this.lastScrollLeft) {
            this.scrollState.right = currentX > this.lastScrollLeft;
        }
        this.lastScrollLeft = currentX;

        if (currentY !== this.lastScrollTop) {
            this.scrollState.down = currentY > this.lastScrollTop;
        }

        // Calculate velocity
        const now = Date.now();
        const dt = now - this.lastScrollTime;
        if (dt > 0) {
            const dy = currentY - this.lastScrollTop;
            this.scrollVelocity = Math.abs(dy / dt); // pixels per ms
            this.scrollDirection = dy > 0 ? "down" : dy < 0 ? "up" : "none";
        }

        this.lastScrollTop = currentY;
        this.lastScrollTime = now;
    }

    private handleScrollUpdate(): void {
        if (this.totalPages === 0 || this.views.length === 0) {
            return;
        }

        // Clear any pending update timeout
        if (this.scrollTimeoutId) {
            clearTimeout(this.scrollTimeoutId);
        }

        // Immediate update for responsiveness
        this.update();

        // Schedule follow-up update after scroll settles (PDF.js uses 100ms)
        this.scrollTimeoutId = setTimeout(() => {
            this.scrollTimeoutId = null;
            this.update();
        }, 100);
    }

    private update(): void {
        if (this.isUpdating) {
            // Schedule update for next frame if one is in progress
            if (this.updateTimeoutId) {
                clearTimeout(this.updateTimeoutId);
            }
            this.updateTimeoutId = setTimeout(() => this.update(), 16);
            return;
        }

        this.isUpdating = true;

        try {
            // Get visible elements using efficient algorithm
            const visible = getVisibleElements(this.container, this.views, false);
            
            // Update visible IDs
            this.visibleIds = visible.ids;

            // Notify callback
            this.onChange(this.getState());
        } catch (error) {
            console.error("[VirtualScroller] Update error:", error);
        } finally {
            this.isUpdating = false;
        }
    }

    private calculateBufferPages(): Set<number> {
        const buffer = new Set<number>();

        if (this.totalPages === 0) {
            return buffer;
        }

        // Adjust buffer size based on scroll velocity
        let { ahead, behind } = this.config.buffer;

        // Guard against invalid velocity
        const velocity = isFinite(this.scrollVelocity) ? this.scrollVelocity : 0;

        if (velocity > 2) {
            // Fast scroll - minimal buffer to save resources
            ahead = 1;
            behind = 0;
        } else if (velocity < 0.5) {
            // Slow scroll/idle - larger buffer for smoother experience
            ahead = Math.min(3, this.totalPages);
            behind = Math.min(2, this.totalPages);
        }

        // Add buffer pages based on scroll direction
        const visibleArray = Array.from(this.visibleIds);
        
        for (const visiblePage of visibleArray) {
            // Pages ahead (in scroll direction)
            const pagesAhead = this.scrollDirection === "down" ? ahead : Math.max(1, ahead - 1);
            for (let i = 1; i <= pagesAhead; i++) {
                const page = visiblePage + i;
                if (page >= 1 && page <= this.totalPages) {
                    buffer.add(page);
                }
            }

            // Pages behind
            const pagesBehind = this.scrollDirection === "up" ? behind : Math.max(1, behind - 1);
            for (let i = 1; i <= pagesBehind; i++) {
                const page = visiblePage - i;
                if (page >= 1 && page <= this.totalPages) {
                    buffer.add(page);
                }
            }
        }

        return buffer;
    }
}
