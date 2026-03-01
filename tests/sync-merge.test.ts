import { describe, expect, it } from "vitest";
import {
    mergeBooks,
    mergeAnnotations,
    mergeCollections,
    mergeVocabulary,
    mergeRssFeeds,
    mergeRssArticles,
    mergeSettings,
    mergeReadingStats,
} from "../src/core/lib/sync-import";
import type {
    Book,
    Annotation,
    Collection,
    VocabularyTerm,
    RssFeed,
    RssArticle,
    AppSettings,
    ReadingStats,
    DailyReadingActivity,
} from "../src/core";

// ─── Helpers ───

function makeBook(
    overrides: Partial<Book> & Pick<Book, "id" | "title">,
): Book {
    return {
        id: overrides.id,
        title: overrides.title,
        author: overrides.author ?? "Unknown Author",
        filePath: overrides.filePath ?? `/library/${overrides.id}.epub`,
        format: overrides.format ?? "epub",
        fileSize: overrides.fileSize ?? 1024,
        addedAt: overrides.addedAt ?? new Date("2025-01-01"),
        progress: overrides.progress ?? 0,
        tags: overrides.tags ?? [],
        isFavorite: overrides.isFavorite ?? false,
        readingTime: overrides.readingTime ?? 0,
        contentHash: overrides.contentHash,
        lastReadAt: overrides.lastReadAt,
        rating: overrides.rating,
        description: overrides.description,
        publisher: overrides.publisher,
        language: overrides.language,
        isbn: overrides.isbn,
        currentLocation: overrides.currentLocation,
    };
}

function makeAnnotation(
    overrides: Partial<Annotation> & Pick<Annotation, "id" | "bookId">,
): Annotation {
    return {
        id: overrides.id,
        bookId: overrides.bookId,
        type: overrides.type ?? "highlight",
        location: overrides.location ?? "epubcfi(/1)",
        selectedText: overrides.selectedText ?? "Some text",
        createdAt: overrides.createdAt ?? new Date("2025-01-01"),
        updatedAt: overrides.updatedAt,
        color: overrides.color ?? "yellow",
    };
}

function makeCollection(
    overrides: Partial<Collection> & Pick<Collection, "id" | "name">,
): Collection {
    return {
        id: overrides.id,
        name: overrides.name,
        description: overrides.description,
        bookIds: overrides.bookIds ?? [],
        kind: "general",
        createdAt: overrides.createdAt ?? new Date("2025-01-01"),
    };
}

function makeVocabTerm(
    overrides: Partial<VocabularyTerm> &
        Pick<VocabularyTerm, "id" | "term">,
): VocabularyTerm {
    return {
        id: overrides.id,
        term: overrides.term,
        normalizedTerm: overrides.normalizedTerm ?? overrides.term.toLowerCase(),
        language: overrides.language ?? "en",
        meanings: overrides.meanings ?? [],
        providerHistory: overrides.providerHistory ?? [],
        lookupCount: overrides.lookupCount ?? 1,
        tags: overrides.tags ?? [],
        contexts: overrides.contexts ?? [],
        createdAt: overrides.createdAt ?? new Date("2025-01-01"),
        updatedAt: overrides.updatedAt,
    };
}

function makeRssFeed(
    overrides: Partial<RssFeed> & Pick<RssFeed, "url" | "title">,
): RssFeed {
    return {
        id: overrides.id ?? `feed-${overrides.url}`,
        title: overrides.title,
        url: overrides.url,
        siteUrl: overrides.siteUrl,
        description: overrides.description,
        iconUrl: overrides.iconUrl,
        lastFetched: overrides.lastFetched,
        addedAt: overrides.addedAt ?? new Date("2025-01-01"),
        errorMessage: overrides.errorMessage,
        unreadCount: overrides.unreadCount ?? 0,
    };
}

