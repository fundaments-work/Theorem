/**
 * Academic Service
 * Queries arXiv and PubMed, parses XML with fast-xml-parser, downloads papers,
 * and generates formatted citations.
 */

import { v4 as uuidv4 } from "uuid";
import { XMLParser } from "fast-xml-parser";
import { isTauri } from "../lib/env";
import { saveBookData } from "../lib/storage";
import type {
    AcademicPaper,
    Book,
    CitationFormat,
    CitationReferenceData,
} from "../types";

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const PUBMED_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const OPENALEX_API_URL = "https://api.openalex.org";
const DEFAULT_ACADEMIC_PROXY_BASE = "/api/academic";
const PUBMED_MIN_INTERVAL_MS = 350;
const ACADEMIC_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const ACADEMIC_SEARCH_CACHE_MAX_ENTRIES = 120;
const OPENALEX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OPENALEX_CACHE_MAX_ENTRIES = 800;
const OPENALEX_ENRICHMENT_LIMIT = 8;
const REQUEST_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 12000;
const OPENALEX_REQUEST_TIMEOUT_MS = 6000;
const BINARY_REQUEST_TIMEOUT_MS = 90000;
const MAX_RETRY_AFTER_MS = 6000;

interface AcademicSearchCacheEntry {
    expiresAt: number;
    data: AcademicPaper[];
}

const academicSearchCache = new Map<string, AcademicSearchCacheEntry>();
const inFlightSearchCache = new Map<string, Promise<AcademicPaper[]>>();

interface OpenAlexEnrichment {
    citationCount?: number;
    fieldTags?: string[];
    openAccess?: boolean;
    openAccessUrl?: string;
}

interface OpenAlexCacheEntry {
    expiresAt: number;
    data: OpenAlexEnrichment;
}

const openAlexCache = new Map<string, OpenAlexCacheEntry>();
const openAlexInFlight = new Map<string, Promise<OpenAlexEnrichment | null>>();
let pubmedNextAllowedAt = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = Record<string, any>;

export interface AcademicSearchOptions {
    source?: "arxiv" | "pubmed" | "all";
    maxResults?: number;
    start?: number;
    sortBy?: "relevance" | "recent";
    enrichCitations?: boolean;
}

export interface AcademicDiscoveryOptions {
    source?: "arxiv" | "pubmed" | "all";
    fieldQuery: string;
    maxResults?: number;
    enrichCitations?: boolean;
}

export function clearAcademicSearchCache(): void {
    academicSearchCache.clear();
    inFlightSearchCache.clear();
    openAlexCache.clear();
    openAlexInFlight.clear();
    pubmedNextAllowedAt = 0;
}

function str(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if ("#text" in obj) return str(obj["#text"]);
        if ("__text" in obj) return str(obj["__text"]);
    }
    return "";
}

function ensureArray<T>(value: T | T[] | undefined | null): T[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function normalizeCacheToken(value: string): string {
    return normalizeWhitespace(value).toLowerCase();
}

function pruneAcademicSearchCache(): void {
    const now = Date.now();
    for (const [key, entry] of academicSearchCache.entries()) {
        if (entry.expiresAt <= now) {
            academicSearchCache.delete(key);
        }
    }

    if (academicSearchCache.size <= ACADEMIC_SEARCH_CACHE_MAX_ENTRIES) {
        return;
    }

    const overflow = academicSearchCache.size - ACADEMIC_SEARCH_CACHE_MAX_ENTRIES;
    const keysToDelete = academicSearchCache.keys();
    for (let index = 0; index < overflow; index += 1) {
        const next = keysToDelete.next();
        if (next.done) break;
        academicSearchCache.delete(next.value);
    }
}

function getCachedAcademicResults(cacheKey: string): AcademicPaper[] | null {
    const entry = academicSearchCache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        academicSearchCache.delete(cacheKey);
        return null;
    }
    return entry.data;
}

function setCachedAcademicResults(cacheKey: string, data: AcademicPaper[]): void {
    pruneAcademicSearchCache();
    academicSearchCache.set(cacheKey, {
        expiresAt: Date.now() + ACADEMIC_SEARCH_CACHE_TTL_MS,
        data,
    });
}

function pruneOpenAlexCache(): void {
    const now = Date.now();
    for (const [key, entry] of openAlexCache.entries()) {
        if (entry.expiresAt <= now) {
            openAlexCache.delete(key);
        }
    }

    if (openAlexCache.size <= OPENALEX_CACHE_MAX_ENTRIES) {
        return;
    }

    const overflow = openAlexCache.size - OPENALEX_CACHE_MAX_ENTRIES;
    const keysToDelete = openAlexCache.keys();
    for (let index = 0; index < overflow; index += 1) {
        const next = keysToDelete.next();
        if (next.done) break;
        openAlexCache.delete(next.value);
    }
}

function getOpenAlexCachedValue(cacheKey: string): OpenAlexEnrichment | null {
    const entry = openAlexCache.get(cacheKey);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        openAlexCache.delete(cacheKey);
        return null;
    }
    return entry.data;
}

function setOpenAlexCachedValue(cacheKey: string, data: OpenAlexEnrichment): void {
    pruneOpenAlexCache();
    openAlexCache.set(cacheKey, {
        expiresAt: Date.now() + OPENALEX_CACHE_TTL_MS,
        data,
    });
}

