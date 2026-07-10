/**
 * Theorem — Yjs CRDT Sync Bridge (v2 — Unidirectional)
 *
 * Architecture:
 *   Local edit → Zustand.setState → debounced sync → ydoc.transact(map.set, "local")
 *   Remote update → ydoc.on("update") → if origin !== "local" → Zustand.setState
 *
 * The v1 bridge had an infinite loop: Y.Map.observe → setState → subscribe →
 * map.set → observe → ... consuming 22GB RAM. The fix is unidirectional flow:
 * - Zustand→Yjs writes are debounced (500ms) and batched in a transaction
 *   marked with origin "local"
 * - Yjs→Zustand only fires for remote updates (origin !== "local")
 * - No per-map observe() handlers — only ydoc.on("update") with origin check
 */

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { IndexeddbPersistence } from "y-indexeddb";
import {
    useLibraryStore,
    useVocabularyStore,
    useRssStore,
    useSettingsStore,
} from "../store";
import type {
    Book,
    Annotation,
    Collection,
    DeletionTombstone,
    VocabularyTerm,
    RssFeed,
    RssArticle,
    AppSettings,
    ReadingStats,
} from "../types";

// ─── Yjs document singleton ───

let _ydoc: Y.Doc | null = null;
let _provider: WebsocketProvider | null = null;
let _idbPersistence: IndexeddbPersistence | null = null;

const LOCAL_ORIGIN = "theorem-local";
const DEBOUNCE_MS = 500;

/** Guard: prevents subscriber from scheduling a write-back during remote apply. */
let _isApplyingRemote = false;

interface YjsDomainMaps {
    books: Y.Map<Book>;
    annotations: Y.Map<Annotation>;
    collections: Y.Map<Collection>;
    deletionTombstones: Y.Map<DeletionTombstone>;
    vocabulary: Y.Map<VocabularyTerm>;
    rssFeeds: Y.Map<RssFeed>;
    rssArticles: Y.Map<RssArticle>;
    settings: Y.Map<AppSettings>;
    readingStats: Y.Map<ReadingStats>;
}

let _maps: YjsDomainMaps | null = null;
let _initialized = false;

// Debounce timers per domain
const _debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Zustand unsubscribe functions — cleaned up in destroyYjsSync()
let _unsubLibrary: (() => void) | null = null;
let _unsubVocab: (() => void) | null = null;
let _unsubRss: (() => void) | null = null;
let _unsubSettings: (() => void) | null = null;

// ─── Bootstrap: copy Zustand state → Yjs (one-time) ───

function bootstrapDomain<T>(
    map: Y.Map<T>,
    items: T[],
    getId: (item: T) => string,
): void {
    const existing = new Set<string>();
    map.forEach((_, key) => existing.add(key));
    for (const item of items) {
        const id = getId(item);
        map.set(id, item);
    }
    // Remove stale entries
    for (const key of existing) {
        if (!items.some((i) => getId(i) === key)) {
            map.delete(key);
        }
    }
}

// ─── Zustand → Yjs (debounced, batched, marked "local") ───

function syncDomain<T>(
    map: Y.Map<T>,
    items: T[],
    getId: (item: T) => string,
): void {
    _ydoc!.transact(() => {
        const existing = new Set<string>();
        map.forEach((_, key) => existing.add(key));
        for (const item of items) {
            map.set(getId(item), item);
        }
        for (const key of existing) {
            if (!items.some((i) => getId(i) === key)) {
                map.delete(key);
            }
        }
    }, LOCAL_ORIGIN);
}

function syncScalar<T>(
    map: Y.Map<T>,
    key: string,
    value: T,
): void {
    _ydoc!.transact(() => {
        map.set(key, value);
    }, LOCAL_ORIGIN);
}

function scheduleSync(domain: string, fn: () => void): void {
    const existing = _debounceTimers.get(domain);
    if (existing) clearTimeout(existing);
    _debounceTimers.set(domain, setTimeout(() => {
        _debounceTimers.delete(domain);
        fn();
    }, DEBOUNCE_MS));
}

