import { del, get, set } from "idb-keyval";
import { inflateSync } from "fflate";
import type {
    DictionaryProvider,
    InstalledDictionary,
    VocabularyMeaning,
} from "../types";

interface StoredStarDictManifest {
    id: string;
    name: string;
    language: string;
    sizeBytes: number;
    hasSyn: boolean;
}

interface LoadedStarDict {
    lookup: (term: string) => Promise<Array<{ word: string; data: Array<[string, Uint8Array]> }> | null>;
}

const STORAGE_PREFIX = "theorem-stardict";
const loadedDictionaries = new Map<string, LoadedStarDict>();
const textDecoder = new TextDecoder();

function manifestKey(id: string): string {
    return `${STORAGE_PREFIX}:${id}:manifest`;
}

function fileKey(id: string, part: "ifo" | "idx" | "dict" | "syn"): string {
    return `${STORAGE_PREFIX}:${id}:${part}`;
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
    if (value instanceof ArrayBuffer) {
        return value;
    }
    if (value instanceof Uint8Array) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    return null;
}

function parseIfoContent(content: string): { name: string; language: string } {
    const lines = content.split("\n");
    const map = new Map<string, string>();

    for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator === -1) {
            continue;
        }
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (key && value) {
            map.set(key, value);
        }
    }

    return {
        name: map.get("bookname") || "StarDict Dictionary",
        language: map.get("lang") || "en",
    };
}

function splitDefinitions(value: string): string[] {
    return value
        .split(/\r?\n+/)
        .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
        .filter((line) => Boolean(line));
}

function extractDefinitions(entries: Array<{ word: string; data: Array<[string, Uint8Array]> }>): string[] {
    const definitions: string[] = [];

    for (const entry of entries) {
        for (const [, payload] of entry.data || []) {
            const decoded = textDecoder.decode(payload);
            const lines = splitDefinitions(decoded);
            for (const line of lines) {
                if (!definitions.includes(line)) {
                    definitions.push(line);
                }
            }
        }
    }

    return definitions;
}

function toVocabularyMeaning(definitions: string[], provider: DictionaryProvider): VocabularyMeaning[] {
    if (definitions.length === 0) {
        return [];
    }

    return [{
        provider,
        definitions,
    }];
}

async function createRuntimeDictionary(buffers: {
    ifo: ArrayBuffer;
    idx: ArrayBuffer;
    dict: ArrayBuffer;
    syn?: ArrayBuffer;
}): Promise<LoadedStarDict> {
    const { StarDict } = await import("../../features/reader/foliate-js/dict.js");
    const dictionary = new StarDict();

    await dictionary.loadIfo(new Blob([buffers.ifo]));
    await dictionary.loadDict(
        new Blob([buffers.dict]),
        async (data: Uint8Array) => inflateSync(data),
    );
    await dictionary.loadIdx(new Blob([buffers.idx]));

    if (buffers.syn) {
        await dictionary.loadSyn(new Blob([buffers.syn]));
    }

    return {
        lookup: async (term: string) => {
            const result = await dictionary.lookup(term);
            return result as Array<{ word: string; data: Array<[string, Uint8Array]> }>;
        },
    };
}

async function ensureLoadedDictionary(id: string): Promise<LoadedStarDict | null> {
    const existing = loadedDictionaries.get(id);
    if (existing) {
        return existing;
    }

    const manifest = await get<StoredStarDictManifest>(manifestKey(id));
    if (!manifest) {
        return null;
    }

    const ifo = toArrayBuffer(await get(fileKey(id, "ifo")));
    const idx = toArrayBuffer(await get(fileKey(id, "idx")));
    const dict = toArrayBuffer(await get(fileKey(id, "dict")));
    const syn = toArrayBuffer(await get(fileKey(id, "syn")));

    if (!ifo || !idx || !dict) {
        return null;
    }

    const runtime = await createRuntimeDictionary({
        ifo,
        idx,
        dict,
        syn: syn || undefined,
    });

    loadedDictionaries.set(id, runtime);
    return runtime;
}

/**
 * Imports StarDict files and persists them for offline lookups.
 */
export async function importStarDictDictionary(
    files: FileList | File[],
): Promise<InstalledDictionary> {
    const list = Array.from(files);
    const find = (extension: string) => list.find((file) => file.name.toLowerCase().endsWith(extension));

    const ifoFile = find(".ifo");
    const idxFile = find(".idx");
    const dictFile = list.find(
        (file) => file.name.toLowerCase().endsWith(".dict.dz") || file.name.toLowerCase().endsWith(".dz"),
    );
    const synFile = find(".syn");

    if (!ifoFile || !idxFile || !dictFile) {
        throw new Error("StarDict import requires .ifo, .idx, and .dict.dz files.");
    }

    const ifoBuffer = await ifoFile.arrayBuffer();
    const idxBuffer = await idxFile.arrayBuffer();
    const dictBuffer = await dictFile.arrayBuffer();
    const synBuffer = synFile ? await synFile.arrayBuffer() : undefined;

    const parsed = parseIfoContent(textDecoder.decode(ifoBuffer));
    const id = crypto.randomUUID();
    const sizeBytes = ifoFile.size + idxFile.size + dictFile.size + (synFile?.size || 0);

    const manifest: StoredStarDictManifest = {
        id,
        name: parsed.name,
        language: parsed.language,
        sizeBytes,
        hasSyn: Boolean(synBuffer),
    };

    await set(manifestKey(id), manifest);
    await set(fileKey(id, "ifo"), ifoBuffer);
    await set(fileKey(id, "idx"), idxBuffer);
    await set(fileKey(id, "dict"), dictBuffer);
    if (synBuffer) {
        await set(fileKey(id, "syn"), synBuffer);
    }

    const runtime = await createRuntimeDictionary({
        ifo: ifoBuffer,
        idx: idxBuffer,
        dict: dictBuffer,
        syn: synBuffer,
    });
    loadedDictionaries.set(id, runtime);

    return {
        id,
        name: parsed.name,
        language: parsed.language,
        format: "stardict",
        sizeBytes,
        importedAt: new Date(),
    };
}

/**
 * Removes an imported StarDict dictionary from storage and memory.
 */
export async function removeStarDictDictionary(id: string): Promise<void> {
    loadedDictionaries.delete(id);
    await Promise.all([
        del(manifestKey(id)),
        del(fileKey(id, "ifo")),
        del(fileKey(id, "idx")),
        del(fileKey(id, "dict")),
        del(fileKey(id, "syn")),
    ]);
}

/**
 * Looks up a term in a specific imported StarDict dictionary.
 */
export async function lookupInStarDictDictionary(
    id: string,
    term: string,
): Promise<VocabularyMeaning[]> {
    const dictionary = await ensureLoadedDictionary(id);
    if (!dictionary) {
        return [];
    }

    const entries = await dictionary.lookup(term);
    if (!entries || entries.length === 0) {
        return [];
    }

    const definitions = extractDefinitions(entries);
    return toVocabularyMeaning(definitions, "stardict");
}

/**
 * Looks up a term in all provided StarDict dictionary IDs.
 */
export async function lookupInStarDictDictionaries(
    dictionaryIds: string[],
    term: string,
): Promise<VocabularyMeaning[]> {
    const combined: VocabularyMeaning[] = [];

    for (const id of dictionaryIds) {
        try {
            const meanings = await lookupInStarDictDictionary(id, term);
            if (meanings.length > 0) {
                combined.push(...meanings);
            }
        } catch (error) {
            console.warn("[StarDictService] Lookup failed:", error);
        }
    }

    return combined;
}
