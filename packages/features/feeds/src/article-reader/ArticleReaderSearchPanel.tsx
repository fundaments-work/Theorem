import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUp, Search, X } from "lucide-react";
import { cn } from "@theorem/core";
import { FloatingPanel } from "@theorem/ui";
import { highlightExcerpt } from "./utils";

interface ArticleReaderSearchPanelProps {
    visible: boolean;
    contentRef: RefObject<HTMLDivElement | null>;
    onClose: () => void;
}

interface SearchResult {
    excerpt: string;
}

export function ArticleReaderSearchPanel({
    visible,
    contentRef,
    onClose,
}: ArticleReaderSearchPanelProps) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [activeIndex, setActiveIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);

    const clearHighlights = useCallback(() => {
        if (!contentRef.current) {
            return;
        }

        const marks = contentRef.current.querySelectorAll("mark.article-search-highlight");
        marks.forEach((mark) => {
            const parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
                parent.normalize();
            }
        });
    }, [contentRef]);

    const handleClear = useCallback(() => {
        setQuery("");
        setResults([]);
        setActiveIndex(-1);
        clearHighlights();
    }, [clearHighlights]);

    const performSearch = useCallback((searchQuery: string) => {
        const container = contentRef.current;
        const normalizedQuery = searchQuery.trim().toLowerCase();

        if (!container || !normalizedQuery) {
            setResults([]);
            setActiveIndex(-1);
            clearHighlights();
            return;
        }

        clearHighlights();

        const treeWalker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        const nextResults: SearchResult[] = [];

        while (treeWalker.nextNode()) {
            const textNode = treeWalker.currentNode as Text;
            const text = textNode.textContent || "";
            const lowerText = text.toLowerCase();
            let cursor = 0;

            while (true) {
                const index = lowerText.indexOf(normalizedQuery, cursor);
                if (index === -1) {
                    break;
                }

                const excerptStart = Math.max(0, index - 40);
                const excerptEnd = Math.min(text.length, index + normalizedQuery.length + 40);
                const excerpt = `${excerptStart > 0 ? "..." : ""}${text.slice(excerptStart, excerptEnd)}${excerptEnd < text.length ? "..." : ""}`;
                nextResults.push({ excerpt });

                const range = document.createRange();
                range.setStart(textNode, index);
                range.setEnd(textNode, index + normalizedQuery.length);

                const mark = document.createElement("mark");
                mark.className = "article-search-highlight";
                mark.style.backgroundColor = "color-mix(in srgb, var(--color-accent) 24%, transparent)";
                mark.style.color = "var(--color-text-primary)";
                mark.style.borderRadius = "2px";
                mark.style.padding = "0 1px";

                try {
                    range.surroundContents(mark);
                } catch {
                    // Cross-node ranges are ignored.
                }

                cursor = index + normalizedQuery.length;
                break;
            }

            if (nextResults.length >= 300) {
                break;
            }
        }

        setResults(nextResults);
        if (nextResults.length > 0) {
            setActiveIndex(0);
            const firstResult = container.querySelector("mark.article-search-highlight");
            firstResult?.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
            setActiveIndex(-1);
        }
    }, [clearHighlights, contentRef]);

    const navigateToResult = useCallback((targetIndex: number) => {
        const container = contentRef.current;
        if (!container || targetIndex < 0) {
            return;
        }

        const marks = container.querySelectorAll("mark.article-search-highlight");
        const target = marks[targetIndex] as HTMLElement | undefined;
        if (!target) {
            return;
        }

        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setActiveIndex(targetIndex);
    }, [contentRef]);

    useEffect(() => {
        if (!visible) {
            handleClear();
            return;
        }

        const timer = setTimeout(() => {
            performSearch(query);
        }, 180);

        return () => clearTimeout(timer);
    }, [handleClear, performSearch, query, visible]);

    useEffect(() => {
        if (!visible) {
            return;
        }

        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 60);

        return () => clearTimeout(timer);
    }, [visible]);

    return (
        <FloatingPanel visible={visible} className="overflow-hidden">
            <div className="reader-panel-header px-4 pt-4 pb-3">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">Search in Article</h2>
                    <button
                        onClick={onClose}
                        className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80"
                        title="Close"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-text-muted)]" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search in article..."
                        className={cn(
                            "w-full h-10 pl-10 pr-10 rounded-xl text-sm",
                            "bg-[var(--color-background)] border-2 border-transparent",
                            "focus:border-[var(--color-accent)] outline-none transition-colors",
                        )}
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-[var(--color-surface-muted)] transition-colors"
                            title="Clear"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {query && (
                    <div className="mt-2 flex items-center justify-between text-[var(--font-size-3xs)] uppercase tracking-wider text-[color:var(--color-text-muted)]">
                        <span>{results.length} {results.length === 1 ? "match" : "matches"}</span>
                        {results.length > 1 && (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => navigateToResult(Math.max(0, activeIndex - 1))}
                                    className="p-1 rounded hover:bg-[var(--color-surface-muted)]"
                                >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <span className="text-[11px] normal-case tabular-nums">
                                    {activeIndex + 1}/{results.length}
                                </span>
                                <button
                                    onClick={() => navigateToResult(Math.min(results.length - 1, activeIndex + 1))}
                                    className="p-1 rounded hover:bg-[var(--color-surface-muted)]"
                                >
                                    <ArrowUp className="w-3.5 h-3.5 rotate-180" />
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3 custom-scrollbar">
                {!query && (
                    <div className="py-10 text-center text-[color:var(--color-text-muted)] text-sm">
                        Start typing to search this article.
                    </div>
                )}

                {query && results.length === 0 && (
                    <div className="py-10 text-center text-[color:var(--color-text-muted)] text-sm">
                        No matches found.
                    </div>
                )}

                <div className="space-y-1">
                    {results.map((result, index) => (
                        <button
                            key={`${result.excerpt}-${index}`}
                            onClick={() => navigateToResult(index)}
                            className={cn(
                                "w-full text-left p-3 rounded-xl border transition-colors",
                                activeIndex === index
                                    ? "bg-[var(--color-accent-light)] border-[var(--color-accent)]/35"
                                    : "border-transparent hover:bg-[var(--color-background)]",
                            )}
                        >
                            <p
                                className="text-[var(--font-size-caption)] text-[color:var(--color-text-secondary)] line-clamp-3 leading-relaxed"
                                dangerouslySetInnerHTML={{ __html: highlightExcerpt(result.excerpt, query) }}
                            />
                        </button>
                    ))}
                </div>
            </div>
        </FloatingPanel>
    );
}
