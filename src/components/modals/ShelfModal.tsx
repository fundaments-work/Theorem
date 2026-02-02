import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Modal, ModalBody, ModalFooter } from "@/components/ui/Modal";

interface ShelfModalProps {
    isOpen: boolean;
    shelf?: {
        id: string;
        name: string;
        description?: string;
    };
    onClose: () => void;
    onSave: (name: string, description: string) => void;
}

export function ShelfModal({ isOpen, shelf, onClose, onSave }: ShelfModalProps) {
    const [name, setName] = useState(shelf?.name || "");
    const [description, setDescription] = useState(shelf?.description || "");
    const isEditing = !!shelf;

    // Reset form when modal opens/closes or shelf changes
    useEffect(() => {
        if (isOpen) {
            setName(shelf?.name || "");
            setDescription(shelf?.description || "");
        }
    }, [isOpen, shelf]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onSave(name.trim(), description.trim());
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (name.trim()) {
                onSave(name.trim(), description.trim());
            }
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="md" showCloseButton={true}>
            <form onSubmit={handleSubmit}>
                <ModalBody>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                                Name
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="e.g., To Read, Favorites, Sci-Fi"
                                className={cn(
                                    "w-full px-3 py-2.5 rounded-lg",
                                    "bg-[var(--color-background)] border border-[var(--color-border)]",
                                    "text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                                    "focus:outline-none focus:border-[var(--color-accent)]"
                                )}
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                                Description <span className="text-[var(--color-text-muted)] font-normal">(optional)</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Add a description for this shelf..."
                                className={cn(
                                    "w-full px-3 py-2.5 rounded-lg resize-none",
                                    "bg-[var(--color-background)] border border-[var(--color-border)]",
                                    "text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                                    "focus:outline-none focus:border-[var(--color-accent)]"
                                )}
                                rows={3}
                            />
                        </div>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded-lg text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-subtle)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className={cn(
                            "px-4 py-2 rounded-lg text-sm font-medium",
                            "bg-[var(--color-accent)] text-white",
                            "hover:opacity-90 transition-opacity",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    >
                        {isEditing ? "Save Changes" : "Create Shelf"}
                    </button>
                </ModalFooter>
            </form>
        </Modal>
    );
}
