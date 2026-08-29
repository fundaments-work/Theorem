import { isTauri } from "../lib/env";
import { saveBookData, saveCoverImage } from "../lib/storage";
import { useLibraryStore } from "../store";
import type { Book, BookFormat, OpdsEntry, OpdsFeed } from "../types";
import { parseOpdsFeed } from "./OpdsService";

export interface DiscoverSection {
    id: string;
    title: string;
    subtitle?: string;
    books: OpdsEntry[];
}

// High-trust stable curated feeds for instant discovery
const CURATED_FEEDS = [
    {
        id: "essentials",
        title: "Timeless Essentials",
        subtitle: "The most celebrated literature of all time.",
        url: "https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads",
    },
    {
        id: "new-releases",
        title: "New & Restored Editions",
        subtitle: "Carefully produced, beautifully formatted public domain releases.",
        url: "https://standardebooks.org/feeds/atom/new-releases",
    },
    {
        id: "philosophy",
        title: "Philosophy & Essays",
        subtitle: "Stoic meditations, classical thought, and philosophical treatises.",
        url: "https://www.gutenberg.org/ebooks/search.opds/?query=philosophy&sort_order=downloads",
    },
    {
        id: "classics-fiction",
        title: "Classic Fiction",
        subtitle: "Enduring novels and foundational stories.",
        url: "https://www.gutenberg.org/ebooks/search.opds/?query=fiction&sort_order=downloads",
    },
];

// In-memory cache for instant section switching
const sectionCache = new Map<string, { data: DiscoverSection; timestamp: number }>();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

async function fetchFeedSafe(url: string): Promise<OpdsFeed | null> {
    try {
        let rawXml = "";
        if (isTauri()) {
            const { invoke } = await import("@tauri-apps/api/core");
            rawXml = await invoke<string>("fetch_rss_feed", { url });
        } else {
            const res = await fetch(url);
            if (!res.ok) return null;
            rawXml = await res.text();
        }
        return await parseOpdsFeed(rawXml, url);
    } catch (e) {
        console.warn(`Failed to fetch feed from ${url}:`, e);
        return null;
    }
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
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return await res.arrayBuffer();
}

export const DiscoverService = {
    async loadCuratedSections(forceRefresh = false): Promise<DiscoverSection[]> {
        const results: DiscoverSection[] = [];

        await Promise.all(
            CURATED_FEEDS.map(async (feedConfig) => {
                const cached = sectionCache.get(feedConfig.id);
                if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
                    results.push(cached.data);
                    return;
                }

                const feed = await fetchFeedSafe(feedConfig.url);
                if (feed && feed.entries.length > 0) {
                    const section: DiscoverSection = {
                        id: feedConfig.id,
                        title: feedConfig.title,
                        subtitle: feedConfig.subtitle,
                        books: feed.entries.slice(0, 20),
                    };
                    sectionCache.set(feedConfig.id, { data: section, timestamp: Date.now() });
                    results.push(section);
                }
            })
        );

        // Maintain display order based on CURATED_FEEDS
        return CURATED_FEEDS.map((f) => results.find((r) => r.id === f.id)).filter(Boolean) as DiscoverSection[];
    },

    async search(query: string): Promise<OpdsEntry[]> {
        const clean = query.trim();
        if (!clean) return [];

        const gutenbergSearchUrl = `https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(clean)}`;
        const feed = await fetchFeedSafe(gutenbergSearchUrl);
        return feed ? feed.entries : [];
    },

    async downloadBook(
        entry: OpdsEntry,
        onProgress?: (step: string) => void
    ): Promise<string> {
        let downloadUrl = entry.downloadUrl;

        // If it's an entry linking to a book-specific acquisition feed, fetch it
        if (!downloadUrl && entry.navUrl) {
            onProgress?.("Resolving download format…");
            const subFeed = await fetchFeedSafe(entry.navUrl);
            const acq = subFeed?.entries.find((e) => e.downloadUrl);
            if (acq?.downloadUrl) {
                downloadUrl = acq.downloadUrl;
            }
        }

        if (!downloadUrl) {
            // Gutenberg direct fallback format
            const match = entry.id.match(/\/ebooks\/(\d+)/);
            if (match) {
                const id = match[1];
                downloadUrl = `https://www.gutenberg.org/ebooks/${id}.epub.images`;
            }
        }

        if (!downloadUrl) {
            throw new Error("No direct EPUB download available for this title.");
        }

        onProgress?.("Downloading book…");
        const buffer = await fetchBinary(downloadUrl);
        const bookId = `book-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const format: BookFormat = entry.downloadFormat || "epub";
        const storagePath = await saveBookData(bookId, buffer);

        let coverPath: string | undefined;
        if (entry.coverUrl || entry.thumbnailUrl) {
            const cUrl = entry.coverUrl || entry.thumbnailUrl;
            if (cUrl) {
                try {
                    onProgress?.("Downloading cover…");
                    const coverBuffer = await fetchBinary(cUrl);
                    const blob = new Blob([coverBuffer], { type: "image/jpeg" });
                    coverPath = await saveCoverImage(bookId, blob);
                } catch {
                    // Non-fatal
                }
            }
        }

        const book: Book = {
            id: bookId,
            title: entry.title,
            author: entry.author || "Unknown Author",
            format,
            filePath: storagePath,
            storagePath,
            fileSize: buffer.byteLength,
            addedAt: new Date(),
            coverPath,
            description: entry.summary,
            publisher: entry.publisher,
            language: entry.language,
            progress: 0,
            tags: ["Discover"],
            isFavorite: false,
            readingTime: 0,
            lastReadAt: new Date(),
        };

        useLibraryStore.getState().addBook(book);
        return bookId;
    },
};
