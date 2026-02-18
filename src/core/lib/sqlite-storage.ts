import { isTauri } from './env';

export interface SqliteStorageStats {
    total_books: number;
    total_size: number;
    covers_size: number;
    binaries_size: number;
    idb_books: number;
    tauri_books: number;
}

export interface SqliteCleanupResult {
    removed_books: number;
    removed_covers: number;
    removed_metadata: number;
}

let tauriInvoke: ((command: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

async function getInvoke() {
    if (!isTauri()) {
        throw new Error('SQLite storage commands are only available in Tauri runtime.');
    }

    if (!tauriInvoke) {
        const { invoke } = await import('@tauri-apps/api/core');
        tauriInvoke = invoke;
    }

    return tauriInvoke;
}

export async function sqliteSaveBookData(id: string, data: ArrayBuffer): Promise<string> {
    const invoke = await getInvoke();
    const bytes = Array.from(new Uint8Array(data));
    return invoke('sqlite_save_book_data', { id, data: bytes }) as Promise<string>;
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
