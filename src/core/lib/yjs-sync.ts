/**
 * Theorem — Yjs CRDT Sync Bridge
 *
 * Replaces the custom LWW merge functions (sync-import.ts, 672 lines) with
 * conflict-free Yjs CRDT merging.  Each syncable domain lives in a Y.Map
 * keyed by entity ID.  Zustand is the canonical UI view; Yjs is the
 * canonical sync state.  Changes flow in both directions:
 *
 *   Zustand mutation  →  Y.Map.set()  →  CRDT broadcast
 *   Incoming update   →  Y.Map.apply()  →  Zustand.setState()
 *
 * Network transport (y-websocket) and persistence (y-indexeddb) are wired
 * in when the module is initialized.  When neither is available (e.g.
 * non-Tauri web) the bridge works stand-alone for local CRDT state.
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

/** Per-domain write guard — prevents observer → setState → observer loop. */
const _writeGuard = new Set<string>();

// ─── Typed Y.Map helpers per domain ───

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

// ─── Bootstrap from existing Zustand state ───

function bootstrapDomain<T>(
    map: Y.Map<T>,
    items: T[],
    getId: (item: T) => string,
    domain: string,
): void {
    const snapshot = snapshotMap(map);
    for (const item of items) {
        const id = getId(item);
        if (!snapshot.has(id)) {
            _writeGuard.add(domain);
            map.set(id, item);
            _writeGuard.delete(domain);
        }
    }
    for (const [id] of snapshot) {
        if (!items.some((i) => getId(i) === id)) {
            _writeGuard.add(domain);
            map.delete(id);
            _writeGuard.delete(domain);
        }
    }
}

function snapshotMap<T>(map: Y.Map<T>): Map<string, T> {
    const result = new Map<string, T>();
    map.forEach((value, key) => result.set(key, value));
    return result;
}

// ─── Yjs → Zustand observers ───

function observeBooks(map: Y.Map<Book>): void {
    map.observe(() => {
        if (_writeGuard.has("books")) return;
        const nextBooks: Book[] = [];
        map.forEach((book) => nextBooks.push(book));
        useLibraryStore.setState({ books: nextBooks });
    });
}

function observeAnnotations(map: Y.Map<Annotation>): void {
    map.observe(() => {
        if (_writeGuard.has("annotations")) return;
        const next: Annotation[] = [];
        map.forEach((a) => next.push(a));
        useLibraryStore.setState({ annotations: next });
    });
}

function observeCollections(map: Y.Map<Collection>): void {
    map.observe(() => {
        if (_writeGuard.has("collections")) return;
        const next: Collection[] = [];
        map.forEach((c) => next.push(c));
        useLibraryStore.setState({ collections: next });
    });
}

function observeTombstones(map: Y.Map<DeletionTombstone>): void {
    map.observe(() => {
        if (_writeGuard.has("deletionTombstones")) return;
        const next: DeletionTombstone[] = [];
        map.forEach((t) => next.push(t));
        useLibraryStore.setState({ deletionTombstones: next });
    });
}

function observeVocabulary(map: Y.Map<VocabularyTerm>): void {
    map.observe(() => {
        if (_writeGuard.has("vocabulary")) return;
        const next: VocabularyTerm[] = [];
        map.forEach((t) => next.push(t));
        useVocabularyStore.setState({ vocabularyTerms: next });
    });
}

function observeRssFeeds(map: Y.Map<RssFeed>): void {
    map.observe(() => {
        if (_writeGuard.has("rssFeeds")) return;
        const next: RssFeed[] = [];
        map.forEach((f) => next.push(f));
        useRssStore.setState({ feeds: next });
    });
}

function observeRssArticles(map: Y.Map<RssArticle>): void {
    map.observe(() => {
        if (_writeGuard.has("rssArticles")) return;
        const next: RssArticle[] = [];
        map.forEach((a) => next.push(a));
        useRssStore.setState({ articles: next });
    });
}

function observeSettings(map: Y.Map<AppSettings>): void {
    map.observe(() => {
        if (_writeGuard.has("settings")) return;
        const settings = map.get("app");
        if (settings) {
            useSettingsStore.setState({
                settings,
                settingsLastModifiedAt: new Date().toISOString(),
            });
        }
    });
}

