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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type XmlNode = Record<string, any>;

export interface AcademicSearchOptions {
    source?: "arxiv" | "pubmed" | "all";
    maxResults?: number;
    start?: number;
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

async function fetchText(url: string): Promise<string> {
    try {
        const response = await fetch(url, {
            headers: {
                Accept: "application/atom+xml, application/xml, text/xml, application/json, */*",
            },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.text();
    } catch (error) {
        if (!isTauri()) {
            throw error;
        }

        try {
            return await fetchWithTauri(url);
        } catch (tauriError) {
            if (isCorsLikeError(error)) {
                throw tauriError;
            }
            throw error;
        }
    }
}

async function fetchBinary(url: string): Promise<ArrayBuffer> {
    try {
        const response = await fetch(url, {
            headers: {
                Accept: "application/pdf, application/octet-stream, */*",
            },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.arrayBuffer();
    } catch (error) {
        if (!isTauri()) {
            throw error;
        }

        try {
            return await fetchBinaryWithTauri(url);
        } catch (tauriError) {
            if (isCorsLikeError(error)) {
                throw tauriError;
            }
            throw error;
        }
    }
}

function normalizeArxivQuery(query: string): string {
    const cleaned = query.trim();
    if (!cleaned) return "";
    if (cleaned.includes(":")) return cleaned;
    return `all:${cleaned}`;
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

    const params = new URLSearchParams({
        search_query: normalizeArxivQuery(cleaned),
        start: String(start),
        max_results: String(maxResults),
        sortBy: "relevance",
        sortOrder: "descending",
    });

    const response = await fetchText(`${ARXIV_API_URL}?${params.toString()}`);
    return parseArxivFeed(response);
}

export async function searchPubMedPapers(
    query: string,
    options: Omit<AcademicSearchOptions, "source"> = {},
): Promise<AcademicPaper[]> {
    const cleaned = query.trim();
    if (!cleaned) return [];

    const maxResults = Math.max(1, Math.min(50, options.maxResults ?? 20));
    const start = Math.max(0, options.start ?? 0);
    const params = new URLSearchParams({
        db: "pubmed",
        retmode: "json",
        retmax: String(maxResults),
        retstart: String(start),
        term: cleaned,
    });

    const searchText = await fetchText(`${PUBMED_ESEARCH_URL}?${params.toString()}`);
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
    const xml = await fetchText(`${PUBMED_EFETCH_URL}?${fetchParams.toString()}`);
    return parsePubMedArticles(xml);
}

export async function searchAcademicPapers(
    query: string,
    options: AcademicSearchOptions = {},
): Promise<AcademicPaper[]> {
    const source = options.source ?? "all";
    const scopedOptions = {
        maxResults: options.maxResults,
        start: options.start,
    };

    if (source === "arxiv") {
        return searchArxivPapers(query, scopedOptions);
    }
    if (source === "pubmed") {
        return searchPubMedPapers(query, scopedOptions);
    }

    const [arxiv, pubmed] = await Promise.all([
        searchArxivPapers(query, scopedOptions),
        searchPubMedPapers(query, scopedOptions),
    ]);

    const dedupe = new Map<string, AcademicPaper>();
    for (const paper of [...arxiv, ...pubmed]) {
        const key = paper.doi?.toLowerCase() || paper.id;
        if (!dedupe.has(key)) {
            dedupe.set(key, paper);
        }
    }
    return Array.from(dedupe.values());
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
            pdfUrl: paper?.pdfUrl || resolvedUrl,
            referenceData,
        },
    };

    return book;
}
