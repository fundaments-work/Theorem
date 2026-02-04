/**
 * Book Import Utilities
 * Tauri-native file import with metadata extraction
 */

import type { Book, BookFormat } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { isTauri } from './env';
import { saveBookData, getBookData } from './storage';
import { formatFileSize } from './utils';
import { extractMetadata } from './cover-extractor';

// Dynamically import Tauri plugins
let tauriDialog: typeof import('@tauri-apps/plugin-dialog') | null = null;
let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null;

async function initTauriPlugins() {
    if (!isTauri()) {
        throw new Error('Tauri environment not detected');
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
 * Supports foliate-js formats: EPUB, MOBI/AZW, FB2, CBZ/CBR
 */
export function getBookFormat(filePath: string): BookFormat | null {
    const ext = filePath.toLowerCase().split('.').pop();
    switch (ext) {
        case 'epub': return 'epub';
        case 'mobi': return 'mobi';
        case 'azw': return 'azw';
        case 'azw3': return 'azw3';
        case 'fb2': return 'fb2';
        case 'fbz':
        case 'fb2.zip': return 'fb2';
        case 'cbz': return 'cbz';
        case 'cbr': return 'cbr';
        default: return null;
    }
}

/**
 * Open file picker dialog and return selected file paths
 */
export async function pickBookFiles(): Promise<string[]> {
    const { dialog } = await initTauriPlugins();
    if (!dialog) throw new Error('Dialog plugin not available');

    const selected = await dialog.open({
        multiple: true,
        filters: [
            { name: 'All eBooks', extensions: ['epub', 'mobi', 'azw', 'azw3', 'fb2', 'fbz', 'cbz', 'cbr'] },
            { name: 'EPUB', extensions: ['epub'] },
            { name: 'Kindle (MOBI/AZW)', extensions: ['mobi', 'azw', 'azw3'] },
            { name: 'FictionBook (FB2)', extensions: ['fb2', 'fbz'] },
            { name: 'Comics (CBZ/CBR)', extensions: ['cbz', 'cbr'] },
        ],
    });

    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
}

/**
 * Read a book file from storage
 * Uses the storage abstraction to handle both Tauri paths and IndexedDB
 */
export async function readBookFile(filePath: string, bookId?: string): Promise<ArrayBuffer> {
    try {
        console.log('[Import] Reading book file:', { filePath, bookId });
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
 * Create a book entry from a file path
 * Extracts metadata and cover image using foliate-js
 */
export async function createBookEntry(filePath: string): Promise<Book | null> {
    const format = getBookFormat(filePath);
    if (!format) {
        console.error('Unsupported file format:', filePath);
        return null;
    }

    const { fs } = await initTauriPlugins();
    if (!fs) throw new Error('FS plugin not available');

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

    const id = uuidv4();

    // Save to app storage first
    const storagePath = await saveBookData(id, buffer);

    // Get filename for fallback metadata
    const filename = filePath.split(/[/\\]/).pop() || 'Unknown.epub';
    const filenameMetadata = extractFilenameMetadata(filePath);

    // Extract metadata and cover from the book file
    console.log('[Import] Extracting metadata and cover for:', filename);
    let metadata;
    try {
        metadata = await extractMetadata(buffer, format, filename, id);
    } catch (error) {
        console.warn('[Import] Metadata extraction failed, using filename:', error);
        metadata = null;
    }

    // Build book object with extracted metadata (with filename fallbacks)
    const book: Book = {
        id,
        title: metadata?.title || filenameMetadata.title,
        author: metadata?.author || filenameMetadata.author,
        filePath,
        storagePath,
        format,
        fileSize,
        addedAt: new Date(),
        progress: 0,
        isFavorite: false,
        tags: [],
        readingTime: 0,
        // Additional metadata from extraction
        coverPath: metadata?.coverDataUrl || undefined,
        description: metadata?.description,
        publisher: metadata?.publisher,
        publishedDate: metadata?.publishedDate,
        language: metadata?.language,
    };

    console.log('[Import] Book created:', {
        id: book.id,
        title: book.title,
        author: book.author,
        hasCover: !!book.coverPath,
    });

    return book;
}

/**
 * Import multiple books with error handling
 */
export async function importBooks(filePaths: string[]): Promise<Book[]> {
    const books: Book[] = [];

    for (const filePath of filePaths) {
        try {
            const book = await createBookEntry(filePath);
            if (book) {
                books.push(book);
            }
        } catch (error) {
            console.error('Failed to import book:', filePath, error);
            // Continue with next book, don't freeze
        }
    }

    return books;
}

/**
 * Show file picker and import selected books
 */
export async function pickAndImportBooks(): Promise<Book[]> {
    const filePaths = await pickBookFiles();
    if (filePaths.length === 0) {
        return [];
    }
    
    return importBooks(filePaths);
}

/**
 * Scan a folder for books
 */
export async function scanFolderForBooks(folderPath: string): Promise<string[]> {
    const { fs } = await initTauriPlugins();
    if (!fs) throw new Error('FS plugin not available');

    const bookExtensions = ['.epub', '.mobi', '.azw', '.azw3', '.fb2', '.fbz', '.cbz', '.cbr'];
    const bookFiles: string[] = [];

    async function scanDir(dir: string) {
        try {
            const entries = await fs.readDir(dir);
            
            for (const entry of entries) {
                const fullPath = `${dir}/${entry.name}`;
                
                if (entry.isDirectory) {
                    await scanDir(fullPath);
                } else if (entry.isFile) {
                    const ext = entry.name.toLowerCase().slice(entry.name.lastIndexOf('.'));
                    if (bookExtensions.includes(ext)) {
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
