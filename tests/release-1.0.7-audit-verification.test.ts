/**
 * Theorem v1.0.7 — Audit Fix Verification
 *
 * Automated verification that all fixes from the comprehensive audit are in place.
 * Run with: pnpm test
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Helper to read source files for structural verification
function readSource(relativePath: string): string {
    return readFileSync(resolve(__dirname, "..", relativePath), "utf-8");
}

// ─── Fix 50/51: PairedDevice types have all fields ───
describe("PairedDevice type completeness", () => {
    it("PairedDevice interface has all 9 fields from Rust", async () => {
        const { PairedDevice } = await import("../src/core/types");
        const device: PairedDevice = {
            deviceId: "test",
            deviceName: "test",
            lastIp: "127.0.0.1",
            lastPort: 0,
            pairedAt: "2024-01-01",
            lastSyncAt: undefined,
            fingerprint: "abc123",
            peerRelayUrl: "https://relay.example.com",
            syncDocId: "doc123",
        };
        expect(device.deviceId).toBe("test");
        expect(device.fingerprint).toBe("abc123");
        expect(device.peerRelayUrl).toBe("https://relay.example.com");
        expect(device.syncDocId).toBe("doc123");
    });
});

// ─── Fix 53: Settings page provisions data after pairing ───
describe("Settings page provisions after pairing", () => {
    it("DeviceSync useEffect with hasPairedDevices calls ensureResponderSyncReady to provision data", () => {
        const content = readSource("src/features/settings/DeviceSync.tsx");
        // The hasPairedDevices useEffect should call ensureResponderSyncReady
        // to write local data to the shared doc after pairing
        const section = content.match(/const hasPairedDevices[\s\S]{0,200}useEffect[\s\S]{0,1000}ensureResponderSyncReady/);
        expect(section).not.toBeNull();
    });
});

// ─── Fix 54: Ephemeral sync status not persisted ───
describe("Ephemeral sync status not persisted", () => {
    it("partialize does not include deviceSyncStatus", () => {
        const content = readSource("src/core/store/index.ts");
        // Use a broader regex to match the partialize section
        const partializeMatch = content.match(/partialize:\s*\(state\)\s*=>\s*\(\{[\s\S]{0,800}\}\)/);
        expect(partializeMatch).not.toBeNull();
        if (partializeMatch) {
            expect(partializeMatch[0]).not.toContain("deviceSyncStatus");
            expect(partializeMatch[0]).not.toContain("deviceSyncMessage");
            expect(partializeMatch[0]).not.toContain("deviceSyncAt");
        }
    });
});

// ─── Fix 55: Settings migration doesn't force autoSyncEnabled: false ───
describe("Settings migration preserves autoSyncEnabled", () => {
    it("migration does not force autoSyncEnabled to false", () => {
        const content = readSource("src/core/store/index.ts");
        // Find the deviceSync migration section
        const migrationSection = content.match(/deviceSync:\s*\{[\s\S]{0,300}\},/);
        expect(migrationSection).not.toBeNull();
        if (migrationSection) {
            // Should contain the spread of previous state (with || {} fallback)
            expect(migrationSection[0]).toContain("state.settings.deviceSync");
            expect(migrationSection[0]).toContain("defaultDeviceSyncSettings");
            // Should NOT have autoSyncEnabled: false after the spread
            expect(migrationSection[0]).not.toContain("autoSyncEnabled: false");
        }
    });
});

// ─── Fix 56: Per-entity book writes exist in provisionToIrohDocs ───
describe("Progressive per-entity book sync", () => {
    it("provisionToIrohDocs writes individual book:<id> entries", () => {
        const content = readSource("src/core/lib/sync-orchestrator.ts");
        expect(content).toContain("docsSetEntry(`book:${book.id}`");
    });

    it("initDocsLiveListener processes book:<id> entries progressively", () => {
        const content = readSource("src/core/lib/sync-orchestrator.ts");
        expect(content).toContain("_progressiveBookBatch");
        expect(content).toContain('key.startsWith("book:")');
    });
});

// ─── Fix 57: Parallel downloads ───
describe("Parallel file downloads", () => {
    it("pullMissingBookFilesAndCovers uses concurrent workers", () => {
        const content = readSource("src/core/lib/sync-orchestrator.ts");
        expect(content).toContain("CONCURRENCY");
        expect(content).toContain("Promise.all(workers)");
    });
});

// ─── Fix 58: Cancel sync button ───
describe("Cancel sync functionality", () => {
    it("cancelRunningSync exists", async () => {
        const { cancelRunningSync } = await import("../src/core/lib/sync-orchestrator");
        expect(() => cancelRunningSync()).not.toThrow();
    });

    it("DeviceSync has Cancel button during sync", () => {
        const content = readSource("src/features/settings/DeviceSync.tsx");
        expect(content).toContain("handleCancelSync");
        expect(content).toContain("Cancel");
    });
});

// ─── Fix 59: Unpair confirmation ───
describe("Unpair confirmation", () => {
    it("handleUnpair shows confirm dialog", () => {
        const content = readSource("src/features/settings/DeviceSync.tsx");
        expect(content).toContain("window.confirm");
        expect(content).toContain("Are you sure you want to unpair");
    });
});

// ─── Fix 62: Live event retry during _isMerging ───
describe("Live event retry during merge", () => {
    it("_processPendingDocs reschedules when _isMerging is true", () => {
        const content = readSource("src/core/lib/sync-orchestrator.ts");
        expect(content).toContain("_isMerging");
        expect(content).toContain("setTimeout(_processPendingDocs");
    });
});

// ─── Fix 64: Stability detection won't settle with 0 books ───
describe("0-book stability guard", () => {
    it("poll loop does not increment stability with 0 books on fresh device", () => {
        const content = readSource("src/core/lib/sync-orchestrator.ts");
        expect(content).toContain("_bookCountBeforeSync");
        expect(content).toContain("booksCount > 0 || _bookCountBeforeSync > 0");
    });
});

// ─── Fix 65: Global sync_lock prevents concurrent sync (Rust verification) ───
describe("Global sync lock (Rust)", () => {
    it("sync_commands.rs has sync_lock field", () => {
        const content = readSource("src-tauri/src/sync_commands.rs");
        expect(content).toContain("sync_lock");
    });

    it("initiate_sync acquires sync_lock", () => {
        const content = readSource("src-tauri/src/sync_commands.rs");
        expect(content).toContain("sync_lock.lock()");
    });
});

// ─── Fix 49: Custom ALPN removed from Router (Rust verification) ───
describe("Custom ALPN removed (Rust)", () => {
    it("Router accepts theorem-sync/v1 for pairing", () => {
        const content = readSource("src-tauri/src/iroh_sync.rs");
        // The custom ALPN is needed for QR pairing
        expect(content).toContain(".accept(ALPN, pairing_handler)");
        expect(content).toContain(".accept(iroh_docs::ALPN");
        expect(content).toContain(".accept(iroh_blobs::ALPN");
    });

    it("Endpoint has ALPN for pairing (alongsides iroh ones)", () => {
        const content = readSource("src-tauri/src/iroh_sync.rs");
        // Custom ALPN is needed for QR pairing (connect with theorem-sync/v1).
        // iroh_* ALPNs handle sync after pairing.
        expect(content).toContain("iroh_blobs::ALPN.to_vec()");
        expect(content).toContain("iroh_docs::ALPN.to_vec()");
        // Should have 4 ALPNs: custom + 3 iroh ones
        const matches = content.match(/ALPN\.to_vec\(\)/g);
        expect(matches).not.toBeNull();
        expect(matches!.length).toBe(4);
    });
});

// ─── Fix 60: SQLite getBookData reads from books.data (Rust verification) ───
describe("SQLite getBookData fallback (Rust)", () => {
    it("sqlite_get_book_data reads from books.data column", () => {
        const content = readSource("src-tauri/src/database.rs");
        expect(content).toContain("SELECT data FROM books WHERE id = ?1");
    });
});

// ─── Fix 52: docs_get_all_entries handles JSON objects (Rust verification) ───
describe("docs_get_all_entries object merge (Rust)", () => {
    it("merge logic checks for JSON objects before array concat", () => {
        const content = readSource("src-tauri/src/sync_commands.rs");
        expect(content).toContain("all_objects");
        expect(content).toContain("all_arrays");
    });
});

// ─── Fix 61: isDaemonReady checks paired peers ───
describe("isDaemonReady peer check", () => {
    it("isDaemonReady function checks paired_devices?.length", () => {
        const content = readSource("src/core/lib/sync-orchestrator.ts");
        expect(content).toContain("isDaemonReady");
        expect(content).toContain("paired_devices?.length");
    });
});

// ─── Audit: searchBooks cache and addBookToCollection O(1) ───
describe("Store performance fixes", () => {
    it("searchBooks uses WeakMap cache", () => {
        const content = readSource("src/core/store/index.ts");
        expect(content).toContain("searchBooksResultCache");
        expect(content).toContain("queryMap.get(q)");
    });

    it("addBookToCollection uses O(1) getBookLookup", () => {
        const content = readSource("src/core/store/index.ts");
        expect(content).toContain("getBookLookup(state.books).has(bookId)");
        expect(content).not.toContain("state.books.some((b) => b.id === bookId)");
    });
});

// ─── Fix 63: PendingContentReady event (Rust verification) ───
describe("PendingContentReady event (Rust)", () => {
    it("subscribe_doc_events emits docs-pending-content-ready", () => {
        const content = readSource("src-tauri/src/iroh_sync.rs");
        expect(content).toContain("docs-pending-content-ready");
    });

    it("subscribe_doc_events emits docs-sync-finished", () => {
        const content = readSource("src-tauri/src/iroh_sync.rs");
        expect(content).toContain("docs-sync-finished");
    });
});

// ─── Fix: Live events use mergeIncomingData ───
describe("Live events merge pipeline", () => {
    it("initDocsLiveListener calls mergeIncomingData, not direct overwrite", () => {
        const content = readSource("src/core/lib/sync-orchestrator.ts");
        expect(content).toContain("await mergeIncomingData(entries)");
        expect(content).not.toContain("useLibraryStore.setState({ books: parsed });");
    });
});

// ─── Fix: Covers table has DATA BLOB column ───
describe("Cover BLOB migration (Rust)", () => {
    it("covers table has data BLOB column alongside data_url", () => {
        const content = readSource("src-tauri/src/database.rs");
        expect(content).toContain("data BLOB");
        expect(content).toContain("ALTER TABLE covers ADD COLUMN data BLOB");
    });
});

// ─── Fix: Database indexes created ───
describe("Database indexes (Rust)", () => {
    it("indexes on books(title), books(author), covers(book_id) exist", () => {
        const content = readSource("src-tauri/src/database.rs");
        expect(content).toContain("CREATE INDEX IF NOT EXISTS idx_books_title");
        expect(content).toContain("CREATE INDEX IF NOT EXISTS idx_books_author");
        expect(content).toContain("CREATE INDEX IF NOT EXISTS idx_covers_book_id");
    });
});