function getConfiguredProxyBase(): string {
    const env = (import.meta as ImportMeta & {
        env?: Record<string, string | undefined>;
    }).env;
    const configured = env?.VITE_ACADEMIC_PROXY_BASE?.trim();
    if (configured) {
        return configured.endsWith("/") ? configured.slice(0, -1) : configured;
    }
    return DEFAULT_ACADEMIC_PROXY_BASE;
}

function toAcademicRequestUrl(path: string, params?: URLSearchParams): string {
    if (isTauri()) {
        if (path === "arxiv") {
            return `${ARXIV_API_URL}?${params?.toString() || ""}`;
        }
        if (path === "pubmed/esearch") {
            return `${PUBMED_ESEARCH_URL}?${params?.toString() || ""}`;
        }
        if (path === "pubmed/efetch") {
            return `${PUBMED_EFETCH_URL}?${params?.toString() || ""}`;
        }
        if (path.startsWith("openalex")) {
            const suffix = path.replace(/^openalex/, "");
            const base = `${OPENALEX_API_URL}${suffix}`;
            return params ? `${base}?${params.toString()}` : base;
        }
    }

    const base = getConfiguredProxyBase();
    const withPath = /^https?:\/\//i.test(base)
        ? `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
        : `${base}/${path}`.replace(/\/{2,}/g, "/");
    return params ? `${withPath}?${params.toString()}` : withPath;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function timeoutError(timeoutMs: number): Error {
    return new Error(`Academic request timed out after ${Math.round(timeoutMs / 1000)}s.`);
}

function parseRetryAfter(value: string | null): number | null {
    if (!value) return null;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.floor(numeric * 1000);
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
        const delta = parsed - Date.now();
        if (delta > 0) return delta;
    }
    return null;
}

function shouldRetryStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

function extractStatusCodeFromError(error: unknown): number | null {
    if (!(error instanceof Error)) return null;
    const match = error.message.match(/(?:HTTP\\s*error:?\\s*|HTTP\\s+)(\\d{3})/i);
    if (!match) return null;
    const statusCode = Number(match[1]);
    return Number.isFinite(statusCode) ? statusCode : null;
}

async function waitForPubMedSlot(): Promise<void> {
    const now = Date.now();
    const waitTime = Math.max(0, pubmedNextAllowedAt - now);
    if (waitTime > 0) {
        await sleep(waitTime);
    }
    pubmedNextAllowedAt = Math.max(pubmedNextAllowedAt, Date.now()) + PUBMED_MIN_INTERVAL_MS;
}

function nodeText(node: unknown): string {
    if (node == null) return "";
    if (typeof node === "string") return node.trim();
    if (typeof node === "number" || typeof node === "boolean") return String(node);
    if (Array.isArray(node)) {
        return node.map((entry) => nodeText(entry)).filter(Boolean).join(" ").trim();
    }
    if (typeof node === "object") {
        const obj = node as XmlNode;
        if ("#text" in obj) return str(obj["#text"]);
    }
    return "";
}

function createAcademicParser(): XMLParser {
    return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: false,
        textNodeName: "#text",
        parseTagValue: false,
        parseAttributeValue: false,
        isArray: (name: string) => {
            return (
                name === "entry"
                || name === "author"
                || name === "link"
                || name === "PubmedArticle"
                || name === "Author"
                || name === "ArticleId"
                || name === "AbstractText"
            );
        },
        trimValues: true,
    });
}

function toIsoDate(value: unknown): string | undefined {
    const raw = str(value);
    if (!raw) return undefined;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }
    return parsed.toISOString();
}

function parsePubMedDate(pubDateNode: unknown): string | undefined {
    if (!pubDateNode || typeof pubDateNode !== "object") {
        return undefined;
    }
    const node = pubDateNode as XmlNode;
    const year = str(node.Year);
    if (!year) {
        const medlineDate = str(node.MedlineDate);
        if (!medlineDate) return undefined;
        const match = medlineDate.match(/(\d{4})/);
        if (!match) return undefined;
        return new Date(`${match[1]}-01-01T00:00:00.000Z`).toISOString();
    }

    const monthRaw = str(node.Month);
    const dayRaw = str(node.Day);
    const monthMap: Record<string, string> = {
        jan: "01",
        feb: "02",
        mar: "03",
        apr: "04",
        may: "05",
        jun: "06",
        jul: "07",
        aug: "08",
        sep: "09",
        oct: "10",
        nov: "11",
        dec: "12",
    };

    let month = monthRaw;
    if (!month) month = "01";
    if (!/^\d{1,2}$/.test(month)) {
        month = monthMap[month.toLowerCase().slice(0, 3)] || "01";
    }
    month = month.padStart(2, "0");

    let day = dayRaw;
    if (!day || !/^\d{1,2}$/.test(day)) {
        day = "01";
    }
    day = day.padStart(2, "0");

    const iso = `${year}-${month}-${day}T00:00:00.000Z`;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }
    return parsed.toISOString();
}

function isCorsLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
        message.includes("cors")
        || message.includes("cross-origin")
        || message.includes("failed to fetch")
        || message.includes("networkerror")
        || message.includes("load failed")
    );
}

async function fetchWithTauri(url: string): Promise<string> {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("fetch_url_content", { url });
}

async function fetchBinaryWithTauri(url: string): Promise<ArrayBuffer> {
    const { invoke } = await import("@tauri-apps/api/core");
    const bytes = await invoke<number[]>("fetch_binary_content", { url });
    return new Uint8Array(bytes).buffer;
}

function createProxyErrorHint(url: string): string {
    if (!url.includes("/api/academic")) {
        return "Academic search request failed.";
    }
    return (
        "Academic search proxy is not reachable. " +
        "Run the app with the configured dev proxy or set VITE_ACADEMIC_PROXY_BASE to a reachable API endpoint."
    );
}

function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
    const retryAfterMs = parseRetryAfter(retryAfterHeader || null);
    if (retryAfterMs != null) {
        return Math.max(250, Math.min(MAX_RETRY_AFTER_MS, retryAfterMs));
    }
    const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 120);
    return base + jitter;
}

async function fetchText(
    url: string,
    options: {
        preferNative?: boolean;
        pacedPubMed?: boolean;
        accept?: string;
        timeoutMs?: number;
        maxRetries?: number;
    } = {},
): Promise<string> {
    const preferNative = options.preferNative ?? false;
    const shouldPacePubMed = options.pacedPubMed ?? false;
    const acceptHeader = options.accept
        || "application/atom+xml, application/xml, text/xml, application/json, */*";
    const timeoutMs = Math.max(1000, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const maxRetries = Math.max(0, options.maxRetries ?? REQUEST_MAX_RETRIES);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        if (shouldPacePubMed) {
            await waitForPubMedSlot();
        }

        if (preferNative && isTauri()) {
            try {
                return await Promise.race([
                    fetchWithTauri(url),
                    sleep(timeoutMs).then(() => {
                        throw timeoutError(timeoutMs);
                    }),
                ]);
            } catch (nativeError) {
                const statusCode = extractStatusCodeFromError(nativeError);
                const isTimedOut = nativeError instanceof Error && nativeError.message.includes("timed out");
                const canRetry = (
                    (statusCode != null && shouldRetryStatus(statusCode))
                    || isTimedOut
                ) && attempt < maxRetries;
                if (canRetry) {
                    await sleep(retryDelayMs(attempt));
                    continue;
                }
                throw nativeError instanceof Error
                    ? nativeError
                    : new Error(String(nativeError));
            }
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, timeoutMs);
            let response: Response;
            try {
                response = await fetch(url, {
                    headers: {
                        Accept: acceptHeader,
                    },
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timeoutId);
            }

            if (response.ok) {
                return await response.text();
            }

            if (shouldRetryStatus(response.status) && attempt < maxRetries) {
                await sleep(retryDelayMs(attempt, response.headers.get("Retry-After")));
                continue;
            }

            if (!isTauri() && url.includes("/api/academic") && response.status === 404) {
                throw new Error(createProxyErrorHint(url));
            }

            throw new Error(`HTTP ${response.status}`);
        } catch (requestError) {
            const timedOut = (
                requestError instanceof DOMException
                && requestError.name === "AbortError"
            );
            if (timedOut) {
                if (attempt < maxRetries) {
                    await sleep(retryDelayMs(attempt));
                    continue;
                }
                throw timeoutError(timeoutMs);
            }

            const statusCode = extractStatusCodeFromError(requestError);
            const canRetryByStatus = statusCode != null && shouldRetryStatus(statusCode) && attempt < maxRetries;
            if (canRetryByStatus) {
                await sleep(retryDelayMs(attempt));
                continue;
            }

            if (requestError instanceof Error && isCorsLikeError(requestError) && !isTauri()) {
                throw new Error(createProxyErrorHint(url));
            }

            throw requestError instanceof Error ? requestError : new Error(String(requestError));
        }
    }

    throw new Error("Failed to fetch academic data after retries.");
}

async function fetchBinary(url: string): Promise<ArrayBuffer> {
    for (let attempt = 0; attempt <= REQUEST_MAX_RETRIES; attempt += 1) {
        if (isTauri()) {
            try {
                return await Promise.race([
                    fetchBinaryWithTauri(url),
                    sleep(BINARY_REQUEST_TIMEOUT_MS).then(() => {
                        throw timeoutError(BINARY_REQUEST_TIMEOUT_MS);
                    }),
                ]);
            } catch (nativeError) {
                const statusCode = extractStatusCodeFromError(nativeError);
                const isTimedOut = nativeError instanceof Error && nativeError.message.includes("timed out");
                const canRetry = (
                    (statusCode != null && shouldRetryStatus(statusCode))
                    || isTimedOut
                ) && attempt < REQUEST_MAX_RETRIES;
                if (canRetry) {
                    await sleep(retryDelayMs(attempt));
                    continue;
                }
                throw nativeError instanceof Error
                    ? nativeError
                    : new Error(String(nativeError));
            }
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, BINARY_REQUEST_TIMEOUT_MS);

            let response: Response;
            try {
                response = await fetch(url, {
                    headers: {
                        Accept: "application/pdf, application/octet-stream, */*",
                    },
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timeoutId);
            }

            if (response.ok) {
                return await response.arrayBuffer();
            }

            if (shouldRetryStatus(response.status) && attempt < REQUEST_MAX_RETRIES) {
                await sleep(retryDelayMs(attempt, response.headers.get("Retry-After")));
                continue;
            }

            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            const timedOut = error instanceof DOMException && error.name === "AbortError";
            if (timedOut && attempt < REQUEST_MAX_RETRIES) {
                await sleep(retryDelayMs(attempt));
                continue;
            }
            if (timedOut) {
                throw timeoutError(BINARY_REQUEST_TIMEOUT_MS);
            }
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    throw new Error("Failed to fetch binary paper data after retries.");
}

function normalizeArxivQuery(query: string): string {
    const cleaned = query.trim();
    if (!cleaned) return "";
    if (cleaned.includes(":")) return cleaned;
    return `all:${cleaned}`;
}

function buildArxivParams({
    query,
    start,
    maxResults,
    sortBy = "relevance",
}: {
    query: string;
    start: number;
    maxResults: number;
    sortBy?: "relevance" | "recent";
}): URLSearchParams {
    const apiSortBy = sortBy === "recent" ? "lastUpdatedDate" : "relevance";
    const apiSortOrder = "descending";
    return new URLSearchParams({
        search_query: query,
        start: String(start),
        max_results: String(maxResults),
        sortBy: apiSortBy,
        sortOrder: apiSortOrder,
    });
}

function extractArxivId(rawId: string): string | undefined {
    if (!rawId) return undefined;
    const match = rawId.match(/arxiv\.org\/abs\/([^/?#]+)/i);
    if (match?.[1]) return match[1];
    return rawId;
}

function pickArxivLinks(entry: XmlNode): { url?: string; pdfUrl?: string } {
    const links = ensureArray(entry.link) as XmlNode[];
    let url: string | undefined;
    let pdfUrl: string | undefined;

    for (const link of links) {
        const href = str(link?.["@_href"]);
        if (!href) continue;

        const rel = str(link?.["@_rel"]).toLowerCase();
        const type = str(link?.["@_type"]).toLowerCase();
        const title = str(link?.["@_title"]).toLowerCase();

        if (!url && (rel === "alternate" || rel === "")) {
            url = href;
        }
        if (!pdfUrl && (type === "application/pdf" || title === "pdf" || href.includes("/pdf/"))) {
            pdfUrl = href.endsWith(".pdf") ? href : `${href}.pdf`;
        }
    }

    const fallbackUrl = url || str(entry.id);
    if (!pdfUrl && fallbackUrl.includes("/abs/")) {
        pdfUrl = `${fallbackUrl.replace("/abs/", "/pdf/")}.pdf`;
    }
    return { url: fallbackUrl || undefined, pdfUrl };
}

function parseArxivFeed(xml: string): AcademicPaper[] {
    const parser = createAcademicParser();
    const parsed = parser.parse(xml) as XmlNode;
    const root = parsed.feed || parsed;
    const entries = ensureArray(root.entry) as XmlNode[];

    return entries.map((entry) => {
        const rawId = nodeText(entry.id);
        const sourceId = extractArxivId(rawId);
        const title = normalizeWhitespace(nodeText(entry.title)) || "Untitled Paper";
        const abstractText = normalizeWhitespace(nodeText(entry.summary));
        const authors = ensureArray(entry.author)
            .map((author) => normalizeWhitespace(nodeText((author as XmlNode).name || author)))
            .filter(Boolean);
        const publishedDate = toIsoDate(entry.published || entry.updated);
        const doi = str(entry["arxiv:doi"]) || undefined;
        const journal = str(entry["arxiv:journal_ref"]) || undefined;
        const { url, pdfUrl } = pickArxivLinks(entry);

        const paper: AcademicPaper = {
            id: sourceId ? `arxiv:${sourceId}` : `arxiv:${title.toLowerCase().replace(/\s+/g, "-")}`,
            source: "arxiv",
            sourceId,
            title,
            authors,
            abstract: abstractText || undefined,
            doi,
            journal,
            pdfUrl,
            url,
            publishedDate,
        };
        paper.referenceData = buildReferenceData(paper);
        return paper;
    });
}

function parsePubMedAuthor(author: XmlNode): string {
    const collective = str(author.CollectiveName);
    if (collective) return collective;
    const lastName = str(author.LastName);
    const foreName = str(author.ForeName || author.Initials);
    const fullName = [foreName, lastName].filter(Boolean).join(" ").trim();
    return fullName || str(author.name);
}

function parsePubMedAbstract(article: XmlNode): string | undefined {
    const abstractNode = article?.Abstract;
    if (!abstractNode) return undefined;

    const chunks = ensureArray(abstractNode.AbstractText)
        .map((entry) => {
            if (typeof entry === "object" && entry != null) {
                const label = str((entry as XmlNode)["@_Label"]);
                const text = normalizeWhitespace(nodeText(entry));
                if (!text) return "";
                return label ? `${label}: ${text}` : text;
            }
            return normalizeWhitespace(nodeText(entry));
        })
        .filter(Boolean);

    if (chunks.length === 0) return undefined;
    return chunks.join(" ");
}

function parsePubMedDoi(pubmedData: XmlNode): string | undefined {
    const ids = ensureArray(pubmedData?.ArticleIdList?.ArticleId) as XmlNode[];
    for (const idNode of ids) {
        const idType = str(idNode?.["@_IdType"]).toLowerCase();
        const value = nodeText(idNode);
        if (idType === "doi" && value) {
            return value;
        }
    }
    return undefined;
}

function parsePubMedArticles(xml: string): AcademicPaper[] {
    const parser = createAcademicParser();
    const parsed = parser.parse(xml) as XmlNode;
    const root = parsed.PubmedArticleSet || parsed;
    const articles = ensureArray(root.PubmedArticle) as XmlNode[];

    return articles.map((item) => {
        const medlineCitation = item.MedlineCitation || {};
        const articleNode = medlineCitation.Article || {};
        const pubmedData = item.PubmedData || {};

        const pmid = nodeText(medlineCitation.PMID);
        const title = normalizeWhitespace(nodeText(articleNode.ArticleTitle)) || "Untitled Paper";
        const authors = ensureArray(articleNode.AuthorList?.Author)
            .map((author) => parsePubMedAuthor(author as XmlNode))
            .filter(Boolean);
        const abstractText = parsePubMedAbstract(articleNode);
        const journal = normalizeWhitespace(
            str(articleNode.Journal?.Title) || str(articleNode.Journal?.ISOAbbreviation),
        ) || undefined;
        const publishedDate = parsePubMedDate(articleNode.Journal?.JournalIssue?.PubDate);
        const doi = parsePubMedDoi(pubmedData);
        const url = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined;
        const pdfUrl = doi ? `https://doi.org/${doi}` : undefined;

        const paper: AcademicPaper = {
            id: pmid ? `pubmed:${pmid}` : `pubmed:${title.toLowerCase().replace(/\s+/g, "-")}`,
            source: "pubmed",
            sourceId: pmid || undefined,
            title,
            authors,
            abstract: abstractText,
            doi,
            journal,
            pdfUrl,
            url,
            publishedDate,
        };
        paper.referenceData = buildReferenceData(paper);
        return paper;
    });
}

