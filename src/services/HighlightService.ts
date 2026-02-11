/**
 * Highlight Service
 * Manages highlight CRUD operations and SVG overlay rendering
 * Ported and adapted from foliate-js/overlayer.js
 */

import { HIGHLIGHT_COLORS, HIGHLIGHT_COLORS_DARK } from "@/lib/design-tokens";
import type { Annotation, HighlightColor } from "@/types";

export interface HighlightRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface HighlightRenderOptions {
    color: HighlightColor;
    isDarkTheme?: boolean;
}

/**
 * SVG Overlayer implementation for rendering highlights
 * Mirrors foliate-js/overlayer.js functionality
 */
export class SVGOverlayer {
    private svg: SVGSVGElement;
    private highlights: Map<string, {
        range: Range;
        color: HighlightColor;
        element: SVGGElement;
        rects: DOMRectList;
    }> = new Map();

    constructor() {
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        Object.assign(this.svg.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: '10',
        });
    }

    get element(): SVGSVGElement {
        return this.svg;
    }

    /**
     * Add a highlight to the overlay
     */
    add(key: string, range: Range, color: HighlightColor, isDarkTheme = false): void {
        // Remove existing highlight with same key
        this.remove(key);

        const rects = range.getClientRects();
        const element = this.drawHighlight(rects, { color, isDarkTheme });
        
        this.svg.appendChild(element);
        this.highlights.set(key, { range, color, element, rects });
    }

    /**
     * Remove a highlight by key
     */
    remove(key: string): void {
        const highlight = this.highlights.get(key);
        if (!highlight) return;

        this.svg.removeChild(highlight.element);
        this.highlights.delete(key);
    }

    /**
     * Check if a highlight exists
     */
    has(key: string): boolean {
        return this.highlights.has(key);
    }

    /**
     * Get all highlight keys
     */
    getKeys(): string[] {
        return Array.from(this.highlights.keys());
    }

    /**
     * Clear all highlights
     */
    clear(): void {
        this.highlights.clear();
        while (this.svg.firstChild) {
            this.svg.removeChild(this.svg.firstChild);
        }
    }

    /**
     * Redraw all highlights (call on resize/layout change)
     */
    redraw(isDarkTheme = false): void {
        for (const [key, obj] of this.highlights) {
            const { range, color, element } = obj;
            this.svg.removeChild(element);
            
            const rects = range.getClientRects();
            const newElement = this.drawHighlight(rects, { color, isDarkTheme });
            this.svg.appendChild(newElement);
            
            this.highlights.set(key, { range, color, element: newElement, rects });
        }
    }

    /**
     * Hit test to find highlight at coordinates
     * Returns [key, range] or null
     */
    hitTest(x: number, y: number): { key: string; range: Range } | null {
        // Loop in reverse to hit more recently added items first
        const entries = Array.from(this.highlights.entries()).reverse();
        
        for (const [key, obj] of entries) {
            for (const rect of obj.rects) {
                if (rect.top <= y && rect.left <= x && rect.bottom > y && rect.right > x) {
                    return { key, range: obj.range };
                }
            }
        }
        return null;
    }

    /**
     * Draw highlight rectangles
     */
    private drawHighlight(rects: DOMRectList, options: HighlightRenderOptions): SVGGElement {
        const { color, isDarkTheme } = options;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        
        const fillColor = isDarkTheme ? HIGHLIGHT_COLORS_DARK[color] : HIGHLIGHT_COLORS[color];
        g.setAttribute('fill', fillColor);
        g.style.mixBlendMode = 'multiply';

        // Convert client rects to SVG coordinates relative to the SVG container
        const svgRect = this.svg.getBoundingClientRect();

        for (const rect of rects) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            el.setAttribute('x', String(rect.left - svgRect.left));
            el.setAttribute('y', String(rect.top - svgRect.top));
            el.setAttribute('width', String(rect.width));
            el.setAttribute('height', String(rect.height));
            el.setAttribute('rx', '2');
            g.appendChild(el);
        }

        return g;
    }

    /**
     * Draw underline style
     */
    drawUnderline(rects: DOMRectList, color: string, width = 2): SVGGElement {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('fill', color);

        const svgRect = this.svg.getBoundingClientRect();

        for (const rect of rects) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            el.setAttribute('x', String(rect.left - svgRect.left));
            el.setAttribute('y', String(rect.bottom - svgRect.top - width));
            el.setAttribute('width', String(rect.width));
            el.setAttribute('height', String(width));
            g.appendChild(el);
        }

        return g;
    }

    /**
     * Destroy the overlayer
     */
    destroy(): void {
        this.clear();
        this.svg.remove();
    }
}

/**
 * Highlight Service for managing highlights across the app
 */
export class HighlightService {
    private overlayers: Map<number, SVGOverlayer> = new Map();
    private container: HTMLElement | null = null;

    constructor(container?: HTMLElement) {
        if (container) {
            this.container = container;
        }
    }

    /**
     * Set or update the container element
     */
    setContainer(container: HTMLElement): void {
        this.container = container;
    }

    /**
     * Get or create overlayer for a section
     */
    getOverlayer(sectionIndex: number, doc: Document): SVGOverlayer {
        let overlayer = this.overlayers.get(sectionIndex);
        
        if (!overlayer) {
            overlayer = new SVGOverlayer();
            this.overlayers.set(sectionIndex, overlayer);

            // Append to document body for proper positioning
            // The SVG will overlay the content using absolute positioning
            const docBody = doc.body;
            if (docBody) {
                docBody.style.position = 'relative';
                docBody.appendChild(overlayer.element);
            }
        }

        return overlayer;
    }

    /**
     * Add a highlight to a specific section
     */
    addHighlight(
        sectionIndex: number,
        doc: Document,
        key: string,
        range: Range,
        color: HighlightColor,
        isDarkTheme = false
    ): void {
        const overlayer = this.getOverlayer(sectionIndex, doc);
        overlayer.add(key, range, color, isDarkTheme);
    }

    /**
     * Remove a highlight from a section
     */
    removeHighlight(sectionIndex: number, key: string): void {
        const overlayer = this.overlayers.get(sectionIndex);
        if (overlayer) {
            overlayer.remove(key);
        }
    }

    /**
     * Remove all highlights from a section
     */
    clearSection(sectionIndex: number): void {
        const overlayer = this.overlayers.get(sectionIndex);
        if (overlayer) {
            overlayer.clear();
        }
    }

    /**
     * Clear all highlights
     */
    clearAll(): void {
        for (const overlayer of this.overlayers.values()) {
            overlayer.destroy();
        }
        this.overlayers.clear();
    }

    /**
     * Redraw all highlights (call after resize or layout change)
     */
    redrawAll(isDarkTheme = false): void {
        for (const overlayer of this.overlayers.values()) {
            overlayer.redraw(isDarkTheme);
        }
    }

    /**
     * Hit test across all sections
     */
    hitTest(sectionIndex: number, x: number, y: number): { key: string; range: Range } | null {
        const overlayer = this.overlayers.get(sectionIndex);
        if (overlayer) {
            return overlayer.hitTest(x, y);
        }
        return null;
    }

    /**
     * Destroy the service and clean up
     */
    destroy(): void {
        this.clearAll();
        this.container = null;
    }
}

// Export singleton instance
export const highlightService = new HighlightService();

// Export color utilities
export { HIGHLIGHT_COLORS, HIGHLIGHT_COLORS_DARK };

export default HighlightService;
