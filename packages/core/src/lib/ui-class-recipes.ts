/**
 * Shared Tailwind class recipes for common controls.
 *
 * These keep interaction styles consistent while still using semantic
 * design-token CSS variables for color, spacing, and motion.
 */

const UI_ACTIVE_BUTTON_STATE_CLASS =
    "data-[active=true]:border-[var(--color-accent)] data-[active=true]:bg-[var(--color-accent)] data-[active=true]:text-[var(--color-accent-contrast)] data-[active=true]:hover:border-[var(--color-accent-hover)] data-[active=true]:hover:bg-[var(--color-accent-hover)] data-[active=true]:hover:text-[var(--color-accent-contrast)] aria-[pressed=true]:border-[var(--color-accent)] aria-[pressed=true]:bg-[var(--color-accent)] aria-[pressed=true]:text-[var(--color-accent-contrast)] aria-[pressed=true]:hover:border-[var(--color-accent-hover)] aria-[pressed=true]:hover:bg-[var(--color-accent-hover)] aria-[pressed=true]:hover:text-[var(--color-accent-contrast)] aria-[selected=true]:border-[var(--color-accent)] aria-[selected=true]:bg-[var(--color-accent)] aria-[selected=true]:text-[var(--color-accent-contrast)] aria-[selected=true]:hover:border-[var(--color-accent-hover)] aria-[selected=true]:hover:bg-[var(--color-accent-hover)] aria-[selected=true]:hover:text-[var(--color-accent-contrast)]";

// Base structural/behavioral styles shared by all buttons
const UI_BUTTON_SHARED_BASE =
    "inline-flex min-h-10 items-center justify-center gap-2 border px-3.5 py-2 text-sm font-medium transition-[background-color,border-color,color,opacity] duration-200 ease-out [&_svg]:text-current disabled:cursor-not-allowed disabled:opacity-45";

export const UI_BUTTON_BASE_CLASS =
    `${UI_BUTTON_SHARED_BASE} border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)]`;

export const UI_BUTTON_PRIMARY_CLASS =
    `${UI_BUTTON_SHARED_BASE} border-[var(--color-accent)] bg-[var(--color-accent)] text-[var(--color-accent-contrast)] hover:border-[var(--color-accent-hover)] hover:bg-[var(--color-accent-hover)] hover:text-[var(--color-accent-contrast)]`;

export const UI_BUTTON_GHOST_CLASS =
    `${UI_BUTTON_SHARED_BASE} border-[var(--color-border-subtle)] bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)]`;

export const UI_BUTTON_DANGER_CLASS =
    `${UI_BUTTON_SHARED_BASE} border-[color-mix(in_srgb,var(--color-error)_24%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-error)_8%,var(--color-surface))] text-[var(--color-error)] hover:bg-[color-mix(in_srgb,var(--color-error)_14%,var(--color-surface))] hover:text-[var(--color-error)]`;

export const UI_ICON_BUTTON_BASE_CLASS =
    `inline-flex h-8 w-8 items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)] [&_svg]:text-current ${UI_ACTIVE_BUTTON_STATE_CLASS} focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45`;

export const UI_CHIP_BUTTON_BASE_CLASS =
    `w-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-[var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)] [&_svg]:text-current ${UI_ACTIVE_BUTTON_STATE_CLASS} focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45`;

export const UI_TAB_BUTTON_BASE_CLASS =
    `w-full min-h-10 border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs font-medium text-[var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text-primary)] [&_svg]:text-current ${UI_ACTIVE_BUTTON_STATE_CLASS} focus-visible:outline-2 focus-visible:outline-[var(--color-focus-ring)] focus-visible:outline-offset-2`;

export const UI_INPUT_BASE_CLASS =
    "min-h-10 w-full border border-[var(--color-border)] bg-[var(--color-background)] px-3.5 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-[background-color,border-color,color,box-shadow] duration-200 ease-out hover:border-[color-mix(in_srgb,var(--color-accent)_32%,var(--color-border))] focus-visible:border-[color-mix(in_srgb,var(--color-accent)_58%,var(--color-border))] focus-visible:outline-2 focus-visible:outline-[color-mix(in_srgb,var(--color-accent)_28%,transparent)] focus-visible:outline-offset-0";
