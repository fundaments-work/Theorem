/**
 * Runtime color resolver for share card generation.
 * This file is separate to avoid pulling in the entire design-tokens module
 * into the share card, which is rendered in isolation.
 */

// These are fallback values copied from the :root styles in index.css
// They should be kept in sync with the light theme defaults.
const FALLBACK_COLORS = {
    "--color-surface": "#ffffff",
    "--color-text-primary": "#1c1917",
    "--color-text-secondary": "#78716c",
    "--color-text-muted": "#a8a29e",
    "--color-border": "#e7e5e4",
    "--color-accent": "#8b5cf6",
    "--highlight-yellow": "#eab308",
    "--highlight-green": "#22c55e",
    "--highlight-blue": "#3b82f6",
    "--highlight-red": "#ef4444",
    "--highlight-orange": "#f97316",
    "--highlight-purple": "#8b5cf6",
};

/**
 * Resolves a CSS custom property to its value at runtime.
 * This is used to ensure the share card has the correct colors, even when
 * rendered outside the normal DOM tree for capture.
 * @param variableName The CSS custom property name (e.g., "--color-surface")
 * @returns The resolved color value string.
 */
export function getResolvedColor(variableName: keyof typeof FALLBACK_COLORS): string {
    if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') {
        return FALLBACK_COLORS[variableName];
    }
    try {
        const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
        return value || FALLBACK_COLORS[variableName];
    } catch {
        return FALLBACK_COLORS[variableName];
    }
}
