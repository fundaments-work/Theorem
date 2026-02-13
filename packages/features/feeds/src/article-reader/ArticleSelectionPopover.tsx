import { useEffect, useRef, useState } from "react";
import { Copy, Languages } from "lucide-react";
import { cn, HIGHLIGHT_PICKER_COLORS, type HighlightColor } from "@theorem/core";

interface ArticleSelectionPopoverProps {
    isOpen: boolean;
    position: { x: number; y: number };
    selectedText: string;
    onHighlight: (color: HighlightColor) => void;
    onDefine: () => void;
    onCopy: () => void;
    onClose: () => void;
}

const HIGHLIGHT_OPTIONS: Array<{ color: HighlightColor; label: string }> = [
    { color: "yellow", label: "Yellow" },
    { color: "green", label: "Green" },
    { color: "blue", label: "Blue" },
    { color: "red", label: "Red" },
    { color: "orange", label: "Orange" },
    { color: "purple", label: "Purple" },
];

export function ArticleSelectionPopover({
    isOpen,
    position,
    selectedText,
    onHighlight,
    onDefine,
    onCopy,
    onClose,
}: ArticleSelectionPopoverProps) {
    const popoverRef = useRef<HTMLDivElement>(null);
    const [adjustedPosition, setAdjustedPosition] = useState(position);

    useEffect(() => {
        if (!isOpen || !popoverRef.current) {
            return;
        }

        const rect = popoverRef.current.getBoundingClientRect();
        const pad = 12;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let x = position.x - rect.width / 2;
        let y = position.y - rect.height - 12;

        if (x + rect.width > viewportWidth - pad) {
            x = viewportWidth - rect.width - pad;
        }
        if (x < pad) {
            x = pad;
        }
        if (y < pad) {
            y = position.y + 12;
        }
        if (y + rect.height > viewportHeight - pad) {
            y = viewportHeight - rect.height - pad;
        }

        setAdjustedPosition({ x, y });
    }, [isOpen, position]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const timer = setTimeout(() => {
            document.addEventListener("mousedown", handlePointerDown, true);
        }, 60);

        return () => {
            clearTimeout(timer);
            document.removeEventListener("mousedown", handlePointerDown, true);
        };
    }, [isOpen, onClose]);

    if (!isOpen) {
        return null;
    }

    return (
        <div
            ref={popoverRef}
            className={cn(
                "fixed z-[calc(var(--z-popover)+1)] border rounded-xl shadow-[var(--shadow-md)] p-2",
                "bg-[var(--color-surface)] border-[var(--color-border)] animate-fade-in",
            )}
            style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
        >
            <div className="flex gap-1 px-1 mb-2">
                {HIGHLIGHT_OPTIONS.map(({ color, label }) => (
                    <button
                        key={color}
                        onClick={() => onHighlight(color)}
                        className={cn(
                            "w-7 h-7 rounded-lg border shadow-sm",
                            "hover:scale-110 active:scale-95 transition-[transform,box-shadow] duration-150",
                            "border-[var(--color-overlay-subtle)]",
                        )}
                        style={{ backgroundColor: HIGHLIGHT_PICKER_COLORS[color] }}
                        title={label}
                    />
                ))}
            </div>

            <div className="grid gap-1">
                <button
                    onClick={onDefine}
                    className={cn(
                        "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg",
                        "text-[var(--font-size-2xs)] font-medium",
                        "bg-[var(--color-surface-variant)] text-[color:var(--color-text-secondary)]",
                        "hover:bg-[var(--color-surface-hover)] hover:text-[color:var(--color-text-primary)]",
                        "transition-colors duration-150",
                    )}
                >
                    <Languages className="w-3 h-3" />
                    Define
                </button>
                <button
                    onClick={onCopy}
                    className={cn(
                        "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg",
                        "text-[var(--font-size-2xs)] font-medium",
                        "bg-[var(--color-surface-variant)] text-[color:var(--color-text-secondary)]",
                        "hover:bg-[var(--color-surface-hover)] hover:text-[color:var(--color-text-primary)]",
                        "transition-colors duration-150",
                    )}
                >
                    <Copy className="w-3 h-3" />
                    Copy
                </button>
            </div>

            {selectedText && (
                <p className="mt-2 px-1 text-[10px] text-[color:var(--color-text-muted)] line-clamp-2 max-w-[12rem]">
                    {selectedText}
                </p>
            )}
        </div>
    );
}
