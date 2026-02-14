export type ArticleReaderPanel = "toc" | "search" | "bookmarks" | "settings" | "info" | null;

export interface ArticleHeading {
    id: string;
    text: string;
    level: number;
}
