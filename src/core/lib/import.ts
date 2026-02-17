/**
 * Book Import Utilities
 * Cross-platform file import with metadata extraction
 * Works in both Tauri and browser environments
 */

import type { Book, BookFormat } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { isTauri } from './env';
import { saveBookData, getBookData } from './storage';
import { formatFileSize } from './utils';

type ExtractMetadataFn = typeof import('./cover-extractor')['extractMetadata'];

// Dynamically import Tauri plugins
let tauriDialog: typeof import('@tauri-apps/plugin-dialog') | null = null;
let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null;
let extractMetadataFnPromise: Promise<ExtractMetadataFn> | null = null;

const IMPORT_CONCURRENCY = 3;

function arrayBufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let index = 0; index < bytes.length; index += 1) {
        hex += bytes[index].toString(16).padStart(2, '0');
    }
    return hex;
}

async function computeContentHash(buffer: ArrayBuffer): Promise<string | undefined> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        return undefined;
    }

    try {
        const digest = await subtle.digest('SHA-256', buffer);
        return arrayBufferToHex(digest);
    } catch (error) {
        console.warn('[Import] Failed to compute content hash:', error);
        return undefined;
    }
}

async function getExtractMetadataFn(): Promise<ExtractMetadataFn> {
    if (!extractMetadataFnPromise) {
        extractMetadataFnPromise = import('./cover-extractor').then(
            (module) => module.extractMetadata,
        );
    }

    return extractMetadataFnPromise;
}

async function runWithConcurrency<TInput, TOutput>(
    items: TInput[],
    concurrency: number,
    worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
    if (items.length === 0) {
        return [];
    }

    const results: TOutput[] = new Array(items.length);
    let nextIndex = 0;

    const runWorker = async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    };

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    const workers = Array.from({ length: workerCount }, () => runWorker());
    await Promise.all(workers);
    return results;
}

async function initTauriPlugins() {
    if (!isTauri()) {
        return null; // Return null instead of throwing - caller will handle browser mode
    }

    if (!tauriDialog) {
        tauriDialog = await import('@tauri-apps/plugin-dialog');
    }
    if (!tauriFs) {
        tauriFs = await import('@tauri-apps/plugin-fs');
    }
    return { dialog: tauriDialog, fs: tauriFs };
}

/**
 * Determine book format from file extension
 * Supports: EPUB, MOBI/AZW, FB2, CBZ, PDF
 * Note: CBR is recognized for graceful rejection, but not currently importable.
 */
export function getBookFormat(filePath: string): BookFormat | null {
    const lowerPath = filePath.toLowerCase();

    // Multi-part extensions must be checked before single-part matches.
    if (lowerPath.endsWith('.fb2.zip')) return 'fb2';

    if (lowerPath.endsWith('.epub')) return 'epub';
    if (lowerPath.endsWith('.mobi')) return 'mobi';
    if (lowerPath.endsWith('.azw3')) return 'azw3';
    if (lowerPath.endsWith('.azw')) return 'azw';
    if (lowerPath.endsWith('.fb2')) return 'fb2';
    if (lowerPath.endsWith('.fbz')) return 'fb2';
    if (lowerPath.endsWith('.cbz')) return 'cbz';
    if (lowerPath.endsWith('.cbr')) return 'cbr';
    if (lowerPath.endsWith('.pdf')) return 'pdf';

    return null;
}

/**
 * Returns true when the format can be imported and rendered in this build.
 */
export function isImportFormatSupported(format: BookFormat): boolean {
    return format !== 'cbr';
}

/**
 * Open file picker dialog and return selected file paths (Tauri only)
 */
export async function pickBookFiles(): Promise<string[]> {
    const plugins = await initTauriPlugins();
    if (!plugins?.dialog) throw new Error('Dialog plugin not available');

    const selected = await plugins.dialog.open({
        multiple: true,
        filters: [
            { name: 'All eBooks', extensions: ['epub', 'mobi', 'azw', 'azw3', 'fb2', 'fbz', 'fb2.zip', 'cbz', 'pdf'] },
            { name: 'EPUB', extensions: ['epub'] },
            { name: 'Kindle (MOBI/AZW)', extensions: ['mobi', 'azw', 'azw3'] },
            { name: 'FictionBook (FB2)', extensions: ['fb2', 'fbz', 'fb2.zip'] },
            { name: 'Comics (CBZ)', extensions: ['cbz'] },
            { name: 'PDF', extensions: ['pdf'] },
        ],
    });

    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
}

/**
 * Browser file picker using HTML5 File Input API
 * Returns array of File objects
 */
