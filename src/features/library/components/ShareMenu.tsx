import { useState, useCallback } from "react";
import type { Annotation, Book } from "../../../core";
import { shareOnX, buildShareText } from "../../../core";
import { ExternalLink, Image } from "lucide-react";
import { ShareStudioModal } from "./ShareStudioModal";

interface ShareMenuProps {
    annotation: Annotation;
    book: Pick<Book, "title" | "author"> | undefined;
    onClose: () => void;
}

export function ShareMenu({ annotation, book, onClose }: ShareMenuProps) {
    const [showStudio, setShowStudio] = useState(false);

    const handleShareOnX = useCallback(() => {
        const text = buildShareText(annotation, book);
        shareOnX(text);
        onClose();
    }, [annotation, book, onClose]);

    if (showStudio) {
        return (
            <ShareStudioModal
                annotation={annotation}
                book={book}
                onClose={onClose}
            />
        );
    }

    return (
        <>
            {/* Main share menu */}
            <div className="absolute right-0 top-full z-20 mt-1 w-48 border border-[var(--color-border)] bg-[var(--color-surface)] py-1">
                <button
                    onClick={() => setShowStudio(true)}
                    className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left font-sans text-[11px] font-medium text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
                >
                    <Image className="w-3.5 h-3.5" />
                    Share as Image
                </button>
                <button
                    onClick={handleShareOnX}
                    className="flex w-full items-center gap-2 whitespace-nowrap px-3 py-2 text-left font-sans text-[11px] font-medium text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Share on X
                </button>
            </div>
        </>
    );
}