import { useState } from "react";
import { cn } from "../core/lib/utils";

export interface TheoremBookCoverProps {
    title: string;
    author?: string;
    coverUrl?: string | null;
    className?: string;
    badge?: string;
}

interface CoverPalette {
    bg: string;
    border: string;
    innerBorder: string;
    rule: string;
    titleColor: string;
    authorColor: string;
    badgeColor: string;
    logoColor: string;
}

const COVER_PALETTES: CoverPalette[] = [
    { // Obsidian Noir
        bg: "#09090b",
        border: "#27272a",
        innerBorder: "#18181b",
        rule: "#3f3f46",
        titleColor: "#ffffff",
        authorColor: "#a1a1aa",
        badgeColor: "#71717a",
        logoColor: "#a1a1aa",
    },
    { // Forest Library / Deep Pine
        bg: "#0c1712",
        border: "#1d382b",
        innerBorder: "#14261d",
        rule: "#2b523f",
        titleColor: "#f0fdf4",
        authorColor: "#86efac",
        badgeColor: "#4ade80",
        logoColor: "#86efac",
    },
    { // Bordeaux / Deep Wine
        bg: "#180c12",
        border: "#3d1b2a",
        innerBorder: "#27111b",
        rule: "#5c253d",
        titleColor: "#fdf2f8",
        authorColor: "#f472b6",
        badgeColor: "#ec4899",
        logoColor: "#f472b6",
    },
    { // Espresso / Warm Walnut
        bg: "#15120e",
        border: "#382c20",
        innerBorder: "#241c14",
        rule: "#544230",
        titleColor: "#fffbeb",
        authorColor: "#fcd34d",
        badgeColor: "#fbbf24",
        logoColor: "#fcd34d",
    },
    { // Midnight Indigo / Deep Ocean
        bg: "#0a101b",
        border: "#1a2c47",
        innerBorder: "#111c2e",
        rule: "#25416b",
        titleColor: "#eff6ff",
        authorColor: "#93c5fd",
        badgeColor: "#60a5fa",
        logoColor: "#93c5fd",
    },
    { // Imperial Plum / Deep Amethyst
        bg: "#130e1b",
        border: "#302047",
        innerBorder: "#1f142e",
        rule: "#4b306e",
        titleColor: "#faf5ff",
        authorColor: "#c084fc",
        badgeColor: "#a855f7",
        logoColor: "#c084fc",
    },
    { // Slate Umber / Architectural Graphite
        bg: "#101316",
        border: "#252d36",
        innerBorder: "#181d22",
        rule: "#394552",
        titleColor: "#f8fafc",
        authorColor: "#94a3b8",
        badgeColor: "#64748b",
        logoColor: "#94a3b8",
    },
];

function getPaletteForBook(title: string, author?: string): CoverPalette {
    const key = `${title}-${author || ""}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash << 5) - hash + key.charCodeAt(i);
        hash |= 0;
    }
    const index = Math.abs(hash) % COVER_PALETTES.length;
    return COVER_PALETTES[index];
}

export function TheoremBookCover({
    title,
    author,
    coverUrl,
    className,
    badge = "THEOREM CLASSICS",
}: TheoremBookCoverProps) {
    const [imageError, setImageError] = useState(false);

    // Filter out Gutenberg's tiny 16x16 / 22x22 placeholder base64 icons
    const isTinyPlaceholderIcon =
        typeof coverUrl === "string" &&
        coverUrl.startsWith("data:image/png;base64") &&
        coverUrl.length < 5000;

    const hasValidImage = Boolean(coverUrl && !isTinyPlaceholderIcon && !imageError);

    if (hasValidImage) {
        return (
            <div className={cn("relative aspect-[2/3] w-full overflow-hidden bg-zinc-950", className)}>
                <img
                    src={coverUrl!}
                    alt={title}
                    loading="lazy"
                    onError={() => setImageError(true)}
                    className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
                />
            </div>
        );
    }

    // High-craft Theorem Editorial Clothbound Cover
    const cleanTitle = (title || "Untitled").trim();
    const cleanAuthor = (author || "Public Domain").trim();
    const palette = getPaletteForBook(cleanTitle, cleanAuthor);

    return (
        <div
            style={{ backgroundColor: palette.bg, borderColor: palette.border }}
            className={cn(
                "relative aspect-[2/3] w-full overflow-hidden p-3.5 sm:p-4 select-none flex flex-col justify-between border shadow-sm transition-transform duration-200",
                className
            )}
        >
            {/* Outer and Inner Border Rules */}
            <div
                style={{ borderColor: palette.border }}
                className="absolute inset-2 border pointer-events-none rounded-[2px]"
            />
            <div
                style={{ borderColor: palette.innerBorder }}
                className="absolute inset-3 border pointer-events-none rounded-[1px]"
            />

            {/* Top Series Header */}
            <div className="relative z-10 text-center pt-1">
                <span
                    style={{ color: palette.badgeColor }}
                    className="text-[8px] sm:text-[9px] font-bold tracking-[0.2em] uppercase"
                >
                    {badge}
                </span>
                <div
                    style={{ backgroundColor: palette.rule }}
                    className="w-8 h-[1px] mx-auto mt-1.5 opacity-80"
                />
            </div>

            {/* Centered Title & Author Block */}
            <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2 text-center">
                <h3
                    style={{ color: palette.titleColor }}
                    className="font-serif text-xs sm:text-sm font-bold leading-snug line-clamp-4 tracking-tight px-1 drop-shadow-sm"
                >
                    {cleanTitle}
                </h3>
                <div
                    style={{ backgroundColor: palette.rule }}
                    className="w-6 h-[1px] mx-auto my-2 opacity-80"
                />
                <p
                    style={{ color: palette.authorColor }}
                    className="text-[9px] sm:text-[10px] uppercase tracking-[0.14em] font-medium truncate max-w-[90%]"
                >
                    {cleanAuthor}
                </p>
            </div>

            {/* Bottom Emblem */}
            <div className="relative z-10 flex items-center justify-center gap-2 pb-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0" y="0" width="3" height="24" fill={palette.logoColor} />
                    <rect x="0" y="10.5" width="15" height="3" fill={palette.logoColor} />
                </svg>
                <span
                    style={{ color: palette.badgeColor }}
                    className="text-[7px] tracking-[0.25em] uppercase font-bold"
                >
                    THEOREM
                </span>
            </div>
        </div>
    );
}
