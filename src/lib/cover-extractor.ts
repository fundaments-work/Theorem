/**
 * Cover & Metadata Extraction Utility
 * Extracts book cover images and metadata using foliate-js
 */

import type { BookFormat } from "@/types";
import { saveCoverImage } from "./storage";

/**
 * Extracted metadata from a book file
 */
export interface ExtractedMetadata {
    title: string;
    author: string;
    description?: string;
    publisher?: string;
    language?: string;
    publishedDate?: string;
    identifier?: string;
    coverDataUrl?: string;
}

/**
 * Format a language map (foliate-js returns objects for multi-language titles)
 */
function formatLanguageMap(x: unknown): string {
    if (!x) return "";
    if (typeof x === "string") return x;
    if (Array.isArray(x)) {
        // Handle array of authors/creators
        return x
            .map((item) => {
                if (typeof item === "string") return item;
                if (typeof item === "object" && item !== null) {
                    // Handle author objects with name property
                    const obj = item as Record<string, unknown>;
                    return obj.name || obj.value || Object.values(obj)[0] || "";
                }
                return "";
            })
            .filter(Boolean)
            .join(", ");
    }
    if (typeof x === "object" && x !== null) {
        const keys = Object.keys(x);
        return (x as Record<string, string>)[keys[0]] || "";
    }
    return String(x);
}

/**
 * Extract cover and metadata from a book file
 * Uses foliate-js to open the book and extract information
 * 
 * @param data - Book file as ArrayBuffer
 * @param filename - Original filename (used to detect format)
 * @param bookId - Book ID for saving cover to storage
 * @returns Extracted metadata including cover data URL
 */
export async function extractBookMetadata(
    data: ArrayBuffer,
    filename: string,
    bookId?: string
): Promise<ExtractedMetadata> {
    const result: ExtractedMetadata = {
        title: "",
        author: "",
    };

    try {
        // Import foliate-js makeBook
        const { makeBook } = await import("../foliate-js/view.js");

        // Create a File object from the ArrayBuffer
        const ext = filename.toLowerCase().split(".").pop() || "epub";
        const mimeType = getMimeType(ext);
        const file = new File([data], filename, { type: mimeType });

        // Open the book with foliate-js
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book: any = await makeBook(file);

        // Extract metadata
        if (book.metadata) {
            const meta = book.metadata;
            result.title = formatLanguageMap(meta.title) || "";
            result.author = formatLanguageMap(meta.author || meta.creator) || "";
            result.description = formatLanguageMap(meta.description) || undefined;
            result.publisher = formatLanguageMap(meta.publisher) || undefined;
            result.language = formatLanguageMap(meta.language) || undefined;
            result.publishedDate = formatLanguageMap(meta.published || meta.date) || undefined;
            result.identifier = formatLanguageMap(meta.identifier) || undefined;
        }

        // Extract cover image
        if (typeof book.getCover === "function") {
            try {
                const coverBlob = await book.getCover();
                if (coverBlob && coverBlob.size > 0) {
                    console.log("[CoverExtractor] Cover blob extracted, size:", coverBlob.size);

                    // If we have a bookId, save to storage and return the data URL
                    if (bookId) {
                        result.coverDataUrl = await saveCoverImage(bookId, coverBlob);
                    } else {
                        // Just convert to data URL without saving
                        result.coverDataUrl = await blobToDataUrl(coverBlob);
                    }
                }
            } catch (coverError) {
                console.warn("[CoverExtractor] Failed to extract cover:", coverError);
            }
        }

        // Clean up
        if (typeof book.destroy === "function") {
            book.destroy();
        }

        console.log("[CoverExtractor] Extracted metadata:", {
            title: result.title,
            author: result.author,
            hasCover: !!result.coverDataUrl,
        });

        return result;
    } catch (error) {
        console.error("[CoverExtractor] Failed to extract metadata:", error);
        return result;
    }
}

/**
 * Extract cover only (faster, for updating existing books)
 * 
 * @param data - Book file as ArrayBuffer
 * @param filename - Original filename
 * @param bookId - Book ID for saving cover
 * @returns Cover data URL or null
 */
export async function extractCoverOnly(
    data: ArrayBuffer,
    filename: string,
    bookId: string
): Promise<string | null> {
    try {
        const { makeBook } = await import("../foliate-js/view.js");

        const ext = filename.toLowerCase().split(".").pop() || "epub";
        const mimeType = getMimeType(ext);
        const file = new File([data], filename, { type: mimeType });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book: any = await makeBook(file);

        let coverDataUrl: string | null = null;

        if (typeof book.getCover === "function") {
            const coverBlob = await book.getCover();
            if (coverBlob && coverBlob.size > 0) {
                coverDataUrl = await saveCoverImage(bookId, coverBlob);
            }
        }

        if (typeof book.destroy === "function") {
            book.destroy();
        }

        return coverDataUrl;
    } catch (error) {
        console.error("[CoverExtractor] Failed to extract cover:", error);
        return null;
    }
}

/**
 * Get MIME type from file extension
 */
function getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
        epub: "application/epub+zip",
        pdf: "application/pdf",
        mobi: "application/x-mobipocket-ebook",
        azw: "application/vnd.amazon.ebook",
        azw3: "application/vnd.amazon.ebook",
        fb2: "application/x-fictionbook+xml",
        cbz: "application/vnd.comicbook+zip",
        cbr: "application/vnd.comicbook-rar",
    };
    return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Convert Blob to data URL
 */
async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Get book format from filename
 */
export function getFormatFromFilename(filename: string): BookFormat | null {
    const ext = filename.toLowerCase().split(".").pop();
    switch (ext) {
        case "epub":
            return "epub";
        case "pdf":
            return "pdf";
        case "mobi":
        case "azw":
        case "azw3":
            return "mobi";
        case "fb2":
            return "fb2";
        case "cbz":
        case "cbr":
            return "cbz";
        default:
            return null;
    }
}
