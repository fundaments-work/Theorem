/**
 * Theorem – Device Sync Orchestrator
 *
 * End-to-end sync logic that:
 * 1. Collects a snapshot of all local Zustand stores
 * 2. Sends the snapshot to the Rust backend via IPC
 * 3. Initiates encrypted sync with a paired peer
 * 4. Receives incoming domain data from the peer
 * 5. Merges incoming data into local stores using LWW merge functions
 *
 * Supports progress callbacks and structured error reporting.
 */

import {
    setSyncData,
    initiateSync,
    startSyncServer,
    getIncomingSyncData,
    pullBookFiles,
} from "./device-sync";
import {
    useLibraryStore,
    useVocabularyStore,
    useRssStore,
    useUIStore,
    useSettingsStore,
} from "../store";
import type { DeviceSyncStatus } from "../types";
import {
    mergeBooks,
    mergeAnnotations,
    mergeCollections,
    mergeTombstones,
    mergeVocabulary,
    mergeRssFeeds,
    mergeRssArticles,
    mergeSettings,
    mergeReadingStats,
} from "./sync-import";
import { isTauri } from "./env";

// ─── Helpers ───

/** Compute SHA-256 hex digest of a string using SubtleCrypto. */
async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function computeLatestDate<T>(
    items: T[],
    dateSelector: (item: T) => Date | string | undefined | null,
): string {
    let latest = 0;
    for (const item of items) {
        const val = dateSelector(item);
        if (val) {
            const time = new Date(val as string | number).getTime();
            if (!Number.isNaN(time) && time > latest) {
                latest = time;
            }
        }
    }
    return latest > 0 ? new Date(latest).toISOString() : new Date(0).toISOString();
}

function setStatus(status: DeviceSyncStatus, msg?: string) {
    useUIStore.getState().setDeviceSyncStatus(status, msg);
}

/** Guards concurrent responder bootstrap attempts. */
let responderReadyPromise: Promise<void> | null = null;
/** Shared unlisten reference for the global responder event listener. */
let responderEventUnlisten: (() => void) | null = null;

// ─── Domain manifest builder ───

async function buildDomainsAndManifest() {
    const library = useLibraryStore.getState();
    const vocabulary = useVocabularyStore.getState();
    const rss = useRssStore.getState();
    const settingsStore = useSettingsStore.getState();

    // Garbage-collect expired tombstones before serialising.
    // mergeTombstones([], existing) is a no-op union that only prunes by TTL.
    const gcTombstones = mergeTombstones([], library.deletionTombstones);
    if (gcTombstones.length !== library.deletionTombstones.length) {
        useLibraryStore.setState({ deletionTombstones: gcTombstones });
    }

    // Build a settings payload that excludes device-specific settings.
    // Use the persisted settingsLastModifiedAt for LWW comparison
    // instead of generating "now" (which makes both sides look equally recent).
    const settingsUpdatedAt = settingsStore.settingsLastModifiedAt || new Date(0).toISOString();
    const { deviceSync: _excluded, ...syncableSettings } = settingsStore.settings;
    const settingsPayload = {
        ...syncableSettings,
        _settingsUpdatedAt: settingsUpdatedAt,
    };

    const domains: Record<string, string> = {
        books: JSON.stringify(library.books.map(({ coverPath: _, filePath: _f, storagePath: _s, ...book }) => book)),
        annotations: JSON.stringify(library.annotations),
        collections: JSON.stringify(library.collections),
        deletion_tombstones: JSON.stringify(gcTombstones),
        vocabulary: JSON.stringify(vocabulary.vocabularyTerms),
        settings: JSON.stringify(settingsPayload),
        reading_stats: JSON.stringify(settingsStore.stats),
        rss_feeds: JSON.stringify(rss.feeds),
        rss_articles: JSON.stringify(rss.articles),
    };

    // Compute SHA-256 content hashes for each domain in parallel.
    // When both sides have the same hash, the domain is skipped entirely.
    const domainNames = Object.keys(domains);
    const hashResults = await Promise.all(
        domainNames.map((name) => sha256Hex(domains[name])),
    );
    const contentHashes: Record<string, string> = {};
    for (let i = 0; i < domainNames.length; i++) {
        contentHashes[domainNames[i]] = hashResults[i];
    }

    const manifest: Record<string, { version: number; item_count: number; last_modified_at: string; content_hash: string }> = {
        books: {
            version: library.books.length,
            item_count: library.books.length,
            last_modified_at: computeLatestDate(library.books, b => b.lastReadAt || b.addedAt),
            content_hash: contentHashes["books"],
        },
        annotations: {
            version: library.annotations.length,
            item_count: library.annotations.length,
            last_modified_at: computeLatestDate(library.annotations, a => a.updatedAt || a.createdAt),
            content_hash: contentHashes["annotations"],
        },
        collections: {
            version: library.collections.length,
            item_count: library.collections.length,
            last_modified_at: computeLatestDate(library.collections, c => c.createdAt),
            content_hash: contentHashes["collections"],
        },
        deletion_tombstones: {
            version: gcTombstones.length,
            item_count: gcTombstones.length,
            last_modified_at: computeLatestDate(gcTombstones, t => t.deletedAt),
            content_hash: contentHashes["deletion_tombstones"],
        },
        vocabulary: {
            version: vocabulary.vocabularyTerms.length,
            item_count: vocabulary.vocabularyTerms.length,
            last_modified_at: computeLatestDate(vocabulary.vocabularyTerms, v => v.updatedAt || v.createdAt),
            content_hash: contentHashes["vocabulary"],
        },
        settings: {
            version: 1, // Settings is a single object, always version 1.
            item_count: 1,
            last_modified_at: settingsUpdatedAt,
            content_hash: contentHashes["settings"],
        },
        reading_stats: {
            version: 1,
            item_count: 1,
            last_modified_at: settingsStore.stats.lastReadDate ?? new Date(0).toISOString(),
            content_hash: contentHashes["reading_stats"],
        },
        rss_feeds: {
            version: rss.feeds.length,
            item_count: rss.feeds.length,
            last_modified_at: computeLatestDate(rss.feeds, f => f.lastFetched || f.addedAt),
            content_hash: contentHashes["rss_feeds"],
        },
        rss_articles: {
            version: rss.articles.length,
            item_count: rss.articles.length,
            last_modified_at: computeLatestDate(rss.articles, a => a.fetchedAt),
            content_hash: contentHashes["rss_articles"],
        },
    };

    return { domains, manifest, library, vocabulary, rss, settingsStore, settingsUpdatedAt };
}

