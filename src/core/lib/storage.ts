/**
 * Storage Utilities
 * SQLite-first storage in Tauri with IndexedDB web fallback.
 */

import { get, set, del } from 'idb-keyval';
import { isTauri } from './env';
import {
    sqliteDeleteBookData,
    sqliteDeleteCoverImage,
    sqliteGetBookData,
    sqliteGetCoverImage,
    sqliteGetMaterializedBookPath,
    sqliteSaveBookData,
    sqliteSaveCoverImage,
} from './sqlite-storage';
import { normalizeFilePath } from './utils';

const STORE_NAME = 'theorem-books';
const COVERS_STORE = 'theorem-covers';
const BLOB_CACHE_LIMIT = 3;
const STORAGE_READ_TIMEOUT_MS = 30000;

let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null;

const blobCache = new Map<string, Blob>();
const pendingDataReads = new Map<string, Promise<ArrayBuffer | null>>();
const pendingBlobReads = new Map<string, Promise<Blob | null>>();
const materializedPathCache = new Map<string, string>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    return Promise.race([
        promise,
        new Promise<T>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`[Storage] Timed out while ${label}.`));
            }, timeoutMs);
        }),
    ]).finally(() => {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    });
}

function getStorageKey(id: string, filePath?: string): string {
    if (filePath) {
        return filePath;
    }
    return `sqlite://${id}`;
}

