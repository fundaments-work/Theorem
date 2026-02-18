/**
 * Cover & Metadata Extraction Utility
 * Extracts book cover images and metadata using foliate-js and PDF.js.
 */

import type { BookFormat } from '../types';
import { saveCoverImage } from './storage';
import { getConfiguredPdfJs } from './pdfjs-runtime';
import { normalizeAuthor } from './utils';
import { isMobile } from './env';

const METADATA_TIMEOUT_MS = 10000;
const COVER_TIMEOUT_MS = 5000;

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`[CoverExtractor] Timeout while ${label} (${timeoutMs}ms)`));
        }, timeoutMs);

        promise
            .then((value) => {
                clearTimeout(timeoutId);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timeoutId);
                reject(error);
            });
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function getMimeType(format: BookFormat): string {
    switch (format) {
        case 'epub':
            return 'application/epub+zip';
        case 'pdf':
            return 'application/pdf';
        case 'mobi':
        case 'azw':
        case 'azw3':
            return 'application/x-mobipocket-ebook';
        case 'fb2':
            return 'application/x-fictionbook+xml';
        case 'cbz':
            return 'application/vnd.comicbook+zip';
        case 'cbr':
            return 'application/vnd.comicbook-rar';
        default:
            return 'application/octet-stream';
    }
}

function buildFallbackCoverSvg(title: string, author: string): string {
    const normalizedTitle = (title || 'Untitled').trim();
    const normalizedAuthor = (author || 'Unknown Author').trim();
    const initials = normalizedTitle
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
        .join('')
        .slice(0, 2) || 'BK';

    const escapedTitle = normalizedTitle
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .slice(0, 48);
    const escapedAuthor = normalizedAuthor
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .slice(0, 42);

    return `
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1300" viewBox="0 0 900 1300" role="img" aria-label="Book cover fallback">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#162334"/>
      <stop offset="100%" stop-color="#0f6e9f"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1300" fill="url(#bg)"/>
  <rect x="72" y="72" width="756" height="1156" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
  <circle cx="450" cy="380" r="160" fill="rgba(255,255,255,0.16)"/>
  <text x="450" y="420" text-anchor="middle" font-family="Georgia, serif" font-size="120" fill="#ffffff" font-weight="700">${initials}</text>
  <text x="450" y="710" text-anchor="middle" font-family="Georgia, serif" font-size="54" fill="#ffffff" font-weight="600">${escapedTitle}</text>
  <text x="450" y="770" text-anchor="middle" font-family="Georgia, serif" font-size="32" fill="rgba(255,255,255,0.82)">${escapedAuthor}</text>
</svg>`;
}

async function createAndPersistFallbackCover(
    title: string,
    author: string,
    bookId?: string,
): Promise<string | null> {
    const svg = buildFallbackCoverSvg(title, author);
    const blob = new Blob([svg], { type: 'image/svg+xml' });

    if (bookId) {
        try {
            return await saveCoverImage(bookId, blob);
        } catch (error) {
            console.warn('[CoverExtractor] Failed to persist fallback cover:', error);
        }
    }

    return blobToDataUrl(blob);
}

async function ensureCoverFallback(
    result: ExtractedMetadata,
    filename: string,
    bookId?: string,
): Promise<void> {
    if (result.coverDataUrl) {
        return;
    }

    const fallbackTitle = result.title || filename.replace(/\.[^/.]+$/, '');
    const fallbackAuthor = result.author || 'Unknown Author';
    result.coverDataUrl = await createAndPersistFallbackCover(fallbackTitle, fallbackAuthor, bookId);
}