function makeRssArticle(
    overrides: Partial<RssArticle> & Pick<RssArticle, "id" | "feedId" | "title">,
): RssArticle {
    return {
        id: overrides.id,
        feedId: overrides.feedId,
        title: overrides.title,
        author: overrides.author,
        url: overrides.url ?? `https://example.com/articles/${overrides.id}`,
        content: overrides.content ?? "<p>Article content</p>",
        summary: overrides.summary,
        imageUrl: overrides.imageUrl,
        publishedAt: overrides.publishedAt,
        fetchedAt: overrides.fetchedAt ?? new Date("2025-01-01"),
        isRead: overrides.isRead ?? false,
        isFavorite: overrides.isFavorite ?? false,
    };
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
    return {
        sidebarCollapsed: false,
        libraryViewMode: "grid",
        librarySortBy: "title",
        librarySortOrder: "asc",
        scanFolders: [],
        cacheSize: 500,
        theme: "system",
        readerSettings: {
            theme: "light",
            fontFamily: "serif",
            fontSize: 16,
            lineHeight: 1.6,
            letterSpacing: 0,
            paragraphSpacing: 1,
            textAlign: "justify",
            hyphenation: false,
            margins: 5,
            flow: "paged",
            layout: "single",
            brightness: 100,
            fullscreen: false,
            pageAnimation: "slide",
            toolbarAutoHide: true,
            autoHideDelay: 3,
            zoom: 100,
            wordSpacing: 0,
            forcePublisherStyles: false,
            prefetchDistance: 1,
            enableAnimations: true,
            virtualScrolling: false,
        },
        vocabulary: {
            vocabularyEnabled: true,
            dictionaryMode: "auto",
            preferredProviders: ["wiktionary"],
            showPronunciation: true,
            playPronunciationAudio: false,
        },
        vault: {
            enabled: false,
            vaultPath: "",
            autoExportHighlights: false,
            highlightsFileName: "highlights",
            vocabularyFileName: "vocabulary",
        },
        deviceSync: {
            deviceId: "test-device-1",
            deviceName: "Test Device",
            pairedDevices: [],
            syncOnConnect: false,
        },
        hasCompletedOnboarding: true,
        ...overrides,
    };
}

function makeReadingStats(overrides: Partial<ReadingStats> = {}): ReadingStats {
    return {
        totalReadingTime: 0,
        booksCompleted: 0,
        averageReadingSpeed: 0,
        currentStreak: 0,
        longestStreak: 0,
        dailyGoal: 30,
        yearlyBookGoal: 12,
        booksReadThisYear: 0,
        dailyActivity: [],
        lastReadDate: undefined,
        ...overrides,
    };
}

// ─── Test Suites ───

describe("mergeBooks", () => {
    it("adds new books from incoming", () => {
        const existing = [makeBook({ id: "a", title: "A" })];
        const incoming = [makeBook({ id: "b", title: "B" })];

        const result = mergeBooks(incoming, existing);
        expect(result).toHaveLength(2);
        expect(result.map((b) => b.id).sort()).toEqual(["a", "b"]);
    });

    it("deduplicates by contentHash", () => {
        const existing = [
            makeBook({ id: "a", title: "A", contentHash: "hash1" }),
        ];
        const incoming = [
            makeBook({ id: "b", title: "A (copy)", contentHash: "hash1" }),
        ];

        const result = mergeBooks(incoming, existing);
        // Should not create a duplicate — same contentHash.
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("a"); // Keeps existing ID.
    });

    it("merges metadata: keeps higher progress", () => {
        const existing = [
            makeBook({
                id: "a",
                title: "A",
                contentHash: "h1",
                progress: 0.3,
            }),
        ];
        const incoming = [
            makeBook({
                id: "a",
                title: "A",
                contentHash: "h1",
                progress: 0.7,
            }),
        ];

        const result = mergeBooks(incoming, existing);
        expect(result).toHaveLength(1);
        expect(result[0].progress).toBe(0.7);
    });

    it("merges tags by union", () => {
        const existing = [
            makeBook({
                id: "a",
                title: "A",
                tags: ["fiction", "sci-fi"],
            }),
        ];
        const incoming = [
            makeBook({
                id: "a",
                title: "A",
                tags: ["sci-fi", "adventure"],
            }),
        ];

        const result = mergeBooks(incoming, existing);
        expect(result[0].tags.sort()).toEqual(["adventure", "fiction", "sci-fi"]);
    });

    it("keeps isFavorite if either side is true", () => {
        const existing = [
            makeBook({ id: "a", title: "A", isFavorite: false }),
        ];
        const incoming = [
            makeBook({ id: "a", title: "A", isFavorite: true }),
        ];

        const result = mergeBooks(incoming, existing);
        expect(result[0].isFavorite).toBe(true);
    });

    it("keeps richer title", () => {
        const existing = [makeBook({ id: "a", title: "A" })];
        const incoming = [
            makeBook({ id: "a", title: "A: Complete Edition" }),
        ];

        const result = mergeBooks(incoming, existing);
        expect(result[0].title).toBe("A: Complete Edition");
    });
});

