import { useCallback, useEffect, useRef, useMemo, type RefObject } from "react";
import { cn } from "../../../core/lib/utils";
import type {
    FontFamily,
    ReaderSettings as ReaderSettingsState,
    RssArticle,
} from "../../../core/types";
import type { ArticleHeading } from "./types";
import { setElementHtml } from "../../../core/lib/sanitize";
import { formatArticleDate, sanitizeArticleHtml } from "./utils";

interface ArticleReaderContentProps {
    article: RssArticle;
    feedTitle?: string;
    fontSize: number;
    lineHeight: number;
    fontFamily: FontFamily;
    textAlign: ReaderSettingsState["textAlign"];
    letterSpacing: number;
    wordSpacing: number;
    contentRef: RefObject<HTMLDivElement | null>;
    scrollContainerRef: RefObject<HTMLDivElement | null>;
    onTextSelect: (text: string, position: { x: number; y: number; height?: number }, range: Range) => void;
    onHeadingsChange: (headings: ArticleHeading[]) => void;
    
    sanitizedContent?: string;
}

function resolveFontFamily(fontFamily: FontFamily): string {
    switch (fontFamily) {
        case "serif":
            return "var(--font-merriweather), Georgia, serif";
        case "sans":
            return "var(--font-sans), system-ui, sans-serif";
        case "mono":
            return "var(--font-mono), monospace";
        case "original":
        default:
            return "inherit";
    }
}

export function ArticleReaderContent({
    article,
    feedTitle,
    fontSize,
    lineHeight,
    fontFamily,
    textAlign,
    letterSpacing,
    wordSpacing,
    contentRef,
    scrollContainerRef,
    onTextSelect,
    onHeadingsChange,
    sanitizedContent: sanitizedContentProp,
}: ArticleReaderContentProps) {
    const sanitizedContentFallback = useMemo(
        () => sanitizeArticleHtml(article.content || article.summary || ""),
        [article.content, article.summary],
    );

    const sanitizedContent = sanitizedContentProp ?? sanitizedContentFallback;

    const contentHasImage = useMemo(() => {
        if (!article.imageUrl) return false;
        const temp = document.createElement("div");
        setElementHtml(temp, sanitizedContent);
        const firstImg = temp.querySelector("img");
        if (!firstImg) return false;
        try {
            const imgSrc = new URL(firstImg.getAttribute("src") || "", article.url || undefined).href;
            const articleImgSrc = new URL(article.imageUrl, article.url || undefined).href;
            return imgSrc === articleImgSrc;
        } catch {
            return firstImg.getAttribute("src") === article.imageUrl;
        }
    }, [sanitizedContent, article.imageUrl, article.url]);

    const appliedHtmlRef = useRef<string | null>(null);

    useEffect(() => {
        const contentElement = contentRef.current;
        if (!contentElement) {
            return;
        }

        if (appliedHtmlRef.current === sanitizedContent) {
            return;
        }

        setElementHtml(contentElement, sanitizedContent);
        appliedHtmlRef.current = sanitizedContent;
    }, [contentRef, sanitizedContent]);

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
            height: Math.max(rect.height, 24),
        }, range.cloneRange());
    }, [contentRef, onTextSelect]);

    const articleIdRef = useRef(article.id);
    useEffect(() => {
        if (articleIdRef.current !== article.id) {
            articleIdRef.current = article.id;
            appliedHtmlRef.current = null;
        }
    }, [article.id]);

    return (
        <div
            ref={scrollContainerRef}
            className="h-full min-h-0 flex-1 overflow-y-auto custom-scrollbar [content-visibility:auto] overscroll-contain pb-[env(safe-area-inset-bottom)]"
            style={{
                WebkitOverflowScrolling: "touch",
                overscrollBehaviorY: "contain",
            }}
        >
            <article
                className="mx-auto w-full max-w-[72ch] px-6 py-12 md:px-12 md:py-20 lg:px-8"
                onMouseUp={handleMouseUp}
            >
                <header className="mb-10 pb-6 border-b border-[var(--color-border-subtle)] select-text">
                    <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
                        {feedTitle && (
                            <span className="border border-[var(--color-border)] px-2 py-1 text-[color:var(--color-text-primary)]">
                                {feedTitle}
                            </span>
                        )}
                        {article.publishedAt && <span>{formatArticleDate(article.publishedAt)}</span>}
                        {!article.publishedAt && article.fetchedAt && <span>{formatArticleDate(article.fetchedAt)}</span>}
                    </div>

                    <h1
                        className="font-serif font-semibold leading-tight tracking-tight select-text"
                        style={{
                            fontSize: `${fontSize * 1.5}px`,
                            lineHeight: 1.2,
                        }}
                    >
                        {article.title}
                    </h1>

                    {article.author && (
                        <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--color-text-secondary)] select-text">
                            {article.author}
                        </p>
                    )}
                </header>

                {article.imageUrl && !contentHasImage && (
                    <figure className="mb-10 select-text">
                        <img
                            src={article.imageUrl}
                            alt=""
                            className="h-auto w-full border border-[var(--color-border-subtle)]"
                            style={{ maxHeight: "420px", objectFit: "cover" }}
                        />
                    </figure>
                )}

                <div
                    ref={contentRef}
                    className={cn(
                        "rss-article-content max-w-none select-text",
                        "[&_p]:my-4",
                        "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:text-[1.9em] [&_h1]:font-semibold [&_h1]:leading-tight",
                        "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:text-[1.45em] [&_h2]:font-semibold [&_h2]:leading-tight",
                        "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-[1.2em] [&_h3]:font-semibold",
                        "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6",
                        "[&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6",
                        "[&_li]:my-1",
                        "[&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-4 [&_blockquote]:text-[color:var(--color-text-secondary)]",
                        "[&_a]:text-[color:var(--color-accent)] [&_a]:underline [&_a:hover]:opacity-80",
                        "[&_img]:my-6 [&_img]:max-w-full [&_img]:h-auto [&_img]:border [&_img]:border-[var(--color-border-subtle)]",
                        "[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-[var(--color-border)] [&_pre]:bg-[var(--color-surface-muted)] [&_pre]:p-3",
                        "[&_code]:bg-[var(--color-surface-muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
                    )}
                    style={{
                        fontSize: `${fontSize}px`,
                        lineHeight,
                        fontFamily: resolveFontFamily(fontFamily),
                        textAlign,
                        letterSpacing: `${letterSpacing}em`,
                        wordSpacing: `${wordSpacing}em`,
                        color: "var(--color-text-primary)",
                    }}
                />
            </article>
        </div>
    );
}
