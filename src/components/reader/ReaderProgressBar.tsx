import { useState, useRef, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { DocLocation, TocItem } from '@/types';

interface ReaderProgressBarProps {
    location: DocLocation | null;
    toc?: TocItem[];
    sectionFractions?: number[];
    visible?: boolean;
    onSeek: (fraction: number) => void;
    onNavigate?: (href: string) => void;
    className?: string;
}

export function ReaderProgressBar({
    location,
    toc,
    sectionFractions,
    visible: _visible,
    onSeek,
    onNavigate,
    className,
}: ReaderProgressBarProps) {
    const [hoverFraction, setHoverFraction] = useState<number | null>(null);
    const [hoverPos, setHoverPos] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const percentage = location?.percentage ?? 0;

    // Flatten TOC to get all items
    const flatToc = useMemo(() => {
        if (!toc) return [];
        
        const result: { label: string; href: string; level: number }[] = [];
        
        const flatten = (items: TocItem[], level: number) => {
            items.forEach(item => {
                if (item.label?.trim()) {
                    result.push({
                        label: item.label.trim(),
                        href: item.href,
                        level
                    });
                }
                if (item.subitems?.length) {
                    flatten(item.subitems, level + 1);
                }
            });
        };
        
        flatten(toc, 0);
        return result;
    }, [toc]);

    // Map sections with proper TOC labels
    const sections = useMemo(() => {
        if (!sectionFractions || sectionFractions.length === 0) {
            return [];
        }

        return sectionFractions.map((fraction, index) => {
            const nextFraction = sectionFractions[index + 1] ?? 1;
            
            // Try to find matching TOC item
            let label = `Part ${index + 1}`;
            let href = '';
            
            // Map section index to TOC item if available
            if (flatToc[index]) {
                label = flatToc[index].label;
                href = flatToc[index].href;
            }
            
            return {
                index,
                fraction,
                nextFraction,
                width: nextFraction - fraction,
                label,
                href,
            };
        });
    }, [sectionFractions, flatToc]);

    // Find current section index
    const currentSectionIndex = useMemo(() => {
        if (!sections.length) return -1;
        for (let i = sections.length - 1; i >= 0; i--) {
            if (percentage >= sections[i].fraction) {
                return i;
            }
        }
        return 0;
    }, [percentage, sections]);

    // Get hover info - find section at hover position
    const getHoverInfo = useCallback((fraction: number) => {
        if (!sections.length) return null;
        
        for (let i = sections.length - 1; i >= 0; i--) {
            if (fraction >= sections[i].fraction) {
                return sections[i];
            }
        }
        return sections[0];
    }, [sections]);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const fraction = x / rect.width;
        setHoverFraction(fraction);
        setHoverPos(x);

        if (isDragging) {
            onSeek(fraction);
        }
    };

    const handleMouseLeave = () => {
        setHoverFraction(null);
        setIsDragging(false);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const fraction = x / rect.width;
        setIsDragging(true);
        onSeek(fraction);
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleSectionClick = (e: React.MouseEvent, section: typeof sections[0]) => {
        e.stopPropagation();
        onSeek(section.fraction);
        if (onNavigate && section.href) {
            onNavigate(section.href);
        }
    };

    const hoverInfo = hoverFraction !== null ? getHoverInfo(hoverFraction) : null;

    return (
        <div className={cn('flex items-center gap-3 w-full', className)}>
            {/* Progress Bar Container - full width */}
            <div
                ref={containerRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                className="relative flex-1 group cursor-pointer h-8 flex items-center"
            >
                {/* Tooltip on hover - shows actual TOC title */}
                {hoverFraction !== null && hoverInfo && (
                    <div
                        className="absolute bottom-full mb-2 px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg text-xs font-medium text-[var(--color-text-primary)] whitespace-nowrap pointer-events-none -translate-x-1/2 z-20"
                        style={{ left: `${hoverPos}px` }}
                    >
                        <span className="max-w-[280px] truncate block">{hoverInfo.label}</span>
                    </div>
                )}

                {/* Progress Bar Track with Sections */}
                <div className="relative w-full h-1.5 bg-[var(--color-border)]/30 rounded-full overflow-hidden flex">
                    {/* Section backgrounds - chapter markers */}
                    {sections.map((section, index) => {
                        const isActive = index === currentSectionIndex;
                        const isPast = index < currentSectionIndex;
                        
                        return (
                            <div
                                key={index}
                                className={cn(
                                    'h-full transition-all duration-200 relative group/section',
                                    isActive && 'bg-[var(--color-accent)]/30',
                                    isPast && 'bg-[var(--color-accent)]/15',
                                    !isActive && !isPast && 'hover:bg-[var(--color-accent)]/10'
                                )}
                                style={{ 
                                    width: `${section.width * 100}%`,
                                    marginLeft: index === 0 ? `${section.fraction * 100}%` : undefined
                                }}
                                onClick={(e) => handleSectionClick(e, section)}
                            >
                                {/* Section divider */}
                                {index > 0 && (
                                    <div className="absolute left-0 top-0 bottom-0 w-px bg-[var(--color-border)]/60" />
                                )}
                            </div>
                        );
                    })}

                    {/* Progress fill overlay */}
                    <div 
                        className="absolute left-0 top-0 bottom-0 bg-[var(--color-accent)]/40 rounded-full pointer-events-none transition-all duration-150"
                        style={{ width: `${percentage * 100}%` }}
                    />

                    {/* Current position indicator */}
                    <div
                        className="absolute top-0 bottom-0 w-0.5 bg-[var(--color-accent)] rounded-full transition-all duration-150 z-10"
                        style={{ left: `${percentage * 100}%` }}
                    >
                        {/* Thumb handle */}
                        <div 
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-[var(--color-accent)] rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                        />
                    </div>
                </div>
            </div>

            {/* Percentage - Right Side */}
            <div className="flex items-center text-xs whitespace-nowrap tabular-nums shrink-0">
                <span className="text-[var(--color-accent)] font-medium">
                    {Math.round(percentage * 100)}%
                </span>
            </div>
        </div>
    );
}

export default ReaderProgressBar;
