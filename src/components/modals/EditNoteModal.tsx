import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Modal, ModalBody, ModalFooter } from "@/components/ui/Modal";

interface EditNoteModalProps {
    isOpen: boolean;
    content: string;
    onClose: () => void;
    onSave: (content: string) => void;
}

export function EditNoteModal({ isOpen, content, onClose, onSave }: EditNoteModalProps) {
    const [editContent, setEditContent] = useState(content);

    // Reset content when modal opens with new content
    useEffect(() => {
        if (isOpen) {
            setEditContent(content);
        }
    }, [isOpen, content]);

    const handleSave = () => {
        onSave(editContent);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
        }
        if (e.key === "Escape") {
            onClose();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg" showCloseButton={true}>
            <ModalBody>
                <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
                    Edit Note
                </h3>
                <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={cn(
                        "w-full h-40 p-3 rounded-lg resize-none",
                        "bg-[var(--color-background)] border border-[var(--color-border)]",
                        "text-sm text-[var(--color-text-primary)]",
                        "focus:outline-none focus:border-[var(--color-accent)]"
                    )}
                    placeholder="Add your note..."
                    autoFocus
                />
            </ModalBody>
            <ModalFooter>
                <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-subtle)] transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSave}
                    className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium",
                        "bg-[var(--color-accent)] text-white",
                        "hover:opacity-90 transition-opacity"
                    )}
                >
                    Save
                </button>
            </ModalFooter>
        </Modal>
    );
}
