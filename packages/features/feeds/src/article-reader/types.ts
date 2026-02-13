import type { HighlightColor } from "@theorem/core";

export type ArticleReaderPanel = "toc" | "search" | "bookmarks" | "settings" | "info" | null;

export interface ArticleHighlight {
    id: string;
    text: string;
    color: HighlightColor;
    createdAt: Date;
}

export interface ArticleScrollBookmark {
    id: string;
    progress: number;
    label: string;
    createdAt: Date;
}

export interface ArticleHeading {
    id: string;
    text: string;
    level: number;
}
