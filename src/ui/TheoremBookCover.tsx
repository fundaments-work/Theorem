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
    badge,
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
            <div className={cn("relative aspect-[2/3] w-full overflow-hidden bg-[var(--color-surface-muted)]", className)}>
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

    const cleanTitle = (title || "Untitled").trim();
    const cleanAuthor = (author || "Public Domain").trim();

    return (
        <div
            className={cn(
                "relative aspect-[2/3] w-full overflow-hidden p-3 sm:p-3.5 select-none flex flex-col justify-between",
                "bg-[var(--color-surface-muted)] border border-[var(--color-border)] shadow-sm transition-transform duration-200",
                className
            )}
        >
            {/* Subtle Spine & Frame Accents */}
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-border)] opacity-60" />
            <div className="absolute inset-2 border border-[var(--color-border-subtle)] pointer-events-none rounded-[1px] opacity-40" />

            {/* Top Series / Badge Header */}
            <div className="relative z-10 text-center pt-1 min-h-[14px]">
                {badge ? (
                    <span className="text-[8px] sm:text-[9px] font-bold tracking-[0.2em] uppercase text-[color:var(--color-text-muted)]">
                        {badge}
                    </span>
                ) : (
                    <div className="w-6 h-[1px] mx-auto mt-2 bg-[var(--color-border)] opacity-40" />
                )}
            </div>

            {/* Centered Title & Author Block */}
            <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2 text-center">
                <h3 className="font-serif text-xs sm:text-sm font-bold leading-snug line-clamp-4 tracking-tight px-1 text-[color:var(--color-text-primary)]">
                    {cleanTitle}
                </h3>
                <div className="w-5 h-[1px] mx-auto my-2 bg-[var(--color-border)] opacity-60" />
                <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.14em] font-medium truncate max-w-[90%] text-[color:var(--color-text-secondary)] opacity-80">
                    {cleanAuthor}
                </p>
            </div>

            {/* Bottom Emblem */}
            <div className="relative z-10 flex items-center justify-center gap-1.5 pb-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="0" y="0" width="3" height="24" className="fill-[var(--color-text-muted)] opacity-60" />
                    <rect x="0" y="10.5" width="15" height="3" className="fill-[var(--color-text-muted)] opacity-60" />
                </svg>
                <span className="text-[7px] tracking-[0.25em] uppercase font-bold text-[color:var(--color-text-muted)] opacity-70">
                    THEOREM
                </span>
            </div>
        </div>
    );
}
