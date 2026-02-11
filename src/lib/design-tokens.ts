import type { HighlightColor, ReaderTheme } from "@/types";

export interface ThemeSemanticPalette {
    appBg: string;
    appSurface: string;
    appSurfaceElevated: string;
    appSurfaceMuted: string;
    appSurfaceVariant: string;
    appSurfaceHover: string;
    appTextPrimary: string;
    appTextSecondary: string;
    appTextMuted: string;
    appTextInverse: string;
    appBorder: string;
    appBorderSubtle: string;
    appAccent: string;
    appAccentHover: string;
    appAccentLight: string;
    appAccentContrast: string;
    appSuccess: string;
    appWarning: string;
    appError: string;
    appInfo: string;
    appOverlaySubtle: string;
    appOverlayMedium: string;
    appOverlayStrong: string;
    appOverlayStrongHover: string;
    readerBg: string;
    readerFg: string;
    readerLink: string;
}

export const APP_THEME_PALETTES: Record<ReaderTheme, ThemeSemanticPalette> = {
    light: {
        appBg: "#f7f6f3",
        appSurface: "#ffffff",
        appSurfaceElevated: "#ffffff",
        appSurfaceMuted: "#f2efe9",
        appSurfaceVariant: "#f2efe9",
        appSurfaceHover: "#ece7dd",
        appTextPrimary: "#171614",
        appTextSecondary: "#4e4a42",
        appTextMuted: "#7c766a",
        appTextInverse: "#faf8f4",
        appBorder: "#d8d1c4",
        appBorderSubtle: "#ebe6dc",
        appAccent: "#a55a18",
        appAccentHover: "#854712",
        appAccentLight: "#f4e2d2",
        appAccentContrast: "#ffffff",
        appSuccess: "#1f7a4f",
        appWarning: "#b26a10",
        appError: "#b3261e",
        appInfo: "#1f5d8a",
        appOverlaySubtle: "color-mix(in srgb, #171614 10%, transparent)",
        appOverlayMedium: "color-mix(in srgb, #171614 22%, transparent)",
        appOverlayStrong: "color-mix(in srgb, #171614 55%, transparent)",
        appOverlayStrongHover: "color-mix(in srgb, #171614 70%, transparent)",
        readerBg: "#ffffff",
        readerFg: "#1b1915",
        readerLink: "#8a4a12",
    },
    sepia: {
        appBg: "#e8e0cf",
        appSurface: "#f4ecd8",
        appSurfaceElevated: "#fbf2de",
        appSurfaceMuted: "#ede4cf",
        appSurfaceVariant: "#ede4cf",
        appSurfaceHover: "#e5dbc6",
        appTextPrimary: "#5f4b32",
        appTextSecondary: "#7a634a",
        appTextMuted: "#9a8264",
        appTextInverse: "#f7f0e2",
        appBorder: "#dcd3bd",
        appBorderSubtle: "#e8e1cf",
        appAccent: "#8b6914",
        appAccentHover: "#6b5110",
        appAccentLight: "#efe2c7",
        appAccentContrast: "#ffffff",
        appSuccess: "#5f4b32",
        appWarning: "#b8860b",
        appError: "#a0522d",
        appInfo: "#5f4b32",
        appOverlaySubtle: "color-mix(in srgb, #5f4b32 10%, transparent)",
        appOverlayMedium: "color-mix(in srgb, #5f4b32 22%, transparent)",
        appOverlayStrong: "color-mix(in srgb, #5f4b32 55%, transparent)",
        appOverlayStrongHover: "color-mix(in srgb, #5f4b32 70%, transparent)",
        readerBg: "#f4ecd8",
        readerFg: "#5f4b32",
        readerLink: "#8b4513",
    },
    dark: {
        appBg: "#131210",
        appSurface: "#1a1917",
        appSurfaceElevated: "#21201d",
        appSurfaceMuted: "#22201c",
        appSurfaceVariant: "#272420",
        appSurfaceHover: "#312d27",
        appTextPrimary: "#ece6db",
        appTextSecondary: "#c8c0b3",
        appTextMuted: "#9f9587",
        appTextInverse: "#151311",
        appBorder: "#38332b",
        appBorderSubtle: "#2b2721",
        appAccent: "#f0b86f",
        appAccentHover: "#d9a55f",
        appAccentLight: "color-mix(in srgb, #f0b86f 22%, transparent)",
        appAccentContrast: "#1a1917",
        appSuccess: "#3aa173",
        appWarning: "#d9a55f",
        appError: "#d97b6c",
        appInfo: "#6fa9d9",
        appOverlaySubtle: "color-mix(in srgb, #ece6db 10%, transparent)",
        appOverlayMedium: "color-mix(in srgb, #ece6db 22%, transparent)",
        appOverlayStrong: "color-mix(in srgb, #ece6db 55%, transparent)",
        appOverlayStrongHover: "color-mix(in srgb, #ece6db 70%, transparent)",
        readerBg: "#151413",
        readerFg: "#ece6db",
        readerLink: "#f0b86f",
    },
};

