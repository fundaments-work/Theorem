import type { Book } from "../types";

export function isBookCompleted(book: Book): boolean {
    if (book.manualCompletionState === "read") return true;
    if (book.manualCompletionState === "unread") return false;
    return !!book.completedAt || book.progress >= 0.99;
}

export function countBooksReadThisYear(books: Book[], year = new Date().getFullYear()): number {
    return books.filter((book) => {
        if (book.manualCompletionState === "unread") return false;
        if (!book.completedAt) return false;
        const d = book.completedAt instanceof Date ? book.completedAt : new Date(book.completedAt);
        if (Number.isNaN(d.getTime())) return false;
        return d.getFullYear() === year;
    }).length;
}
