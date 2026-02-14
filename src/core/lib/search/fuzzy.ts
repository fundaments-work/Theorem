import Fuse, { type FuseOptionKey } from "fuse.js";

const DEFAULT_FUZZY_THRESHOLD = 0.34;
const DEFAULT_MIN_MATCH_CHAR_LENGTH = 2;

export interface RankByFuzzyQueryOptions<T> {
    keys: Array<FuseOptionKey<T>>;
    threshold?: number;
    minMatchCharLength?: number;
    ignoreLocation?: boolean;
    limit?: number;
}

export interface RankedFuzzyItem<T> {
    item: T;
    score: number;
}

/**
 * Applies fuzzy ranking and returns items ordered by relevance.
 */
export function rankByFuzzyQuery<T>(
    items: T[],
    query: string,
    options: RankByFuzzyQueryOptions<T>,
): RankedFuzzyItem<T>[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || items.length === 0) {
        return items.map((item) => ({ item, score: 0 }));
    }

    const fuse = new Fuse(items, {
        keys: options.keys,
        threshold: options.threshold ?? DEFAULT_FUZZY_THRESHOLD,
        ignoreLocation: options.ignoreLocation ?? true,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: options.minMatchCharLength ?? DEFAULT_MIN_MATCH_CHAR_LENGTH,
    });

    const rawResults = options.limit
        ? fuse.search(normalizedQuery, { limit: options.limit })
        : fuse.search(normalizedQuery);

    return rawResults.map(({ item, score }) => ({
        item,
        score: score ?? 0,
    }));
}