function toOpenAlexCacheKey(paper: AcademicPaper): string {
    if (paper.doi) {
        return `doi:${paper.doi.toLowerCase()}`;
    }
    return `title:${normalizeCacheToken(paper.title || "")}`;
}

function parseOpenAlexWork(workNode: XmlNode): OpenAlexEnrichment {
    const fieldValues = ensureArray(workNode?.x_concepts)
        .slice(0, 4)
        .map((entry) => str((entry as XmlNode)?.display_name))
        .filter(Boolean);
    const primaryField = str(workNode?.primary_topic?.field?.display_name);
    if (primaryField && !fieldValues.includes(primaryField)) {
        fieldValues.unshift(primaryField);
    }

    return {
        citationCount: typeof workNode?.cited_by_count === "number"
            ? workNode.cited_by_count
            : undefined,
        fieldTags: fieldValues.length > 0 ? fieldValues : undefined,
        openAccess: typeof workNode?.open_access?.is_oa === "boolean"
            ? workNode.open_access.is_oa
            : undefined,
        openAccessUrl: str(workNode?.open_access?.oa_url) || undefined,
    };
}

async function fetchOpenAlexEnrichment(paper: AcademicPaper): Promise<OpenAlexEnrichment | null> {
    if (!paper.doi && !paper.title) {
        return null;
    }

    const cacheKey = toOpenAlexCacheKey(paper);
    const cached = getOpenAlexCachedValue(cacheKey);
    if (cached) {
        return cached;
    }

    const inFlight = openAlexInFlight.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const request = (async (): Promise<OpenAlexEnrichment | null> => {
        try {
            let url: string;
            if (paper.doi) {
                const safeDoi = encodeURIComponent(`https://doi.org/${paper.doi}`);
                url = toAcademicRequestUrl(`openalex/works/${safeDoi}`);
            } else {
                const params = new URLSearchParams({
                    search: paper.title,
                    "per-page": "1",
                });
                url = toAcademicRequestUrl("openalex/works", params);
            }

            const payload = await fetchText(url, {
                preferNative: isTauri(),
                accept: "application/json, */*",
                timeoutMs: OPENALEX_REQUEST_TIMEOUT_MS,
                maxRetries: 1,
            });
            let parsed: XmlNode;
            try {
                parsed = JSON.parse(payload) as XmlNode;
            } catch {
                return null;
            }

            const workNode = paper.doi
                ? parsed
                : (ensureArray(parsed.results)[0] as XmlNode | undefined);
            if (!workNode) {
                return null;
            }

            const enrichment = parseOpenAlexWork(workNode);
            if (
                enrichment.citationCount == null
                && !enrichment.fieldTags
                && enrichment.openAccess == null
                && !enrichment.openAccessUrl
            ) {
                return null;
            }

            setOpenAlexCachedValue(cacheKey, enrichment);
            return enrichment;
        } catch (error) {
            console.warn("[AcademicService] OpenAlex enrichment failed:", error);
            return null;
        }
    })();

    openAlexInFlight.set(cacheKey, request);
    try {
        return await request;
    } finally {
        openAlexInFlight.delete(cacheKey);
    }
}

