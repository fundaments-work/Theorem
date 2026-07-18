import type { Annotation } from "../types";
import type { Book } from "../types";

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

export function shareOnX(text: string): Window | null {
    const url = new URL("https://x.com/intent/tweet");
    url.searchParams.set("text", text);
    return window.open(url.toString(), "_blank", "noopener,noreferrer");
}

export async function captureCardAsImage(element: HTMLElement): Promise<Blob> {
    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(element, {
        quality: 0.95,
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#fafaf9',
    });
    const res = await fetch(dataUrl);
    return res.blob();
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function downloadImage(blob: Blob, filename: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
        const { isTauri, isTauriMobile } = await import("./env");

        if (isTauri()) {
            
            if (isTauriMobile()) {
                const { invoke } = await import("@tauri-apps/api/core");
                const base64Data = await blobToBase64(blob);
                await invoke("save_share_image_mobile", { filename, base64Data });
                return { ok: true };
            }

            const { writeFile, BaseDirectory, mkdir } = await import("@tauri-apps/plugin-fs");
            try { await mkdir("Theorem", { baseDir: BaseDirectory.Download, recursive: true }); } catch {  }
            const bytes = new Uint8Array(await blob.arrayBuffer());
            await writeFile(`Theorem/${filename}`, bytes, { baseDir: BaseDirectory.Download });
            return { ok: true };
        }
    } catch (e) {
        return { ok: false, reason: String(e) };
    }

    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);
        return { ok: true };
    } catch {
        return { ok: false, reason: "Download failed" };
    }
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
