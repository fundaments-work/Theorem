/**
 * Book Import Utilities
 * Cross-platform file import with instant entry creation
 * Works in both Tauri and browser environments
 */

import type { Book, BookFormat } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { isTauri, isMobile } from './env';
import { saveBookData, getBookData } from './storage';
import { formatFileSize, normalizeFilePath, safeDecodeURIComponent } from './utils';

// Dynamically import Tauri plugins
let tauriDialog: typeof import('@tauri-apps/plugin-dialog') | null = null;
let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null;

const DEFAULT_IMPORT_CONCURRENCY = 4;
const MAX_IMPORT_CONCURRENCY = 8;
const INSTANT_IMPORT_MODE = true;
const CONTENT_HASH_MAX_BYTES = 4 * 1024 * 1024;
const CONTENT_URI_READ_TIMEOUT_MS = 20000;
const IMPORT_ENTRY_TIMEOUT_MS = 30000;
const SUPPORTED_IMPORT_EXTENSIONS = ['epub', 'mobi', 'azw', 'azw3', 'fb2', 'fbz', 'fb2.zip', 'cbz', 'pdf'];
const SUPPORTED_IMPORT_SUFFIXES = SUPPORTED_IMPORT_EXTENSIONS.map((extension) => `.${extension}`);
const BROWSER_IMPORT_ACCEPT = SUPPORTED_IMPORT_SUFFIXES.join(',');

function getImportConcurrency(): number {
    if (isMobile()) {
        return 1;
    }

    const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency;
    if (typeof hardwareConcurrency === 'number' && hardwareConcurrency > 0) {
        return Math.max(
            DEFAULT_IMPORT_CONCURRENCY,
            Math.min(MAX_IMPORT_CONCURRENCY, Math.floor(hardwareConcurrency / 2)),
        );
    }

    return DEFAULT_IMPORT_CONCURRENCY;
}

function arrayBufferToHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let index = 0; index < bytes.length; index += 1) {
        hex += bytes[index].toString(16).padStart(2, '0');
    }
    return hex;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`[Import] Timeout while ${label} (${timeoutMs}ms)`));
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