describe("mergeAnnotations", () => {
    it("adds new annotations", () => {
        const existing = [
            makeAnnotation({ id: "ann1", bookId: "a" }),
        ];
        const incoming = [
            makeAnnotation({ id: "ann2", bookId: "a" }),
        ];

        const result = mergeAnnotations(incoming, existing);
        expect(result).toHaveLength(2);
    });

    it("applies LWW by updatedAt", () => {
        const existing = [
            makeAnnotation({
                id: "ann1",
                bookId: "a",
                selectedText: "old text",
                updatedAt: new Date("2025-01-01"),
            }),
        ];
        const incoming = [
            makeAnnotation({
                id: "ann1",
                bookId: "a",
                selectedText: "new text",
                updatedAt: new Date("2025-06-01"),
            }),
        ];

        const result = mergeAnnotations(incoming, existing);
        expect(result).toHaveLength(1);
        expect(result[0].selectedText).toBe("new text");
    });

    it("keeps local annotation if it is newer", () => {
        const existing = [
            makeAnnotation({
                id: "ann1",
                bookId: "a",
                selectedText: "local newer",
                updatedAt: new Date("2025-09-01"),
            }),
        ];
        const incoming = [
            makeAnnotation({
                id: "ann1",
                bookId: "a",
                selectedText: "remote older",
                updatedAt: new Date("2025-01-01"),
            }),
        ];

        const result = mergeAnnotations(incoming, existing);
        expect(result[0].selectedText).toBe("local newer");
    });

    it("falls back to createdAt when updatedAt is missing", () => {
        const existing = [
            makeAnnotation({
                id: "ann1",
                bookId: "a",
                selectedText: "old",
                createdAt: new Date("2025-01-01"),
            }),
        ];
        const incoming = [
            makeAnnotation({
                id: "ann1",
                bookId: "a",
                selectedText: "newer by createdAt",
                createdAt: new Date("2025-06-01"),
            }),
        ];

        const result = mergeAnnotations(incoming, existing);
        expect(result[0].selectedText).toBe("newer by createdAt");
    });
});

describe("mergeCollections", () => {
    it("adds new collections", () => {
        const existing = [
            makeCollection({ id: "c1", name: "Shelf A" }),
        ];
        const incoming = [
            makeCollection({ id: "c2", name: "Shelf B" }),
        ];

        const result = mergeCollections(incoming, existing);
        expect(result).toHaveLength(2);
    });

    it("unions bookIds for matching collections", () => {
        const existing = [
            makeCollection({
                id: "c1",
                name: "Shelf",
                bookIds: ["a", "b"],
            }),
        ];
        const incoming = [
            makeCollection({
                id: "c1",
                name: "Shelf",
                bookIds: ["b", "c", "d"],
            }),
        ];

        const result = mergeCollections(incoming, existing);
        expect(result).toHaveLength(1);
        expect(result[0].bookIds.sort()).toEqual(["a", "b", "c", "d"]);
    });

    it("LWW name based on createdAt", () => {
        const existing = [
            makeCollection({
                id: "c1",
                name: "Old Name",
                createdAt: new Date("2025-01-01"),
            }),
        ];
        const incoming = [
            makeCollection({
                id: "c1",
                name: "New Name",
                createdAt: new Date("2025-06-01"),
            }),
        ];

        const result = mergeCollections(incoming, existing);
        expect(result[0].name).toBe("New Name");
    });
});

