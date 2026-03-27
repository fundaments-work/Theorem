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
    pullBookCovers,
    discoverPeer,
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
import { saveCoverImage } from "./storage";

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
        books: JSON.stringify(library.books.map(({ filePath: _f, storagePath: _s, coverPath, ...book }) => ({
            ...book,
            // Include cover data URLs so the peer gets covers immediately
            // without needing to re-extract from the book file.
            ...(coverPath && coverPath.startsWith("data:") ? { coverPath } : {}),
        }))),
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
    const markUpdated = (domain: string) => {
        if (!domainsUpdated.includes(domain)) {
            domainsUpdated.push(domain);
        }
    };

    // ── Merge tombstones FIRST so books/annotations/collections can respect them ──
    let allTombstones = useLibraryStore.getState().deletionTombstones;
    let tombstonesChanged = false;

    if (incomingMap["deletion_tombstones"]) {
        try {
            const incoming = JSON.parse(incomingMap["deletion_tombstones"]);
            if (Array.isArray(incoming)) {
                allTombstones = mergeTombstones(incoming, allTombstones);
                useLibraryStore.setState({ deletionTombstones: allTombstones });
                tombstonesChanged = true;
                markUpdated("deletion_tombstones");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge deletion_tombstones:", e);
        }
    }

    // Tombstones can arrive without the books/annotations/collections domains.
    // In that case, we still must prune local entities immediately so deletions
    // propagate correctly cross-device.
    if (tombstonesChanged) {
        const libraryState = useLibraryStore.getState();
        const prunedBooks = mergeBooks([], libraryState.books, allTombstones);
        const prunedAnnotations = mergeAnnotations([], libraryState.annotations, allTombstones);
        const prunedCollections = mergeCollections([], libraryState.collections, allTombstones);

        useLibraryStore.setState({
            books: prunedBooks,
            annotations: prunedAnnotations,
            collections: prunedCollections,
        });

        if (prunedBooks.length !== libraryState.books.length) {
            markUpdated("books");
        }
        if (prunedAnnotations.length !== libraryState.annotations.length) {
            markUpdated("annotations");
        }
        if (prunedCollections.length !== libraryState.collections.length) {
            markUpdated("collections");
        }
    }

    if (incomingMap["books"]) {
        try {
            const incoming = JSON.parse(incomingMap["books"]);
            if (Array.isArray(incoming)) {
                // Read fresh state to avoid overwriting concurrent user changes.
                const merged = mergeBooks(incoming, useLibraryStore.getState().books, allTombstones);
                useLibraryStore.setState({ books: merged });
                markUpdated("books");

                // Persist incoming cover data URLs to storage so they survive
                // page reloads (partialize strips coverPath from Zustand persistence).
                const incomingWithCovers = (incoming as { id: string; coverPath?: string }[])
                    .filter((b) => b.coverPath && b.coverPath.startsWith("data:"));
                for (const inc of incomingWithCovers) {
                    void (async () => {
                        try {
                            const response = await fetch(inc.coverPath!);
                            const blob = await response.blob();
                            if (blob.size > 0) {
                                await saveCoverImage(inc.id, blob);
                            }
                        } catch {
                            // Non-critical: cover displays from in-memory state.
                        }
                    })();
                }
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
                markUpdated("annotations");
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
                markUpdated("collections");
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
                markUpdated("vocabulary");
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
            markUpdated("settings");
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
                markUpdated("reading_stats");
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
                markUpdated("rss_feeds");
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
                markUpdated("rss_articles");
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
 * After metadata merge, attempt to pull the binary book data and covers
 * from the peer.
 *
 * For each successfully transferred book file:
 *  - Clears `syncedWithoutFile`
 *  - Sets `storagePath` to `sqlite://<id>` so the storage layer resolves it
 *  - Resets `coverExtractionDone` so Library auto-extracts the cover
 */
async function pullMissingBookFilesAndCovers(
    peerDeviceId: string,
    syncedBookIds: string[],
    log: (msg: string) => void,
): Promise<void> {
    const libraryStore = useLibraryStore.getState();
    const books = libraryStore.books;
    
    // 1. Files
    const needFiles = books.filter((b) => b.syncedWithoutFile === true);
    let unlisten: (() => void) | null = null;
    
    if (needFiles.length > 0) {
        const fileIds = needFiles.map((b) => b.id);
        log(`Pulling ${fileIds.length} book file(s) from peer...`);
        setStatus("syncing", `Transferring ${fileIds.length} book(s)...`);

        try {
            if (isTauri()) {
                const { listen } = await import("@tauri-apps/api/event");
                unlisten = await listen<string>("sync-file-progress", (event) => {
                    try {
                        const payload = typeof event.payload === "string" 
                            ? JSON.parse(event.payload) 
                            : event.payload;
                        
                        if (payload.phase === "transferring") {
                            const mbDone = (payload.completed_bytes / 1024 / 1024).toFixed(1);
                            const mbTotal = (payload.total_bytes / 1024 / 1024).toFixed(1);
                            setStatus("syncing", `Transferring ${payload.completed_files}/${payload.total_files} files (${mbDone}/${mbTotal} MB)...`);
                        } else if (payload.phase === "complete") {
                            setStatus("syncing", `Finalizing transfer of ${payload.total_files} files...`);
                        }
                    } catch (err) {}
                });
            }

            const result = await pullBookFiles(peerDeviceId, fileIds);

            for (const id of result.transferred) {
                const currentBook = useLibraryStore.getState().books.find((b) => b.id === id);
                useLibraryStore.getState().updateBook(id, {
                    syncedWithoutFile: false,
                    filePath: `sqlite://${id}`,
                    storagePath: `sqlite://${id}`,
                    coverExtractionDone: Boolean(currentBook?.coverPath),
                });
            }

            const parts: string[] = [];
            if (result.transferred.length > 0) parts.push(`${result.transferred.length} files transferred`);
            if (result.unavailable.length > 0) parts.push(`${result.unavailable.length} files unavailable`);
            if (result.failed.length > 0) {
                parts.push(`${result.failed.length} files failed`);
                for (const f of result.failed) console.warn(`[sync] File transfer failed for ${f.book_id}: ${f.error}`);
            }
            log(`File transfer: ${parts.join(", ")}`);
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            log(`File transfer error: ${errMsg}`);
        } finally {
            if (unlisten) unlisten();
        }
    }

    // 2. Covers
    // We attempt to pull covers for all books that were part of this sync round,
    // plus any books that have syncedWithoutFile=true (since their cover extraction
    // will be blocked until the file is pulled).
    if (syncedBookIds.length > 0) {
        setStatus("syncing", "Fletching cover images...");
        try {
            const result = await pullBookCovers(peerDeviceId, syncedBookIds);
            
            // For books whose covers transferred successfully, trigger a re-render 
            // by bumping a superficial value or relying on the storage cache updating.
            // Since the covers are saved to SQLite, the components will load them
            // via the custom protocol automatically.
            const parts: string[] = [];
            if (result.transferred.length > 0) parts.push(`${result.transferred.length} covers transferred`);
            if (result.unavailable.length > 0) parts.push(`${result.unavailable.length} no cover available`);
            if (result.failed.length > 0) parts.push(`${result.failed.length} covers failed`);
            
            log(`Cover transfer: ${parts.join(", ")}`);
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            log(`Cover transfer error: ${errMsg}`);
        }
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

        // Discover the peer's current address before connecting.
        // The persistent port feature means the stored port is usually correct,
        // but this handles the case where it changed (e.g. port was unavailable).
        log("Discovering peer on network...");
        try {
            const [peerIp, peerPort] = await discoverPeer(peerDeviceId);
            log(`Peer found at ${peerIp}:${peerPort}`);
        } catch (discoveryErr) {
            const errMsg = discoveryErr instanceof Error ? discoveryErr.message : String(discoveryErr);
            log(`Peer discovery failed (${errMsg}), trying stored address...`);
            // Fall through — initiateSync will use whatever address is stored.
            // If the stored address is also stale, initiateSync will fail with a clear error.
        }

        log("Initiating sync with peer...");
        setStatus("syncing", "Exchanging data with peer...");
        const incomingMap = await initiateSync(peerDeviceId);

        const incomingDomainCount = Object.keys(incomingMap).length;
        if (incomingDomainCount === 0) {
            log("No domain updates from peer. Checking for missing book files...");
            // Extract the needFiles since there's no incoming payload
            const needFilesIds = useLibraryStore.getState().books
                .filter((b) => b.syncedWithoutFile)
                .map((b) => b.id);
            await pullMissingBookFilesAndCovers(peerDeviceId, needFilesIds, log);
            setStatus("synced", "Already in sync");
            return { success: true, domainsUpdated: [] };
        }

        log(`Received updates for ${incomingDomainCount} domain(s). Merging...`);
        setStatus("syncing", "Merging data...");

        const { domainsUpdated } = mergeIncomingData(
            incomingMap, settingsUpdatedAt,
        );

        // Parse incomingMap books to get all book IDs part of this sync exchange.
        let syncedBookIds: string[] = [];
        try {
            if (incomingMap["books"]) {
                const books = JSON.parse(incomingMap["books"]);
                if (Array.isArray(books)) {
                    syncedBookIds = books.map((b) => b.id);
                }
            }
        } catch (_err) {}

        // Pull any missing book files on every sync pass.
        // Also fetches cover images for ALL books synchronized in this cycle
        // ensuring high-fidelity metadata.
        await pullMissingBookFilesAndCovers(peerDeviceId, syncedBookIds, log);

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
            console.log("[sync-orchestrator] Responder: no incoming data to merge. Checking missing book files...");
            if (peerDeviceId) {
                const responderLog = (msg: string) => console.log(`[sync-orchestrator] Responder: ${msg}`);
                try {
                    await discoverPeer(peerDeviceId);
                } catch {
                    // Non-fatal: address may already be correct from SyncCompleteMessage.
                }
                const needFilesIds = useLibraryStore.getState().books
                    .filter((b) => b.syncedWithoutFile)
                    .map((b) => b.id);
                await pullMissingBookFilesAndCovers(peerDeviceId, needFilesIds, responderLog);
            }
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

        // Pull any missing book files on every responder merge pass.
        // The initiator's SyncCompleteMessage includes its server address,
        // which handle_sync_complete already saved. Discover to verify reachability.
        if (peerDeviceId) {
            let syncedBookIds: string[] = [];
            try {
                if (incomingMap["books"]) {
                    const books = JSON.parse(incomingMap["books"]);
                    if (Array.isArray(books)) {
                        syncedBookIds = books.map((b) => b.id);
                    }
                }
            } catch (_err) {}
            
            const responderLog = (msg: string) => console.log(`[sync-orchestrator] Responder: ${msg}`);
            try {
                await discoverPeer(peerDeviceId);
            } catch {
                // Discovery failed — peer may have gone offline. pullMissingBookFilesAndCovers
                // will fail gracefully (non-fatal) if the address is stale.
            }
            await pullMissingBookFilesAndCovers(peerDeviceId, syncedBookIds, responderLog);
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
