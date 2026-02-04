/**
 * Storage Utilities
 * Tauri-native file system storage with SQLite metadata
 */

import { get, set, del } from 'idb-keyval';
import { isTauri } from './env';

const STORE_NAME = 'lion-reader-books';
const METADATA_STORE = 'lion-reader-metadata';
const COVERS_STORE = 'lion-reader-covers';

// Dynamically import Tauri FS
async function getTauriFs() {
    if (!isTauri()) return null;
    try {
        return await import('@tauri-apps/plugin-fs');
    } catch {
        return null;
    }
}

async function getAppDir() {
    const fs = await getTauriFs();
    if (!fs) return null;
    
    try {
        const { appDataDir } = await import('@tauri-apps/api/path');
        const dir = await appDataDir();
        
        // Ensure books directory exists
        const booksDir = `${dir}/books`;
        try {
            await fs.mkdir(booksDir, { recursive: true });
        } catch {
            // Directory may already exist
        }
        
        return booksDir;
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
    
    if (fs && appDir) {
        const filePath = `${appDir}/${id}.book`;
        try {
            await fs.writeFile(filePath, new Uint8Array(data));
            return filePath;
        } catch (error) {
            console.error('Failed to save to Tauri FS:', error);
        }
    }
    
    // Fallback to IndexedDB
    try {
        await set(`${STORE_NAME}-${id}`, data);
        return `idb://${id}`;
    } catch (error) {
        console.error('Failed to save book data:', error);
        throw error;
    }
}

/**
 * Get book data from storage as ArrayBuffer
 */
export async function getBookData(id: string, filePath?: string): Promise<ArrayBuffer | null> {
    const fs = await getTauriFs();
    
    // If we have a Tauri file path (not an idb:// URL), read from there
    const isIdbUrl = filePath?.startsWith('idb://');
    
    if (fs && filePath && !isIdbUrl) {
        try {
            console.log('[Storage] Reading from Tauri FS:', filePath);
            const contents = await fs.readFile(filePath);
            return contents.buffer as ArrayBuffer;
        } catch (error) {
            console.error('[Storage] Error reading file from Tauri FS:', error);
            // Continue to fallback
        }
    }
    
    // Extract ID from idb:// URL if needed, otherwise use the provided id
    const effectiveId = isIdbUrl ? filePath!.slice(6) : id;
    
    // Fallback to IndexedDB
    try {
        console.log('[Storage] Reading from IndexedDB, id:', effectiveId);
        const data = await get<ArrayBuffer>(`${STORE_NAME}-${effectiveId}`);
        if (data) {
            console.log('[Storage] Found data in IndexedDB, size:', data.byteLength);
            return data;
        }
        console.error('[Storage] No data found in IndexedDB for id:', effectiveId);
        return null;
    } catch (error) {
        console.error('[Storage] Failed to get book data from IndexedDB:', error);
        return null;
    }
}

/**
 * Get book data as a Blob - more memory efficient than ArrayBuffer
 * This avoids extra memory copies when passing to EPUB.js
 */
export async function getBookBlob(id: string, filePath?: string): Promise<Blob | null> {
    const fs = await getTauriFs();
    
    // If we have a Tauri file path (not an idb:// URL), read from there
    const isIdbUrl = filePath?.startsWith('idb://');
    
    if (fs && filePath && !isIdbUrl) {
        try {
            console.log('[Storage] Reading blob from Tauri FS:', filePath);
            const contents = await fs.readFile(filePath);
            // Detect MIME type from extension
            const ext = filePath.toLowerCase().split('.').pop();
            const mimeType = ext === 'epub' ? 'application/epub+zip' : 'application/octet-stream';
            return new Blob([contents], { type: mimeType });
        } catch (error) {
            console.error('[Storage] Error reading blob from Tauri FS:', error);
            // Continue to fallback
        }
    }
    
    // Extract ID from idb:// URL if needed
    const effectiveId = isIdbUrl ? filePath!.slice(6) : id;
    
    // Fallback to IndexedDB
    try {
        console.log('[Storage] Reading blob from IndexedDB, id:', effectiveId);
        const data = await get<ArrayBuffer>(`${STORE_NAME}-${effectiveId}`);
        if (data) {
            console.log('[Storage] Found blob data in IndexedDB, size:', data.byteLength);
            // Detect MIME type from stored metadata or default to epub
            return new Blob([data], { type: 'application/epub+zip' });
        }
        console.error('[Storage] No blob data found in IndexedDB for id:', effectiveId);
        return null;
    } catch (error) {
        console.error('[Storage] Failed to get book blob from IndexedDB:', error);
        return null;
    }
}

/**
 * Delete book data from storage
 */
export async function deleteBookData(id: string, filePath?: string): Promise<void> {
    const fs = await getTauriFs();
    
    if (fs && filePath && !filePath.startsWith('idb://')) {
        try {
            await fs.remove(filePath);
            return;
        } catch (error) {
            console.error('Failed to delete from Tauri FS:', error);
        }
    }
    
    try {
        await del(`${STORE_NAME}-${id}`);
    } catch (error) {
        console.error('Failed to delete book data:', error);
    }
}

/**
 * Save book metadata to storage
 */
export async function saveBookMetadata<T>(id: string, metadata: T): Promise<void> {
    try {
        await set(`${METADATA_STORE}-${id}`, metadata);
    } catch (error) {
        console.error('Failed to save metadata:', error);
    }
}

/**
 * Get book metadata from storage
 */
export async function getBookMetadata<T>(id: string): Promise<T | null> {
    try {
        const data = await get<T>(`${METADATA_STORE}-${id}`);
        return data ?? null;
    } catch (error) {
        console.error('Failed to get metadata:', error);
        return null;
    }
}

/**
 * Get storage stats
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
        console.log('[Storage] Saved cover for book:', bookId, 'size:', dataUrl.length);
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