async function computeContentHash(buffer: ArrayBuffer): Promise<string | undefined> {
    if (buffer.byteLength > CONTENT_HASH_MAX_BYTES) {
        return undefined;
    }

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

function normalizeImportPath(filePath: string): string {
    return normalizeFilePath(filePath);
}

function normalizeFilenameCandidate(candidate: string): string | null {
    const decodedCandidate = safeDecodeURIComponent(candidate).trim();
    if (!decodedCandidate) {
        return null;
    }

    const withoutStoragePrefix = decodedCandidate.includes(':')
        ? decodedCandidate.slice(decodedCandidate.indexOf(':') + 1)
        : decodedCandidate;
    const basename = withoutStoragePrefix
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
        .pop()
        ?.trim();

    if (!basename || basename === '.' || basename === '..') {
        return null;
    }

    return basename;
}

function hasKnownBookExtension(candidate: string): boolean {
    const lowerName = candidate.toLowerCase();
    return SUPPORTED_IMPORT_SUFFIXES.some((suffix) => lowerName.endsWith(suffix));
}

function defaultFilenameForFormat(format: BookFormat): string {
    switch (format) {
        case 'epub':
            return 'book.epub';
        case 'mobi':
            return 'book.mobi';
        case 'azw':
            return 'book.azw';
        case 'azw3':
            return 'book.azw3';
        case 'fb2':
            return 'book.fb2';
        case 'cbz':
            return 'book.cbz';
        case 'cbr':
            return 'book.cbr';
        case 'pdf':
            return 'book.pdf';
    }
}

export function ensureFilenameForFormat(filename: string | undefined, format: BookFormat): string {
    const normalizedCandidate = normalizeFilenameCandidate(filename || '');
    if (!normalizedCandidate) {
        return defaultFilenameForFormat(format);
    }

    if (hasKnownBookExtension(normalizedCandidate)) {
        return normalizedCandidate;
    }

    const hasGenericExtension = /\.[A-Za-z0-9]{1,10}$/.test(normalizedCandidate);
    if (hasGenericExtension) {
        return normalizedCandidate;
    }

    const fallbackName = defaultFilenameForFormat(format);
    const fallbackExtension = fallbackName.slice(fallbackName.lastIndexOf('.'));
    return `${normalizedCandidate}${fallbackExtension}`;
}

export function extractFilenameFromPath(filePath: string): string {
    const normalizedPath = normalizeImportPath(filePath);

    if (normalizedPath.startsWith('content://')) {
        try {
            const uri = new URL(normalizedPath);
            const directCandidates = [
                uri.searchParams.get('displayName'),
                uri.searchParams.get('_display_name'),
                uri.searchParams.get('name'),
                uri.searchParams.get('filename'),
            ];
            for (const value of directCandidates) {
                if (!value) {
                    continue;
                }
                const normalizedCandidate = normalizeFilenameCandidate(value);
                if (normalizedCandidate && hasKnownBookExtension(normalizedCandidate)) {
                    return normalizedCandidate;
                }
            }

            const encodedDocumentMatch = uri.pathname.match(/\/document\/(.+)$/);
            if (encodedDocumentMatch && encodedDocumentMatch[1]) {
                const documentId = safeDecodeURIComponent(encodedDocumentMatch[1]);
                const normalizedCandidate = normalizeFilenameCandidate(documentId);
                if (normalizedCandidate) {
                    return normalizedCandidate;
                }
            }

            const decodedPathname = safeDecodeURIComponent(uri.pathname);
            const decodedDocumentMatch = decodedPathname.match(/\/document\/(.+)$/);
            if (decodedDocumentMatch && decodedDocumentMatch[1]) {
                const normalizedCandidate = normalizeFilenameCandidate(decodedDocumentMatch[1]);
                if (normalizedCandidate) {
                    return normalizedCandidate;
                }
            }
        } catch {
            // fall through to generic parsing
        }
    }

    const fallbackFilename = normalizedPath.split(/[/\\]/).pop() || 'Unknown';
    const normalizedFallback = normalizeFilenameCandidate(fallbackFilename);
    if (normalizedFallback) {
        return normalizedFallback;
    }
    return safeDecodeURIComponent(fallbackFilename);
}

function isSupportedImportFilename(lowerName: string): boolean {
    return SUPPORTED_IMPORT_SUFFIXES.some((suffix) => lowerName.endsWith(suffix));
}

function normalizePathForFormatLookup(filePath: string): string {
    const normalizedPath = normalizeImportPath(filePath);
    return normalizedPath.split(/[?#]/, 1)[0].toLowerCase();
}

function isZipSignature(bytes: Uint8Array): boolean {
    if (bytes.length < 4) {
        return false;
    }

    return bytes[0] === 0x50
        && bytes[1] === 0x4b
        && (
            (bytes[2] === 0x03 && bytes[3] === 0x04)
            || (bytes[2] === 0x05 && bytes[3] === 0x06)
            || (bytes[2] === 0x07 && bytes[3] === 0x08)
        );
}

function detectFormatFromBuffer(buffer: ArrayBuffer): BookFormat | null {
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) {
        return null;
    }

    if (
        bytes.length >= 5
        && bytes[0] === 0x25
        && bytes[1] === 0x50
        && bytes[2] === 0x44
        && bytes[3] === 0x46
        && bytes[4] === 0x2d
    ) {
        return 'pdf';
    }

    if (bytes.length >= 68) {
        const mobiMagic = String.fromCharCode(...bytes.slice(60, 68));
        if (mobiMagic === 'BOOKMOBI') {
            return 'mobi';
        }
    }

    const textProbe = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 4096))).toLowerCase();
    if (textProbe.includes('<fictionbook')) {
        return 'fb2';
    }

    if (isZipSignature(bytes)) {
        const zipProbe = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 262144))).toLowerCase();
        if (zipProbe.includes('application/epub+zip') || zipProbe.includes('meta-inf/container.xml') || zipProbe.includes('.opf')) {
            return 'epub';
        }
        if (zipProbe.includes('.fb2')) {
            return 'fb2';
        }
        if (/\.(png|jpe?g|webp|gif|bmp|avif)/.test(zipProbe) && !zipProbe.includes('.opf')) {
            return 'cbz';
        }
        return 'epub';
    }

    return null;
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
    const lowerPath = normalizePathForFormatLookup(filePath);

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

    try {
        const selected = await plugins.dialog.open({
            multiple: true,
            pickerMode: 'document',
            // Use scoped access to avoid a dialog-level file copy.
            fileAccessMode: 'scoped',
            filters: [
                {
                    name: 'All eBooks',
                    extensions: [
                        ...SUPPORTED_IMPORT_EXTENSIONS,
                        'application/epub+zip',
                        'application/x-mobipocket-ebook',
                        'application/x-fictionbook+xml',
                        'application/vnd.comicbook+zip',
                        'application/pdf',
                    ],
                },
                { name: 'EPUB', extensions: ['epub'] },
                { name: 'Kindle (MOBI/AZW)', extensions: ['mobi', 'azw', 'azw3'] },
                { name: 'FictionBook (FB2)', extensions: ['fb2', 'fbz', 'fb2.zip'] },
                { name: 'Comics (CBZ)', extensions: ['cbz'] },
                { name: 'PDF', extensions: ['pdf'] },
            ],
        });

        // Debug logging for mobile
        if (isMobile()) {
            console.log('[pickBookFiles] Dialog returned:', selected);
            console.log('[pickBookFiles] Type:', typeof selected);
        }

        if (!selected) return [];
        const entries = (Array.isArray(selected) ? selected : [selected]) as unknown[];
        const paths: string[] = [];

        for (const entry of entries) {
            if (typeof entry === 'string') {
                // On Android, dialog may return content:// URIs which we need to handle differently
                if (entry.startsWith('content://')) {
                    paths.push(entry);
                } else {
                    paths.push(normalizeImportPath(entry));
                }
                continue;
            }

            if (entry && typeof entry === 'object') {
                // Handle object with path property (desktop)
                if ('path' in entry && typeof (entry as { path?: unknown }).path === 'string') {
                    paths.push(normalizeImportPath((entry as { path: string }).path));
                    continue;
                }
                
                // Handle object with uri property (some mobile versions)
                if ('uri' in entry && typeof (entry as { uri?: unknown }).uri === 'string') {
                    const uri = (entry as { uri: string }).uri;
                    paths.push(uri.startsWith('content://') ? uri : normalizeImportPath(uri));
                }
            }
        }

        return paths;
    } catch (error) {
        console.error('[pickBookFiles] Dialog error:', error);
        throw error;
    }
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
        input.accept = BROWSER_IMPORT_ACCEPT;
        
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

    // Build book object quickly and defer expensive metadata extraction to
    // background processing in the library screen.
    const book: Book = {
        id,
        title: filenameMetadata.title,
        author: filenameMetadata.author || "",
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
        coverExtractionDone: !INSTANT_IMPORT_MODE,
    };

    return book;
}

