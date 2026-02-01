/**
 * ReaderProgressBar Component
 * Progress bar specifically for the reader with book section data
 */

import { useMemo, useCallback } from 'react';
import { ProgressBar } from './ProgressBar';
import { cn } from '@/lib/utils';
import type { TocItem, DocLocation } from '@/types';

interface ReaderProgressBarProps {
    location: DocLocation | null;
    toc: TocItem[];
    sectionFractions: number[];
    onNavigate: (fraction: number) => void;
    className?: string;
}

export function ReaderProgressBar({
    location,
    toc,
    sectionFractions,
    onNavigate,
    className,
}: ReaderProgressBarProps) {
    // Calculate current progress
    const progress = location?.percentage ?? 0;

    // Build sections from TOC
    const sections = useMemo(() => {
        if (toc.length === 0 || sectionFractions.length === 0) {
            return [];
        }

        return toc.map((item, index) => {
            // Map TOC item to section fraction
            const fraction = sectionFractions[index] ?? (index / toc.length);
            
            return {
                label: item.label,
                href: item.href,
                fraction,
                index,
            };
        });
    }, [toc, sectionFractions]);

    // Find current section index
    const currentSection = useMemo(() => {
        if (!location || sections.length === 0) return -1;
        
        for (let i = sections.length - 1; i >= 0; i--) {
            if (sections[i].fraction <= location.percentage) {
                return i;
            }
        }
        return 0;
    }, [location, sections]);

    // Handle seek
    const handleSeek = useCallback((fraction: number) => {
        onNavigate(fraction);
    }, [onNavigate]);

    // Format progress text
    const progressText = useMemo(() => {
        const percentage = Math.round(progress * 100);
        
        if (location?.pageInfo) {
            const { currentPage, totalPages } = location.pageInfo;
            return `${currentPage} / ${totalPages} (${percentage}%)`;
        }
        
        return `${percentage}%`;
    }, [progress, location]);

    // Get current section label
    const currentSectionLabel = useMemo(() => {
        if (location?.tocItem?.label) {
            return location.tocItem.label;
        }
        if (currentSection >= 0 && sections[currentSection]) {
            return sections[currentSection].label;
        }
        return '';
    }, [location, currentSection, sections]);

    return (
        <div className={cn("px-4 py-2", className)}>
            {/* Progress info */}
            <div className="flex items-center justify-between mb-2 text-xs text-[var(--color-text-muted)]">
                <span className="truncate max-w-[70%]">{currentSectionLabel}</span>
                <span>{progressText}</span>
            </div>
            
            {/* Progress bar */}
            <ProgressBar
                progress={progress}
                sections={sections}
                currentSection={currentSection}
                onSeek={handleSeek}
            />
        </div>
    );
}

export default ReaderProgressBar;
