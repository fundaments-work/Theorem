/**
 * TOC Utilities
 * Shared functions for handling Table of Contents operations
 */

import type { TocItem, BookSection } from '@/types';

/**
 * Flatten a nested TOC structure into a single-level array
 */
export function flattenToc(toc: TocItem[]): Array<{ label: string; href: string; level: number }> {
    const result: Array<{ label: string; href: string; level: number }> = [];

    const flatten = (items: TocItem[], level: number) => {
        for (const item of items) {
            if (item.href) {
                result.push({
                    label: item.label?.trim() || `Chapter ${result.length + 1}`,
                    href: item.href,
                    level,
                });
            }
            if (item.subitems?.length) {
                flatten(item.subitems, level + 1);
            }
        }
    };

    flatten(toc, 0);
    return result;
}

/**
 * Find a section at a specific fraction position
 */
export function findSectionAtFraction(sections: Array<{ fraction: number; nextFraction: number }>, fraction: number): { fraction: number; nextFraction: number; index: number } | null {
    if (!sections.length) return null;
    if (fraction <= 0) return { ...sections[0], index: 0 };
    if (fraction >= 1) return { ...sections[sections.length - 1], index: sections.length - 1 };

    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (fraction >= section.fraction && fraction < section.nextFraction) {
            return { ...section, index: i };
        }
    }

    return { ...sections[sections.length - 1], index: sections.length - 1 };
}

/**
 * Build section data from TOC and fractions
 */
export function buildSections(
    toc: TocItem[],
    sectionFractions?: number[],
    sectionsProp?: BookSection[]
): Array<{
    index: number;
    fraction: number;
    nextFraction: number;
    width: number;
    label: string;
    href: string;
}> {
    const flatToc = flattenToc(toc);

    // Use provided sections if available
    if (sectionsProp?.length) {
        return sectionsProp.map((section, index) => {
            const tocItem = flatToc[index];
            const nextSection = sectionsProp[index + 1];
            return {
                index: section.index,
                fraction: section.fraction,
                nextFraction: nextSection?.fraction ?? 1,
                width: (nextSection?.fraction ?? 1) - section.fraction,
                label: tocItem?.label || section.label || `Section ${index + 1}`,
                href: tocItem?.href || section.href || '',
            };
        });
    }

    // Use fractions + TOC
    if (flatToc.length > 0 && sectionFractions?.length) {
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

    // Fallback: even distribution
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

    // Default: single section
    return [{
        index: 0,
        fraction: 0,
        nextFraction: 1,
        width: 1,
        label: 'Book',
        href: '',
    }];
}
