/**
 * Reader Styles - CSS Variable-based instant style application
 * 
 * Based on Foliate GTK's approach:
 * - Use CSS custom properties for instant visual feedback
 * - Batch engine updates for settings that require re-rendering
 * - No debouncing for visual changes - they're instant via CSS
 */

import { APP_THEME_PALETTES, READER_THEME_PREVIEWS } from "@/lib/design-tokens";
import { getTheme } from '@/foliate/themes';
import type { ReaderSettings, ReaderTheme, FontFamily, ReadingFlow, PageLayout } from '@/types';

// CSS Variable names mapping
const CSS_VARS = {
    // Theme colors
    readerBg: '--reader-bg',
    readerFg: '--reader-fg',
    readerLink: '--reader-link',
    
    // Typography
    fontSize: '--reader-font-size',
    lineHeight: '--reader-line-height',
    fontFamily: '--reader-font-family',
    letterSpacing: '--reader-letter-spacing',
    wordSpacing: '--reader-word-spacing',
    paragraphSpacing: '--reader-paragraph-spacing',
    textAlign: '--reader-text-align',
    
    // Layout
    marginX: '--reader-margin-x',
    marginY: '--reader-margin-y',
    brightness: '--reader-brightness',
    zoom: '--reader-zoom',
    
    // Flow
    flow: '--reader-flow',
} as const;

// Font family CSS values
const FONT_FAMILY_VALUES: Record<FontFamily, string> = {
    original: 'inherit',
    serif: 'var(--font-merriweather), Georgia, serif',
    sans: 'var(--font-sans), system-ui, sans-serif',
    mono: 'var(--font-mono), monospace',
};

// Theme color values - Minimal: black & white only, sepia for warmth
const THEME_COLORS: Record<ReaderTheme, { bg: string; fg: string; link: string }> = {
    light: {
        bg: READER_THEME_PREVIEWS.light.bg,
        fg: READER_THEME_PREVIEWS.light.fg,
        link: APP_THEME_PALETTES.light.readerLink,
    },
    sepia: {
        bg: READER_THEME_PREVIEWS.sepia.bg,
        fg: READER_THEME_PREVIEWS.sepia.fg,
        link: APP_THEME_PALETTES.sepia.readerLink,
    },
    dark: {
        bg: READER_THEME_PREVIEWS.dark.bg,
        fg: READER_THEME_PREVIEWS.dark.fg,
        link: APP_THEME_PALETTES.dark.readerLink,
    },
};

// Cache for current settings to avoid recomputation
let currentSettings: ReaderSettings | null = null;

/**
 * Get current reader settings (for use by engine)
 */
export function getCurrentReaderSettings(): ReaderSettings | null {
    return currentSettings;
}

/**
 * Apply reader settings instantly via CSS custom properties
 * This is synchronous and extremely fast - no debouncing needed
 */
export function applyReaderStyles(settings: ReaderSettings): void {
    currentSettings = settings;
    const root = document.documentElement;
    const colors = THEME_COLORS[settings.theme];
    const isDark = settings.theme === 'dark';
    
    // Apply theme colors instantly
    root.style.setProperty(CSS_VARS.readerBg, colors.bg);
    root.style.setProperty(CSS_VARS.readerFg, colors.fg);
    root.style.setProperty(CSS_VARS.readerLink, colors.link);
    
    // Apply typography - instant
    root.style.setProperty(CSS_VARS.fontSize, `${settings.fontSize}px`);
    root.style.setProperty(CSS_VARS.lineHeight, String(settings.lineHeight));
    root.style.setProperty(CSS_VARS.fontFamily, FONT_FAMILY_VALUES[settings.fontFamily]);
    root.style.setProperty(CSS_VARS.letterSpacing, `${settings.letterSpacing}em`);
    root.style.setProperty(CSS_VARS.wordSpacing, `${settings.wordSpacing}em`);
    root.style.setProperty(CSS_VARS.paragraphSpacing, `${settings.paragraphSpacing}em`);
    root.style.setProperty(CSS_VARS.textAlign, settings.textAlign);
    
    // Apply layout - instant
    root.style.setProperty(CSS_VARS.marginX, `${settings.margins}%`);
    root.style.setProperty(CSS_VARS.marginY, `${Math.max(2, settings.margins / 2)}%`);
    root.style.setProperty(CSS_VARS.brightness, `${settings.brightness}%`);
    root.style.setProperty(CSS_VARS.zoom, `${settings.zoom / 100}`);
    root.style.setProperty(CSS_VARS.flow, settings.flow);
    
    // Update body classes for theme
    document.body.classList.remove('theme-light', 'theme-sepia', 'theme-dark');
    document.body.classList.add(`theme-${settings.theme}`);
    
    // Update color scheme for native UI elements
    root.style.colorScheme = isDark ? 'dark' : 'light';
    
    // Notify any open engines to update their iframe styles
    notifyEnginesOfStyleChange();
}

// Callback registry for engines to register for style updates
const engineUpdateCallbacks = new Set<() => void>();

/**
 * Register an engine to receive style update notifications
 */
export function registerEngineStyleCallback(callback: () => void): () => void {
    engineUpdateCallbacks.add(callback);
    return () => engineUpdateCallbacks.delete(callback);
}

/**
 * Notify all registered engines that styles have changed
 */
function notifyEnginesOfStyleChange(): void {
    engineUpdateCallbacks.forEach(callback => {
        try {
            callback();
        } catch (e) {
            console.error('Error notifying engine of style change:', e);
        }
    });
}

/**
 * Get settings that need to be applied to the rendering engine
 * These are the settings that require iframe re-rendering
 */
