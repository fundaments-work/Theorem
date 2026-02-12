/**
 * TheoremLogo Component
 * Geometric brand monogram for Theorem.
 */

interface TheoremLogoProps {
    className?: string;
    size?: number;
}

export function TheoremLogo({ className, size = 32 }: TheoremLogoProps) {
    const logoColors = {
        tile: "color-mix(in srgb, var(--color-surface) 82%, var(--color-accent-light))",
        tileHighlight: "color-mix(in srgb, var(--color-accent) 9%, transparent)",
        frame: "color-mix(in srgb, var(--color-accent) 42%, var(--color-border))",
        glyph: "var(--color-accent)",
        glyphSoft: "color-mix(in srgb, var(--color-accent) 68%, var(--color-text-primary))",
    };

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 96 96"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <rect
                x="8"
                y="8"
                width="80"
                height="80"
                rx="22"
                fill={logoColors.tile}
                stroke={logoColors.frame}
                strokeWidth="2.5"
            />
            <path
                d="M14 18C27 11 43 9 58 11C72 13 84 18 90 26V8H8V34C9 28 11 22 14 18Z"
                fill={logoColors.tileHighlight}
                opacity="0.95"
            />

            <path d="M28 32H68" stroke={logoColors.glyph} strokeWidth="8" strokeLinecap="round" />
            <path d="M48 32V58" stroke={logoColors.glyph} strokeWidth="8" strokeLinecap="round" />
            <path d="M31 66C36 62 42 60 48 60C54 60 60 62 65 66" stroke={logoColors.glyphSoft} strokeWidth="4.5" strokeLinecap="round" />

            {/* "Therefore" three-dot motif */}
            <circle cx="48" cy="70" r="3.5" fill={logoColors.glyph} />
            <circle cx="40.5" cy="78" r="3.5" fill={logoColors.glyph} />
            <circle cx="55.5" cy="78" r="3.5" fill={logoColors.glyph} />
        </svg>
    );
}

export default TheoremLogo;
