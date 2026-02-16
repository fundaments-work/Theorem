/**
 * Storage Utilities
 * Tauri-native file system storage with SQLite metadata
 */

import { get, set, del } from 'idb-keyval';
import { isTauri } from './env';

const STORE_NAME = 'theorem-books';
const COVERS_STORE = 'theorem-covers';
const BLOB_CACHE_LIMIT = 4;

// Cache for Tauri FS module
let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null;
let appDataDirPath: string | null = null;
const blobCache = new Map<string, Blob>();
const pendingDataReads = new Map<string, Promise<ArrayBuffer | null>>();
const pendingBlobReads = new Map<string, Promise<Blob | null>>();

function getStorageKey(id: string, filePath?: string): string {
    return filePath || `id:${id}`;
}

function getMimeTypeFromPath(filePath?: string): string {
    const ext = filePath?.toLowerCase().split('.').pop();
    if (ext === 'pdf') {
        return 'application/pdf';
    }
    if (ext === 'epub') {
        return 'application/epub+zip';
    }
    return 'application/octet-stream';
}

function getCachedBlob(cacheKey: string): Blob | null {
    const cached = blobCache.get(cacheKey);
    if (!cached) {
        return null;
    }

    // Refresh insertion order for LRU eviction.
    blobCache.delete(cacheKey);
    blobCache.set(cacheKey, cached);
    return cached;
}

function cacheBlob(cacheKey: string, blob: Blob): void {
    blobCache.set(cacheKey, blob);

    while (blobCache.size > BLOB_CACHE_LIMIT) {
        const oldestKey = blobCache.keys().next().value as string | undefined;
        if (!oldestKey) {
            break;
        }
        blobCache.delete(oldestKey);
    }
}

function clearBlobCacheForBook(id: string, filePath?: string): void {
    blobCache.delete(getStorageKey(id, filePath));
    blobCache.delete(`idb://${id}`);
    blobCache.delete(`id:${id}`);
}

// Dynamically import Tauri FS
async function getTauriFs() {
    if (!isTauri()) return null;
    if (tauriFs) return tauriFs;
    try {
        tauriFs = await import('@tauri-apps/plugin-fs');
        return tauriFs;
    } catch {
        return null;
    }
}

async function getAppDataPath(): Promise<string | null> {
    if (!isTauri()) return null;
    if (appDataDirPath) return appDataDirPath;
    try {
        const { appDataDir } = await import('@tauri-apps/api/path');
        appDataDirPath = await appDataDir();
        return appDataDirPath;
    } catch {
        return null;
    }
}

async function getAppDir() {
    const fs = await getTauriFs();
    if (!fs) return null;
    
    try {
        const dir = await getAppDataPath();
        if (!dir) return null;
        
        // Ensure books directory exists using baseDir option
        const booksDir = 'books';
        try {
            await fs.mkdir(booksDir, { 
                recursive: true, 
                baseDir: fs.BaseDirectory.AppData 
            });
        } catch {
            // Directory may already exist
        }
        
        return `${dir}/books`;
    } catch {
        return null;
    }
}

/**
 * Save book data to storage
 * In Tauri: saves to app data directory
 * Fallback: IndexedDB for development
 */
export async function saveBookData(id: string, data: ArrayBuffer): Promise<string> {
    const fs = await getTauriFs();
    const appDir = await getAppDir();
    clearBlobCacheForBook(id);
    
    if (fs && appDir) {
        const relativePath = `books/${id}.book`;
        const fullPath = `${appDir}/${id}.book`;
        try {
            await fs.writeFile(relativePath, new Uint8Array(data), {
                baseDir: fs.BaseDirectory.AppData
            });
            return fullPath;
        } catch (error) {
            console.error('[Storage] Failed to save to Tauri FS:', error);
        }
    }
    
    // Fallback to IndexedDB
    try {
        await set(`${STORE_NAME}-${id}`, data);
        return `idb://${id}`;
    } catch (error) {
        console.error('[Storage] Failed to save book data:', error);
        throw error;
    }
}

/**
 * Check if a path is an app storage path (ends with .book)
 */
function isAppStoragePath(filePath: string): boolean {
    return filePath.endsWith('.book');
}

/**
 * Get the relative path for app storage files
 */
function getRelativeStoragePath(filePath: string): string | null {
    // Extract the book ID from the path (e.g., "books/uuid.book")
    const match = filePath.match(/books\/([^/]+\.book)$/);
    if (match) {
        return `books/${match[1]}`;
    }
    return null;
}

/**
 * Get book data from storage as ArrayBuffer
 */
export async function getBookData(id: string, filePath?: string): Promise<ArrayBuffer | null> {
    const cacheKey = getStorageKey(id, filePath);
    const pendingRead = pendingDataReads.get(cacheKey);
    if (pendingRead) {
        return pendingRead;
    }

    const readPromise = (async () => {
        const fs = await getTauriFs();

        // Check if this is a browser-imported file (virtual path)
        const isBrowserPath = filePath?.startsWith('browser://');
        // Check if this is an IndexedDB URL
        const isIdbUrl = filePath?.startsWith('idb://');

        // If we have Tauri and a real file path (not browser:// or idb://), read from there
        if (fs && filePath && !isIdbUrl && !isBrowserPath) {
            try {
                // Check if this is an app storage path - use baseDir for those
                if (isAppStoragePath(filePath)) {
                    const relativePath = getRelativeStoragePath(filePath);
                    if (relativePath) {
                        const contents = await fs.readFile(relativePath, {
                            baseDir: fs.BaseDirectory.AppData,
                        });
                        return contents.buffer as ArrayBuffer;
                    }
                }

                // For external files, read directly
                const contents = await fs.readFile(filePath);
                return contents.buffer as ArrayBuffer;
            } catch (error) {
                console.error('[Storage] Error reading file from Tauri FS:', error);
                // Continue to fallback
            }
        }

        // Extract ID from idb:// URL if needed, otherwise use the provided id
        const effectiveId = isIdbUrl ? filePath!.slice(6) : id;

        // Fallback to IndexedDB (for browser mode and idb:// paths)
        try {
            const data = await get<ArrayBuffer>(`${STORE_NAME}-${effectiveId}`);
            return data ?? null;
        } catch (error) {
            console.error('[Storage] Failed to get book data from IndexedDB:', error);
            return null;
        }
    })();

    pendingDataReads.set(cacheKey, readPromise);

    try {
        return await readPromise;
    } finally {
        pendingDataReads.delete(cacheKey);
    }
}

