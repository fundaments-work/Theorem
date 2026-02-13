import { useCallback, useEffect, useMemo, type RefObject } from "react";
import { cn, type RssArticle } from "@theorem/core";
import type { ArticleHeading } from "./types";
import { formatArticleDate, sanitizeArticleHtml } from "./utils";

interface ArticleReaderContentProps {
    article: RssArticle;
    feedTitle?: string;
    fontSize: number;
    lineHeight: number;
    contentRef: RefObject<HTMLDivElement | null>;
    scrollContainerRef: RefObject<HTMLDivElement | null>;
    onTextSelect: (text: string, position: { x: number; y: number }, range: Range) => void;
    onHeadingsChange: (headings: ArticleHeading[]) => void;
}

export function ArticleReaderContent({
    article,
    feedTitle,
    fontSize,
    lineHeight,
    contentRef,
    scrollContainerRef,
    onTextSelect,
    onHeadingsChange,
}: ArticleReaderContentProps) {
    const sanitizedContent = useMemo(
        () => sanitizeArticleHtml(article.content || article.summary || ""),
        [article.content, article.summary],
    );

    useEffect(() => {
        const contentElement = contentRef.current;
        if (!contentElement) {
            onHeadingsChange([]);
            return;
        }

        const headingElements = Array.from(
            contentElement.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4"),
        );

        const headings = headingElements
            .map((heading, index) => {
                const text = heading.textContent?.trim() || "";
                if (!text) {
                    return null;
                }

                const level = Number(heading.tagName.toLowerCase().replace("h", "")) || 1;
                const generatedId = `article-heading-${index + 1}`;
                const id = heading.id.trim() || generatedId;
                heading.id = id;

                return {
                    id,
                    text,
                    level,
                };
            })
            .filter((heading): heading is ArticleHeading => heading !== null);

        onHeadingsChange(headings);
    }, [contentRef, onHeadingsChange, sanitizedContent]);

    const handleMouseUp = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            return;
        }

        const range = selection.getRangeAt(0);
        if (!contentRef.current?.contains(range.commonAncestorContainer)) {
            return;
        }

        const text = selection.toString().trim();
        if (!text) {
            return;
        }

        const rect = range.getBoundingClientRect();
        onTextSelect(text, {
            x: rect.left + rect.width / 2,
            y: rect.top,
        }, range.cloneRange());
    }, [contentRef, onTextSelect]);

    return (
        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
            <article className="w-full max-w-[74ch] mx-auto px-5 py-8 md:px-10 md:py-12" onMouseUp={handleMouseUp}>
                <header className="mb-10 pb-6 border-b border-[var(--color-border-subtle)]">
                    <div className="flex flex-wrap items-center gap-2 mb-4 text-[var(--font-size-3xs)] font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">
                        {feedTitle && (
                            <span className="px-2 py-1 rounded-full bg-[var(--color-surface-muted)] text-[color:var(--color-accent)]">
                                {feedTitle}
                            </span>
                        )}
                        {article.publishedAt && <span>{formatArticleDate(article.publishedAt)}</span>}
                        {!article.publishedAt && article.fetchedAt && <span>{formatArticleDate(article.fetchedAt)}</span>}
                    </div>

                    <h1
                        className="font-semibold leading-tight tracking-tight"
                        style={{
                            fontSize: `${fontSize * 1.5}px`,
                            lineHeight: 1.2,
                        }}
                    >
                        {article.title}
                    </h1>

                    {article.author && (
                        <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
                            {article.author}
                        </p>
                    )}
                </header>

                {article.imageUrl && (
                    <figure className="mb-10">
                        <img
                            src={article.imageUrl}
                            alt=""
                            className="w-full h-auto rounded-2xl border border-[var(--color-border-subtle)]"
                            style={{ maxHeight: "420px", objectFit: "cover" }}
                        />
                    </figure>
                )}

                <div
                    ref={contentRef}
                    className={cn(
                        "rss-article-content max-w-none",
                        "[&_p]:my-4",
                        "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-[1.9em] [&_h1]:font-semibold [&_h1]:leading-tight",
                        "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-[1.45em] [&_h2]:font-semibold [&_h2]:leading-tight",
                        "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[1.2em] [&_h3]:font-semibold",
                        "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6",
                        "[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6",
                        "[&_li]:my-1",
                        "[&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-4 [&_blockquote]:text-[color:var(--color-text-secondary)]",
                        "[&_a]:text-[color:var(--color-accent)] [&_a]:underline [&_a:hover]:opacity-80",
                        "[&_img]:my-6 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-xl [&_img]:border [&_img]:border-[var(--color-border-subtle)]",
                        "[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-[var(--color-surface-muted)] [&_pre]:p-3",
                        "[&_code]:rounded [&_code]:bg-[var(--color-surface-muted)] [&_code]:px-1 [&_code]:py-0.5",
                    )}
                    style={{
                        fontSize: `${fontSize}px`,
                        lineHeight,
                        color: "var(--color-text-primary)",
                    }}
                    dangerouslySetInnerHTML={{ __html: sanitizedContent }}
                />
            </article>
        </div>
    );
}