export const DESIGN_TOKEN_VARS = {
    color: {
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        surfaceElevated: "var(--color-surface-elevated)",
        surfaceMuted: "var(--color-surface-muted)",
        surfaceVariant: "var(--color-surface-variant)",
        surfaceHover: "var(--color-surface-hover)",
        textPrimary: "var(--color-text-primary)",
        textSecondary: "var(--color-text-secondary)",
        textMuted: "var(--color-text-muted)",
        textInverse: "var(--color-text-inverse)",
        border: "var(--color-border)",
        borderSubtle: "var(--color-border-subtle)",
        accent: "var(--color-accent)",
        accentHover: "var(--color-accent-hover)",
        accentLight: "var(--color-accent-light)",
        accentContrast: "var(--color-accent-contrast)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        error: "var(--color-error)",
        info: "var(--color-info)",
        focusRing: "var(--color-focus-ring)",
        overlaySubtle: "var(--color-overlay-subtle)",
        overlayMedium: "var(--color-overlay-medium)",
        overlayStrong: "var(--color-overlay-strong)",
        overlayStrongHover: "var(--color-overlay-strong-hover)",
    },
    reader: {
        background: "var(--reader-bg)",
        foreground: "var(--reader-fg)",
        link: "var(--reader-link)",
        fontSize: "var(--reader-font-size)",
        lineHeight: "var(--reader-line-height)",
        marginX: "var(--reader-margin-x)",
        marginY: "var(--reader-margin-y)",
        brightness: "var(--reader-brightness)",
        zoom: "var(--reader-zoom)",
    },
    spacing: {
        xxs: "var(--spacing-xxs)",
        xs: "var(--spacing-xs)",
        sm: "var(--spacing-sm)",
        md: "var(--spacing-md)",
        lg: "var(--spacing-lg)",
        xl: "var(--spacing-xl)",
        "2xl": "var(--spacing-2xl)",
        "3xl": "var(--spacing-3xl)",
        "4xl": "var(--spacing-4xl)",
    },
    radius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
    },
    shadow: {
        xs: "var(--shadow-xs)",
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
    },
    typography: {
        family: {
            sans: "var(--font-sans)",
            serif: "var(--font-serif)",
            mono: "var(--font-mono)",
            display: "var(--font-playfair)",
            readerSerif: "var(--font-merriweather)",
        },
        size: {
            "4xs": "var(--font-size-4xs)",
            "3xs": "var(--font-size-3xs)",
            "2xs": "var(--font-size-2xs)",
            caption: "var(--font-size-caption)",
            xs: "var(--font-size-xs)",
            sm: "var(--font-size-sm)",
            md: "var(--font-size-md)",
            lg: "var(--font-size-lg)",
            xl: "var(--font-size-xl)",
            "2xl": "var(--font-size-2xl)",
            "3xl": "var(--font-size-3xl)",
            "4xl": "var(--font-size-4xl)",
            "5xl": "var(--font-size-5xl)",
        },
        lineHeight: {
            tight: "var(--line-height-tight)",
            snug: "var(--line-height-snug)",
            normal: "var(--line-height-normal)",
            relaxed: "var(--line-height-relaxed)",
            loose: "var(--line-height-loose)",
        },
        weight: {
            regular: "var(--font-weight-regular)",
            medium: "var(--font-weight-medium)",
            semibold: "var(--font-weight-semibold)",
            bold: "var(--font-weight-bold)",
            black: "var(--font-weight-black)",
        },
        letterSpacing: {
            tight: "var(--letter-spacing-tight)",
            normal: "var(--letter-spacing-normal)",
            wide: "var(--letter-spacing-wide)",
            wider: "var(--letter-spacing-wider)",
        },
    },
    motion: {
        duration: {
            fast: "var(--duration-fast)",
            normal: "var(--duration-normal)",
            slow: "var(--duration-slow)",
        },
        transition: {
            fast: "var(--transition-fast)",
            normal: "var(--transition-normal)",
            slow: "var(--transition-slow)",
        },
    },
    layout: {
        container: {
            sm: "var(--container-width-sm)",
            md: "var(--container-width-md)",
            lg: "var(--container-width-lg)",
            xl: "var(--container-width-xl)",
            "2xl": "var(--container-width-2xl)",
            "7xl": "var(--container-width-7xl)",
            max: "var(--layout-content-max-width)",
            readable: "var(--layout-content-readable-width)",
            inlinePadding: "var(--layout-content-inline-padding)",
            inlinePaddingMobile: "var(--layout-content-inline-padding-mobile)",
        },
        sidebar: {
            expanded: "var(--layout-sidebar-width)",
            collapsed: "var(--layout-sidebar-collapsed-width)",
        },
        chrome: {
            headerHeight: "var(--layout-header-height)",
            titlebarHeight: "var(--layout-titlebar-height)",
            readerToolbarHeight: "var(--layout-reader-toolbar-height)",
        },
        panel: {
            readerWidth: "var(--layout-reader-panel-width)",
            readerWidthMobile: "var(--layout-reader-panel-width-mobile)",
            readerMaxHeight: "var(--layout-reader-panel-max-height)",
            readerMaxWidthMobile: "var(--layout-reader-panel-max-width-mobile)",
            readerMobileHeight: "var(--layout-reader-panel-mobile-height)",
            readerListMaxHeight: "var(--layout-reader-list-max-height)",
        },
        overlay: {
            modalMaxHeight: "var(--layout-modal-max-height)",
            modalWidthFluid: "var(--layout-modal-width-fluid)",
            modalWidthSm: "var(--layout-modal-width-sm)",
            modalWidthMd: "var(--layout-modal-width-md)",
            modalWidthLg: "var(--layout-modal-width-lg)",
            modalWidthXl: "var(--layout-modal-width-xl)",
            dropdownMinWidth: "var(--layout-dropdown-menu-min-width)",
            dropdownMaxWidth: "var(--layout-dropdown-menu-max-width)",
            popoverMinWidth: "var(--layout-popover-min-width)",
            tooltipMaxWidth: "var(--layout-tooltip-max-width)",
            floatingPanelMaxHeight: "var(--layout-floating-panel-max-height)",
            floatingPanelTopOffset: "var(--layout-floating-panel-top-offset)",
            floatingPanelMaxHeightDesktop: "var(--layout-floating-panel-max-height-desktop)",
            floatingPanelWidth: "var(--layout-floating-panel-width)",
        },
        editor: {
            noteWidth: "var(--layout-note-editor-width)",
            noteMinHeight: "var(--layout-note-editor-min-height)",
            noteMaxHeight: "var(--layout-note-editor-max-height)",
            annotationMinHeight: "var(--layout-annotation-editor-min-height)",
            inlineTitleMaxWidth: "var(--layout-inline-title-max-width)",
            errorStackMaxHeight: "var(--layout-error-stack-max-height)",
            errorComponentStackMaxHeight: "var(--layout-error-component-stack-max-height)",
        },
        effect: {
            backdropBlurSm: "var(--effect-backdrop-blur-sm)",
        },
    },
    controls: {
        height: {
            sm: "var(--control-height-sm)",
            md: "var(--control-height-md)",
            lg: "var(--control-height-lg)",
            touchMin: "var(--control-touch-min)",
            iconButton: "var(--control-icon-button-size)",
        },
        padding: {
            x: "var(--control-padding-x)",
            y: "var(--control-padding-y)",
        },
        icon: {
            sm: "var(--icon-size-sm)",
            md: "var(--icon-size-md)",
            lg: "var(--icon-size-lg)",
        },
    },
    zIndex: {
        backdrop: "var(--z-backdrop)",
        dropdown: "var(--z-dropdown)",
        sticky: "var(--z-sticky)",
        modal: "var(--z-modal)",
        popover: "var(--z-popover)",
        tooltip: "var(--z-tooltip)",
    },
    breakpoints: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1536px",
    },
} as const;