describe("mergeVocabulary", () => {
    it("adds new terms", () => {
        const existing = [makeVocabTerm({ id: "t1", term: "hello" })];
        const incoming = [makeVocabTerm({ id: "t2", term: "world" })];

        const result = mergeVocabulary(incoming, existing);
        expect(result).toHaveLength(2);
    });

    it("merges by normalizedTerm::language key", () => {
        const existing = [
            makeVocabTerm({
                id: "t1",
                term: "Hello",
                normalizedTerm: "hello",
                language: "en",
                lookupCount: 3,
            }),
        ];
        const incoming = [
            makeVocabTerm({
                id: "t1-remote",
                term: "hello",
                normalizedTerm: "hello",
                language: "en",
                lookupCount: 7,
            }),
        ];

        const result = mergeVocabulary(incoming, existing);
        expect(result).toHaveLength(1);
        expect(result[0].lookupCount).toBe(7); // Higher wins.
    });

    it("unions tags", () => {
        const existing = [
            makeVocabTerm({
                id: "t1",
                term: "test",
                tags: ["academic"],
            }),
        ];
        const incoming = [
            makeVocabTerm({
                id: "t1",
                term: "test",
                tags: ["academic", "science"],
            }),
        ];

        const result = mergeVocabulary(incoming, existing);
        expect(result[0].tags.sort()).toEqual(["academic", "science"]);
    });

    it("treats different languages as different terms", () => {
        const existing = [
            makeVocabTerm({
                id: "t1",
                term: "table",
                language: "en",
            }),
        ];
        const incoming = [
            makeVocabTerm({
                id: "t2",
                term: "table",
                language: "fr",
            }),
        ];

        const result = mergeVocabulary(incoming, existing);
        expect(result).toHaveLength(2);
    });
});

describe("mergeRssFeeds", () => {
    it("adds new feeds", () => {
        const existing = [
            makeRssFeed({ url: "https://a.com/rss", title: "A" }),
        ];
        const incoming = [
            makeRssFeed({ url: "https://b.com/rss", title: "B" }),
        ];

        const result = mergeRssFeeds(incoming, existing);
        expect(result).toHaveLength(2);
    });

    it("deduplicates by URL and keeps later lastFetched", () => {
        const existing = [
            makeRssFeed({
                url: "https://a.com/rss",
                title: "A",
                lastFetched: new Date("2025-01-01"),
            }),
        ];
        const incoming = [
            makeRssFeed({
                url: "https://a.com/rss",
                title: "A Updated",
                lastFetched: new Date("2025-06-01"),
            }),
        ];

        const result = mergeRssFeeds(incoming, existing);
        expect(result).toHaveLength(1);
        expect(new Date(result[0].lastFetched as any).getFullYear()).toBe(2025);
    });
});

describe("mergeRssArticles", () => {
    it("adds new articles", () => {
        const existing = [
            makeRssArticle({ id: "art1", feedId: "feed1", title: "Article 1" }),
        ];
        const incoming = [
            makeRssArticle({ id: "art2", feedId: "feed1", title: "Article 2" }),
        ];

        const result = mergeRssArticles(incoming, existing);
        expect(result).toHaveLength(2);
    });

    it("ORs isRead and isFavorite", () => {
        const existing = [
            makeRssArticle({
                id: "art1",
                feedId: "feed1",
                title: "Article 1",
                isRead: true,
                isFavorite: false,
            }),
        ];
        const incoming = [
            makeRssArticle({
                id: "art1",
                feedId: "feed1",
                title: "Article 1",
                isRead: false,
                isFavorite: true,
            }),
        ];

        const result = mergeRssArticles(incoming, existing);
        expect(result).toHaveLength(1);
        expect(result[0].isRead).toBe(true);
        expect(result[0].isFavorite).toBe(true);
    });
});

