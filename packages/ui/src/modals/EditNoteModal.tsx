import { useState, useEffect } from "react";
import {
    cn,
    UI_BUTTON_GHOST_CLASS,
    UI_BUTTON_PRIMARY_CLASS,
    UI_INPUT_BASE_CLASS,
} from "@theorem/core";
import { Modal, ModalBody, ModalFooter } from "../Modal";

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
                <h3 className="text-lg font-semibold text-[color:var(--color-text-primary)] mb-4">
                    Edit Note
                </h3>
                <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={cn(
                        UI_INPUT_BASE_CLASS,
                        "h-40 p-3 resize-none"
                    )}
                    placeholder="Add your note..."
                    autoFocus
                />
            </ModalBody>
            <ModalFooter>
                <button
                    onClick={onClose}
                    className={UI_BUTTON_GHOST_CLASS}
                >
                    Cancel
                </button>
                <button
                    onClick={handleSave}
                    className={UI_BUTTON_PRIMARY_CLASS}
                >
                    Save
                </button>
            </ModalFooter>
        </Modal>
    );
}
