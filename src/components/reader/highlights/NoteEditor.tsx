/**
 * NoteEditor Component
 * Simple popover for adding/editing notes on highlights
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NoteEditorProps {
    isOpen: boolean;
    position: { x: number; y: number };
    initialNote: string;
    selectedText: string;
    onSave: (note: string) => void;
    onClose: () => void;
}

export function NoteEditor({
    isOpen,
    position,
    initialNote,
    selectedText,
    onSave,
    onClose,
}: NoteEditorProps) {
    const [note, setNote] = useState(initialNote);
    const [adjustedPosition, setAdjustedPosition] = useState(position);
    const editorRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Adjust position to keep editor on screen
    useEffect(() => {
        if (!isOpen) return;

        const editor = editorRef.current;
        if (!editor) return;

        const rect = editor.getBoundingClientRect();
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
            y = y - rect.height - 40;
        }
        if (y < 16) {
            y = 16;
        }

        setAdjustedPosition({ x, y });
    }, [isOpen, position]);

    // Focus textarea when opened
    useEffect(() => {
        if (isOpen && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(note.length, note.length);
        }
    }, [isOpen]);

    // Handle click outside - use capture phase for iframe compatibility
    useEffect(() => {
        if (!isOpen) return;

        const handleClickOutside = (e: MouseEvent) => {
            if (editorRef.current && !editorRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside, true);
        document.addEventListener('click', handleClickOutside, true);
        
        // Also close on scroll
        const handleScroll = () => onClose();
        window.addEventListener('scroll', handleScroll, true);
        
        return () => {
            document.removeEventListener('mousedown', handleClickOutside, true);
            document.removeEventListener('click', handleClickOutside, true);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [isOpen, onClose]);

    // Handle escape key
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                handleSave();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose, note]);

    const handleSave = useCallback(() => {
        onSave(note.trim());
    }, [note, onSave]);

    if (!isOpen) return null;

    return (
        <div
            ref={editorRef}
            className={cn(
                "fixed z-[100] animate-fade-in",
                "bg-[var(--color-surface)]",
                "border border-[var(--color-border)]",
                "rounded-lg shadow-lg",
                "p-4 w-[320px]"
            )}
            style={{
                left: adjustedPosition.x,
                top: adjustedPosition.y,
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    {initialNote ? 'Edit Note' : 'Add Note'}
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
                <div className="mb-3 px-2 py-1.5 bg-[var(--color-surface-variant)] rounded text-xs text-[var(--color-text-secondary)] line-clamp-2">
                    &ldquo;{selectedText.slice(0, 100)}{selectedText.length > 100 ? '...' : ''}&rdquo;
                </div>
            )}

            {/* Note textarea */}
            <textarea
                ref={textareaRef}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add your note..."
                className={cn(
                    "w-full min-h-[80px] max-h-[200px]",
                    "px-3 py-2 text-sm",
                    "bg-[var(--color-background)]",
                    "border border-[var(--color-border)]",
                    "rounded-md resize-y",
                    "text-[var(--color-text-primary)]",
                    "placeholder:text-[var(--color-text-muted)]",
                    "focus:outline-none focus:border-[var(--color-accent)]",
                    "transition-colors"
                )}
            />

            {/* Footer with save button */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--color-border)]">
                <span className="text-xs text-[var(--color-text-muted)]">
                    Ctrl+Enter to save
                </span>
                <button
                    onClick={handleSave}
                    className={cn(
                        "flex items-center gap-1.5",
                        "px-3 py-1.5 text-xs font-medium",
                        "rounded-md",
                        "bg-[var(--color-accent)]",
                        "text-[var(--color-surface)]",
                        "hover:opacity-90",
                        "transition-opacity"
                    )}
                >
                    <Save className="w-3.5 h-3.5" />
                    Save
                </button>
            </div>
        </div>
    );
}

export default NoteEditor;
