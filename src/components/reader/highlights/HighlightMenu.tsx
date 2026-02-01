/**
 * HighlightMenu Component
 * Context menu for interacting with existing highlights
 * Shown when user clicks on a highlighted text
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Trash2, Share2, Copy, X, Bookmark } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Annotation, HighlightColor } from '@/types';

interface HighlightMenuProps {
    isOpen: boolean;
    position: { x: number; y: number };
    annotation: Annotation | null;
    onEditNote: () => void;
    onDelete: () => void;
    onCopyText: () => void;
    onClose: () => void;
}

const HIGHLIGHT_COLORS: Record<HighlightColor, { bg: string; label: string }> = {
    yellow: { bg: 'bg-yellow-400', label: 'Yellow' },
    green: { bg: 'bg-green-500', label: 'Green' },
    blue: { bg: 'bg-blue-500', label: 'Blue' },
    red: { bg: 'bg-red-500', label: 'Red' },
    orange: { bg: 'bg-orange-500', label: 'Orange' },
    purple: { bg: 'bg-purple-500', label: 'Purple' },
};

export function HighlightMenu({
    isOpen,
    position,
    annotation,
    onEditNote,
    onDelete,
    onCopyText,
    onClose,
}: HighlightMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [adjustedPosition, setAdjustedPosition] = useState(position);

    // Adjust position to keep menu on screen
    useEffect(() => {
        if (!isOpen) return;

        const menu = menuRef.current;
        if (!menu) return;

        const rect = menu.getBoundingClientRect();
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

        // Adjust vertical position
        if (y + rect.height > viewportHeight) {
            y = y - rect.height - 10;
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
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
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

    const handleDelete = useCallback(() => {
        if (confirm('Delete this highlight?')) {
            onDelete();
        }
    }, [onDelete]);

    if (!isOpen || !annotation) return null;

    const colorInfo = annotation.color ? HIGHLIGHT_COLORS[annotation.color] : null;

    return (
        <div
            ref={menuRef}
            className={cn(
                "fixed z-[100] animate-fade-in",
                "bg-[var(--color-surface)]",
                "border border-[var(--color-border)]",
                "rounded-lg shadow-lg",
                "min-w-[220px] overflow-hidden"
            )}
            style={{
                left: adjustedPosition.x,
                top: adjustedPosition.y,
            }}
        >
            {/* Header with color indicator */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                    {colorInfo && (
                        <div className={cn("w-3 h-3 rounded-full", colorInfo.bg)} />
                    )}
                    <span className="text-xs font-medium text-[var(--color-text-secondary)]">
                        {annotation.type === 'bookmark' ? 'Bookmark' : 'Highlight'}
                    </span>
                </div>
                <button
                    onClick={onClose}
                    className={cn(
                        "p-1 rounded-md",
                        "text-[var(--color-text-muted)]",
                        "hover:bg-[var(--color-surface-hover)]",
                        "transition-colors"
                    )}
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Selected text preview */}
            {annotation.selectedText && (
                <div className="px-3 py-2 bg-[var(--color-surface-variant)]">
                    <p className="text-xs text-[var(--color-text-secondary)] line-clamp-3">
                        &ldquo;{annotation.selectedText}&rdquo;
                    </p>
                </div>
            )}

            {/* Note content if exists */}
            {annotation.noteContent && (
                <div className="px-3 py-2 border-b border-[var(--color-border)]">
                    <p className="text-xs text-[var(--color-text-primary)] whitespace-pre-wrap">
                        {annotation.noteContent}
                    </p>
                </div>
            )}

            {/* Menu actions */}
            <div className="p-1">
                {!annotation.noteContent && (
                    <button
                        onClick={onEditNote}
                        className={cn(
                            "w-full flex items-center gap-2",
                            "px-3 py-2 text-sm",
                            "rounded-md",
                            "text-[var(--color-text-primary)]",
                            "hover:bg-[var(--color-surface-hover)]",
                            "transition-colors"
                        )}
                    >
                        <MessageSquare className="w-4 h-4 text-[var(--color-text-muted)]" />
                        Add Note
                    </button>
                )}
                
                {annotation.noteContent && (
                    <button
                        onClick={onEditNote}
                        className={cn(
                            "w-full flex items-center gap-2",
                            "px-3 py-2 text-sm",
                            "rounded-md",
                            "text-[var(--color-text-primary)]",
                            "hover:bg-[var(--color-surface-hover)]",
                            "transition-colors"
                        )}
                    >
                        <MessageSquare className="w-4 h-4 text-[var(--color-text-muted)]" />
                        Edit Note
                    </button>
                )}

                <button
                    onClick={onCopyText}
                    className={cn(
                        "w-full flex items-center gap-2",
                        "px-3 py-2 text-sm",
                        "rounded-md",
                        "text-[var(--color-text-primary)]",
                        "hover:bg-[var(--color-surface-hover)]",
                        "transition-colors"
                    )}
                >
                    <Copy className="w-4 h-4 text-[var(--var(--color-text-muted)]" />
                    Copy Text
                </button>

                <div className="my-1 border-t border-[var(--color-border)]" />

                <button
                    onClick={handleDelete}
                    className={cn(
                        "w-full flex items-center gap-2",
                        "px-3 py-2 text-sm",
                        "rounded-md",
                        "text-red-500",
                        "hover:bg-red-500/10",
                        "transition-colors"
                    )}
                >
                    <Trash2 className="w-4 h-4" />
                    Delete
                </button>
            </div>
        </div>
    );
}

export default HighlightMenu;
