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
    irohStart,
    getPairedDevices,
    updateSyncNotification,
    setAutoSyncFlag,
    startAndroidSyncWorker,
    stopAndroidSyncWorker,
    schedulePeriodicSyncWork,
    cancelPeriodicSyncWork,
} from "./device-sync";
import {
    useLibraryStore,
    useVocabularyStore,
    useRssStore,
    useUIStore,
    useSettingsStore,
} from "../store";
import type { DeviceSyncStatus, SyncConflict } from "../types";
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
import { isMobile, isTauri } from "./env";
import { saveCoverImage } from "./storage";

// ─── Helpers ───

function setStatus(status: DeviceSyncStatus, msg?: string) {
    useUIStore.getState().setDeviceSyncStatus(
        status,
        msg,
        status === "synced" ? new Date().toISOString() : undefined,
    );
    // Update Android notification so the user sees what's being synced.
    if (msg) {
        void updateSyncNotification(msg);
    }
}

/** Shared unlisten reference for the iroh-docs live event listener. */
let _docsLiveUnlisten: (() => void) | null = null;

// ─── Merge incoming data ───

async function mergeIncomingData(
    incomingMap: Record<string, string>,
    localSettingsUpdatedAt?: string,
    onConflict?: (conflict: SyncConflict) => void,
): Promise<{ domainsUpdated: string[]; conflicts: SyncConflict[] }> {
    const domainsUpdated: string[] = [];
    const conflicts: SyncConflict[] = [];
    const recordConflict = (entityType: string, entityId: string, winner: "local" | "remote", label?: string) => {
        conflicts.push({ entityType, entityId, winner, label });
        onConflict?.({ entityType, entityId, winner, label });
    };
    const markUpdated = (domain: string) => {
        if (!domainsUpdated.includes(domain)) {
            domainsUpdated.push(domain);
        }
    };

    // Validate incoming payloads against zod schemas. Invalid domains
    // are dropped from payloads before any merge logic runs.
    let safeMap = incomingMap;
    try {
        const { validateSyncPayloads } = await import("./sync-schemas");
        const validated = validateSyncPayloads(incomingMap);
        // Reconstruct string map from validated objects.
        safeMap = {};
        for (const [domain, data] of Object.entries(validated)) {
            safeMap[domain] = JSON.stringify(data);
        }
        // Restore per-entity keys that validateSyncPayloads strips — they
        // don't match domain array schemas (book:<id> vs books) but are
        // needed by the per-entity extraction below. Without this, the
        // incremental bridge's per-entity writes (annotation:<id>,
        // book:<id>, collection:<id>) are silently dropped and changes
        // never propagate to the peer.
        for (const key of Object.keys(incomingMap)) {
            if (key.startsWith("book:") || key.startsWith("annotation:") || key.startsWith("collection:")) {
                if (!safeMap[key]) {
                    safeMap[key] = incomingMap[key];
                }
            }
        }
    } catch {
        // If validation fails entirely, fall through with raw incomingMap.
    }

    // Aggregate per-entity keys (book:<id>, annotation:<id>, collection:<id>)
    // from the incremental write path into their domain arrays. This allows
    // the incremental subscription path and the full-sync provision path to
    // coexist — the merge pipeline handles both formats transparently.
    const perEntityBooks: Record<string, unknown>[] = [];
    const perEntityAnnotations: Record<string, unknown>[] = [];
    const perEntityCollections: Record<string, unknown>[] = [];

    for (const key of Object.keys(safeMap)) {
        if (key.startsWith("book:") && key !== "books") {
            try {
                const parsed = JSON.parse(safeMap[key]);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    perEntityBooks.push(parsed);
                }
            } catch {}
        } else if (key.startsWith("annotation:") && key !== "annotations") {
            try {
                const parsed = JSON.parse(safeMap[key]);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    perEntityAnnotations.push(parsed);
                }
            } catch {}
        } else if (key.startsWith("collection:") && key !== "collections") {
            try {
                const parsed = JSON.parse(safeMap[key]);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    perEntityCollections.push(parsed);
                }
            } catch {}
        }
    }

    // ── Merge tombstones FIRST so books/annotations/collections can respect them ──
    let allTombstones = useLibraryStore.getState().deletionTombstones;

    // Collect library store changes in a single batch to avoid cascading subscriber re-renders.
    const libraryPatch: Partial<ReturnType<typeof useLibraryStore.getState>> = {};
    const applyLibraryPatch = (patch: Partial<ReturnType<typeof useLibraryStore.getState>>) => {
        Object.assign(libraryPatch, patch);
    };

    if (safeMap["deletion_tombstones"]) {
        try {
            const incoming = JSON.parse(safeMap["deletion_tombstones"]);
            if (Array.isArray(incoming)) {
                allTombstones = mergeTombstones(incoming, allTombstones);
                applyLibraryPatch({ deletionTombstones: allTombstones });
                markUpdated("deletion_tombstones");
            }
        } catch (e) {
        }
    }

    // Tombstones can arrive without the books/annotations/collections domains.
    // In that case, we still must prune local entities immediately so deletions
    // propagate correctly cross-device.
    if (safeMap["deletion_tombstones"]) {
        const libraryState = useLibraryStore.getState();
        const prunedBooks = mergeBooks([], libraryState.books, allTombstones);
        const prunedAnnotations = mergeAnnotations([], libraryState.annotations, allTombstones);
        const prunedCollections = mergeCollections([], libraryState.collections, allTombstones);

        applyLibraryPatch({
            books: prunedBooks,
            annotations: prunedAnnotations,
            collections: prunedCollections,
        });

        if (prunedBooks.length !== libraryState.books.length) markUpdated("books");
        if (prunedAnnotations.length !== libraryState.annotations.length) markUpdated("annotations");
        if (prunedCollections.length !== libraryState.collections.length) markUpdated("collections");

        // Same pruning for RSS feeds and articles — tombstoned feeds must be
        // removed even when no rss_feeds/rss_articles domain arrives.
        const rssState = useRssStore.getState();
        const prunedFeeds = mergeRssFeeds([], rssState.feeds, allTombstones);
        const prunedArticles = mergeRssArticles([], rssState.articles, undefined, allTombstones);

        useRssStore.setState({ feeds: prunedFeeds.feeds, articles: prunedArticles });

        if (prunedFeeds.feeds.length !== rssState.feeds.length) markUpdated("rss_feeds");
        if (prunedArticles.length !== rssState.articles.length) markUpdated("rss_articles");

        // Same pruning for vocabulary terms — tombstoned terms must be
        // removed even when no vocabulary domain arrives.
        const vocabState = useVocabularyStore.getState();
        const prunedVocab = mergeVocabulary([], vocabState.vocabularyTerms, allTombstones);
        useVocabularyStore.setState({ vocabularyTerms: prunedVocab });
        if (prunedVocab.length !== vocabState.vocabularyTerms.length) markUpdated("vocabulary");
    }

    // Read a snapshot of current state for merges that depends on it.
    let currentLibState = useLibraryStore.getState();
    // Apply pending patches so subsequent domain merges work on the pruned state.
    if (Object.keys(libraryPatch).length > 0) {
        currentLibState = { ...currentLibState, ...libraryPatch };
    }

    if (safeMap["books"] || perEntityBooks.length > 0) {
        try {
            const domainBooks = safeMap["books"]
                ? (() => { const p = JSON.parse(safeMap["books"]); return Array.isArray(p) ? p : []; })()
                : [];
            const incoming = [...domainBooks, ...perEntityBooks];
            if (incoming.length > 0) {
                console.log(`[sync-merge] books: ${incoming.length} incoming (${domainBooks.length} domain + ${perEntityBooks.length} per-entity), ${currentLibState.books.length} existing`);
                const beforeBookMap = new Map(currentLibState.books.map(b => [b.id, b]));
                const incomingBookMap = new Map(incoming.map(b => [b.id, b]));
                const merged = mergeBooks(incoming, currentLibState.books, allTombstones);
                console.log(`[sync-merge] books: ${merged.length} after merge (lost ${incoming.length + currentLibState.books.length - merged.length})`);
                if (merged !== currentLibState.books) {
                    // Safety net: detect and merge books that share contentHash
                    // or blobHash but have different IDs (missed by mergeBooks
                    // when contentHash was undefined on one side). Resolve by
                    // merging the syncedWithoutFile placeholder into the local
                    // book that has an actual file, then removing the duplicate.
                    const hashToLocalId = new Map<string, string>();
                    for (const b of merged) {
                        if (!b.syncedWithoutFile && b.contentHash) {
                            hashToLocalId.set(b.contentHash, b.id);
                        }
                        if (!b.syncedWithoutFile && b.blobHash) {
                            hashToLocalId.set(b.blobHash, b.id);
                        }
                    }
                    const deduped = merged.filter(b => {
                        if (!b.syncedWithoutFile) return true;
                        const localId = (b.contentHash && hashToLocalId.get(b.contentHash))
                            ?? (b.blobHash && hashToLocalId.get(b.blobHash));
                        if (localId && localId !== b.id) {
                            console.log(`[sync-merge] Dedup safety: removing syncedWithoutFile duplicate "${b.title}" (${b.id.substring(0,8)}...) — matches local book ${localId.substring(0,8)}...`);
                            return false;
                        }
                        return true;
                    });
                    const final = deduped.length !== merged.length ? deduped : merged;
                    applyLibraryPatch({ books: final });
                    markUpdated("books");
                    for (const book of final) {
                        if (beforeBookMap.has(book.id) && incomingBookMap.has(book.id)) {
                            const before = beforeBookMap.get(book.id)!;
                            if (before.progress !== book.progress || before.isFavorite !== book.isFavorite) {
                                const remoteWon = incomingBookMap.get(book.id)!;
                                recordConflict("book", book.id, remoteWon.progress === book.progress && remoteWon.lastReadAt === book.lastReadAt ? "remote" : "local", book.title);
                            }
                        }
                    }
                    currentLibState = { ...currentLibState, books: final };
                }

                const incomingWithCovers = (incoming as { id: string; coverPath?: string }[])
                    .filter((b) => b.coverPath && b.coverPath.startsWith("data:"));

                await Promise.allSettled(incomingWithCovers.map(async (inc) => {
                    try {
                        const response = await fetch(inc.coverPath!);
                        const blob = await response.blob();
                        if (blob.size > 0) await saveCoverImage(inc.id, blob);
                    } catch {}
                }));
            }
        } catch (e) {
        }
    }

    if (safeMap["annotations"] || perEntityAnnotations.length > 0) {
        try {
            const domainAnns = safeMap["annotations"]
                ? (() => { const p = JSON.parse(safeMap["annotations"]); return Array.isArray(p) ? p : []; })()
                : [];
            const incoming = [...domainAnns, ...perEntityAnnotations];
            if (incoming.length > 0) {
                const beforeIds = new Set(currentLibState.annotations.map(a => a.id));
                const beforeMap = new Map(currentLibState.annotations.map(a => [a.id, a]));
                const incomingIds = new Set(incoming.map(a => a.id));
                const merged = mergeAnnotations(incoming, currentLibState.annotations, allTombstones);
                if (merged !== currentLibState.annotations) {
                    applyLibraryPatch({ annotations: merged });
                    markUpdated("annotations");
                    for (const ann of merged) {
                        if (beforeIds.has(ann.id) && incomingIds.has(ann.id)) {
                            const before = beforeMap.get(ann.id);
                            if (before && JSON.stringify(before) !== JSON.stringify(ann)) {
                                const remoteWon = incoming.some(i => i.id === ann.id && JSON.stringify(i) === JSON.stringify(ann));
                                recordConflict("annotation", ann.id, remoteWon ? "remote" : "local", ann.selectedText?.slice(0, 40));
                            }
                        }
                    }
                }
                currentLibState = { ...currentLibState, annotations: merged };
            }
        } catch (e) {
        }
    }

    if (safeMap["collections"] || perEntityCollections.length > 0) {
        try {
            const domainCols = safeMap["collections"]
                ? (() => { const p = JSON.parse(safeMap["collections"]); return Array.isArray(p) ? p : []; })()
                : [];
            const incoming = [...domainCols, ...perEntityCollections];
            if (incoming.length > 0) {
                const merged = mergeCollections(incoming, currentLibState.collections, allTombstones);
                if (merged !== currentLibState.collections) {
                    applyLibraryPatch({ collections: merged });
                    markUpdated("collections");
                }
                currentLibState = { ...currentLibState, collections: merged };
            }
        } catch (e) {
        }
    }

    // Flush all library store changes in a single setState call.
    if (Object.keys(libraryPatch).length > 0) {
        useLibraryStore.setState(libraryPatch as Parameters<typeof useLibraryStore.setState>[0]);
    }

    if (safeMap["vocabulary"]) {
        try {
            const incoming = JSON.parse(safeMap["vocabulary"]);
            if (Array.isArray(incoming)) {
                const current = useVocabularyStore.getState().vocabularyTerms;
                const merged = mergeVocabulary(incoming, current, allTombstones);
                if (JSON.stringify(merged) !== JSON.stringify(current)) {
                    useVocabularyStore.setState({ vocabularyTerms: merged });
                    markUpdated("vocabulary");
                }
            }
        } catch (e) {
        }
    }

    if (safeMap["settings"]) {
        try {
            const raw = JSON.parse(safeMap["settings"]);
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
            if (JSON.stringify(merged) !== JSON.stringify(settingsStore.settings)) {
                useSettingsStore.setState({ settings: merged });
                markUpdated("settings");
            }
        } catch (e) {
        }
    }

    if (safeMap["reading_stats"]) {
        try {
            const incoming = JSON.parse(safeMap["reading_stats"]);
            if (incoming && typeof incoming === "object") {
                const current = useSettingsStore.getState().stats;
                const merged = mergeReadingStats(incoming, current);
                if (JSON.stringify(merged) !== JSON.stringify(current)) {
                    useSettingsStore.setState({ stats: merged });
                    markUpdated("reading_stats");
                }
            }
        } catch (e) {
        }
    }

    // Track feedIdMap from mergeRssFeeds so we can remap article feedId references.
    let feedIdMap: Map<string, string> | undefined;

    if (safeMap["rss_feeds"]) {
        try {
            const incoming = JSON.parse(safeMap["rss_feeds"]);
            if (Array.isArray(incoming)) {
                const currentFeeds = useRssStore.getState().feeds;
                console.log(`[sync-merge] rss_feeds: ${incoming.length} incoming, ${currentFeeds.length} existing`);
                const result = mergeRssFeeds(incoming, currentFeeds, allTombstones);
                console.log(`[sync-merge] rss_feeds: ${result.feeds.length} after merge`);
                if (JSON.stringify(result.feeds) !== JSON.stringify(currentFeeds)) {
                    useRssStore.setState({ feeds: result.feeds });
                    markUpdated("rss_feeds");
                }
                feedIdMap = result.feedIdMap;
            }
        } catch (e) {
        }
    }

    if (safeMap["rss_articles"]) {
        try {
            const incoming = JSON.parse(safeMap["rss_articles"]);
            if (Array.isArray(incoming)) {
                const currentArticles = useRssStore.getState().articles;
                console.log(`[sync-merge] rss_articles: ${incoming.length} incoming, ${currentArticles.length} existing`);
                const merged = mergeRssArticles(incoming, currentArticles, feedIdMap, allTombstones);
                console.log(`[sync-merge] rss_articles: ${merged.length} after merge`);
                if (JSON.stringify(merged) !== JSON.stringify(currentArticles)) {
                    useRssStore.setState({ articles: merged });
                    markUpdated("rss_articles");
                }
            }
        } catch (e) {
        }
    }

    // Recalculate feed unreadCounts after merging both feeds and articles,
    // since article read states may have changed via OR merge semantics.
    if (domainsUpdated.includes("rss_feeds") || domainsUpdated.includes("rss_articles")) {
        try {
            const currentRss = useRssStore.getState();
            // Pre-compute unread counts in O(A) instead of O(F * A)
            const unreadByFeed = new Map<string, number>();
            for (const a of currentRss.articles) {
                if (!a.isRead && a.feedId) {
                    unreadByFeed.set(a.feedId, (unreadByFeed.get(a.feedId) ?? 0) + 1);
                }
            }
            const updatedFeeds = currentRss.feeds.map((feed) => ({
                ...feed,
                unreadCount: unreadByFeed.get(feed.id) ?? 0,
            }));
            useRssStore.setState({ feeds: updatedFeeds });
        } catch (e) {
        }
    }

    return { domainsUpdated, conflicts };
}

