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
    coverDataUrl?: string | null;
}

/**
 * Convert blob to data URL
 */
function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Extract metadata and cover from a book file
 */
export async function extractMetadata(
    data: ArrayBuffer,
    format: BookFormat,
    filename: string,
    bookId?: string
): Promise<ExtractedMetadata> {
    const result: ExtractedMetadata = {
        title: "",
        author: "",
    };

    console.log(`[CoverExtractor] Extracting metadata for ${format} file:`, filename);

    // Import foliate-js makeBook for EPUB and other formats
    try {
        const { makeBook } = await import("../foliate-js/view.js");
        const file = new File([data], filename, { 
            type: format === "epub" ? "application/epub+zip" : 
                  format === "mobi" ? "application/x-mobipocket-ebook" :
                  format === "fb2" ? "application/fb2+xml" :
                  "application/octet-stream"
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book: any = await makeBook(file);

        // Extract metadata
        if (book.metadata) {
            result.title = book.metadata.title || filename.replace(/\.[^/.]+$/, "");
            result.author = book.metadata.author || "";
            result.description = book.metadata.description;
            result.publisher = book.metadata.publisher;
            result.language = book.metadata.language;
            result.publishedDate = book.metadata.publishedDate;
            result.identifier = book.metadata.identifier;
        }

        // Extract cover
        if (book.getCover) {
            try {
                const coverBlob = await book.getCover();
                if (coverBlob) {
                    if (bookId) {
                        result.coverDataUrl = await saveCoverImage(bookId, coverBlob);
                    } else {
                        result.coverDataUrl = await blobToDataUrl(coverBlob);
                    }
                }
            } catch (coverError) {
                console.warn("[CoverExtractor] Failed to extract cover:", coverError);
            }
        }

        console.log("[CoverExtractor] Metadata extracted:", {
            title: result.title,
            author: result.author,
            hasCover: !!result.coverDataUrl,
        });

        return result;
    } catch (error) {
        console.warn("[CoverExtractor] Failed to extract metadata:", error);
        result.title = filename.replace(/\.[^/.]+$/, "");
        return result;
    }
}

/**
 * Extract cover only from a book file (for batch processing)
 */
export async function extractCover(
    data: ArrayBuffer,
    format: BookFormat,
    filename: string,
    bookId: string
): Promise<string | null> {
    console.log(`[CoverExtractor] Extracting cover for ${format}:`, filename);

    // Use full metadata extraction
    const metadata = await extractMetadata(data, format, filename, bookId);
    return metadata.coverDataUrl || null;
}
