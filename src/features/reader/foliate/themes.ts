/**
 * Themes - 3 themes only (Light, Sepia, Dark)
 * Ported from Foliate GTK app
 */

import { APP_THEME_PALETTES } from "../../../core";

export interface ThemeColors {
    fg: string;
    bg: string;
    link: string;
}

export interface Theme {
    name: string;
    label: string;
    light: ThemeColors;
    dark: ThemeColors;
}

export const themes: Theme[] = [
    {
        name: "light",
        label: "Light",
        light: {
            fg: APP_THEME_PALETTES.light.readerFg,
            bg: APP_THEME_PALETTES.light.readerBg,
            link: APP_THEME_PALETTES.light.readerLink,
        },
        dark: {
            fg: APP_THEME_PALETTES.light.readerFg,
            bg: APP_THEME_PALETTES.light.readerBg,
            link: APP_THEME_PALETTES.light.readerLink,
        },
    },
    {
        name: "sepia",
        label: "Sepia",
        light: {
            fg: APP_THEME_PALETTES.sepia.readerFg,
            bg: APP_THEME_PALETTES.sepia.readerBg,
            link: APP_THEME_PALETTES.sepia.readerLink,
        },
        dark: {
            fg: APP_THEME_PALETTES.sepia.readerFg,
            bg: APP_THEME_PALETTES.sepia.readerBg,
            link: APP_THEME_PALETTES.sepia.readerLink,
        },
    },
    {
        name: "dark",
        label: "Dark",
        light: {
            fg: APP_THEME_PALETTES.dark.readerFg,
            bg: APP_THEME_PALETTES.dark.readerBg,
            link: APP_THEME_PALETTES.dark.readerLink,
        },
        dark: {
            fg: APP_THEME_PALETTES.dark.readerFg,
            bg: APP_THEME_PALETTES.dark.readerBg,
            link: APP_THEME_PALETTES.dark.readerLink,
        },
    },
];

export const invertTheme = (theme: Theme) => ({
    ...theme,
    inverted: {
        fg: theme.dark.bg,
        link: theme.dark.bg,
    },
});

export const getTheme = (name: string): Theme => {
    return themes.find((theme) => theme.name === name) || themes[0];
};
