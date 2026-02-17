/**
 * TableOfContents Component
 * Side panel displaying the book's table of contents
 * Swiss Design Standard - Grid-based, clear hierarchy, full-height
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, X, List } from "lucide-react";
import { cn } from "../../../core";
import type { TocItem } from "../../../core";
import { Backdrop } from "../../../ui";

interface TableOfContentsProps {
    toc: TocItem[];
    visible: boolean;
    onClose: () => void;
    onNavigate: (href: string) => void;
    currentHref?: string;
    isPdf?: boolean;
    pdfHasOutline?: boolean;
    className?: string;
}

interface TocItemComponentProps {
    item: TocItem;
    depth: number;
    onNavigate: (href: string) => void;
    currentHref?: string;
    totalItems: number;
}

function TocItemComponent({ item, depth, onNavigate, currentHref, totalItems }: TocItemComponentProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasChildren = item.subitems && item.subitems.length > 0;
    const isActive = currentHref === item.href;
    const itemRef = useRef<HTMLDivElement>(null);

    // Auto-scroll active item into view
    useEffect(() => {
        if (isActive && itemRef.current) {
            itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [isActive]);

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExpanded((prev) => !prev);
    }, []);

    // Swiss grid system: 8px base unit
    const indentSize = depth * 24; // 24px = 3 × 8px grid unit

    return (
        <div ref={itemRef} className="group/item">
            <div
                className={cn(
                    // Swiss design: clear grid, minimal decoration
                    "relative flex cursor-pointer items-center py-3 px-4",
                    "transition-all duration-200 ease-out",
                    "hover:bg-[var(--color-surface-muted)]",
                    isActive && "bg-[var(--color-accent-light)]"
                )}
                data-active={isActive}
                onClick={() => onNavigate(item.href)}
            >
                {/* Active indicator - geometric, left-aligned */}
                <div
                    className={cn(
                        "absolute left-0 top-0 bottom-0 w-0.5 transition-all duration-200",
                        isActive 
                            ? "bg-[var(--color-accent)]" 
                            : "bg-transparent group-hover/item:bg-[var(--color-border)]"
                    )}
                />

                {/* Indent spacer */}
                <div style={{ width: indentSize }} className="shrink-0" />

                {/* Expand/collapse button or bullet */}
                {hasChildren ? (
                    <button
                        onClick={handleToggle}
                        className={cn(
                            "shrink-0 mr-3 p-1 rounded",
                            "hover:bg-[var(--color-surface)]",
                            "transition-colors duration-150"
                        )}
                    >
                        {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" />
                        ) : (
                            <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)]" />
                        )}
                    </button>
                ) : (
                    <div className="shrink-0 mr-3 w-6 flex items-center justify-center">
                        <div
                            className={cn(
                                "w-1.5 h-1.5 rounded-full transition-all duration-200",
                                isActive 
                                    ? "bg-[var(--color-accent)] scale-125" 
                                    : "bg-[var(--color-text-muted)] opacity-40 group-hover/item:opacity-70"
                            )}
                        />
                    </div>
                )}

                {/* Label - : clean, readable */}
                <span 
                    className={cn(
                        "flex-1 truncate text-sm leading-relaxed",
                        depth === 0 && "font-medium text-[var(--color-text-primary)]",
                        depth === 1 && "text-[var(--color-text-primary)]",
                        depth >= 2 && "text-[var(--color-text-secondary)] text-xs",
                        isActive && "text-[var(--color-accent)] font-medium"
                    )}
                >
                    {item.label}
                </span>
            </div>

            {/* Children */}
            {hasChildren && isExpanded && (
                <div>
                    {item.subitems!.map((child: TocItem, index: number) => (
                        <TocItemComponent
                            key={`${item.href}-${index}`}
                            item={child}
                            depth={depth + 1}
                            onNavigate={onNavigate}
                            currentHref={currentHref}
                            totalItems={totalItems}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export function TableOfContents({
    toc,
    visible,
    onClose,
    onNavigate,
    currentHref,
    isPdf = false,
    pdfHasOutline = false,
    className,
}: TableOfContentsProps) {
    const tocItems = useMemo(
        () => (Array.isArray(toc) ? toc : []),
        [toc],
    );

    const handleNavigate = useCallback((href: string) => {
        onNavigate(href);
        onClose();
    }, [onNavigate, onClose]);

    // Calculate total items including nested
    const totalItems = useMemo(() => {
        const countItems = (items: TocItem[]): number => {
            return items.reduce((acc, item) => {
                acc += 1;
                if (item.subitems) {
                    acc += countItems(item.subitems);
                }
                return acc;
            }, 0);
        };
        return countItems(tocItems);
    }, [tocItems]);

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} className="z-[155]" />

            {/* Panel - Swiss design: grid-based, full-height on desktop */}
            <div
                className={cn(
                    // Mobile: bottom sheet
                    "fixed inset-x-0 bottom-0 z-[160]",
                    "h-[70vh]",
                    
                    // Desktop: full-height side panel
                    "sm:inset-y-0 sm:left-0 sm:right-auto sm:top-0 sm:bottom-0",
                    "h-screen ",
                    "sm:w-[360px] sm:max-w-[min(360px,40vw)]",
                    
                    // Design system
                    "flex flex-col overflow-hidden",
                    "bg-[var(--color-surface)]",
                    "border-r border-[var(--color-border)]",
                    "shadow-2xl shadow-black/10",
                    
                    // Visibility (no animation)
                    visible ? "flex" : "hidden",
                    
                    className,
                )}
            >
                {/* Header - Swiss grid layout */}
                <header className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                    <div className="flex items-center justify-between px-5 py-4">
                        {/* Left: Icon and title */}
                        <div className="flex items-center gap-4">
                            <div className="flex h-10 w-10 items-center justify-center border border-[var(--color-border)] bg-[var(--color-surface)]">
                                <List className="w-5 h-5 text-[var(--color-text-primary)]" />
                            </div>
                            <div>
                                <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-primary)]">
                                    {isPdf ? "Navigation" : "Contents"}
                                </h2>
                                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                                    {totalItems} {totalItems === 1 ? 'item' : 'items'}
                                </p>
                            </div>
                        </div>

                        {/* Right: Close button */}
                        <button
                            onClick={onClose}
                            className={cn(
                                "flex h-10 w-10 items-center justify-center",
                                "border border-[var(--color-border)]",
                                "text-[var(--color-text-secondary)]",
                                "transition-all duration-200",
                                "hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
                                "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2"
                            )}
                            aria-label="Close table of contents"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </header>

                {/* TOC Items - Scrollable content area */}
                <div className="flex-1 overflow-y-auto overscroll-contain">
                    {tocItems.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center px-8 py-16 text-center">
                            <div className="mb-6 flex h-20 w-20 items-center justify-center border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                                <List className="w-8 h-8 text-[var(--color-text-muted)]" />
                            </div>
                            <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
                                {isPdf ? "No Outline Available" : "No Contents"}
                            </h3>
                            <p className="text-xs text-[var(--color-text-muted)] max-w-[240px] leading-relaxed">
                                {isPdf && !pdfHasOutline 
                                    ? "This PDF does not contain an embedded outline or bookmarks." 
                                    : "This document does not have a table of contents."}
                            </p>
                        </div>
                    ) : (
                        <nav className="py-2">
                            {tocItems.map((item, index) => (
                                <TocItemComponent
                                    key={`toc-${index}`}
                                    item={item}
                                    depth={0}
                                    onNavigate={handleNavigate}
                                    currentHref={currentHref}
                                    totalItems={totalItems}
                                />
                            ))}
                        </nav>
                    )}
                </div>

                {/* Footer - Swiss design: minimal info bar */}
                <footer className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-3">
                    <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                        <span className="font-medium">
                            {isPdf ? "PDF Outline" : "Document Map"}
                        </span>
                        <span>
                            {currentHref 
                                ? `Current: ${tocItems.findIndex(item => item.href === currentHref) + 1 || '-'}/${tocItems.length}`
                                : `${tocItems.length} ${tocItems.length === 1 ? 'chapter' : 'chapters'}`}
                        </span>
                    </div>
                </footer>
            </div>
        </>
    );
}

export default TableOfContents;
