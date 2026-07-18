import { del, get, set } from "idb-keyval";
import { Gunzip } from "fflate";
import type {
    DictionaryProvider,
    InstalledDictionary,
    VocabularyMeaning,
} from "../types";
import { isTauri } from "../lib/env";
import {
    sqliteDeleteBlob,
    sqliteDeleteKv,
    sqliteGetBlob,
    sqliteGetKv,
    sqliteSetBlob,
    sqliteSetKv,
} from "../lib/sqlite-storage";

export interface StoredStarDictManifest {
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

async function readManifest(id: string): Promise<StoredStarDictManifest | null> {
    const key = manifestKey(id);
    if (isTauri()) {
        const serialized = await sqliteGetKv(key);
        if (!serialized) {
            return null;
        }

        try {
            return JSON.parse(serialized) as StoredStarDictManifest;
        } catch (error) {
            return null;
        }
    }

    return await get<StoredStarDictManifest>(key) ?? null;
}

async function writeManifest(manifest: StoredStarDictManifest): Promise<void> {
    const key = manifestKey(manifest.id);
    if (isTauri()) {
        await sqliteSetKv(key, JSON.stringify(manifest));
        return;
    }
    await set(key, manifest);
}

async function deleteManifest(id: string): Promise<void> {
    const key = manifestKey(id);
    if (isTauri()) {
        await sqliteDeleteKv(key);
        return;
    }
    await del(key);
}

async function readDictionaryPart(
    id: string,
    part: "ifo" | "idx" | "dict" | "syn",
): Promise<ArrayBuffer | null> {
    const key = fileKey(id, part);
    if (isTauri()) {
        return await sqliteGetBlob(key);
    }
    return toArrayBuffer(await get(key));
}

async function writeDictionaryPart(
    id: string,
    part: "ifo" | "idx" | "dict" | "syn",
    buffer: ArrayBuffer,
): Promise<void> {
    const key = fileKey(id, part);
    if (isTauri()) {
        await sqliteSetBlob(key, buffer);
        return;
    }
    await set(key, buffer);
}

async function deleteDictionaryPart(
    id: string,
    part: "ifo" | "idx" | "dict" | "syn",
): Promise<void> {
    const key = fileKey(id, part);
    if (isTauri()) {
        await sqliteDeleteBlob(key);
        return;
    }
    await del(key);
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
    if (value instanceof ArrayBuffer) {
        return value;
    }
    if (value instanceof Uint8Array) {
        return value.slice().buffer;
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

interface WiktionaryParseGroup {
    pos: string;
    definitions: string[];
}

const KNOWN_POS = new Set([
    "Noun", "Verb", "Adjective", "Adverb", "Interjection", "Proper noun",
    "Preposition", "Conjunction", "Pronoun", "Determiner", "Article",
    "Numeral", "Particle", "Prefix", "Suffix", "Contraction",
    "Abbreviation", "Symbol", "Phrase", "Idiom", "Affix",
    "Circumposition", "Classifier", "Clitic", "Counter", "Infix",
    "Interfix", "Measure word", "Particle", "Preverb", "Postposition",
    "Root", "Stem", "Combining form",
]);

function parseWiktionaryDefinitions(raw: string): WiktionaryParseGroup[] {
    
    let text = raw.replace(/<!--.*?-->/gs, " ");
    text = text.replace(/<[^>]*>/g, " ");

    text = text.replace(/\w+#\w+\|/g, "");
    text = text.replace(/#\w+/g, "");

    text = text.replace(/\|/g, " ");
    text = text.replace(/\\"/g, '"');
    text = text.replace(/\s*["""]\s*/g, " ");
    text = text.replace(/\s*[―–—]\s*/g, " — ");
    text = text.replace(/[\[\]{}]/g, " ");

    text = text.replace(/\s+/g, " ").trim();

    const rawSegments = text.split(/(?=\([A-Z][A-Za-z ]*\))/).filter(Boolean);

    const groups = new Map<string, string[]>();

    for (const segment of rawSegments) {
        
        const posMatch = segment.match(/^\(([A-Za-z ]+)\)\s*(?:\*:?)?\s*/);
        if (!posMatch) continue;

        const pos = posMatch[1].trim();
        if (!KNOWN_POS.has(pos)) continue;

        let def = segment.slice(posMatch[0].length);

        def = def.replace(/\|/g, " ");
        def = def.replace(/\s*["""]\s*/g, " ");
        def = def.replace(/\s+/g, " ").trim();

        if (!def || def.length < 4) continue;
        if (/^[\w/:#@.%\-'·\s]+$/.test(def)) continue;
        if (/^\d{4},?\s/.test(def)) continue;
        if (/^[:.…·]+$/.test(def)) continue;

        if (/^\([A-Za-z]/.test(def)) continue;

        const existing = groups.get(pos);
        if (existing) {
            existing.push(def);
        } else {
            groups.set(pos, [def]);
        }
    }

    const result: WiktionaryParseGroup[] = [];
    for (const [pos, defs] of groups) {
        const seen = new Set<string>();
        const unique: string[] = [];
        for (const d of defs) {
            const key = d.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(d);
        }
        if (unique.length > 0) {
            result.push({ pos, definitions: unique });
        }
    }

    return result;
}

function parseDictionaryEntries(
    entries: Array<{ word: string; data: Array<[string, Uint8Array]> }>,
    provider: DictionaryProvider,
): VocabularyMeaning[] {
    const posGroups = new Map<string, string[]>();

    for (const entry of entries) {
        for (const [, payload] of entry.data || []) {
            const decoded = textDecoder.decode(payload);
            const parsed = parseWiktionaryDefinitions(decoded);
            for (const group of parsed) {
                const existing = posGroups.get(group.pos);
                if (existing) {
                    existing.push(...group.definitions);
                } else {
                    posGroups.set(group.pos, [...group.definitions]);
                }
            }
        }
    }

    if (posGroups.size === 0) return [];

    const result: VocabularyMeaning[] = [];
    for (const [pos, defs] of posGroups) {
        const seen = new Set<string>();
        const unique: string[] = [];
        for (const d of defs) {
            const key = d.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(d);
        }
        if (unique.length > 0) {
            result.push({ provider, partOfSpeech: pos, definitions: unique });
        }
    }

    return result;
}

async function createRuntimeDictionary(buffers: {
    ifo: ArrayBuffer;
    idx: ArrayBuffer;
    dict: ArrayBuffer;
    syn?: ArrayBuffer;
}): Promise<LoadedStarDict> {
    const { StarDict } = await import("../../features/reader/foliate-js-runtime/dict.js");
    const dictionary = new StarDict();

    await dictionary.loadIfo(new Blob([buffers.ifo]));

    const inflateChunk = (data: Uint8Array): Uint8Array => {
        const outputs: Uint8Array[] = [];
        const gunzipper = new Gunzip({});
        gunzipper.ondata = (chunk) => {
            outputs.push(chunk);
        };
        gunzipper.push(data, true);
        const total = outputs.reduce((s, o) => s + o.length, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        for (const o of outputs) {
            result.set(o, offset);
            offset += o.length;
        }
        return result;
    };

    await dictionary.loadDict(
        new Blob([buffers.dict]),
        async (data: Uint8Array) => inflateChunk(data),
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

    const manifest = await readManifest(id);
    if (!manifest) {
        return null;
    }

    const ifo = await readDictionaryPart(id, "ifo");
    const idx = await readDictionaryPart(id, "idx");
    const dict = await readDictionaryPart(id, "dict");
    const syn = await readDictionaryPart(id, "syn");

    if (!ifo || !idx || !dict) {
        return null;
    }

    try {
        const runtime = await createRuntimeDictionary({
            ifo,
            idx,
            dict,
            syn: syn || undefined,
        });
        loadedDictionaries.set(id, runtime);
        return runtime;
    } catch (error) {
        console.warn("[StarDict] Failed to load dictionary:", error);
        return null;
    }
}

export async function importStarDictDictionary(
    files: FileList | File[],
): Promise<InstalledDictionary> {
    const list = Array.from(files);
    const find = (extension: string) => list.find((file) => file.name.toLowerCase().endsWith(extension));

    const ifoFile = find(".ifo");
    const idxFile = find(".idx") || find(".index");
    const dictFile = list.find(
        (file) => file.name.toLowerCase().endsWith(".dict.dz") || file.name.toLowerCase().endsWith(".dz"),
    );
    const synFile = find(".syn");

    if (!ifoFile) {
        throw new Error("Dictionary import requires a .ifo (StarDict) file. For Dictd format, rename your .index file to .idx.");
    }
    if (!idxFile || !dictFile) {
        throw new Error("Dictionary import requires .idx (or .index) and .dict.dz files.");
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

    await writeManifest(manifest);
    await writeDictionaryPart(id, "ifo", ifoBuffer);
    await writeDictionaryPart(id, "idx", idxBuffer);
    await writeDictionaryPart(id, "dict", dictBuffer);
    if (synBuffer) {
        await writeDictionaryPart(id, "syn", synBuffer);
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

export async function importStarDictFromBytes(
    ifoBytes: Uint8Array,
    idxBytes: Uint8Array,
    dictBytes: Uint8Array,
    synBytes?: Uint8Array,
): Promise<InstalledDictionary> {
    const ifoBuffer = ifoBytes.buffer.slice(ifoBytes.byteOffset, ifoBytes.byteOffset + ifoBytes.byteLength) as ArrayBuffer;
    const idxBuffer = idxBytes.buffer.slice(idxBytes.byteOffset, idxBytes.byteOffset + idxBytes.byteLength) as ArrayBuffer;
    const dictBuffer = dictBytes.buffer.slice(dictBytes.byteOffset, dictBytes.byteOffset + dictBytes.byteLength) as ArrayBuffer;
    const synBuffer = synBytes ? synBytes.buffer.slice(synBytes.byteOffset, synBytes.byteOffset + synBytes.byteLength) as ArrayBuffer | undefined : undefined;

    const parsed = parseIfoContent(textDecoder.decode(ifoBuffer));
    const id = crypto.randomUUID();
    const sizeBytes = ifoBytes.byteLength + idxBytes.byteLength + dictBytes.byteLength + (synBytes?.byteLength || 0);

    const manifest: StoredStarDictManifest = {
        id,
        name: parsed.name,
        language: parsed.language,
        sizeBytes,
        hasSyn: Boolean(synBuffer),
    };

    await writeManifest(manifest);
    await writeDictionaryPart(id, "ifo", ifoBuffer);
    await writeDictionaryPart(id, "idx", idxBuffer);
    await writeDictionaryPart(id, "dict", dictBuffer);
    if (synBuffer) {
        await writeDictionaryPart(id, "syn", synBuffer);
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

export async function removeStarDictDictionary(id: string): Promise<void> {
    loadedDictionaries.delete(id);
    await Promise.all([
        deleteManifest(id),
        deleteDictionaryPart(id, "ifo"),
        deleteDictionaryPart(id, "idx"),
        deleteDictionaryPart(id, "dict"),
        deleteDictionaryPart(id, "syn"),
    ]);
}

export interface ExportedStarDictDictionary {
    manifest: StoredStarDictManifest;
    files: {
        ifo: ArrayBuffer;
        idx: ArrayBuffer;
        dict: ArrayBuffer;
        syn?: ArrayBuffer;
    };
}

export async function exportStarDictDictionary(
    id: string,
): Promise<ExportedStarDictDictionary | null> {
    const manifest = await readManifest(id);
    if (!manifest) {
        return null;
    }

    const ifo = await readDictionaryPart(id, "ifo");
    const idx = await readDictionaryPart(id, "idx");
    const dict = await readDictionaryPart(id, "dict");
    const syn = await readDictionaryPart(id, "syn");

    if (!ifo || !idx || !dict) {
        return null;
    }

    return {
        manifest,
        files: {
            ifo,
            idx,
            dict,
            ...(syn ? { syn } : {}),
        },
    };
}

export async function lookupInStarDictDictionary(
    id: string,
    term: string,
): Promise<VocabularyMeaning[]> {
    const dictionary = await ensureLoadedDictionary(id);
    if (!dictionary) {
        return [];
    }

    try {
        const entries = await dictionary.lookup(term);
        if (!entries || entries.length === 0) {
            return [];
        }
        return parseDictionaryEntries(entries, "stardict");
    } catch (error) {
        console.warn("[StarDict] Lookup failed for dictionary:", error);
        return [];
    }
}

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
            console.warn("[StarDict] Lookup failed for dictionary", id, error);
        }
    }

    return combined;
}