/**
 * Get book data as a Blob - more memory efficient than ArrayBuffer
 * This avoids extra memory copies when passing to EPUB.js
 */
export async function getBookBlob(id: string, filePath?: string): Promise<Blob | null> {
    const cacheKey = getStorageKey(id, filePath);
    const cachedBlob = getCachedBlob(cacheKey);
    if (cachedBlob) {
        return cachedBlob;
    }

    const pendingRead = pendingBlobReads.get(cacheKey);
    if (pendingRead) {
        return pendingRead;
    }

    const readPromise = (async () => {
        const fs = await getTauriFs();

        // Check if this is a browser-imported file (virtual path)
        const isBrowserPath = filePath?.startsWith('browser://');
        // Check if this is an IndexedDB URL
        const isIdbUrl = filePath?.startsWith('idb://');
        const mimeType = getMimeTypeFromPath(filePath);

        // If we have Tauri and a real file path (not browser:// or idb://), read from there
        if (fs && filePath && !isIdbUrl && !isBrowserPath) {
            try {
                // Check if this is an app storage path - use baseDir for those
                if (isAppStoragePath(filePath)) {
                    const relativePath = getRelativeStoragePath(filePath);
                    if (relativePath) {
                        const contents = await fs.readFile(relativePath, {
                            baseDir: fs.BaseDirectory.AppData,
                        });
                        return new Blob([contents], { type: mimeType });
                    }
                }

                // For external files, read directly
                const contents = await fs.readFile(filePath);
                return new Blob([contents], { type: mimeType });
            } catch (error) {
                console.error('[Storage] Error reading blob from Tauri FS:', error);
                // Continue to fallback
            }
        }

        // Extract ID from idb:// URL if needed
        const effectiveId = isIdbUrl ? filePath!.slice(6) : id;

        // Fallback to IndexedDB (for browser mode and idb:// paths)
        try {
            const data = await get<ArrayBuffer>(`${STORE_NAME}-${effectiveId}`);
            if (!data) {
                return null;
            }
            return new Blob([data], { type: mimeType });
        } catch (error) {
            console.error('[Storage] Failed to get book blob from IndexedDB:', error);
            return null;
        }
    })();

    pendingBlobReads.set(cacheKey, readPromise);

    try {
        const blob = await readPromise;
        if (blob) {
            cacheBlob(cacheKey, blob);
        }
        return blob;
    } finally {
        pendingBlobReads.delete(cacheKey);
    }
}

/**
 * Delete book data from storage
 */
export async function deleteBookData(id: string, filePath?: string): Promise<void> {
    const fs = await getTauriFs();
    clearBlobCacheForBook(id, filePath);
    
    if (fs && filePath && !filePath.startsWith('idb://')) {
        try {
            // Check if this is an app storage path - use baseDir for those
            if (isAppStoragePath(filePath)) {
                const relativePath = getRelativeStoragePath(filePath);
                if (relativePath) {
                    await fs.remove(relativePath, {
                        baseDir: fs.BaseDirectory.AppData
                    });
                    return;
                }
            }
            await fs.remove(filePath);
            return;
        } catch (error) {
            console.error('[Storage] Failed to delete from Tauri FS:', error);
        }
    }
    
    try {
        await del(`${STORE_NAME}-${id}`);
    } catch (error) {
        console.error('[Storage] Failed to delete book data:', error);
    }
}

/**
 * Get storage stats
 * @deprecated Use storage-manager.ts functions instead
 */
export async function getStorageStats(): Promise<{ used: number; total: number }> {
    // Simplified - in production, use Tauri FS to calculate actual usage
    return { used: 0, total: 1024 * 1024 * 1024 }; // 1GB default
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
 * Save cover image as data URL
 * @param bookId - The book ID
 * @param blob - Cover image blob (JPEG/PNG)
 * @returns Data URL of the saved cover
 */
export async function saveCoverImage(bookId: string, blob: Blob): Promise<string> {
    try {
        const dataUrl = await blobToDataUrl(blob);
        await set(`${COVERS_STORE}-${bookId}`, dataUrl);
        return dataUrl;
    } catch (error) {
        console.error('[Storage] Failed to save cover image:', error);
        throw error;
    }
}

/**
 * Get cover image data URL
 * @param bookId - The book ID
 * @returns Data URL of the cover or null if not found
 */
export async function getCoverImage(bookId: string): Promise<string | null> {
    try {
        const dataUrl = await get<string>(`${COVERS_STORE}-${bookId}`);
        return dataUrl ?? null;
    } catch (error) {
        console.error('[Storage] Failed to get cover image:', error);
        return null;
    }
}

/**
 * Delete cover image
 * @param bookId - The book ID
 */
export async function deleteCoverImage(bookId: string): Promise<void> {
    try {
        await del(`${COVERS_STORE}-${bookId}`);
    } catch (error) {
        console.error('[Storage] Failed to delete cover image:', error);
    }
}
