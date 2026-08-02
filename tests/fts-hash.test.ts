import { describe, expect, it } from "vitest";
import { computeFtsHash } from "../src/core/store/libraryStore";

describe("computeFtsHash", () => {
    it("is deterministic for the same book set", () => {
        const books = [
            { id: "a", title: "Gatsby", author: "Fitzgerald" },
            { id: "b", title: "Moby Dick", author: "Melville" },
        ];
        expect(computeFtsHash(books)).toBe(computeFtsHash(books));
    });

    it("changes when a book is added or removed", () => {
        const books = [
            { id: "a", title: "Gatsby", author: "Fitzgerald" },
            { id: "b", title: "Moby Dick", author: "Melville" },
        ];
        const withExtra = [...books, { id: "c", title: "Dune", author: "Herbert" }];
        const without = [books[0]];
        expect(computeFtsHash(withExtra)).not.toBe(computeFtsHash(books));
        expect(computeFtsHash(without)).not.toBe(computeFtsHash(books));
    });

    it("changes when title or author changes", () => {
        const books = [
            { id: "a", title: "Gatsby", author: "Fitzgerald" },
            { id: "b", title: "Moby Dick", author: "Melville" },
        ];
        const renamed = [
            { id: "a", title: "Gatsby Revisited", author: "Fitzgerald" },
            { id: "b", title: "Moby Dick", author: "Melville" },
        ];
        expect(computeFtsHash(renamed)).not.toBe(computeFtsHash(books));
    });

    it("is order-sensitive (book identity is part of the hash)", () => {
        const a = { id: "a", title: "Gatsby", author: "Fitzgerald" };
        const b = { id: "b", title: "Moby Dick", author: "Melville" };
        expect(computeFtsHash([a, b])).not.toBe(computeFtsHash([b, a]));
    });
});
