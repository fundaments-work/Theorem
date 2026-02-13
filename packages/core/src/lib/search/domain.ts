import type { AppRoute } from "../../types";

export type SearchPlacement = "appTitlebar" | "readerPanel";

export type SearchDomain =
    | "library"
    | "vocabulary"
    | "annotations"
    | "bookmarks"
    | "shelves"
    | "feeds"
    | "reader"
    | "none";

const APP_TITLEBAR_DOMAIN_BY_ROUTE: Record<AppRoute, SearchDomain> = {
    library: "library",
    reader: "none",
    articleReader: "none",
    vocabulary: "vocabulary",
    settings: "none",
    bookDetails: "none",
    annotations: "annotations",
    statistics: "none",
    shelves: "shelves",
    bookmarks: "bookmarks",
    feeds: "feeds",
};

const SEARCH_PLACEHOLDER_BY_DOMAIN: Record<Exclude<SearchDomain, "none">, string> = {
    library: "Search books, authors, or tags...",
    vocabulary: "Search terms, definitions, notes, or sources...",
    annotations: "Search highlights, notes, or books...",
    bookmarks: "Search bookmarks, books, or authors...",
    shelves: "Search shelves...",
    feeds: "Search articles...",
    reader: "Search in book...",
};

/**
 * Resolves the active search domain from placement and current route.
 */
export function resolveSearchDomain({
    placement,
    route,
}: {
    placement: SearchPlacement;
    route: AppRoute;
}): SearchDomain {
    if (placement === "readerPanel") {
        return "reader";
    }

    return APP_TITLEBAR_DOMAIN_BY_ROUTE[route] ?? "none";
}

/**
 * Returns the search placeholder for a domain.
 */
export function getSearchPlaceholder(domain: SearchDomain): string {
    if (domain === "none") {
        return "";
    }
    return SEARCH_PLACEHOLDER_BY_DOMAIN[domain];
}

/**
 * Helper for route/placement rendering logic.
 */
export function hasSearchDomain(domain: SearchDomain): boolean {
    return domain !== "none";
}