async function enrichPapersWithOpenAlex(papers: AcademicPaper[]): Promise<AcademicPaper[]> {
    if (papers.length === 0) {
        return papers;
    }

    const candidates = papers
        .filter((paper) => !paper.citationCount || !paper.fieldTags || paper.openAccess == null)
        .sort((a, b) => Number(Boolean(b.doi)) - Number(Boolean(a.doi)))
        .slice(0, OPENALEX_ENRICHMENT_LIMIT);

    await Promise.allSettled(candidates.map(async (paper) => {
        const enrichment = await fetchOpenAlexEnrichment(paper);
        if (!enrichment) {
            return;
        }
        if (typeof enrichment.citationCount === "number") {
            paper.citationCount = enrichment.citationCount;
        }
        if (enrichment.fieldTags?.length) {
            paper.fieldTags = enrichment.fieldTags;
        }
        if (typeof enrichment.openAccess === "boolean") {
            paper.openAccess = enrichment.openAccess;
        }
        if (enrichment.openAccessUrl) {
            paper.openAccessUrl = enrichment.openAccessUrl;
        }
    }));

    return papers;
}

function citationKey(paper: AcademicPaper): string {
    const firstAuthor = paper.authors[0] || "paper";
    const family = splitAuthorName(firstAuthor).family || "paper";
    const year = citationYear(paper) || "n.d.";
    const titleToken = (paper.title || "untitled")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter(Boolean)[0] || "paper";
    return `${family.toLowerCase()}${year}${titleToken}`;
}

