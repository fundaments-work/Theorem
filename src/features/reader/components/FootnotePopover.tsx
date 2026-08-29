import { useEffect, useRef } from "react";
import { Copy, ExternalLink, X, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../../core/lib/utils";
import { isMobile } from "../../../core/lib/env";
import type { FootnoteData } from "../engines/foliate-engine";

export interface FootnotePopoverProps {
    footnote: FootnoteData | null;
    onClose: () => void;
    onJump?: (href: string) => void;
}

export function FootnotePopover({ footnote, onClose, onJump }: FootnotePopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const isMobileDevice = isMobile();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("mousedown", handleClickOutside);
        window.addEventListener("touchstart", handleClickOutside);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("mousedown", handleClickOutside);
            window.removeEventListener("touchstart", handleClickOutside);
        };
    }, [onClose]);

    if (!footnote) return null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(footnote.text);
            toast.success("Footnote copied to clipboard");
        } catch {
            toast.error("Failed to copy");
        }
    };

    return (
        <div
            className={cn(
                "fixed z-[150] transition-all duration-200 ease-out animate-fade-in",
                isMobileDevice
                    ? "inset-x-0 bottom-0 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
                    : "top-16 right-8 max-w-md w-full"
            )}
        >
            {/* Backdrop on mobile */}
            {isMobileDevice && (
                <div
                    onClick={onClose}
                    className="fixed inset-0 -z-10 bg-black/40 backdrop-blur-[1px] transition-opacity"
                />
            )}

            <div
                ref={popoverRef}
                className={cn(
                    "flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl overflow-hidden",
                    isMobileDevice ? "rounded-t-2xl max-h-[60vh]" : "rounded-xl max-h-[480px]"
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]">
                    <div className="flex items-center gap-2 min-w-0">
                        <BookOpen className="h-4 w-4 text-[color:var(--color-accent)] shrink-0" />
                        <span className="text-xs font-bold uppercase tracking-wider text-[color:var(--color-text-primary)] truncate">
                            {footnote.title || "Footnote / Citation"}
                        </span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={handleCopy}
                            className="p-1.5 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface)] rounded transition-colors"
                            title="Copy text"
                            aria-label="Copy text"
                        >
                            <Copy className="h-3.5 w-3.5" />
                        </button>

                        {footnote.href && onJump && (
                            <button
                                onClick={() => {
                                    if (footnote.href) onJump(footnote.href);
                                    onClose();
                                }}
                                className="p-1.5 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent)] hover:bg-[var(--color-surface)] rounded transition-colors"
                                title="Jump to note section"
                                aria-label="Jump to note section"
                            >
                                <ExternalLink className="h-3.5 w-3.5" />
                            </button>
                        )}

                        <button
                            onClick={onClose}
                            className="p-1.5 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface)] rounded transition-colors ml-1"
                            title="Close"
                            aria-label="Close"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-4 overflow-y-auto overscroll-contain text-xs leading-relaxed text-[color:var(--color-text-primary)] select-text">
                    {footnote.html ? (
                        <div
                            dangerouslySetInnerHTML={{ __html: footnote.html }}
                            className="[&_a]:text-[color:var(--color-accent)] [&_a]:underline"
                        />
                    ) : (
                        <p className="whitespace-pre-line">{footnote.text}</p>
                    )}
                </div>
            </div>
        </div>
    );
}
