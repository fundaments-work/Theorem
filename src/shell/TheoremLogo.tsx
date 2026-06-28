/**
 * TheoremLogo Component
 * Turnstile mark (⊢) — the logical notation for "derives."
 * Built from two rectangles per design.md spec so it renders
 * identically across every platform, weight, and rasterizer.
 */

interface TheoremLogoProps {
    className?: string;
    size?: number;
}

export function TheoremLogo({ className, size = 32 }: TheoremLogoProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-hidden="true"
            focusable="false"
        >
            <rect
                x="0"
                y="0"
                width="3"
                height="24"
                fill="currentColor"
            />
            <rect
                x="0"
                y="10.5"
                width="15"
                height="3"
                fill="currentColor"
            />
        </svg>
    );
}

export default TheoremLogo;
