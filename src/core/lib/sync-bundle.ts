import { getCoverImage, getBookData } from "./storage";
import {
    useLibraryStore,
    useRssStore,
    useSettingsStore,
    useVocabularyStore,
} from "../store";
import {
    exportStarDictDictionary,
    type StoredStarDictManifest,
} from "../services/StarDictService";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.byteLength; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
}

function toIsoDate(value: Date | string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return undefined;
    }
    return date.toISOString();
}

function withSerializedDates<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export interface SyncBookBinaryPayload {
    id: string;
    format: string;
    contentHash?: string;
    fileSize: number;
    dataBase64: string;
    coverDataUrl?: string;
}

export interface SyncDictionaryBinaryPayload {
    id: string;
    manifest: StoredStarDictManifest;
    ifoBase64: string;
    idxBase64: string;
    dictBase64: string;
    synBase64?: string;
}

export interface UnifiedSyncBundle {
    version: 1;
    exportedAt: string;
    library: {
        books: ReturnType<typeof useLibraryStore.getState>["books"];
        collections: ReturnType<typeof useLibraryStore.getState>["collections"];
        annotations: ReturnType<typeof useLibraryStore.getState>["annotations"];
    };
    settings: ReturnType<typeof useSettingsStore.getState>["settings"];
    statistics: ReturnType<typeof useSettingsStore.getState>["stats"];
    vocabulary: {
        terms: ReturnType<typeof useVocabularyStore.getState>["vocabularyTerms"];
        installedDictionaries: ReturnType<typeof useVocabularyStore.getState>["installedDictionaries"];
    };
    rss: {
        feeds: ReturnType<typeof useRssStore.getState>["feeds"];
        articles: ReturnType<typeof useRssStore.getState>["articles"];
    };
    binaries: {
        books: SyncBookBinaryPayload[];
        dictionaries: SyncDictionaryBinaryPayload[];
    };
}

export interface UnifiedSyncExportResult {
    bundle: UnifiedSyncBundle;
    warnings: string[];
}

/**
 * Exports all app content into one payload for future cloud/device sync.
 * Includes both metadata/state and raw binary content for books+dictionaries.
 */
export async function exportUnifiedSyncBundle(): Promise<UnifiedSyncExportResult> {
    const warnings: string[] = [];

    const libraryState = useLibraryStore.getState();
    const settingsState = useSettingsStore.getState();
    const vocabularyState = useVocabularyStore.getState();
    const rssState = useRssStore.getState();

    const bookPayloads: SyncBookBinaryPayload[] = [];
    for (const book of libraryState.books) {
        const storagePath = book.storagePath || book.filePath;
        const binary = await getBookData(book.id, storagePath);
        if (!binary || binary.byteLength === 0) {
            warnings.push(`BOOK_BINARY_MISSING:${book.id}`);
            continue;
        }

        const coverDataUrl = await getCoverImage(book.id);
        bookPayloads.push({
            id: book.id,
            format: book.format,
            contentHash: book.contentHash,
            fileSize: book.fileSize,
            dataBase64: arrayBufferToBase64(binary),
            ...(coverDataUrl ? { coverDataUrl } : {}),
        });
    }

    const dictionaryPayloads: SyncDictionaryBinaryPayload[] = [];
    for (const dictionary of vocabularyState.installedDictionaries) {
        const exported = await exportStarDictDictionary(dictionary.id);
        if (!exported) {
            warnings.push(`DICTIONARY_BINARY_MISSING:${dictionary.id}`);
            continue;
        }

        dictionaryPayloads.push({
            id: dictionary.id,
            manifest: exported.manifest,
            ifoBase64: arrayBufferToBase64(exported.files.ifo),
            idxBase64: arrayBufferToBase64(exported.files.idx),
            dictBase64: arrayBufferToBase64(exported.files.dict),
            ...(exported.files.syn
                ? { synBase64: arrayBufferToBase64(exported.files.syn) }
                : {}),
        });
    }

    const bundle: UnifiedSyncBundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        library: {
            books: withSerializedDates(libraryState.books),
            collections: withSerializedDates(libraryState.collections),
            annotations: withSerializedDates(libraryState.annotations),
        },
        settings: withSerializedDates(settingsState.settings),
        statistics: withSerializedDates({
            ...settingsState.stats,
            lastReadDate: toIsoDate(settingsState.stats.lastReadDate),
        }),
        vocabulary: {
            terms: withSerializedDates(vocabularyState.vocabularyTerms),
            installedDictionaries: withSerializedDates(vocabularyState.installedDictionaries),
        },
        rss: {
            feeds: withSerializedDates(rssState.feeds),
            articles: withSerializedDates(rssState.articles),
        },
        binaries: {
            books: bookPayloads,
            dictionaries: dictionaryPayloads,
        },
    };

    return {
        bundle,
        warnings,
    };
}

export function estimateSyncBundleSizeBytes(bundle: UnifiedSyncBundle): number {
    return new Blob([JSON.stringify(bundle)]).size;
}
