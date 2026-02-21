/**
 * HighlightColorPicker Component - Optimized & Redesigned
 * Modern, sleek popup for selecting highlight color with smooth animations
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, X, Check, Trash2, Languages, Loader2, ArrowLeft } from 'lucide-react';
import { ask } from '@tauri-apps/plugin-dialog';
import {
    cn,
    HIGHLIGHT_COLOR_TOKENS,
    HIGHLIGHT_PICKER_ACTIVE_COLORS,
    HIGHLIGHT_PICKER_COLORS,
    isTauri,
    type DictionaryLookupResult,
    type HighlightColor,
} from "../../../../core";

interface HighlightDictionaryViewState {
    term: string;
    result: DictionaryLookupResult | null;
    loading: boolean;
    error?: string | null;
    saved: boolean;
    canSaveToVocabulary?: boolean;
    saveDisabledMessage?: string;
    onSave: () => void;
    onBack?: () => void;
}

interface HighlightColorPickerProps {
    isOpen: boolean;
    position: { x: number; y: number; height?: number };
    currentColor?: HighlightColor | null;
    onSelectColor: (color: HighlightColor) => void;
    onAddNote: () => void;
    onDefine?: () => void;
    onBookmark: () => void;
    onDelete?: () => void;
    dictionary?: HighlightDictionaryViewState;
    viewportPadding?: Partial<{
        top: number;
        right: number;
        bottom: number;
        left: number;
    }>;
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
    onDefine,
    onBookmark,
    onDelete,
    dictionary,
    viewportPadding,
    onClose,
}: HighlightColorPickerProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasScheduledCloseRef = useRef(false);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const [isClosing, setIsClosing] = useState(false);
    const [selectedColor, setSelectedColor] = useState<HighlightColor | null>(currentColor || null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const isDictionaryView = Boolean(dictionary);
    const handlePopupMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button")) {
            event.preventDefault();
        }
    }, []);

    // Sync selectedColor with currentColor when picker opens
    useEffect(() => {
        if (isOpen) {
            setSelectedColor(currentColor || null);
            setShowDeleteConfirm(false);
            setIsClosing(false);
            hasScheduledCloseRef.current = false;
            if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
            }
        }
    }, [isOpen, currentColor]);

    useEffect(() => {
        if (isDictionaryView) {
            setShowDeleteConfirm(false);
        }
    }, [isDictionaryView]);

    // Position calculation with viewport boundary detection
    useEffect(() => {
        // Skip calculation if not open
        if (!isOpen) {
            setIsClosing(false);
            hasScheduledCloseRef.current = false;
            return;
        }

        const calculatePosition = () => {
            const popup = popupRef.current;
            if (!popup) return;

            const rect = popup.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const isMobileViewport = viewportWidth <= 768;
            const boundaryPadding = 12;
            const leftBound = Math.max(boundaryPadding, viewportPadding?.left ?? boundaryPadding);
            const rightBound = Math.min(viewportWidth - boundaryPadding, viewportWidth - (viewportPadding?.right ?? boundaryPadding));
            const softTopBound = Math.max(boundaryPadding, viewportPadding?.top ?? boundaryPadding);
            const softBottomBound = Math.min(viewportHeight - boundaryPadding, viewportHeight - (viewportPadding?.bottom ?? boundaryPadding));
            const hardTopBound = boundaryPadding;
            const hardBottomBound = viewportHeight - boundaryPadding;

            let { x, y } = position;

            // Center horizontally relative to click position
            x = x - rect.width / 2;

            // Adjust horizontal bounds
            if (x + rect.width > rightBound) {
                x = rightBound - rect.width;
            }
            if (x < leftBound) {
                x = leftBound;
            }

            const clampY = (value: number, top: number, bottom: number) => {
                if (value < top) return top;
                if (value + rect.height > bottom) return bottom - rect.height;
                return value;
            };
            const fitsY = (value: number, top: number, bottom: number) => (
                value >= top && value + rect.height <= bottom
            );
            const overlapWithSelection = (popupTop: number, selectionTop: number, selectionBottom: number) => {
                const popupBottom = popupTop + rect.height;
                return Math.max(0, Math.min(popupBottom, selectionBottom) - Math.max(popupTop, selectionTop));
            };

            // Flip above/below based on selection position with a guaranteed visual gap.
            const fallbackSelectionHeight = isMobileViewport ? 32 : 24;
            const selectionHeight = Math.max(position.height ?? fallbackSelectionHeight, fallbackSelectionHeight);
            const inferredSelectionTop = position.height === undefined
                ? position.y - selectionHeight / 2
                : position.y;
            const selectionTop = Math.max(hardTopBound, Math.min(inferredSelectionTop, hardBottomBound - 1));
            const selectionBottom = Math.min(hardBottomBound, selectionTop + selectionHeight);
            const softViewportHeight = Math.max(softBottomBound - softTopBound, 1);
            const isLargeSelection = selectionHeight >= softViewportHeight * 0.55;

            // Mobile-first behavior for select-all / page-sized selections:
            // keep the overlay centered instead of pushing it into status/title bars.
            if (isLargeSelection) {
                x = (viewportWidth - rect.width) / 2;
                if (x + rect.width > rightBound) {
                    x = rightBound - rect.width;
                }
                if (x < leftBound) {
                    x = leftBound;
                }

                y = clampY(
                    softTopBound + (softViewportHeight - rect.height) / 2,
                    softTopBound,
                    softBottomBound,
                );
                setAdjustedPosition({ x, y });
                return;
            }

            const verticalGap = isMobileViewport ? 24 : 14;
            const viewportMidpointY = (softTopBound + softBottomBound) / 2;
            const preferBelow = selectionTop < viewportMidpointY;
            const yBelow = selectionBottom + verticalGap;
            const yAbove = selectionTop - rect.height - verticalGap;
            const canPlaceBelowSoft = fitsY(yBelow, softTopBound, softBottomBound);
            const canPlaceAboveSoft = fitsY(yAbove, softTopBound, softBottomBound);
            const canPlaceBelowHard = fitsY(yBelow, hardTopBound, hardBottomBound);
            const canPlaceAboveHard = fitsY(yAbove, hardTopBound, hardBottomBound);

            if (preferBelow && canPlaceBelowSoft) {
                y = yBelow;
            } else if (!preferBelow && canPlaceAboveSoft) {
                y = yAbove;
            } else if (canPlaceBelowSoft) {
                y = yBelow;
            } else if (canPlaceAboveSoft) {
                y = yAbove;
            } else if (preferBelow && canPlaceBelowHard) {
                y = yBelow;
            } else if (!preferBelow && canPlaceAboveHard) {
                y = yAbove;
            } else if (canPlaceBelowHard) {
                y = yBelow;
            } else if (canPlaceAboveHard) {
                y = yAbove;
            } else {
                const belowClamped = clampY(yBelow, hardTopBound, hardBottomBound);
                const aboveClamped = clampY(yAbove, hardTopBound, hardBottomBound);
                const belowOverlap = overlapWithSelection(belowClamped, selectionTop, selectionBottom);
                const aboveOverlap = overlapWithSelection(aboveClamped, selectionTop, selectionBottom);

                if (preferBelow) {
                    y = belowOverlap <= aboveOverlap ? belowClamped : aboveClamped;
                } else {
                    y = aboveOverlap <= belowOverlap ? aboveClamped : belowClamped;
                }
            }

            // Ensure vertical bounds
            if (y + rect.height > hardBottomBound) {
                y = hardBottomBound - rect.height;
            }
            if (y < hardTopBound) {
                y = hardTopBound;
            }

            setAdjustedPosition({ x, y });
        };

        // Small delay to ensure popup is rendered for measurement
        requestAnimationFrame(calculatePosition);
    }, [
        dictionary?.error,
        dictionary?.loading,
        dictionary?.result,
        dictionary?.saved,
        isOpen,
        position,
        viewportPadding?.bottom,
        viewportPadding?.left,
        viewportPadding?.right,
        viewportPadding?.top,
    ]);

    // Close handlers with animation
    const handleClose = useCallback(() => {
        if (hasScheduledCloseRef.current) {
            return;
        }
        hasScheduledCloseRef.current = true;
        setIsClosing(true);
        closeTimeoutRef.current = setTimeout(() => {
            closeTimeoutRef.current = null;
            hasScheduledCloseRef.current = false;
            onClose();
        }, 150);
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
            if (!showDeleteConfirm && !isDictionaryView) {
                const num = parseInt(e.key);
                if (num >= 1 && num <= 6) {
                    e.preventDefault();
                    handleColorClick(COLOR_OPTIONS[num - 1].color);
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isDictionaryView, isOpen, showDeleteConfirm, handleClose, handleColorClick]);

    // Click outside handler - also handles clicks in iframe
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                handleClose();
            }
        };

        // Use capture phase to catch clicks before they reach iframe
        const timer = setTimeout(() => {
            document.addEventListener('pointerdown', handleClickOutside, true);
            document.addEventListener('mousedown', handleClickOutside, true);
            document.addEventListener('click', handleClickOutside, true);
        }, 50);

        // Also close on scroll or resize
        const handleScrollOrResize = () => {
            handleClose();
        };

        window.addEventListener('scroll', handleScrollOrResize, true);
        window.addEventListener('resize', handleScrollOrResize);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('pointerdown', handleClickOutside, true);
            document.removeEventListener('mousedown', handleClickOutside, true);
            document.removeEventListener('click', handleClickOutside, true);
            window.removeEventListener('scroll', handleScrollOrResize, true);
            window.removeEventListener('resize', handleScrollOrResize);
        };
    }, [isOpen, handleClose]);

    useEffect(() => {
        return () => {
            if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
            }
            hasScheduledCloseRef.current = false;
        };
    }, []);

    // Keep hook ordering stable: return null only after all hooks are declared.
    if (!isOpen) return null;

    const popupContent = (
        <>
            <style>{ANIMATION_STYLES}</style>
            <div
                ref={popupRef}
                onMouseDownCapture={handlePopupMouseDownCapture}
                className={cn(
                    "fixed",
                    "bg-[var(--color-surface)]",
                    "border border-[var(--color-border)]",
                    "shadow-[var(--shadow-md)]",
                    "p-2",
                    isDictionaryView && "w-[20rem] max-w-[calc(100vw-2rem)]",
                    isClosing ? "picker-animate-out" : "picker-animate-in"
                )}
                style={{
                    left: adjustedPosition.x,
                    top: adjustedPosition.y,
                    zIndex: "calc(var(--z-tooltip) + 40)",
                }}
            >
                {/* Header with close button */}
                <div className="flex items-center justify-between px-1 mb-2">
                    <div className="min-w-0">
                        <p className="text-xs font-semibold text-[color:var(--color-text-secondary)] uppercase tracking-wide">
                            {isDictionaryView ? "Dictionary" : "Highlight"}
                        </p>
                        {isDictionaryView && dictionary?.term ? (
                            <p className="truncate text-sm font-semibold text-[color:var(--color-text-primary)]">
                                {dictionary.term}
                            </p>
                        ) : null}
                    </div>
                    <button
                        onClick={handleClose}
                        className={cn(
                            "p-1",
                            "text-[color:var(--color-text-muted)]",
                            "hover:bg-[var(--color-surface-muted)]",
                            "hover:text-[color:var(--color-text-primary)]",
                            "transition-colors duration-150"
                        )}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>

                {isDictionaryView && dictionary ? (
                    <>
                        <div className="max-h-60 overflow-y-auto px-1 py-1">
                            {dictionary.loading && (
                                <div className="flex items-center gap-2 text-sm text-[color:var(--color-text-secondary)]">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Looking up definitions...
                                </div>
                            )}

                            {!dictionary.loading && dictionary.error && (
                                <p className="text-sm text-[color:var(--color-error)]">{dictionary.error}</p>
                            )}

                            {!dictionary.loading && !dictionary.error && !dictionary.result && (
                                <p className="text-sm text-[color:var(--color-text-secondary)]">No definition found.</p>
                            )}

                            {!dictionary.loading && dictionary.result && dictionary.result.meanings.length > 0 && (
                                <div className="space-y-3">
                                    {dictionary.result.phonetic && (
                                        <p className="text-xs text-[color:var(--color-text-muted)]">/{dictionary.result.phonetic}/</p>
                                    )}
                                    {dictionary.result.meanings.slice(0, 3).map((meaning, idx) => (
                                        <div key={`${meaning.provider}-${idx}`} className="space-y-1">
                                            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)]">
                                                {meaning.partOfSpeech || "Meaning"}
                                            </p>
                                            <ul className="space-y-1 text-sm text-[color:var(--color-text-primary)]">
                                                {meaning.definitions.slice(0, 3).map((definition) => (
                                                    <li key={definition} className="leading-snug">
                                                        • {definition}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-2 flex items-center justify-between border-t border-[var(--color-border)] pt-2">
                            {dictionary.onBack ? (
                                <button
                                    onClick={dictionary.onBack}
                                    className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)]"
                                >
                                    <ArrowLeft className="h-3.5 w-3.5" />
                                    Back
                                </button>
                            ) : (
                                <span />
                            )}
                            <button
                                onClick={dictionary.onSave}
                                disabled={
                                    dictionary.loading
                                    || !dictionary.result
                                    || dictionary.saved
                                    || dictionary.canSaveToVocabulary === false
                                }
                                className={cn(
                                    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium",
                                    dictionary.saved
                                        ? "bg-[var(--color-success)]/10 text-[color:var(--color-success)]"
                                        : "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] hover:opacity-90",
                                    (
                                        dictionary.loading
                                        || !dictionary.result
                                        || dictionary.canSaveToVocabulary === false
                                    ) && "cursor-not-allowed opacity-60"
                                )}
                            >
                                {dictionary.saved ? <Check className="h-3.5 w-3.5" /> : null}
                                {dictionary.saved ? "Saved" : "Save to Vocabulary"}
                            </button>
                        </div>

                        {dictionary.canSaveToVocabulary === false && (
                            <div className="border-t border-[var(--color-border)] px-1 pt-2 text-xs text-[color:var(--color-text-muted)]">
                                {dictionary.saveDisabledMessage || "Enable Vocabulary Builder in Settings to save terms."}
                            </div>
                        )}
                    </>
                ) : showDeleteConfirm ? (
                    <div className="px-1 py-2">
                        <p className="text-xs text-[color:var(--color-text-secondary)] text-center mb-2">
                            Delete this highlight and any associated notes?
                        </p>
                        <div className="flex gap-1.5">
                            <button
                                onClick={handleDeleteCancelled}
                                className={cn(
                                    "flex-1 px-2 py-1.5 text-[var(--font-size-2xs)] font-medium",
                                    
                                    "bg-[var(--color-surface-variant)]",
                                    "text-[color:var(--color-text-secondary)]",
                                    "hover:bg-[var(--color-surface-muted)]",
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
                                        "w-7 h-7",
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
                        <div className="grid gap-1">
                            <button
                                onClick={() => {
                                    onAddNote();
                                    handleClose();
                                }}
                                className={cn(
                                    "flex-1 flex items-center justify-center gap-1.5",
                                    "px-2 py-1.5 text-[var(--font-size-2xs)] font-medium",
                                    
                                    "bg-[var(--color-surface-variant)]",
                                    "text-[color:var(--color-text-secondary)]",
                                    "hover:bg-[var(--color-surface-muted)]",
                                    "hover:text-[color:var(--color-text-primary)]",
                                    "transition-colors duration-150",
                                    "active:scale-95"
                                )}
                            >
                                <MessageSquare className="w-3 h-3" />
                                Add Note
                            </button>

                            <div className="grid grid-cols-1 gap-1">
                                <button
                                    onClick={() => {
                                        onDefine?.();
                                    }}
                                    className={cn(
                                        "flex items-center justify-center gap-1.5",
                                        "px-2 py-1.5 text-[var(--font-size-2xs)] font-medium",
                                        
                                        "bg-[var(--color-surface-variant)]",
                                        "text-[color:var(--color-text-secondary)]",
                                        "hover:bg-[var(--color-surface-muted)]",
                                        "hover:text-[color:var(--color-text-primary)]",
                                        "transition-colors duration-150",
                                        "active:scale-95",
                                        !onDefine && "opacity-50 cursor-not-allowed"
                                    )}
                                    disabled={!onDefine}
                                >
                                    <Languages className="w-3 h-3" />
                                    Define
                                </button>
                            </div>
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

    if (typeof document === "undefined") {
        return popupContent;
    }

    return createPortal(popupContent, document.body);
}

export default HighlightColorPicker;
