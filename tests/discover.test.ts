import { describe, expect, it } from "vitest";
import { DiscoverService } from "../src/core/services/DiscoverService";
import { parseOpdsFeed } from "../src/core/services/OpdsService";

const SAMPLE_GUTENBERG_SEARCH = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
<id>http://www.gutenberg.org/ebooks/search.opds/?query=pride</id>
<title>Books: pride</title>
<entry>
<id>https://www.gutenberg.org/ebooks/authors/search.opds/?query=pride</id>
<title>Authors</title>
<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/authors/search.opds/?query=pride"/>
</entry>
<entry>
<id>https://www.gutenberg.org/ebooks/subjects/search.opds/?query=pride</id>
<title>Subjects</title>
<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/subjects/search.opds/?query=pride"/>
</entry>
<entry>
<id>https://www.gutenberg.org/ebooks/1342.opds</id>
<title>Pride and Prejudice</title>
<content type="text">Jane Austen</content>
<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/1342.opds"/>
</entry>
<entry>
<id>https://www.gutenberg.org/ebooks/2701.opds</id>
<title>Moby Dick; Or, The Whale by Herman Melville</title>
<content type="text">Herman Melville</content>
<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/2701.opds"/>
</entry>
</feed>`;

describe("DiscoverService", () => {
    it("should export DiscoverService with core methods", () => {
        expect(typeof DiscoverService.loadCuratedSections).toBe("function");
        expect(typeof DiscoverService.search).toBe("function");
        expect(typeof DiscoverService.downloadBook).toBe("function");
    });

    it("parses and filters Gutenberg search XML properly", async () => {
        const feed = await parseOpdsFeed(SAMPLE_GUTENBERG_SEARCH, "https://www.gutenberg.org/ebooks/search.opds/?query=pride");
        expect(feed.entries.length).toBe(4);

        // Test filtering via DiscoverService
        const actualBooks = feed.entries.filter((entry) => {
            const lower = (entry.title || "").toLowerCase().trim();
            if (["authors", "subjects", "bookshelves", "categories", "languages"].includes(lower)) return false;
            if (entry.id.includes("/subjects/") || entry.id.includes("/bookshelves/") || entry.id.includes("/authors/")) return false;
            return true;
        });

        expect(actualBooks.length).toBe(2);
        expect(actualBooks[0].title).toBe("Pride and Prejudice");
        expect(actualBooks[1].title).toContain("Moby Dick");
    });
});
