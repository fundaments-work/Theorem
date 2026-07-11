/**
 * Storage management utilities.
 *
 * Tauri runtime:
 * - books/covers/state are handled by SQLite commands.
 * Web fallback:
 * - IndexedDB key scanning.
 */

import { get, del, keys } from 'idb-keyval';
import { isTauri } from './env';
import {
    sqliteCountKvByPrefix,
    sqliteDeleteBlobsByPrefix,
    sqliteDeleteKvByPrefix,
    sqliteGetBlobStats,
    sqliteCleanupOrphanedStorage,
    sqliteClearAllStorage,
    sqliteDeleteBookData,
    sqliteDeleteCoverImage,
    sqliteDeleteKv,
    sqliteGetKv,
    sqliteGetStorageStats,
} from './sqlite-storage';

const STORE_NAME = 'theorem-books';
const COVERS_STORE = 'theorem-covers';
const METADATA_STORE = 'theorem-metadata';
const STARDICT_PREFIX = 'theorem-stardict';

function hasIndexedDbSupport(): boolean {
    return typeof indexedDB !== 'undefined';
}

async function getIndexedDBKeysByPrefix(prefix: string): Promise<string[]> {
    if (!hasIndexedDbSupport()) {
        return [];
    }

    try {
        const allKeys = await keys();
        return allKeys.filter((key): key is string => (
            typeof key === 'string' && key.startsWith(prefix)
        ));
    } catch (error) {
        return [];
    }
}

async function getIndexedDBKeySize(key: string): Promise<number> {
    try {
        const value = await get(key);
        if (value == null) return 0;

        if (typeof value === 'string') {
            return new Blob([value]).size;
        }
        if (value instanceof ArrayBuffer) {
            return value.byteLength;
        }
        if (value instanceof Uint8Array) {
            return value.byteLength;
        }

        return new Blob([JSON.stringify(value)]).size;
    } catch {
        return 0;
    }
}

export async function deleteBookStorage(bookId: string): Promise<void> {
    if (isTauri()) {
        await Promise.allSettled([
            sqliteDeleteBookData(bookId),
            sqliteDeleteCoverImage(bookId),
        ]);
        return;
    }

    if (!hasIndexedDbSupport()) {
        return;
    }

    await Promise.allSettled([
        del(`${STORE_NAME}-${bookId}`),
        del(`${COVERS_STORE}-${bookId}`),
        del(`${METADATA_STORE}-${bookId}`),
    ]);
}

export async function getBookStorageStats(): Promise<{
    totalBooks: number;
    totalSize: number;
    coversSize: number;
    binariesSize: number;
    idbBooks: number;
    tauriBooks: number;
}> {
    if (isTauri()) {
        try {
            const sqliteStats = await sqliteGetStorageStats();
            return {
                totalBooks: sqliteStats.total_books,
                totalSize: sqliteStats.binaries_size + sqliteStats.covers_size,
                coversSize: sqliteStats.covers_size,
                binariesSize: sqliteStats.binaries_size,
                idbBooks: sqliteStats.idb_books,
                tauriBooks: sqliteStats.tauri_books,
            };
        } catch (error) {
        }
    }

    const bookKeys = await getIndexedDBKeysByPrefix(`${STORE_NAME}-`);
    const coverKeys = await getIndexedDBKeysByPrefix(`${COVERS_STORE}-`);

    const [binariesSizes, coversSizes] = await Promise.all([
        Promise.all(bookKeys.map((key) => getIndexedDBKeySize(key))),
        Promise.all(coverKeys.map((key) => getIndexedDBKeySize(key))),
    ]);

    const binariesSize = binariesSizes.reduce((sum, s) => sum + s, 0);
    const coversSize = coversSizes.reduce((sum, s) => sum + s, 0);

    return {
        totalBooks: bookKeys.length,
        totalSize: binariesSize + coversSize,
        coversSize,
        binariesSize,
        idbBooks: bookKeys.length,
        tauriBooks: 0,
    };
}

export async function getRssStorageStats(): Promise<{
    articleCount: number;
    totalSize: number;
}> {
    if (isTauri()) {
        const serialized = await sqliteGetKv('zustand:theorem-rss');
        if (!serialized) {
            return {
                articleCount: 0,
                totalSize: 0,
            };
        }

        let articleCount = 0;
        try {
            const parsed = JSON.parse(serialized) as {
                state?: { articles?: unknown[] };
            };
            articleCount = Array.isArray(parsed?.state?.articles)
                ? parsed.state.articles.length
                : 0;
        } catch {
            articleCount = 0;
        }

        return {
            articleCount,
            totalSize: new Blob([serialized]).size,
        };
    }

    const rssKeys = await getIndexedDBKeysByPrefix('theorem-rss-');
    const sizes = await Promise.all(rssKeys.map((key) => getIndexedDBKeySize(key)));
    const totalSize = sizes.reduce((sum, s) => sum + s, 0);

    return {
        articleCount: rssKeys.length,
        totalSize,
    };
}

