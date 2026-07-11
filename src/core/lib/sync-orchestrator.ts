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
    irohStart,
    getIncomingSyncData,
    getPairedDevices,
    updateSyncNotification,
    setAutoSyncFlag,
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
/** Shared unlisten reference for the iroh-docs live event listener. */
let _docsLiveUnlisten: (() => void) | null = null;

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

    // Aggregate per-entity keys (book:<id>, annotation:<id>, collection:<id>)
    // from the incremental write path into their domain arrays. This allows
    // the incremental subscription path and the full-sync provision path to
    // coexist — the merge pipeline handles both formats transparently.
    const perEntityBooks: Record<string, unknown>[] = [];
    const perEntityAnnotations: Record<string, unknown>[] = [];
    const perEntityCollections: Record<string, unknown>[] = [];
    const perEntityKeys = new Set<string>();

    for (const key of Object.keys(safeMap)) {
        if (key.startsWith("book:") && key !== "books") {
            try {
                const parsed = JSON.parse(safeMap[key]);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    perEntityBooks.push(parsed);
                    perEntityKeys.add(key);
                }
            } catch {}
        } else if (key.startsWith("annotation:") && key !== "annotations") {
            try {
                const parsed = JSON.parse(safeMap[key]);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    perEntityAnnotations.push(parsed);
                    perEntityKeys.add(key);
                }
            } catch {}
        } else if (key.startsWith("collection:") && key !== "collections") {
            try {
                const parsed = JSON.parse(safeMap[key]);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    perEntityCollections.push(parsed);
                    perEntityKeys.add(key);
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
                const merged = mergeBooks(incoming, currentLibState.books, allTombstones);
                console.log(`[sync-merge] books: ${merged.length} after merge (lost ${incoming.length + currentLibState.books.length - merged.length})`);
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

    if (safeMap["annotations"] || perEntityAnnotations.length > 0) {
        try {
            const domainAnns = safeMap["annotations"]
                ? (() => { const p = JSON.parse(safeMap["annotations"]); return Array.isArray(p) ? p : []; })()
                : [];
            const incoming = [...domainAnns, ...perEntityAnnotations];
            if (incoming.length > 0) {
                const merged = mergeAnnotations(incoming, currentLibState.annotations, allTombstones);
                applyLibraryPatch({ annotations: merged });
                markUpdated("annotations");
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
                const currentFeeds = useRssStore.getState().feeds;
                console.log(`[sync-merge] rss_feeds: ${incoming.length} incoming, ${currentFeeds.length} existing`);
                const result = mergeRssFeeds(incoming, currentFeeds, allTombstones);
                console.log(`[sync-merge] rss_feeds: ${result.feeds.length} after merge`);
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
                const currentArticles = useRssStore.getState().articles;
                console.log(`[sync-merge] rss_articles: ${incoming.length} incoming, ${currentArticles.length} existing`);
                const merged = mergeRssArticles(incoming, currentArticles, feedIdMap, allTombstones);
                console.log(`[sync-merge] rss_articles: ${merged.length} after merge`);
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
 * Add local book files to the iroh-blobs store.
 * For each book that has a real file path, add it to blobs and update
 * the book's blobHash so the peer can download it via iroh-blobs.
 */
async function provisionBookFileBlobs(): Promise<void> {
    if (!isTauri()) { console.log("[blob-provision] Skipped: not Tauri"); return; }
    const books = useLibraryStore.getState().books;
    console.log(`[blob-provision] Processing ${books.length} books for blob provisioning`);
    const updates: Array<{ id: string; blobHash?: string; coverBlobHash?: string }> = [];
    let completed = 0;
    let skipped = 0;
    let fromDisk = 0;
    let fromSqlite = 0;
    for (const book of books) {
        // Skip books that already have a valid blobHash — avoids re-reading
        // every book file on every sync startup (192 sequential reads on a
        // 192-book library would take minutes). Only process books that are
        // missing a blobHash (e.g., newly imported, or SQLite books that
        // were skipped before the SQLite-fallthrough fix).
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

/**
 * After metadata merge, attempt to pull the binary book data and covers
 * from the peer using iroh-blobs.
 *
 * For each successfully transferred book file:
 *  - Clears `syncedWithoutFile`
 *  - Sets `storagePath` to the downloaded file path
 *  - Updates `blobHash`
 */
async function pullMissingBookFilesAndCovers(
    peerDeviceId: string,
    _syncedBookIds: string[],
    _log: (msg: string) => void,
): Promise<void> {
    if (!isTauri()) return;
    const books = useLibraryStore.getState().books;
    const needFiles = books.filter((b) => b.syncedWithoutFile === true && b.blobHash);
    const noBlobHash = books.filter((b) => b.syncedWithoutFile === true && !b.blobHash);
    console.log(`[sync] needFiles: ${needFiles.length} with blobHash, ${noBlobHash.length} without blobHash (${books.length} total)`);

    if (needFiles.length === 0) {
        if (noBlobHash.length > 0) {
            console.log(`[sync] ${noBlobHash.length} books have no blobHash — source device must rebuild with blob provisioning`);
        }
        return;
    }

    let appDir = "";
    try {
        const { appDataDir } = await import("@tauri-apps/api/path");
        appDir = await appDataDir();
    } catch {
        console.error("[sync] Failed to get app data dir");
        return;
    }

    // Parallel download with concurrency limit
    const CONCURRENCY = 4;
    let completed = 0;
    let index = 0;
    let failures = 0;

    const downloadBook = async () => {
        while (index < needFiles.length && !_syncCancelled) {
            const book = needFiles[index++];
            const destPath = `${appDir}/book-cache/${book.id}.book`;
            setStatus("syncing", `Downloading ${completed + 1}/${needFiles.length} books...`);
            const success = await blobsDownloadFile(peerDeviceId, book.blobHash!, destPath);
            if (success) {
                completed++;
                useLibraryStore.setState((state) => ({
                    books: state.books.map((b) =>
                        b.id === book.id
                            ? { ...b, syncedWithoutFile: false, filePath: destPath, storagePath: destPath }
                            : b
                    ),
                }));
            } else {
                failures++;
                console.error(`[sync] Failed to download: ${book.title} (${book.id})`);
            }
        }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, needFiles.length) }, () => downloadBook());
    await Promise.all(workers);

    if (_syncCancelled) {
        console.log("[sync] Sync cancelled — aborting file download");
        _syncCancelled = false;
    }

    console.log(`[sync] Downloaded ${completed}/${needFiles.length} files (${failures} failed)`);

    // Also attempt cover downloads for books that have coverBlobHash
    const needCovers = books.filter((b) => b.coverBlobHash && (!b.coverPath || b.coverPath.startsWith("data:")));
    if (needCovers.length > 0) {
        for (const book of needCovers) {
            const bytes = await blobsDownloadBytes(peerDeviceId, book.coverBlobHash!);
            if (bytes && bytes.length > 0) {
                try {
                    const blob = new Blob([Uint8Array.from(bytes)]);
                    const { saveCoverImage } = await import("./storage");
                    await saveCoverImage(book.id, blob);
                } catch {
                }
            }
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

    if (responderReadyPromise) {
        await responderReadyPromise;
        return;
    }

    responderReadyPromise = (async () => {
        // Provision legacy responder data for backward compat.
        await provisionSyncData();
        await irohStart();

        // Compute blob hashes for local book files BEFORE provisioning to
        // iroh-docs. Without this, books written to the doc lack blobHash
        // and peers receive metadata without the ability to download files.
        await provisionBookFileBlobs();

        // Provision ALL local state (books, annotations, RSS, settings,
        // vocabulary, stats) to the iroh-docs doc so paired peers can
        // sync it. Books now include blobHash so the peer can download files.

        if (!responderEventUnlisten) {
            responderEventUnlisten = await initSyncEventListener();
        }

        // Register the iroh-docs live event listener so real-time
        // CRDT updates from the peer are applied to Zustand stores.
        // This must be registered here, not just in startAutoSync(),
        // because startAutoSync has a 15-second startup delay and
        // a manual sync triggered before that would miss all events.
        if (!_docsLiveUnlisten) {
            _docsLiveUnlisten = await initDocsLiveListener();
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
    _currentSyncPeerId = peerDeviceId;
    const log = (msg: string) => {
        onProgress?.(msg);
    };

    // Snapshot book count before sync so the poll loop can detect whether
    // data actually arrived. On a fresh device (0 books), we must not settle
    // quickly — either data arrives or we hit the full timeout.
    const _bookCountBeforeSync = useLibraryStore.getState().books.length;

    try {
        setStatus("syncing", "Preparing data...");
        log("Gathering local data snapshot...");

        // 1. Ensure the iroh Router + responder are ready FIRST so both sides
        //    can accept incoming iroh-docs sync connections. Starting the Router
        //    after docsSyncNow is backwards — the peer's connection attempt
        //    would fail because this device's Router isn't accepting yet.
        log("Starting sync responder...");
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
                setStatus("syncing", `Preparing ${missingHash.length} books...`);
                await provisionBookFileBlobs();
                await provisionToIrohDocs();
            }
        }

        // 3. Set up iroh-docs completion listeners BEFORE triggering sync.
        //    docsSyncNow → doc.start_sync() triggers reconciliation asynchronously.
        //    The PendingContentReady event fires when all content blobs from the
        //    last sync round are available locally. If we register AFTER sync,
        //    we may miss a fast-firing event and wait until the poll timeout.
        log("Waiting for peer data via CRDT sync...");
        setStatus("syncing", "Connecting to peer...");

        let syncResolve: (() => void) | null = null;
        const syncPromise = new Promise<void>((res) => { syncResolve = res; });
        let settled = false;
        const settle = () => { if (!settled) { settled = true; syncResolve?.(); } };

        let contentReadyUnlisten: (() => void) | null = null;
        let syncFinishedUnlisten: (() => void) | null = null;
        try {
            const { listen: evListen } = await import("@tauri-apps/api/event");
            contentReadyUnlisten = await evListen("docs-pending-content-ready", () => {
                // Only settle when books have ACTUALLY arrived. The initial
                // docs-pending-content-ready fires from the auto-import sync
                // (before docsSyncNow even starts) with 0 data. Settling on
                // that would return "Synced 0 books" before the real sync
                // completes. This is the critical fix for the 0-books-after-
                // re-pairing issue.
                const currentBooks = useLibraryStore.getState().books.length;
                if (currentBooks > 0) {
                    console.log(`[sync] Received docs-pending-content-ready with ${currentBooks} books — settling`);
                    settle();
                } else {
                    console.log("[sync] Received docs-pending-content-ready with 0 books — waiting for actual data");
                }
            });
            syncFinishedUnlisten = await evListen("docs-sync-finished", () => {
                console.log("[sync] Received docs-sync-finished — reconciliation complete");
            });
        } catch {}

        // 4. Trigger iroh-docs CRDT sync with the peer.
        log("Syncing with peer via iroh-docs...");
        const docsSynced = await docsSyncNow(peerDeviceId);
        if (!docsSynced) {
            log("Warning: iroh-docs sync initiation returned false");
            // If docsSyncNow failed (no shared doc, peer unreachable), don't
            // sit in a poll loop — return immediately with a clear error.
            if (_bookCountBeforeSync === 0) {
                // Fresh device with no pairing → immediate failure.
                return { success: false, domainsUpdated: [], error: "No sync document — device may need re-pairing after data reset" };
            }
        }

        // 5. Also provision the legacy responder data (file serving, etc.)
        try {
            const { domains, manifest } = await buildDomainsAndManifest();
            await setSyncData(domains, manifest, buildBookFilePaths());
        } catch {
            // Non-critical — will be re-provisioned on next sync.
        }

        // Stability-based backoff: poll hydrateFromIrohDocs every 3s.
        // Exit when 3 consecutive polls produce no changes AND data arrived.
        // On a fresh device (0 books before sync), don't settle until either
        // books arrive from the peer or the full timeout is reached.
        let stablePolls = 0;
        const STABLE_THRESHOLD = 3;
        const MAX_WAIT_SECS = 120;
        const POLL_INTERVAL_MS = 3000;
        const MIN_ELAPSED_MS = 5000;

        const waitStart = Date.now();
        let prevDomainSet = "";
        const pollLoop = async () => {
            while (!settled) {
                if (_syncCancelled) {
                    console.log("[sync] Sync cancelled during poll");
                    settle();
                    break;
                }
                await new Promise<void>(r => setTimeout(r, 500));
                if (_syncCancelled || settled) {
                    if (_syncCancelled) console.log("[sync] Sync cancelled during poll (fast check)");
                    settle();
                    break;
                }
                await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS - 500));
                if (settled) break;

                await hydrateFromIrohDocs();
                const booksCount = useLibraryStore.getState().books.length;
                const annCount = useLibraryStore.getState().annotations.length;
                const currentDomainSet = `${booksCount}|${annCount}`;
                const elapsed = Date.now() - waitStart;

                if (currentDomainSet !== prevDomainSet && elapsed >= MIN_ELAPSED_MS) {
                    stablePolls = 0;
                    prevDomainSet = currentDomainSet;
                    setStatus("syncing", `Syncing... (${booksCount} books, ${annCount} annotations)`);
                } else {
                    // Only count as stable if we actually have data (books > 0)
                    // OR the device had books before sync (no new data expected).
                    // On a fresh device (0 books before sync), never increment
                    // stability — wait for data or timeout.
                    if (booksCount > 0 || _bookCountBeforeSync > 0) {
                        stablePolls++;
                    }
                }

                if (stablePolls >= STABLE_THRESHOLD && elapsed >= MIN_ELAPSED_MS) {
                    console.log(`[sync] Stable for ${STABLE_THRESHOLD} polls, elapsed=${elapsed}ms — done`);
                    settle();
                    break;
                }
                if (elapsed >= MAX_WAIT_SECS * 1000) {
                    console.log(`[sync] Max wait ${MAX_WAIT_SECS}s reached with ${booksCount} books — done`);
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
        // Wait for the poll loop to actually finish its current iteration.
        // At this point settled=true so the next poll iteration will break.
        // Give it a couple seconds to exit cleanly.
        await new Promise<void>(r => setTimeout(r, 1500));
        contentReadyUnlisten?.();
        syncFinishedUnlisten?.();

        // Final hydrate: read ALL entries from the doc. By now content blobs
        // from the peer should be available (PendingContentReady fired or we
        // hit the stability threshold). This catches any entries that were
        // pending during the poll loop and ensures the store is up to date
        // BEFORE we compute the book count for the summary message.
        // Also force-drain any buffered live events that accumulated during
        // the sync (they were deferred while _isMerging was true).
        await hydrateFromIrohDocs();
        // Check cancellation before status updates in drain/poll.
        // cancelRunningSync sets _syncCancelled = true and status="idle";
        // we must not overwrite that with "syncing".
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
            await mergeIncomingData(liveEntries);
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

        // 6. Pull missing book files from peer
        const syncedBookIds = useLibraryStore.getState().books.map(b => b.id);
        const needFileCount = useLibraryStore.getState().books.filter(b => b.syncedWithoutFile === true && b.blobHash).length;
        if (needFileCount > 0) {
            log(`Downloading ${needFileCount} book files...`);
            setStatus("syncing", `Downloading ${needFileCount} books...`);
        }
        await pullMissingBookFilesAndCovers(peerDeviceId, syncedBookIds, log);

        // 7. After pulling files, re-add them to the local blobs store so
        //    blobHash is updated, then re-provision to iroh-docs so any
        //    newly-downloaded books can be shared with other peers.
        if (!_syncCancelled) {
            await provisionBookFileBlobs();
            await provisionToIrohDocs();
        }

        const bookCount = useLibraryStore.getState().books.length;
        let summary: string;
        if (_syncCancelled) {
            _syncCancelled = false;
            summary = "Sync cancelled";
            log(summary);
            setStatus("idle", summary);
            return { success: false, domainsUpdated: [], error: "Sync cancelled" };
        }
        summary = bookCount > 0
            ? `Synced ${bookCount} books`
            : "Sync complete — no changes yet";

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

        return { success: true, domainsUpdated: [] };
    } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log(`Sync failed: ${errMsg}`);
        setStatus("error", errMsg);
        return { success: false, domainsUpdated: [], error: errMsg };
    } finally {
        _isMerging = false;
        _currentSyncPeerId = null;
        _processDownloadQueue();
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
/** Set to true to cancel a running sync session. */
let _syncCancelled = false;

/**
 * Cancel the currently running sync if any. The sync loop and download
 * workers check this flag between operations and abort cleanly.
 */
export function cancelRunningSync(): void {
    _syncCancelled = true;
    // Clear download queue so no new downloads start after cancel
    _fileDownloadQueue.splice(0, _fileDownloadQueue.length);
    // Cancel any pending progressive book flush
    if (_progressiveBookTimer) clearTimeout(_progressiveBookTimer);
    _progressiveBookBatch = [];
    setStatus("idle", "Sync cancelled");
    console.log("[sync] Cancel requested — _syncCancelled = true");
}

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
const _pendingDocsEntries = new Map<string, string>();
/** Peer being synced — set by runDeviceSync so live events can trigger file downloads. */
let _currentSyncPeerId: string | null = null;

// Progressive book batch — per-entity book events are accumulated for 200ms
// then merged in a single setState call to avoid 192 individual re-renders.
let _progressiveBookBatch: any[] = [];
let _progressiveBookTimer: ReturnType<typeof setTimeout> | null = null;

function _flushProgressiveBooks() {
    if (_progressiveBookBatch.length === 0) return;
    const batch = _progressiveBookBatch.splice(0);
    const state = useLibraryStore.getState();
    const merged = mergeBooks(batch, state.books, state.deletionTombstones);
    useLibraryStore.setState({ books: merged });

    // Don't update status if sync was cancelled — cancelRunningSync set it to "idle"
    if (!_syncCancelled) {
        const total = useLibraryStore.getState().books.length;
        setStatus("syncing", `Syncing... (${total} books)`);
    }

    // Enqueue file downloads for newly added books with blobHash
    for (const book of batch) {
        const added = merged.find((b: any) => b.id === book.id);
        if (added?.syncedWithoutFile && added.blobHash && _currentSyncPeerId) {
            _enqueueFileDownload(added.id, added.blobHash, added.coverBlobHash);
        }
    }
}

// Background download queue
const _fileDownloadQueue: Array<{ bookId: string; blobHash: string; coverBlobHash?: string }> = [];
let _fileDownloadActive = false;

async function _processDownloadQueue() {
    if (_fileDownloadActive || _fileDownloadQueue.length === 0) return;
    _fileDownloadActive = true;
    const peerId = _currentSyncPeerId;
    if (!peerId || !isTauri()) { _fileDownloadActive = false; return; }

    let appDir = "";
    try {
        const { appDataDir } = await import("@tauri-apps/api/path");
        appDir = await appDataDir();
    } catch { _fileDownloadActive = false; return; }

    const CONCURRENCY = 4;
    let completed = 0;
    const total = _fileDownloadQueue.length;
    let index = 0;

    const downloadWorker = async () => {
        while (index < _fileDownloadQueue.length) {
            const { bookId, blobHash, coverBlobHash } = _fileDownloadQueue[index++];
            const book = useLibraryStore.getState().books.find(b => b.id === bookId);
            if (!book || !book.syncedWithoutFile) continue;

            const destPath = `${appDir}/book-cache/${bookId}.book`;
            setStatus("syncing", `Downloading ${book.title || bookId} (${completed + 1}/${total})`);
            const success = await blobsDownloadFile(peerId, blobHash, destPath);
            if (success) {
                completed++;
                useLibraryStore.setState(state => ({
                    books: state.books.map(b =>
                        b.id === bookId ? { ...b, syncedWithoutFile: false, filePath: destPath, storagePath: destPath } : b
                    )
                }));
            }

            if (coverBlobHash) {
                const coverBytes = await blobsDownloadBytes(peerId, coverBlobHash);
                if (coverBytes && coverBytes.length > 0) {
                    try {
                        const blob = new Blob([Uint8Array.from(coverBytes)], { type: "image/jpeg" });
                        const { saveCoverImage } = await import("./storage");
                        await saveCoverImage(bookId, blob);
                    } catch {}
                }
            }
        }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, () => downloadWorker());
    await Promise.all(workers);
    // Clear processed items from queue
    _fileDownloadQueue.splice(0, index);
    _fileDownloadActive = false;
}

function _enqueueFileDownload(bookId: string, blobHash: string, coverBlobHash?: string) {
    // Deduplicate
    if (_fileDownloadQueue.some(q => q.bookId === bookId)) return;
    _fileDownloadQueue.push({ bookId, blobHash, coverBlobHash });
    _processDownloadQueue();
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
            _docsLiveTimer = setTimeout(_processPendingDocs, 2000);
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
                    const merged = mergeAnnotations([parsed], state.annotations, state.deletionTombstones);
                    useLibraryStore.setState({ annotations: merged });
                }
            } catch {}
            return;
        }
        if (key.startsWith("collection:")) {
            try {
                const parsed = JSON.parse(value);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.id) {
                    const state = useLibraryStore.getState();
                    const merged = mergeCollections([parsed], state.collections, state.deletionTombstones);
                    useLibraryStore.setState({ collections: merged });
                }
            } catch {}
            return;
        }

        // ── Domain-level keys: batch for full merge pipeline ──
        _pendingDocsEntries.set(key, value);
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
            mod.wakeBackgroundSync().catch(e => console.error("[catch]", e));
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

/** Trigger iroh-docs reconciliation with a specific peer. Times out after 120s. */
export async function docsSyncNow(peerDeviceId: string): Promise<boolean> {
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        const timeout = new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error("docs_sync_now timed out after 120s")), 120_000)
        );
        await Promise.race([
            invoke("docs_sync_now", { peerDeviceId }),
            timeout,
        ]);
        return true;
    } catch (e) {
        console.error(`[sync] docsSyncNow failed: ${e}`);
        return false;
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

        // Write the full books array as a domain-level entry (batch path).
        // Also write each book as an individual per-entity entry so the
        // receiver can process them PROGRESSIVELY — books appear in the
        // library one at a time instead of all at once after the full merge.
        const serializeBook = (book: typeof lib.books[number]) => {
            const { filePath: _f, storagePath: _s, coverPath, locations: _l, ...stripped } = book;
            return JSON.stringify({
                ...stripped,
                ...(book.blobHash ? { blobHash: book.blobHash } : {}),
                ...(book.coverBlobHash ? { coverBlobHash: book.coverBlobHash } : {}),
                ...(coverPath && !coverPath.startsWith("data:") ? { coverPath } : {}),
            });
        };

        await docsSetEntry("books", JSON.stringify(lib.books.map(b => JSON.parse(serializeBook(b)))));
        // Write per-entity book entries for progressive processing on the receiver.
        // The receiver's live listener processes book:<id> events immediately,
        // adding the book to the library and starting file downloads.
        for (const book of lib.books) {
            await docsSetEntry(`book:${book.id}`, serializeBook(book));
        }
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
        const localSettingsUpdatedAt = useSettingsStore.getState().settingsLastModifiedAt || new Date(0).toISOString();
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

function scheduleDocsWrite(domain: string, fn: () => void): void {
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

    unsubs.push(useLibraryStore.subscribe((state) => {
        if (state.books !== prevBooks) {
            const prev = prevBooks;
            prevBooks = state.books;
            const currMap = new Map(state.books.map(b => [b.id, b]));
            const prevMap = new Map(prev.map(b => [b.id, b]));
            const hasDeletions = [...prevMap.keys()].some(id => !currMap.has(id));
            if (hasDeletions) {
                scheduleDocsWrite("books", () =>
                    docsSetEntry("books", JSON.stringify(state.books.map(b =>
                        JSON.parse(serializeBook(b))))));
            } else {
                for (const [id, book] of currMap) {
                    const prevBook = prevMap.get(id);
                    const currSerialized = serializeBook(book);
                    if (!prevBook) {
                        scheduleDocsWrite("book:" + id, () =>
                            docsSetEntry("book:" + id, currSerialized));
                    } else {
                        const prevSerialized = serializeBook(prevBook);
                        if (currSerialized !== prevSerialized) {
                            scheduleDocsWrite("book:" + id, () =>
                                docsSetEntry("book:" + id, currSerialized));
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
                    docsSetEntry("annotations", JSON.stringify(state.annotations)));
            } else {
                for (const [id, ann] of currMap) {
                    if (!prevMap.has(id) || JSON.stringify(ann) !== JSON.stringify(prevMap.get(id)!)) {
                        scheduleDocsWrite("annotation:" + id, () =>
                            docsSetEntry("annotation:" + id, JSON.stringify(ann)));
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
                    docsSetEntry("collections", JSON.stringify(state.collections)));
            } else {
                for (const [id, col] of currMap) {
                    if (!prevMap.has(id) || JSON.stringify(col) !== JSON.stringify(prevMap.get(id)!)) {
                        scheduleDocsWrite("collection:" + id, () =>
                            docsSetEntry("collection:" + id, JSON.stringify(col)));
                    }
                }
            }
        }
        if (state.deletionTombstones !== prevTombstones) {
            prevTombstones = state.deletionTombstones;
            scheduleDocsWrite("deletion_tombstones", () =>
                docsSetEntry("deletion_tombstones", JSON.stringify(state.deletionTombstones)));
        }
    }));

    // Vocabulary store
    let prevVocab = useVocabularyStore.getState().vocabularyTerms;
    unsubs.push(useVocabularyStore.subscribe((state) => {
        if (state.vocabularyTerms !== prevVocab) {
            prevVocab = state.vocabularyTerms;
            scheduleDocsWrite("vocabulary", () => docsSetEntry("vocabulary", JSON.stringify(state.vocabularyTerms)));
        }
    }));

    // RSS store
    let prevFeeds = useRssStore.getState().feeds;
    let prevArticles = useRssStore.getState().articles;
    unsubs.push(useRssStore.subscribe((state) => {
        if (state.feeds !== prevFeeds) {
            prevFeeds = state.feeds;
            scheduleDocsWrite("rss_feeds", () => docsSetEntry("rss_feeds", JSON.stringify(state.feeds)));
        }
        if (state.articles !== prevArticles) {
            prevArticles = state.articles;
            scheduleDocsWrite("rss_articles", () => docsSetEntry("rss_articles", JSON.stringify(state.articles)));
        }
    }));

    // Settings store
    let prevSettings = useSettingsStore.getState().settings;
    let prevStats = useSettingsStore.getState().stats;
    unsubs.push(useSettingsStore.subscribe((state) => {
        if (state.settings !== prevSettings) {
            prevSettings = state.settings;
            scheduleDocsWrite("settings", () => docsSetEntry("settings", JSON.stringify(state.settings)));
        }
        if (state.stats !== prevStats) {
            prevStats = state.stats;
            scheduleDocsWrite("reading_stats", () => docsSetEntry("reading_stats", JSON.stringify(state.stats)));
        }
    }));

    return () => {
        for (const unsub of unsubs) unsub();
        for (const t of _docsDebounceTimers.values()) clearTimeout(t);
        _docsDebounceTimers.clear();
    };
}
