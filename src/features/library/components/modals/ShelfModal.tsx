import { useState, useEffect } from "react";
import {
    cn,
    UI_BUTTON_GHOST_CLASS,
    UI_BUTTON_PRIMARY_CLASS,
    UI_INPUT_BASE_CLASS,
} from "@theorem/core";
import { Modal, ModalBody, ModalFooter } from "@theorem/ui";

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
                            <label className="block text-sm font-medium text-[color:var(--color-text-primary)] mb-1.5">
                                Name
                            </label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="e.g., To Read, Favorites, Sci-Fi"
                                className={UI_INPUT_BASE_CLASS}
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[color:var(--color-text-primary)] mb-1.5">
                                Description <span className="text-[color:var(--color-text-muted)] font-normal">(optional)</span>
                            </label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Add a description for this shelf..."
                                className={cn(
                                    UI_INPUT_BASE_CLASS,
                                    "resize-none min-h-[calc(var(--control-height-md)_*_2.1)]"
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
                        className={UI_BUTTON_GHOST_CLASS}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!name.trim()}
                        className={cn(
                            UI_BUTTON_PRIMARY_CLASS,
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