function syncLibraryToYjs(): void {
    if (!_maps || !_ydoc) return;
    scheduleSync("library", () => {
        const state = useLibraryStore.getState();
        _ydoc!.transact(() => {
            const map = _maps!.books;
            const existing = new Set<string>();
            map.forEach((_, key) => existing.add(key));
            for (const book of state.books) {
                // Strip device-local fields before syncing to Yjs
                const { filePath, storagePath, coverPath, syncedWithoutFile, ...syncableBook } = book;
                const coverToKeep = (typeof coverPath === "string" && coverPath.startsWith("data:")) ? coverPath : undefined;
                const yBook = {
                    ...syncableBook,
                    ...(coverToKeep ? { coverPath: coverToKeep } : {})
                };
                map.set(book.id, yBook as Book);
            }
            for (const key of existing) {
                if (!state.books.some((i) => i.id === key)) {
                    map.delete(key);
                }
            }
        }, LOCAL_ORIGIN);
        
        syncDomain(_maps!.annotations, state.annotations, (a) => a.id);
        syncDomain(_maps!.collections, state.collections, (c) => c.id);
        syncDomain(_maps!.deletionTombstones, state.deletionTombstones, (t) => `${t.entityType}::${t.entityId}`);
    });
}

function syncVocabularyToYjs(): void {
    if (!_maps || !_ydoc) return;
    scheduleSync("vocabulary", () => {
        const state = useVocabularyStore.getState();
        syncDomain(_maps!.vocabulary, state.vocabularyTerms, (t) => t.id);
    });
}

function syncRssToYjs(): void {
    if (!_maps || !_ydoc) return;
    scheduleSync("rss", () => {
        const state = useRssStore.getState();
        syncDomain(_maps!.rssFeeds, state.feeds, (f) => f.id);
        
        const MAX_ARTICLES = 500;
        const MAX_ARTICLE_AGE_DAYS = 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - MAX_ARTICLE_AGE_DAYS);

        const filtered = state.articles
            .filter(article => {
                const articleDate = article.publishedAt || article.fetchedAt;
                return new Date(articleDate) >= cutoffDate;
            })
            .slice(0, MAX_ARTICLES);

        const truncatedArticles = filtered.map(article => ({
            ...article,
            content: article.content && article.content.length > 50000
                ? article.content.slice(0, 50000) + '... [truncated]'
                : article.content,
        }));
        
        syncDomain(_maps!.rssArticles, truncatedArticles, (a) => a.id);
    });
}

function syncSettingsToYjs(): void {
    if (!_maps || !_ydoc) return;
    scheduleSync("settings", () => {
        const state = useSettingsStore.getState();
        syncScalar(_maps!.settings, "app", state.settings);
        syncScalar(_maps!.readingStats, "app", state.stats);
    });
}

// ─── Yjs → Zustand (only for remote updates) ───

