/**
 * TheoremLogo Component
 * Square mark used across Theorem branding.
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
                x="1"
                y="1"
                width="22"
                height="22"
                fill="var(--color-text-primary)"
            />
            <rect
                x="5"
                y="5"
                width="14"
                height="14"
                fill="var(--color-surface)"
            />
            <rect
                x="8"
                y="8"
                width="8"
                height="8"
                fill="var(--color-text-primary)"
            />
        </svg>
    );
}

export default TheoremLogo;
