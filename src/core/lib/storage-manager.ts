/**
 * Storage Management Utilities
 * Comprehensive storage cleanup, stats, and optimization
 */

import { get, set, del, keys } from 'idb-keyval';
import { isTauri } from './env';

const STORE_NAME = 'theorem-books';
const COVERS_STORE = 'theorem-covers';
const METADATA_STORE = 'theorem-metadata';
const STARDICT_PREFIX = 'theorem-stardict';

// Cache for Tauri FS module
let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null;

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

/**
 * Get all IndexedDB keys matching a prefix
 */
async function getIndexedDBKeysByPrefix(prefix: string): Promise<string[]> {
    try {
        const allKeys = await keys();
        return allKeys.filter((key): key is string => 
            typeof key === 'string' && key.startsWith(prefix)
        );
    } catch (error) {
        console.error('[StorageManager] Failed to get IndexedDB keys:', error);
        return [];
    }
}

/**
 * Calculate storage size for a specific IndexedDB key
 */
async function getIndexedDBKeySize(key: string): Promise<number> {
    try {
        const value = await get(key);
        if (value === undefined || value === null) return 0;
        
        // Estimate size based on type
        if (typeof value === 'string') {
            return new Blob([value]).size;
        }
        if (value instanceof ArrayBuffer) {
            return value.byteLength;
        }
        if (value instanceof Uint8Array) {
            return value.byteLength;
        }
        // For objects, convert to JSON string
        return new Blob([JSON.stringify(value)]).size;
    } catch {
        return 0;
    }
}

/**
 * Delete book binary data and cover from all storage locations
 */
export async function deleteBookStorage(bookId: string, filePath?: string): Promise<void> {
    const fs = await getTauriFs();
    
    // Delete from Tauri FS if applicable
    if (fs && filePath && !filePath.startsWith('idb://') && !filePath.startsWith('browser://')) {
        try {
            if (filePath.endsWith('.book')) {
                const match = filePath.match(/books\/([^/]+\.book)$/);
                if (match) {
                    await fs.remove(`books/${match[1]}`, {
                        baseDir: fs.BaseDirectory.AppData
                    });
                } else {
                    await fs.remove(filePath);
                }
            }
        } catch (error) {
            console.error('[StorageManager] Failed to delete book file:', error);
        }
    }
    
    // Delete from IndexedDB
    try {
        await del(`${STORE_NAME}-${bookId}`);
    } catch (error) {
        console.error('[StorageManager] Failed to delete book from IDB:', error);
    }
    
    // Delete cover
    try {
        await del(`${COVERS_STORE}-${bookId}`);
    } catch (error) {
        console.error('[StorageManager] Failed to delete cover:', error);
    }
    
    // Delete metadata
    try {
        await del(`${METADATA_STORE}-${bookId}`);
    } catch (error) {
        console.error('[StorageManager] Failed to delete metadata:', error);
    }
}

/**
 * Get storage statistics for books
 */
export async function getBookStorageStats(): Promise<{
    totalBooks: number;
    totalSize: number;
    coversSize: number;
    binariesSize: number;
    idbBooks: number;
    tauriBooks: number;
}> {
    const bookKeys = await getIndexedDBKeysByPrefix(`${STORE_NAME}-`);
    const coverKeys = await getIndexedDBKeysByPrefix(`${COVERS_STORE}-`);
    
    let binariesSize = 0;
    let coversSize = 0;
    
    // Calculate book binary sizes
    for (const key of bookKeys) {
        binariesSize += await getIndexedDBKeySize(key);
    }
    
    // Calculate cover sizes
    for (const key of coverKeys) {
        coversSize += await getIndexedDBKeySize(key);
    }
    
    return {
        totalBooks: bookKeys.length,
        totalSize: binariesSize + coversSize,
        coversSize,
        binariesSize,
        idbBooks: bookKeys.length,
        tauriBooks: 0, // Cannot easily check Tauri FS size from web context
    };
}

/**
 * Get storage statistics for RSS articles
 */
export async function getRssStorageStats(): Promise<{
    articleCount: number;
    totalSize: number;
}> {
    const keys = await getIndexedDBKeysByPrefix('theorem-rss-');
    let totalSize = 0;
    
    for (const key of keys) {
        totalSize += await getIndexedDBKeySize(key);
    }
    
    return {
        articleCount: keys.length,
        totalSize,
    };
}