// ─── File transfer after metadata merge ───

/**
 * Add local book files to the iroh-blobs store.
 * For each book that has a real file path, add it to blobs and update
 * the book's blobHash so the peer can download it via iroh-blobs.
 */
async function provisionBookFileBlobs(): Promise<void> {
    if (!isTauri()) { console.log("[blob-provision] Skipped: not Tauri"); return; }
    const books = useLibraryStore.getState().books;
    console.log(`[blob-provision] Processing ${books.length} books for blob provisioning`);

    // Skip books that already have a valid blobHash — avoids re-reading
    // every book file on every sync startup (192 sequential reads on a
    // 192-book library would take minutes). Only process books that are
    // missing a blobHash (e.g., newly imported, or books that were
    // skipped before the SQLite-fallthrough fix).
    const updates: Array<{ id: string; blobHash?: string; coverBlobHash?: string }> = [];
    let completed = 0;
    let skipped = 0;
    let fromDisk = 0;
    let fromSqlite = 0;
    for (const book of books) {
        if (book.blobHash) {
            skipped++;
            completed++;
            continue;
        }

        const filePath = book.filePath || book.storagePath;
        let hash: string | null = null;

        // Try disk path first (fastest — iroh-blobs reads the file directly).
        if (filePath && !filePath.startsWith("sqlite://") && !filePath.startsWith("idb://")) {
            hash = await blobsAddFile(filePath);
            if (hash) fromDisk++;
        }

        // Fallback: read from SQLite blob store.
        if (!hash) {
            try {
                const { getBookData } = await import("./storage");
                const data = await getBookData(book.id, filePath);
                if (data && data.byteLength > 0) {
                    console.log(`[blob-provision] Reading ${book.title || book.id} from SQLite (${data.byteLength} bytes)`);
                    hash = await blobsAddBytes(new Uint8Array(data));
                    if (hash) fromSqlite++;
                }
            } catch {
            }
        }

        if (!hash) {
            console.log(`[blob-provision] No file for book: ${book.title || book.id} (path: ${filePath})`);
        }

        completed++;
        if (hash && hash !== book.blobHash) {
            updates.push({ id: book.id, blobHash: hash });
        }
        // Add covers that are local files (not data URLs)
        if (book.coverPath && !book.coverPath.startsWith("data:") && !book.coverPath.startsWith("http")) {
            const coverHash = await blobsAddFile(book.coverPath);
            if (coverHash && coverHash !== book.coverBlobHash) {
                const existing = updates.find(u => u.id === book.id);
                if (existing) existing.coverBlobHash = coverHash;
                else updates.push({ id: book.id, coverBlobHash: coverHash });
            }
        }
    }
    console.log(`[blob-provision] ${updates.length} books got new blob hashes (${completed} processed, ${fromDisk} from disk, ${fromSqlite} from SQLite, ${skipped} skipped)`);
    if (updates.length > 0) {
        useLibraryStore.setState((state) => ({
            books: state.books.map((b) => {
                const update = updates.find(u => u.id === b.id);
                return update ? { ...b, ...update } : b;
            }),
        }));
        console.log(`[blob-provision] State updated with ${updates.length} blob hashes`);
    }
}

