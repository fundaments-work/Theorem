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

import { setSyncData, initiateSync, startSyncServer, getIncomingSyncData } from "./device-sync";
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
    mergeVocabulary,
    mergeRssFeeds,
    mergeRssArticles,
    mergeSettings,
    mergeReadingStats,
} from "./sync-import";
import { isTauri } from "./env";

// ─── Helpers ───

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

// ─── Domain manifest builder ───

function buildDomainsAndManifest() {
    const library = useLibraryStore.getState();
    const vocabulary = useVocabularyStore.getState();
    const rss = useRssStore.getState();
    const settingsStore = useSettingsStore.getState();

    // Build a settings payload that excludes device-specific settings.
    // Include a settingsUpdatedAt timestamp for LWW merge.
    const settingsUpdatedAt = new Date().toISOString();
    const { deviceSync: _excluded, ...syncableSettings } = settingsStore.settings;
    const settingsPayload = {
        ...syncableSettings,
        _settingsUpdatedAt: settingsUpdatedAt,
    };

    const domains: Record<string, string> = {
        books: JSON.stringify(library.books),
        annotations: JSON.stringify(library.annotations),
        collections: JSON.stringify(library.collections),
        vocabulary: JSON.stringify(vocabulary.vocabularyTerms),
        settings: JSON.stringify(settingsPayload),
        reading_stats: JSON.stringify(settingsStore.stats),
        rss_feeds: JSON.stringify(rss.feeds),
        rss_articles: JSON.stringify(rss.articles),
    };

    const manifest: Record<string, { version: number; item_count: number; last_modified_at: string }> = {
        books: {
            version: library.books.length,
            item_count: library.books.length,
            last_modified_at: computeLatestDate(library.books, b => b.lastReadAt || b.addedAt),
        },
        annotations: {
            version: library.annotations.length,
            item_count: library.annotations.length,
            last_modified_at: computeLatestDate(library.annotations, a => a.updatedAt || a.createdAt),
        },
        collections: {
            version: library.collections.length,
            item_count: library.collections.length,
            last_modified_at: computeLatestDate(library.collections, c => c.createdAt),
        },
        vocabulary: {
            version: vocabulary.vocabularyTerms.length,
            item_count: vocabulary.vocabularyTerms.length,
            last_modified_at: computeLatestDate(vocabulary.vocabularyTerms, v => v.updatedAt || v.createdAt),
        },
        settings: {
            version: 1, // Settings is a single object, always version 1.
            item_count: 1,
            last_modified_at: settingsUpdatedAt,
        },
        reading_stats: {
            version: 1,
            item_count: 1,
            last_modified_at: settingsStore.stats.lastReadDate ?? new Date(0).toISOString(),
        },
        rss_feeds: {
            version: rss.feeds.length,
            item_count: rss.feeds.length,
            last_modified_at: computeLatestDate(rss.feeds, f => f.lastFetched || f.addedAt),
        },
        rss_articles: {
            version: rss.articles.length,
            item_count: rss.articles.length,
            last_modified_at: computeLatestDate(rss.articles, a => a.fetchedAt),
        },
    };

    return { domains, manifest, library, vocabulary, rss, settingsStore, settingsUpdatedAt };
}

// ─── Merge incoming data ───

