import type {
    DictionaryMode,
    DictionaryProvider,
    VocabularyMeaning,
    VocabularyTerm,
} from "../types";
import { lookupInStarDictDictionaries } from "./StarDictService";

export interface DictionaryLookupInput {
    term: string;
    mode: DictionaryMode;
    language?: string;
    installedDictionaryIds?: string[];
}

export interface DictionaryLookupResult {
    term: string;
    normalizedTerm: string;
    language: string;
    phonetic?: string;
    audioUrl?: string;
    meanings: VocabularyMeaning[];
    providersUsed: DictionaryProvider[];
}

interface ProviderLookupResult {
    meanings: VocabularyMeaning[];
    phonetic?: string;
    audioUrl?: string;
    provider: DictionaryProvider;
}

function dedupeDefinitions(meanings: VocabularyMeaning[]): VocabularyMeaning[] {
    return meanings.map((meaning) => ({
        ...meaning,
        definitions: Array.from(new Set(meaning.definitions.map((item) => item.trim()).filter(Boolean))),
        examples: meaning.examples
            ? Array.from(new Set(meaning.examples.map((item) => item.trim()).filter(Boolean)))
            : undefined,
        synonyms: meaning.synonyms
            ? Array.from(new Set(meaning.synonyms.map((item) => item.trim()).filter(Boolean)))
            : undefined,
        antonyms: meaning.antonyms
            ? Array.from(new Set(meaning.antonyms.map((item) => item.trim()).filter(Boolean)))
            : undefined,
    }));
}

/**
 * Normalizes a lookup query for dedupe and provider calls.
 */