function observeReadingStats(map: Y.Map<ReadingStats>): void {
    map.observe(() => {
        if (_writeGuard.has("readingStats")) return;
        const stats = map.get("app");
        if (stats) {
            useSettingsStore.setState({ stats });
        }
    });
}

// ─── Zustand → Yjs subscriber ───

function subscribeBooks(store: ReturnType<typeof useLibraryStore.getState>): void {
    const books = store.books;
    const map = _maps!.books;
    if (_writeGuard.has("books")) return;
    _writeGuard.add("books");
    // Diff current Zustand against Yjs, apply deltas.
    const yjsBookIds = snapshotMap(map);
    for (const book of books) {
        const existing = map.get(book.id);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(book)) {
            map.set(book.id, book);
        }
    }
    for (const id of yjsBookIds.keys()) {
        if (!books.some((b) => b.id === id)) {
            map.delete(id);
        }
    }
    _writeGuard.delete("books");
}

function subscribeSettings(store: ReturnType<typeof useSettingsStore.getState>): void {
    if (_writeGuard.has("settings")) return;
    _writeGuard.add("settings");
    _maps!.settings.set("app", store.settings);
    _writeGuard.delete("settings");
}

function subscribeStats(store: ReturnType<typeof useSettingsStore.getState>): void {
    if (_writeGuard.has("readingStats")) return;
    _writeGuard.add("readingStats");
    _maps!.readingStats.set("app", store.stats);
    _writeGuard.delete("readingStats");
}

// ─── Init / Teardown ───

let _initialized = false;

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

    // Wire Yjs → Zustand observers.
    observeBooks(_maps.books);
    observeAnnotations(_maps.annotations);
    observeCollections(_maps.collections);
    observeTombstones(_maps.deletionTombstones);
    observeVocabulary(_maps.vocabulary);
    observeRssFeeds(_maps.rssFeeds);
    observeRssArticles(_maps.rssArticles);
    observeSettings(_maps.settings);
    observeReadingStats(_maps.readingStats);

    // Bootstrap Yjs from current Zustand state (on first init).
    const lib = useLibraryStore.getState();
    const vocab = useVocabularyStore.getState();
    const rss = useRssStore.getState();
    const settings = useSettingsStore.getState();

    bootstrapDomain(_maps.books, lib.books, (b) => b.id, "books");
    bootstrapDomain(_maps.annotations, lib.annotations, (a) => a.id, "annotations");
    bootstrapDomain(_maps.collections, lib.collections, (c) => c.id, "collections");
    bootstrapDomain(
        _maps.deletionTombstones as Y.Map<DeletionTombstone>,
        lib.deletionTombstones,
        (t) => `${t.entityType}::${t.entityId}`,
        "deletionTombstones",
    );
    bootstrapDomain(_maps.vocabulary, vocab.vocabularyTerms, (t) => t.id, "vocabulary");
    bootstrapDomain(_maps.rssFeeds, rss.feeds, (f) => f.id, "rssFeeds");
    bootstrapDomain(_maps.rssArticles, rss.articles, (a) => a.id, "rssArticles");
    _maps.settings.set("app", settings.settings);
    _maps.readingStats.set("app", settings.stats);

    // Persist to IndexedDB so edits survive app restarts.
    _idbPersistence = new IndexeddbPersistence("theorem-yjs", ydoc);

    // y-websocket provider — only initialised when Tauri sync server is running.
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

/**
 * Encode the entire Y.Doc state as a binary update that can be sent
 * over any transport (HTTP, WebSocket, file, etc.).
 */
export function encodeYjsSyncState(): Uint8Array {
    if (!_ydoc) return new Uint8Array(0);
    return Y.encodeStateAsUpdate(_ydoc);
}

/**
 * Apply an incoming Yjs update (from a peer) to the local Y.Doc.
 * Observers will automatically propagate changes to Zustand stores.
 */
export function applyYjsSyncUpdate(update: Uint8Array): void {
    if (!_ydoc) return;
    Y.applyUpdate(_ydoc, update);
}

/**
 * Hook for watching Zustand stores and writing mutations back through Yjs.
 * Call this ONCE at app startup.  Each domain's Zustand store fires an
 * onChange callback via subscribe, and we diff against Yjs.
 */