function mergeIncomingData(
    incomingMap: Record<string, string>,
    library: ReturnType<typeof useLibraryStore.getState>,
    vocabulary: ReturnType<typeof useVocabularyStore.getState>,
    rss: ReturnType<typeof useRssStore.getState>,
    settingsStore: ReturnType<typeof useSettingsStore.getState>,
    localSettingsUpdatedAt?: string,
): { domainsUpdated: string[] } {
    const domainsUpdated: string[] = [];

    if (incomingMap["books"]) {
        try {
            const incoming = JSON.parse(incomingMap["books"]);
            if (Array.isArray(incoming) && incoming.length > 0) {
                const merged = mergeBooks(incoming, library.books);
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
            if (Array.isArray(incoming) && incoming.length > 0) {
                const merged = mergeAnnotations(incoming, library.annotations);
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
            if (Array.isArray(incoming) && incoming.length > 0) {
                const merged = mergeCollections(incoming, library.collections);
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
            if (Array.isArray(incoming) && incoming.length > 0) {
                const merged = mergeVocabulary(incoming, vocabulary.vocabularyTerms);
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
                const merged = mergeReadingStats(incoming, settingsStore.stats);
                useSettingsStore.setState({ stats: merged });
                domainsUpdated.push("reading_stats");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge reading_stats:", e);
        }
    }

    if (incomingMap["rss_feeds"]) {
        try {
            const incoming = JSON.parse(incomingMap["rss_feeds"]);
            if (Array.isArray(incoming) && incoming.length > 0) {
                const merged = mergeRssFeeds(incoming, rss.feeds);
                useRssStore.setState({ feeds: merged });
                domainsUpdated.push("rss_feeds");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge rss_feeds:", e);
        }
    }

    if (incomingMap["rss_articles"]) {
        try {
            const incoming = JSON.parse(incomingMap["rss_articles"]);
            if (Array.isArray(incoming) && incoming.length > 0) {
                const merged = mergeRssArticles(incoming, rss.articles);
                useRssStore.setState({ articles: merged });
                domainsUpdated.push("rss_articles");
            }
        } catch (e) {
            console.error("[sync-orchestrator] Failed to merge rss_articles:", e);
        }
    }

    return { domainsUpdated };
}

// ─── Public API ───

export interface SyncResult {
    success: boolean;
    domainsUpdated: string[];
    error?: string;
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

        const { domains, manifest, library, vocabulary, rss, settingsStore, settingsUpdatedAt } = buildDomainsAndManifest();

        log("Ensuring sync server is running...");
        try {
            await startSyncServer();
        } catch {
            // Server might already be running; that's fine.
        }

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
            incomingMap, library, vocabulary, rss, settingsStore, settingsUpdatedAt,
        );

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
    const { domains, manifest } = buildDomainsAndManifest();
    await setSyncData(JSON.stringify(domains), JSON.stringify(manifest));
}

// ─── Responder-side event listener ───

/** Debounce timer for batching rapid per-domain push events. */
let _syncCompleteTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Handles the "sync-incoming-complete" event from the Rust backend.
 * This fires when a remote peer has finished pushing all domains and
 * sent the /sync/complete call. We retrieve the buffered incoming data,
 * merge it into the local stores, and re-provision so the server
 * has up-to-date data for subsequent syncs.
 */
async function handleIncomingComplete(): Promise<void> {
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

        // Get fresh store state for merge.
        const library = useLibraryStore.getState();
        const vocabulary = useVocabularyStore.getState();
        const rss = useRssStore.getState();
        const settingsStore = useSettingsStore.getState();
        const localSettingsUpdatedAt = new Date().toISOString();

        const { domainsUpdated } = mergeIncomingData(
            incomingMap,
            library,
            vocabulary,
            rss,
            settingsStore,
            localSettingsUpdatedAt,
        );

        const summary = domainsUpdated.length > 0
            ? `Received: ${domainsUpdated.join(", ")}`
            : "No changes after merge";

        console.log(`[sync-orchestrator] Responder: merge complete. ${summary}`);
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

    // Dynamic import to avoid issues in web builds where @tauri-apps/api
    // may not be available at parse time.
    const { listen } = await import("@tauri-apps/api/event");

    const unlisten = await listen<string>("sync-incoming-complete", (_event) => {
        // Debounce: if multiple domains arrive rapidly, wait a moment
        // to let the complete event settle before triggering merge.
        if (_syncCompleteTimer) {
            clearTimeout(_syncCompleteTimer);
        }
        _syncCompleteTimer = setTimeout(() => {
            _syncCompleteTimer = null;
            handleIncomingComplete();
        }, 300);
    });

    console.log("[sync-orchestrator] Responder event listener registered.");
    return unlisten;
}