function applyYjsToZustand(): void {
    if (!_maps) return;
    _isApplyingRemote = true;

    // Books
    const currentBooks = useLibraryStore.getState().books;
    const currentBooksById = new Map(currentBooks.map(b => [b.id, b]));
    
    const books: Book[] = [];
    _maps.books.forEach((yBook) => {
        const localBook = currentBooksById.get(yBook.id);
        if (localBook) {
            const syncedVal = localBook.syncedWithoutFile;
            books.push({
                ...yBook,
                filePath: localBook.filePath,
                storagePath: localBook.storagePath,
                syncedWithoutFile: syncedVal,
                coverPath: localBook.coverPath || (typeof yBook.coverPath === "string" && yBook.coverPath.startsWith("data:") ? yBook.coverPath : undefined),
            } as Book);
            if (syncedVal === true && books.length <= 3) {
                console.log(`[sync] Yjs apply: existing book ${yBook.id} syncedWithoutFile=${syncedVal}`);
            }
        } else {
            books.push({
                ...yBook,
                filePath: `sqlite://${yBook.id}`,
                storagePath: `sqlite://${yBook.id}`,
                syncedWithoutFile: true,
                coverExtractionDone: Boolean(yBook.coverPath && typeof yBook.coverPath === "string" && yBook.coverPath.startsWith("data:")),
                coverPath: (typeof yBook.coverPath === "string" && yBook.coverPath.startsWith("data:")) ? yBook.coverPath : undefined,
            } as Book);
            if (books.length <= 3) {
                console.log(`[sync] Yjs apply: NEW book ${yBook.id} syncedWithoutFile=true`);
            }
        }
    });
    if (books.length > 0 || useLibraryStore.getState().books.length > 0) {
        useLibraryStore.setState({ books });
    }

    // Annotations
    const annotations: Annotation[] = [];
    _maps.annotations.forEach((a) => annotations.push(a));
    useLibraryStore.setState({ annotations });

    // Collections
    const collections: Collection[] = [];
    _maps.collections.forEach((c) => collections.push(c));
    useLibraryStore.setState({ collections });

    // Tombstones
    const tombstones: DeletionTombstone[] = [];
    _maps.deletionTombstones.forEach((t) => tombstones.push(t));
    useLibraryStore.setState({ deletionTombstones: tombstones });

    // Vocabulary
    const terms: VocabularyTerm[] = [];
    _maps.vocabulary.forEach((t) => terms.push(t));
    useVocabularyStore.setState({ vocabularyTerms: terms });

    // RSS
    const feeds: RssFeed[] = [];
    _maps.rssFeeds.forEach((f) => feeds.push(f));
    const articles: RssArticle[] = [];
    _maps.rssArticles.forEach((a) => articles.push(a));
    useRssStore.setState({ feeds, articles });

    // Settings
    const settings = _maps.settings.get("app");
    if (settings) {
        useSettingsStore.setState({ settings });
    }
    const stats = _maps.readingStats.get("app");
    if (stats) {
        useSettingsStore.setState({ stats });
    }

    _isApplyingRemote = false;
}

// ─── Init / Teardown ───

export function initYjsSync(room?: string): void {
    if (_initialized) return;
    _initialized = true;

    _ydoc = new Y.Doc();
    const ydoc = _ydoc;

    _maps = {
        books: ydoc.getMap("books"),
        annotations: ydoc.getMap("annotations"),
        collections: ydoc.getMap("collections"),
        deletionTombstones: ydoc.getMap("deletionTombstones"),
        vocabulary: ydoc.getMap("vocabulary"),
        rssFeeds: ydoc.getMap("rssFeeds"),
        rssArticles: ydoc.getMap("rssArticles"),
        settings: ydoc.getMap("settings"),
        readingStats: ydoc.getMap("readingStats"),
    };

    // Bootstrap Yjs from current Zustand state (one-time, marked local).
    ydoc.transact(() => {
        const lib = useLibraryStore.getState();
        const vocab = useVocabularyStore.getState();
        const rss = useRssStore.getState();
        const settings = useSettingsStore.getState();

        bootstrapDomain(_maps!.books, lib.books, (b) => b.id);
        bootstrapDomain(_maps!.annotations, lib.annotations, (a) => a.id);
        bootstrapDomain(_maps!.collections, lib.collections, (c) => c.id);
        bootstrapDomain(_maps!.deletionTombstones, lib.deletionTombstones, (t) => `${t.entityType}::${t.entityId}`);
        bootstrapDomain(_maps!.vocabulary, vocab.vocabularyTerms, (t) => t.id);
        bootstrapDomain(_maps!.rssFeeds, rss.feeds, (f) => f.id);
        bootstrapDomain(_maps!.rssArticles, rss.articles, (a) => a.id);
        _maps!.settings.set("app", settings.settings);
        _maps!.readingStats.set("app", settings.stats);
    }, LOCAL_ORIGIN);

    // Yjs → Zustand: only for remote updates (not our own local writes).
    ydoc.on("update", (_update: Uint8Array, origin: unknown) => {
        if (origin === LOCAL_ORIGIN) return;
        applyYjsToZustand();
    });

    // Persist to IndexedDB so edits survive app restarts.
    _idbPersistence = new IndexeddbPersistence("theorem-yjs", ydoc);

    // y-websocket provider — only initialised when a room is provided.
    if (room) {
        _provider = new WebsocketProvider(
            `ws://127.0.0.1:43935`,
            room,
            ydoc,
        );
    }
}