/**
 * Get storage statistics for StarDict dictionaries
 */
export async function getStarDictStorageStats(): Promise<{
    dictionaryCount: number;
    totalSize: number;
}> {
    const keys = await getIndexedDBKeysByPrefix(`${STARDICT_PREFIX}:`);
    let totalSize = 0;
    
    for (const key of keys) {
        totalSize += await getIndexedDBKeySize(key);
    }
    
    return {
        dictionaryCount: keys.length / 4, // Rough estimate (manifest + 3 files per dict)
        totalSize,
    };
}

/**
 * Clear all StarDict dictionaries from storage
 */
export async function clearAllStarDictDictionaries(): Promise<void> {
    const keys = await getIndexedDBKeysByPrefix(`${STARDICT_PREFIX}:`);
    await Promise.all(keys.map(key => del(key)));
}

/**
 * Clear all book binaries from IndexedDB
 */
export async function clearAllBookBinaries(): Promise<void> {
    const keys = await getIndexedDBKeysByPrefix(`${STORE_NAME}-`);
    await Promise.all(keys.map(key => del(key)));
}

/**
 * Clear all covers from IndexedDB
 */
export async function clearAllCovers(): Promise<void> {
    const keys = await getIndexedDBKeysByPrefix(`${COVERS_STORE}-`);
    await Promise.all(keys.map(key => del(key)));
}

/**
 * Clear all RSS article content from IndexedDB
 */
export async function clearAllRssStorage(): Promise<void> {
    const keys = await getIndexedDBKeysByPrefix('theorem-rss-');
    await Promise.all(keys.map(key => del(key)));
}

/**
 * Get total storage usage estimate
 */
export async function getTotalStorageUsage(): Promise<{
    books: number;
    covers: number;
    rss: number;
    stardict: number;
    total: number;
}> {
    const [bookStats, rssStats, stardictStats] = await Promise.all([
        getBookStorageStats(),
        getRssStorageStats(),
        getStarDictStorageStats(),
    ]);
    
    return {
        books: bookStats.binariesSize,
        covers: bookStats.coversSize,
        rss: rssStats.totalSize,
        stardict: stardictStats.totalSize,
        total: bookStats.binariesSize + bookStats.coversSize + rssStats.totalSize + stardictStats.totalSize,
    };
}

/**
 * Comprehensive cleanup - removes orphaned data
 * Call this periodically or on startup
 */
export async function cleanupOrphanedStorage(existingBookIds: string[]): Promise<{
    removedBooks: number;
    removedCovers: number;
    removedMetadata: number;
}> {
    const bookKeys = await getIndexedDBKeysByPrefix(`${STORE_NAME}-`);
    const coverKeys = await getIndexedDBKeysByPrefix(`${COVERS_STORE}-`);
    const metadataKeys = await getIndexedDBKeysByPrefix(`${METADATA_STORE}-`);
    
    const existingIds = new Set(existingBookIds);
    
    let removedBooks = 0;
    let removedCovers = 0;
    let removedMetadata = 0;
    
    // Clean orphaned books
    for (const key of bookKeys) {
        const bookId = key.replace(`${STORE_NAME}-`, '');
        if (!existingIds.has(bookId)) {
            await del(key);
            removedBooks++;
        }
    }
    
    // Clean orphaned covers
    for (const key of coverKeys) {
        const bookId = key.replace(`${COVERS_STORE}-`, '');
        if (!existingIds.has(bookId)) {
            await del(key);
            removedCovers++;
        }
    }
    
    // Clean orphaned metadata
    for (const key of metadataKeys) {
        const bookId = key.replace(`${METADATA_STORE}-`, '');
        if (!existingIds.has(bookId)) {
            await del(key);
            removedMetadata++;
        }
    }
    
    return {
        removedBooks,
        removedCovers,
        removedMetadata,
    };
}

/**
 * Clear ALL application storage
 * This is destructive and should be used with caution
 */
export async function clearAllApplicationStorage(): Promise<void> {
    // Clear all IndexedDB stores
    await Promise.all([
        clearAllBookBinaries(),
        clearAllCovers(),
        clearAllRssStorage(),
        clearAllStarDictDictionaries(),
    ]);
    
    // Clear localStorage
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('theorem-')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    // Clear sessionStorage
    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('theorem-')) {
            sessionKeysToRemove.push(key);
        }
    }
    sessionKeysToRemove.forEach(key => sessionStorage.removeItem(key));
}
