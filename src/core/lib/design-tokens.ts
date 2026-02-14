import type { HighlightColor, ReaderTheme } from "../types";

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
        appBg: "#ffffff",
        appSurface: "#ffffff",
        appSurfaceElevated: "#ffffff",
        appSurfaceMuted: "#fafafa",
        appSurfaceVariant: "#f4f4f4",
        appSurfaceHover: "#f0f0f0",
        appTextPrimary: "#1a1a1a",
        appTextSecondary: "#666666",
        appTextMuted: "#666666",
        appTextInverse: "#ffffff",
        appBorder: "#e5e5e5",
        appBorderSubtle: "#e5e5e5",
        appAccent: "#1a1a1a",
        appAccentHover: "#000000",
        appAccentLight: "#f4f4f4",
        appAccentContrast: "#ffffff",
        appSuccess: "#1a1a1a",
        appWarning: "#1a1a1a",
        appError: "#000000",
        appInfo: "#666666",
        appOverlaySubtle: "color-mix(in srgb, #000000 8%, transparent)",
        appOverlayMedium: "color-mix(in srgb, #000000 14%, transparent)",
        appOverlayStrong: "color-mix(in srgb, #000000 25%, transparent)",
        appOverlayStrongHover: "color-mix(in srgb, #000000 33%, transparent)",
        readerBg: "#ffffff",
        readerFg: "#1a1a1a",
        readerLink: "#1a1a1a",
    },
    sepia: {
        appBg: "#ffffff",
        appSurface: "#ffffff",
        appSurfaceElevated: "#ffffff",
        appSurfaceMuted: "#fafafa",
        appSurfaceVariant: "#f4f4f4",
        appSurfaceHover: "#f0f0f0",
        appTextPrimary: "#1a1a1a",
        appTextSecondary: "#666666",
        appTextMuted: "#666666",
        appTextInverse: "#ffffff",
        appBorder: "#e5e5e5",
        appBorderSubtle: "#e5e5e5",
        appAccent: "#1a1a1a",
        appAccentHover: "#000000",
        appAccentLight: "#f4f4f4",
        appAccentContrast: "#ffffff",
        appSuccess: "#1a1a1a",
        appWarning: "#1a1a1a",
        appError: "#000000",
        appInfo: "#666666",
        appOverlaySubtle: "color-mix(in srgb, #000000 8%, transparent)",
        appOverlayMedium: "color-mix(in srgb, #000000 14%, transparent)",
        appOverlayStrong: "color-mix(in srgb, #000000 25%, transparent)",
        appOverlayStrongHover: "color-mix(in srgb, #000000 33%, transparent)",
        readerBg: "#f4ecd8",
        readerFg: "#3d3025",
        readerLink: "#3d3025",
    },
    dark: {
        appBg: "#000000",
        appSurface: "#000000",
        appSurfaceElevated: "#111111",
        appSurfaceMuted: "#1a1a1a",
        appSurfaceVariant: "#222222",
        appSurfaceHover: "#2a2a2a",
        appTextPrimary: "#ffffff",
        appTextSecondary: "#b0b0b0",
        appTextMuted: "#808080",
        appTextInverse: "#000000",
        appBorder: "#333333",
        appBorderSubtle: "#2a2a2a",
        appAccent: "#ffffff",
        appAccentHover: "#e0e0e0",
        appAccentLight: "#1a1a1a",
        appAccentContrast: "#000000",
        appSuccess: "#ffffff",
        appWarning: "#ffffff",
        appError: "#ff4444",
        appInfo: "#b0b0b0",
        appOverlaySubtle: "color-mix(in srgb, #ffffff 8%, transparent)",
        appOverlayMedium: "color-mix(in srgb, #ffffff 14%, transparent)",
        appOverlayStrong: "color-mix(in srgb, #000000 65%, transparent)",
        appOverlayStrongHover: "color-mix(in srgb, #000000 75%, transparent)",
        readerBg: "#000000",
        readerFg: "#ffffff",
        readerLink: "#ffffff",
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
    { bg: "#f8f8f8", text: "#111111", border: "#d4d4d4", icon: "#1a1a1a", dotClass: "bg-zinc-300" },
    { bg: "#f4f4f4", text: "#111111", border: "#d0d0d0", icon: "#1a1a1a", dotClass: "bg-zinc-400" },
    { bg: "#f0f0f0", text: "#111111", border: "#c8c8c8", icon: "#1f1f1f", dotClass: "bg-neutral-400" },
    { bg: "#ebebeb", text: "#111111", border: "#c2c2c2", icon: "#222222", dotClass: "bg-neutral-500" },
    { bg: "#e7e7e7", text: "#111111", border: "#bcbcbc", icon: "#242424", dotClass: "bg-stone-500" },
    { bg: "#e3e3e3", text: "#111111", border: "#b6b6b6", icon: "#262626", dotClass: "bg-slate-500" },
    { bg: "#dedede", text: "#111111", border: "#afafaf", icon: "#282828", dotClass: "bg-slate-600" },
    { bg: "#d9d9d9", text: "#111111", border: "#a8a8a8", icon: "#2a2a2a", dotClass: "bg-zinc-600" },
    { bg: "#d4d4d4", text: "#111111", border: "#a1a1a1", icon: "#2d2d2d", dotClass: "bg-zinc-700" },
    { bg: "#cfcfcf", text: "#111111", border: "#9a9a9a", icon: "#303030", dotClass: "bg-neutral-700" },
    { bg: "#cacaca", text: "#111111", border: "#949494", icon: "#333333", dotClass: "bg-neutral-800" },
    { bg: "#c5c5c5", text: "#111111", border: "#8e8e8e", icon: "#363636", dotClass: "bg-stone-700" },
    { bg: "#c0c0c0", text: "#111111", border: "#878787", icon: "#383838", dotClass: "bg-slate-700" },
    { bg: "#bbbbbb", text: "#111111", border: "#818181", icon: "#3b3b3b", dotClass: "bg-slate-800" },
    { bg: "#b6b6b6", text: "#111111", border: "#7a7a7a", icon: "#3e3e3e", dotClass: "bg-zinc-800" },
];

export const READER_THEME_PREVIEWS: Record<ReaderTheme, { bg: string; fg: string }> = {
    light: { bg: "#ffffff", fg: "#1a1a1a" },
    sepia: { bg: "#f4ecd8", fg: "#3d3025" },
    dark: { bg: "#000000", fg: "#ffffff" },
};

export const DESIGN_TOKENS = {
    vars: DESIGN_TOKEN_VARS,
    themes: APP_THEME_PALETTES,
    highlights: HIGHLIGHT_COLOR_TOKENS,
    shelves: SHELF_COLOR_PALETTE,
    readerThemePreviews: READER_THEME_PREVIEWS,
} as const;
