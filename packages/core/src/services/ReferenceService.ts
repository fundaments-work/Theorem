import type {
    AcademicPaper,
    Book,
    CitationFormat,
    ReferenceItem,
} from "../types";
import { generateCitation as generateAcademicCitation, toAcademicPaper } from "./AcademicService";

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
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

function publicationYear(reference: ReferenceItem): string | undefined {
    if (!reference.publishedDate) return undefined;
    const parsed = new Date(reference.publishedDate);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return String(parsed.getUTCFullYear());
}

function buildBookCitation(reference: ReferenceItem, format: CitationFormat): string {
    const authors = reference.authors.length > 0 ? reference.authors : ["Unknown"];
    const title = reference.title || "Untitled";
    const publisher = reference.journal || reference.conference || "";
    const year = publicationYear(reference) || "n.d.";
    const url = reference.url || "";

    if (format === "bibtex") {
        const firstAuthor = authors[0] || "book";
        const parsed = splitAuthorName(firstAuthor);
        const keyBase = (parsed.family || "book").toLowerCase().replace(/[^a-z0-9]/g, "") || "book";
        const key = `${keyBase}${year}`;
        const fields: Array<[string, string | undefined]> = [
            ["title", title],
            ["author", authors.join(" and ")],
            ["publisher", publisher || undefined],
            ["year", year],
            ["url", url || undefined],
        ];

        const lines = fields
            .filter(([, value]) => Boolean(value))
            .map(([name, value]) => `  ${name} = {${value}}`);

        return `@book{${key},\n${lines.join(",\n")}\n}`;
    }

    if (format === "mla") {
        const first = splitAuthorName(authors[0]);
        const firstDisplay = [first.family, first.given].filter(Boolean).join(", ") || "Unknown";
        const authorText = authors.length > 1 ? `${firstDisplay}, et al.` : firstDisplay;
        return [
            `${authorText}.`,
            `*${title}*.`,
            publisher ? `${publisher},` : "",
            `${year}.`,
            url,
        ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
    }

    const renderedAuthors = authors.map((author) => {
        const parsed = splitAuthorName(author);
        const initials = parsed.given
            .split(" ")
            .filter(Boolean)
            .map((segment) => `${segment[0]?.toUpperCase()}.`)
            .join(" ");
        return [parsed.family, initials].filter(Boolean).join(", ");
    });
    const authorText = renderedAuthors.length === 1
        ? renderedAuthors[0]
        : renderedAuthors.length === 2
            ? `${renderedAuthors[0]} & ${renderedAuthors[1]}`
            : `${renderedAuthors.slice(0, -1).join(", ")}, & ${renderedAuthors[renderedAuthors.length - 1]}`;

    return [
        `${authorText || "Unknown"}`,
        `(${year}).`,
        `${title}.`,
        publisher ? `${publisher}.` : "",
        url,
    ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

function toAcademicPaperFromReference(reference: ReferenceItem): AcademicPaper {
    return {
        id: reference.id,
        source: reference.source === "library" ? "manual" : reference.source,
        sourceId: reference.sourceId,
        title: reference.title,
        authors: reference.authors,
        abstract: reference.abstract,
        doi: reference.doi,
        journal: reference.journal,
        conference: reference.conference,
        citationCount: reference.citationCount,
        fieldTags: reference.fieldTags,
        openAccess: reference.openAccess,
        openAccessUrl: reference.openAccessUrl,
        pdfUrl: reference.url,
        url: reference.url,
        publishedDate: reference.publishedDate,
        referenceData: reference.referenceData,
    };
}

export function toReferenceItem(book: Book): ReferenceItem {
    const asAcademic = toAcademicPaper(book);
    const derivedAuthors = (book.author || "")
        .split(",")
        .map((author) => normalizeWhitespace(author))
        .filter(Boolean);
    const authors = asAcademic?.authors?.length ? asAcademic.authors : derivedAuthors;

    return {
        id: book.id,
        bookId: book.id,
        type: asAcademic ? "paper" : "book",
        source: asAcademic?.source || "library",
        sourceId: asAcademic?.sourceId,
        title: book.title,
        authors,
        abstract: asAcademic?.abstract || book.description,
        doi: asAcademic?.doi,
        journal: asAcademic?.journal || book.publisher,
        conference: asAcademic?.conference,
        citationCount: asAcademic?.citationCount,
        fieldTags: asAcademic?.fieldTags,
        openAccess: asAcademic?.openAccess,
        openAccessUrl: asAcademic?.openAccessUrl,
        url: asAcademic?.url || asAcademic?.pdfUrl || book.filePath,
        publishedDate: asAcademic?.publishedDate || book.publishedDate,
        addedAt: book.addedAt,
        format: book.format,
        tags: book.tags,
        isAcademic: Boolean(asAcademic),
        referenceData: asAcademic?.referenceData,
    };
}

export function generateReferenceCitation(
    reference: ReferenceItem,
    format: CitationFormat,
): string {
    if (reference.type === "paper" || reference.isAcademic) {
        return generateAcademicCitation(toAcademicPaperFromReference(reference), format);
    }

    return buildBookCitation(reference, format);
}

export type ReferenceSortMode =
    | "relevance"
    | "newest"
    | "oldest"
    | "citations_desc"
    | "citations_asc"
    | "title_asc"
    | "title_desc";

export function referencePublishedTimestamp(reference: ReferenceItem): number {
    if (reference.publishedDate) {
        const parsed = new Date(reference.publishedDate).getTime();
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }

    return new Date(reference.addedAt).getTime();
}

export function sortReferenceItems(
    items: ReferenceItem[],
    sortBy: ReferenceSortMode,
): ReferenceItem[] {
    const sorted = [...items];

    sorted.sort((a, b) => {
        if (sortBy === "title_asc") {
            return a.title.localeCompare(b.title);
        }
        if (sortBy === "title_desc") {
            return b.title.localeCompare(a.title);
        }
        if (sortBy === "oldest") {
            return referencePublishedTimestamp(a) - referencePublishedTimestamp(b);
        }
        if (sortBy === "citations_desc") {
            return (b.citationCount ?? -1) - (a.citationCount ?? -1);
        }
        if (sortBy === "citations_asc") {
            return (a.citationCount ?? -1) - (b.citationCount ?? -1);
        }

        // Default to newest for relevance/newest modes at reference-level.
        return referencePublishedTimestamp(b) - referencePublishedTimestamp(a);
    });

    return sorted;
}