// ─── Public API ───

export interface SyncResult {
    success: boolean;
    domainsUpdated: string[];
    conflicts?: SyncConflict[];
    error?: string;
}

/**
 * Guard to avoid re-provisioning all Zustand data on every auto-sync cycle.
 * Set to false after pairing a new device to force a full re-provision into
 * the new shared doc. The incremental subscribeZustandToIrohDocs bridge
 * handles day-to-day writes; a full re-provision is only needed at startup
 * and after pairing.
 */
let _initialProvisionDone = false;
let _forceReProvision = false;
let _responderReadyPromise: Promise<void> | null = null;

/** Reset the provision flag — call after pairing a new device so the next
 *  ensureResponderSyncReady() re-provisions data into the new shared doc. */
export function markProvisioningNeeded(): void {
    _initialProvisionDone = false;
    _forceReProvision = true;
    void clearProvisionedFlag();
}

const SYNC_PROVISIONED_KV_KEY = "theorem_sync_provisioned";

async function wasAlreadyProvisioned(): Promise<boolean> {
    if (_forceReProvision) return false;
    try {
        const { sqliteGetKv } = await import("./sqlite-storage");
        const val = await sqliteGetKv(SYNC_PROVISIONED_KV_KEY);
        return val === "true";
    } catch {
        return false;
    }
}

async function markProvisioned(): Promise<void> {
    try {
        const { sqliteSetKv } = await import("./sqlite-storage");
        await sqliteSetKv(SYNC_PROVISIONED_KV_KEY, "true");
    } catch {}
}

async function clearProvisionedFlag(): Promise<void> {
    try {
        const { sqliteDeleteKv } = await import("./sqlite-storage");
        await sqliteDeleteKv(SYNC_PROVISIONED_KV_KEY);
    } catch {}
}

/**
 * Ensure responder mode is ready in this runtime:
 * - server is running
 * - latest local snapshot is provisioned (only on first call or after pairing)
 * - incoming sync-complete events are listened to exactly once
 *
 * This is called from global app bootstrap and before manual sync runs,
 * so "push from peer" flows work without requiring users to open Settings.
 */
