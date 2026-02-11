/**
 * TheoremLogo Component
 * Simple SVG brand logo
 */

interface TheoremLogoProps {
    className?: string;
    size?: number;
}

export function TheoremLogo({ className, size = 32 }: TheoremLogoProps) {
    const logoColors = {
        face: "var(--color-accent-light)",
        mane: "var(--color-accent)",
        feature: "var(--color-text-primary)",
        eyeHighlight: "var(--color-surface)",
    };

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            {/* Face circle */}
            <circle
                cx="50"
                cy="50"
                r="45"
                fill={logoColors.face}
                stroke={logoColors.feature}
                strokeWidth="3"
            />

            {/* Mane - outer rays */}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => (
                <ellipse
                    key={i}
                    cx="50"
                    cy="50"
                    rx="12"
                    ry="25"
                    fill={logoColors.mane}
                    transform={`rotate(${angle} 50 50)`}
                />
            ))}

            {/* Inner face circle */}
            <circle cx="50" cy="50" r="30" fill={logoColors.face}/>

            {/* Eyes */}
            <circle cx="38" cy="42" r="5" fill={logoColors.feature}/>
            <circle cx="62" cy="42" r="5" fill={logoColors.feature}/>
            <circle cx="40" cy="40" r="2" fill={logoColors.eyeHighlight}/>
            <circle cx="64" cy="40" r="2" fill={logoColors.eyeHighlight}/>

            {/* Nose */}
            <ellipse cx="50" cy="55" rx="6" ry="4" fill={logoColors.feature}/>

            {/* Mouth */}
            <path
                d="M42 62 Q50 68 58 62"
                stroke={logoColors.feature}
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
            />

            {/* Whiskers */}
            <line x1="25" y1="52" x2="35" y2="55" stroke={logoColors.feature} strokeWidth="1"/>
            <line x1="25" y1="58" x2="35" y2="58" stroke={logoColors.feature} strokeWidth="1"/>
            <line x1="75" y1="52" x2="65" y2="55" stroke={logoColors.feature} strokeWidth="1"/>
            <line x1="75" y1="58" x2="65" y2="58" stroke={logoColors.feature} strokeWidth="1"/>
        </svg>
    );
}

export default TheoremLogo;
