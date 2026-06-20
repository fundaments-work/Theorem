import type { Annotation } from "../types";
import type { Book } from "../types";
import { toPng } from "html-to-image";

export function buildShareText(
    annotation: Annotation,
    book: Pick<Book, "title" | "author"> | undefined,
): string {
    const parts: string[] = [];

    if (annotation.selectedText) {
        parts.push(`"${annotation.selectedText}"`);
    }

    if (book) {
        parts.push(`— ${book.title}${book.author ? ` by ${book.author}` : ""}`);
    }

    if (annotation.noteContent) {
        parts.push(`\n\nMy note: ${annotation.noteContent}`);
    }

    parts.push("\n\nShared via Theorem");

    return parts.join(" ");
}

export function shareOnX(text: string): void {
    const url = new URL("https://x.com/intent/tweet");
    url.searchParams.set("text", text);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
}

export async function captureCardAsImage(element: HTMLElement): Promise<Blob> {
    const dataUrl = await toPng(element, {
        quality: 0.95,
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#fafaf9',
    });
    const res = await fetch(dataUrl);
    return res.blob();
}

export function downloadImage(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export async function copyImageToClipboard(blob: Blob): Promise<void> {
    try {
        await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
        ]);
    } catch {
        throw new Error("Clipboard write failed");
    }
}

export async function shareImageNative(
    blob: Blob,
    title: string,
): Promise<void> {
    if (!navigator.share) {
        throw new Error("Web Share API not available");
    }
    const file = new File([blob], `${title}.png`, { type: "image/png" });
    await navigator.share({
        title,
        files: [file],
    });
}

export function buildImageFilename(bookTitle: string): string {
    const sanitized = bookTitle.replace(/[/\\?%*:|"<>]/g, "").trim();
    return `Highlight - ${sanitized || "Untitled"}.png`;
}