function splitAuthorName(author: string): { given: string; family: string } {
    const normalized = normalizeWhitespace(author);
    if (!normalized) return { given: "", family: "" };
    const parts = normalized.split(" ").filter(Boolean);
    if (parts.length === 1) return { given: "", family: parts[0] };
    return {
        given: parts.slice(0, -1).join(" "),
        family: parts[parts.length - 1],
    };
}

function citationYear(paper: AcademicPaper): string | undefined {
    const iso = paper.publishedDate;
    if (!iso) return undefined;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return String(parsed.getUTCFullYear());
}

function formatApaAuthors(authors: string[]): string {
    if (authors.length === 0) return "Unknown";
    const rendered = authors.map((author) => {
        const { given, family } = splitAuthorName(author);
        const initials = given
            .split(" ")
            .filter(Boolean)
            .map((part) => `${part[0]?.toUpperCase()}.`)
            .join(" ");
        return [family, initials].filter(Boolean).join(", ");
    });
    if (rendered.length === 1) return rendered[0];
    if (rendered.length === 2) return `${rendered[0]} & ${rendered[1]}`;
    return `${rendered.slice(0, -1).join(", ")}, & ${rendered[rendered.length - 1]}`;
}

function formatMlaAuthors(authors: string[]): string {
    if (authors.length === 0) return "Unknown";
    const first = splitAuthorName(authors[0]);
    const firstDisplay = [first.family, first.given].filter(Boolean).join(", ");
    if (authors.length === 1) return firstDisplay;
    if (authors.length === 2) {
        const second = splitAuthorName(authors[1]);
        return `${firstDisplay}, and ${[second.given, second.family].filter(Boolean).join(" ")}`;
    }
    return `${firstDisplay}, et al.`;
}

