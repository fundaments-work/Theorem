/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Reader - Core reader implementation
 * Ported from foliate/src/reader/reader.js
 * Adapted for React web app (removed WebKit/GTK specific code)
 */

import { getTheme, type Theme } from "./themes";

interface ReaderStyle {
    spacing: number;
    justify: boolean;
    hyphenate: boolean;
    invert: boolean;
    theme: Theme;
    overrideFont?: boolean;
    userStylesheet?: string;
    mediaActiveClass?: string;
}

interface LayoutSettings {
    flow: 'paginated' | 'scrolled';
    animated: boolean;
    gap: number;
    maxInlineSize: number;
    maxBlockSize: number;
    maxColumnCount: number;
}

export interface ReaderCallbacks {
    onRelocate?: (detail: any) => void;
    onLoad?: (detail: any) => void;
    onCreateOverlay?: (detail: any) => void;
    onShowAnnotation?: (detail: any) => void;
    onDrawAnnotation?: (detail: any) => void;
    onExternalLink?: (detail: any) => void;
    onLink?: (detail: any) => void;
    onHistoryChange?: (detail: any) => void;
    onPinchZoom?: (scale: number) => void;
}

export class Reader {
    view: any;
    book: any;
    style: ReaderStyle;
    callbacks: ReaderCallbacks;
    sectionFractions: number[] = [];
    private pageTotal?: string;

    constructor(book: any, callbacks: ReaderCallbacks = {}) {
        this.book = book;
        this.callbacks = callbacks;
        
        // Get page total from page list if available
        this.pageTotal = book.pageList?.findLast((x: any) => !isNaN(parseInt(x.label)))?.label;
        
        this.style = {
            spacing: 1.4,
            justify: true,
            hyphenate: true,
            invert: false,
            theme: getTheme("light"),
        };
    }

    async init() {
        // Create foliate-view element
        this.view = document.createElement('foliate-view');
        this.handleEvents();
        await this.view.open(this.book);
        
        // Calculate section fractions for progress
        this.sectionFractions = this.view.getSectionFractions();
    }

    private handleEvents() {
        // Relocate event - location changed
        this.view.addEventListener('relocate', (e: any) => {
            const { heads, feet } = this.view.renderer;
            const detail = e.detail;
            
            // Update running heads
            if (heads) {
                const { tocItem } = detail;
                heads.at(-1).innerText = tocItem?.label ?? '';
                if (heads.length > 1) {
                    heads[0].innerText = this.formatLanguageMap(this.book.metadata?.title);
                }
            }
            
            // Update running feet (page numbers)
            if (feet) {
                const { pageItem, location } = detail;
                if (pageItem) {
                    feet.at(-1).innerText = this.formatPage(pageItem.label, this.pageTotal);
                    if (feet.length > 1) {
                        feet[0].innerText = this.formatLocation(location.current + 1, location.total);
                    }
                } else {
                    feet[0].innerText = this.formatLocation(location.current + 1, location.total);
                    if (feet.length > 1) {
                        const r = 1 - 1 / feet.length;
                        const end = Math.floor((1 - r) * location.current + r * location.next);
                        feet.at(-1).innerText = this.formatLocation(end + 1, location.total);
                    }
                }
            }
            
            this.callbacks.onRelocate?.(detail);
        });

        // Load event - section loaded
        this.view.addEventListener('load', (e: any) => {
            this.callbacks.onLoad?.(e.detail);
        });

        // Create overlay event - for annotations
        this.view.addEventListener('create-overlay', (e: any) => {
            this.callbacks.onCreateOverlay?.(e.detail);
        });

        // Show annotation event
        this.view.addEventListener('show-annotation', (e: any) => {
            this.callbacks.onShowAnnotation?.(e.detail);
        });

        // Draw annotation event
        this.view.addEventListener('draw-annotation', (e: any) => {
            this.callbacks.onDrawAnnotation?.(e.detail);
        });

        // External link event
        this.view.addEventListener('external-link', (e: any) => {
            e.preventDefault();
            this.callbacks.onExternalLink?.(e.detail);
        });

        // Link event (internal navigation)
        this.view.addEventListener('link', (e: any) => {
            this.callbacks.onLink?.(e.detail);
        });

        // History change event
        this.view.history.addEventListener('index-change', (e: any) => {
            const { canGoBack, canGoForward } = e.target;
            this.callbacks.onHistoryChange?.({ canGoBack, canGoForward });
        });
    }