export function pickBookFilesBrowser(): Promise<File[]> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.epub,.mobi,.azw,.azw3,.fb2,.fbz,.fb2.zip,.cbz,.pdf';
        
        input.onchange = () => {
            const files = input.files ? Array.from(input.files) : [];
            resolve(files);
        };
        
        // Handle cancel - resolve with empty array
        input.oncancel = () => resolve([]);
        
        // Trigger file picker
        input.click();
    });
}

/**
 * Create book entry from a browser File object
 * Used for browser-based file imports
 */
export async function createBookEntryFromFile(file: File): Promise<Book | null> {
    const format = getBookFormat(file.name);
    if (!format) {
        console.error('Unsupported file format:', file.name);
        return null;
    }
    if (!isImportFormatSupported(format)) {
        console.error('[Import] CBR archives are not supported in this build:', file.name);
        return null;
    }

    // Read file as ArrayBuffer
    const buffer = await file.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
        console.error('Empty file or failed to read:', file.name);
        return null;
    }
    const contentHash = await computeContentHash(buffer);

    const id = uuidv4();
    const fileSize = file.size;

    // Check file size - warn if very large (> 100MB)
    if (fileSize > 100 * 1024 * 1024) {
        console.warn('Large file detected:', file.name, formatFileSize(fileSize));
    }

    // Save to IndexedDB storage
    const storagePath = await saveBookData(id, buffer);

    // Get filename for fallback metadata
    const filename = file.name;
    const filenameMetadata = extractFilenameMetadata(filename);

    // Extract metadata and cover from the book file
    let metadata;
    let coverExtractionDone = false;
    try {
        const extractMetadata = await getExtractMetadataFn();
        metadata = await extractMetadata(buffer, format, filename, id);
        coverExtractionDone = true;
    } catch (error) {
        console.warn('[Import] Metadata extraction failed, using filename:', error);
        metadata = null;
    }

    // Build book object with extracted metadata (with filename fallbacks)
    // Note: Only use filename for title fallback, not for author (avoid showing filename as author)
    const book: Book = {
        id,
        title: metadata?.title || filenameMetadata.title,
        author: metadata?.author || "",
        filePath: `browser://${filename}`, // Virtual path for browser-imported files
        storagePath,
        format,
        contentHash,
        fileSize,
        addedAt: new Date(),
        progress: 0,
        isFavorite: false,
        tags: [],
        readingTime: 0,
        coverExtractionDone,
        // Additional metadata from extraction
        coverPath: metadata?.coverDataUrl || undefined,
        description: metadata?.description,
        publisher: metadata?.publisher,
        publishedDate: metadata?.publishedDate,
        language: metadata?.language,
    };

    return book;
}

/**
 * Import books from browser File objects
 */
export async function importBooksFromFiles(files: File[]): Promise<Book[]> {
    const imported = await runWithConcurrency(
        files,
        IMPORT_CONCURRENCY,
        async (file): Promise<Book | null> => {
            try {
                return await createBookEntryFromFile(file);
            } catch (error) {
                console.error('Failed to import book:', file.name, error);
                return null;
            }
        },
    );

    return imported.filter((book): book is Book => book !== null);
}

/**
 * Read a book file from storage
 * Uses the storage abstraction to handle both Tauri paths and IndexedDB
 */
export async function readBookFile(filePath: string, bookId?: string): Promise<ArrayBuffer> {
    try {
        // Use getBookData which properly handles both Tauri paths and IndexedDB URLs
        const data = await getBookData(bookId || '', filePath);
        if (!data) {
            throw new Error('Could not read book file from storage - data not found');
        }
        return data;
    } catch (error) {
        console.error('[Import] Error reading file:', filePath, error);
        throw new Error(`Failed to read book file: ${error}`);
    }
}

/**
 * Extract basic metadata from filename
 */
export function extractFilenameMetadata(filePath: string): { title: string; author: string } {
    const filename = filePath.split(/[/\\]/).pop() || 'Unknown';
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
    
    // Try to parse "Author - Title" format
    const parts = nameWithoutExt.split(/\s*[-–—]\s*/);
    if (parts.length >= 2) {
        return {
            author: parts[0].trim(),
            title: parts.slice(1).join(' - ').trim(),
        };
    }
    
    return {
        title: nameWithoutExt,
        author: 'Unknown Author',
    };
}

/**
 * Create a book entry from a file path (Tauri only)
 * Extracts metadata and cover image using foliate-js
 */
