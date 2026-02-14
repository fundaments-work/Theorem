import type { FontFamily, HighlightColor, ReaderSettings, ReaderTheme } from "../types";

interface HighlightColorToken {
    label: string;
    solid: string;
    soft: string;
    picker: string;
    pickerActive: string;
}

interface RgbColor {
    r: number;
    g: number;
    b: number;
}

interface ShelfColorToken {
    bg: string;
    text: string;
    border: string;
    icon: string;
}

type HighlightColorTone = Exclude<keyof HighlightColorToken, "label">;
type ThemeColorSlot = "bg" | "fg" | "link";

const HIGHLIGHT_COLORS_ORDER: HighlightColor[] = ["yellow", "green", "blue", "red", "orange", "purple"];

const HIGHLIGHT_LABELS: Record<HighlightColor, string> = {
    yellow: "Yellow",
    green: "Green",
    blue: "Blue",
    red: "Red",
    orange: "Orange",
    purple: "Purple",
};

const THEME_CLASS_NAMES: Record<ReaderTheme, string> = {
    light: "theme-light",
    sepia: "theme-sepia",
    dark: "theme-dark",
};

const READER_THEME_CSS_VARS: Record<ThemeColorSlot, string> = {
    bg: "--reader-bg-override",
    fg: "--reader-fg-override",
    link: "--reader-link-override",
};

const FALLBACK_THEME_COLORS: Record<ReaderTheme, Record<ThemeColorSlot, string>> = {
    light: {
        bg: "#ffffff",
        fg: "#1a1a1a",
        link: "#1a1a1a",
    },
    sepia: {
        bg: "#f4ecd8",
        fg: "#3d3025",
        link: "#3d3025",
    },
    dark: {
        bg: "#000000",
        fg: "#ffffff",
        link: "#ffffff",
    },
};

const FONT_FAMILY_VALUES: Record<FontFamily, string> = {
    original: "var(--font-merriweather), Georgia, serif",
    serif: "var(--font-merriweather), Georgia, serif",
    sans: "var(--font-sans), monospace",
    mono: "var(--font-mono), monospace",
};

const resolvedThemeColorCache = new Map<ReaderTheme, Record<ThemeColorSlot, string>>();
const shelfColorCache = new Map<string, ShelfColorToken>();
const engineUpdateCallbacks = new Set<() => void>();

let currentSettings: ReaderSettings | null = null;

function canResolveCssVariables(): boolean {
    return (
        typeof document !== "undefined"
        && typeof getComputedStyle !== "undefined"
        && !!document.documentElement
    );
}

function readCssCustomProperty(element: Element, variableName: string): string | null {
    const value = getComputedStyle(element).getPropertyValue(variableName).trim();
    return value || null;
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
    const hue = ((h % 360) + 360) % 360;
    const saturation = Math.max(0, Math.min(100, s)) / 100;
    const lightness = Math.max(0, Math.min(100, l)) / 100;

    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const segment = hue / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));

    let redPrime = 0;
    let greenPrime = 0;
    let bluePrime = 0;

    if (segment >= 0 && segment < 1) {
        redPrime = chroma;
        greenPrime = x;
    } else if (segment >= 1 && segment < 2) {
        redPrime = x;
        greenPrime = chroma;
    } else if (segment >= 2 && segment < 3) {
        greenPrime = chroma;
        bluePrime = x;
    } else if (segment >= 3 && segment < 4) {
        greenPrime = x;
        bluePrime = chroma;
    } else if (segment >= 4 && segment < 5) {
        redPrime = x;
        bluePrime = chroma;
    } else {
        redPrime = chroma;
        bluePrime = x;
    }

    const match = lightness - chroma / 2;

    return {
        r: Math.round((redPrime + match) * 255),
        g: Math.round((greenPrime + match) * 255),
        b: Math.round((bluePrime + match) * 255),
    };
}

