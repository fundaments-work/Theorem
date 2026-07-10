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
    irohStart,
    getIncomingSyncData,
    pullBookFiles,
    pullBookCovers,
    getPairedDevices,
    updateSyncNotification,
    setAutoSyncFlag,
} from "./device-sync";
import {
    isDaemonRunning,
    pushSyncDataToDaemon,
    triggerDaemonSync,
    configureDaemon,
} from "./device-sync-daemon";
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
        books: JSON.stringify(library.books.map(({ filePath: _f, storagePath: _s, coverPath, locations: _l, ...book }) => ({
            ...book,
            // Strip data URL covers — they are base64-encoded images that can
            // be 100+ KB each, blowing up the JSON payload to hundreds of MB.
            // The peer pulls covers on-demand via the dedicated cover pull endpoint.
            // Strip locations (foliate-js pagination data) — stored in SQLite BLOB,
            // never needed for sync; can be 50-100MB across opened books.
            ...(coverPath && !coverPath.startsWith("data:") ? { coverPath } : {}),
        }))),
        annotations: JSON.stringify(library.annotations),
        collections: JSON.stringify(library.collections),
        deletion_tombstones: JSON.stringify(gcTombstones),
        vocabulary: JSON.stringify(vocabulary.vocabularyTerms),
        settings: JSON.stringify(settingsPayload),
        reading_stats: JSON.stringify(settingsStore.stats),
        rss_feeds: JSON.stringify(rss.feeds),
        rss_articles: JSON.stringify((() => {
            const MAX_ARTICLES = 500;
            const MAX_ARTICLE_AGE_DAYS = 30;
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - MAX_ARTICLE_AGE_DAYS);
            const filtered = rss.articles
                .filter(article => {
                    const articleDate = article.publishedAt || article.fetchedAt;
                    return new Date(articleDate) >= cutoffDate;
                })
                .slice(0, MAX_ARTICLES);
            return filtered.map(article => ({
                ...article,
                content: article.content.length > 50000
                    ? article.content.slice(0, 50000) + '... [truncated]'
                    : article.content,
            }));
        })()),
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

    const manifest: Record<string, { version: number; itemCount: number; lastModifiedAt: string; contentHash: string }> = {
        books: {
            version: library.books.reduce((sum, b) => {
                const t = new Date(b.lastReadAt || b.addedAt || 0).getTime();
                return sum + Math.floor(t / 1000);
            }, 0),
            itemCount: library.books.length,
            lastModifiedAt: computeLatestDate(library.books, b => b.lastReadAt || b.addedAt),
            contentHash: contentHashes["books"],
        },
        annotations: {
            version: library.annotations.length,
            itemCount: library.annotations.length,
            lastModifiedAt: computeLatestDate(library.annotations, a => a.updatedAt || a.createdAt),
            contentHash: contentHashes["annotations"],
        },
        collections: {
            version: library.collections.length,
            itemCount: library.collections.length,
            lastModifiedAt: computeLatestDate(library.collections, c => c.createdAt),
            contentHash: contentHashes["collections"],
        },
        deletion_tombstones: {
            version: gcTombstones.length,
            itemCount: gcTombstones.length,
            lastModifiedAt: computeLatestDate(gcTombstones, t => t.deletedAt),
            contentHash: contentHashes["deletion_tombstones"],
        },
        vocabulary: {
            version: vocabulary.vocabularyTerms.length,
            itemCount: vocabulary.vocabularyTerms.length,
            lastModifiedAt: computeLatestDate(vocabulary.vocabularyTerms, v => v.updatedAt || v.createdAt),
            contentHash: contentHashes["vocabulary"],
        },
        settings: {
            version: 1, // Settings is a single object, always version 1.
            itemCount: 1,
            lastModifiedAt: settingsUpdatedAt,
            contentHash: contentHashes["settings"],
        },
        reading_stats: {
            version: 1,
            itemCount: 1,
            lastModifiedAt: settingsStore.stats.lastReadDate ?? new Date(0).toISOString(),
            contentHash: contentHashes["reading_stats"],
        },
        rss_feeds: {
            version: rss.feeds.length,
            itemCount: rss.feeds.length,
            lastModifiedAt: computeLatestDate(rss.feeds, f => f.lastFetched || f.addedAt),
            contentHash: contentHashes["rss_feeds"],
        },
        rss_articles: {
            version: rss.articles.length,
            itemCount: rss.articles.length,
            lastModifiedAt: computeLatestDate(rss.articles, a => a.fetchedAt),
            contentHash: contentHashes["rss_articles"],
        },
    };

    return { domains, manifest, library, vocabulary, rss, settingsStore, settingsUpdatedAt };
}

