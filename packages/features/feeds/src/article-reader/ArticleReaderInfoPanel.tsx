import { Calendar, ExternalLink, Globe, User, X } from "lucide-react";
import type { RssArticle } from "@theorem/core";
import { FloatingPanel } from "@theorem/ui";
import { formatArticleDate } from "./utils";

interface ArticleReaderInfoPanelProps {
    visible: boolean;
    article: RssArticle;
    feedTitle?: string;
    onClose: () => void;
}

export function ArticleReaderInfoPanel({
    visible,
    article,
    feedTitle,
    onClose,
}: ArticleReaderInfoPanelProps) {
    return (
        <FloatingPanel visible={visible} className="overflow-hidden">
            <div className="reader-panel-header px-4 pt-4 pb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">Article Info</h2>
                <button
                    onClick={onClose}
                    className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80"
                    title="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-5 space-y-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div>
                    <h3 className="text-base font-semibold text-[color:var(--color-text-primary)] leading-tight">
                        {article.title}
                    </h3>
                </div>

                <div className="space-y-3 text-sm">
                    {article.author && (
                        <div className="flex items-start gap-2 text-[color:var(--color-text-secondary)]">
                            <User className="w-4 h-4 mt-0.5" />
                            <span>{article.author}</span>
                        </div>
                    )}

                    {(article.publishedAt || article.fetchedAt) && (
                        <div className="flex items-start gap-2 text-[color:var(--color-text-secondary)]">
                            <Calendar className="w-4 h-4 mt-0.5" />
                            <span>{formatArticleDate(article.publishedAt ?? article.fetchedAt)}</span>
                        </div>
                    )}

                    {feedTitle && (
                        <div className="flex items-start gap-2 text-[color:var(--color-text-secondary)]">
                            <Globe className="w-4 h-4 mt-0.5" />
                            <span>{feedTitle}</span>
                        </div>
                    )}
                </div>

                {article.url && (
                    <a
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full h-10 rounded-xl border border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] text-sm font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <ExternalLink className="w-4 h-4" />
                        Open Original
                    </a>
                )}
            </div>
        </FloatingPanel>
    );
}