export type DesignTokenVars = typeof DESIGN_TOKEN_VARS;

export interface HighlightColorToken {
    label: string;
    solid: string;
    soft: string;
    softDark: string;
    picker: string;
    pickerActive: string;
}

export const HIGHLIGHT_COLOR_TOKENS: Record<HighlightColor, HighlightColorToken> = {
    yellow: {
        label: "Yellow",
        solid: "#f4b400",
        soft: "rgba(244, 180, 0, 0.26)",
        softDark: "rgba(244, 180, 0, 0.21)",
        picker: "#ffe082",
        pickerActive: "#ffd54f",
    },
    green: {
        label: "Green",
        solid: "#2e7d32",
        soft: "rgba(46, 125, 50, 0.24)",
        softDark: "rgba(46, 125, 50, 0.2)",
        picker: "#a5d6a7",
        pickerActive: "#81c784",
    },
    blue: {
        label: "Blue",
        solid: "#1976d2",
        soft: "rgba(25, 118, 210, 0.22)",
        softDark: "rgba(25, 118, 210, 0.18)",
        picker: "#90caf9",
        pickerActive: "#64b5f6",
    },
    red: {
        label: "Red",
        solid: "#d32f2f",
        soft: "rgba(211, 47, 47, 0.22)",
        softDark: "rgba(211, 47, 47, 0.18)",
        picker: "#ef9a9a",
        pickerActive: "#e57373",
    },
    orange: {
        label: "Orange",
        solid: "#f57c00",
        soft: "rgba(245, 124, 0, 0.24)",
        softDark: "rgba(245, 124, 0, 0.2)",
        picker: "#ffcc80",
        pickerActive: "#ffb74d",
    },
    purple: {
        label: "Purple",
        solid: "#7b1fa2",
        soft: "rgba(123, 31, 162, 0.22)",
        softDark: "rgba(123, 31, 162, 0.18)",
        picker: "#ce93d8",
        pickerActive: "#ba68c8",
    },
};

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = Object.fromEntries(
    Object.entries(HIGHLIGHT_COLOR_TOKENS).map(([color, token]) => [color, token.soft]),
) as Record<HighlightColor, string>;

