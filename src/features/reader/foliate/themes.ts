/**
 * Themes - 3 themes only (Light, Sepia, Dark)
 * Ported from Foliate GTK app
 */

import { getThemeColors, type ReaderTheme } from "../../../core";

export interface ThemeColors {
    fg: string;
    bg: string;
    link: string;
}

export interface Theme {
    name: ReaderTheme;
    label: string;
    light: ThemeColors;
    dark: ThemeColors;
}

const THEME_LABELS: Record<ReaderTheme, string> = {
    light: "Light",
    sepia: "Sepia",
    dark: "Dark",
};

const THEME_ORDER: ReaderTheme[] = ["light", "sepia", "dark"];

function buildTheme(name: ReaderTheme): Theme {
    const colors = getThemeColors(name);
    return {
        name,
        label: THEME_LABELS[name],
        light: { ...colors },
        dark: { ...colors },
    };
}

export const themes: Theme[] = THEME_ORDER.map((themeName) => buildTheme(themeName));

export const invertTheme = (theme: Theme) => ({
    ...theme,
    inverted: {
        fg: theme.dark.bg,
        link: theme.dark.bg,
    },
});

export const getTheme = (name: string): Theme => {
    const themeName = THEME_ORDER.find((theme) => theme === name) ?? "light";
    return buildTheme(themeName);
};
