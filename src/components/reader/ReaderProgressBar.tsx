/**
 * ReaderProgressBar Component
 * Progress bar with chapter markers - Page-based display
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { DocLocation, TocItem, BookSection } from '@/types';
import { flattenToc } from '@/lib/toc';

interface ReaderProgressBarProps {
    location: DocLocation | null;
    toc?: TocItem[];
    sectionFractions?: number[];
    sections?: BookSection[];
    visible?: boolean;
    onSeek: (fraction: number) => void;
    className?: string;
    // Saved page progress for instant correct display on reopen
    savedPageProgress?: {
        currentPage: number;
        endPage?: number;
        totalPages: number;
        range: string;
    };
    // Layout mode for display format
    layout?: 'single' | 'double' | 'auto';
}

interface SectionData {
    index: number;
    fraction: number;
    nextFraction: number;
    width: number;
    label: string;
    href: string;
}

// Fast stabilization for responsive feel
const SEEK_STABILIZE_DELAY = 50;

export function ReaderProgressBar({
    location,
    toc,
    sections: sectionsProp,
    sectionFractions,
    onSeek,
    className,
    savedPageProgress,
    layout = 'single',
}: ReaderProgressBarProps) {
    const [hoverFraction, setHoverFraction] = useState<number | null>(null);
    const [userControlledFraction, setUserControlledFraction] = useState<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const stabilizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSeekFractionRef = useRef<number | null>(null);
    const hoverFractionRef = useRef<number | null>(null);

    // Use live page info from location, or fall back to saved page progress
    const pageInfo = location?.pageInfo;
    const hasLivePages = !!pageInfo && pageInfo.totalPages > 0;

    // Use live page info when available, fallback to saved progress
    const currentPage = hasLivePages
        ? pageInfo.currentPage
        : (savedPageProgress?.currentPage ?? 0);
    const endPage = hasLivePages
        ? pageInfo.endPage
        : (savedPageProgress?.endPage ?? 0);
    const totalPages = hasLivePages
        ? pageInfo.totalPages
        : (savedPageProgress?.totalPages ?? 0);

    // Format page display based on layout mode
    // Single: "2/20", Double: "1-2/10" (showing actual pages being viewed)
    let pageDisplay: string;
    if (totalPages > 0) {
        if (layout === 'double' && endPage && endPage > currentPage) {
            // Double layout showing a spread: show range like "1-2"
            pageDisplay = `${currentPage}-${endPage}`;
        } else {
            // Single layout or only one page visible: show single number
            pageDisplay = `${currentPage}`;
        }
    } else {
        pageDisplay = '-';
    }

    // For total pages display: single shows total as-is, double shows half (since 2 pages per spread)
    // Actually, the total pages should represent actual page count, not spread count
    // So we keep the total as-is for both modes
    const totalDisplay = totalPages > 0 ? totalPages : '-';

    // Note: savedPageProgress is used above as fallback when live pages aren't available yet

    // Calculate fill fraction based on page position
    // Uses saved progress initially for instant correct display, then live data
    const pageFraction = totalPages > 0
        ? (currentPage - 1) / totalPages
        : (location?.percentage ?? 0);
    
    // Determine what fraction to display:
    // 1. User-controlled (during clicking/dragging) for immediate feedback
    // 2. Page-based fraction if available, otherwise percentage-based
    const displayFraction = userControlledFraction !== null
        ? userControlledFraction
        : pageFraction;

    // Build sections - use shared flattenToc utility
    const sections = useMemo<SectionData[]>(() => {
        const flatToc = toc ? flattenToc(toc) : [];

        if (sectionsProp && sectionsProp.length > 0) {
            return sectionsProp.map((section, index) => {
                const tocItem = flatToc[index];
                const label = tocItem?.label || section.label || `Section ${index + 1}`;
                const href = tocItem?.href || section.href || '';
                const nextSection = sectionsProp[index + 1];
                const nextFraction = nextSection?.fraction ?? 1;

                return {
                    index: section.index,
                    fraction: section.fraction,
                    nextFraction,
                    width: nextFraction - section.fraction,
                    label,
                    href,
                };
            });
        }

        if (flatToc.length > 0 && sectionFractions && sectionFractions.length > 0) {
            const count = Math.min(flatToc.length, sectionFractions.length);
            return flatToc.slice(0, count).map((item, index) => {
                const fraction = sectionFractions[index];
                const nextFraction = sectionFractions[index + 1] ?? 1;

                return {
                    index,
                    fraction,
                    nextFraction,
                    width: nextFraction - fraction,
                    label: item.label,
                    href: item.href,
                };
            });
        }

        if (flatToc.length > 0) {
            const count = flatToc.length;
            return flatToc.map((item, index) => ({
                index,
                fraction: index / count,
                nextFraction: (index + 1) / count,
                width: 1 / count,
                label: item.label,
                href: item.href,
            }));
        }

        return [{
            index: 0,
            fraction: 0,
            nextFraction: 1,
            width: 1,
            label: 'Book',
            href: '',
        }];
    }, [toc, sectionsProp, sectionFractions]);

    // Clear userControlledFraction when location changes from external navigation
    // This ensures progress bar updates immediately when using keyboard/click zones
    useEffect(() => {
        if (userControlledFraction !== null && location?.cfi) {
            // Clear immediately on location change to show actual current position
            setUserControlledFraction(null);
            lastSeekFractionRef.current = null;
            if (stabilizeTimeoutRef.current) {
                clearTimeout(stabilizeTimeoutRef.current);
                stabilizeTimeoutRef.current = null;
            }
        }
    }, [location?.cfi]);

    // Check if location has stabilized after seek
    useEffect(() => {
        if (userControlledFraction !== null && lastSeekFractionRef.current !== null) {
            const diff = Math.abs(pageFraction - lastSeekFractionRef.current);
            if (diff < 0.02) {
                if (stabilizeTimeoutRef.current) {
                    clearTimeout(stabilizeTimeoutRef.current);
                }
                stabilizeTimeoutRef.current = setTimeout(() => {
                    setUserControlledFraction(null);
                    lastSeekFractionRef.current = null;
                }, SEEK_STABILIZE_DELAY);
            }
        }
    }, [pageFraction, userControlledFraction]);

    // Get fraction at mouse position
    const getFractionAtMouse = useCallback((clientX: number): number => {
        if (!containerRef.current) return 0;
        const rect = containerRef.current.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }, []);

    // Handle mouse move for hover - update both ref and state immediately
    // This ensures tooltip always matches the exact position that will be used on click
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const fraction = getFractionAtMouse(e.clientX);
        hoverFractionRef.current = fraction;
        setHoverFraction(fraction);
    }, [getFractionAtMouse]);

    const handleMouseLeave = useCallback(() => {
        setHoverFraction(null);
        hoverFractionRef.current = null;
    }, []);

    // Handle click - navigate to exact fraction clicked
    // Uses fraction-based navigation (spine-based) for accuracy
    // TOC is display-only, not used for navigation calculations
    const handleClick = useCallback((e: React.MouseEvent) => {
        const targetFraction = hoverFractionRef.current ?? getFractionAtMouse(e.clientX);

        if (stabilizeTimeoutRef.current) {
            clearTimeout(stabilizeTimeoutRef.current);
            stabilizeTimeoutRef.current = null;
        }

        // ALWAYS use fraction-based navigation for accuracy
        // This correctly maps the fraction to spine sections via goToFraction
        console.log(`[ReaderProgressBar] Clicked fraction ${targetFraction.toFixed(3)}`);
        onSeek(targetFraction);
        setUserControlledFraction(targetFraction);
        lastSeekFractionRef.current = targetFraction;
    }, [getFractionAtMouse, onSeek]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (stabilizeTimeoutRef.current) {
                clearTimeout(stabilizeTimeoutRef.current);
            }
        };
    }, []);

    // Calculate hover page number and percentage for tooltip
    const hoverPageNumber = hoverFraction !== null && totalPages > 0
        ? Math.max(1, Math.min(totalPages, Math.floor(hoverFraction * totalPages) + 1))
        : null;
    const hoverPercentage = hoverFraction !== null
        ? Math.round(hoverFraction * 100)
        : null;

    return (
        <div className={cn('flex items-center gap-3 w-full', className)}>
            <div
                ref={containerRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                className="relative flex-1 cursor-pointer h-10 flex items-center"
            >
                {/* Tooltip: Page number + Percentage (spatial navigation) */}
                {hoverFraction !== null && (
                    <div
                        className="absolute bottom-full mb-3 pointer-events-none z-50"
                        style={{
                            left: `${hoverFraction * 100}%`,
                            transform: 'translateX(-50%)',
                        }}
                    >
                        <div className="relative bg-[var(--color-accent)] text-white px-3 py-2 rounded-lg shadow-xl min-w-[120px] text-center">
                            {/* Primary: Page number */}
                            <div className="text-sm font-semibold">
                                {hoverPageNumber !== null && totalPages > 0
                                    ? `Page ${hoverPageNumber}`
                                    : `${hoverPercentage}%`}
                            </div>
                            {/* Secondary: Total pages or percentage */}
                            <div className="text-[10px] opacity-80">
                                {hoverPageNumber !== null && totalPages > 0
                                    ? `of ${totalPages} (${hoverPercentage}%)`
                                    : 'through book'}
                            </div>

                            <div
                                className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
                                style={{
                                    borderLeft: '6px solid transparent',
                                    borderRight: '6px solid transparent',
                                    borderTop: '6px solid var(--color-accent)',
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Hover indicator line */}
                {hoverFraction !== null && (
                    <div
                        className="absolute top-0 bottom-0 w-0.5 bg-[var(--color-accent)] z-10 pointer-events-none"
                        style={{
                            left: `${hoverFraction * 100}%`,
                            transform: 'translateX(-50%)',
                        }}
                    />
                )}

                {/* Progress track */}
                <div className="relative w-full h-1.5 bg-[var(--color-border)]/30 rounded-full overflow-hidden">
                    {/* Chapter markers */}
                    {sections.length > 1 && sections.map((section, index) => (
                        index > 0 && (
                            <div
                                key={`marker-${index}`}
                                className="absolute top-0 bottom-0 w-px bg-[var(--color-border)]/60 pointer-events-none"
                                style={{ left: `${section.fraction * 100}%` }}
                            />
                        )
                    ))}

                    {/* Progress fill - based on page position */}
                    <div
                        className="absolute left-0 top-0 bottom-0 bg-[var(--color-accent)] rounded-full pointer-events-none"
                        style={{
                            width: `${displayFraction * 100}%`,
                            transition: userControlledFraction !== null ? 'none' : 'width 150ms ease-out',
                            willChange: 'width',
                        }}
                    />
                </div>
            </div>

            {/* Page number display - shows "5-6/50" for double, "5/50" for single */}
            <div className="text-xs whitespace-nowrap tabular-nums shrink-0 min-w-[50px] text-right">
                <span className="text-[var(--color-accent)] font-semibold">
                    {pageDisplay}/{totalDisplay}
                </span>
            </div>
        </div>
    );
}



export default ReaderProgressBar;