function buildBibtex(paper: AcademicPaper): string {
    const entryType = paper.conference ? "inproceedings" : "article";
    const key = citationKey(paper);
    const fields: Array<[string, string | undefined]> = [
        ["title", paper.title],
        ["author", paper.authors.join(" and ") || undefined],
        [paper.conference ? "booktitle" : "journal", paper.conference || paper.journal],
        ["year", citationYear(paper)],
        ["doi", paper.doi],
        ["url", paper.pdfUrl || paper.url],
    ];

    const lines = fields
        .filter(([, value]) => Boolean(value))
        .map(([name, value]) => `  ${name} = {${value}}`);

    return `@${entryType}{${key},\n${lines.join(",\n")}\n}`;
}

function buildCslJson(paper: AcademicPaper): Record<string, unknown> {
    const issuedYear = citationYear(paper);
    return {
        id: paper.id,
        type: paper.conference ? "paper-conference" : "article-journal",
        title: paper.title,
        DOI: paper.doi,
        URL: paper.pdfUrl || paper.url,
        containerTitle: paper.journal || paper.conference,
        issued: issuedYear
            ? {
                "date-parts": [[Number(issuedYear)]],
            }
            : undefined,
        author: paper.authors.map((author) => {
            const parsed = splitAuthorName(author);
            return {
                family: parsed.family || author,
                given: parsed.given || undefined,
                literal: !parsed.family ? author : undefined,
            };
        }),
    };
}

function buildReferenceData(paper: AcademicPaper): CitationReferenceData {
    return {
        bibtex: buildBibtex(paper),
        cslJson: buildCslJson(paper),
    };
}

function inferFilenameFromUrl(url: string): string {
    try {
        const parsed = new URL(url);
        const pathname = parsed.pathname || "";
        const tail = pathname.split("/").pop() || "";
        if (tail) {
            return tail.toLowerCase().endsWith(".pdf") ? tail : `${tail}.pdf`;
        }
    } catch {
        // ignore and fallback below
    }
    return "paper.pdf";
}