export function getEngineSettings(settings: ReaderSettings) {
    const theme = getTheme(settings.theme);
    
    return {
        style: {
            spacing: settings.lineHeight,
            justify: settings.textAlign === 'justify',
            hyphenate: settings.hyphenation,
            invert: false,
            theme,
            overrideFont: settings.forcePublisherStyles,
        },
        layout: {
            flow: settings.flow === 'scroll' ? 'scrolled' as const : 'paginated' as const,
            animated: false,
            gap: 0.05,
            maxInlineSize: settings.fontSize * 40,
            maxBlockSize: 800,
            maxColumnCount: settings.layout === 'double' ? 2 : 1,
        },
        zoom: settings.zoom,
        margins: settings.margins,
    };
}

/**
 * Compare two settings objects and return what changed
 */
export function getSettingsChanges(
    prev: ReaderSettings | null,
    current: ReaderSettings
): { cssChanged: boolean; engineChanged: boolean; changedKeys: string[] } {
    if (!prev) {
        return { cssChanged: true, engineChanged: true, changedKeys: Object.keys(current) };
    }
    
    const cssKeys = ['theme', 'fontSize', 'lineHeight', 'fontFamily', 'letterSpacing', 
                     'wordSpacing', 'paragraphSpacing', 'textAlign', 'margins', 'brightness', 'zoom'];
    const engineKeys = ['theme', 'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 
                        'hyphenation', 'flow', 'layout', 'margins', 'zoom', 'forcePublisherStyles'];
    
    const changedKeys: string[] = [];
    
    for (const key of Object.keys(current) as Array<keyof ReaderSettings>) {
        if (prev[key] !== current[key]) {
            changedKeys.push(key);
        }
    }
    
    const cssChanged = changedKeys.some(k => cssKeys.includes(k));
    const engineChanged = changedKeys.some(k => engineKeys.includes(k));
    
    return { cssChanged, engineChanged, changedKeys };
}

/**
 * Create CSS string for iframe injection with CURRENT values
 * This ensures the iframe gets the actual colors, not default values
 */
export function createReaderCSS(settings?: ReaderSettings): string {
    const s = settings || currentSettings;
    
    // Use provided settings or defaults
    const bg = s ? THEME_COLORS[s.theme].bg : READER_THEME_PREVIEWS.light.bg;
    const fg = s ? THEME_COLORS[s.theme].fg : READER_THEME_PREVIEWS.light.fg;
    const link = s ? THEME_COLORS[s.theme].link : APP_THEME_PALETTES.light.readerLink;
    const fontSize = s?.fontSize ?? 18;
    const lineHeight = s?.lineHeight ?? 1.6;
    const letterSpacing = s?.letterSpacing ?? 0;
    const wordSpacing = s?.wordSpacing ?? 0;
    const textAlign = s?.textAlign ?? 'left';
    const fontFamily = s?.fontFamily ? FONT_FAMILY_VALUES[s.fontFamily] : 'inherit';
    const forceFont = s?.fontFamily && s.fontFamily !== 'original';
    
    return `
        @namespace epub "http://www.idpf.org/2007/ops";
        
        :root {
            --reader-bg: ${bg};
            --reader-fg: ${fg};
            --reader-link: ${link};
            --reader-font-size: ${fontSize}px;
            --reader-line-height: ${lineHeight};
            --reader-letter-spacing: ${letterSpacing}em;
            --reader-word-spacing: ${wordSpacing}em;
            --reader-text-align: ${textAlign};
        }
        
        @media screen {
            html {
                font-size: ${fontSize}px !important;
                line-height: ${lineHeight} !important;
                color: ${fg} !important;
                background: ${bg} !important;
                letter-spacing: ${letterSpacing}em !important;
                word-spacing: ${wordSpacing}em !important;
                ${forceFont ? `font-family: ${fontFamily} !important;` : ''}
            }
            
            body {
                font-size: inherit !important;
                line-height: inherit !important;
                color: inherit !important;
                background: ${bg} !important;
                letter-spacing: inherit !important;
                word-spacing: inherit !important;
                text-align: ${textAlign} !important;
                ${forceFont ? `font-family: ${fontFamily} !important;` : ''}
            }
            
            /* Force font family when not using original */
            ${forceFont ? `
            *, *::before, *::after {
                font-family: ${fontFamily} !important;
            }
            ` : 'body * { font-family: inherit; }'}
            
            a:any-link {
                color: ${link} !important;
            }
            
            p, li, blockquote, dd {
                line-height: ${lineHeight} !important;
            }
            
            /* Selection styling */
            ::selection {
                background: color-mix(in srgb, ${fg} 20%, transparent);
                color: ${fg};
            }
        }
    `;
}

/**
 * Get theme colors for a specific theme
 */
export function getThemeColors(theme: ReaderTheme): { bg: string; fg: string; link: string } {
    return THEME_COLORS[theme];
}

/**
 * Initialize reader styles with default settings
 */
export function initReaderStyles(settings: ReaderSettings): void {
    applyReaderStyles(settings);
    
    // Inject global CSS for reader
    const styleId = 'reader-global-styles';
    if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* Reader viewport brightness filter */
            .reader-viewport {
                filter: brightness(var(--reader-brightness, 100%));
            }
            
            /* Theme-based scrollbar styling */
            .theme-dark ::-webkit-scrollbar-thumb {
                background: var(--app-border);
            }
            
            .theme-sepia ::-webkit-scrollbar-thumb {
                background: var(--app-border);
            }
            
            /* Smooth transitions for theme changes */
            .reader-theme-transition,
            .reader-theme-transition * {
                transition: background-color 0.15s ease, color 0.15s ease;
            }
        `;
        document.head.appendChild(style);
    }
}