export async function ensureResponderSyncReady(): Promise<void> {
    if (!isTauri()) {
        return;
    }

    // Prevent multiple concurrent calls — if one is already running, wait for it.
    // Without this, the App.tsx bootstrap (2s delay) and DeviceSync.tsx page mount
    // both call this, and the second blocks waiting for _initialProvisionDone.
    if (_responderReadyPromise) {
        await _responderReadyPromise;
        return;
    }

    _responderReadyPromise = (async () => {
        // Wait for ALL Zustand stores to fully rehydrate from persistent storage
        // before provisioning data to iroh-docs. Without this, we'd write stale
        // or empty state (e.g., 0 books) to the doc. Missing any store means a
        // peer syncing during this window would see incomplete data and could
        // overwrite local state with empty/partial data (data annihilation).
        for (let i = 0; i < 50; i++) { // up to 5 seconds
            const settingsReady = useSettingsStore.persist?.hasHydrated?.() ?? false;
            const libraryReady = useLibraryStore.persist?.hasHydrated?.() ?? false;
            const vocabReady = useVocabularyStore.persist?.hasHydrated?.() ?? true;
            const rssReady = useRssStore.persist?.hasHydrated?.() ?? true;
            if (settingsReady && libraryReady && vocabReady && rssReady) break;
            await new Promise(r => setTimeout(r, 100));
        }

        await irohStart();

        // Full provisioning is only needed once ever, or after pairing a new
        // device. On normal app restart, iroh-docs loads all data from disk.
        // Use a SQLite-flag check (O(1)) instead of docsGetAllEntries (which
        // downloads ALL blob content and is O(n)).
        if (!_initialProvisionDone) {
            const alreadyDone = await wasAlreadyProvisioned();
            if (!alreadyDone) {
                // Pause the Zustand→iroh bridge while provisioning so we
                // don't cascade 192 scheduleDocsWrite calls on top of the
                // sequential provisionToIrohDocs writes (2× redundancy,
                // 2× gossip churn, and a feedback loop with the peer).
                _bridgePaused = true;
                try {
                    await provisionBookFileBlobs();
                    await provisionToIrohDocs();
                    await markProvisioned();
                } finally {
                    _bridgePaused = false;
                }
            } else {
                console.log("[sync] Already provisioned — skipping re-provision");
            }
            _initialProvisionDone = true;
            _bridgePaused = false;  // bridge can start syncing real-time changes now
            runBlobsGarbageCollection().then((removed) => {
                if (removed > 0) console.log(`[blob-gc] Removed ${removed} orphaned blobs`);
            }).catch(() => {});
        }

        // Register the iroh-docs live event listener so real-time
        // CRDT updates from the peer are applied to Zustand stores.
        if (!_docsLiveUnlisten) {
            _docsLiveUnlisten = await initDocsLiveListener();
        }
    })();

    try {
        await _responderReadyPromise;
    } finally {
        _responderReadyPromise = null;
        // Unpause the bridge now that provisioning (or skip) is done.
        // This is the final safety net — the provisioning block also
        // clears it, but a second call to ensureResponderSyncReady
        // skips the block and needs this to unpause.
        _bridgePaused = false;
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
    if (_isMerging) {
        return { success: false, domainsUpdated: [], error: "Sync already in progress" };
    }
    _isMerging = true;
    _syncCancelled = false; // Clear stale cancel flag from previous round
    const log = (msg: string) => {
        onProgress?.(msg);
    };

    // Snapshot book count before sync so the poll loop can detect whether
    // data actually arrived. On a fresh device (0 books), we must not settle
    // quickly — either data arrives or we hit the full timeout.
    const _bookCountBeforeSync = useLibraryStore.getState().books.length;

    try {
        setStatus("syncing", "Preparing to sync...");
        log("Connecting to peer...");

        // 1. Ensure the iroh Router + responder are ready FIRST so both sides
        //    can accept incoming iroh-docs sync connections. Starting the Router
        //    after docsSyncNow is backwards — the peer's connection attempt
        //    would fail because this device's Router isn't accepting yet.
        log("Starting P2P transport...");
        await ensureResponderSyncReady();

        // 2. Before syncing, force-rehash any books that are missing blobHash.
        //    On the first sync after the SQLite-fallthrough fix, books stored in
        //    the database (filePath: sqlite://...) would have been skipped by the
        //    old code. This ensures they get blobHash before the sync sends them
        //    to the peer, so the peer can download the actual file.
        //    This runs even if ensureResponderSyncReady already ran (it does this
        //    on first startup but the guard prevents re-execution).
        {
            const books = useLibraryStore.getState().books;
            const missingHash = books.filter(b => !b.blobHash);
            if (missingHash.length > 0) {
                if (_syncCancelled) {
                    throw new Error("Sync cancelled");
                }
                log(`Re-hashing ${missingHash.length} books missing blobHash...`);
                setStatus("syncing", `Hashing ${missingHash.length} books...`);
                await provisionBookFileBlobs();
                await provisionToIrohDocs();
            }
        }

        // 3. Set up iroh-docs completion listeners BEFORE triggering sync.
        log("Requesting data from peer...");
        setStatus("syncing", "Connecting to peer...");

        let syncResolve: (() => void) | null = null;
        const syncPromise = new Promise<void>((res) => { syncResolve = res; });
        let settled = false;
        const settle = () => { if (!settled) { settled = true; syncResolve?.(); } };

        let contentReadyUnlisten: (() => void) | null = null;
        let syncFinishedUnlisten: (() => void) | null = null;
        let _syncActivityDetected = false;
        try {
            const { listen: evListen } = await import("@tauri-apps/api/event");
            contentReadyUnlisten = await evListen("docs-pending-content-ready", () => {
                _syncActivityDetected = true;
                const currentBooks = useLibraryStore.getState().books.length;
                if (currentBooks > 0) {
                    console.log(`[sync] Received docs-pending-content-ready with ${currentBooks} books — settling`);
                    settle();
                } else {
                    console.log("[sync] Received docs-pending-content-ready with 0 books — waiting for actual data");
                }
            });
            syncFinishedUnlisten = await evListen("docs-sync-finished", () => {
                _syncActivityDetected = true;
                console.log("[sync] Received docs-sync-finished — reconciliation complete");
            });
        } catch {}

        // 4. Trigger iroh-docs CRDT sync with the peer.
        log("Syncing with peer via iroh-docs...");
        setStatus("syncing", "Connected, receiving data...");
        const docsSyncError = await docsSyncNow(peerDeviceId);
        if (docsSyncError) {
            log(`Warning: iroh-docs sync failed: ${docsSyncError}`);
            // If docsSyncNow failed (peer offline, no shared doc), don't sit
            // in a poll loop — return immediately with a clear error.
            const isOffline = docsSyncError.includes("offline") || docsSyncError.includes("timeout");
            const errorMsg = isOffline
                ? `Peer is offline — try again later`
                : docsSyncError;
            setStatus("error", errorMsg);
            return { success: false, domainsUpdated: [], error: errorMsg };
        }

        // Stability-based backoff: poll hydrateFromIrohDocs every 3s.
        // Exit when 3 consecutive polls produce no changes AND data arrived.
        // On a fresh device (0 books before sync), don't settle until either
        // books arrive from the peer or the full timeout is reached.
        let stablePolls = 0;
        const STABLE_THRESHOLD = 2;
        const MAX_WAIT_SECS = 60;
        const POLL_INTERVAL_MS = 1500;
        const MIN_ELAPSED_MS = 2000;

        const waitStart = Date.now();
        let prevDomainSet = "";
        let lastProgressMsg = "";
        const updateProgress = (msg: string) => {
            if (msg !== lastProgressMsg) {
                lastProgressMsg = msg;
                setStatus("syncing", msg);
            }
        };
        const pollLoop = async () => {
            while (!settled) {
                if (_syncCancelled) {
                    console.log("[sync] Sync cancelled during poll");
                    settle();
                    break;
                }
                const elapsed = Date.now() - waitStart;

                // Show a simple status pulse so the notification keeps
                // updating (Android kills stale notifications). CRDT sync
                // typically takes 3-15s depending on network quality.
                // Show actual book count so user sees progress.
                const currentBooks = useLibraryStore.getState().books.length;
                if (currentBooks > 0) {
                    const booksSynced = currentBooks - _bookCountBeforeSync;
                    if (booksSynced > 0) {
                        updateProgress(`Receiving: ${booksSynced} books received`);
                    } else if (elapsed < 10000) {
                        updateProgress("Syncing metadata...");
                    } else {
                        updateProgress("Receiving data...");
                    }
                } else if (elapsed < 10000) {
                    updateProgress("Connecting to peer...");
                } else {
                    updateProgress("Waiting for peer...");
                }

                await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
                if (settled) break;

                const updated = await hydrateFromIrohDocs();
                const currentDomainSet = updated.sort().join(",");

                if (currentDomainSet !== prevDomainSet && currentDomainSet !== "" && elapsed >= MIN_ELAPSED_MS) {
                    stablePolls = 0;
                    prevDomainSet = currentDomainSet;
                    const domainLabels: Record<string, string> = {
                        books: "Books", annotations: "Annotations", collections: "Collections",
                        deletion_tombstones: "Deletions", vocabulary: "Vocabulary",
                        rss_feeds: "Feeds", rss_articles: "Articles",
                        settings: "Settings", reading_stats: "Stats",
                    };
                    const store = useLibraryStore.getState();
                    const counts: Record<string, number> = {
                        books: store.books.length,
                        annotations: store.annotations.length,
                        collections: store.collections.length,
                        vocabulary: useVocabularyStore.getState().vocabularyTerms.length,
                        rss_feeds: useRssStore.getState().feeds.length,
                        rss_articles: useRssStore.getState().articles.length,
                    };
                    const detailParts = updated.map(d => {
                        const label = domainLabels[d] || d;
                        const count = counts[d];
                        return count !== undefined ? `${label} (${count})` : label;
                    });
                    updateProgress(`Received: ${detailParts.join(", ")}`);
                } else {
                    // Only count as stable if we actually have data (books > 0)
                    // OR the device had books before sync (no new data expected).
                    // On a fresh device (0 books before sync), never increment
                    // stability — wait for data or timeout.
                    const currentBooks = useLibraryStore.getState().books.length;
                    if (currentBooks > 0 || _bookCountBeforeSync > 0) {
                        stablePolls++;
                    }
                }

                if (stablePolls >= STABLE_THRESHOLD && elapsed >= MIN_ELAPSED_MS) {
                    console.log(`[sync] Stable for ${STABLE_THRESHOLD} polls, elapsed=${elapsed}ms — done`);
                    settle();
                    break;
                }
                if (elapsed >= MAX_WAIT_SECS * 1000) {
                    console.log(`[sync] Max wait ${MAX_WAIT_SECS}s reached — done`);
                    settle();
                    break;
                }
            }
        };

        // Run poll loop concurrently with event-driven resolution.
        // Promise.race gives us the first signal, but the pollLoop promise
        // continues running until settled — we await it below to ensure the
        // final hydrate step ran.
        await Promise.race([
            pollLoop(),
            syncPromise,
        ]);
        // Wait for the poll loop to exit its current iteration.
        await new Promise<void>(r => setTimeout(r, 200));
        contentReadyUnlisten?.();
        syncFinishedUnlisten?.();

        // Final hydrate: read ALL entries from the doc. By now content blobs
        // from the peer should be available (PendingContentReady fired or we
        // hit the stability threshold). This catches any entries that were
        // pending during the poll loop.
        // Also force-drain any buffered live events that accumulated during
        // the sync (they were deferred while _isMerging was true).
        const changedDomains = new Set<string>();
        const changedConflicts: SyncConflict[] = [];

        {
            const updated = await hydrateFromIrohDocs();
            for (const d of updated) changedDomains.add(d);
        }
        if (_syncCancelled) {
            log("Sync cancelled before final merge");
            return { success: false, domainsUpdated: [], error: "Sync cancelled" };
        }

        // Drain buffered live events synchronously before releasing _isMerging.
        // Without this, entries from ContentReady events that arrived during
        // the poll loop would only be processed after _isMerging is released
        // in the finally block — AFTER the summary message is computed.
        const liveEntries: Record<string, string> = {};
        for (const [k, v] of _pendingDocsEntries) {
            liveEntries[k] = v;
        }
        _pendingDocsEntries.clear();
        if (Object.keys(liveEntries).length > 0) {
            const { domainsUpdated, conflicts } = await mergeIncomingData(liveEntries);
            for (const d of domainsUpdated) changedDomains.add(d);
            changedConflicts.push(...conflicts);
        }
        // Flush any remaining progressive book batch
        if (_progressiveBookTimer) clearTimeout(_progressiveBookTimer);
        _flushProgressiveBooks();

        const postWaitBooks = useLibraryStore.getState().books.length;
        console.log(`[sync] After wait: ${postWaitBooks} books`);

        // Check for cancellation before proceeding to file downloads.
        // The poll loop may have been cancelled; if so, return immediately.
        if (_syncCancelled) {
            log("Sync cancelled after metadata sync");
            _syncCancelled = false;
            return { success: false, domainsUpdated: [], error: "Sync cancelled" };
        }

        // 6. File transfer is ON-DEMAND — downloads happen when the user
        //    taps "Open Book", not during metadata sync. The book arrived
        //    with syncedWithoutFile=true, and the peer's file will be fetched
        //    via the `theorem-file/v1` QUIC stream handler on first open.
        //    This avoids downloading 20GB+ on a fresh sync peer.
        const pendingDownloads = useLibraryStore.getState().books.filter(b => b.syncedWithoutFile === true && b.blobHash).length;
        if (pendingDownloads > 0) {
            log(`${pendingDownloads} book(s) available for on-demand download`);
        }

        if (_syncCancelled) {
            _syncCancelled = false;
            log("Sync cancelled");
            setStatus("idle", "Sync cancelled");
            return { success: false, domainsUpdated: [], error: "Sync cancelled" };
        }

        // Build a human-readable summary from what actually changed during
        // this sync round, not from total store counts. Showing total counts
        // ("192 books, 97 annotations") is misleading — it always shows the
        // same number and gives no indication of what was actually transferred.
        const domainLabels: Record<string, string> = {
            books: "Books",
            annotations: "Annotations",
            collections: "Collections",
            deletion_tombstones: "Deletions",
            vocabulary: "Vocabulary",
            rss_feeds: "Feeds",
            rss_articles: "Articles",
            settings: "Settings",
            reading_stats: "Stats",
        };

        let summary: string;
        if (changedDomains.size > 0) {
            const store = useLibraryStore.getState();
            const counts: Record<string, number> = {
                books: store.books.length,
                annotations: store.annotations.length,
                collections: store.collections.length,
                vocabulary: useVocabularyStore.getState().vocabularyTerms.length,
                rss_feeds: useRssStore.getState().feeds.length,
                rss_articles: useRssStore.getState().articles.length,
            };
            // Filter out internal domains that confuse users
            const visibleDomains = [...changedDomains].filter(d => d !== "deletion_tombstones");
            const parts = visibleDomains
                .map(d => {
                    const label = domainLabels[d] || d;
                    const count = counts[d];
                    return count !== undefined ? `${count} ${label}` : label;
                })
                .join(", ");
            summary = `Synced: ${parts}`;
            if (changedConflicts.length > 0) {
                summary += ` · ${changedConflicts.length} conflict(s) resolved`;
            }
        } else if (pendingDownloads > 0) {
            summary = `Metadata synced, ${pendingDownloads} files available for download`;
        } else if (!_syncActivityDetected) {
            // docsSyncNow succeeded (start_sync returned Ok) but NO sync
            // events (docs-pending-content-ready, docs-sync-finished) ever
            // fired. start_sync in iroh-docs is optimistic — it returns
            // immediately without waiting for a connection. The peer was
            // unreachable, so data never flowed either direction.
            summary = "Peer offline";
        } else {
            // Connected and SyncFinished fired, but no data arrived.
            // The peer has no data to share.
            summary = "No data received — peer may not be sharing";
        }

        log(`Sync complete. ${summary}`);
        if (!_syncActivityDetected) {
            setStatus("error", summary);
        } else {
            setStatus("synced", summary);
        }
        _dataDirty = false;

        return { success: true, domainsUpdated: [...changedDomains], conflicts: changedConflicts.length > 0 ? changedConflicts : undefined };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log(`Sync failed: ${errMsg}`);
        setStatus("error", errMsg);
        return { success: false, domainsUpdated: [], error: errMsg };
    } finally {
        _isMerging = false;
    }
}

/**
 * Provisions sync data without initiating a sync.
 *
 * Call this when starting the server so it can respond to sync requests
 * from any paired peer (passive sync / responder mode).
 */
// ─── Responder-side event listener ───

let _isMerging = false;
/** Set to true to cancel a running sync session. */
let _syncCancelled = false;
/** Set to true while ensureResponderSyncReady is provisioning to prevent
 *  the Zustand→iroh bridge from cascading writes during the bulk provision.
 *  Starts true so the bridge is gated until after the first provisioning completes. */
let _bridgePaused = true;

/**
 * Cancel the currently running sync if any. The sync loop and download
 * workers check this flag between operations and abort cleanly.
 */
export function cancelRunningSync(): void {
    _syncCancelled = true;
    if (_progressiveBookTimer) clearTimeout(_progressiveBookTimer);
    _progressiveBookBatch = [];
    setStatus("idle", "Sync cancelled");
    console.log("[sync] Cancel requested — _syncCancelled = true");
}

/**
 * Download a synced book file on demand when the user taps "Open Book".
 * Tries all paired peers until one succeeds. Saves to book-cache/<id>.book
 * and updates the book's state to syncedWithoutFile=false.
 * Returns true if the file was downloaded successfully.
 */
export async function downloadBookOnDemand(bookId: string): Promise<boolean> {
    if (!isTauri()) return false;

    const { requestBookFile } = await import("./device-sync");
    const { invoke } = await import("@tauri-apps/api/core");
    const { appDataDir } = await import("@tauri-apps/api/path");
    const appDir = await appDataDir();
    const destPath = `${appDir}/book-cache/${bookId}.book`;

    try {
        await invoke("plugin:fs|mkdir", { path: `${appDir}/book-cache`, recursive: true });
    } catch {}

    const devices = await getPairedDevices().catch(() => []);
    for (const device of devices) {
        const data = await requestBookFile(device.deviceId, bookId);
        if (!data || data.byteLength === 0) continue;

        try {
            await invoke("plugin:fs|write_file", {
                path: destPath,
                contents: Array.from(data),
            });
            useLibraryStore.setState((state) => ({
                books: state.books.map((b) =>
                    b.id === bookId
                        ? { ...b, syncedWithoutFile: false, filePath: destPath, storagePath: destPath }
                        : b,
                ),
            }));
            return true;
        } catch {}
    }
    return false;
}

/**
 * Initialize the iroh-docs live event listener for real-time CRDT updates.
 * When a peer modifies a doc entry and the CRDT sync delivers it, the Rust
 * backend emits "docs-entry-changed". This listener applies those changes
 * to Zustand stores.
 *
 * Returns an unlisten function for cleanup. Safe to call multiple times —
 * only registers once.
 */
let _docsLiveTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_PENDING_ENTRIES = 2000;
const _pendingDocsEntries = new Map<string, string>();


// Progressive book batch — per-entity book events are accumulated for 200ms
// then merged in a single setState call to avoid 192 individual re-renders.
let _progressiveBookBatch: any[] = [];
let _progressiveBookTimer: ReturnType<typeof setTimeout> | null = null;

function _flushProgressiveBooks() {
    if (_progressiveBookBatch.length === 0) return;
    const batch = _progressiveBookBatch.splice(0);
    const state = useLibraryStore.getState();
    const beforeBooks = state.books;
    const merged = mergeBooks(batch, beforeBooks, state.deletionTombstones);

    // No new books added and no existing books changed — skip setState.
    // mergeBooks always returns a new array, but if the length is the same
    // and every book has the same ID order, nothing actually changed.
    if (merged.length === beforeBooks.length) {
        let changed = false;
        for (let i = 0; i < merged.length; i++) {
            if (merged[i] !== beforeBooks[i] || merged[i].id !== beforeBooks[i].id) {
                changed = true;
                break;
            }
        }
        if (!changed) return;
    }

    useLibraryStore.setState({ books: merged });

    // Report the actual number of NEW books (after dedup), not the raw batch size.
    // The raw batch size can be misleading — e.g., 368 incoming entries may only
    // produce 192 unique books after contentHash/blobHash matching.
    if (!_syncCancelled) {
        const newCount = merged.length - beforeBooks.length;
        if (newCount > 0) {
            setStatus("syncing", `${newCount} books received`);
        }
    }

    // On-demand download: files are fetched when the user opens the book.
    // The metadata (title, author, progress, etc.) is already available.
    for (const book of batch) {
        const added = merged.find((b: any) => b.id === book.id);
        if (added && !added.blobHash) {
            console.log(`[sync] No blobHash for: ${book.title || book.id} — peer hasn't provisioned this blob`);
        }
    }
}

export async function initDocsLiveListener(): Promise<() => void> {
    if (!isTauri()) {
        return () => {};
    }

    if (_docsLiveUnlisten) {
        return _docsLiveUnlisten;
    }

    const { listen } = await import("@tauri-apps/api/event");

    const _processPendingDocs = async () => {
        if (_isMerging) {
            _docsLiveTimer = setTimeout(_processPendingDocs, 500);
            return;
        }
        const entries: Record<string, string> = {};
        for (const [k, v] of _pendingDocsEntries) {
            entries[k] = v;
        }
        _pendingDocsEntries.clear();
        await mergeIncomingData(entries);
    };

    const rawUnlisten = await listen<{ key: string; value: string }>("docs-entry-changed", (event) => {
        const { key, value } = event.payload;

        // Skip events that were triggered by our own writes to iroh-docs.
        // Without this, every local write creates a feedback loop:
        // write → event → merge → setState → bridge writes → event → ...
        if (isSelfOriginatedKey(key)) {
            return;
        }

        // ── Per-entity keys: process PROGRESSIVELY ──
        // Books, annotations, and collections written as individual entries
        // (by subscribeZustandToIrohDocs or provisionToIrohDocs) appear in
        // the library IMMEDIATELY — no waiting for a batch merge. Files start
        // downloading the moment a book arrives with a blobHash.
        if (key.startsWith("book:")) {
            try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.id) {
                    _progressiveBookBatch.push(parsed);
                    if (_progressiveBookTimer) clearTimeout(_progressiveBookTimer);
                    _progressiveBookTimer = setTimeout(_flushProgressiveBooks, 200);
                }
            } catch {}
            return;
        }
        if (key.startsWith("annotation:")) {
            try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.id) {
                    const state = useLibraryStore.getState();
                    const beforeAnns = state.annotations;
                    const merged = mergeAnnotations([parsed], beforeAnns, state.deletionTombstones);
                    if (merged !== beforeAnns) {
                        useLibraryStore.setState({ annotations: merged });
                    }
                }
            } catch {}
            return;
        }
        if (key.startsWith("collection:")) {
            try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.id) {
                    const state = useLibraryStore.getState();
                    const beforeCols = state.collections;
                    const merged = mergeCollections([parsed], beforeCols, state.deletionTombstones);
                    if (merged !== beforeCols) {
                        useLibraryStore.setState({ collections: merged });
                    }
                }
            } catch {}
            return;
        }

        // ── Domain-level keys: batch for full merge pipeline ──
        _pendingDocsEntries.set(key, value);
        if (_pendingDocsEntries.size > MAX_PENDING_ENTRIES) {
            // Cap reached — process immediately
            if (_docsLiveTimer) clearTimeout(_docsLiveTimer);
            _processPendingDocs();
            return;
        }
        if (_docsLiveTimer) clearTimeout(_docsLiveTimer);
        _docsLiveTimer = setTimeout(_processPendingDocs, 500);
    });

    _docsLiveUnlisten = () => {
        rawUnlisten();
        if (_docsLiveTimer) clearTimeout(_docsLiveTimer);
        _docsLiveTimer = null;
        if (_progressiveBookTimer) clearTimeout(_progressiveBookTimer);
        _progressiveBookTimer = null;
        _progressiveBookBatch = [];
        _pendingDocsEntries.clear();
        _docsLiveUnlisten = null;
    };

    return _docsLiveUnlisten;
}

