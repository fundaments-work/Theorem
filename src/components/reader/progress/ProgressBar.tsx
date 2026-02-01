/**
 * ProgressBar Component
 * Bottom progress bar with section markers
 * Inspired by Foliate's progress implementation
 */

import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { BookSection } from '@/types';

interface ProgressBarProps {
    progress: number; // 0-1
    sections?: BookSection[];
    currentSection?: number;
    onSeek: (fraction: number) => void;
    onSeekStart?: () => void;
    onSeekEnd?: () => void;
    showTooltip?: boolean;
    className?: string;
}

export function ProgressBar({
    progress,
    sections = [],
    currentSection,
    onSeek,
    onSeekStart,
    onSeekEnd,
    showTooltip = true,
    className,
}: ProgressBarProps) {
    const [isDragging, setIsDragging] = useState(false);
    const [hoverPosition, setHoverPosition] = useState<number | null>(null);
    const [tooltipSection, setTooltipSection] = useState<BookSection | null>(null);
    const barRef = useRef<HTMLDivElement>(null);

    // Calculate percentage for styling
    const percentage = useMemo(() => Math.round(progress * 100), [progress]);

    // Get section at a given position
    const getSectionAtPosition = useCallback((fraction: number): BookSection | null => {
        if (sections.length === 0) return null;
        
        // Find the section that contains this fraction
        for (let i = sections.length - 1; i >= 0; i--) {
            if (sections[i].fraction <= fraction) {
                return sections[i];
            }
        }
        return sections[0];
    }, [sections]);

    // Handle mouse/touch events
    const handleSeekStart = useCallback((clientX: number) => {
        setIsDragging(true);
        onSeekStart?.();
        
        const bar = barRef.current;
        if (!bar) return;
        
        const rect = bar.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        onSeek(fraction);
    }, [onSeek, onSeekStart]);

    const handleSeekMove = useCallback((clientX: number) => {
        const bar = barRef.current;
        if (!bar) return;
        
        const rect = bar.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        
        if (isDragging) {
            onSeek(fraction);
        }
        
        setHoverPosition(fraction);
        setTooltipSection(getSectionAtPosition(fraction));
    }, [isDragging, onSeek, getSectionAtPosition]);

    const handleSeekEnd = useCallback(() => {
        if (isDragging) {
            setIsDragging(false);
            onSeekEnd?.();
        }
    }, [isDragging, onSeekEnd]);

    // Mouse events
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        handleSeekStart(e.clientX);
    }, [handleSeekStart]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        handleSeekMove(e.clientX);
    }, [handleSeekMove]);

    const handleMouseLeave = useCallback(() => {
        setHoverPosition(null);
        setTooltipSection(null);
        handleSeekEnd();
    }, [handleSeekEnd]);

    // Touch events
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        handleSeekStart(e.touches[0].clientX);
    }, [handleSeekStart]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        handleSeekMove(e.touches[0].clientX);
    }, [handleSeekMove]);

    const handleTouchEnd = useCallback(() => {
        handleSeekEnd();
    }, [handleSeekEnd]);

    // Global mouse/touch up handler
    useEffect(() => {
        if (!isDragging) return;

        const handleGlobalMouseUp = () => handleSeekEnd();
        const handleGlobalTouchEnd = () => handleSeekEnd();

        document.addEventListener('mouseup', handleGlobalMouseUp);
        document.addEventListener('touchend', handleGlobalTouchEnd);

        return () => {
            document.removeEventListener('mouseup', handleGlobalMouseUp);
            document.removeEventListener('touchend', handleGlobalTouchEnd);
        };
    }, [isDragging, handleSeekEnd]);

    // Tooltip content
    const tooltipContent = useMemo(() => {
        if (hoverPosition === null) return null;
        
        const percent = Math.round(hoverPosition * 100);
        const section = tooltipSection;
        
        return (
            <div className="flex flex-col gap-0.5">
                <span className="font-medium">{percent}%</span>
                {section && (
                    <span className="text-[var(--color-text-muted)] truncate max-w-[200px]">
                        {section.label}
                    </span>
                )}
            </div>
        );
    }, [hoverPosition, tooltipSection]);

    return (
        <div
            ref={barRef}
            className={cn(
                "relative w-full h-6 flex items-center cursor-pointer select-none",
                className
            )}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {/* Track background */}
            <div className="absolute inset-x-0 h-1 bg-[var(--color-surface-variant)] rounded-full overflow-hidden">
                {/* Progress fill */}
                <div
                    className={cn(
                        "h-full bg-[var(--color-accent)] transition-all duration-150",
                        isDragging && "duration-0"
                    )}
                    style={{ width: `${percentage}%` }}
                />
                
                {/* Hover indicator */}
                {hoverPosition !== null && !isDragging && (
                    <div
                        className="absolute top-0 h-full bg-[var(--color-accent)]/30"
                        style={{ 
                            left: `${Math.round(hoverPosition * 100)}%`,
                            width: '2px',
                            transform: 'translateX(-50%)'
                        }}
                    />
                )}
            </div>

            {/* Section markers */}
            {sections.map((section, index) => {
                const isCurrent = currentSection === index;
                const position = Math.round(section.fraction * 100);
                
                return (
                    <div
                        key={section.href || index}
                        className={cn(
                            "absolute w-0.5 h-2 rounded-full transition-colors",
                            isCurrent 
                                ? "bg-[var(--color-accent)]" 
                                : "bg-[var(--color-border)] hover:bg-[var(--color-text-muted)]"
                        )}
                        style={{ 
                            left: `${position}%`,
                            transform: 'translateX(-50%)'
                        }}
                        title={section.label}
                    />
                );
            })}

            {/* Thumb handle */}
            <div
                className={cn(
                    "absolute w-3 h-3 rounded-full bg-[var(--color-accent)]",
                    "border-2 border-[var(--color-surface)]",
                    "shadow-sm transition-transform",
                    isDragging && "scale-125"
                )}
                style={{ 
                    left: `${percentage}%`,
                    transform: 'translateX(-50%)'
                }}
            />

            {/* Tooltip */}
            {showTooltip && hoverPosition !== null && tooltipContent && (
                <div
                    className={cn(
                        "absolute bottom-full mb-2 px-2 py-1.5",
                        "bg-[var(--color-surface)] border border-[var(--color-border)]",
                        "rounded-md shadow-lg text-xs",
                        "pointer-events-none z-50",
                        "transition-opacity duration-150"
                    )}
                    style={{ 
                        left: `${Math.round(hoverPosition * 100)}%`,
                        transform: 'translateX(-50%)'
                    }}
                >
                    {tooltipContent}
                </div>
            )}
        </div>
    );
}

export default ProgressBar;