// ─── Settings Merge ───

describe("mergeSettings", () => {
    it("takes remote settings when remote timestamp is newer", () => {
        const local = makeSettings({ theme: "dark", cacheSize: 500 });
        const remote = makeSettings({ theme: "light", cacheSize: 1000 });

        const result = mergeSettings(
            remote,
            local,
            "2025-06-01T00:00:00Z",
            "2025-01-01T00:00:00Z",
        );
        expect(result.theme).toBe("light");
        expect(result.cacheSize).toBe(1000);
    });

    it("keeps local settings when local timestamp is newer", () => {
        const local = makeSettings({ theme: "dark", cacheSize: 500 });
        const remote = makeSettings({ theme: "light", cacheSize: 1000 });

        const result = mergeSettings(
            remote,
            local,
            "2025-01-01T00:00:00Z",
            "2025-06-01T00:00:00Z",
        );
        expect(result.theme).toBe("dark");
        expect(result.cacheSize).toBe(500);
    });

    it("never overwrites deviceSync even when remote is newer", () => {
        const localDeviceSync = {
            deviceId: "local-device-id",
            deviceName: "My Laptop",
            pairedDevices: [],
            syncOnConnect: true,
        };
        const remoteDeviceSync = {
            deviceId: "remote-device-id",
            deviceName: "My Phone",
            pairedDevices: [],
            syncOnConnect: false,
        };

        const local = makeSettings({ deviceSync: localDeviceSync });
        const remote = makeSettings({ deviceSync: remoteDeviceSync });

        const result = mergeSettings(
            remote,
            local,
            "2025-06-01T00:00:00Z",
            "2025-01-01T00:00:00Z",
        );
        expect(result.deviceSync.deviceId).toBe("local-device-id");
        expect(result.deviceSync.deviceName).toBe("My Laptop");
        expect(result.deviceSync.syncOnConnect).toBe(true);
    });

    it("keeps local settings when no timestamps provided (conservative)", () => {
        const local = makeSettings({ theme: "dark" });
        const remote = makeSettings({ theme: "light" });

        const result = mergeSettings(remote, local);
        expect(result.theme).toBe("dark");
    });

    it("keeps local settings when timestamps are equal", () => {
        const local = makeSettings({ theme: "dark" });
        const remote = makeSettings({ theme: "light" });

        const result = mergeSettings(
            remote,
            local,
            "2025-03-01T00:00:00Z",
            "2025-03-01T00:00:00Z",
        );
        expect(result.theme).toBe("dark");
    });

    it("fills in empty local vault fields from remote when local is newer", () => {
        const local = makeSettings({
            vault: {
                enabled: false,
                vaultPath: "/local/vault",
                autoExportHighlights: false,
                highlightsFileName: "",
                vocabularyFileName: "",
            },
        });
        const remote = makeSettings({
            vault: {
                enabled: true,
                vaultPath: "/remote/vault",
                autoExportHighlights: true,
                highlightsFileName: "my-highlights",
                vocabularyFileName: "my-vocab",
            },
        });

        const result = mergeSettings(
            remote,
            local,
            "2025-01-01T00:00:00Z",
            "2025-06-01T00:00:00Z",
        );
        // Local vault path always preserved
        expect(result.vault.vaultPath).toBe("/local/vault");
    });
});

// ─── Reading Stats Merge ───

