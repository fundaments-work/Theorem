/**
 * Theorem — Book Locations Persistence
 *
 * Stores foliate-js position data (book.locations) in SQLite BLOB storage
 * per-book, keeping it out of Zustand persist/sync payloads.
 */
import { isTauri } from "./env";
import { sqliteSetBlob, sqliteGetBlob } from "./sqlite-storage";

const LOCATIONS_PREFIX = "locations:";

function locationsKey(bookId: string): string {
    return `${LOCATIONS_PREFIX}${bookId}`;
}

/** Persist a book's locations to SQLite (fire-and-forget). */
export function persistBookLocations(bookId: string, locations: string): void {
    if (!isTauri() || !locations) return;
    const bytes = new TextEncoder().encode(locations);
    sqliteSetBlob(locationsKey(bookId), bytes.buffer).catch(e => console.error("[catch]", e));
}

/** Load a book's locations from SQLite. Returns null if not in Tauri or not found. */
export async function loadBookLocations(bookId: string): Promise<string | null> {
    if (!isTauri()) return null;
    try {
        const buf = await sqliteGetBlob(locationsKey(bookId));
        if (!buf) return null;
        return new TextDecoder().decode(buf);
    } catch {
        return null;
    }
}

/** Delete a book's locations from SQLite (called when book is removed). */
export function deleteBookLocations(bookId: string): void {
    if (!isTauri()) return;
    import("./sqlite-storage").then(({ sqliteDeleteBlob }) => {
        sqliteDeleteBlob(locationsKey(bookId)).catch(e => console.error("[catch]", e));
    });
}
