import type { AcademicPaper, Book } from "@theorem/core";

export function formatDateLabel(value?: string): string {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

export async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
}

export function getPaperIdentityKey(paper: AcademicPaper): string {
    if (paper.doi) {
        return `doi:${paper.doi.toLowerCase()}`;
    }
    if (paper.sourceId) {
        return `${paper.source}:${paper.sourceId}`;
    }
    return `${paper.source}:${paper.id}`;
}

export function getBookIdentityKey(book: Book): string {
    if (book.academic?.doi) {
        return `doi:${book.academic.doi.toLowerCase()}`;
    }
    if (book.academic?.source && book.academic?.sourceId) {
        return `${book.academic.source}:${book.academic.sourceId}`;
    }
    if (book.filePath) {
        return `url:${book.filePath}`;
    }
    return `book:${book.id}`;
}

export function isBookInAcademicCollection(book: Book): boolean {
    if (book.academic) return true;
    if (book.category?.toLowerCase() === "academic") return true;
    return book.tags.some((tag) => {
        const lowered = tag.toLowerCase();
        return lowered === "academic" || lowered === "paper";
    });
}

export function sourceLabel(source: AcademicPaper["source"]): string {
    switch (source) {
        case "arxiv":
            return "arXiv";
        case "pubmed":
            return "PubMed";
        default:
            return "Manual";
    }
}