export function generateCitation(paper: AcademicPaper, format: CitationFormat): string {
    if (format === "bibtex") {
        return paper.referenceData?.bibtex || buildBibtex(paper);
    }

    const year = citationYear(paper) || "n.d.";
    const title = paper.title || "Untitled";
    const venue = paper.journal || paper.conference || "";
    const doiOrUrl = paper.doi
        ? `https://doi.org/${paper.doi}`
        : (paper.pdfUrl || paper.url || "");

    if (format === "mla") {
        const authorText = formatMlaAuthors(paper.authors);
        return [
            `${authorText}.`,
            `"${title}."`,
            venue ? `${venue},` : "",
            `${year}.`,
            doiOrUrl,
        ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    // APA
    const authorText = formatApaAuthors(paper.authors);
    return [
        `${authorText}`,
        `(${year}).`,
        `${title}.`,
        venue ? `${venue}.` : "",
        doiOrUrl,
    ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

export function toAcademicPaper(book: Book): AcademicPaper | null {
    if (!book.academic) return null;
    const academicAuthors = Array.isArray(book.academic.authors)
        ? book.academic.authors.filter(Boolean)
        : [];
    const paper: AcademicPaper = {
        id: book.id,
        source: book.academic.source,
        sourceId: book.academic.sourceId,
        title: book.title,
        authors: academicAuthors.length > 0
            ? academicAuthors
            : book.author.split(",").map((entry) => normalizeWhitespace(entry)).filter(Boolean),
        abstract: book.academic.abstract || book.description,
        doi: book.academic.doi,
        journal: book.academic.journal,
        conference: book.academic.conference,
        citationCount: book.academic.citationCount,
        fieldTags: book.academic.fieldTags,
        openAccess: book.academic.openAccess,
        openAccessUrl: book.academic.openAccessUrl,
        pdfUrl: book.academic.pdfUrl,
        url: book.filePath,
        publishedDate: book.publishedDate,
        referenceData: book.academic.referenceData,
    };
    if (!paper.referenceData) {
        paper.referenceData = buildReferenceData(paper);
    }
    return paper;
}

export function isAcademicBook(book: Book): boolean {
    return Boolean(book.academic) || book.tags.some((tag) => tag.toLowerCase() === "academic");
}

export async function searchArxivPapers(
    query: string,
    options: Omit<AcademicSearchOptions, "source"> = {},
): Promise<AcademicPaper[]> {
    const cleaned = query.trim();
    if (!cleaned) return [];

    const maxResults = Math.max(1, Math.min(50, options.maxResults ?? 20));
    const start = Math.max(0, options.start ?? 0);
    const sortBy = options.sortBy ?? "relevance";
    const cacheKey = [
        "arxiv",
        normalizeCacheToken(cleaned),
        String(maxResults),
        String(start),
        sortBy,
        options.enrichCitations === false ? "no-enrich" : "enrich",
    ].join("|");

    const cached = getCachedAcademicResults(cacheKey);
    if (cached) {
        return cached;
    }

    const inFlight = inFlightSearchCache.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const request = (async () => {
        const params = buildArxivParams({
            query: normalizeArxivQuery(cleaned),
            start,
            maxResults,
            sortBy,
        });

        const response = await fetchText(
            toAcademicRequestUrl("arxiv", params),
            {
                preferNative: isTauri(),
            },
        );
        const results = parseArxivFeed(response);
        if (options.enrichCitations !== false) {
            await enrichPapersWithOpenAlex(results);
        }
        setCachedAcademicResults(cacheKey, results);
        return results;
    })();

    inFlightSearchCache.set(cacheKey, request);
    try {
        return await request;
    } finally {
        inFlightSearchCache.delete(cacheKey);
    }
}

export async function searchPubMedPapers(
    query: string,
    options: Omit<AcademicSearchOptions, "source"> = {},
): Promise<AcademicPaper[]> {
    const cleaned = query.trim();
    if (!cleaned) return [];

    const maxResults = Math.max(1, Math.min(50, options.maxResults ?? 20));
    const start = Math.max(0, options.start ?? 0);
    const sortBy = options.sortBy ?? "relevance";
    const cacheKey = [
        "pubmed",
        normalizeCacheToken(cleaned),
        String(maxResults),
        String(start),
        sortBy,
        options.enrichCitations === false ? "no-enrich" : "enrich",
    ].join("|");

    const cached = getCachedAcademicResults(cacheKey);
    if (cached) {
        return cached;
    }

    const inFlight = inFlightSearchCache.get(cacheKey);
    if (inFlight) {
        return inFlight;
    }

    const request = (async () => {
        const params = new URLSearchParams({
            db: "pubmed",
            retmode: "json",
            retmax: String(maxResults),
            retstart: String(start),
            term: cleaned,
            sort: sortBy === "recent" ? "pub+date" : "relevance",
        });

        const searchText = await fetchText(
            toAcademicRequestUrl("pubmed/esearch", params),
            {
                preferNative: isTauri(),
                pacedPubMed: true,
                accept: "application/json, */*",
            },
        );
        let searchPayload: { esearchresult?: { idlist?: string[] } } = {};
        try {
            searchPayload = JSON.parse(searchText) as { esearchresult?: { idlist?: string[] } };
        } catch (error) {
            throw new Error(`Failed to parse PubMed search response: ${String(error)}`);
        }

        const ids = ensureArray(searchPayload.esearchresult?.idlist).map((id) => str(id)).filter(Boolean);
        if (ids.length === 0) {
            return [];
        }

        const fetchParams = new URLSearchParams({
            db: "pubmed",
            retmode: "xml",
            id: ids.join(","),
        });
        const xml = await fetchText(
            toAcademicRequestUrl("pubmed/efetch", fetchParams),
            {
                preferNative: isTauri(),
                pacedPubMed: true,
            },
        );
        const results = parsePubMedArticles(xml);
        if (options.enrichCitations !== false) {
            await enrichPapersWithOpenAlex(results);
        }
        setCachedAcademicResults(cacheKey, results);
        return results;
    })();

    inFlightSearchCache.set(cacheKey, request);
    try {
        return await request;
    } finally {
        inFlightSearchCache.delete(cacheKey);
    }
}

function dedupeAcademicPapers(papers: AcademicPaper[]): AcademicPaper[] {
    const dedupe = new Map<string, AcademicPaper>();
    for (const paper of papers) {
        const key = paper.doi?.toLowerCase() || paper.id;
        if (!dedupe.has(key)) {
            dedupe.set(key, paper);
        }
    }
    return Array.from(dedupe.values());
}

export async function searchAcademicPapers(
    query: string,
    options: AcademicSearchOptions = {},
): Promise<AcademicPaper[]> {
    const source = options.source ?? "all";
    const scopedOptions = {
        maxResults: options.maxResults,
        start: options.start,
        sortBy: options.sortBy,
        enrichCitations: options.enrichCitations,
    };

    if (source === "arxiv") {
        return searchArxivPapers(query, scopedOptions);
    }
    if (source === "pubmed") {
        return searchPubMedPapers(query, scopedOptions);
    }

    const settled = await Promise.allSettled([
        searchArxivPapers(query, scopedOptions),
        searchPubMedPapers(query, scopedOptions),
    ]);

    const successful = settled
        .filter((result): result is PromiseFulfilledResult<AcademicPaper[]> => result.status === "fulfilled")
        .flatMap((result) => result.value);
    if (successful.length > 0) {
        return dedupeAcademicPapers(successful);
    }

    const failures = settled
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (
            result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
        ));
    throw new Error(failures[0] || "Failed to fetch papers from arXiv and PubMed.");
}

export async function discoverAcademicPapers(
    options: AcademicDiscoveryOptions,
): Promise<AcademicPaper[]> {
    const source = options.source ?? "all";
    const fieldQuery = options.fieldQuery.trim();
    if (!fieldQuery) {
        return [];
    }

    const maxResults = Math.max(1, Math.min(50, options.maxResults ?? 24));
    const scopedOptions: Omit<AcademicSearchOptions, "source"> = {
        maxResults,
        start: 0,
        sortBy: "recent",
        enrichCitations: options.enrichCitations ?? true,
    };

    if (source === "arxiv") {
        return searchArxivPapers(fieldQuery, scopedOptions);
    }

    if (source === "pubmed") {
        return searchPubMedPapers(fieldQuery, scopedOptions);
    }

    const settled = await Promise.allSettled([
        searchArxivPapers(fieldQuery, scopedOptions),
        searchPubMedPapers(fieldQuery, scopedOptions),
    ]);

    const successful = settled
        .filter((result): result is PromiseFulfilledResult<AcademicPaper[]> => result.status === "fulfilled")
        .flatMap((result) => result.value);
    if (successful.length > 0) {
        return dedupeAcademicPapers(successful);
    }

    const failures = settled
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (
            result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
        ));
    throw new Error(failures[0] || "Failed to discover papers from arXiv and PubMed.");
}

export async function downloadPaper(url: string, paper?: AcademicPaper): Promise<Book> {
    const resolvedUrl = url.trim();
    if (!resolvedUrl) {
        throw new Error("downloadPaper requires a non-empty URL.");
    }

    const fileBuffer = await fetchBinary(resolvedUrl);
    if (!fileBuffer || fileBuffer.byteLength === 0) {
        throw new Error("Downloaded paper content is empty.");
    }

    const id = uuidv4();
    const storagePath = await saveBookData(id, fileBuffer);
    const now = new Date();
    const normalizedTitle = paper?.title?.trim() || inferFilenameFromUrl(resolvedUrl).replace(/\.pdf$/i, "");
    const authors = paper?.authors?.length
        ? paper.authors
        : [];
    const author = authors.join(", ");
    const referenceData = paper?.referenceData || (paper ? buildReferenceData(paper) : undefined);
    const source = paper?.source || "manual";
    const sourceId = paper?.sourceId;

    const book: Book = {
        id,
        title: normalizedTitle || "Untitled Paper",
        author: author || "Unknown Author",
        filePath: resolvedUrl,
        storagePath,
        format: "pdf",
        description: paper?.abstract,
        publisher: paper?.journal || paper?.conference,
        publishedDate: paper?.publishedDate,
        fileSize: fileBuffer.byteLength,
        addedAt: now,
        progress: 0,
        tags: Array.from(
            new Set(
                [
                    "Academic",
                    "Paper",
                    source === "arxiv" ? "arXiv" : undefined,
                    source === "pubmed" ? "PubMed" : undefined,
                ].filter((value): value is string => Boolean(value)),
            ),
        ),
        category: "Academic",
        isFavorite: false,
        readingTime: 0,
        academic: {
            source,
            sourceId,
            doi: paper?.doi,
            journal: paper?.journal,
            conference: paper?.conference,
            abstract: paper?.abstract,
            authors,
            citationCount: paper?.citationCount,
            fieldTags: paper?.fieldTags,
            openAccess: paper?.openAccess,
            openAccessUrl: paper?.openAccessUrl,
            pdfUrl: paper?.pdfUrl || resolvedUrl,
            referenceData,
        },
    };

    return book;
}
