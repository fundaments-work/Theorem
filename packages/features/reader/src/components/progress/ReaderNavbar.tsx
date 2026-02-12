/**
 * ReaderNavbar Component
 * Bottom navigation bar with progress slider, section markers, and time remaining
 * Inspired by Foliate GTK4's navbar implementation
 */

import { useCallback, useMemo, useState, useRef, useEffect, memo } from "react";
import { cn } from "@lionreader/core";
import type { TocItem, DocLocation } from "@lionreader/core";

interface ReaderNavbarProps {
    location: DocLocation | null;
    toc: TocItem[];
    sectionFractions: number[];
    onSeek: (fraction: number) => void;
    totalPages?: number;
    className?: string;
}

// Average reading speed in words per minute
const AVERAGE_WPM = 225;
// Average words per page (rough estimate for e-books)
const WORDS_PER_PAGE = 250;

/**
 * Format time remaining in a human-readable way
 */
function formatTimeRemaining(minutes: number): string {
    if (minutes < 1) {
        return "< 1 min left";
    }
    if (minutes < 60) {
        return `${Math.round(minutes)} min left`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMins = Math.round(minutes % 60);
    if (remainingMins === 0) {
        return `${hours} hr left`;
    }
    return `${hours} hr ${remainingMins} min left`;
}

/**
 * Calculate estimated reading time remaining based on pages
 */
function calculateTimeRemaining(
    currentProgress: number,
    totalPages: number
): number {
    if (totalPages <= 0 || currentProgress >= 1) return 0;

    const pagesRemaining = Math.ceil(totalPages * (1 - currentProgress));
    const wordsRemaining = pagesRemaining * WORDS_PER_PAGE;
    const minutesRemaining = wordsRemaining / AVERAGE_WPM;

    return minutesRemaining;
}

/**
 * ReaderNavbar - Foliate-style bottom progress bar
 */
export const ReaderNavbar = memo(function ReaderNavbar({
    location,
    toc,
    sectionFractions,
    onSeek,
    totalPages,
    className,
}: ReaderNavbarProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [hoverFraction, setHoverFraction] = useState<number | null>(null);
    const [dragFraction, setDragFraction] = useState<number | null>(null);
    const trackRef = useRef<HTMLDivElement>(null);

    const normalizedSectionFractions = useMemo(() => {
        if (sectionFractions.length === 0) {
            return [];
        }

        const normalized: number[] = [];
        let last = -1;
        for (const fraction of sectionFractions) {
            if (!Number.isFinite(fraction)) {
                continue;
            }
            const clamped = Math.max(0, Math.min(1, fraction));
            if (clamped + 1e-6 < last) {
                continue;
            }
            if (Math.abs(clamped - last) < 1e-4) {
                continue;
            }
            normalized.push(clamped);
            last = clamped;
        }
        return normalized;
    }, [sectionFractions]);

    // Current progress (0-1).
    // Prefer page-based progress when available for paginated flow consistency.
    const progress = useMemo(() => {
        const percentage = typeof location?.percentage === "number" && Number.isFinite(location.percentage)
            ? Math.max(0, Math.min(1, location.percentage))
            : 0;
        const pageInfo = location?.pageInfo;
        if (pageInfo && pageInfo.totalPages > 1) {
            const pageFraction = (pageInfo.currentPage - 1) / (pageInfo.totalPages - 1);
            if (Number.isFinite(pageFraction)) {
                return Math.max(0, Math.min(1, pageFraction));
            }
        }
        return percentage;
    }, [location?.percentage, location?.pageInfo?.currentPage, location?.pageInfo?.totalPages]);

    // Display fraction (drag position takes precedence when dragging)
    const displayFraction = isDragging && dragFraction !== null ? dragFraction : progress;

    const getSectionLabelForFraction = useCallback((fraction: number): string | null => {
        if (toc.length === 0) {
            return null;
        }
        if (normalizedSectionFractions.length === 0) {
            return toc[0]?.label ?? null;
        }
        for (let i = normalizedSectionFractions.length - 1; i >= 0; i--) {
            if (normalizedSectionFractions[i] <= fraction) {
                const tocIndex = Math.max(0, Math.min(i, toc.length - 1));
                return toc[tocIndex]?.label ?? null;
            }
        }
        return toc[0]?.label ?? null;
    }, [toc, normalizedSectionFractions]);

    // Current section label
    const currentSectionLabel = useMemo(() => {
        if (location?.tocItem?.label) {
            return location.tocItem.label;
        }
        return getSectionLabelForFraction(progress) ?? "";
    }, [location?.tocItem?.label, getSectionLabelForFraction, progress]);

    // Hovered section label (for tooltip)
    const hoveredSectionLabel = useMemo(() => {
        if (hoverFraction === null) return null;
        return getSectionLabelForFraction(hoverFraction);
    }, [hoverFraction, getSectionLabelForFraction]);

    // Time remaining estimate
    const timeRemaining = useMemo(() => {
        const pages = totalPages ?? location?.pageInfo?.totalPages ?? 0;
        if (pages <= 0) return null;
        return formatTimeRemaining(calculateTimeRemaining(progress, pages));
    }, [progress, totalPages, location?.pageInfo?.totalPages]);

    // Progress text (percentage)
    const progressText = useMemo(() => {
        const pct = Math.round(displayFraction * 100);
        return `${pct}%`;
    }, [displayFraction]);

    // Calculate fraction from mouse/touch position
    const getFractionFromEvent = useCallback(
        (clientX: number): number => {
            const track = trackRef.current;
            if (!track) return 0;

            const rect = track.getBoundingClientRect();
            const x = clientX - rect.left;
            const fraction = Math.max(0, Math.min(1, x / rect.width));
            return fraction;
        },
        []
    );

    // Mouse/touch handlers
    const handlePointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault();
            const fraction = getFractionFromEvent(e.clientX);
            setIsDragging(true);
            setDragFraction(fraction);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
        },
        [getFractionFromEvent]
    );

    const handlePointerMove = useCallback(
        (e: React.PointerEvent) => {
            const fraction = getFractionFromEvent(e.clientX);
            if (isDragging) {
                setDragFraction(fraction);
            } else {
                setHoverFraction(fraction);
            }
        },
        [getFractionFromEvent, isDragging]
    );

    const handlePointerUp = useCallback(
        (e: React.PointerEvent) => {
            if (isDragging && dragFraction !== null) {
                onSeek(dragFraction);
            }
            setIsDragging(false);
            setDragFraction(null);
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        },
        [isDragging, dragFraction, onSeek]
    );

    const handlePointerLeave = useCallback(() => {
        if (!isDragging) {
            setHoverFraction(null);
        }
    }, [isDragging]);

    // Click to seek (when not dragging)
    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            if (isDragging) return;
            const fraction = getFractionFromEvent(e.clientX);
            onSeek(fraction);
        },
        [isDragging, getFractionFromEvent, onSeek]
    );

    // Section markers - memoized to prevent re-renders
    const sectionMarkers = useMemo(() => {
        if (normalizedSectionFractions.length === 0) return null;

        return normalizedSectionFractions.map((fraction, index) => {
            // Skip first marker at 0%
            if (fraction < 0.01) return null;
            // Skip last marker at 100%
            if (fraction > 0.99) return null;
            // Skip markers too close together (< 2%)
            if (index > 0 && fraction - normalizedSectionFractions[index - 1] < 0.02) return null;

            return (
                <div
                    key={index}
                    className="absolute top-1/2 -translate-y-1/2 w-px h-2 bg-[var(--color-text-muted)]/40"
                    style={{ left: `${fraction * 100}%` }}
                />
            );
        });
    }, [normalizedSectionFractions]);

    // Tooltip content
    const tooltipContent = useMemo(() => {
        if (hoverFraction === null && !isDragging) return null;

        const fraction = isDragging ? dragFraction : hoverFraction;
        if (fraction === null) return null;

        const pct = Math.round(fraction * 100);
        return (
            <div className="text-center">
                <div className="font-medium">{pct}%</div>
                {hoveredSectionLabel && (
                    <div className="text-[color:var(--color-text-muted)] text-xs max-w-[var(--layout-tooltip-max-width)] truncate">
                        {hoveredSectionLabel}
                    </div>
                )}
            </div>
        );
    }, [hoverFraction, isDragging, dragFraction, hoveredSectionLabel]);

    const tooltipPosition = isDragging ? dragFraction : hoverFraction;

    return (
        <div
            className={cn(
                "flex flex-col gap-1.5 px-3 py-2 sm:px-4",
                "bg-[var(--color-surface)] border-t border-[var(--color-border)]",
                className
            )}
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
            {/* Info row: section label + time remaining */}
            <div className="flex items-center justify-between gap-2 text-[var(--font-size-2xs)] sm:text-xs text-[color:var(--color-text-muted)]">
                <span className="truncate max-w-[52%] sm:max-w-[60%]">{currentSectionLabel}</span>
                <div className="flex items-center gap-2">
                    {timeRemaining && (
                        <span className="hidden sm:inline text-[color:var(--color-text-muted)]">{timeRemaining}</span>
                    )}
                    <span className="font-medium text-[color:var(--color-text-primary)]">
                        {progressText}
                    </span>
                </div>
            </div>

            {/* Progress track */}
            <div
                ref={trackRef}
                className={cn(
                    "relative h-7 sm:h-6 cursor-pointer select-none",
                    "flex items-center",
                    isDragging && "cursor-grabbing"
                )}
                onClick={handleClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
            >
                {/* Track background */}
                <div className="absolute inset-x-0 h-1 bg-[var(--color-surface-variant)] rounded-full overflow-hidden">
                    {/* Progress fill */}
                    <div
                        className={cn(
                            "h-full bg-[var(--color-accent)] rounded-full",
                            !isDragging && "transition-[width] duration-150"
                        )}
                        style={{ width: `${displayFraction * 100}%` }}
                    />
                </div>

                {/* Section markers */}
                {sectionMarkers}

                {/* Thumb handle */}
                <div
                    className={cn(
                        "absolute top-1/2 -translate-y-1/2 -translate-x-1/2",
                        "w-3 h-3 rounded-full",
                        "bg-[var(--color-accent)]",
                        "border-2 border-[var(--color-surface)]",
                        "shadow-sm",
                        isDragging ? "scale-125" : "transition-transform",
                        "pointer-events-none"
                    )}
                    style={{ left: `${displayFraction * 100}%` }}
                />

                {/* Hover/drag indicator line */}
                {(hoverFraction !== null || isDragging) && tooltipPosition !== null && (
                    <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 bg-[var(--color-accent)]/50 pointer-events-none"
                        style={{ left: `${tooltipPosition * 100}%` }}
                    />
                )}

                {/* Tooltip */}
                {tooltipContent && tooltipPosition !== null && (
                    <div
                        className={cn(
                            "absolute bottom-full mb-2 -translate-x-1/2",
                            "px-2 py-1.5",
                            "bg-[var(--color-surface)] border border-[var(--color-border)]",
                            "rounded-md shadow-lg text-xs",
                            "pointer-events-none z-50",
                            "whitespace-nowrap"
                        )}
                        style={{ left: `${tooltipPosition * 100}%` }}
                    >
                        {tooltipContent}
                    </div>
                )}
            </div>
        </div>
    );
});

export default ReaderNavbar;
