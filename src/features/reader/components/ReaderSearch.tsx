/**
 * ReaderSearch Component
 * Panel for searching within the book content
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2, ChevronRight } from 'lucide-react';
import { cn } from "../../../core";
import { Backdrop, FloatingPanel } from "../../../ui";

export interface ReaderSearchMatch {
    cfi: string;
    excerpt: string;
}

export interface ReaderSearchProgress {
    progress: number;
}

export type ReaderSearchEvent = ReaderSearchMatch | ReaderSearchProgress | 'done';

const LIVE_SEARCH_DEBOUNCE_MS = 220;

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function highlightExcerpt(excerpt: string, query: string): string {
    const safeExcerpt = escapeHtml(excerpt);
    const safeQuery = escapeHtml(query.trim());

    if (!safeQuery) {
        return safeExcerpt;
    }

    if (!safeExcerpt.toLowerCase().includes(safeQuery.toLowerCase())) {
        return safeExcerpt;
    }

    const queryRegex = new RegExp(`(${escapeRegExp(safeQuery)})`, "gi");
    return safeExcerpt.replace(
        queryRegex,
        '<span class="bg-[var(--color-accent)]/20 text-[color:var(--color-accent)] font-bold">$1</span>',
    );
}

interface ReaderSearchProps {
    visible: boolean;
    onClose: () => void;
    onNavigate: (location: string) => void;
    onSearch: (query: string) => AsyncGenerator<ReaderSearchEvent>;
    onClearSearch: () => void;
    className?: string;
}

export function ReaderSearch({
    visible,
    onClose,
    onNavigate,
    onSearch,
    onClearSearch,
    className,
}: ReaderSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<ReaderSearchMatch[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [progress, setProgress] = useState(0);
    const searchRef = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const onSearchRef = useRef(onSearch);
    const onClearSearchRef = useRef(onClearSearch);
    const liveSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        onSearchRef.current = onSearch;
    }, [onSearch]);

    useEffect(() => {
        onClearSearchRef.current = onClearSearch;
    }, [onClearSearch]);

    const clearLiveSearchTimer = useCallback(() => {
        if (liveSearchTimerRef.current) {
            clearTimeout(liveSearchTimerRef.current);
            liveSearchTimerRef.current = null;
        }
    }, []);

    const runSearch = useCallback(async (searchQuery: string) => {
        const normalizedQuery = searchQuery.trim();
        if (!normalizedQuery) return;

        setIsSearching(true);
        setResults([]);
        setProgress(0);
        searchRef.current++;
        const currentSearchId = searchRef.current;

        try {
            const iter = onSearchRef.current(normalizedQuery);
            for await (const result of iter) {
                if (currentSearchId !== searchRef.current) break;

                if (result === 'done') {
                    setProgress(100);
                    break;
                } else if (typeof result === 'object' && result !== null && 'progress' in result) {
                    setProgress(Math.round(result.progress * 100));
                } else if (typeof result === 'object' && result !== null && 'cfi' in result) {
                    setResults(prev => [...prev, result]);
                }
            }
        } catch (err) {
            console.error('Search error:', err);
        } finally {
            if (currentSearchId === searchRef.current) {
                setIsSearching(false);
            }
        }
    }, []);

    // Focus input when visible
    useEffect(() => {
        if (visible) {
            const timer = setTimeout(() => inputRef.current?.focus(), 100);
            return () => clearTimeout(timer);
        } else {
            handleClear();
        }
    }, [visible]);

    const handleSearch = useCallback(async (e?: React.FormEvent) => {
        e?.preventDefault();
        const normalizedQuery = query.trim();
        if (!normalizedQuery) return;
        clearLiveSearchTimer();
        await runSearch(normalizedQuery);
    }, [clearLiveSearchTimer, query, runSearch]);

    const handleClear = useCallback(() => {
        clearLiveSearchTimer();
        setQuery('');
        setResults([]);
        setIsSearching(false);
        setProgress(0);
        searchRef.current++;
        onClearSearchRef.current();
    }, [clearLiveSearchTimer]);

    const handleNavigate = useCallback((cfi: string) => {
        onNavigate(cfi);
    }, [onNavigate]);

    useEffect(() => {
        clearLiveSearchTimer();
        if (!visible) {
            return;
        }

        const normalizedQuery = query.trim();
        if (!normalizedQuery) {
            setResults([]);
            setIsSearching(false);
            setProgress(0);
            searchRef.current++;
            onClearSearchRef.current();
            return;
        }

        liveSearchTimerRef.current = setTimeout(() => {
            liveSearchTimerRef.current = null;
            void runSearch(normalizedQuery);
        }, LIVE_SEARCH_DEBOUNCE_MS);

        return clearLiveSearchTimer;
    }, [clearLiveSearchTimer, query, runSearch, visible]);

    useEffect(() => {
        return clearLiveSearchTimer;
    }, [clearLiveSearchTimer]);

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={cn('flex flex-col overflow-hidden', className)}>
                {/* Header/Search Input */}
                <div className="reader-panel-header px-4 pt-4 pb-3">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">Search</h2>
                        <button
                            onClick={onClose}
                            className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80"
                            aria-label="Close search"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <form onSubmit={handleSearch} className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-text-muted)]" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search in document..."
                            className="w-full h-10 pl-10 pr-10 bg-[var(--color-background)] rounded-xl text-sm border-2 border-transparent focus:border-[var(--color-accent)] transition-colors outline-none text-[color:var(--color-text-primary)]"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-[var(--color-surface-muted)] transition-colors text-[color:var(--color-text-muted)]"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </form>
                </div>

                {/* Progress Bar */}
                {isSearching && (
                    <div className="h-1 bg-[var(--color-background)] overflow-hidden">
                        <div
                            className="h-full bg-[var(--color-accent)] transition-[width] duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto p-2 sm:p-3 custom-scrollbar">
                    {!query && !isSearching && results.length === 0 && (
                        <div className="w-full flex flex-col items-center justify-center py-12 px-6 text-center opacity-50">
                            <Search className="w-8 h-8 mb-3" />
                            <p className="w-full max-w-[15rem] text-xs font-medium leading-relaxed">Find words, names or phrases</p>
                        </div>
                    )}

                    {query && isSearching && results.length === 0 && (
                        <div className="w-full flex flex-col items-center justify-center py-12 px-6 text-center">
                            <Loader2 className="w-6 h-6 animate-spin text-[color:var(--color-accent)] mb-3" />
                            <p className="w-full max-w-[15rem] text-xs text-[color:var(--color-text-muted)] leading-relaxed">Scanning content... {progress}%</p>
                        </div>
                    )}

                    {query && !isSearching && results.length === 0 && (
                        <div className="w-full flex flex-col items-center justify-center py-12 px-6 text-center opacity-70">
                            <h3 className="text-sm font-semibold mb-1">No results found</h3>
                            <p className="w-full max-w-[15rem] text-xs text-[color:var(--color-text-muted)] leading-relaxed">Try a different search term</p>
                        </div>
                    )}

                    <div className="space-y-1">
                        {results.map((result, index) => (
                            <button
                                key={index}
                                onClick={() => handleNavigate(result.cfi)}
                                className="w-full flex flex-col gap-1 p-3 rounded-xl hover:bg-[var(--color-background)] transition-colors text-left group"
                            >
                                <p
                                    className="text-[var(--font-size-caption)] text-[color:var(--color-text-secondary)] line-clamp-3 leading-relaxed"
                                    dangerouslySetInnerHTML={{
                                        __html: highlightExcerpt(result.excerpt, query),
                                    }}
                                />
                                <div className="flex items-center gap-1.5 text-[var(--font-size-3xs)] text-[color:var(--color-accent)] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span>Jump to match</span>
                                    <ChevronRight className="w-3 h-3" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {results.length > 0 && (
                    <div className="reader-panel-footer p-3 bg-[var(--color-background)]">
                        <p className="text-[var(--font-size-3xs)] font-bold text-[color:var(--color-text-muted)] text-center uppercase tracking-widest">
                            {results.length} {results.length === 1 ? 'Result' : 'Results'} found
                        </p>
                    </div>
                )}
            </FloatingPanel>
        </>
    );
}

export default ReaderSearch;
