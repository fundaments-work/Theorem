/**
 * HighlightColorPicker Component - Optimized & Redesigned
 * Modern, sleek popup for selecting highlight color with smooth animations
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Bookmark, X, Check } from 'lucide-react';
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

// Color configurations with proper highlight styling
const COLOR_OPTIONS: { 
    color: HighlightColor; 
    bg: string; 
    activeBg: string;
    label: string;
}[] = [
    { 
        color: 'yellow', 
        bg: 'bg-[#FFE082]', 
        activeBg: 'bg-[#FFD54F]',
        label: 'Yellow'
    },
    { 
        color: 'green', 
        bg: 'bg-[#A5D6A7]', 
        activeBg: 'bg-[#81C784]',
        label: 'Green'
    },
    { 
        color: 'blue', 
        bg: 'bg-[#90CAF9]', 
        activeBg: 'bg-[#64B5F6]',
        label: 'Blue'
    },
    { 
        color: 'red', 
        bg: 'bg-[#EF9A9A]', 
        activeBg: 'bg-[#E57373]',
        label: 'Red'
    },
    { 
        color: 'orange', 
        bg: 'bg-[#FFCC80]', 
        activeBg: 'bg-[#FFB74D]',
        label: 'Orange'
    },
    { 
        color: 'purple', 
        bg: 'bg-[#CE93D8]', 
        activeBg: 'bg-[#BA68C8]',
        label: 'Purple'
    },
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
    onSelectColor,
    onAddNote,
    onBookmark,
    onClose,
}: HighlightColorPickerProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [isClosing, setIsClosing] = useState(false);
    const [selectedColor, setSelectedColor] = useState<HighlightColor | null>(null);

    // Position calculation with viewport boundary detection
    useEffect(() => {
        if (!isOpen) {
            setIsClosing(false);
            setSelectedColor(null);
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

    // Keyboard shortcuts
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
            }
            
            // Number keys 1-6 for quick color selection
            const num = parseInt(e.key);
            if (num >= 1 && num <= 6) {
                e.preventDefault();
                handleColorClick(COLOR_OPTIONS[num - 1].color);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, handleClose, handleColorClick]);

    // Click outside handler
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                handleClose();
            }
        };

        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 50);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, handleClose]);

    if (!isOpen) return null;

    return (
        <>
            <style>{ANIMATION_STYLES}</style>
            <div
                ref={popupRef}
                className={cn(
                    "fixed z-[100]",
                    "bg-[var(--color-surface)]",
                    "border border-[var(--color-border)]",
                    "rounded-xl shadow-xl",
                    "p-2",
                    isClosing ? "picker-animate-out" : "picker-animate-in"
                )}
                style={{
                    left: adjustedPosition.x,
                    top: adjustedPosition.y,
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)',
                }}
            >
                {/* Header with close button */}
                <div className="flex items-center justify-between px-1 mb-2">
                    <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
                        Highlight
                    </span>
                    <button
                        onClick={handleClose}
                        className={cn(
                            "p-1 rounded-md",
                            "text-[var(--color-text-muted)]",
                            "hover:bg-[var(--color-surface-hover)]",
                            "hover:text-[var(--color-text-primary)]",
                            "transition-all duration-150"
                        )}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Color grid - more compact */}
                <div className="flex gap-1 px-1 mb-3">
                    {COLOR_OPTIONS.map(({ color, bg, activeBg, label }) => (
                        <button
                            key={color}
                            onClick={() => handleColorClick(color)}
                            className={cn(
                                "w-7 h-7 rounded-lg",
                                "flex items-center justify-center",
                                selectedColor === color ? activeBg : bg,
                                "border border-black/10",
                                "shadow-sm",
                                "hover:scale-110",
                                "hover:shadow-md",
                                "active:scale-95",
                                "transition-all duration-150",
                                "focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-1"
                            )}
                            title={`${label} (Shortcut: ${COLOR_OPTIONS.findIndex(c => c.color === color) + 1})`}
                            aria-label={`Select ${label} highlight color`}
                        >
                            {selectedColor === color && (
                                <Check className="w-3.5 h-3.5 text-black/60" strokeWidth={3} />
                            )}
                        </button>
                    ))}
                </div>

                {/* Action buttons - more compact and modern */}
                <div className="flex gap-1">
                    <button
                        onClick={() => {
                            onAddNote();
                            handleClose();
                        }}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5",
                            "px-2 py-1.5 text-[11px] font-medium",
                            "rounded-lg",
                            "bg-[var(--color-surface-variant)]",
                            "text-[var(--color-text-secondary)]",
                            "hover:bg-[var(--color-surface-hover)]",
                            "hover:text-[var(--color-text-primary)]",
                            "transition-all duration-150",
                            "active:scale-95"
                        )}
                    >
                        <MessageSquare className="w-3 h-3" />
                        Note
                    </button>
                    <button
                        onClick={() => {
                            onBookmark();
                            handleClose();
                        }}
                        className={cn(
                            "flex-1 flex items-center justify-center gap-1.5",
                            "px-2 py-1.5 text-[11px] font-medium",
                            "rounded-lg",
                            "bg-[var(--color-surface-variant)]",
                            "text-[var(--color-text-secondary)]",
                            "hover:bg-[var(--color-surface-hover)]",
                            "hover:text-[var(--color-text-primary)]",
                            "transition-all duration-150",
                            "active:scale-95"
                        )}
                    >
                        <Bookmark className="w-3 h-3" />
                        Bookmark
                    </button>
                </div>
            </div>
        </>
    );
}

export default HighlightColorPicker;