// ─── Auto-Sync ───

/** How often to auto-sync in the background (milliseconds). */
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** Delay before the first sync after app startup. */
const STARTUP_SYNC_DELAY_MS = 5000;

/** Debounce window for mutation-triggered sync. */
const MUTATION_SYNC_DEBOUNCE_MS = 2000;

let _autoSyncTimer: ReturnType<typeof setInterval> | null = null;
let _mutationSyncTimer: ReturnType<typeof setTimeout> | null = null;
let _autoSyncCleanups: Array<() => void> = [];
let _isAutoSyncing = false;
let _dataDirty = false;

/**
 * Run a sync round with all paired peers.
 * Syncs with every paired peer.
 * Silently skips if no peers are reachable.
 *
 * @param force - If true, runs even if `_dataDirty` is false (for startup, visibility change, tray).
 */
async function autoSyncRound(force = false): Promise<void> {
    if (!isTauri() || _isAutoSyncing) return;
    if (!force && !_dataDirty) return; // nothing changed, skip unless forced

    const { settings } = useSettingsStore.getState();
    if (!settings.deviceSync?.autoSyncEnabled) return;

    const devices = await getPairedDevices().catch(() => []);
    if (devices.length === 0) return;

    _isAutoSyncing = true;
    try {
        let anyPeerSynced = false;
        for (const device of devices) {
            const result = await runDeviceSync(device.deviceId);
            if (result.success) {
                anyPeerSynced = true;
            }
        }
        // Only mark clean if at least one peer synced successfully.
        // A single failed peer (offline, timeout) shouldn't block
        // subsequent sync rounds or leave _dataDirty stuck.
        _dataDirty = !anyPeerSynced;
    } catch {
        // Silent — peer might be offline; retry next cycle
    } finally {
        _isAutoSyncing = false;
    }
}