export async function extractMetadata(
    data: ArrayBuffer,
    format: BookFormat,
    filename: string,
    bookId?: string,
): Promise<ExtractedMetadata> {
    const result: ExtractedMetadata = {
        title: '',
        author: '',
    };

    console.log(`[CoverExtractor] Extracting metadata for ${format} file:`, filename);

    if (format === 'pdf') {
        try {
            const pdfjsLib = await getConfiguredPdfJs();
            const loadingTask = pdfjsLib.getDocument({
                data: new Uint8Array(data),
                isEvalSupported: false,
            });

            const pdf = await withTimeout(loadingTask.promise, METADATA_TIMEOUT_MS, 'loading PDF metadata');

            const metadata = await withTimeout(pdf.getMetadata(), METADATA_TIMEOUT_MS, 'reading PDF metadata');
            const metaInfo = metadata.info as Record<string, unknown>;

            result.title = (metaInfo?.Title as string) || filename.replace(/\.[^/.]+$/, '');
            result.author = (metaInfo?.Author as string) || '';

            try {
                const page = await withTimeout(pdf.getPage(1), COVER_TIMEOUT_MS, 'opening PDF page for cover');
                const viewport = page.getViewport({ scale: isMobile() ? 0.3 : 0.5 });
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                if (ctx) {
                    const maxDimension = isMobile() ? 600 : 1000;
                    let scale = isMobile() ? 0.3 : 0.5;
                    if (viewport.width > maxDimension || viewport.height > maxDimension) {
                        const maxViewportDim = Math.max(viewport.width, viewport.height);
                        scale = (maxDimension / maxViewportDim) * scale;
                    }

                    const adjustedViewport = page.getViewport({ scale });
                    canvas.width = adjustedViewport.width;
                    canvas.height = adjustedViewport.height;

                    await withTimeout(
                        page.render({
                            canvasContext: ctx,
                            viewport: adjustedViewport,
                        }).promise,
                        COVER_TIMEOUT_MS,
                        'rendering PDF cover',
                    );

                    const blob = await new Promise<Blob | null>((resolve) => {
                        canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.8);
                    });

                    if (blob && bookId) {
                        result.coverDataUrl = await saveCoverImage(bookId, blob);
                    } else if (blob) {
                        result.coverDataUrl = await blobToDataUrl(blob);
                    }
                }

                page.cleanup();
            } catch (coverError) {
                console.warn('[CoverExtractor] PDF cover extraction failed:', coverError);
            }

            pdf.destroy();
            await ensureCoverFallback(result, filename, bookId);
            return result;
        } catch (pdfError) {
            console.warn('[CoverExtractor] Failed to extract PDF metadata:', pdfError);
            result.title = filename.replace(/\.[^/.]+$/, '');
            result.coverDataUrl = await createAndPersistFallbackCover(result.title, result.author || 'Unknown Author', bookId);
            return result;
        }
    }

    try {
        const { makeBook } = await import('../../features/reader/foliate-js/view.js');
        const mimeType = getMimeType(format);

        let bookInput: File | Blob;
        if (isMobile()) {
            bookInput = new Blob([data], { type: mimeType });
        } else {
            bookInput = new File([data], filename, { type: mimeType });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let book: any;

        try {
            book = await withTimeout(
                makeBook(bookInput),
                METADATA_TIMEOUT_MS,
                'opening book with foliate',
            );
        } catch (openError) {
            if (isMobile() && !(bookInput instanceof File)) {
                const fileFallback = new File([data], filename, { type: mimeType });
                book = await withTimeout(
                    makeBook(fileFallback),
                    METADATA_TIMEOUT_MS,
                    'opening book with File fallback',
                );
            } else {
                throw openError;
            }
        }

        if (book.metadata) {
            result.title = book.metadata.title || filename.replace(/\.[^/.]+$/, '');
            result.author = normalizeAuthor(book.metadata.author);
            result.description = book.metadata.description;
            result.publisher = book.metadata.publisher;
            result.language = book.metadata.language;
            result.publishedDate = book.metadata.publishedDate;
            result.identifier = book.metadata.identifier;
        }

        if (book.getCover) {
            try {
                const rawCoverBlob = await withTimeout(book.getCover(), COVER_TIMEOUT_MS, 'extracting cover');
                const coverBlob = rawCoverBlob instanceof Blob ? rawCoverBlob : null;
                if (coverBlob) {
                    if (bookId) {
                        result.coverDataUrl = await saveCoverImage(bookId, coverBlob);
                    } else {
                        result.coverDataUrl = await blobToDataUrl(coverBlob);
                    }
                }
            } catch (coverError) {
                console.warn('[CoverExtractor] Failed to extract cover:', coverError);
            }
        }

        if (book.destroy) {
            try {
                book.destroy();
            } catch {
                // no-op
            }
        }

        await ensureCoverFallback(result, filename, bookId);
        return result;
    } catch (error) {
        console.warn('[CoverExtractor] Failed to extract metadata:', error);
        result.title = filename.replace(/\.[^/.]+$/, '');
        result.coverDataUrl = await createAndPersistFallbackCover(result.title, result.author || 'Unknown Author', bookId);
        return result;
    }
}

export async function extractCover(
    data: ArrayBuffer,
    format: BookFormat,
    filename: string,
    bookId: string,
): Promise<string | null> {
    console.log(`[CoverExtractor] Extracting cover for ${format}:`, filename);
    const metadata = await extractMetadata(data, format, filename, bookId);
    return metadata.coverDataUrl || null;
}
