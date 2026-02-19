import { useState, useEffect, useRef } from "react";
import {
    Highlighter,
    PenLine,
    Type,
    Eraser,
    X,
    Palette,
    Pencil,
    ChevronUp,
    ChevronDown,
    Check,
    Edit3
} from "lucide-react";
import { cn } from "../../../core";
import { HIGHLIGHT_SOLID_COLORS } from "../../../core";
import type { HighlightColor } from "../../../core";

interface PDFFloatingToolbarProps {
    annotationMode: 'none' | 'highlight' | 'pen' | 'text' | 'erase';
    highlightColor: HighlightColor;
    penColor: HighlightColor;
    penWidth: number;
    onAnnotationModeChange: (mode: 'none' | 'highlight' | 'pen' | 'text' | 'erase') => void;
    onHighlightColorChange: (color: HighlightColor) => void;
    onPenColorChange: (color: HighlightColor) => void;
    onPenWidthChange: (width: number) => void;
    className?: string;
}

const annotationColorSwatches: Array<{ color: HighlightColor; label: string; fill: string }> = [
    { color: "yellow", label: "Yellow", fill: HIGHLIGHT_SOLID_COLORS.yellow },
    { color: "green", label: "Green", fill: HIGHLIGHT_SOLID_COLORS.green },
    { color: "blue", label: "Blue", fill: HIGHLIGHT_SOLID_COLORS.blue },
    { color: "red", label: "Red", fill: HIGHLIGHT_SOLID_COLORS.red },
    { color: "orange", label: "Orange", fill: HIGHLIGHT_SOLID_COLORS.orange },
    { color: "purple", label: "Purple", fill: HIGHLIGHT_SOLID_COLORS.purple },
];

export function PDFFloatingToolbar({
    annotationMode,
    highlightColor,
    penColor,
    penWidth,
    onAnnotationModeChange,
    onHighlightColorChange,
    onPenColorChange,
    onPenWidthChange,
    className,
}: PDFFloatingToolbarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [showColors, setShowColors] = useState(false);

    // Auto-open colors when highlighting or pen is active
    useEffect(() => {
        if (annotationMode === 'highlight' || annotationMode === 'pen') {
            setShowColors(true);
        } else {
            setShowColors(false);
        }
    }, [annotationMode]);

    const activeColor = annotationMode === 'pen' ? penColor : highlightColor;
    const onColorChange = annotationMode === 'pen' ? onPenColorChange : onHighlightColorChange;

    const toggleOpen = () => {
        if (isOpen) {
            setIsOpen(false);
            onAnnotationModeChange('none');
        } else {
            setIsOpen(true);
        }
    };

    return (
        <div className={cn("fixed z-[100] flex flex-col items-end gap-4 pointer-events-none", className)}>
            {/* Toolbar Container */}
            <div
                className={cn(
                    "flex flex-col gap-2 transition-all duration-300 ease-out origin-bottom-right pointer-events-auto",
                    isOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-90 translate-y-8 pointer-events-none"
                )}
            >
                {/* Tools */}
                <div className="flex flex-col items-center gap-2 p-2 rounded-2xl bg-[var(--color-surface)]/90 backdrop-blur-xl border border-[var(--color-border)] shadow-2xl">
                    {/* Tool Buttons */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onAnnotationModeChange(annotationMode === 'highlight' ? 'none' : 'highlight')}
                            className={cn(
                                "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200",
                                annotationMode === 'highlight'
                                    ? "bg-[var(--color-accent)] text-white shadow-lg scale-105"
                                    : "hover:bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            )}
                            title="Highlight"
                        >
                            <Highlighter className="w-5 h-5" />
                        </button>

                        <button
                            onClick={() => onAnnotationModeChange(annotationMode === 'pen' ? 'none' : 'pen')}
                            className={cn(
                                "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200",
                                annotationMode === 'pen'
                                    ? "bg-[var(--color-accent)] text-white shadow-lg scale-105"
                                    : "hover:bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            )}
                            title="Pen"
                        >
                            <Pencil className="w-5 h-5" />
                        </button>

                        <button
                            onClick={() => onAnnotationModeChange(annotationMode === 'text' ? 'none' : 'text')}
                            className={cn(
                                "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200",
                                annotationMode === 'text'
                                    ? "bg-[var(--color-accent)] text-white shadow-lg scale-105"
                                    : "hover:bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            )}
                            title="Text"
                        >
                            <Type className="w-5 h-5" />
                        </button>

                        <button
                            onClick={() => onAnnotationModeChange(annotationMode === 'erase' ? 'none' : 'erase')}
                            className={cn(
                                "relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200",
                                annotationMode === 'erase'
                                    ? "bg-[var(--color-accent)] text-white shadow-lg scale-105"
                                    : "hover:bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            )}
                            title="Eraser"
                        >
                            <Eraser className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Color Picker (Conditional) */}
                    {(annotationMode === 'highlight' || annotationMode === 'pen') && (
                        <div className="w-full h-px bg-[var(--color-border)]/50 my-1" />
                    )}

                    {(annotationMode === 'highlight' || annotationMode === 'pen') && (
                        <div className="flex items-center justify-center gap-2 p-1 w-full overflow-x-auto no-scrollbar">
                            {annotationColorSwatches.map((swatch) => (
                                <button
                                    key={swatch.color}
                                    onClick={() => onColorChange(swatch.color)}
                                    className={cn(
                                        "w-6 h-6 rounded-full transition-transform ring-2 ring-transparent",
                                        activeColor === swatch.color ? "scale-110 ring-[var(--color-border)] shadow-sm" : "hover:scale-110"
                                    )}
                                    style={{ backgroundColor: swatch.fill }}
                                    title={swatch.label}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main FAB Toggle */}
            <button
                onClick={toggleOpen}
                className={cn(
                    "pointer-events-auto flex items-center justify-center w-14 h-14 rounded-2xl shadow-xl transition-all duration-300",
                    isOpen
                        ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] border border-[var(--color-border)] rotate-90"
                        : "bg-[var(--color-accent)] text-white hover:scale-105 hover:shadow-2xl hover:-translate-y-0.5"
                )}
                aria-label={isOpen ? "Close tools" : "Open tools"}
            >
                {isOpen ? (
                    <X className="w-6 h-6" />
                ) : (
                    <Edit3 className="w-6 h-6 ml-0.5" />
                )}
            </button>
        </div>
    );
}

export default PDFFloatingToolbar;
