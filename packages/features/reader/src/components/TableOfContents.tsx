/**
 * TableOfContents Component
 * Side panel displaying the book's table of contents
 * Swiss Design Standard - Consistent across PDF, EPUB, and Article readers
 */

import { useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight, X, List } from "lucide-react";
import { cn } from "@theorem/core";
import type { TocItem } from "@theorem/core";
import { Backdrop } from "@theorem/ui";

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
}

function TocItemComponent({ item, depth, onNavigate, currentHref }: TocItemComponentProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasChildren = item.subitems && item.subitems.length > 0;
    const isActive = currentHref === item.href;

    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExpanded((prev) => !prev);
    }, []);

    return (
        <div className="group/item">
            <div
                className={cn(
                    "flex cursor-pointer items-center border-l-2 border-transparent px-4 py-2 text-sm text-[color:var(--color-text-primary)] transition-[background-color,border-color,color] duration-200 ease-out hover:border-l-[var(--color-accent)] hover:bg-[var(--color-surface-muted)] data-[active=true]:border-l-[var(--color-accent)] data-[active=true]:bg-[var(--color-accent-light)] data-[active=true]:text-[color:var(--color-accent)]",
                    depth === 0 && "pl-4 font-medium",
                    depth === 1 && "pl-10 text-xs",
                    depth >= 2 && "pl-[3.75rem] text-xs text-[color:var(--color-text-secondary)]"
                )}
                data-active={isActive}
                onClick={() => onNavigate(item.href)}
            >
                {hasChildren ? (
                    <button
                        onClick={handleToggle}
                        className="p-1 hover:opacity-70 transition-opacity"
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
                            className="w-1.5 h-1.5 transition-transform"
                            style={{
                                backgroundColor: "var(--color-text-primary)",
                                opacity: isActive ? 1 : 0.3,
                                transform: isActive ? "scale(1.3)" : "scale(1)",
                            }}
                        />
                    </div>
                )}
                <span className="flex-1 truncate">{item.label}</span>
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

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            {/* Panel */}
            <div
                className={cn(
                    "fixed inset-x-0 bottom-0 h-[var(--layout-reader-panel-mobile-height)] z-50 flex flex-col",
                    "sm:inset-x-auto sm:bottom-auto sm:top-0 sm:left-0 sm:h-full sm:w-80 sm:max-w-[var(--layout-reader-panel-max-width-mobile)]",
                    "flex w-[min(var(--layout-reader-panel-width),calc(100vw-2.5rem))] max-h-[var(--layout-reader-panel-max-height)] flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface)] max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-[var(--z-modal)] max-md:max-h-none max-md:w-[var(--layout-reader-panel-width-mobile)] max-md:max-w-[var(--layout-reader-panel-max-width-mobile)] max-md:border-l-0",
                    "transform transition-transform duration-240 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    visible ? "translate-y-0 sm:translate-x-0" : "translate-y-full sm:-translate-x-full",
                    className,
                )}
            >
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border-subtle)] px-4 py-3">
                    <div className="flex items-center gap-3">
                        <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5">
                            <List className="w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">
                                {isPdf ? "Navigation" : "Table of Contents"}
                            </h2>
                            <p className="text-xs font-medium leading-snug text-[color:var(--color-text-muted)]">
                                {isPdf ? "Outline" : "Navigation"}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="inline-flex h-9 w-9 items-center justify-center border border-transparent bg-transparent text-[color:var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)] data-[active=true]:border-[var(--color-accent)] data-[active=true]:bg-[var(--color-accent)] data-[active=true]:text-[color:var(--color-accent-contrast)] data-[active=true]:hover:border-[var(--color-accent-hover)] data-[active=true]:hover:bg-[var(--color-accent-hover)]"
                        aria-label="Close table of contents"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* TOC Items */}
                <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
                    {tocItems.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-[color:var(--color-text-muted)]">
                            <div className="mb-5 inline-flex h-16 w-16 items-center justify-center border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]">
                                <List className="w-5 h-5" />
                            </div>
                            <p className="text-xs font-medium leading-snug text-[color:var(--color-text-muted)]">
                                {isPdf ? "No outline available" : "No contents found"}
                            </p>
                            {isPdf && !pdfHasOutline && (
                                <p className="text-[var(--font-size-2xs)] text-[color:var(--color-text-muted)] max-w-[16rem] mt-2">
                                    This PDF has no embedded outline.
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            {tocItems.map((item, index) => (
                                <TocItemComponent
                                    key={index}
                                    item={item}
                                    depth={0}
                                    onNavigate={handleNavigate}
                                    currentHref={currentHref}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex shrink-0 items-center justify-between border-t border-[var(--color-border-subtle)] px-4 py-3">
                    <span className="text-xs font-medium leading-snug text-[color:var(--color-text-muted)]">
                        {isPdf ? `${tocItems.length} Outline Items` : `${tocItems.length} Chapters`}
                    </span>
                    <span className="text-xs font-medium leading-snug text-[color:var(--color-text-muted)]">Jump to section</span>
                </div>
            </div>
        </>
    );
}

export default TableOfContents;
