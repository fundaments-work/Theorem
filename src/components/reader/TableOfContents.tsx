/**
 * TableOfContents Component
 * Side panel displaying the book's table of contents
 */

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, X, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TocItem } from '@/engines';
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
                    'flex items-center gap-3 py-2 px-3 rounded-xl cursor-pointer',
                    'transition-all duration-200 ease-out mx-2 my-0.5',
                    isActive
                        ? 'bg-[var(--color-accent)] text-[var(--color-background)] font-bold shadow-sm'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)]'
                )}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                onClick={() => onNavigate(item.href)}
            >
                {hasChildren ? (
                    <button
                        onClick={handleToggle}
                        className="p-1 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-muted)] group-hover/item:text-[var(--color-text-secondary)] transition-colors"
                    >
                        {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                        )}
                    </button>
                ) : (
                    <div className="w-5 flex items-center justify-center">
                        <div className={cn(
                            "w-1 h-1 rounded-full bg-current opacity-30 transition-all",
                            isActive && "scale-150 opacity-100"
                        )} />
                    </div>
                )}
                <span className="flex-1 text-[13px] truncate leading-tight tracking-tight">{item.label}</span>
            </div>

            {hasChildren && isExpanded && (
                <div className="animate-fade-in">
                    {item.subitems!.map((child, index) => (
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
                    'fixed top-0 left-0 h-full w-80 max-w-[85vw] z-50',
                    'bg-[var(--color-surface)] flex flex-col',
                    'border-r border-[var(--color-border)]',
                    'transform transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]',
                    visible ? 'translate-x-0 shadow-2xl' : '-translate-x-full shadow-none',
                    className
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg bg-[var(--color-background)] text-[var(--color-accent)]">
                            <List className="w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="text-sm font-bold text-[var(--color-text-primary)] tracking-tight">Table of Contents</h2>
                            <p className="text-[10px] text-[var(--color-text-muted)] font-bold uppercase tracking-[0.1em]">Navigation</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl hover:bg-[var(--color-border-subtle)] transition-colors text-[var(--color-text-secondary)]"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* TOC Items */}
                <div className="flex-1 overflow-y-auto pt-4 pb-12 custom-scrollbar space-y-0.5">
                    {toc.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-12 opacity-50 text-center">
                            <div className="w-12 h-12 rounded-full bg-[var(--color-background)] flex items-center justify-center mb-4">
                                <List className="w-5 h-5 text-[var(--color-text-muted)]" />
                            </div>
                            <p className="text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
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
                <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-background)]/50">
                    <div className="flex items-center justify-between text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">
                        <span>{toc.length} Chapters</span>
                        <span>Jump to section</span>
                    </div>
                </div>
            </div>
        </>
    );
}

export default TableOfContents;