// ─── Merge incoming data ───

async function mergeIncomingData(
    incomingMap: Record<string, string>,
    localSettingsUpdatedAt?: string,
): Promise<{ domainsUpdated: string[] }> {
    const domainsUpdated: string[] = [];
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
    } catch {
        // If validation fails entirely, fall through with raw incomingMap.
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
    }

    // Read a snapshot of current state for merges that depends on it.
    let currentLibState = useLibraryStore.getState();
    // Apply pending patches so subsequent domain merges work on the pruned state.
    if (Object.keys(libraryPatch).length > 0) {
        currentLibState = { ...currentLibState, ...libraryPatch };
    }

    if (safeMap["books"]) {
        try {
            const incoming = JSON.parse(safeMap["books"]);
            if (Array.isArray(incoming)) {
                const merged = mergeBooks(incoming, currentLibState.books, allTombstones);
                applyLibraryPatch({ books: merged });
                markUpdated("books");

                const incomingWithCovers = (incoming as { id: string; coverPath?: string }[])
                    .filter((b) => b.coverPath && b.coverPath.startsWith("data:"));

                await Promise.allSettled(incomingWithCovers.map(async (inc) => {
                    try {
                        const response = await fetch(inc.coverPath!);
                        const blob = await response.blob();
                        if (blob.size > 0) await saveCoverImage(inc.id, blob);
                    } catch {}
                }));
                currentLibState = { ...currentLibState, books: merged };
            }
        } catch (e) {
        }
    }

    if (safeMap["annotations"]) {
        try {
            const incoming = JSON.parse(safeMap["annotations"]);
            if (Array.isArray(incoming)) {
                const merged = mergeAnnotations(incoming, currentLibState.annotations, allTombstones);
                applyLibraryPatch({ annotations: merged });
                markUpdated("annotations");
                currentLibState = { ...currentLibState, annotations: merged };
            }
        } catch (e) {
        }
    }

    if (safeMap["collections"]) {
        try {
            const incoming = JSON.parse(safeMap["collections"]);
            if (Array.isArray(incoming)) {
                const merged = mergeCollections(incoming, currentLibState.collections, allTombstones);
                applyLibraryPatch({ collections: merged });
                markUpdated("collections");
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
                const merged = mergeVocabulary(incoming, useVocabularyStore.getState().vocabularyTerms, allTombstones);
                useVocabularyStore.setState({ vocabularyTerms: merged });
                markUpdated("vocabulary");
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
            useSettingsStore.setState({ settings: merged });
            markUpdated("settings");
        } catch (e) {
        }
    }

    if (safeMap["reading_stats"]) {
        try {
            const incoming = JSON.parse(safeMap["reading_stats"]);
            if (incoming && typeof incoming === "object") {
                const merged = mergeReadingStats(incoming, useSettingsStore.getState().stats);
                useSettingsStore.setState({ stats: merged });
                markUpdated("reading_stats");
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
                const result = mergeRssFeeds(incoming, useRssStore.getState().feeds, allTombstones);
                useRssStore.setState({ feeds: result.feeds });
                feedIdMap = result.feedIdMap;
                markUpdated("rss_feeds");
            }
        } catch (e) {
        }
    }

    if (safeMap["rss_articles"]) {
        try {
            const incoming = JSON.parse(safeMap["rss_articles"]);
            if (Array.isArray(incoming)) {
                const merged = mergeRssArticles(incoming, useRssStore.getState().articles, feedIdMap, allTombstones);
                useRssStore.setState({ articles: merged });
                markUpdated("rss_articles");
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
    console.log(`[sync] needFiles: ${needFiles.length} / ${books.length} books syncedWithoutFile=true`, needFiles.length > 0 ? `first: ${needFiles[0].id}` : '');
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
                            const completed = payload.completed_files ?? 0;
                            const total = payload.total_files ?? 0;
                            setStatus("syncing", `Transferring ${completed}/${total} files...`);
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
                for (const _f of result.failed) { /* logged elsewhere */ }
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
    const booksMissingCover = syncedBookIds.filter(id => !books.find(b => b.id === id)?.coverPath);
    if (booksMissingCover.length > 0) {
        setStatus("syncing", `Fletching ${booksMissingCover.length} cover images...`);
        try {
            const result = await pullBookCovers(peerDeviceId, booksMissingCover);
            for (const [bookId, dataUrl] of Object.entries(result.covers)) {
                try {
                    const blob = await (await fetch(dataUrl)).blob();
                    const coverPath = await saveCoverImage(bookId, blob);
                    useLibraryStore.getState().updateBook(bookId, { coverPath });
                } catch {
                }
            }

            const parts: string[] = [];
            const coverCount = Object.keys(result.covers).length;
            if (coverCount > 0) parts.push(`${coverCount} covers transferred`);
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
        // Provision data FIRST so the server never starts without data.
        await provisionSyncData();
        await irohStart();

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
    if (_isMerging) {
        return { success: false, domainsUpdated: [], error: "Sync already in progress" };
    }
    _isMerging = true;
    const log = (msg: string) => {
        onProgress?.(msg);
    };

    try {
        setStatus("syncing", "Preparing data...");
        log("Gathering local data snapshot...");

        // ── iroh-docs CRDT metadata sync ──
        // Provision all Zustand state to iroh-docs entries.
        await provisionToIrohDocs();

        log("Ensuring sync responder is ready...");
        await ensureResponderSyncReady();

        // Also provision to the legacy protocol for responder mode
        const { domains, manifest, settingsUpdatedAt } = await buildDomainsAndManifest();
        await setSyncData(domains, manifest, buildBookFilePaths());

        // Trigger iroh-docs reconciliation with the peer
        log("Syncing via iroh-docs...");
        await docsSyncNow(peerDeviceId);

        // Give iroh-docs a moment to reconcile over gossip
        await new Promise(r => setTimeout(r, 2000));

        // Hydrate merged state from iroh-docs back to Zustand
        const domainsUpdated = await hydrateFromIrohDocs();

        // Also run the legacy protocol as fallback
        log("Initiating sync with peer...");
        try {
            const incomingMap = await initiateSync(peerDeviceId);
            const incomingDomainCount = Object.keys(incomingMap).length;
            if (incomingDomainCount > 0) {
                const { domainsUpdated: legacyUpdated } = await mergeIncomingData(
                    incomingMap, settingsUpdatedAt,
                );
                for (const d of legacyUpdated) {
                    if (!domainsUpdated.includes(d)) domainsUpdated.push(d);
                }
            }
        } catch {}
        // ── end metadata sync ──

        // Pull missing book files and covers
        const syncedBookIds = useLibraryStore.getState().books.map(b => b.id);
        await pullMissingBookFilesAndCovers(peerDeviceId, syncedBookIds, log);

        const summary = domainsUpdated.length > 0
            ? `Updated: ${domainsUpdated.join(", ")}`
            : "No changes after merge";

        log(`Sync complete. ${summary}`);
        setStatus("synced", summary);
        _dataDirty = false; // successfully synced, reset dirty flag

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
/**
 * Build a map of bookId → absolute file path for all books on this device
 * that have a real, resolvable path (i.e. not a placeholder like sqlite:// or idb://).
 * This lets the Rust responder serve books stored at external OS paths.
 */
function buildBookFilePaths(): Record<string, string> {
    const books = useLibraryStore.getState().books;
    const paths: Record<string, string> = {};
    for (const book of books) {
        const p = book.filePath || book.storagePath;
        if (
            p &&
            !p.startsWith("sqlite://") &&
            !p.startsWith("idb://") &&
            !p.startsWith("browser://") &&
            !p.startsWith("data:")
        ) {
            paths[book.id] = p;
        }
    }
    return paths;
}

export async function provisionSyncData(): Promise<void> {
    const { domains, manifest } = await buildDomainsAndManifest();
    const bookFilePaths = buildBookFilePaths();
    await setSyncData(domains, manifest, bookFilePaths);
}

// ─── Responder-side event listener ───

/** Debounce timer for batching rapid per-domain push events. */
let _syncCompleteTimer: ReturnType<typeof setTimeout> | null = null;
/** Persistent peer device ID — survives across debounced event firings. */
let _lastValidPeerDeviceId: string | undefined;

let _isMerging = false;

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
    if (_isMerging) {
        return;
    }
    _isMerging = true;
    try {
        setStatus("syncing", "Receiving data from peer...");

        const incomingMap = await getIncomingSyncData();
        const domainCount = Object.keys(incomingMap).length;

        if (domainCount === 0) {
            if (peerDeviceId) {
                const responderLog = (_msg: string) => {};
                const needFilesIds = useLibraryStore.getState().books
                    .filter((b) => b.syncedWithoutFile)
                    .map((b) => b.id);
                await pullMissingBookFilesAndCovers(peerDeviceId, needFilesIds, responderLog);
            }
            setStatus("synced", "No new data from peer");
            return;
        }

        setStatus("syncing", "Merging data from peer...");

        // mergeIncomingData reads fresh state internally, so no need to snapshot here.
        // Use the persisted settingsLastModifiedAt for LWW comparison (same as initiator path)
        // instead of generating "now" which biases the responder to always win.
        const localSettingsUpdatedAt = useSettingsStore.getState().settingsLastModifiedAt || new Date(0).toISOString();

        const { domainsUpdated } = await mergeIncomingData(
            incomingMap,
            localSettingsUpdatedAt,
        );

        const summary = domainsUpdated.length > 0
            ? `Received: ${domainsUpdated.join(", ")}`
            : "No changes after merge";


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
            
            const responderLog = (_msg: string) => {};
            await pullMissingBookFilesAndCovers(peerDeviceId, syncedBookIds, responderLog);
        }

        setStatus("synced", summary);
        _dataDirty = false; // synced by peer, reset dirty flag

        // Re-provision so the server has updated data for the next sync.
        await provisionSyncData();
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        setStatus("error", `Responder merge failed: ${errMsg}`);
    } finally {
        _isMerging = false;
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

    return responderEventUnlisten;
}

// ─── Auto-Sync ───

/** How often to auto-sync in the background (milliseconds). */
const AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** Delay before the first sync after app startup. */
const STARTUP_SYNC_DELAY_MS = 15000;

/** Debounce window for mutation-triggered sync. */
const MUTATION_SYNC_DEBOUNCE_MS = 5000;

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
        let allPeersSynced = true;
        for (const device of devices) {
            const result = await runDeviceSync(device.deviceId);
            if (!result.success) {
                allPeersSynced = false;
            }
        }
        _dataDirty = !allPeersSynced;
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
 * If the sync daemon is running, pushes latest data to it.
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

        // If daemon is available, push data to it and let it handle sync.
        if (await isDaemonRunning().catch(() => false)) {
            const built = await buildDomainsAndManifest();
            const bfp = buildBookFilePaths();
            await pushSyncDataToDaemon(built.domains, built.manifest, bfp);
            // Also provision the main process so file-transfer responders
            // have up-to-date book_file_paths for serving book files.
            try {
                await setSyncData(built.domains, built.manifest, bfp);
            } catch {
                // Non-critical — daemon handles sync rounds.
            }
            await triggerDaemonSync().catch(() => {});
            return;
        }

        // No daemon: provision data to Rust server, then wake the
        // background sync loop so it picks up the new data immediately
        // instead of waiting for the next timer tick.
        try {
            await provisionSyncData();
        } catch {
            // Non-critical — data will be provisioned on next sync.
        }
        void autoSyncRound();
    }, MUTATION_SYNC_DEBOUNCE_MS);

    // Wake Rust background sync immediately. The sync loop will see the
    // bumped data_version and check for changes. If the provisionSyncData
    // above hasn't fired yet, the sync loop will find the data unchanged
    // and skip — but the next tick (after the debounce) will pick it up.
    if (isTauri()) {
        import("./device-sync").then((mod) => {
            mod.wakeBackgroundSync().catch(() => {});
        });
    }
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
    setAutoSyncFlag(true).catch(() => {});

    if (!isTauri()) {
        return () => {};
    }

    // Check if the sync daemon is running — if so, delegate to it.
    const daemonAvailable = await isDaemonRunning();
    if (daemonAvailable) {
        const cleanups: Array<() => void> = [];

        // Push initial data snapshot to daemon and main process.
        const built = await buildDomainsAndManifest();
        const bfp = buildBookFilePaths();
        await pushSyncDataToDaemon(built.domains, built.manifest, bfp);
        try {
            await setSyncData(built.domains, built.manifest, bfp);
        } catch {
            // Non-critical.
        }

        // Configure daemon with our auto-sync preference.
        const { settings } = useSettingsStore.getState();
        await configureDaemon({
            auto_sync_enabled: settings.deviceSync?.autoSyncEnabled ?? true,
        });

        // Still listen for tray events and forward to daemon.
        if (isTauri()) {
            try {
                const { listen } = await import("@tauri-apps/api/event");
                const unlisten = await listen("tray-sync-now", () => {
                    void triggerDaemonSync();
                });
                cleanups.push(unlisten);
            } catch {
                // Tray event not available
            }
        }

        _autoSyncCleanups = cleanups;
        return () => stopAutoSync();
    }

    // Fallback: JS-based auto-sync (same as before).
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
    const onVisibilityChange = () => {
        if (document.visibilityState === "visible") {
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
    setAutoSyncFlag(false).catch(() => {});
    configureDaemon({ auto_sync_enabled: false }).catch(() => {});
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

/** Trigger iroh-docs reconciliation with a specific peer. */
export async function docsSyncNow(peerDeviceId: string): Promise<boolean> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("docs_sync_now", { peerDeviceId });
        return true;
    } catch { return false; }
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

        await docsSetEntry("books", JSON.stringify(lib.books.map(
            ({ filePath: _f, storagePath: _s, coverPath, locations: _l, ...book }) => ({
                ...book,
                ...(coverPath && !coverPath.startsWith("data:") ? { coverPath } : {}),
            })
        )));
        await docsSetEntry("annotations", JSON.stringify(lib.annotations));
        await docsSetEntry("collections", JSON.stringify(lib.collections));
        await docsSetEntry("deletion_tombstones", JSON.stringify(lib.deletionTombstones));
        await docsSetEntry("vocabulary", JSON.stringify(vocab.vocabularyTerms));
        await docsSetEntry("settings", JSON.stringify(settings.settings));
        await docsSetEntry("reading_stats", JSON.stringify(settings.stats));
        await docsSetEntry("rss_feeds", JSON.stringify(rss.feeds));
        await docsSetEntry("rss_articles", JSON.stringify(rss.articles));

        return true;
    } catch {
        return false;
    }
}

/**
 * Hydrate Zustand from iroh-docs entries.
 * Replaces mergeIncomingData(). Reads all entries and applies to stores.
 */
export async function hydrateFromIrohDocs(): Promise<string[]> {
    const domainsUpdated: string[] = [];
    try {
        const entries = await docsGetAllEntries();
        if (!entries) return domainsUpdated;

        if (entries["books"]) {
            try {
                const books = JSON.parse(entries["books"]);
                if (Array.isArray(books)) {
                    useLibraryStore.setState({ books });
                    domainsUpdated.push("books");
                }
            } catch {}
        }
        if (entries["annotations"]) {
            try {
                const annotations = JSON.parse(entries["annotations"]);
                if (Array.isArray(annotations)) {
                    useLibraryStore.setState({ annotations });
                    domainsUpdated.push("annotations");
                }
            } catch {}
        }
        if (entries["collections"]) {
            try {
                const collections = JSON.parse(entries["collections"]);
                if (Array.isArray(collections)) {
                    useLibraryStore.setState({ collections });
                    domainsUpdated.push("collections");
                }
            } catch {}
        }
        if (entries["deletion_tombstones"]) {
            try {
                const tombstones = JSON.parse(entries["deletion_tombstones"]);
                if (Array.isArray(tombstones)) {
                    useLibraryStore.setState({ deletionTombstones: tombstones });
                    domainsUpdated.push("deletion_tombstones");
                }
            } catch {}
        }
        if (entries["vocabulary"]) {
            try {
                const terms = JSON.parse(entries["vocabulary"]);
                if (Array.isArray(terms)) {
                    useVocabularyStore.setState({ vocabularyTerms: terms });
                    domainsUpdated.push("vocabulary");
                }
            } catch {}
        }
        if (entries["settings"]) {
            try {
                const settings = JSON.parse(entries["settings"]);
                if (settings) {
                    useSettingsStore.setState({ settings });
                    domainsUpdated.push("settings");
                }
            } catch {}
        }
        if (entries["reading_stats"]) {
            try {
                const stats = JSON.parse(entries["reading_stats"]);
                if (stats) {
                    useSettingsStore.setState({ stats });
                    domainsUpdated.push("reading_stats");
                }
            } catch {}
        }
        if (entries["rss_feeds"]) {
            try {
                const feeds = JSON.parse(entries["rss_feeds"]);
                if (Array.isArray(feeds)) {
                    useRssStore.setState({ feeds });
                    domainsUpdated.push("rss_feeds");
                }
            } catch {}
        }
        if (entries["rss_articles"]) {
            try {
                const articles = JSON.parse(entries["rss_articles"]);
                if (Array.isArray(articles)) {
                    useRssStore.setState({ articles });
                    domainsUpdated.push("rss_articles");
                }
            } catch {}
        }
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
