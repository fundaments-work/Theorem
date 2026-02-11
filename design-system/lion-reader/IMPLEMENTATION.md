# Lion Reader Design Token Implementation

Lion Reader now uses a complete token system covering color, typography, spacing,
layout, sizing, elevation, motion, controls, and z-index.

## Sources of truth

1. `src/index.css`
   - Defines all CSS custom properties used by the UI:
     - Semantic color tokens (`--color-*`)
     - Reader tokens (`--reader-*`)
     - Spacing, radius, shadow tokens
     - Typography scale (font families, sizes, line heights, weights, letter spacing)
     - Motion tokens (durations + transitions)
     - Layout tokens (container widths, sidebar, chrome, panel sizes)
     - Controls and icon sizing tokens
     - Z-index tokens
   - Defines theme overrides for:
     - `.theme-light`
     - `.theme-sepia`
     - `.theme-dark`
   - Provides shared semantic utility classes (`ui-*`, `reader-*`).

2. `src/lib/design-tokens.ts`
   - Exposes a typed TS token catalog for app code:
     - `DESIGN_TOKEN_VARS`: full semantic token map (`var(--...)`) grouped by domain:
       - `color`, `reader`, `spacing`, `radius`, `shadow`
       - `typography`, `motion`, `layout`, `controls`, `zIndex`, `breakpoints`
     - `APP_THEME_PALETTES`: full per-theme semantic palette references
     - Existing content/domain palettes:
       - `HIGHLIGHT_COLOR_TOKENS` (+ derived maps)
       - `SHELF_COLOR_PALETTE`
       - `READER_THEME_PREVIEWS`
     - Aggregated export:
       - `DESIGN_TOKENS`

## Usage guidance

- Use semantic token variables in CSS and classes:
  - `var(--color-surface)`, `var(--color-border)`, `var(--color-accent)`, etc.
- In TS, import `DESIGN_TOKEN_VARS` for inline style values:
  - `DESIGN_TOKEN_VARS.color.accent`
  - `DESIGN_TOKEN_VARS.layout.panel.readerWidth`
  - `DESIGN_TOKEN_VARS.typography.size.sm`
- Avoid hardcoded hex/px values in components unless they are content-specific
  (for example, annotation color palettes).

## How to change design globally

1. Edit token values in `src/index.css` (`@theme` + `.theme-*` overrides).
2. If needed, update token structure/types in `src/lib/design-tokens.ts`.
3. Rebuild and verify:
   - `./node_modules/.bin/tsc --noEmit`
   - `./node_modules/.bin/vite build`

Changing these files now updates layout sizing, typography rhythm, and color behavior
consistently across the app.
