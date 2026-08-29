import { useState } from "react";
import { cn } from "../core/lib/utils";

export interface TheoremBookCoverProps {
    title: string;
    author?: string;
    coverUrl?: string | null;
    className?: string;
    badge?: string;
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

    // High-craft Theorem Editorial Cover (Monochrome Typography)
    const cleanTitle = (title || "Untitled").trim();
    const cleanAuthor = (author || "Public Domain").trim();

    return (
        <div
            className={cn(
                "relative aspect-[2/3] w-full overflow-hidden bg-[#09090b] text-white p-3.5 sm:p-4 select-none flex flex-col justify-between border border-zinc-800 shadow-sm",
                className
            )}
        >
            {/* Outer and Inner Border Rules */}
            <div className="absolute inset-2 border border-zinc-800/80 pointer-events-none rounded-[2px]" />
            <div className="absolute inset-3 border border-zinc-900 pointer-events-none rounded-[1px]" />

            {/* Top Series Header */}
            <div className="relative z-10 text-center pt-1">
                <span className="text-[8px] sm:text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-400">
                    {badge}
                </span>
                <div className="w-8 h-[1px] bg-zinc-700 mx-auto mt-1.5" />
            </div>

            {/* Centered Title & Author Block */}
            <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2 text-center">
                <h3 className="font-serif text-xs sm:text-sm font-bold text-white leading-snug line-clamp-4 tracking-tight px-1">
                    {cleanTitle}
                </h3>
                <div className="w-6 h-[1px] bg-zinc-700 mx-auto my-2" />
                <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.14em] font-medium text-zinc-400 truncate max-w-[90%]">
                    {cleanAuthor}
                </p>
            </div>

            {/* Bottom Emblem */}
            <div className="relative z-10 flex items-center justify-center gap-1.5 pb-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2">
                    <polygon points="12 2 2 22 22 22" />
                </svg>
                <span className="text-[7px] tracking-[0.25em] uppercase font-bold text-zinc-400">
                    THEOREM
                </span>
            </div>
        </div>
    );
}
