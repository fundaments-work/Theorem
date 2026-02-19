import { isTauri } from './env';
import { invoke } from '@tauri-apps/api/core';

export interface SqliteStorageStats {
    total_books: number;
    total_size: number;
    covers_size: number;
    binaries_size: number;
    blob_entries: number;
    blob_size: number;
    idb_books: number;
    tauri_books: number;
}

export interface SqliteCleanupResult {
    removed_books: number;
    removed_covers: number;
    removed_metadata: number;
}

export interface SqliteBlobStats {
    count: number;
    total_size: number;
}

async function getInvoke() {
    if (!isTauri()) {
        throw new Error('SQLite storage commands are only available in Tauri runtime.');
    }
    return invoke;
}

export async function sqliteSaveBookData(id: string, data: ArrayBuffer): Promise<string> {
    const invoke = await getInvoke();
    return invoke('sqlite_save_book_data', { id, data: new Uint8Array(data) }) as Promise<string>;
}

export async function sqliteGetBookData(id: string): Promise<ArrayBuffer | null> {
    const invoke = await getInvoke();
    const result = await invoke('sqlite_get_book_data', { id }) as number[] | null;
    if (!result) {
        return null;
    }
    return new Uint8Array(result).buffer;
}

export async function sqliteDeleteBookData(id: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke('sqlite_delete_book_data', { id });
}

export async function sqliteGetMaterializedBookPath(id: string): Promise<string | null> {
    const invoke = await getInvoke();
    return invoke('sqlite_get_materialized_book_path', { id }) as Promise<string | null>;
}

export async function sqliteSaveCoverImage(bookId: string, dataUrl: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke('sqlite_save_cover_image', {
        bookId,
        book_id: bookId,
        dataUrl,
        data_url: dataUrl,
    });
}

export async function sqliteGetCoverImage(bookId: string): Promise<string | null> {
    const invoke = await getInvoke();
    return invoke('sqlite_get_cover_image', {
        bookId,
        book_id: bookId,
    }) as Promise<string | null>;
}

export async function sqliteDeleteCoverImage(bookId: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke('sqlite_delete_cover_image', {
        bookId,
        book_id: bookId,
    });
}

export async function sqliteGetStorageStats(): Promise<SqliteStorageStats> {
    const invoke = await getInvoke();
    return invoke('sqlite_get_storage_stats') as Promise<SqliteStorageStats>;
}

export async function sqliteCleanupOrphanedStorage(existingBookIds: string[]): Promise<SqliteCleanupResult> {
    const invoke = await getInvoke();
    return invoke('sqlite_cleanup_orphaned_storage', {
        existingBookIds,
        existing_book_ids: existingBookIds,
    }) as Promise<SqliteCleanupResult>;
}

export async function sqliteClearAllStorage(): Promise<void> {
    const invoke = await getInvoke();
    await invoke('sqlite_clear_all_storage');
}

export async function sqliteGetKv(key: string): Promise<string | null> {
    const invoke = await getInvoke();
    return invoke('sqlite_get_kv', { key }) as Promise<string | null>;
}

export async function sqliteSetKv(key: string, value: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke('sqlite_set_kv', { key, value });
}

export async function sqliteDeleteKv(key: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke('sqlite_delete_kv', { key });
}

export async function sqliteCountKvByPrefix(prefix: string): Promise<number> {
    const invoke = await getInvoke();
    return invoke('sqlite_count_kv_by_prefix', { prefix }) as Promise<number>;
}

export async function sqliteDeleteKvByPrefix(prefix: string): Promise<number> {
    const invoke = await getInvoke();
    return invoke('sqlite_delete_kv_by_prefix', { prefix }) as Promise<number>;
}

export async function sqliteSetBlob(key: string, data: ArrayBuffer): Promise<void> {
    const invoke = await getInvoke();
    await invoke('sqlite_set_blob', { key, data: new Uint8Array(data) });
}

export async function sqliteGetBlob(key: string): Promise<ArrayBuffer | null> {
    const invoke = await getInvoke();
    const result = await invoke('sqlite_get_blob', { key }) as number[] | null;
    if (!result) {
        return null;
    }
    return new Uint8Array(result).buffer;
}

export async function sqliteDeleteBlob(key: string): Promise<void> {
    const invoke = await getInvoke();
    await invoke('sqlite_delete_blob', { key });
}

export async function sqliteDeleteBlobsByPrefix(prefix: string): Promise<number> {
    const invoke = await getInvoke();
    return invoke('sqlite_delete_blobs_by_prefix', { prefix }) as Promise<number>;
}

export async function sqliteGetBlobStats(prefix?: string): Promise<SqliteBlobStats> {
    const invoke = await getInvoke();
    return invoke('sqlite_get_blob_stats', {
        prefix: prefix ?? null,
    }) as Promise<SqliteBlobStats>;
}
