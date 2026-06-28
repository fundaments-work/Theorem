import type {
    DictionaryProvider,
    VocabularyMeaning,
    VocabularyTerm,
} from "../types";
import { lookupInStarDictDictionaries } from "./StarDictService";

export interface DictionaryLookupInput {
    term: string;
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

export function normalizeLookupTerm(term: string): string {
    return term
        .trim()
        .toLowerCase()
        .replace(/^[\s"'""'`.,!?;:()\[\]{}]+|[\s"'""'`.,!?;:()\[\]{}]+$/g, "")
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
        createdAt: now,
        updatedAt: now,
    };
}

async function lookupWithStarDict(
    term: string,
    dictionaryIds: string[],
): Promise<{ meanings: VocabularyMeaning[] } | null> {
    if (dictionaryIds.length === 0) return null;
    const meanings = await lookupInStarDictDictionaries(dictionaryIds, term);
    if (meanings.length === 0) return null;
    return { meanings };
}

/**
 * Looks up a term using installed StarDict dictionaries only.
 */
export async function lookupDictionaryTerm(
    input: DictionaryLookupInput,
): Promise<DictionaryLookupResult | null> {
    const normalizedTerm = normalizeLookupTerm(input.term);
    if (!normalizedTerm) return null;

    const language = input.language || "en";
    const installedIds = input.installedDictionaryIds || [];
    if (installedIds.length === 0) return null;

    try {
        const stardictResult = await lookupWithStarDict(normalizedTerm, installedIds);
        if (!stardictResult) return null;

        const normalizedMeanings = dedupeDefinitions(stardictResult.meanings).filter(
            (item) => item.definitions.length > 0,
        );
        if (normalizedMeanings.length === 0) return null;

        return {
            term: input.term.trim(),
            normalizedTerm,
            language,
            meanings: normalizedMeanings,
            providersUsed: ["stardict"],
        };
    } catch (error) {
        return null;
    }
}

/**
 * Helper to convert a lookup result into a persisted vocabulary term object.
 */
export function vocabularyTermFromLookup(result: DictionaryLookupResult): VocabularyTerm {
    return toVocabularyTerm(result);
}
