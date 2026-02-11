/**
 * HighlightColorPicker Component - Optimized & Redesigned
 * Modern, sleek popup for selecting highlight color with smooth animations
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, X, Check, Trash2 } from 'lucide-react';
import { ask } from '@tauri-apps/plugin-dialog';
import {
    HIGHLIGHT_COLOR_TOKENS,
    HIGHLIGHT_PICKER_ACTIVE_COLORS,
    HIGHLIGHT_PICKER_COLORS,
} from "@/lib/design-tokens";
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/env';
import type { HighlightColor } from '@/types';

interface HighlightColorPickerProps {
    isOpen: boolean;
    position: { x: number; y: number };
    selectedText: string;
    currentColor?: HighlightColor | null;
    onSelectColor: (color: HighlightColor) => void;
    onAddNote: () => void;
    onBookmark: () => void;
    onDelete?: () => void;
    onClose: () => void;
}

// Color configurations with proper highlight styling
const COLOR_OPTIONS: { 
    color: HighlightColor;
    label: string;
}[] = [
    { color: "yellow", label: HIGHLIGHT_COLOR_TOKENS.yellow.label },
    { color: "green", label: HIGHLIGHT_COLOR_TOKENS.green.label },
    { color: "blue", label: HIGHLIGHT_COLOR_TOKENS.blue.label },
    { color: "red", label: HIGHLIGHT_COLOR_TOKENS.red.label },
    { color: "orange", label: HIGHLIGHT_COLOR_TOKENS.orange.label },
    { color: "purple", label: HIGHLIGHT_COLOR_TOKENS.purple.label },
];

// Animation keyframes
const ANIMATION_STYLES = `
    @keyframes picker-appear {
        from {
            opacity: 0;
            transform: translateY(8px) scale(0.96);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
    
    @keyframes picker-disappear {
        from {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
        to {
            opacity: 0;
            transform: translateY(8px) scale(0.96);
        }
    }
    
    .picker-animate-in {
        animation: picker-appear 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    
    .picker-animate-out {
        animation: picker-disappear 150ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
`;

export function HighlightColorPicker({
    isOpen,
    position,
    currentColor,
    onSelectColor,
    onAddNote,
    onBookmark,
    onDelete,
    onClose,
}: HighlightColorPickerProps) {
    // Only render if open or closing animation is active
    // This optimization prevents any DOM work when closed
    if (!isOpen) return null;

    if (process.env.NODE_ENV === 'development') {
        console.debug('[HighlightColorPicker] RENDER: isOpen=', isOpen, 'onDelete=', typeof onDelete, 'currentColor=', currentColor);
    }

    const popupRef = useRef<HTMLDivElement>(null);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [isClosing, setIsClosing] = useState(false);
    const [selectedColor, setSelectedColor] = useState<HighlightColor | null>(currentColor || null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Sync selectedColor with currentColor when picker opens
    useEffect(() => {
        if (isOpen) {
            setSelectedColor(currentColor || null);
            setShowDeleteConfirm(false);
        }
    }, [isOpen, currentColor]);

    // Position calculation with viewport boundary detection
    useEffect(() => {
        // Skip calculation if not open
        if (!isOpen) {
            setIsClosing(false);
            return;
        }

        const calculatePosition = () => {
            const popup = popupRef.current;
            if (!popup) return;

            const rect = popup.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const padding = 12;

            let { x, y } = position;

            // Center horizontally relative to click position
            x = x - rect.width / 2;

            // Adjust horizontal bounds
            if (x + rect.width > viewportWidth - padding) {
                x = viewportWidth - rect.width - padding;
            }
            if (x < padding) {
                x = padding;
            }

            // Position above or below based on available space
            const spaceAbove = position.y;
            const spaceBelow = viewportHeight - position.y;
            
            if (spaceBelow < rect.height + padding && spaceAbove > rect.height) {
                y = position.y - rect.height - 12; // Show above
            } else {
                y = position.y + 12; // Show below
            }

            // Ensure vertical bounds
            if (y + rect.height > viewportHeight - padding) {
                y = viewportHeight - rect.height - padding;
            }
            if (y < padding) {
                y = padding;
            }

            setAdjustedPosition({ x, y });
        };

        // Small delay to ensure popup is rendered for measurement
        requestAnimationFrame(calculatePosition);
    }, [isOpen, position]);

    // Close handlers with animation
    const handleClose = useCallback(() => {
        setIsClosing(true);
        setTimeout(onClose, 150);
    }, [onClose]);

    // Color selection with animation feedback
    const handleColorClick = useCallback((color: HighlightColor) => {
        setSelectedColor(color);
        // Small delay for visual feedback before closing
        requestAnimationFrame(() => {
            onSelectColor(color);
        });
    }, [onSelectColor]);

    // Handle delete with confirmation
    const handleDeleteClick = useCallback(async () => {
        if (isTauri()) {
            // Tauri uses its own native dialog
            // Use empty title to avoid duplication
            const confirmed = await ask('Delete this highlight and any associated notes?', {
                title: '',
                kind: 'warning',
            });
            if (confirmed) {
                onDelete?.();
                handleClose();
            }
        } else {
            // Web: use inline confirm UI to avoid native confirm() duplication
            setShowDeleteConfirm(true);
        }
    }, [onDelete, handleClose]);

    const handleDeleteConfirmed = useCallback(() => {
        setShowDeleteConfirm(false);
        onDelete?.();
        handleClose();
    }, [onDelete, handleClose]);

    const handleDeleteCancelled = useCallback(() => {
        setShowDeleteConfirm(false);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                if (showDeleteConfirm) {
                    setShowDeleteConfirm(false);
                } else {
                    handleClose();
                }
            }
            
            // Number keys 1-6 for quick color selection (only when not confirming delete)
            if (!showDeleteConfirm) {
                const num = parseInt(e.key);
                if (num >= 1 && num <= 6) {
                    e.preventDefault();
                    handleColorClick(COLOR_OPTIONS[num - 1].color);
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, showDeleteConfirm, handleClose, handleColorClick]);

    // Click outside handler - also handles clicks in iframe
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                console.debug('[HighlightColorPicker] Click outside detected, closing');
                handleClose();
            }
        };

        // Use capture phase to catch clicks before they reach iframe
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside, true);
            document.addEventListener('click', handleClickOutside, true);
        }, 50);

        // Also close on scroll or resize
        const handleScrollOrResize = () => {
            console.debug('[HighlightColorPicker] Scroll/resize detected, closing');
            handleClose();
        };
        
        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside, true);
            document.removeEventListener('click', handleClickOutside, true);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [isOpen, handleClose]);

    // Final safety check - redundant with early return but good for clarity


    return (
        <>
            <style>{ANIMATION_STYLES}</style>
            <div
                ref={popupRef}
                className={cn(
                    "fixed z-[100]",
                    "bg-[var(--color-surface)]",
                    "border border-[var(--color-border)]",
                    "rounded-xl shadow-[var(--shadow-md)]",
                    "p-2",
                    isClosing ? "picker-animate-out" : "picker-animate-in"
                )}
                style={{
                    left: adjustedPosition.x,
                    top: adjustedPosition.y,
                }}
            >
                {/* Header with close button */}
                <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-xs font-semibold text-[color:var(--color-text-secondary)] uppercase tracking-wide">
                        Highlight
                    </span>
                    <button
                        onClick={handleClose}
                        className={cn(
                            "p-1 rounded-md",
                            "text-[color:var(--color-text-muted)]",
                            "hover:bg-[var(--color-surface-hover)]",
                            "hover:text-[color:var(--color-text-primary)]",
                            "transition-colors duration-150"
                        )}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Inline delete confirmation */}
                {showDeleteConfirm ? (
                    <div className="px-1 py-2">
                        <p className="text-xs text-[color:var(--color-text-secondary)] text-center mb-2">
                            Delete this highlight and any associated notes?
                        </p>
                        <div className="flex gap-1.5">
                            <button
                                onClick={handleDeleteCancelled}
                                className={cn(
                                    "flex-1 px-2 py-1.5 text-[var(--font-size-2xs)] font-medium",
                                    "rounded-lg",
                                    "bg-[var(--color-surface-variant)]",
                                    "text-[color:var(--color-text-secondary)]",
                                    "hover:bg-[var(--color-surface-hover)]",
                                    "hover:text-[color:var(--color-text-primary)]",
                                    "transition-colors duration-150",
                                    "active:scale-95"
                                )}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeleteConfirmed}
                                className={cn(
                                    "reader-danger-action flex-1 px-2 py-1.5 text-[var(--font-size-2xs)] font-medium",
                                    "rounded-lg",
                                    "bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]",
                                    "transition-colors duration-150",
                                    "active:scale-95"
                                )}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Color grid */}
                        <div className="flex gap-1 px-1 mb-3">
                            {COLOR_OPTIONS.map(({ color, label }) => (
                                <button
                                    key={color}
                                    onClick={() => handleColorClick(color)}
                                    className={cn(
                                        "w-7 h-7 rounded-lg",
                                        "flex items-center justify-center",
                                        "border border-[var(--color-overlay-subtle)]",
                                        "shadow-sm",
                                        "hover:scale-110",
                                        "hover:shadow-md",
                                        "active:scale-95",
                                        "transition-[transform,box-shadow] duration-150",
                                        "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-1"
                                    )}
                                    style={{
                                        backgroundColor: selectedColor === color
                                            ? HIGHLIGHT_PICKER_ACTIVE_COLORS[color]
                                            : HIGHLIGHT_PICKER_COLORS[color],
                                    }}
                                    title={`${label} (Shortcut: ${COLOR_OPTIONS.findIndex(c => c.color === color) + 1})`}
                                    aria-label={`Select ${label} highlight color`}
                                >
                                    {selectedColor === color && (
                                        <Check className="w-3.5 h-3.5 text-[color:var(--color-overlay-strong)]" strokeWidth={3} />
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-1">
                            <button
                                onClick={() => {
                                    onAddNote();
                                    handleClose();
                                }}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-1.5",
                                    "px-2 py-1.5 text-[var(--font-size-2xs)] font-medium",
                                    "rounded-lg",
                                    "bg-[var(--color-surface-variant)]",
                                    "text-[color:var(--color-text-secondary)]",
                                    "hover:bg-[var(--color-surface-hover)]",
                                    "hover:text-[color:var(--color-text-primary)]",
                                    "transition-colors duration-150",
                                    "active:scale-95"
                                )}
                            >
                                <MessageSquare className="w-3 h-3" />
                                Add Note
                            </button>
                        </div>

                        {/* Delete button - only shown when onDelete is provided */}
                        {onDelete && (
                            <>
                                <div className="my-2 border-t border-[var(--color-border)]" />
                                <button
                                    onClick={handleDeleteClick}
                                    className={cn(
                                        "reader-danger-action w-full flex items-center justify-center gap-1.5",
                                        "px-2 py-1.5 text-[var(--font-size-2xs)] font-medium",
                                        "rounded-lg",
                                        "hover:bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]",
                                        "transition-colors duration-150",
                                        "active:scale-95"
                                    )}
                                >
                                    <Trash2 className="w-3 h-3" />
                                    Delete
                                </button>
                            </>
                        )}
                    </>
                )}
            </div>
        </>
    );
}

export default HighlightColorPicker;