export function bridgeZustandToYjs(): void {
    // Books / annotations / collections / tombstones — all in LibraryStore.
    let prevBooks: Book[] = [];
    let prevAnnotations: Annotation[] = [];
    let prevCollections: Collection[] = [];
    let prevTombstones: DeletionTombstone[] = [];

    useLibraryStore.subscribe((state) => {
        if (!_maps) return;
        if (state.books !== prevBooks) {
            prevBooks = state.books;
            subscribeBooks(state);
        }
        if (state.annotations !== prevAnnotations) {
            prevAnnotations = state.annotations;
            _writeGuard.add("annotations");
            const map = _maps!.annotations;
            const yjsIds = snapshotMap(map);
            for (const ann of state.annotations) map.set(ann.id, ann);
            for (const id of yjsIds.keys()) {
                if (!state.annotations.some((a) => a.id === id)) map.delete(id);
            }
            _writeGuard.delete("annotations");
        }
        if (state.collections !== prevCollections) {
            prevCollections = state.collections;
            _writeGuard.add("collections");
            const map = _maps!.collections;
            const yjsIds = snapshotMap(map);
            for (const col of state.collections) map.set(col.id, col);
            for (const id of yjsIds.keys()) {
                if (!state.collections.some((c) => c.id === id)) map.delete(id);
            }
            _writeGuard.delete("collections");
        }
        if (state.deletionTombstones !== prevTombstones) {
            prevTombstones = state.deletionTombstones;
            _writeGuard.add("deletionTombstones");
            const map = _maps!.deletionTombstones;
            const key = (t: DeletionTombstone) => `${t.entityType}::${t.entityId}`;
            const yjsKeys = snapshotMap(map);
            for (const t of state.deletionTombstones) {
                const tombstoneKey = key(t) as unknown as DeletionTombstone;
                map.set(key(t), tombstoneKey);
            }
            for (const k of yjsKeys.keys()) {
                if (!state.deletionTombstones.some((t) => key(t) === k)) map.delete(k);
            }
            _writeGuard.delete("deletionTombstones");
        }
    });

    // Vocabulary store.
    let prevVocab: VocabularyTerm[] = [];
    useVocabularyStore.subscribe((state) => {
        if (!_maps || state.vocabularyTerms === prevVocab) return;
        prevVocab = state.vocabularyTerms;
        _writeGuard.add("vocabulary");
        const map = _maps.vocabulary;
        const yjsIds = snapshotMap(map);
        for (const term of state.vocabularyTerms) map.set(term.id, term);
        for (const id of yjsIds.keys()) {
            if (!state.vocabularyTerms.some((t) => t.id === id)) map.delete(id);
        }
        _writeGuard.delete("vocabulary");
    });

    // RSS feeds.
    let prevFeeds: RssFeed[] = [];
    useRssStore.subscribe((state) => {
        if (!_maps || state.feeds === prevFeeds) return;
        prevFeeds = state.feeds;
        _writeGuard.add("rssFeeds");
        const map = _maps.rssFeeds;
        const yjsIds = snapshotMap(map);
        for (const feed of state.feeds) map.set(feed.id, feed);
        for (const id of yjsIds.keys()) {
            if (!state.feeds.some((f) => f.id === id)) map.delete(id);
        }
        _writeGuard.delete("rssFeeds");
    });

    // RSS articles.
    let prevArticles: RssArticle[] = [];
    useRssStore.subscribe((state) => {
        if (!_maps || state.articles === prevArticles) return;
        prevArticles = state.articles;
        _writeGuard.add("rssArticles");
        const map = _maps.rssArticles;
        const yjsIds = snapshotMap(map);
        for (const article of state.articles) map.set(article.id, article);
        for (const id of yjsIds.keys()) {
            if (!state.articles.some((a) => a.id === id)) map.delete(id);
        }
        _writeGuard.delete("rssArticles");
    });

    // Settings.
    let prevSettings: AppSettings | null = null;
    useSettingsStore.subscribe((state) => {
        if (!_maps || state.settings === prevSettings) return;
        prevSettings = state.settings;
        subscribeSettings(state);
    });

    // Reading stats.
    let prevStats: ReadingStats | null = null;
    useSettingsStore.subscribe((state) => {
        if (!_maps || state.stats === prevStats) return;
        prevStats = state.stats;
        subscribeStats(state);
    });
}

/** Check if Yjs sync is initialised. */
export function isYjsSyncInitialised(): boolean {
    return _initialized && _ydoc !== null;
}
