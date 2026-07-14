
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
