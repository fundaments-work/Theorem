
import { isTauri } from "./env";
import { sqliteSetBlob, sqliteGetBlob } from "./sqlite-storage";

const LOCATIONS_PREFIX = "locations:";

function locationsKey(bookId: string): string {
    return `${LOCATIONS_PREFIX}${bookId}`;
}

export function persistBookLocations(bookId: string, locations: string): void {
    if (!isTauri() || !locations) return;
    const bytes = new TextEncoder().encode(locations);
    sqliteSetBlob(locationsKey(bookId), bytes.buffer).catch(e => console.error("[catch]", e));
}

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

export function deleteBookLocations(bookId: string): void {
    if (!isTauri()) return;
    import("./sqlite-storage").then(({ sqliteDeleteBlob }) => {
        sqliteDeleteBlob(locationsKey(bookId)).catch(e => console.error("[catch]", e));
    });
}