export async function getStarDictStorageStats(): Promise<{
    dictionaryCount: number;
    totalSize: number;
}> {
    if (isTauri()) {
        const [blobStats, dictionaryCount] = await Promise.all([
            sqliteGetBlobStats(`${STARDICT_PREFIX}:`),
            sqliteCountKvByPrefix(`${STARDICT_PREFIX}:`),
        ]);

        return {
            dictionaryCount,
            totalSize: blobStats.total_size,
        };
    }

    const dictionaryKeys = await getIndexedDBKeysByPrefix(`${STARDICT_PREFIX}:`);
    const sizes = await Promise.all(dictionaryKeys.map((key) => getIndexedDBKeySize(key)));
    const totalSize = sizes.reduce((sum, s) => sum + s, 0);

    return {
        dictionaryCount: dictionaryKeys.length / 4,
        totalSize,
    };
}

export async function clearAllStarDictDictionaries(): Promise<void> {
    if (isTauri()) {
        await Promise.allSettled([
            sqliteDeleteBlobsByPrefix(`${STARDICT_PREFIX}:`),
            sqliteDeleteKvByPrefix(`${STARDICT_PREFIX}:`),
        ]);
        return;
    }

    const dictionaryKeys = await getIndexedDBKeysByPrefix(`${STARDICT_PREFIX}:`);
    await Promise.all(dictionaryKeys.map((key) => del(key)));
}

export async function clearAllBookBinaries(): Promise<void> {
    if (isTauri()) {
        await sqliteCleanupOrphanedStorage([]);
        return;
    }

    const bookKeys = await getIndexedDBKeysByPrefix(`${STORE_NAME}-`);
    await Promise.all(bookKeys.map((key) => del(key)));
}

export async function clearAllCovers(): Promise<void> {
    if (isTauri()) {
        await sqliteCleanupOrphanedStorage([]);
        return;
    }

    const coverKeys = await getIndexedDBKeysByPrefix(`${COVERS_STORE}-`);
    await Promise.all(coverKeys.map((key) => del(key)));
}

export async function clearAllRssStorage(): Promise<void> {
    if (isTauri()) {
        await sqliteDeleteKv('zustand:theorem-rss');
        return;
    }

    const rssKeys = await getIndexedDBKeysByPrefix('theorem-rss-');
    await Promise.all(rssKeys.map((key) => del(key)));
}

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

export async function cleanupOrphanedStorage(existingBookIds: string[]): Promise<{
    removedBooks: number;
    removedCovers: number;
    removedMetadata: number;
}> {
    if (isTauri()) {
        const result = await sqliteCleanupOrphanedStorage(existingBookIds);
        return {
            removedBooks: result.removed_books,
            removedCovers: result.removed_covers,
            removedMetadata: result.removed_metadata,
        };
    }

    const [bookKeys, coverKeys, metadataKeys] = await Promise.all([
        getIndexedDBKeysByPrefix(`${STORE_NAME}-`),
        getIndexedDBKeysByPrefix(`${COVERS_STORE}-`),
        getIndexedDBKeysByPrefix(`${METADATA_STORE}-`),
    ]);

    const existingIds = new Set(existingBookIds);

    const collectOrphaned = (keys: string[], prefix: string): string[] =>
        keys.reduce<string[]>((acc, key) => {
            const id = key.replace(prefix, '');
            if (!existingIds.has(id)) acc.push(key);
            return acc;
        }, []);

    const orphanedBooks = collectOrphaned(bookKeys, `${STORE_NAME}-`);
    const orphanedCovers = collectOrphaned(coverKeys, `${COVERS_STORE}-`);
    const orphanedMetadata = collectOrphaned(metadataKeys, `${METADATA_STORE}-`);

    await Promise.all([
        Promise.all(orphanedBooks.map((key) => del(key))),
        Promise.all(orphanedCovers.map((key) => del(key))),
        Promise.all(orphanedMetadata.map((key) => del(key))),
    ]);

    return {
        removedBooks: orphanedBooks.length,
        removedCovers: orphanedCovers.length,
        removedMetadata: orphanedMetadata.length,
    };
}

export async function clearAllApplicationStorage(): Promise<void> {
    if (isTauri()) {
        await sqliteClearAllStorage();
    } else {
        await Promise.all([
            clearAllBookBinaries(),
            clearAllCovers(),
        ]);
    }

    await Promise.all([
        clearAllRssStorage(),
        clearAllStarDictDictionaries(),
    ]);

    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key.startsWith('theorem-')) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));

    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('theorem-')) {
            sessionKeysToRemove.push(key);
        }
    }
    sessionKeysToRemove.forEach((key) => sessionStorage.removeItem(key));
}