function parseCssColorToRgb(color: string): RgbColor | null {
    const normalized = color.trim().toLowerCase();

    if (!normalized) {
        return null;
    }

    const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
        const value = hex[1];
        if (value.length === 3) {
            return {
                r: parseInt(value[0] + value[0], 16),
                g: parseInt(value[1] + value[1], 16),
                b: parseInt(value[2] + value[2], 16),
            };
        }

        return {
            r: parseInt(value.slice(0, 2), 16),
            g: parseInt(value.slice(2, 4), 16),
            b: parseInt(value.slice(4, 6), 16),
        };
    }

    const rgb = normalized.match(
        /^rgba?\(\s*([0-9]{1,3})(?:\s*,\s*|\s+)([0-9]{1,3})(?:\s*,\s*|\s+)([0-9]{1,3})(?:\s*[,/]\s*[0-9.]+)?\s*\)$/,
    );
    if (rgb) {
        return {
            r: Math.max(0, Math.min(255, Number(rgb[1]))),
            g: Math.max(0, Math.min(255, Number(rgb[2]))),
            b: Math.max(0, Math.min(255, Number(rgb[3]))),
        };
    }

    const hsl = normalized.match(
        /^hsla?\(\s*(-?[0-9.]+)(?:deg)?(?:\s+|,\s*)([0-9.]+)%\s*(?:,|\s+)\s*([0-9.]+)%/,
    );
    if (hsl) {
        return hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
    }

    return null;
}

