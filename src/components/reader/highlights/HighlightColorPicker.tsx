/**
 * HighlightColorPicker Component
 * Popup for selecting highlight color when text is selected
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Highlighter, MessageSquare, Bookmark, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HighlightColor } from '@/types';

interface HighlightColorPickerProps {
    isOpen: boolean;
    position: { x: number; y: number };
    selectedText: string;
    onSelectColor: (color: HighlightColor) => void;
    onAddNote: () => void;
    onBookmark: () => void;
    onClose: () => void;
}

const COLOR_OPTIONS: { color: HighlightColor; bg: string; border: string; label: string }[] = [
    { 
        color: 'yellow', 
        bg: 'bg-yellow-400', 
        border: 'border-yellow-500',
        label: 'Yellow'
    },
    { 
        color: 'green', 
        bg: 'bg-green-500', 
        border: 'border-green-600',
        label: 'Green'
    },
    { 
        color: 'blue', 
        bg: 'bg-blue-500', 
        border: 'border-blue-600',
        label: 'Blue'
    },
    { 
        color: 'red', 
        bg: 'bg-red-500', 
        border: 'border-red-600',
        label: 'Red'
    },
    { 
        color: 'orange', 
        bg: 'bg-orange-500', 
        border: 'border-orange-600',
        label: 'Orange'
    },
    { 
        color: 'purple', 
        bg: 'bg-purple-500', 
        border: 'border-purple-600',
        label: 'Purple'
    },
];

export function HighlightColorPicker({
    isOpen,
    position,
    selectedText,
    onSelectColor,
    onAddNote,
    onBookmark,
    onClose,
}: HighlightColorPickerProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const [adjustedPosition, setAdjustedPosition] = useState(position);

    // Adjust position to keep popup on screen
    useEffect(() => {
        if (!isOpen) return;

        const popup = popupRef.current;
        if (!popup) return;

        const rect = popup.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let { x, y } = position;

        // Adjust horizontal position
        if (x + rect.width > viewportWidth) {
            x = viewportWidth - rect.width - 16;
        }
        if (x < 16) {
            x = 16;
        }

        // Adjust vertical position (show above or below selection)
        if (y + rect.height > viewportHeight) {
            y = y - rect.height - 40; // Show above
        }
        if (y < 16) {
            y = 16;
        }

        setAdjustedPosition({ x, y });
    }, [isOpen, position]);

    // Handle click outside
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        // Delay to avoid immediate close from selection click
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);

    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleColorClick = useCallback((color: HighlightColor) => {
        onSelectColor(color);
    }, [onSelectColor]);

    if (!isOpen) return null;

    return (
        <div
            ref={popupRef}
            className={cn(
                "fixed z-[100] animate-fade-in",
                "bg-[var(--color-surface)]",
                "border border-[var(--color-border)]",
                "rounded-lg shadow-lg",
                "p-3 min-w-[240px]"
            )}
            style={{
                left: adjustedPosition.x,
                top: adjustedPosition.y,
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    Highlight
                </span>
                <button
                    onClick={onClose}
                    className={cn(
                        "p-1 rounded-md",
                        "text-[var(--color-text-muted)]",
                        "hover:bg-[var(--color-surface-hover)]",
                        "transition-colors"
                    )}
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Selected text preview */}
            {selectedText && (
                <div className="mb-3 px-2 py-1.5 bg-[var(--color-surface-variant)] rounded text-xs text-[var(--color-text-secondary)] truncate">
                    &ldquo;{selectedText.slice(0, 60)}{selectedText.length > 60 ? '...' : ''}&rdquo;
                </div>
            )}

            {/* Color options */}
            <div className="flex gap-1.5 mb-3">
                {COLOR_OPTIONS.map(({ color, bg, border, label }) => (
                    <button
                        key={color}
                        onClick={() => handleColorClick(color)}
                        className={cn(
                            "w-8 h-8 rounded-md",
                            bg,
                            "border-2",
                            border,
                            "hover:scale-110",
                            "active:scale-95",
                            "transition-transform",
                            "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-1"
                        )}
                        title={label}
                        aria-label={`Select ${label} highlight color`}
                    />
                ))}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-2 border-t border-[var(--color-border)]">
                <button
                    onClick={onAddNote}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-1.5",
                        "px-3 py-1.5 text-xs font-medium",
                        "rounded-md",
                        "text-[var(--color-text-secondary)]",
                        "hover:bg-[var(--color-surface-hover)]",
                        "hover:text-[var(--color-text-primary)]",
                        "transition-colors"
                    )}
                >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Add Note
                </button>
                <button
                    onClick={onBookmark}
                    className={cn(
                        "flex-1 flex items-center justify-center gap-1.5",
                        "px-3 py-1.5 text-xs font-medium",
                        "rounded-md",
                        "text-[var(--color-text-secondary)]",
                        "hover:bg-[var(--color-surface-hover)]",
                        "hover:text-[var(--color-text-primary)]",
                        "transition-colors"
                    )}
                >
                    <Bookmark className="w-3.5 h-3.5" />
                    Bookmark
                </button>
            </div>
        </div>
    );
}

export default HighlightColorPicker;