/**
 * Schedule a debounced sync triggered by data mutations.
 * Call this after annotations, books, or settings change.
 * The sync is batched: rapid mutations only trigger one sync.
 *
 * If the sync daemon is running and has paired peers, pushes latest data to it.
 * Falls back to JS-based auto-sync round.
 *
 * Also wakes the Rust background sync loop so it can sync
 * immediately instead of waiting for the next timer tick.
 */
export function scheduleMutationSync(): void {
    const { settings } = useSettingsStore.getState();
    if (!settings.deviceSync?.autoSyncEnabled) return;

    _dataDirty = true;

    if (_mutationSyncTimer) {
        clearTimeout(_mutationSyncTimer);
    }
    _mutationSyncTimer = setTimeout(async () => {
        _mutationSyncTimer = null;

        if (_isAutoSyncing) {
            // A sync is already in progress — reschedule instead of dropping
            _dataDirty = true;
            scheduleMutationSync();
            return;
        }
        void autoSyncRound();
    }, MUTATION_SYNC_DEBOUNCE_MS);
}

/**
 * Start all auto-sync mechanisms.
 *
 * If the sync daemon is running, delegates to it and avoids JS timers.
 * Otherwise falls back to in-process JS scheduling.
 *
 * Sets up:
 * - Startup sync (after initial delay)
 * - Periodic background sync (every N minutes)
 * - App visibility change sync (on tab/window focus)
 * - Tray "sync now" event listener
 *
 * Returns a cleanup function to stop all auto-sync.
 * Safe to call multiple times — cleans up previous runs.
 */
export async function startAutoSync(): Promise<() => void> {
    stopAutoSync();
    setAutoSyncFlag(true).catch(e => console.error("[catch]", e));

    if (!isTauri()) {
        return () => {};
    }

    const cleanups: Array<() => void> = [];

    // 1. Startup sync — delay to let the app fully initialize.
    //    Force-run: we may have missed peer changes while offline.
    const startupTimer = setTimeout(() => {
        void autoSyncRound(true);
    }, STARTUP_SYNC_DELAY_MS);
    cleanups.push(() => clearTimeout(startupTimer));

    // 2. Periodic background sync — only runs if data changed.
    //    Also performs a full-force sync every ~10 min as a safety net
    //    (in case the peer has changes we missed via dirty-detection).
    let tickCount = 0;
    _autoSyncTimer = setInterval(() => {
        tickCount++;
        void autoSyncRound(tickCount % 5 === 0); // force every 5th tick (10 min)
    }, AUTO_SYNC_INTERVAL_MS);
    cleanups.push(() => {
        if (_autoSyncTimer) {
            clearInterval(_autoSyncTimer);
            _autoSyncTimer = null;
        }
    });

    // 3. Visibility change (tab/window focus) — force: peer may have changed.
    //    Cooldown prevents sync on every tab switch.
    let lastVisibilitySync = 0;
    const VISIBILITY_COOLDOWN_MS = 30_000;
    const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
            const now = Date.now();
            if (now - lastVisibilitySync < VISIBILITY_COOLDOWN_MS) return;
            lastVisibilitySync = now;
            void autoSyncRound(true);
        }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    cleanups.push(() => document.removeEventListener("visibilitychange", onVisibilityChange));

    // 4. Tray "sync now" event
    if (isTauri()) {
        try {
            const { listen } = await import("@tauri-apps/api/event");
            const unlisten = await listen("tray-sync-now", () => {
                void autoSyncRound(true); // force: explicit user action
            });
            cleanups.push(unlisten);
        } catch {
            // Tray event not available (web fallback)
        }
    }

    // 5. iroh-docs live event listener — real-time Zustand updates from peers
    //    Uses the shared initDocsLiveListener which also guards against
    //    double-registration (already registered by ensureResponderSyncReady).
    if (isTauri()) {
        try {
            const unlisten = await initDocsLiveListener();
            cleanups.push(unlisten);
        } catch {
            // iroh-docs event not available
        }
    }

    // 5b. Peer online/offline — auto-trigger sync when a paired device comes online.
    //     This eliminates the need to press "Sync" on both devices — when either
    //     device comes online, the other detects it and starts syncing.
    //     Cooldown prevents rapid re-syncs when the peer reconnects repeatedly.
    if (isTauri()) {
        try {
            const { listen } = await import("@tauri-apps/api/event");
            let lastPeerOnlineSync = 0;
            const PEER_ONLINE_COOLDOWN_MS = 30_000;
            const peerOnlineUnlisten = await listen<{ peer: string }>("docs-peer-online", async (event) => {
                const nodeId = event.payload.peer;
                if (!nodeId) return;
                const now = Date.now();
                if (now - lastPeerOnlineSync < PEER_ONLINE_COOLDOWN_MS) return;
                lastPeerOnlineSync = now;
                try {
                    const devices = await getPairedDevices();
                    const matched = devices.find(d => d.irohNodeId === nodeId);
                    if (matched) {
                        console.log(`[sync] Peer ${matched.deviceName} (${matched.deviceId}) came online — auto-syncing`);
                        void runDeviceSync(matched.deviceId);
                    }
                } catch {
                    // Ignore errors — the periodic timer will retry.
                }
            });
            cleanups.push(peerOnlineUnlisten);
        } catch {
            // Tauri events not available.
        }
    }

    // 5c. Doc re-imported — when the iroh-docs database was wiped and the
    //     sync document was re-imported from a stored DocTicket, the new doc
    //     is empty. Force a full re-provision so the peer sees data again.
    if (isTauri()) {
        try {
            const { listen } = await import("@tauri-apps/api/event");
            const docReimportedUnlisten = await listen("doc-reimported", () => {
                console.log("[sync] Doc re-imported from ticket — marking provisioning needed");
                markProvisioningNeeded();
                void autoSyncRound(true);
            });
            cleanups.push(docReimportedUnlisten);
        } catch {
            // Tauri events not available.
        }
    }

    // 5d. Sync doc missing — a paired device has no sync_doc_id (caused by
    //     a pairing bug where the host didn't persist it). The Rust side
    //     already tried to recover from the stored ticket. If that failed,
    //     the user must re-pair. Warn so the user knows why sync shows
    //     "synced" but no data arrives.
    if (isTauri()) {
        try {
            const { listen } = await import("@tauri-apps/api/event");
            const syncDocMissingUnlisten = await listen<{ deviceId: string; deviceName: string }>(
                "sync-doc-missing",
                (event) => {
                    console.warn(
                        `[sync] Paired device "${event.payload.deviceName}" has no sync doc. ` +
                        `Sync will connect but exchange no data. Re-pair to fix.`,
                    );
                    setStatus("error", `Re-pair required with ${event.payload.deviceName}`);
                },
            );
            cleanups.push(syncDocMissingUnlisten);
        } catch {
            // Tauri events not available.
        }
    }

    // 6. Android: start ForegroundService + schedule WorkManager
    if (isMobile()) {
        try {
            await startAndroidSyncWorker();
            await updateSyncNotification("Auto-sync enabled");
            await schedulePeriodicSyncWork();
        } catch {
            // Android worker not available.
        }
    }

    _autoSyncCleanups = cleanups;
    return () => stopAutoSync();
}