function relativeLuminance({ r, g, b }: RgbColor): number {
    const channel = (value: number) => {
        const srgb = value / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function getContrastRatio(a: number, b: number): number {
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
}

function resolveAccessibleAccentContrast(accentCssColor: string): string {
    const rgb = parseCssColorToRgb(accentCssColor);
    if (!rgb) {
        return "#ffffff";
    }

    const accentLuminance = relativeLuminance(rgb);
    const whiteContrast = getContrastRatio(accentLuminance, 1);
    const blackContrast = getContrastRatio(accentLuminance, 0);

    return whiteContrast >= blackContrast ? "#ffffff" : "#000000";
}

function syncAccentContrastToken(root: HTMLElement): void {
    const styles = getComputedStyle(root);
    const accent = styles.getPropertyValue("--color-accent").trim();
    if (!accent) {
        return;
    }

    const contrast = resolveAccessibleAccentContrast(accent);
    root.style.setProperty("--app-accent-contrast", contrast);
    root.style.setProperty("--color-accent-contrast", contrast);
}

function resolveThemeColors(theme: ReaderTheme): Record<ThemeColorSlot, string> {
    if (!canResolveCssVariables()) {
        return FALLBACK_THEME_COLORS[theme];
    }

    const host = document.body ?? document.documentElement;
    const probe = document.createElement("div");
    probe.className = THEME_CLASS_NAMES[theme];
    probe.style.position = "fixed";
    probe.style.opacity = "0";
    probe.style.pointerEvents = "none";
    probe.style.inset = "0";
    host.appendChild(probe);

    const fallback = FALLBACK_THEME_COLORS[theme];
    const resolved = {
        bg: readCssCustomProperty(probe, READER_THEME_CSS_VARS.bg) ?? fallback.bg,
        fg: readCssCustomProperty(probe, READER_THEME_CSS_VARS.fg) ?? fallback.fg,
        link: readCssCustomProperty(probe, READER_THEME_CSS_VARS.link) ?? fallback.link,
    };

    host.removeChild(probe);
    return resolved;
}

function highlightColorVarName(color: HighlightColor, tone: HighlightColorTone): string {
    if (tone === "solid") {
        return `--highlight-${color}`;
    }
    if (tone === "soft") {
        return `--highlight-${color}-soft`;
    }
    if (tone === "picker") {
        return `--highlight-${color}-picker`;
    }
    return `--highlight-${color}-picker-active`;
}

function highlightColorVarReference(color: HighlightColor, tone: HighlightColorTone): string {
    return `var(${highlightColorVarName(color, tone)})`;
}

function resolveHighlightToneColor(color: HighlightColor, tone: HighlightColorTone): string {
    const variableName = highlightColorVarName(color, tone);
    return readRootCssCustomProperty(variableName) ?? highlightColorVarReference(color, tone);
}

function hashString(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function isCurrentSurfaceDark(): boolean {
    const background = readRootCssCustomProperty("--color-background")
        ?? readRootCssCustomProperty("--reader-bg");

    if (!background) {
        return false;
    }

    const rgb = parseCssColorToRgb(background);
    if (!rgb) {
        return false;
    }

    return relativeLuminance(rgb) < 0.45;
}

function getReadableTextColor(background: RgbColor): string {
    const bgLuminance = relativeLuminance(background);
    const whiteContrast = getContrastRatio(bgLuminance, 1);
    const blackContrast = getContrastRatio(bgLuminance, 0);

    return whiteContrast >= blackContrast ? "#ffffff" : "#111111";
}

function buildShelfColor(seed: number, darkSurface: boolean): ShelfColorToken {
    const random = createSeededRandom(seed);
    const hue = Math.floor(random() * 360);
    const saturation = darkSurface ? 28 + random() * 20 : 22 + random() * 18;
    const lightness = darkSurface ? 20 + random() * 12 : 84 + random() * 10;
    const borderLightness = darkSurface
        ? Math.min(52, lightness + 10)
        : Math.max(58, lightness - 18);
    const iconLightness = darkSurface ? 82 : 24;

    const backgroundRgb = hslToRgb(hue, saturation, lightness);

    return {
        bg: `hsl(${hue} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`,
        text: getReadableTextColor(backgroundRgb),
        border: `hsl(${hue} ${Math.max(16, saturation - 6).toFixed(1)}% ${borderLightness.toFixed(1)}%)`,
        icon: `hsl(${hue} ${Math.min(88, saturation + 10).toFixed(1)}% ${iconLightness.toFixed(1)}%)`,
    };
}

function notifyEnginesOfStyleChange(): void {
    engineUpdateCallbacks.forEach((callback) => {
        try {
            callback();
        } catch (error) {
            console.error("Error notifying engine of style change:", error);
        }
    });
}

export function readRootCssCustomProperty(variableName: string): string | null {
    if (!canResolveCssVariables()) {
        return null;
    }
    return readCssCustomProperty(document.documentElement, variableName);
}

export function getThemeColors(theme: ReaderTheme): { bg: string; fg: string; link: string } {
    const cached = resolvedThemeColorCache.get(theme);
    if (cached) {
        return cached;
    }

    const resolved = resolveThemeColors(theme);
    resolvedThemeColorCache.set(theme, resolved);
    return resolved;
}

export const HIGHLIGHT_COLOR_TOKENS: Record<HighlightColor, HighlightColorToken> = Object.fromEntries(
    HIGHLIGHT_COLORS_ORDER.map((color) => [
        color,
        {
            label: HIGHLIGHT_LABELS[color],
            solid: highlightColorVarReference(color, "solid"),
            soft: highlightColorVarReference(color, "soft"),
            picker: highlightColorVarReference(color, "picker"),
            pickerActive: highlightColorVarReference(color, "pickerActive"),
        },
    ]),
) as Record<HighlightColor, HighlightColorToken>;

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = Object.fromEntries(
    Object.entries(HIGHLIGHT_COLOR_TOKENS).map(([color, token]) => [color, token.soft]),
) as Record<HighlightColor, string>;

export const HIGHLIGHT_SOLID_COLORS: Record<HighlightColor, string> = Object.fromEntries(
    Object.entries(HIGHLIGHT_COLOR_TOKENS).map(([color, token]) => [color, token.solid]),
) as Record<HighlightColor, string>;

export const HIGHLIGHT_PICKER_COLORS: Record<HighlightColor, string> = Object.fromEntries(
    Object.entries(HIGHLIGHT_COLOR_TOKENS).map(([color, token]) => [color, token.picker]),
) as Record<HighlightColor, string>;

export const HIGHLIGHT_PICKER_ACTIVE_COLORS: Record<HighlightColor, string> = Object.fromEntries(
    Object.entries(HIGHLIGHT_COLOR_TOKENS).map(([color, token]) => [color, token.pickerActive]),
) as Record<HighlightColor, string>;

export function getHighlightSolidColor(color: HighlightColor): string {
    return resolveHighlightToneColor(color, "solid");
}

export function getShelfColor(shelfId: string, shelfName: string): ShelfColorToken {
    const themeKey = isCurrentSurfaceDark() ? "dark" : "light";
    const normalizedShelfName = shelfName.trim().toLowerCase();
    const key = `${themeKey}:${shelfId}:${normalizedShelfName}`;
    const cached = shelfColorCache.get(key);

    if (cached) {
        return cached;
    }

    const color = buildShelfColor(hashString(key), themeKey === "dark");
    shelfColorCache.set(key, color);
    return color;
}

export function getShelfInitials(name: string): string {
    return name
        .split(" ")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

export function getCurrentReaderSettings(): ReaderSettings | null {
    return currentSettings;
}

export function applyReaderStyles(settings: ReaderSettings): void {
    currentSettings = settings;

    if (typeof document === "undefined") {
        return;
    }

    const root = document.documentElement;
    const colors = getThemeColors(settings.theme);
    const isDark = settings.theme === "dark";

    root.style.setProperty("--reader-bg", colors.bg);
    root.style.setProperty("--reader-fg", colors.fg);
    root.style.setProperty("--reader-link", colors.link);

    root.style.setProperty("--reader-font-size", `${settings.fontSize}px`);
    root.style.setProperty("--reader-line-height", String(settings.lineHeight));
    root.style.setProperty("--reader-font-family", FONT_FAMILY_VALUES[settings.fontFamily]);
    root.style.setProperty("--reader-letter-spacing", `${settings.letterSpacing}em`);
    root.style.setProperty("--reader-word-spacing", `${settings.wordSpacing}em`);
    root.style.setProperty("--reader-paragraph-spacing", `${settings.paragraphSpacing}em`);
    root.style.setProperty("--reader-text-align", settings.textAlign);

    root.style.setProperty("--reader-margin-x", `${settings.margins}%`);
    root.style.setProperty("--reader-margin-y", `${Math.max(2, settings.margins / 2)}%`);
    root.style.setProperty("--reader-brightness", `${settings.brightness}%`);
    root.style.setProperty("--reader-zoom", `${settings.zoom / 100}`);
    root.style.setProperty("--reader-flow", settings.flow);

    document.body.classList.remove("theme-light", "theme-sepia", "theme-dark");
    document.body.classList.add(`theme-${settings.theme}`);

    syncAccentContrastToken(root);
    root.style.colorScheme = isDark ? "dark" : "light";

    notifyEnginesOfStyleChange();
}

export function registerEngineStyleCallback(callback: () => void): () => void {
    engineUpdateCallbacks.add(callback);
    return () => engineUpdateCallbacks.delete(callback);
}

export function getSettingsChanges(
    prev: ReaderSettings | null,
    current: ReaderSettings,
): { cssChanged: boolean; engineChanged: boolean; changedKeys: string[] } {
    if (!prev) {
        return { cssChanged: true, engineChanged: true, changedKeys: Object.keys(current) };
    }

    const cssKeys = [
        "theme",
        "fontSize",
        "lineHeight",
        "fontFamily",
        "letterSpacing",
        "wordSpacing",
        "paragraphSpacing",
        "textAlign",
        "margins",
        "brightness",
        "zoom",
    ];

    const engineKeys = [
        "theme",
        "fontSize",
        "lineHeight",
        "fontFamily",
        "textAlign",
        "hyphenation",
        "flow",
        "layout",
        "margins",
        "zoom",
        "forcePublisherStyles",
    ];

    const changedKeys: string[] = [];
    for (const key of Object.keys(current) as Array<keyof ReaderSettings>) {
        if (prev[key] !== current[key]) {
            changedKeys.push(key);
        }
    }

    return {
        cssChanged: changedKeys.some((key) => cssKeys.includes(key)),
        engineChanged: changedKeys.some((key) => engineKeys.includes(key)),
        changedKeys,
    };
}

export function initReaderStyles(settings: ReaderSettings): void {
    applyReaderStyles(settings);
}
