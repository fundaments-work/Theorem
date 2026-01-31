/**
 * Themes - 3 themes only (Light, Sepia, Dark)
 * Ported from Foliate GTK app
 */

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
        name: 'light',
        label: 'Light',
        light: { fg: '#000000', bg: '#ffffff', link: '#0066cc' },
        dark: { fg: '#000000', bg: '#ffffff', link: '#0066cc' }
    },
    {
        name: 'sepia',
        label: 'Sepia',
        light: { fg: '#5b4636', bg: '#f1e8d0', link: '#008b8b' },
        dark: { fg: '#ffd595', bg: '#342e25', link: '#48d1cc' }
    },
    {
        name: 'dark',
        label: 'Dark',
        light: { fg: '#e0e0e0', bg: '#222222', link: '#77bbee' },
        dark: { fg: '#e0e0e0', bg: '#222222', link: '#77bbee' }
    }
];

export const invertTheme = (theme: Theme) => ({
    ...theme,
    inverted: {
        fg: theme.dark.bg,
        link: theme.dark.bg
    }
});

export const getTheme = (name: string): Theme => {
    return themes.find(t => t.name === name) || themes[0];
};
