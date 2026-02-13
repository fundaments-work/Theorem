import { ChevronRight, List, X } from "lucide-react";
import { cn } from "@theorem/core";
import { FloatingPanel } from "@theorem/ui";
import type { ArticleHeading } from "./types";

interface ArticleReaderOutlinePanelProps {
    visible: boolean;
    headings: ArticleHeading[];
    onJumpToHeading: (headingId: string) => void;
    onClose: () => void;
}

export function ArticleReaderOutlinePanel({
    visible,
    headings,
    onJumpToHeading,
    onClose,
}: ArticleReaderOutlinePanelProps) {
    return (
        <FloatingPanel visible={visible} anchor="top-left" className="overflow-hidden">
            <div className="reader-panel-header px-4 pt-4 pb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <List className="w-4 h-4 text-[color:var(--color-accent)]" />
                    <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">Table of Contents</h2>
                </div>
                <button
                    onClick={onClose}
                    className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80"
                    title="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3 custom-scrollbar">
                {headings.length === 0 && (
                    <p className="text-sm text-[color:var(--color-text-muted)] text-center py-10">
                        No headings found in this article.
                    </p>
                )}

                {headings.map((heading) => {
                    const depth = Math.min(heading.level - 1, 3);
                    return (
                        <button
                            key={heading.id}
                            onClick={() => onJumpToHeading(heading.id)}
                            className={cn(
                                "w-full text-left p-3 rounded-xl transition-colors",
                                "hover:bg-[var(--color-background)]",
                                "flex items-start justify-between gap-2",
                            )}
                            style={{ paddingLeft: `${0.75 + depth * 0.65}rem` }}
                        >
                            <span className="text-sm text-[color:var(--color-text-secondary)] line-clamp-2">
                                {heading.text}
                            </span>
                            <ChevronRight className="w-4 h-4 shrink-0 text-[color:var(--color-text-muted)]" />
                        </button>
                    );
                })}
            </div>
        </FloatingPanel>
    );
}