/**
 * Stop all auto-sync mechanisms.
 */
export function stopAutoSync(): void {
    for (const cleanup of _autoSyncCleanups) {
        cleanup();
    }
    _autoSyncCleanups = [];
    if (_autoSyncTimer) {
        clearInterval(_autoSyncTimer);
        _autoSyncTimer = null;
    }
    if (_mutationSyncTimer) {
        clearTimeout(_mutationSyncTimer);
        _mutationSyncTimer = null;
    }
    _dataDirty = false;
    setAutoSyncFlag(false).catch(e => console.error("[catch]", e));

    // Android: stop ForegroundService + cancel WorkManager
    if (isMobile()) {
        stopAndroidSyncWorker().catch(e => console.error("[catch]", e));
        cancelPeriodicSyncWork().catch(e => console.error("[catch]", e));
    }
}

// ─── iroh-docs CRDT Sync (replaces legacy LWW merge) ───

/** Invoke the iroh-docs Tauri command to create a shared document for a peer. */
export async function docsCreateSyncDoc(peerDeviceId: string): Promise<string | null> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string>("docs_create_sync_doc", { peerDeviceId });
    } catch { return null; }
}

/** Invoke the iroh-docs Tauri command to import a shared document from a ticket. */
export async function docsImportSyncDoc(
    peerDeviceId: string,
    ticket: string,
): Promise<boolean> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("docs_import_sync_doc", { peerDeviceId, ticketStr: ticket });
        return true;
    } catch { return false; }
}

/** Invoke the iroh-docs Tauri command to write a key-value entry to the sync doc. */
export async function docsSetEntry(key: string, value: string): Promise<boolean> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("docs_set_entry", { key, value });
        return true;
    } catch { return false; }
}

/** Invoke the iroh-docs Tauri command to read all entries from the sync doc. */
export async function docsGetAllEntries(): Promise<Record<string, string> | null> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<Record<string, string>>("docs_get_all_entries");
    } catch { return null; }
}

