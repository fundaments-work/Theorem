import { describe, expect, it } from "vitest";
import {
    mergeVocabulary,
    mergeCollections,
    mergeSettings,
    mergeAnnotations,
    mergeRssArticles,
    mergeTombstones,
} from "../src/core/lib/sync-import";
import type {
    Annotation,
    Collection,
    DeletionTombstone,
    VocabularyTerm,
} from "../src/core/types";

// ─── Helpers ───

function iso(offsetMinutes = 0): string {
    const d = new Date(Date.now() + offsetMinutes * 60_000);
    return d.toISOString();
}

function ts(offsetMinutes = 0): number {
    return new Date(iso(offsetMinutes)).getTime();
}

function makeAnnotation(overrides: Partial<Annotation>): Annotation {
    return {
        id: overrides.id ?? "ann-1",
        bookId: overrides.bookId ?? "book-1",
        type: overrides.type ?? "highlight",
        location: overrides.location ?? "cfi/1",
        selectedText: overrides.selectedText ?? "text",
        color: overrides.color ?? "yellow",
        createdAt: overrides.createdAt ?? new Date(),
        updatedAt: overrides.updatedAt,
        referenceId: overrides.referenceId,
        noteContent: overrides.noteContent,
        pageNumber: overrides.pageNumber,
    };
}

// ─── P1-8: Annotation Timestamp Tiebreaker ───

describe("P1-8: Annotation merge timestamp tiebreaker", () => {
    it("remote annotation with strictly newer updatedAt wins", () => {
        const local = [makeAnnotation({ id: "a", updatedAt: new Date(ts(0)) })];
        const remote = [makeAnnotation({ id: "a", updatedAt: new Date(ts(1)), selectedText: "remote text" })];
        const result = mergeAnnotations(remote, local);
        expect(result[0].selectedText).toBe("remote text");
    });

    it("local annotation with equal timestamp wins (explicit tiebreaker)", () => {
        const sameTime = new Date(ts(0));
        const local = [makeAnnotation({ id: "a", updatedAt: sameTime, selectedText: "local text" })];
        const remote = [makeAnnotation({ id: "a", updatedAt: new Date(sameTime.getTime()), selectedText: "remote text" })];
        const result = mergeAnnotations(remote, local);
        expect(result[0].selectedText).toBe("local text");
    });

    it("new remote annotation without local match is added", () => {
        const local = [makeAnnotation({ id: "a" })];
        const remote = [makeAnnotation({ id: "b", selectedText: "new" })];
        const result = mergeAnnotations(remote, local);
        expect(result).toHaveLength(2);
        expect(result.find((a) => a.id === "b")!.selectedText).toBe("new");
    });
});

// ─── P1-10: Vocabulary Tombstones ───

describe("P1-10: Vocabulary tombstones", () => {
    function makeTerm(overrides: Partial<VocabularyTerm>): VocabularyTerm {
        return {
            id: overrides.id ?? "vocab-1",
            term: overrides.term ?? "example",
            normalizedTerm: overrides.normalizedTerm ?? "example",
            language: overrides.language ?? "en",
            meanings: overrides.meanings ?? [],
            providerHistory: overrides.providerHistory ?? [],
            createdAt: overrides.createdAt ?? new Date(),
            updatedAt: overrides.updatedAt ?? new Date(),
            lookupCount: overrides.lookupCount ?? 0,
            tags: overrides.tags ?? [],
            contexts: overrides.contexts ?? [],
        };
    }

    it("existing term skipped when tombstoned", () => {
        const tombs: DeletionTombstone[] = [
            { entityId: "vocab-1", entityType: "vocabulary", deletedAt: iso(-1) },
        ];
        const existing = [makeTerm({ id: "vocab-1", term: "deleted" })];
        const incoming = [makeTerm({ id: "vocab-1", term: "resurrected" })];
        const result = mergeVocabulary(incoming, existing, tombs);
        expect(result).toHaveLength(0);
    });

    it("incoming term skipped when tombstoned", () => {
        const tombs: DeletionTombstone[] = [
            { entityId: "new-term", entityType: "vocabulary", deletedAt: iso(-1) },
        ];
        const existing: VocabularyTerm[] = [];
        const incoming = [makeTerm({ id: "new-term", term: "blocked" })];
        const result = mergeVocabulary(incoming, existing, tombs);
        expect(result).toHaveLength(0);
    });

    it("tombstones of other types do not affect vocabulary", () => {
        const tombs: DeletionTombstone[] = [
            { entityId: "vocab-1", entityType: "book", deletedAt: iso(-1) },
        ];
        const existing = [makeTerm({ id: "vocab-1", term: "ok" })];
        const incoming: VocabularyTerm[] = [];
        const result = mergeVocabulary(incoming, existing, tombs);
        expect(result).toHaveLength(1);
    });

    it("mergeVocabulary works without tombstones param (backward compat)", () => {
        const existing = [makeTerm({ id: "vocab-1", term: "hello", normalizedTerm: "hello", language: "en" })];
        const incoming = [makeTerm({ id: "vocab-2", term: "world", normalizedTerm: "world", language: "en" })];
        const result = mergeVocabulary(incoming, existing);
        expect(result).toHaveLength(2);
    });
});

// ─── P1-12: Collection Book Removal Sync ───