export const HIGHLIGHT_COLORS_DARK: Record<HighlightColor, string> = Object.fromEntries(
    Object.entries(HIGHLIGHT_COLOR_TOKENS).map(([color, token]) => [color, token.softDark]),
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

export interface ShelfColorToken {
    bg: string;
    text: string;
    border: string;
    icon: string;
    dotClass: string;
}

export const SHELF_COLOR_PALETTE: ShelfColorToken[] = [
    { bg: "#fef3c7", text: "#92400e", border: "#fcd34d", icon: "#f59e0b", dotClass: "bg-amber-500" },
    { bg: "#dbeafe", text: "#1e40af", border: "#93c5fd", icon: "#3b82f6", dotClass: "bg-blue-500" },
    { bg: "#d1fae5", text: "#065f46", border: "#6ee7b7", icon: "#10b981", dotClass: "bg-emerald-500" },
    { bg: "#fce7f3", text: "#9d174d", border: "#f9a8d4", icon: "#ec4899", dotClass: "bg-pink-500" },
    { bg: "#e0e7ff", text: "#3730a3", border: "#a5b4fc", icon: "#6366f1", dotClass: "bg-indigo-500" },
    { bg: "#fed7aa", text: "#9a3412", border: "#fdba74", icon: "#f97316", dotClass: "bg-orange-500" },
    { bg: "#e9d5ff", text: "#6b21a8", border: "#c4b5fd", icon: "#a855f7", dotClass: "bg-purple-500" },
    { bg: "#ccfbf1", text: "#115e59", border: "#5eead4", icon: "#14b8a6", dotClass: "bg-teal-500" },
    { bg: "#fecaca", text: "#991b1b", border: "#fca5a5", icon: "#ef4444", dotClass: "bg-red-500" },
    { bg: "#bbf7d0", text: "#166534", border: "#86efac", icon: "#22c55e", dotClass: "bg-green-500" },
    { bg: "#ddd6fe", text: "#5b21b6", border: "#c4b5fd", icon: "#8b5cf6", dotClass: "bg-violet-500" },
    { bg: "#cffafe", text: "#155e75", border: "#67e8f9", icon: "#06b6d4", dotClass: "bg-cyan-500" },
    { bg: "#f5d0fe", text: "#86198f", border: "#e879f9", icon: "#d946ef", dotClass: "bg-fuchsia-500" },
    { bg: "#fee2e2", text: "#991b1b", border: "#fecaca", icon: "#ef4444", dotClass: "bg-rose-500" },
    { bg: "#fef9c3", text: "#854d0e", border: "#fde047", icon: "#eab308", dotClass: "bg-yellow-500" },
];

export const READER_THEME_PREVIEWS: Record<ReaderTheme, { bg: string; fg: string }> = {
    light: { bg: "#ffffff", fg: "#000000" },
    sepia: { bg: "#f4ecd8", fg: "#5f4b32" },
    dark: { bg: "#1a1a1a", fg: "#ffffff" },
};

export const DESIGN_TOKENS = {
    vars: DESIGN_TOKEN_VARS,
    themes: APP_THEME_PALETTES,
    highlights: HIGHLIGHT_COLOR_TOKENS,
    shelves: SHELF_COLOR_PALETTE,
    readerThemePreviews: READER_THEME_PREVIEWS,
} as const;