/** Trigger iroh-docs reconciliation with a specific peer. Returns null on success, error message on failure. */
export async function docsSyncNow(peerDeviceId: string): Promise<string | null> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("docs_sync_now timed out")), 20_000)
        );
        await Promise.race([
            invoke("docs_sync_now", { peerDeviceId }),
            timeout,
        ]);
        return null; // success
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[sync] docsSyncNow failed: ${msg}`);
        return msg;
    }
}

// ─── iroh-docs ↔ Zustand bridge ───

/**
 * Provision all Zustand state to iroh-docs entries.
 * Replaces buildDomainsAndManifest(). Each domain becomes a key-value entry.
 */
export async function provisionToIrohDocs(): Promise<boolean> {
    try {
        const lib = useLibraryStore.getState();
        const vocab = useVocabularyStore.getState();
        const rss = useRssStore.getState();
        const settings = useSettingsStore.getState();

        // Write each book as a per-entity entry (book:<id>).
        // We intentionally do NOT write a domain-level "books" array because
        // docs_get_all_entries() concatenates JSON arrays from all doc authors,
        // which would double the book count (192 + 192 = 384 → leads to
        // duplicate/syncedWithoutFile entries). The per-entity keys carry
        // exactly one entry per book per author, avoiding concatenation.
        // The receiver's live listener processes book:<id> events progressively,
        // and the full hydrate path extracts per-entity keys from the doc.
        const serializeBook = (book: typeof lib.books[number]) => {
            const { filePath: _f, storagePath: _s, coverPath, locations: _l, ...stripped } = book;
            return JSON.stringify({
                ...stripped,
                ...(book.blobHash ? { blobHash: book.blobHash } : {}),
                ...(book.coverBlobHash ? { coverBlobHash: book.coverBlobHash } : {}),
                ...(coverPath && !coverPath.startsWith("data:") ? { coverPath } : {}),
            });
        };

        for (const book of lib.books) {
            try {
                const key = `book:${book.id}`;
                markSelfOriginated(key);
                await docsSetEntry(key, serializeBook(book));
            } catch (e) {
                console.error(`[sync] Failed to provision book ${book.id} (${book.title || "unknown"}): ${e}`);
            }
        }
        markSelfOriginated("annotations");
        await docsSetEntry("annotations", JSON.stringify(lib.annotations));
        markSelfOriginated("collections");
        await docsSetEntry("collections", JSON.stringify(lib.collections));
        markSelfOriginated("deletion_tombstones");
        await docsSetEntry("deletion_tombstones", JSON.stringify(lib.deletionTombstones));
        markSelfOriginated("vocabulary");
        await docsSetEntry("vocabulary", JSON.stringify(vocab.vocabularyTerms));
        markSelfOriginated("settings");
        await docsSetEntry("settings", JSON.stringify({
            ...settings.settings,
            _settingsUpdatedAt: settings.settingsLastModifiedAt || new Date().toISOString(),
        }));
        markSelfOriginated("reading_stats");
        await docsSetEntry("reading_stats", JSON.stringify(settings.stats));
        markSelfOriginated("rss_feeds");
        await docsSetEntry("rss_feeds", JSON.stringify(rss.feeds));
        markSelfOriginated("rss_articles");
        await docsSetEntry("rss_articles", JSON.stringify(rss.articles));

        return true;
    } catch {
        return false;
    }
}

/**
 * Hydrate Zustand from iroh-docs entries.
 * Reads all entries (merged from all authors by docs_get_all_entries),
 * then feeds them to mergeIncomingData for proper LWW merging per entity.
 */
export async function hydrateFromIrohDocs(): Promise<string[]> {
    const domainsUpdated: string[] = [];
    try {
        const entries = await docsGetAllEntries();
        if (!entries || Object.keys(entries).length === 0) return domainsUpdated;

        // Pass all entries through mergeIncomingData which handles
        // per-entity LWW dedup via the existing mergeBooks/mergeAnnotations
        // etc. functions. This is the same merge path used by the legacy
        // sync protocol — it handles tombstones first, dedup by ID, etc.
        const localSettingsUpdatedAt = useSettingsStore.getState().settingsLastModifiedAt || new Date().toISOString();
        const { domainsUpdated: merged } = await mergeIncomingData(
            entries,
            localSettingsUpdatedAt,
        );
        return merged;
    } catch {}

    return domainsUpdated;
}

// ─── iroh-blobs File/Cover Transfer ───

/** Add bytes to the iroh-blobs store (for covers, small files). Returns BLAKE3 hash. */
export async function blobsAddBytes(data: Uint8Array): Promise<string | null> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string>("blobs_add_bytes", { data: Array.from(data) });
    } catch { return null; }
}

/** Download bytes from a peer's iroh-blobs store. */
export async function blobsDownloadBytes(
    peerDeviceId: string,
    hash: string,
): Promise<Uint8Array | null> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result = await invoke<number[]>("blobs_download_bytes", {
            peerDeviceId,
            hashStr: hash,
        });
        return new Uint8Array(result);
    } catch { return null; }
}

// ─── Zustand → iroh-docs Bridge (real-time mutation sync) ───

const _docsDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DOCS_DEBOUNCE_MS = 500;

// Track keys that OUR bridge recently wrote to iroh-docs so the live
// listener can skip the reflected event. Without this, every local write
// triggers a docs-entry-changed event that mergeBooks processes, creating
// new objects for ALL books, calling setState, and triggering the bridge
// to re-process all books. With 5000 books this is 25M ops.
const _selfOriginatedKeys = new Set<string>();
const SELF_ORIGINATED_KEY_TTL_MS = 8000;

function isSelfOriginatedKey(key: string): boolean {
    return _selfOriginatedKeys.has(key);
}

function markSelfOriginated(key: string): void {
    _selfOriginatedKeys.add(key);
    setTimeout(() => _selfOriginatedKeys.delete(key), SELF_ORIGINATED_KEY_TTL_MS);
}

function scheduleDocsWrite(domain: string, fn: () => void, selfOriginatedKey?: string): void {
    if (selfOriginatedKey) {
        markSelfOriginated(selfOriginatedKey);
    }
    const existing = _docsDebounceTimers.get(domain);
    if (existing) clearTimeout(existing);
    _docsDebounceTimers.set(domain, setTimeout(() => {
        _docsDebounceTimers.delete(domain);
        fn();
    }, DOCS_DEBOUNCE_MS));
}

/** Add a file to iroh-blobs store by path. Returns BLAKE3 hash. */
export async function blobsAddFile(filePath: string): Promise<string | null> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string>("blobs_add_file", { filePath });
    } catch { return null; }
}

/** Check if a blob with the given hash exists in the local iroh-blobs FsStore. */
export async function blobsHasHash(hash: string): Promise<boolean> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<boolean>("blobs_has_hash", { hashStr: hash });
    } catch { return false; }
}

/** Download a blob from a peer and export it to a file path. */
export async function blobsDownloadFile(
    peerDeviceId: string,
    hash: string,
    destPath: string,
): Promise<boolean> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("blobs_download_file", { peerDeviceId, hashStr: hash, destPath });
        return true;
    } catch (e) {
        console.error(`[blob-download] blobs_download_file failed: hash=${hash.substring(0, 16)}... dest=${destPath.substring(destPath.lastIndexOf("/") + 1)} error=${e}`);
        return false;
    }
}

// ─── Blobs Garbage Collection ───

/** Remove orphaned blobs from the iroh-blobs FsStore. Collects all
 *  blobHash/coverBlobHash values from current books, then tells the
 *  Rust backend to delete any stored blob not in the keep list. */
export async function runBlobsGarbageCollection(): Promise<number> {
    if (!isTauri()) return 0;
    const books = useLibraryStore.getState().books;
    const keep = new Set<string>();
    for (const b of books) {
        if (b.blobHash) keep.add(b.blobHash);
        if (b.coverBlobHash) keep.add(b.coverBlobHash);
    }
    if (keep.size === 0) return 0;
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<number>("blobs_gc", { keepHashes: Array.from(keep) });
    } catch {
        return 0;
    }
}

/**
 * Subscribe to all Zustand stores and write mutations to iroh-docs.
 * Call ONCE at app startup after docs API is available.
 * Returns a cleanup function to unsubscribe all listeners.
 */
export function subscribeZustandToIrohDocs(): () => void {
    const unsubs: (() => void)[] = [];

    // Library store: books, annotations, collections, tombstones
    let prevBooks = useLibraryStore.getState().books;
    let prevAnnotations = useLibraryStore.getState().annotations;
    let prevCollections = useLibraryStore.getState().collections;
    let prevTombstones = useLibraryStore.getState().deletionTombstones;

    const serializeBook = (book: ReturnType<typeof useLibraryStore.getState>["books"][number]) => {
        const { filePath: _f, storagePath: _s, coverPath, locations: _l, ...stripped } = book;
        return JSON.stringify({
            ...stripped,
            ...(book.blobHash ? { blobHash: book.blobHash } : {}),
            ...(book.coverBlobHash ? { coverBlobHash: book.coverBlobHash } : {}),
            ...(coverPath && !coverPath.startsWith("data:") ? { coverPath } : {}),
        });
    };

    // Cache of last serialized form per book ID — avoids re-serializing
    // all 192 books when only 1 book changed (common case: reading progress).
    const _bookSerializedCache = new Map<string, string>();

    unsubs.push(useLibraryStore.subscribe((state) => {
        if (_bridgePaused) return;  // skip during initial provisioning burst
        if (state.books !== prevBooks) {
            const oldBooks = prevBooks;
            prevBooks = state.books;

            const oldMap = new Map(oldBooks.map(b => [b.id, b]));
            const newIdSet = new Set(state.books.map(b => b.id));
            const hasDeletions = oldBooks.length !== state.books.length
                || oldBooks.some(b => !newIdSet.has(b.id));

            if (!hasDeletions) {
                // Common case: same books, in-place updates. Use cached
                // serialization to avoid re-serializing all 192 books
                // when only 1 book changed (reading progress, favorite, etc.).
                for (const book of state.books) {
                    const oldBook = oldMap.get(book.id);
                    if (!oldBook) {
                        const serialized = serializeBook(book);
                        _bookSerializedCache.set(book.id, serialized);
                        scheduleDocsWrite("book:" + book.id, () =>
                            docsSetEntry("book:" + book.id, serialized), "book:" + book.id);
                    } else if (book !== oldBook) {
                        const cached = _bookSerializedCache.get(book.id);
                        if (cached === undefined) {
                            const serialized = serializeBook(book);
                            _bookSerializedCache.set(book.id, serialized);
                            scheduleDocsWrite("book:" + book.id, () =>
                                docsSetEntry("book:" + book.id, serialized), "book:" + book.id);
                        } else {
                            const currSerialized = serializeBook(book);
                            if (currSerialized !== cached) {
                                _bookSerializedCache.set(book.id, currSerialized);
                                scheduleDocsWrite("book:" + book.id, () =>
                                    docsSetEntry("book:" + book.id, currSerialized), "book:" + book.id);
                            }
                        }
                    }
                }
            } else {
                // Deletions: different book IDs, serialize all. Clear cache
                // since the entire book set changed.
                _bookSerializedCache.clear();
                for (const book of state.books) {
                    const prevBook = oldMap.get(book.id);
                    const currSerialized = serializeBook(book);
                    _bookSerializedCache.set(book.id, currSerialized);
                    if (!prevBook) {
                        scheduleDocsWrite("book:" + book.id, () =>
                            docsSetEntry("book:" + book.id, currSerialized), "book:" + book.id);
                    } else {
                        const prevSerialized = serializeBook(prevBook);
                        if (currSerialized !== prevSerialized) {
                            scheduleDocsWrite("book:" + book.id, () =>
                                docsSetEntry("book:" + book.id, currSerialized), "book:" + book.id);
                        }
                    }
                }
            }
        }
        if (state.annotations !== prevAnnotations) {
            const prev = prevAnnotations;
            prevAnnotations = state.annotations;
            const currMap = new Map(state.annotations.map(a => [a.id, a]));
            const prevMap = new Map(prev.map(a => [a.id, a]));
            const hasDeletions = [...prevMap.keys()].some(id => !currMap.has(id));
            if (hasDeletions) {
                scheduleDocsWrite("annotations", () =>
                    docsSetEntry("annotations", JSON.stringify(state.annotations)), "annotations");
            } else {
                for (const [id, ann] of currMap) {
                    if (!prevMap.has(id) || JSON.stringify(ann) !== JSON.stringify(prevMap.get(id)!)) {
                        scheduleDocsWrite("annotation:" + id, () =>
                            docsSetEntry("annotation:" + id, JSON.stringify(ann)), "annotation:" + id);
                    }
                }
            }
        }
        if (state.collections !== prevCollections) {
            const prev = prevCollections;
            prevCollections = state.collections;
            const currMap = new Map(state.collections.map(c => [c.id, c]));
            const prevMap = new Map(prev.map(c => [c.id, c]));
            const hasDeletions = [...prevMap.keys()].some(id => !currMap.has(id));
            if (hasDeletions) {
                scheduleDocsWrite("collections", () =>
                    docsSetEntry("collections", JSON.stringify(state.collections)), "collections");
            } else {
                for (const [id, col] of currMap) {
                    if (!prevMap.has(id) || JSON.stringify(col) !== JSON.stringify(prevMap.get(id)!)) {
                        scheduleDocsWrite("collection:" + id, () =>
                            docsSetEntry("collection:" + id, JSON.stringify(col)), "collection:" + id);
                    }
                }
            }
        }
        if (state.deletionTombstones !== prevTombstones) {
            prevTombstones = state.deletionTombstones;
            scheduleDocsWrite("deletion_tombstones", () =>
                docsSetEntry("deletion_tombstones", JSON.stringify(state.deletionTombstones)), "deletion_tombstones");
        }
    }));

    // Vocabulary store
    let prevVocab = useVocabularyStore.getState().vocabularyTerms;
    unsubs.push(useVocabularyStore.subscribe((state) => {
        if (state.vocabularyTerms !== prevVocab) {
            prevVocab = state.vocabularyTerms;
            scheduleDocsWrite("vocabulary", () => docsSetEntry("vocabulary", JSON.stringify(state.vocabularyTerms)), "vocabulary");
        }
    }));

    // RSS store
    let prevFeeds = useRssStore.getState().feeds;
    let prevArticles = useRssStore.getState().articles;
    unsubs.push(useRssStore.subscribe((state) => {
        if (state.feeds !== prevFeeds) {
            prevFeeds = state.feeds;
            scheduleDocsWrite("rss_feeds", () => docsSetEntry("rss_feeds", JSON.stringify(state.feeds)), "rss_feeds");
        }
        if (state.articles !== prevArticles) {
            prevArticles = state.articles;
            scheduleDocsWrite("rss_articles", () => docsSetEntry("rss_articles", JSON.stringify(state.articles)), "rss_articles");
        }
    }));

    // Settings store
    let prevSettings = useSettingsStore.getState().settings;
    let prevStats = useSettingsStore.getState().stats;
    unsubs.push(useSettingsStore.subscribe((state) => {
        if (state.settings !== prevSettings) {
            prevSettings = state.settings;
            scheduleDocsWrite("settings", () => docsSetEntry("settings", JSON.stringify({
                ...state.settings,
                _settingsUpdatedAt: useSettingsStore.getState().settingsLastModifiedAt || new Date().toISOString(),
            })), "settings");
        }
        if (state.stats !== prevStats) {
            prevStats = state.stats;
            scheduleDocsWrite("reading_stats", () => docsSetEntry("reading_stats", JSON.stringify(state.stats)), "reading_stats");
        }
    }));

    return () => {
        for (const unsub of unsubs) unsub();
        for (const t of _docsDebounceTimers.values()) clearTimeout(t);
        _docsDebounceTimers.clear();
    };
}