export function connectYjsSync(room: string, serverUrl: string): void {
    if (!_ydoc) return;
    if (_provider) {
        _provider.disconnect();
        _provider.destroy();
    }
    _provider = new WebsocketProvider(serverUrl, room, _ydoc);
}

export function disconnectYjsSync(): void {
    if (_provider) {
        _provider.disconnect();
        _provider.destroy();
        _provider = null;
    }
}

export function destroyYjsSync(): void {
    // Unsubscribe Zustand store listeners to prevent subscriber leaks on hot reload
    if (_unsubLibrary) { _unsubLibrary(); _unsubLibrary = null; }
    if (_unsubVocab) { _unsubVocab(); _unsubVocab = null; }
    if (_unsubRss) { _unsubRss(); _unsubRss = null; }
    if (_unsubSettings) { _unsubSettings(); _unsubSettings = null; }

    // Clear all debounce timers
    for (const timer of _debounceTimers.values()) {
        clearTimeout(timer);
    }
    _debounceTimers.clear();

    disconnectYjsSync();
    if (_idbPersistence) {
        _idbPersistence.destroy();
        _idbPersistence = null;
    }
    if (_ydoc) {
        _ydoc.destroy();
        _ydoc = null;
    }
    _maps = null;
    _initialized = false;
}

export function encodeYjsSyncState(): Uint8Array {
    if (!_ydoc) return new Uint8Array(0);
    return Y.encodeStateAsUpdate(_ydoc);
}

export function applyYjsSyncUpdate(update: Uint8Array): void {
    if (!_ydoc) return;
    // Remote updates are applied with a non-local origin so the
    // ydoc.on("update") handler fires and pushes changes to Zustand.
    Y.applyUpdate(_ydoc, update, "remote");
}

/**
 * Subscribe to Zustand stores and write mutations to Yjs (debounced).
 * Call this ONCE at app startup.
 */
export function bridgeZustandToYjs(): void {
    // Unsubscribe previous subscribers (in case bridge was called before).
    if (_unsubLibrary) _unsubLibrary();
    if (_unsubVocab) _unsubVocab();
    if (_unsubRss) _unsubRss();
    if (_unsubSettings) _unsubSettings();

    // Library store: books, annotations, collections, tombstones
    let prevBooks = useLibraryStore.getState().books;
    let prevAnnotations = useLibraryStore.getState().annotations;
    let prevCollections = useLibraryStore.getState().collections;
    let prevTombstones = useLibraryStore.getState().deletionTombstones;

    _unsubLibrary = useLibraryStore.subscribe((state) => {
        if (_isApplyingRemote) return;
        if (state.books !== prevBooks ||
            state.annotations !== prevAnnotations ||
            state.collections !== prevCollections ||
            state.deletionTombstones !== prevTombstones) {
            prevBooks = state.books;
            prevAnnotations = state.annotations;
            prevCollections = state.collections;
            prevTombstones = state.deletionTombstones;
            syncLibraryToYjs();
        }
    });

    // Vocabulary store
    let prevVocab = useVocabularyStore.getState().vocabularyTerms;
    _unsubVocab = useVocabularyStore.subscribe((state) => {
        if (_isApplyingRemote) return;
        if (state.vocabularyTerms !== prevVocab) {
            prevVocab = state.vocabularyTerms;
            syncVocabularyToYjs();
        }
    });

    // RSS store
    let prevFeeds = useRssStore.getState().feeds;
    let prevArticles = useRssStore.getState().articles;
    _unsubRss = useRssStore.subscribe((state) => {
        if (_isApplyingRemote) return;
        if (state.feeds !== prevFeeds || state.articles !== prevArticles) {
            prevFeeds = state.feeds;
            prevArticles = state.articles;
            syncRssToYjs();
        }
    });

    // Settings store
    let prevSettings = useSettingsStore.getState().settings;
    let prevStats = useSettingsStore.getState().stats;
    _unsubSettings = useSettingsStore.subscribe((state) => {
        if (_isApplyingRemote) return;
        if (state.settings !== prevSettings || state.stats !== prevStats) {
            prevSettings = state.settings;
            prevStats = state.stats;
            syncSettingsToYjs();
        }
    });
}

export function isYjsSyncInitialised(): boolean {
    return _initialized && _ydoc !== null;
}
