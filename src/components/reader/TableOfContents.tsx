/**
 * TableOfContents Component
 * Side panel displaying the book's table of contents
 * Updated to use reader theme colors for consistency
 */

import { useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight, X, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TocItem } from "@/types";
import { Backdrop } from "@/components/ui";

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

// CSS variable styles for reader theme consistency
const readerStyles = {
    textPrimary: { color: "var(--reader-fg)" },
    textSecondary: { color: "var(--reader-fg)", opacity: 0.6 },
    textMuted: { color: "var(--reader-fg)", opacity: 0.4 },
    surface: { backgroundColor: "var(--reader-bg)" },
    border: { borderColor: "color-mix(in srgb, var(--reader-fg) 10%, transparent)" },
    accent: {
        backgroundColor: "var(--reader-fg)",
        color: "var(--reader-bg)",
    },
};

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
                    "flex items-center gap-3 py-2.5 px-3 rounded-lg cursor-pointer",
                    "transition-colors duration-200 ease-out mx-2 my-0.5",
                    isActive
                        ? "font-semibold"
                        : "hover:bg-[color-mix(in_srgb,var(--reader-fg)_5%,var(--reader-bg))]",
                )}
                style={{
                    paddingLeft: `${12 + depth * 16}px`,
                    ...(isActive ? readerStyles.accent : readerStyles.textSecondary),
                    backgroundColor: isActive ? "var(--reader-fg)" : undefined,
                }}
                onClick={() => onNavigate(item.href)}
            >
                {hasChildren ? (
                    <button
                        onClick={handleToggle}
                        className="p-1 rounded-md transition-colors"
                        style={readerStyles.textMuted}
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
                            className="w-1.5 h-1.5 rounded-full transition-transform"
                            style={{
                                backgroundColor: "var(--reader-fg)",
                                opacity: isActive ? 1 : 0.3,
                                transform: isActive ? "scale(1.3)" : "scale(1)",
                            }}
                        />
                    </div>
                )}
                <span className="flex-1 text-[var(--font-size-caption)] truncate leading-tight">{item.label}</span>
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
                    "reader-sheet border border-[var(--color-border)] rounded-t-2xl sm:rounded-none sm:rounded-r-2xl",
                    "transform transition-transform duration-240 ease-[cubic-bezier(0.16,1,0.3,1)]",
                    visible ? "translate-y-0 sm:translate-x-0 shadow-[var(--shadow-md)]" : "translate-y-full sm:-translate-x-full shadow-none",
                    className,
                )}
                style={readerStyles.surface}
            >
                {/* Header */}
                <div
                    className="reader-panel-header flex items-center justify-between p-4 sm:p-5"
                    style={readerStyles.border}
                >
                    <div className="flex items-center gap-3">
                        <div
                            className="p-1.5 rounded-lg"
                            style={{
                                backgroundColor: "color-mix(in srgb, var(--reader-fg) 8%, var(--reader-bg))",
                            }}
                        >
                            <List className="w-4 h-4" style={readerStyles.textPrimary} />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold tracking-tight" style={readerStyles.textPrimary}>
                                {isPdf ? "Navigation" : "Table of Contents"}
                            </h2>
                            <p className="text-[var(--font-size-3xs)] font-medium uppercase tracking-wider" style={readerStyles.textMuted}>
                                {isPdf ? "Outline" : "Navigation"}
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
                <div className="flex-1 min-h-0 overflow-y-auto pt-3 pb-8 sm:pt-4 sm:pb-12 custom-scrollbar space-y-0.5">
                    {tocItems.length === 0 ? (
                        <div className="w-full flex flex-col items-center justify-center p-12 text-center">
                            <div
                                className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
                                style={{
                                    backgroundColor: "color-mix(in srgb, var(--reader-fg) 5%, var(--reader-bg))",
                                }}
                            >
                                <List className="w-5 h-5" style={readerStyles.textMuted} />
                            </div>
                            <p className="text-xs font-medium uppercase tracking-wider" style={readerStyles.textMuted}>
                                {isPdf ? "No outline available" : "No contents found"}
                            </p>
                            {isPdf && !pdfHasOutline && (
                                <p className="w-full max-w-[16rem] mt-2 text-[var(--font-size-2xs)] leading-relaxed" style={readerStyles.textMuted}>
                                    This PDF has no embedded outline.
                                </p>
                            )}
                        </div>
                    ) : (
                        tocItems.map((item, index) => (
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
                    className="reader-panel-footer p-3 sm:p-4 flex items-center justify-between text-[var(--font-size-3xs)] font-medium uppercase tracking-wider"
                    style={{
                        ...readerStyles.border,
                        borderTopWidth: "1px",
                        backgroundColor: "color-mix(in srgb, var(--reader-fg) 3%, var(--reader-bg))",
                        ...readerStyles.textMuted,
                    }}
                >
                    <span>{isPdf ? `${tocItems.length} Outline Items` : `${tocItems.length} Chapters`}</span>
                    <span>Jump to section</span>
                </div>
            </div>
        </>
    );
}

export default TableOfContents;
