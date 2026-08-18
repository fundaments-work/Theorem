import { describe, it, expect } from "vitest";
import { zipSync, strToU8, unzipSync } from "fflate";
import { buildExportFilename } from "../src/core/lib/book-export";
import { rewriteEpubWithFflate } from "../src/core/lib/epub-write-browser";
import type { Book, BookFormat } from "../src/core/types";

function makeBook(overrides: Partial<Book> = {}): Book {
    return {
        id: "b1",
        title: "The Great Book",
        author: "Jane Doe",
        filePath: "/tmp/The Great Book.epub",
        format: "epub",
        fileSize: 1234,
        addedAt: new Date(),
        progress: 0,
        isFavorite: false,
        tags: [],
        readingTime: 0,
        ...overrides,
    };
}

function buildEpub(opts: {
    title?: string;
    author?: string;
    hasCover?: boolean;
    opf?: string;
}): Uint8Array {
    const opf = opts.opf ?? `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>${opts.title ?? "Old Title"}</dc:title>
    <dc:creator>${opts.author ?? "Old Author"}</dc:creator>
  </metadata>
  <manifest>
    ${opts.hasCover ? '<item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>' : ""}
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`;

    const files: Record<string, Uint8Array> = {
        "mimetype": strToU8("application/epub+zip"),
        "META-INF/container.xml": strToU8(
            `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
        ),
        "OEBPS/content.opf": strToU8(opf),
        "OEBPS/chapter1.xhtml": strToU8("<html><body><p>Hi</p></body></html>"),
    };
    if (opts.hasCover) {
        files["OEBPS/images/cover.jpg"] = strToU8("old-cover");
    }
    return zipSync(files, { level: 6 });
}

function readBytes(epub: Uint8Array, name: string): Uint8Array {
    const files = unzipSync(epub);
    const key = Object.keys(files).find((k) => k.replace(/\\/g, "/") === name);
    if (!key) throw new Error(`entry not found: ${name}`);
    return files[key];
}

function expectBytesEqual(got: Uint8Array, want: Uint8Array) {
    expect(Array.from(got)).toEqual(Array.from(want));
}

function readText(epub: Uint8Array, name: string): string {
    return new TextDecoder().decode(readBytes(epub, name));
}

describe("buildExportFilename", () => {
    it("produces Title.ext from the book format", () => {
        expect(buildExportFilename(makeBook())).toBe("The Great Book.epub");
    });

    it("uses format extension for pdf", () => {
        expect(buildExportFilename(makeBook({ format: "pdf" as BookFormat }))).toBe("The Great Book.pdf");
    });

    it("sanitizes path-unsafe characters", () => {
        const book = makeBook({ title: 'A/B\\C:D*E?F"G<H>I|J' });
        expect(buildExportFilename(book)).toBe("ABCDEFGHIJ.epub");
    });

    it("falls back to Untitled for empty titles", () => {
        expect(buildExportFilename(makeBook({ title: "" }))).toBe("Untitled.epub");
    });

    it("appends a numeric suffix for duplicates", () => {
        expect(buildExportFilename(makeBook(), 2)).toBe("The Great Book (2).epub");
    });
});

describe("rewriteEpubWithFflate", () => {
    it("rewrites existing metadata fields", () => {
        const epub = buildEpub({ title: "Old Title", author: "Old Author" });
        const out = rewriteEpubWithFflate(epub, { title: "New Title", author: "New Author", description: "A <great> & book" }, null);
        const opf = readText(out, "OEBPS/content.opf");
        expect(opf).toContain("<dc:title>New Title</dc:title>");
        expect(opf).toContain("<dc:creator>New Author</dc:creator>");
        expect(opf).not.toContain("Old Title");
        expect(opf).not.toContain("Old Author");
        expect(opf).toContain("<dc:description xmlns:dc=\"http://purl.org/dc/elements/1.1/\">A &lt;great&gt; &amp; book</dc:description>");
    });

    it("inserts missing fields and keeps the rest intact", () => {
        const epub = buildEpub({ title: "Keep Me", author: "Author" });
        const out = rewriteEpubWithFflate(epub, { publisher: "Acme", language: "en" }, null);
        const opf = readText(out, "OEBPS/content.opf");
        expect(opf).toContain("<dc:title>Keep Me</dc:title>");
        expect(opf).toContain("<dc:publisher xmlns:dc=\"http://purl.org/dc/elements/1.1/\">Acme</dc:publisher>");
        expect(opf).toContain("<dc:language xmlns:dc=\"http://purl.org/dc/elements/1.1/\">en</dc:language>");
    });

    it("replaces an existing cover image", () => {
        const epub = buildEpub({ hasCover: true });
        const out = rewriteEpubWithFflate(epub, {}, new TextEncoder().encode("new-cover"));
        expectBytesEqual(readBytes(out, "OEBPS/images/cover.jpg"), new TextEncoder().encode("new-cover"));
        expect(readText(out, "OEBPS/chapter1.xhtml")).toContain("<p>Hi</p>");
    });

    it("adds a cover entry plus manifest item and meta when missing", () => {
        const epub = buildEpub({ hasCover: false });
        const out = rewriteEpubWithFflate(epub, {}, new TextEncoder().encode("new-cover-png"));
        const opf = readText(out, "OEBPS/content.opf");
        expect(opf).toContain('id="theorem-cover"');
        expect(opf).toContain('name="cover" content="theorem-cover"');
        expectBytesEqual(readBytes(out, "OEBPS/cover.png"), new TextEncoder().encode("new-cover-png"));
    });
});