export function normalizeLookupTerm(term: string): string {
    return term
        .trim()
        .toLowerCase()
        .replace(/^[\s"'“”‘’`.,!?;:()\[\]{}]+|[\s"'“”‘’`.,!?;:()\[\]{}]+$/g, "")
        .replace(/\s+/g, " ");
}

function toVocabularyTerm(result: DictionaryLookupResult): VocabularyTerm {
    const now = new Date();

    return {
        id: crypto.randomUUID(),
        term: result.term,
        normalizedTerm: result.normalizedTerm,
        language: result.language,
        phonetic: result.phonetic,
        audioUrl: result.audioUrl,
        meanings: result.meanings,
        providerHistory: result.providersUsed,
        lookupCount: 1,
        tags: [],
        contexts: [],
        createdAt: now,
        updatedAt: now,
    };
}

async function lookupWithFreeDictionaryApi(term: string): Promise<ProviderLookupResult | null> {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(term)}`;
    const response = await fetch(url);

    if (!response.ok) {
        return null;
    }

    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) {
        return null;
    }

    const entry = payload[0] || {};
    const phonetic = typeof entry.phonetic === "string" ? entry.phonetic : undefined;
    const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
    const audioEntry = phonetics.find((item: { audio?: string }) => Boolean(item?.audio));
    const audioUrl = audioEntry?.audio;

    const meanings = (Array.isArray(entry.meanings) ? entry.meanings : [])
        .map((item: {
            partOfSpeech?: string;
            definitions?: Array<{
                definition?: string;
                example?: string;
                synonyms?: string[];
                antonyms?: string[];
            }>;
        }) => {
            const definitions = (item.definitions || [])
                .map((definition) => definition.definition || "")
                .filter(Boolean);
            const examples = (item.definitions || [])
                .map((definition) => definition.example || "")
                .filter(Boolean);
            const synonyms = (item.definitions || [])
                .flatMap((definition) => definition.synonyms || []);
            const antonyms = (item.definitions || [])
                .flatMap((definition) => definition.antonyms || []);

            return {
                provider: "free_dictionary_api" as const,
                partOfSpeech: item.partOfSpeech,
                definitions,
                examples,
                synonyms,
                antonyms,
            };
        })
        .filter((item: VocabularyMeaning) => item.definitions.length > 0);

    if (meanings.length === 0) {
        return null;
    }

    return {
        meanings,
        phonetic,
        audioUrl,
        provider: "free_dictionary_api",
    };
}

async function lookupWithWiktionary(term: string): Promise<ProviderLookupResult | null> {
    const url = `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(term)}`;
    const response = await fetch(url);

    if (!response.ok) {
        return null;
    }

    const payload = await response.json();
    const entries = Array.isArray(payload?.en) ? payload.en : [];

    const meanings: VocabularyMeaning[] = [];

    for (const entry of entries) {
        const partOfSpeech = typeof entry?.partOfSpeech === "string" ? entry.partOfSpeech : undefined;
        const definitions = Array.isArray(entry?.definitions)
            ? entry.definitions
                .map((item: { definition?: string }) => item.definition || "")
                .filter(Boolean)
            : [];

        if (definitions.length === 0) {
            continue;
        }

        meanings.push({
            provider: "wiktionary",
            partOfSpeech,
            definitions,
        });
    }

    if (meanings.length === 0) {
        return null;
    }

    return {
        meanings,
        provider: "wiktionary",
    };
}

async function lookupWithStarDict(
    term: string,
    dictionaryIds: string[],
): Promise<ProviderLookupResult | null> {
    if (dictionaryIds.length === 0) {
        return null;
    }

    const meanings = await lookupInStarDictDictionaries(dictionaryIds, term);
    if (meanings.length === 0) {
        return null;
    }

    return {
        meanings,
        provider: "stardict",
    };
}

/**
 * Runs dictionary lookup according to configured provider strategy.
 */
export async function lookupDictionaryTerm(
    input: DictionaryLookupInput,
): Promise<DictionaryLookupResult | null> {
    const normalizedTerm = normalizeLookupTerm(input.term);
    if (!normalizedTerm) {
        return null;
    }

    const language = input.language || "en";
    const installedIds = input.installedDictionaryIds || [];

    const providerOrder: DictionaryProvider[] = input.mode === "offline"
        ? ["stardict"]
        : input.mode === "online"
            ? ["free_dictionary_api", "wiktionary"]
            : ["stardict", "free_dictionary_api", "wiktionary"];

    const collectedMeanings: VocabularyMeaning[] = [];
    const providersUsed: DictionaryProvider[] = [];
    let phonetic: string | undefined;
    let audioUrl: string | undefined;

    for (const provider of providerOrder) {
        try {
            let providerResult: ProviderLookupResult | null = null;

            if (provider === "stardict") {
                providerResult = await lookupWithStarDict(normalizedTerm, installedIds);
            } else if (provider === "free_dictionary_api") {
                providerResult = await lookupWithFreeDictionaryApi(normalizedTerm);
            } else {
                providerResult = await lookupWithWiktionary(normalizedTerm);
            }

            if (!providerResult || providerResult.meanings.length === 0) {
                continue;
            }

            providersUsed.push(providerResult.provider);
            collectedMeanings.push(...providerResult.meanings);

            if (!phonetic && providerResult.phonetic) {
                phonetic = providerResult.phonetic;
            }
            if (!audioUrl && providerResult.audioUrl) {
                audioUrl = providerResult.audioUrl;
            }

            if (provider !== "stardict") {
                break;
            }
        } catch (error) {
            console.warn("[DictionaryService] Provider lookup failed:", provider, error);
        }
    }

    const normalizedMeanings = dedupeDefinitions(collectedMeanings).filter(
        (item) => item.definitions.length > 0,
    );

    if (normalizedMeanings.length === 0) {
        return null;
    }

    return {
        term: input.term.trim(),
        normalizedTerm,
        language,
        phonetic,
        audioUrl,
        meanings: normalizedMeanings,
        providersUsed,
    };
}

/**
 * Helper to convert a lookup result into a persisted vocabulary term object.
 */
export function vocabularyTermFromLookup(result: DictionaryLookupResult): VocabularyTerm {
    return toVocabularyTerm(result);
}