// ─── Merge incoming data ───

function mergeIncomingData(
    incomingMap: Record<string, string>,
    localSettingsUpdatedAt?: string,
): { domainsUpdated: string[] } {
    const domainsUpdated: string[] = [];

    // ── Merge tombstones FIRST so books/annotations/collections can respect them ──
    let allTombstones = useLibraryStore.getState().deletionTombstones;

    if (incomingMap["deletion_tombstones"]) {
        try {
            const incoming = JSON.parse(incomingMap["deletion_tombstones"]);
            if (Array.isArray(incoming)) {
                allTombstones = mergeTombstones(incoming, allTombstones);
                useLibraryStore.setState({ deletionTombstones: allTombstones });
                domainsUpdated.push("deletion_tombstones");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge deletion_tombstones:", e);
        }
    }

    if (incomingMap["books"]) {
        try {
            const incoming = JSON.parse(incomingMap["books"]);
            if (Array.isArray(incoming)) {
                // Read fresh state to avoid overwriting concurrent user changes.
                const merged = mergeBooks(incoming, useLibraryStore.getState().books, allTombstones);
                useLibraryStore.setState({ books: merged });
                domainsUpdated.push("books");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge books:", e);
        }
    }

    if (incomingMap["annotations"]) {
        try {
            const incoming = JSON.parse(incomingMap["annotations"]);
            if (Array.isArray(incoming)) {
                const merged = mergeAnnotations(incoming, useLibraryStore.getState().annotations, allTombstones);
                useLibraryStore.setState({ annotations: merged });
                domainsUpdated.push("annotations");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge annotations:", e);
        }
    }

    if (incomingMap["collections"]) {
        try {
            const incoming = JSON.parse(incomingMap["collections"]);
            if (Array.isArray(incoming)) {
                const merged = mergeCollections(incoming, useLibraryStore.getState().collections, allTombstones);
                useLibraryStore.setState({ collections: merged });
                domainsUpdated.push("collections");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge collections:", e);
        }
    }

    if (incomingMap["vocabulary"]) {
        try {
            const incoming = JSON.parse(incomingMap["vocabulary"]);
            if (Array.isArray(incoming)) {
                const merged = mergeVocabulary(incoming, useVocabularyStore.getState().vocabularyTerms);
                useVocabularyStore.setState({ vocabularyTerms: merged });
                domainsUpdated.push("vocabulary");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge vocabulary:", e);
        }
    }

    if (incomingMap["settings"]) {
        try {
            const raw = JSON.parse(incomingMap["settings"]);
            const settingsStore = useSettingsStore.getState();
            // Extract the embedded timestamp, then reconstruct as AppSettings.
            const remoteUpdatedAt: string | undefined = raw._settingsUpdatedAt;
            const { _settingsUpdatedAt: _, ...remoteSettings } = raw;
            // Inject the local deviceSync back so mergeSettings receives a full AppSettings.
            const remoteAsAppSettings = {
                ...remoteSettings,
                deviceSync: settingsStore.settings.deviceSync,
            };
            const merged = mergeSettings(
                remoteAsAppSettings,
                settingsStore.settings,
                remoteUpdatedAt,
                localSettingsUpdatedAt,
            );
            useSettingsStore.setState({ settings: merged });
            domainsUpdated.push("settings");
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge settings:", e);
        }
    }

    if (incomingMap["reading_stats"]) {
        try {
            const incoming = JSON.parse(incomingMap["reading_stats"]);
            if (incoming && typeof incoming === "object") {
                const merged = mergeReadingStats(incoming, useSettingsStore.getState().stats);
                useSettingsStore.setState({ stats: merged });
                domainsUpdated.push("reading_stats");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge reading_stats:", e);
        }
    }

    // Track feedIdMap from mergeRssFeeds so we can remap article feedId references.
    let feedIdMap: Map<string, string> | undefined;

    if (incomingMap["rss_feeds"]) {
        try {
            const incoming = JSON.parse(incomingMap["rss_feeds"]);
            if (Array.isArray(incoming)) {
                const result = mergeRssFeeds(incoming, useRssStore.getState().feeds);
                useRssStore.setState({ feeds: result.feeds });
                feedIdMap = result.feedIdMap;
                domainsUpdated.push("rss_feeds");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge rss_feeds:", e);
        }
    }

    if (incomingMap["rss_articles"]) {
        try {
            const incoming = JSON.parse(incomingMap["rss_articles"]);
            if (Array.isArray(incoming)) {
                const merged = mergeRssArticles(incoming, useRssStore.getState().articles, feedIdMap);
                useRssStore.setState({ articles: merged });
                domainsUpdated.push("rss_articles");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge rss_articles:", e);
        }
    }

    // Recalculate feed unreadCounts after merging both feeds and articles,
    // since article read states may have changed via OR merge semantics.
    if (domainsUpdated.includes("rss_feeds") || domainsUpdated.includes("rss_articles")) {
        try {
            const currentRss = useRssStore.getState();
            const updatedFeeds = currentRss.feeds.map((feed) => ({
                ...feed,
                unreadCount: currentRss.articles.filter(
                    (a) => a.feedId === feed.id && !a.isRead,
                ).length,
            }));
            useRssStore.setState({ feeds: updatedFeeds });
        } catch (e) {
            console.error("[sync-orchestrator] Failed to recalculate unreadCount:", e);
        }
    }

    return { domainsUpdated };
}

// ─── File transfer after metadata merge ───

/**
 * After metadata merge, check for books that arrived without files
 * and attempt to pull the binary book data from the peer.
 *
 * For each successfully transferred book:
 *  - Clears `syncedWithoutFile`
 *  - Sets `storagePath` to `sqlite://<id>` so the storage layer resolves it
 *  - Resets `coverExtractionDone` so Library auto-extracts the cover
 */
async function pullMissingBookFiles(
    peerDeviceId: string,
    log: (msg: string) => void,
): Promise<void> {
    const books = useLibraryStore.getState().books;
    const needFiles = books.filter((b) => b.syncedWithoutFile === true);

    if (needFiles.length === 0) {
        log("No book files to transfer.");
        return;
    }

    const bookIds = needFiles.map((b) => b.id);
    log(`Pulling ${bookIds.length} book file(s) from peer...`);
    setStatus("syncing", `Transferring ${bookIds.length} book file(s)...`);

    try {
        const result = await pullBookFiles(peerDeviceId, bookIds);

        // Update store for successfully transferred books.
        for (const id of result.transferred) {
            useLibraryStore.getState().updateBook(id, {
                syncedWithoutFile: false,
                storagePath: `sqlite://${id}`,
                coverExtractionDone: false,
            });
        }

        const parts: string[] = [];
        if (result.transferred.length > 0) {
            parts.push(`${result.transferred.length} transferred`);
        }
        if (result.unavailable.length > 0) {
            parts.push(`${result.unavailable.length} unavailable on peer`);
        }
        if (result.failed.length > 0) {
            parts.push(`${result.failed.length} failed`);
            for (const f of result.failed) {
                console.warn(`[sync-orchestrator] File transfer failed for ${f.book_id}: ${f.error}`);
            }
        }
        log(`File transfer: ${parts.join(", ")}`);
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[sync-orchestrator] File transfer failed:", errMsg);
        log(`File transfer error: ${errMsg}`);
        // Non-fatal: metadata sync already succeeded. Books remain with syncedWithoutFile=true
        // and the user can retry or re-import manually.
    }
}

// ─── Public API ───

export interface SyncResult {
    success: boolean;
    domainsUpdated: string[];
    error?: string;
}

/**
 * Ensure responder mode is ready in this runtime:
 * - server is running
 * - latest local snapshot is provisioned
 * - incoming sync-complete events are listened to exactly once
 *
 * This is called from global app bootstrap and before manual sync runs,
 * so "push from peer" flows work without requiring users to open Settings.
 */
export async function ensureResponderSyncReady(): Promise<void> {
    if (!isTauri()) {
        return;
    }

    if (responderReadyPromise) {
        await responderReadyPromise;
        return;
    }

    responderReadyPromise = (async () => {
        await startSyncServer();
        await provisionSyncData();

        if (!responderEventUnlisten) {
            responderEventUnlisten = await initSyncEventListener();
        }
    })();

    try {
        await responderReadyPromise;
    } finally {
        responderReadyPromise = null;
    }
}

/**
 * Orchestrates a complete LAN sync session with a paired peer device.
 *
 * @param peerDeviceId - The paired device's unique ID.
 * @param onProgress - Optional progress callback for UI updates.
 * @returns A SyncResult indicating what happened.
 */
export async function runDeviceSync(
    peerDeviceId: string,
    onProgress?: (msg: string) => void,
): Promise<SyncResult> {
    const log = (msg: string) => {
        onProgress?.(msg);
        console.log(`[sync-orchestrator] ${msg}`);
    };

    try {
        setStatus("syncing", "Preparing data...");
        log("Gathering local data snapshot...");

        const { domains, manifest, settingsUpdatedAt } = await buildDomainsAndManifest();

        log("Ensuring sync responder is ready...");
        await ensureResponderSyncReady();

        log("Sending data snapshot to backend...");
        await setSyncData(JSON.stringify(domains), JSON.stringify(manifest));

        log("Initiating sync with peer...");
        setStatus("syncing", "Exchanging data with peer...");
        const incomingMap = await initiateSync(peerDeviceId);

        const incomingDomainCount = Object.keys(incomingMap).length;
        if (incomingDomainCount === 0) {
            log("No updates received from peer — already in sync.");
            setStatus("synced", "Already in sync");
            return { success: true, domainsUpdated: [] };
        }

        log(`Received updates for ${incomingDomainCount} domain(s). Merging...`);
        setStatus("syncing", "Merging data...");

        const { domainsUpdated } = mergeIncomingData(
            incomingMap, settingsUpdatedAt,
        );

        // After metadata merge, pull any missing book files from the peer.
        if (domainsUpdated.includes("books")) {
            await pullMissingBookFiles(peerDeviceId, log);
        }

        const summary = domainsUpdated.length > 0
            ? `Updated: ${domainsUpdated.join(", ")}`
            : "No changes after merge";

        log(`Sync complete. ${summary}`);
        setStatus("synced", summary);

        // Re-provision so the server has up-to-date data for subsequent syncs
        // (e.g. if this device is also a responder for another peer).
        try {
            await provisionSyncData();
        } catch {
            // Non-critical — will be re-provisioned on next sync or server start.
        }

        return { success: true, domainsUpdated };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[sync-orchestrator] Sync failed:", errMsg);
        log(`Sync failed: ${errMsg}`);
        setStatus("error", errMsg);
        return { success: false, domainsUpdated: [], error: errMsg };
    }
}

/**
 * Provisions sync data without initiating a sync.
 *
 * Call this when starting the server so it can respond to sync requests
 * from any paired peer (passive sync / responder mode).
 */
export async function provisionSyncData(): Promise<void> {
    const { domains, manifest } = await buildDomainsAndManifest();
    await setSyncData(JSON.stringify(domains), JSON.stringify(manifest));
}

// ─── Responder-side event listener ───

/** Debounce timer for batching rapid per-domain push events. */
let _syncCompleteTimer: ReturnType<typeof setTimeout> | null = null;
/** Persistent peer device ID — survives across debounced event firings. */
let _lastValidPeerDeviceId: string | undefined;

/**
 * Handles the "sync-incoming-complete" event from the Rust backend.
 * This fires when a remote peer has finished pushing all domains and
 * sent the /sync/complete call. We retrieve the buffered incoming data,
 * merge it into the local stores, and re-provision so the server
 * has up-to-date data for subsequent syncs.
 *
 * @param peerDeviceId - The device ID of the peer that pushed data, from event payload.
 */
async function handleIncomingComplete(peerDeviceId?: string): Promise<void> {
    try {
        console.log("[sync-orchestrator] Responder: sync-incoming-complete received, merging...");
        setStatus("syncing", "Receiving data from peer...");

        const incomingMap = await getIncomingSyncData();
        const domainCount = Object.keys(incomingMap).length;

        if (domainCount === 0) {
            console.log("[sync-orchestrator] Responder: no incoming data to merge.");
            setStatus("synced", "No new data from peer");
            return;
        }

        console.log(`[sync-orchestrator] Responder: merging ${domainCount} domain(s)...`);
        setStatus("syncing", "Merging data from peer...");

        // mergeIncomingData reads fresh state internally, so no need to snapshot here.
        // Use the persisted settingsLastModifiedAt for LWW comparison (same as initiator path)
        // instead of generating "now" which biases the responder to always win.
        const localSettingsUpdatedAt = useSettingsStore.getState().settingsLastModifiedAt || new Date(0).toISOString();

        const { domainsUpdated } = mergeIncomingData(
            incomingMap,
            localSettingsUpdatedAt,
        );

        const summary = domainsUpdated.length > 0
            ? `Received: ${domainsUpdated.join(", ")}`
            : "No changes after merge";

        console.log(`[sync-orchestrator] Responder: merge complete. ${summary}`);

        // After metadata merge, pull any missing book files from the peer.
        if (peerDeviceId && domainsUpdated.includes("books")) {
            const responderLog = (msg: string) => console.log(`[sync-orchestrator] Responder: ${msg}`);
            await pullMissingBookFiles(peerDeviceId, responderLog);
        }

        setStatus("synced", summary);

        // Re-provision so the server has updated data for the next sync.
        await provisionSyncData();
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("[sync-orchestrator] Responder merge failed:", errMsg);
        setStatus("error", `Responder merge failed: ${errMsg}`);
    }
}

/**
 * Initializes the Tauri event listener for responder-side sync.
 *
 * When this device's sync server receives data pushed by a peer,
 * the Rust backend emits "sync-incoming-complete" after the peer
 * calls /sync/complete. This listener picks up that event and
 * triggers the merge.
 *
 * Call this once when the sync server is started.
 * Returns an unlisten function for cleanup.
 */
export async function initSyncEventListener(): Promise<() => void> {
    if (!isTauri()) {
        console.warn("[sync-orchestrator] initSyncEventListener: not in Tauri, skipping.");
        return () => {};
    }

    if (responderEventUnlisten) {
        return responderEventUnlisten;
    }

    // Dynamic import to avoid issues in web builds where @tauri-apps/api
    // may not be available at parse time.
    const { listen } = await import("@tauri-apps/api/event");

    const rawUnlisten = await listen<string>("sync-incoming-complete", (event) => {
        // Parse the peer device ID from the event payload.
        // Persist across debounce firings so a parse failure on one event
        // doesn't lose a successfully-parsed ID from a prior event.
        try {
            const payload = typeof event.payload === "string"
                ? JSON.parse(event.payload)
                : event.payload;
            if (payload?.peer_device_id) {
                _lastValidPeerDeviceId = payload.peer_device_id;
            }
        } catch {
            // If parsing fails, keep the previously saved peer ID (if any).
        }

        // Debounce: if multiple domains arrive rapidly, wait a moment
        // to let the complete event settle before triggering merge.
        if (_syncCompleteTimer) {
            clearTimeout(_syncCompleteTimer);
        }
        _syncCompleteTimer = setTimeout(() => {
            _syncCompleteTimer = null;
            handleIncomingComplete(_lastValidPeerDeviceId);
        }, 300);
    });

    responderEventUnlisten = () => {
        rawUnlisten();
        responderEventUnlisten = null;
    };

    console.log("[sync-orchestrator] Responder event listener registered.");
    return responderEventUnlisten;
}