function getMimeTypeFromPath(filePath?: string): string {
    const ext = filePath
        ? normalizeFilePath(filePath).split(/[?#]/, 1)[0].toLowerCase().split('.').pop()
        : undefined;
    if (ext === 'pdf') {
        return 'application/pdf';
    }
    if (ext === 'epub') {
        return 'application/epub+zip';
    }
    return 'application/octet-stream';
}

function resolveSqliteBookId(id: string, filePath?: string): string | null {
    if (filePath?.startsWith('sqlite://')) {
        const parsed = filePath.slice('sqlite://'.length);
        return parsed || null;
    }
    if (id.trim()) {
        return id;
    }
    return null;
}

function resolveIndexedDbBookId(id: string, filePath?: string): string | null {
    if (filePath?.startsWith('idb://')) {
        const parsed = filePath.slice('idb://'.length);
        return parsed || null;
    }
    if (id.trim()) {
        return id;
    }
    return null;
}

function isExternalFilePath(filePath?: string): boolean {
    if (!filePath) {
        return false;
    }

    return !filePath.startsWith('sqlite://')
        && !filePath.startsWith('idb://')
        && !filePath.startsWith('browser://')
        && !filePath.startsWith('content://');
}

function getCachedBlob(cacheKey: string): Blob | null {
    const cached = blobCache.get(cacheKey);
    if (!cached) {
        return null;
    }

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
    blobCache.delete(`sqlite://${id}`);
    materializedPathCache.delete(id);
}

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

async function readExternalFile(path: string): Promise<ArrayBuffer | null> {
    const fs = await getTauriFs();
    if (!fs) {
        return null;
    }

    try {
        const contents = await withTimeout(
            fs.readFile(path),
            STORAGE_READ_TIMEOUT_MS,
            `reading external file '${path}'`,
        );
        if (contents instanceof Uint8Array) {
            return contents.buffer.slice(
                contents.byteOffset,
                contents.byteOffset + contents.byteLength,
            );
        }
        if (contents instanceof ArrayBuffer) {
            return contents;
        }
        if (Array.isArray(contents)) {
            return new Uint8Array(contents).buffer;
        }
        return null;
    } catch (error) {
        console.error('[Storage] Failed to read external file path:', path, error);
        return null;
    }
}

export async function getBookMaterializedPath(id: string, filePath?: string): Promise<string | null> {
    const normalizedPath = filePath ? normalizeFilePath(filePath) : undefined;
    if (normalizedPath && isExternalFilePath(normalizedPath)) {
        return normalizedPath;
    }

    if (!isTauri()) {
        return null;
    }

    const sqliteBookId = resolveSqliteBookId(id, normalizedPath);
    if (!sqliteBookId) {
        return null;
    }

    const cachedPath = materializedPathCache.get(sqliteBookId);
    if (cachedPath) {
        return cachedPath;
    }

    try {
        const materializedPath = await withTimeout(
            sqliteGetMaterializedBookPath(sqliteBookId),
            STORAGE_READ_TIMEOUT_MS,
            `resolving materialized SQLite path for '${sqliteBookId}'`,
        );
        if (materializedPath) {
            materializedPathCache.set(sqliteBookId, materializedPath);
            return materializedPath;
        }
    } catch (error) {
        console.error('[Storage] Failed to resolve materialized SQLite book path:', error);
    }

    return null;
}

/**
 * Save book data to storage.
 * - Tauri: SQLite (primary)
 * - Web: IndexedDB
 */
export async function saveBookData(id: string, data: ArrayBuffer): Promise<string> {
    clearBlobCacheForBook(id);

    if (isTauri()) {
        try {
            const storagePath = await sqliteSaveBookData(id, data);
            return storagePath;
        } catch (error) {
            console.error('[Storage] Failed to persist binary to SQLite:', error);
        }
    }

    try {
        await set(`${STORE_NAME}-${id}`, data);
        return `idb://${id}`;
    } catch (error) {
        console.error('[Storage] Failed to save book data to IndexedDB:', error);
        throw error;
    }
}

/**
 * Get book data from storage as ArrayBuffer.
 */
export async function getBookData(id: string, filePath?: string): Promise<ArrayBuffer | null> {
    const cacheKey = getStorageKey(id, filePath);
    const pendingRead = pendingDataReads.get(cacheKey);
    if (pendingRead) {
        return pendingRead;
    }

    const readPromise = (async () => {
        const normalizedPath = filePath ? normalizeFilePath(filePath) : undefined;
        const sqliteBookId = resolveSqliteBookId(id, normalizedPath);

        // Prefer direct file-system reads for source paths to avoid expensive
        // SQLite->JS binary marshalling when a readable path is available.
        if (isTauri() && normalizedPath && isExternalFilePath(normalizedPath)) {
            const externalData = await readExternalFile(normalizedPath);
            if (externalData && externalData.byteLength > 0) {
                return externalData;
            }
        }

        if (isTauri() && sqliteBookId) {
            try {
                const materializedPath = await getBookMaterializedPath(sqliteBookId);
                if (materializedPath) {
                    const materializedData = await readExternalFile(materializedPath);
                    if (materializedData && materializedData.byteLength > 0) {
                        return materializedData;
                    }
                }
            } catch (error) {
                console.error('[Storage] Failed to read materialized SQLite book path:', error);
            }

            try {
                const sqliteData = await withTimeout(
                    sqliteGetBookData(sqliteBookId),
                    STORAGE_READ_TIMEOUT_MS,
                    `reading SQLite blob for '${sqliteBookId}'`,
                );
                if (sqliteData && sqliteData.byteLength > 0) {
                    return sqliteData;
                }
            } catch (error) {
                console.error('[Storage] Failed to read binary from SQLite:', error);
            }
        }

        const indexedDbId = resolveIndexedDbBookId(id, normalizedPath);
        if (!indexedDbId) {
            return null;
        }

        try {
            const data = await withTimeout(
                get<ArrayBuffer>(`${STORE_NAME}-${indexedDbId}`),
                STORAGE_READ_TIMEOUT_MS,
                `reading IndexedDB payload for '${indexedDbId}'`,
            );
            return data ?? null;
        } catch (error) {
            console.error('[Storage] Failed to read book data from IndexedDB:', error);
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
 * Get book data as a Blob.
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
        const data = await withTimeout(
            getBookData(id, filePath),
            STORAGE_READ_TIMEOUT_MS,
            `loading book data for '${id || filePath || 'unknown'}'`,
        );
        if (!data) {
            return null;
        }

        const mimeType = getMimeTypeFromPath(filePath);
        return new Blob([data], { type: mimeType });
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
 * Delete book data from storage.
 */
export async function deleteBookData(id: string, filePath?: string): Promise<void> {
    clearBlobCacheForBook(id, filePath);

    const normalizedPath = filePath ? normalizeFilePath(filePath) : undefined;
    const sqliteBookId = resolveSqliteBookId(id, normalizedPath);
    if (isTauri() && sqliteBookId) {
        try {
            await sqliteDeleteBookData(sqliteBookId);
        } catch (error) {
            console.error('[Storage] Failed to delete book from SQLite:', error);
        }
    }

    const indexedDbId = resolveIndexedDbBookId(id, normalizedPath);
    if (indexedDbId) {
        try {
            await del(`${STORE_NAME}-${indexedDbId}`);
        } catch (error) {
            console.error('[Storage] Failed to delete book from IndexedDB:', error);
        }
    }
}

async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Save cover image as data URL.
 */
export async function saveCoverImage(bookId: string, blob: Blob): Promise<string> {
    const dataUrl = await blobToDataUrl(blob);

    if (isTauri()) {
        try {
            await sqliteSaveCoverImage(bookId, dataUrl);
            return dataUrl;
        } catch (error) {
            console.error('[Storage] Failed to save cover image to SQLite, falling back to IndexedDB:', error);
        }
    }

    try {
        await set(`${COVERS_STORE}-${bookId}`, dataUrl);
        return dataUrl;
    } catch (error) {
        console.error('[Storage] Failed to save cover image fallback:', error);
        throw error;
    }
}

/**
 * Get cover image data URL.
 */
export async function getCoverImage(bookId: string): Promise<string | null> {
    if (isTauri()) {
        try {
            const cover = await sqliteGetCoverImage(bookId);
            if (cover) {
                return cover;
            }
        } catch (error) {
            console.error('[Storage] Failed to read cover from SQLite:', error);
        }
    }

    try {
        const dataUrl = await get<string>(`${COVERS_STORE}-${bookId}`);
        return dataUrl ?? null;
    } catch (error) {
        console.error('[Storage] Failed to get cover image from IndexedDB:', error);
        return null;
    }
}

/**
 * Delete cover image.
 */
export async function deleteCoverImage(bookId: string): Promise<void> {
    if (isTauri()) {
        try {
            await sqliteDeleteCoverImage(bookId);
        } catch (error) {
            console.error('[Storage] Failed to delete cover image from SQLite:', error);
        }
    }

    try {
        await del(`${COVERS_STORE}-${bookId}`);
    } catch (error) {
        console.error('[Storage] Failed to delete cover image from IndexedDB:', error);
    }
}
