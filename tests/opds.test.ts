import { describe, expect, it } from "vitest";
import { parseOpdsFeed } from "../src/core/services/OpdsService";
import { useOpdsStore } from "../src/core/store/opdsStore";

const sampleAtomXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/terms/"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>https://example.com/opds</id>
  <title>Sample Catalog</title>
  <subtitle>A test catalog</subtitle>
  <updated>2026-08-29T10:00:00Z</updated>
  <link rel="self" href="https://example.com/opds" type="application/atom+xml;profile=opds-catalog"/>
  <link rel="next" href="https://example.com/opds?page=2" type="application/atom+xml;profile=opds-catalog"/>
  <link rel="search" href="https://example.com/search?q={searchTerms}" type="application/atom+xml"/>

  <!-- Navigation Entry -->
  <entry>
    <id>urn:catalog:fiction</id>
    <title>Fiction Books</title>
    <summary>Explore fiction collection</summary>
    <link rel="subsection" href="/opds/fiction" type="application/atom+xml;profile=opds-catalog"/>
  </entry>

  <!-- Acquisition Entry (Book) -->
  <entry>
    <id>urn:book:12345</id>
    <title>Pride and Prejudice</title>
    <author>
      <name>Jane Austen</name>
    </author>
    <summary>A classic romantic novel.</summary>
    <dc:language>en</dc:language>
    <dc:publisher>Standard Ebooks</dc:publisher>
    <dc:issued>1813-01-28</dc:issued>
    <link rel="http://opds-spec.org/image" href="/covers/pride.jpg" type="image/jpeg"/>
    <link rel="http://opds-spec.org/image/thumbnail" href="/covers/pride-thumb.jpg" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition" href="/downloads/pride.epub" type="application/epub+zip"/>
  </entry>
</feed>`;

describe("OpdsService", () => {
    it("should parse OPDS 1.2 feed metadata, navigation entries, and acquisition books", async () => {
        const feed = await parseOpdsFeed(sampleAtomXml, "https://example.com/opds");

        expect(feed.title).toBe("Sample Catalog");
        expect(feed.subtitle).toBe("A test catalog");
        expect(feed.nextUrl).toBe("https://example.com/opds?page=2");
        expect(feed.searchUrlTemplate).toBe("https://example.com/search?q={searchTerms}");
        expect(feed.entries).toHaveLength(2);

        // Navigation entry
        const navEntry = feed.entries[0];
        expect(navEntry.title).toBe("Fiction Books");
        expect(navEntry.isNavigation).toBe(true);
        expect(navEntry.navUrl).toBe("https://example.com/opds/fiction");
        expect(navEntry.downloadUrl).toBeUndefined();

        // Acquisition entry
        const bookEntry = feed.entries[1];
        expect(bookEntry.title).toBe("Pride and Prejudice");
        expect(bookEntry.author).toBe("Jane Austen");
        expect(bookEntry.language).toBe("en");
        expect(bookEntry.publisher).toBe("Standard Ebooks");
        expect(bookEntry.isNavigation).toBe(false);
        expect(bookEntry.coverUrl).toBe("https://example.com/covers/pride.jpg");
        expect(bookEntry.thumbnailUrl).toBe("https://example.com/covers/pride-thumb.jpg");
        expect(bookEntry.downloadUrl).toBe("https://example.com/downloads/pride.epub");
        expect(bookEntry.downloadFormat).toBe("epub");
    });
});

describe("opdsStore", () => {
    it("should manage custom catalogs and navigation history", () => {
        const store = useOpdsStore.getState();

        const id = store.addCatalog({
            title: "Custom Calibre",
            url: "http://192.168.1.50:8080/opds",
        });

        expect(useOpdsStore.getState().catalogs.some((c) => c.id === id)).toBe(true);
        expect(useOpdsStore.getState().activeCatalogId).toBe(id);

        store.navigateToFeed("http://192.168.1.50:8080/opds/categories");
        expect(useOpdsStore.getState().currentFeedUrl).toBe("http://192.168.1.50:8080/opds/categories");
        expect(useOpdsStore.getState().feedHistory).toHaveLength(1);

        const navigated = store.navigateBack();
        expect(navigated).toBe(true);
        expect(useOpdsStore.getState().currentFeedUrl).toBe("http://192.168.1.50:8080/opds");

        store.removeCatalog(id);
        expect(useOpdsStore.getState().catalogs.some((c) => c.id === id)).toBe(false);
    });
});
