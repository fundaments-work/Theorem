import { describe, it, expect } from "vitest";
import { countBooksReadThisYear, isBookCompleted } from "../src/core/lib/statistics";
import type { Book } from "../src/core/types";

function makeBook(overrides: Partial<Book> = {}): Book {
    return {
        id: "b",
        title: "Book",
        author: "Author",
        filePath: "/tmp/b.epub",
        format: "epub",
        fileSize: 100,
        addedAt: new Date("2026-01-01"),
        progress: 0,
        isFavorite: false,
        tags: [],
        readingTime: 0,
        ...overrides,
    };
}

describe("countBooksReadThisYear", () => {
    it("counts books completed in the current year", () => {
        const books = [
            makeBook({ id: "a", completedAt: new Date("2026-03-01") }),
            makeBook({ id: "b", completedAt: new Date("2026-07-15") }),
            makeBook({ id: "c", completedAt: new Date("2025-12-01") }),
            makeBook({ id: "d", progress: 0.5 }),
        ];
        expect(countBooksReadThisYear(books, 2026)).toBe(2);
        expect(countBooksReadThisYear(books, 2025)).toBe(1);
    });

    it("respects manualCompletionState override", () => {
        const books = [
            makeBook({ id: "a", completedAt: new Date("2026-03-01"), manualCompletionState: "unread" }),
            makeBook({ id: "b", completedAt: new Date("2026-03-01"), manualCompletionState: "read" }),
        ];
        expect(countBooksReadThisYear(books, 2026)).toBe(1);
    });

    it("ignores books without completedAt", () => {
        const books = [
            makeBook({ id: "a", progress: 1.0 }),
            makeBook({ id: "b", progress: 0.99 }),
            makeBook({ id: "c" }),
        ];
        expect(countBooksReadThisYear(books, 2026)).toBe(0);
    });

    it("does not count books from other years", () => {
        const books = [makeBook({ id: "a", completedAt: new Date("2024-06-01") })];
        expect(countBooksReadThisYear(books, 2026)).toBe(0);
    });

    it("handles invalid dates", () => {
        const books = [makeBook({ id: "a", completedAt: "not-a-date" as any })];
        expect(countBooksReadThisYear(books, 2026)).toBe(0);
    });
});

describe("isBookCompleted", () => {
    it("true when manual read", () => {
        expect(isBookCompleted(makeBook({ manualCompletionState: "read" }))).toBe(true);
    });
    it("false when manual unread despite completedAt", () => {
        expect(isBookCompleted(makeBook({ completedAt: new Date(), manualCompletionState: "unread" }))).toBe(false);
    });
    it("true from completedAt", () => {
        expect(isBookCompleted(makeBook({ completedAt: new Date() }))).toBe(true);
    });
    it("true from progress", () => {
        expect(isBookCompleted(makeBook({ progress: 1.0 }))).toBe(true);
        expect(isBookCompleted(makeBook({ progress: 0.99 }))).toBe(true);
        expect(isBookCompleted(makeBook({ progress: 0.5 }))).toBe(false);
    });
});