    setAppearance({ style, layout, autohideCursor }: { 
        style: ReaderStyle; 
        layout: LayoutSettings; 
        autohideCursor?: boolean;
    }) {
        Object.assign(this.style, style);
        const { theme } = style;
        
        // Set CSS variables
        const root = document.documentElement;
        root.style.setProperty('--light-bg', theme.light.bg);
        root.style.setProperty('--light-fg', theme.light.fg);
        root.style.setProperty('--dark-bg', theme.dark.bg);
        root.style.setProperty('--dark-fg', theme.dark.fg);
        
        const renderer = this.view?.renderer;
        if (renderer) {
            renderer.setAttribute('flow', layout.flow);
            renderer.setAttribute('gap', layout.gap * 100 + '%');
            renderer.setAttribute('max-inline-size', layout.maxInlineSize + 'px');
            renderer.setAttribute('max-block-size', layout.maxBlockSize + 'px');
            renderer.setAttribute('max-column-count', layout.maxColumnCount);
            
            if (layout.animated) {
                renderer.setAttribute('animated', '');
            } else {
                renderer.removeAttribute('animated');
            }
            
            renderer.setStyles?.(getCSS(this.style));
        }
        
        // Toggle invert class
        if (this.style.invert) {
            document.body.classList.add('invert');
        } else {
            document.body.classList.remove('invert');
        }
        
        // Autohide cursor
        if (autohideCursor) {
            this.view?.setAttribute('autohide-cursor', '');
        } else {
            this.view?.removeAttribute('autohide-cursor');
        }
    }

    // Navigation methods
    goTo(target: string | number) {
        return this.view.goTo(target);
    }

    next() {
        return this.view.next();
    }

    prev() {
        return this.view.prev();
    }

    // Utility methods
    private formatLanguageMap(x: any): string {
        if (!x) return '';
        if (typeof x === 'string') return x;
        const keys = Object.keys(x);
        return x[keys[0]];
    }

    private formatPage(a: string, b?: string): string {
        return b ? `${a} / ${b}` : a;
    }

    private formatLocation(current: number, total: number): string {
        return `${current} / ${total}`;
    }
}

/**
 * Generate CSS for themes and typography
 * Ported from foliate getCSS function
 */
export function getCSS({
    lineHeight,
    justify,
    hyphenate,
    invert,
    theme,
    overrideFont,
    userStylesheet,
    mediaActiveClass
}: ReaderStyle & { lineHeight?: number }): string[] {
    const spacing = lineHeight ?? 1.4;
    const activeClass = mediaActiveClass ?? 'media-active';
    
    return [`
        @namespace epub "http://www.idpf.org/2007/ops";
        @media print {
            html {
                column-width: auto !important;
                height: auto !important;
                width: auto !important;
            }
        }
        @media screen {
            html {
                color-scheme: ${invert ? 'only light' : 'light dark'};
                color: ${theme.light.fg};
            }
            a:any-link {
                color: ${theme.light.link};
                text-decoration-color: light-dark(
                    color-mix(in srgb, currentColor 20%, transparent),
                    color-mix(in srgb, currentColor 40%, transparent));
                text-underline-offset: .1em;
                &:hover {
                    text-decoration-color: unset;
                }
            }
            @media (prefers-color-scheme: dark) {
                html {
                    color: ${invert ? theme.dark.bg : theme.dark.fg};
                    ${invert ? '-webkit-font-smoothing: antialiased;' : ''}
                }
                a:any-link {
                    color: ${invert ? theme.dark.bg : theme.dark.link};
                }
            }
            aside[epub|type~="footnote"] {
                display: none;
            }
        }
        html {
            line-height: ${spacing};
            hanging-punctuation: allow-end last;
            orphans: 2;
            widows: 2;
        }
        [align="left"] { text-align: left; }
        [align="right"] { text-align: right; }
        [align="center"] { text-align: center; }
        [align="justify"] { text-align: justify; }
        :is(hgroup, header) p {
            text-align: unset;
            hyphens: unset;
        }
        h1, h2, h3, h4, h5, h6, hgroup, th {
            text-wrap: balance;
        }
        pre {
            white-space: pre-wrap !important;
            tab-size: 2;
        }
    `, `
        @media screen and (prefers-color-scheme: light) {
            html, body {
                color: ${theme.light.fg} !important;
                background: none !important;
            }
            body * {
                color: inherit !important;
                border-color: currentColor !important;
                background-color: ${theme.light.bg} !important;
            }
            a:any-link {
                color: ${theme.light.link} !important;
            }
            svg, img {
                background-color: transparent !important;
                mix-blend-mode: multiply;
            }
            .${CSS.escape(activeClass)}, .${CSS.escape(activeClass)} * {
                color: ${theme.light.fg} !important;
                background: color-mix(in hsl, ${theme.light.fg}, ${theme.light.bg} 85%) !important;
            }
        }
        @media screen and (prefers-color-scheme: dark) {
            ${invert ? '' : `
            html, body {
                color: ${theme.dark.fg} !important;
                background: none !important;
            }
            body * {
                color: inherit !important;
                border-color: currentColor !important;
                background-color: ${theme.dark.bg} !important;
            }
            a:any-link {
                color: ${theme.dark.link} !important;
            }
            .${CSS.escape(activeClass)}, .${CSS.escape(activeClass)} * {
                color: ${theme.dark.fg} !important;
                background: color-mix(in hsl, ${theme.dark.fg}, ${theme.dark.bg} 75%) !important;
            }`}
        }
        p, li, blockquote, dd {
            line-height: ${spacing};
            text-align: ${justify ? 'justify' : 'start'};
            hyphens: ${hyphenate ? 'auto' : 'none'};
        }
        ${overrideFont ? '* { font-family: revert !important }' : ''}
    ` + (userStylesheet || '')];
}