/**
 * Import books from browser File objects
 */
export async function importBooksFromFiles(files: File[]): Promise<Book[]> {
    return importBooksFromFilesIncremental(files);
}

export async function importBooksFromFilesIncremental(
    files: File[],
    onBookImported?: (book: Book) => void,
): Promise<Book[]> {
    const imported = await runWithConcurrency(
        files,
        getImportConcurrency(),
        async (file): Promise<Book | null> => {
            try {
                const book = await createBookEntryFromFile(file);
                if (book) {
                    onBookImported?.(book);
                }
                return book;
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
    const normalizedFilePath = normalizeImportPath(filePath);
    try {
        // Use getBookData which properly handles both Tauri paths and IndexedDB URLs
        const data = await getBookData(bookId || '', normalizedFilePath);
        if (!data) {
            throw new Error('Could not read book file from storage - data not found');
        }
        return data;
    } catch (error) {
        console.error('[Import] Error reading file:', normalizedFilePath, error);
        throw new Error(`Failed to read book file: ${error}`);
    }
}

/**
 * Extract basic metadata from filename
 */
export function extractFilenameMetadata(filePath: string): { title: string; author: string } {
    const filename = extractFilenameFromPath(filePath);
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
    const normalizedFilePath = normalizeImportPath(filePath);
    const isContentUri = normalizedFilePath.startsWith('content://');
    let format = getBookFormat(normalizedFilePath);

    const plugins = await initTauriPlugins();
    if (!plugins?.fs) throw new Error('FS plugin not available - this function requires Tauri');
    const fs = plugins.fs;

    // Get file stats
    let fileSize = 0;
    if (!isContentUri) {
        try {
            const stats = await fs.stat(normalizedFilePath);
            fileSize = Number(stats.size);
        } catch {
            // Stats not available, continue without size
        }
    }

    // Check file size - warn if very large (> 100MB)
    if (fileSize > 100 * 1024 * 1024) {
        console.warn('Large file detected:', normalizedFilePath, formatFileSize(fileSize));
    }

    // Read file content for storage
    const buffer = isContentUri
        ? await withTimeout(
            readBookFile(normalizedFilePath),
            CONTENT_URI_READ_TIMEOUT_MS,
            `reading Android document URI: ${normalizedFilePath}`,
        )
        : await readBookFile(normalizedFilePath);
    if (!buffer || buffer.byteLength === 0) {
        console.error('Empty file or failed to read:', normalizedFilePath);
        return null;
    }
    if (fileSize <= 0) {
        fileSize = buffer.byteLength;
    }

    if (!format) {
        format = detectFormatFromBuffer(buffer);
    }
    if (!format) {
        console.error('Unsupported file format:', normalizedFilePath);
        return null;
    }
    if (!isImportFormatSupported(format)) {
        console.error('[Import] CBR archives are not supported in this build:', normalizedFilePath);
        return null;
    }
    const contentHash = await computeContentHash(buffer);

    const id = uuidv4();

    // Save to app storage first
    const storagePath = await saveBookData(id, buffer);

    // Resolve a stable filename for metadata extraction on Android content URIs.
    const resolvedFilename = ensureFilenameForFormat(extractFilenameFromPath(normalizedFilePath), format);
    const filenameMetadata = extractFilenameMetadata(resolvedFilename);

    // Build book object quickly and defer expensive metadata extraction to
    // background processing in the library screen.
    const book: Book = {
        id,
        title: filenameMetadata.title,
        author: filenameMetadata.author || "",
        filePath: normalizedFilePath,
        storagePath,
        format,
        contentHash,
        fileSize,
        addedAt: new Date(),
        progress: 0,
        isFavorite: false,
        tags: [],
        readingTime: 0,
        coverExtractionDone: !INSTANT_IMPORT_MODE,
    };

    return book;
}

/**
 * Import multiple books with error handling
 */
export async function importBooks(filePaths: string[]): Promise<Book[]> {
    return importBooksIncremental(filePaths);
}

export async function importBooksIncremental(
    filePaths: string[],
    onBookImported?: (book: Book) => void,
): Promise<Book[]> {
    const imported = await runWithConcurrency(
        filePaths,
        getImportConcurrency(),
        async (filePath): Promise<Book | null> => {
            try {
                const book = await withTimeout(
                    createBookEntry(filePath),
                    IMPORT_ENTRY_TIMEOUT_MS,
                    `importing file: ${filePath}`,
                );
                if (book) {
                    onBookImported?.(book);
                }
                return book;
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
    return pickAndImportBooksIncremental();
}

export async function pickAndImportBooksIncremental(
    onBookImported?: (book: Book) => void,
): Promise<Book[]> {
    if (isTauri() && !isMobile()) {
        // Desktop Tauri: use native file picker
        const filePaths = await pickBookFiles();
        if (filePaths.length === 0) {
            return [];
        }
        return importBooksIncremental(filePaths, onBookImported);
    } else if (isTauri() && isMobile()) {
        // Mobile Tauri (Android): Use browser file picker for better compatibility
        // The native dialog on Android returns content:// URIs which are hard to handle
        console.log('[pickAndImportBooks] Using browser file picker for mobile');
        const files = await pickBookFilesBrowser();
        if (files.length === 0) {
            return [];
        }
        return importBooksFromFilesIncremental(files, onBookImported);
    } else {
        // Browser: use HTML5 file picker
        const files = await pickBookFilesBrowser();
        if (files.length === 0) {
            return [];
        }
        return importBooksFromFilesIncremental(files, onBookImported);
    }
}

/**
 * Scan a folder for books (Tauri only)
 */
export async function scanFolderForBooks(folderPath: string): Promise<string[]> {
    const plugins = await initTauriPlugins();
    if (!plugins?.fs) throw new Error('FS plugin not available - folder scanning requires Tauri');
    const fs = plugins.fs;

    const rootFolderPath = normalizeImportPath(folderPath);
    if (!rootFolderPath) {
        return [];
    }

    const bookFiles: string[] = [];
    const visitedDirectories = new Set<string>();

    type ScanEntryLike = {
        name?: unknown;
        path?: unknown;
        isDirectory?: unknown;
        isFile?: unknown;
        isSymlink?: unknown;
    };

    type ScanEntryKind = 'directory' | 'file' | 'skip';

    function joinScanPath(parentDir: string, childName: string): string {
        const safeChildName = childName.replace(/^[/\\]+/, '');
        if (!parentDir) {
            return safeChildName;
        }

        if (parentDir.endsWith('/') || parentDir.endsWith('\\')) {
            return `${parentDir}${safeChildName}`;
        }

        const separator = parentDir.includes('\\') && !parentDir.includes('/') ? '\\' : '/';
        return `${parentDir}${separator}${safeChildName}`;
    }

    function getEntryName(entry: ScanEntryLike): string | null {
        if (typeof entry.name === 'string') {
            const trimmedName = entry.name.trim();
            if (trimmedName) {
                return trimmedName;
            }
        }

        if (typeof entry.path === 'string') {
            const trimmedPath = entry.path.trim();
            if (!trimmedPath) {
                return null;
            }
            const pathName = trimmedPath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
            return pathName?.trim() || null;
        }

        return null;
    }

    function getBooleanFlag(value: unknown): boolean | null {
        return typeof value === 'boolean' ? value : null;
    }

    async function resolveEntryKind(entry: ScanEntryLike, fullPath: string): Promise<ScanEntryKind> {
        if (getBooleanFlag(entry.isSymlink) === true) {
            return 'skip';
        }

        if (getBooleanFlag(entry.isDirectory) === true) {
            return 'directory';
        }

        if (getBooleanFlag(entry.isFile) === true) {
            return 'file';
        }

        try {
            const stats = await fs.stat(fullPath);
            if (stats.isSymlink) {
                return 'skip';
            }
            if (stats.isDirectory) {
                return 'directory';
            }
            if (stats.isFile) {
                return 'file';
            }
        } catch {
            // Best-effort fallback for unusual entry payloads.
        }

        return 'skip';
    }

    async function scanDir(dir: string) {
        const normalizedDir = normalizeImportPath(dir);
        if (visitedDirectories.has(normalizedDir)) {
            return;
        }
        visitedDirectories.add(normalizedDir);

        try {
            const entries = await fs.readDir(normalizedDir);
            
            for (const entry of entries) {
                const entryLike = entry as ScanEntryLike;
                const entryName = getEntryName(entryLike);
                if (!entryName) {
                    continue;
                }

                const fullPath = normalizeImportPath(joinScanPath(normalizedDir, entryName));
                const kind = await resolveEntryKind(entryLike, fullPath);

                if (kind === 'directory') {
                    await scanDir(fullPath);
                } else if (kind === 'file') {
                    const lowerName = entryName.toLowerCase();
                    const isSupportedBook = isSupportedImportFilename(lowerName);

                    if (isSupportedBook) {
                        bookFiles.push(fullPath);
                    }
                }
            }
        } catch (error) {
            console.error('Error scanning directory:', normalizedDir, error);
        }
    }

    await scanDir(rootFolderPath);
    return Array.from(new Set(bookFiles));
}