export async function createBookEntry(filePath: string): Promise<Book | null> {
    const format = getBookFormat(filePath);
    if (!format) {
        console.error('Unsupported file format:', filePath);
        return null;
    }
    if (!isImportFormatSupported(format)) {
        console.error('[Import] CBR archives are not supported in this build:', filePath);
        return null;
    }

    const plugins = await initTauriPlugins();
    if (!plugins?.fs) throw new Error('FS plugin not available - this function requires Tauri');
    const fs = plugins.fs;

    // Get file stats
    let fileSize = 0;
    try {
        const stats = await fs.stat(filePath);
        fileSize = Number(stats.size);
    } catch {
        // Stats not available, continue without size
    }

    // Check file size - warn if very large (> 100MB)
    if (fileSize > 100 * 1024 * 1024) {
        console.warn('Large file detected:', filePath, formatFileSize(fileSize));
    }

    // Read file content for storage
    const buffer = await readBookFile(filePath);
    if (!buffer || buffer.byteLength === 0) {
        console.error('Empty file or failed to read:', filePath);
        return null;
    }
    const contentHash = await computeContentHash(buffer);

    const id = uuidv4();

    // Save to app storage first
    const storagePath = await saveBookData(id, buffer);

    // Get filename for fallback metadata
    const filename = filePath.split(/[/\\]/).pop() || 'Unknown.epub';
    const filenameMetadata = extractFilenameMetadata(filePath);

    // Extract metadata and cover from the book file
    let metadata;
    let coverExtractionDone = false;
    try {
        const extractMetadata = await getExtractMetadataFn();
        metadata = await extractMetadata(buffer, format, filename, id);
        coverExtractionDone = true;
    } catch (error) {
        console.warn('[Import] Metadata extraction failed, using filename:', error);
        metadata = null;
    }

    // Build book object with extracted metadata (with filename fallbacks)
    // Note: Only use filename for title fallback, not for author (avoid showing filename as author)
    const book: Book = {
        id,
        title: metadata?.title || filenameMetadata.title,
        author: metadata?.author || "",
        filePath,
        storagePath,
        format,
        contentHash,
        fileSize,
        addedAt: new Date(),
        progress: 0,
        isFavorite: false,
        tags: [],
        readingTime: 0,
        coverExtractionDone,
        // Additional metadata from extraction
        coverPath: metadata?.coverDataUrl || undefined,
        description: metadata?.description,
        publisher: metadata?.publisher,
        publishedDate: metadata?.publishedDate,
        language: metadata?.language,
    };

    return book;
}

/**
 * Import multiple books with error handling
 */
export async function importBooks(filePaths: string[]): Promise<Book[]> {
    const imported = await runWithConcurrency(
        filePaths,
        IMPORT_CONCURRENCY,
        async (filePath): Promise<Book | null> => {
            try {
                return await createBookEntry(filePath);
            } catch (error) {
                console.error('Failed to import book:', filePath, error);
                return null;
            }
        },
    );

    return imported.filter((book): book is Book => book !== null);
}

/**
 * Show file picker and import selected books
 * Works in both Tauri and browser environments
 */
export async function pickAndImportBooks(): Promise<Book[]> {
    if (isTauri()) {
        // Tauri: use native file picker
        const filePaths = await pickBookFiles();
        if (filePaths.length === 0) {
            return [];
        }
        return importBooks(filePaths);
    } else {
        // Browser: use HTML5 file picker
        const files = await pickBookFilesBrowser();
        if (files.length === 0) {
            return [];
        }
        return importBooksFromFiles(files);
    }
}

/**
 * Scan a folder for books (Tauri only)
 */
export async function scanFolderForBooks(folderPath: string): Promise<string[]> {
    const plugins = await initTauriPlugins();
    if (!plugins?.fs) throw new Error('FS plugin not available - folder scanning requires Tauri');
    const fs = plugins.fs;

    const bookFiles: string[] = [];

    async function scanDir(dir: string) {
        try {
            const entries = await fs.readDir(dir);
            
            for (const entry of entries) {
                const fullPath = `${dir}/${entry.name}`;
                
                if (entry.isDirectory) {
                    await scanDir(fullPath);
                } else if (entry.isFile) {
                    const lowerName = entry.name.toLowerCase();
                    const isSupportedBook =
                        lowerName.endsWith('.epub')
                        || lowerName.endsWith('.mobi')
                        || lowerName.endsWith('.azw')
                        || lowerName.endsWith('.azw3')
                        || lowerName.endsWith('.fb2')
                        || lowerName.endsWith('.fbz')
                        || lowerName.endsWith('.fb2.zip')
                        || lowerName.endsWith('.cbz')
                        || lowerName.endsWith('.pdf');

                    if (isSupportedBook) {
                        bookFiles.push(fullPath);
                    }
                }
            }
        } catch (error) {
            console.error('Error scanning directory:', dir, error);
        }
    }

    await scanDir(folderPath);
    return bookFiles;
}
