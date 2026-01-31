/**
 * TableOfContents Component
 * Side panel displaying the book's table of contents
 * Updated to use reader theme colors for consistency
 */

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, X, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TocItem } from '@/types';
import { Backdrop } from '@/components/ui';

interface TableOfContentsProps {
    toc: TocItem[];
    visible: boolean;
    onClose: () => void;
    onNavigate: (href: string) => void;
    currentHref?: string;
    className?: string;
}

interface TocItemComponentProps {
    item: TocItem;
    depth: number;
    onNavigate: (href: string) => void;
    currentHref?: string;
}

// CSS variable styles for reader theme consistency
const readerStyles = {
    textPrimary: { color: 'var(--reader-fg)' },
    textSecondary: { color: 'var(--reader-fg)', opacity: 0.6 },
    textMuted: { color: 'var(--reader-fg)', opacity: 0.4 },
    surface: { backgroundColor: 'var(--reader-bg)' },
    surfaceHover: { backgroundColor: 'color-mix(in srgb, var(--reader-fg) 5%, var(--reader-bg))' },
    border: { borderColor: 'color-mix(in srgb, var(--reader-fg) 10%, transparent)' },
    accent: { 
        backgroundColor: 'var(--reader-fg)',
        color: 'var(--reader-bg)'
    },
};

const TocItemComponent = ({ item, depth, onNavigate, currentHref }: TocItemComponentProps) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasChildren = item.subitems && item.subitems.length > 0;
    const isActive = currentHref === item.href;

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExpanded(prev => !prev);
    }, []);

    return (
        <div className="group/item">
            <div
                className={cn(
                    'flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer',
                    'transition-all duration-200 ease-out mx-2 my-0.5',
                    isActive
                        ? 'font-semibold'
                        : 'hover:bg-[color-mix(in_srgb,var(--reader-fg)_5%,var(--reader-bg))]'
                )}
                style={{ 
                    paddingLeft: `${12 + depth * 16}px`,
                    ...(isActive ? readerStyles.accent : readerStyles.textSecondary),
                    backgroundColor: isActive ? 'var(--reader-fg)' : undefined,
                }}
                onClick={() => onNavigate(item.href)}
            >
                {hasChildren ? (
                    <button
                        onClick={handleToggle}
                        className="p-1 rounded-md transition-colors"
                        style={isActive ? readerStyles.textMuted : readerStyles.textMuted}
                    >
                        {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                        )}
                    </button>
                ) : (
                    <div className="w-5 flex items-center justify-center">
                        <div 
                            className="w-1.5 h-1.5 rounded-full transition-all"
                            style={{
                                backgroundColor: 'var(--reader-fg)',
                                opacity: isActive ? 1 : 0.3,
                                transform: isActive ? 'scale(1.3)' : 'scale(1)',
                            }}
                        />
                    </div>
                )}
                <span className="flex-1 text-[13px] truncate leading-tight">{item.label}</span>
            </div>

            {hasChildren && isExpanded && (
                <div className="animate-fade-in">
                    {item.subitems!.map((child: TocItem, index: number) => (
                        <TocItemComponent
                            key={index}
                            item={child}
                            depth={depth + 1}
                            onNavigate={onNavigate}
                            currentHref={currentHref}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export function TableOfContents({
    toc,
    visible,
    onClose,
    onNavigate,
    currentHref,
    className,
}: TableOfContentsProps) {
    const handleNavigate = useCallback((href: string) => {
        onNavigate(href);
        onClose();
    }, [onNavigate, onClose]);

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} blur />

            {/* Panel */}
            <div
                className={cn(
                    'fixed top-0 left-0 h-full w-80 max-w-[85vw] z-50 flex flex-col',
                    'transform transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    visible ? 'translate-x-0 shadow-2xl' : '-translate-x-full shadow-none',
                    className
                )}
                style={{
                    ...readerStyles.surface,
                    borderRight: '1px solid color-mix(in srgb, var(--reader-fg) 10%, transparent)',
                }}
            >
                {/* Header */}
                <div 
                    className="flex items-center justify-between p-5"
                    style={readerStyles.border}
                >
                    <div className="flex items-center gap-3">
                        <div 
                            className="p-1.5 rounded-lg"
                            style={{
                                backgroundColor: 'color-mix(in srgb, var(--reader-fg) 8%, var(--reader-bg))',
                            }}
                        >
                            <List className="w-4 h-4" style={readerStyles.textPrimary} />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold tracking-tight" style={readerStyles.textPrimary}>
                                Table of Contents
                            </h2>
                            <p className="text-[10px] font-medium uppercase tracking-wider" style={readerStyles.textMuted}>
                                Navigation
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg transition-colors hover:opacity-70"
                        style={readerStyles.textSecondary}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* TOC Items */}
                <div className="flex-1 overflow-y-auto pt-4 pb-12 custom-scrollbar space-y-0.5">
                    {toc.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-12 text-center">
                            <div 
                                className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
                                style={{
                                    backgroundColor: 'color-mix(in srgb, var(--reader-fg) 5%, var(--reader-bg))',
                                }}
                            >
                                <List className="w-5 h-5" style={readerStyles.textMuted} />
                            </div>
                            <p className="text-xs font-medium uppercase tracking-wider" style={readerStyles.textMuted}>
                                No contents found
                            </p>
                        </div>
                    ) : (
                        toc.map((item, index) => (
                            <TocItemComponent
                                key={index}
                                item={item}
                                depth={0}
                                onNavigate={handleNavigate}
                                currentHref={currentHref}
                            />
                        ))
                    )}
                </div>

                {/* Footer */}
                <div 
                    className="p-4 flex items-center justify-between text-[10px] font-medium uppercase tracking-wider"
                    style={{
                        ...readerStyles.border,
                        borderTopWidth: '1px',
                        backgroundColor: 'color-mix(in srgb, var(--reader-fg) 3%, var(--reader-bg))',
                        ...readerStyles.textMuted,
                    }}
                >
                    <span>{toc.length} Chapters</span>
                    <span>Jump to section</span>
                </div>
            </div>
        </>
    );
}

export default TableOfContents;