describe("P1-12: Collection book removal sync", () => {
    function makeCollection(overrides: Partial<Collection>): Collection {
        return {
            id: overrides.id ?? "col-1",
            name: overrides.name ?? "My Shelf",
            bookIds: overrides.bookIds ?? [],
            kind: "general",
            createdAt: overrides.createdAt ?? new Date(),
            updatedAt: overrides.updatedAt,
            description: overrides.description,
        };
    }

    it("collection_book tombstone removes book from collection", () => {
        const tombs: DeletionTombstone[] = [
            { entityId: "col-1:book-a", entityType: "collection_book", deletedAt: iso(-1) },
        ];
        const existing = [makeCollection({ id: "col-1", bookIds: ["book-a", "book-b"] })];
        const incoming: Collection[] = [];
        const result = mergeCollections(incoming, existing, tombs);
        expect(result[0].bookIds).toEqual(["book-b"]);
    });

    it("collection_book tombstone applies to both existing and incoming", () => {
        const tombs: DeletionTombstone[] = [
            { entityId: "col-1:book-a", entityType: "collection_book", deletedAt: iso(-1) },
        ];
        const existing = [makeCollection({ id: "col-1", bookIds: ["book-b"] })];
        const incoming = [makeCollection({ id: "col-1", bookIds: ["book-a", "book-c"] })];
        const result = mergeCollections(incoming, existing, tombs);
        expect(result[0].bookIds.sort()).toEqual(["book-b", "book-c"]);
    });

    it("book tombstone still removes book from collections", () => {
        const tombs: DeletionTombstone[] = [
            { entityId: "book-a", entityType: "book", deletedAt: iso(-1) },
        ];
        const existing = [makeCollection({ id: "col-1", bookIds: ["book-a", "book-b"] })];
        const incoming: Collection[] = [];
        const result = mergeCollections(incoming, existing, tombs);
        expect(result[0].bookIds).toEqual(["book-b"]);
    });
});

// ─── P1-11: Per-key Settings Merge ───

describe("P1-11: Settings merge preserves deviceSync", () => {
    function makeSettings(deviceSync: { autoSyncEnabled: boolean; pairedDevices?: string[] }, overrides: Record<string, unknown> = {}) {
        return {
            theme: "light" as const,
            accentColor: "#000000",
            hasCompletedOnboarding: true,
            readerSettings: { fontSize: 16 } as any,
            vocabulary: { vocabularyEnabled: true } as any,
            tts: { enabled: false } as any,
            vault: { enabled: false, vaultPath: "/home/user/vault" } as any,
            deviceSync,
            ...overrides,
        } as any;
    }

    it("deviceSync is always preserved from local", () => {
        const local = makeSettings({ autoSyncEnabled: true, pairedDevices: ["dev-a"] });
        const remote = makeSettings({ autoSyncEnabled: false, pairedDevices: [] });
        const result = mergeSettings(remote, local, iso(1), iso(0));
        expect(result.deviceSync).toEqual({ autoSyncEnabled: true, pairedDevices: ["dev-a"] });
    });

    it("when remote is newer, remote fields win except deviceSync", () => {
        const local = makeSettings({ autoSyncEnabled: true }, { theme: "light", fontSize: 14 });
        const remote = makeSettings({ autoSyncEnabled: false }, { theme: "dark", fontSize: 18 });
        const result = mergeSettings(remote, local, iso(1), iso(0));
        expect(result.theme).toBe("dark");
        expect(result.deviceSync.autoSyncEnabled).toBe(true);
    });

    it("when local is newer, local fields win", () => {
        const local = makeSettings({ autoSyncEnabled: true }, { theme: "light" });
        const remote = makeSettings({ autoSyncEnabled: false }, { theme: "dark" });
        const result = mergeSettings(remote, local, iso(0), iso(1));
        expect(result.theme).toBe("light");
        expect(result.deviceSync.autoSyncEnabled).toBe(true);
    });
});

// ─── P1-13: RSS Content Truncation in Sync ───

describe("P1-13: RSS content truncation in sync", () => {
    it("mergeRssArticles does not truncate — truncation happens in buildDomainsAndManifest", () => {
        // This is a design verification test. The truncation logic is in the
        // sync-orchestrator buildDomainsAndManifest function, not in the merge
        // function. Since that depends on Zustand stores, we verify the merge
        // layer doesn't interfere.
        const articles = [
            { id: "art-1", feedId: "feed-1", title: "t", url: "u", content: "x".repeat(60000) },
        ] as any;
        const result = mergeRssArticles(articles, []);
        expect(result).toHaveLength(1);
        // The content is NOT truncated by merge — truncation is upstream
        expect(result[0].content.length).toBe(60000);
    });
});

// ─── Tombstone Propagation ───

describe("Tombstones propagate correctly", () => {
    it("mergeTombstones keeps earliest deletedAt per entity", () => {
        const early = iso(-10);
        const late = iso(-5);
        const existing: DeletionTombstone[] = [
            { entityId: "book-1", entityType: "book", deletedAt: early },
        ];
        const incoming: DeletionTombstone[] = [
            { entityId: "book-1", entityType: "book", deletedAt: late },
        ];
        const result = mergeTombstones(incoming, existing);
        expect(result).toHaveLength(1);
        expect(result[0].deletedAt).toBe(early);
    });

    it("mergeTombstones adds new tombstones from incoming", () => {
        const existing: DeletionTombstone[] = [];
        const incoming: DeletionTombstone[] = [
            { entityId: "book-1", entityType: "book", deletedAt: iso(-1) },
            { entityId: "ann-1", entityType: "annotation", deletedAt: iso(-2) },
        ];
        const result = mergeTombstones(incoming, existing);
        expect(result).toHaveLength(2);
    });
});
