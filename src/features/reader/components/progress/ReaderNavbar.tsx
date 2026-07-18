
import { useCallback, useMemo, useState, useRef, memo } from "react";
import { List } from "lucide-react";
import { cn } from "../../../../core/lib/utils";
import type { TocItem, DocLocation } from "../../../../core/types";

interface ReaderNavbarProps {
    location: DocLocation | null;
    toc: TocItem[];
    sectionFractions: number[];
    onSeek: (fraction: number) => void;
    totalPages?: number;
    onToggleToc: () => void;
    className?: string;
}

const AVERAGE_WPM = 225;

const WORDS_PER_PAGE = 250;

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

export const ReaderNavbar = memo(function ReaderNavbar({
    location,
    toc,
    sectionFractions,
    onSeek,
    totalPages,
    onToggleToc,
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

    const currentSectionLabel = useMemo(() => {
        if (location?.tocItem?.label) {
            return location.tocItem.label;
        }
        return getSectionLabelForFraction(progress) ?? "";
    }, [location?.tocItem?.label, getSectionLabelForFraction, progress]);

    const hoveredSectionLabel = useMemo(() => {
        if (hoverFraction === null) return null;
        return getSectionLabelForFraction(hoverFraction);
    }, [hoverFraction, getSectionLabelForFraction]);

    const timeRemaining = useMemo(() => {
        const pages = totalPages ?? location?.pageInfo?.totalPages ?? 0;
        if (pages <= 0) return null;
        return formatTimeRemaining(calculateTimeRemaining(progress, pages));
    }, [progress, totalPages, location?.pageInfo?.totalPages]);

    const progressText = useMemo(() => {
        const pct = Math.round(displayFraction * 100);
        return `${pct}%`;
    }, [displayFraction]);

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

    const handleClick = useCallback(
        (e: React.MouseEvent) => {
            if (isDragging) return;
            const fraction = getFractionFromEvent(e.clientX);
            onSeek(fraction);
        },
        [isDragging, getFractionFromEvent, onSeek]
    );

    const sectionMarkers = useMemo(() => {
        if (normalizedSectionFractions.length === 0) return null;

        return normalizedSectionFractions.map((fraction, index) => {
            
            if (fraction < 0.01) return null;
            
            if (fraction > 0.99) return null;
            
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
                "flex flex-col gap-1 px-3 py-1.5 sm:px-4",
                "border-t border-[var(--color-border)] bg-[var(--color-surface)]",
                className
            )}
            style={{
                paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))",
            }}
        >
            
            <div className="flex items-center gap-2">
                <button
                    onClick={onToggleToc}
                    className="flex items-center justify-center p-2 -ml-1 text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors h-9 w-9"
                    aria-label="Table of Contents"
                >
                    <List size={18} />
                </button>

                <div className="flex-1 flex items-center justify-between gap-1 text-[10px] sm:text-xs text-[color:var(--color-text-muted)] min-w-0">
                    <span
                        className="truncate max-w-[50%]"
                        title={currentSectionLabel}
                    >
                        {currentSectionLabel}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                        {timeRemaining && (
                            <span className="hidden sm:inline text-[color:var(--color-text-muted)]">{timeRemaining}</span>
                        )}
                        <span className="font-medium text-[color:var(--color-text-primary)]">
                            {progressText}
                        </span>
                    </div>
                </div>
            </div>

            <div
                ref={trackRef}
                className={cn(
                    "relative h-5 cursor-pointer select-none",
                    "flex items-center",
                    isDragging && "cursor-grabbing"
                )}
                onClick={handleClick}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
            >
                
                <div className="absolute inset-x-0 h-1 bg-[var(--color-surface-variant)] overflow-hidden">
                    
                    <div
                        className={cn(
                            "h-full bg-[var(--color-accent)]",
                            !isDragging && "transition-[width] duration-150"
                        )}
                        style={{ width: `${displayFraction * 100}%` }}
                    />
                </div>

                {sectionMarkers}

                <div
                    className={cn(
                        "absolute top-1/2 -translate-y-1/2 -translate-x-1/2",
                        "w-3 h-3",
                        "bg-[var(--color-accent)]",
                        "border-2 border-[var(--color-surface)]",
                        isDragging ? "scale-125" : "transition-transform",
                        "pointer-events-none"
                    )}
                    style={{ left: `${displayFraction * 100}%` }}
                />

                {(hoverFraction !== null || isDragging) && tooltipPosition !== null && (
                    <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-0.5 h-3 bg-[var(--color-accent)]/50 pointer-events-none"
                        style={{ left: `${tooltipPosition * 100}%` }}
                    />
                )}

                {tooltipContent && tooltipPosition !== null && (
                    <div
                        className={cn(
                            "absolute bottom-full mb-2 -translate-x-1/2",
                            "px-2 py-1.5",
                            "bg-[var(--color-surface)] border border-[var(--color-border)]",
                            "text-xs",
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