describe("mergeReadingStats", () => {
    it("takes max of cumulative counters", () => {
        const local = makeReadingStats({
            totalReadingTime: 500,
            booksCompleted: 3,
            averageReadingSpeed: 200,
        });
        const remote = makeReadingStats({
            totalReadingTime: 800,
            booksCompleted: 2,
            averageReadingSpeed: 250,
        });

        const result = mergeReadingStats(remote, local);
        expect(result.totalReadingTime).toBe(800);
        expect(result.booksCompleted).toBe(3);
        expect(result.averageReadingSpeed).toBe(250);
    });

    it("takes max of goals", () => {
        const local = makeReadingStats({ dailyGoal: 30, yearlyBookGoal: 12 });
        const remote = makeReadingStats({ dailyGoal: 45, yearlyBookGoal: 10 });

        const result = mergeReadingStats(remote, local);
        expect(result.dailyGoal).toBe(45);
        expect(result.yearlyBookGoal).toBe(12);
    });

    it("takes max longestStreak", () => {
        const local = makeReadingStats({ longestStreak: 10 });
        const remote = makeReadingStats({ longestStreak: 15 });

        const result = mergeReadingStats(remote, local);
        expect(result.longestStreak).toBeGreaterThanOrEqual(15);
    });

    it("unions daily activity by date", () => {
        const local = makeReadingStats({
            dailyActivity: [
                { date: "2025-03-01", minutes: 30, booksRead: ["book-a"] },
                { date: "2025-03-02", minutes: 20, booksRead: ["book-a"] },
            ],
        });
        const remote = makeReadingStats({
            dailyActivity: [
                { date: "2025-03-02", minutes: 40, booksRead: ["book-b"] },
                { date: "2025-03-03", minutes: 15, booksRead: ["book-b"] },
            ],
        });

        const result = mergeReadingStats(remote, local);
        expect(result.dailyActivity).toHaveLength(3);

        const mar02 = result.dailyActivity.find((d) => d.date === "2025-03-02");
        expect(mar02).toBeDefined();
        expect(mar02!.minutes).toBe(40); // max(20, 40)
        expect(mar02!.booksRead.sort()).toEqual(["book-a", "book-b"]); // union
    });

    it("limits daily activity to 84 entries", () => {
        const entries: DailyReadingActivity[] = [];
        for (let i = 0; i < 100; i++) {
            const date = new Date(2025, 0, 1 + i).toISOString().slice(0, 10);
            entries.push({ date, minutes: 10, booksRead: [] });
        }

        const local = makeReadingStats({ dailyActivity: entries });
        const remote = makeReadingStats({ dailyActivity: [] });

        const result = mergeReadingStats(remote, local);
        expect(result.dailyActivity.length).toBeLessThanOrEqual(84);
    });

    it("takes latest lastReadDate", () => {
        const local = makeReadingStats({ lastReadDate: "2025-03-01" });
        const remote = makeReadingStats({ lastReadDate: "2025-05-15" });

        const result = mergeReadingStats(remote, local);
        expect(result.lastReadDate).toBe("2025-05-15");
    });

    it("handles missing lastReadDate gracefully", () => {
        const local = makeReadingStats({ lastReadDate: "2025-03-01" });
        const remote = makeReadingStats({ lastReadDate: undefined });

        const result = mergeReadingStats(remote, local);
        expect(result.lastReadDate).toBe("2025-03-01");
    });

    it("takes max booksReadThisYear", () => {
        const local = makeReadingStats({ booksReadThisYear: 5 });
        const remote = makeReadingStats({ booksReadThisYear: 8 });

        const result = mergeReadingStats(remote, local);
        expect(result.booksReadThisYear).toBe(8);
    });

    it("merges empty stats without errors", () => {
        const local = makeReadingStats();
        const remote = makeReadingStats();

        const result = mergeReadingStats(remote, local);
        expect(result.totalReadingTime).toBe(0);
        expect(result.dailyActivity).toEqual([]);
        expect(result.currentStreak).toBe(0);
    });
});
