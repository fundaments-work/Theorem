import { isTauri } from "../lib/env";
import { saveBookData, saveCoverImage } from "../lib/storage";
import { useLibraryStore } from "../store";
import type { Book, BookFormat, OpdsCatalog, OpdsEntry, OpdsFeed, OpdsLink } from "../types";
import { XMLParser } from "fast-xml-parser";

export const DEFAULT_OPDS_PRESETS: OpdsCatalog[] = [
    {
        id: "standard-ebooks",
        title: "Standard Ebooks",
        url: "https://standardebooks.org/feeds/opds",
        isPreset: true,
        description: "Free, carefully formatted, and beautifully produced public domain ebooks.",
    },
    {
        id: "project-gutenberg",
        title: "Project Gutenberg",
        url: "https://m.gutenberg.org/ebooks.opds/",
        isPreset: true,
        description: "Over 60,000 free ebooks including the world's great literature.",
    },
];

function resolveUrl(relativeOrAbsolute: string, baseUrl: string): string {
    try {
        return new URL(relativeOrAbsolute, baseUrl).href;
    } catch {
        return relativeOrAbsolute;
    }
}

async function fetchFeedXml(url: string): Promise<string> {
    if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        return await invoke<string>("fetch_rss_feed", { url });
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch catalog: ${response.status} ${response.statusText}`);
    }
    return await response.text();
}

async function fetchBinary(url: string): Promise<ArrayBuffer> {
    if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        const bytes = await invoke<number[] | Uint8Array>("fetch_binary_content", { url });
        if (bytes instanceof Uint8Array) {
            const buf = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(buf).set(bytes);
            return buf;
        }
        const arr = new Uint8Array(bytes);
        const buf = new ArrayBuffer(arr.byteLength);
        new Uint8Array(buf).set(arr);
        return buf;
    }
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
    }
    return await response.arrayBuffer();
}

function createOpdsParser(): XMLParser {
    return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        removeNSPrefix: false,
        textNodeName: "#text",
        parseTagValue: false,
        parseAttributeValue: false,
        isArray: (name: string) => name === "entry" || name === "link" || name === "author",
        trimValues: true,
    });
}

function getTextContent(node: any): string {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (typeof node === "object" && "#text" in node) return String(node["#text"]);
    return "";
}

function extractFormatFromMime(mime?: string, href?: string): "epub" | "pdf" | "cbz" | "mobi" | undefined {
    const type = (mime || "").toLowerCase();
    const path = (href || "").toLowerCase();

    if (type.includes("epub") || path.endsWith(".epub")) return "epub";
    if (type.includes("pdf") || path.endsWith(".pdf")) return "pdf";
    if (type.includes("comic") || type.includes("cbz") || path.endsWith(".cbz")) return "cbz";
    if (type.includes("mobi") || type.includes("prc") || path.endsWith(".mobi")) return "mobi";
    return undefined;
}

export async function parseOpdsFeed(xmlText: string, feedUrl: string): Promise<OpdsFeed> {
    const parser = createOpdsParser();
    const result = parser.parse(xmlText);

    const feedNode = result.feed || result["atom:feed"] || result;
    const title = getTextContent(feedNode.title || feedNode["atom:title"]) || "Catalog";
    const subtitle = getTextContent(feedNode.subtitle || feedNode["atom:subtitle"]) || undefined;
    const icon = getTextContent(feedNode.icon || feedNode["atom:icon"]) || undefined;
    const updated = getTextContent(feedNode.updated || feedNode["atom:updated"]) || undefined;
    const feedId = getTextContent(feedNode.id || feedNode["atom:id"]) || feedUrl;

    const rawLinks: any[] = Array.isArray(feedNode.link) ? feedNode.link : feedNode.link ? [feedNode.link] : [];
    let selfUrl: string | undefined;
    let nextUrl: string | undefined;
    let prevUrl: string | undefined;
    let upUrl: string | undefined;
    let startUrl: string | undefined;
    let searchUrlTemplate: string | undefined;

    for (const link of rawLinks) {
        const rel = link["@_rel"] || "";
        const href = link["@_href"];
        const type = link["@_type"] || "";
        if (!href) continue;

        const resolved = resolveUrl(href, feedUrl);
        if (rel === "self") selfUrl = resolved;
        else if (rel === "next") nextUrl = resolved;
        else if (rel === "previous" || rel === "prev") prevUrl = resolved;
        else if (rel === "up") upUrl = resolved;
        else if (rel === "start") startUrl = resolved;
        else if (rel === "search") {
            if (href.includes("{searchTerms}")) {
                searchUrlTemplate = href;
            } else if (type.includes("opensearchdescription")) {
                searchUrlTemplate = resolved;
            }
        }
    }

    const rawEntries: any[] = Array.isArray(feedNode.entry)
        ? feedNode.entry
        : feedNode.entry
          ? [feedNode.entry]
          : [];

    const entries: OpdsEntry[] = [];

    for (const entryNode of rawEntries) {
        const id = getTextContent(entryNode.id || entryNode["atom:id"]) || `opds-entry-${Math.random().toString(36).slice(2)}`;
        const entryTitle = getTextContent(entryNode.title || entryNode["atom:title"]) || "Untitled";
        
        let author: string | undefined;
        const authors = entryNode.author || entryNode["atom:author"];
        if (Array.isArray(authors) && authors.length > 0) {
            author = getTextContent(authors[0].name || authors[0]["atom:name"] || authors[0]);
        } else if (authors) {
            author = getTextContent(authors.name || authors["atom:name"] || authors);
        }
        if (!author && (entryNode["dc:creator"] || entryNode["dc:author"])) {
            author = getTextContent(entryNode["dc:creator"] || entryNode["dc:author"]);
        }

        const summary = getTextContent(entryNode.summary || entryNode["atom:summary"]) || undefined;
        const content = getTextContent(entryNode.content || entryNode["atom:content"]) || undefined;
        const entryUpdated = getTextContent(entryNode.updated || entryNode["atom:updated"]) || undefined;
        const published = getTextContent(entryNode.published || entryNode["atom:published"] || entryNode["dc:issued"]) || undefined;
        const language = getTextContent(entryNode["dc:language"]) || undefined;
        const publisher = getTextContent(entryNode["dc:publisher"]) || undefined;

        const entryLinksRaw: any[] = Array.isArray(entryNode.link)
            ? entryNode.link
            : entryNode.link
              ? [entryNode.link]
              : [];

        const links: OpdsLink[] = [];
        let coverUrl: string | undefined;
        let thumbnailUrl: string | undefined;
        let downloadUrl: string | undefined;
        let downloadFormat: "epub" | "pdf" | "cbz" | "mobi" | undefined;
        let navUrl: string | undefined;

        for (const l of entryLinksRaw) {
            const rel = l["@_rel"] || "";
            const href = l["@_href"];
            const type = l["@_type"] || "";
            const linkTitle = l["@_title"] || undefined;
            if (!href) continue;

            const resolvedHref = resolveUrl(href, feedUrl);
            links.push({ rel, href: resolvedHref, type, title: linkTitle });

            // Image / Thumbnail
            if (rel.includes("opds-spec.org/image/thumbnail") || rel === "thumbnail") {
                thumbnailUrl = resolvedHref;
            } else if (rel.includes("opds-spec.org/image") || rel === "image" || rel === "cover") {
                coverUrl = resolvedHref;
            }

            // Acquisition (Direct Download)
            if (rel.startsWith("http://opds-spec.org/acquisition") || rel === "acquisition" || type.includes("application/epub+zip") || type.includes("application/pdf")) {
                const detectedFmt = extractFormatFromMime(type, href);
                if (detectedFmt && (!downloadUrl || detectedFmt === "epub")) {
                    downloadUrl = resolvedHref;
                    downloadFormat = detectedFmt;
                }
            }

            // Navigation
            if (rel === "subsection" || type.includes("profile=opds-catalog") || type.includes("application/atom+xml")) {
                if (!navUrl) {
                    navUrl = resolvedHref;
                }
            }
        }

        if (!thumbnailUrl && coverUrl) thumbnailUrl = coverUrl;
        if (!coverUrl && thumbnailUrl) coverUrl = thumbnailUrl;

        const isNavigation = !downloadUrl && Boolean(navUrl);

        entries.push({
            id,
            title: entryTitle,
            author,
            summary: summary || content,
            content,
            updated: entryUpdated,
            published,
            language,
            publisher,
            coverUrl,
            thumbnailUrl,
            downloadUrl,
            downloadFormat,
            navUrl,
            isNavigation,
            links,
        });
    }

    return {
        id: feedId,
        title,
        subtitle,
        icon,
        updated,
        selfUrl,
        nextUrl,
        prevUrl,
        upUrl,
        startUrl,
        searchUrlTemplate,
        entries,
    };
}

export class OpdsService {
    static async fetchFeed(feedUrl: string): Promise<OpdsFeed> {
        const xml = await fetchFeedXml(feedUrl);
        return await parseOpdsFeed(xml, feedUrl);
    }

    static async search(searchUrlTemplate: string, query: string, baseUrl: string): Promise<OpdsFeed> {
        let searchUrl = searchUrlTemplate;
        if (searchUrl.includes("{searchTerms}")) {
            searchUrl = searchUrl.replace("{searchTerms}", encodeURIComponent(query));
        } else {
            const sep = searchUrl.includes("?") ? "&" : "?";
            searchUrl = `${searchUrl}${sep}q=${encodeURIComponent(query)}`;
        }
        const resolved = resolveUrl(searchUrl, baseUrl);
        return await this.fetchFeed(resolved);
    }

    static async downloadAndImportBook(
        entry: OpdsEntry,
        onProgress?: (step: string) => void
    ): Promise<Book> {
        if (!entry.downloadUrl) {
            throw new Error("No download link available for this book.");
        }

        onProgress?.("Downloading book…");
        const buffer = await fetchBinary(entry.downloadUrl);

        onProgress?.("Saving to local storage…");
        const bookId = `opds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const format: BookFormat = entry.downloadFormat || "epub";
        const storagePath = await saveBookData(bookId, buffer);

        let coverPath: string | undefined;
        if (entry.coverUrl) {
            try {
                onProgress?.("Fetching cover image…");
                const coverBuffer = await fetchBinary(entry.coverUrl);
                const blob = new Blob([coverBuffer], { type: "image/jpeg" });
                coverPath = await saveCoverImage(bookId, blob);
            } catch {
                // Ignore cover failure
            }
        }

        const book: Book = {
            id: bookId,
            title: entry.title,
            author: entry.author || "Unknown",
            format,
            filePath: entry.downloadUrl,
            storagePath,
            fileSize: buffer.byteLength,
            coverPath,
            addedAt: new Date(),
            progress: 0,
            isFavorite: false,
            readingTime: 0,
            tags: ["OPDS"],
            coverExtractionDone: Boolean(coverPath),
        };

        useLibraryStore.getState().addBook(book);
        onProgress?.("Book added to library!");
        return book;
    }
}
