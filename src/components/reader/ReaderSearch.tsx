/**
 * ReaderSearch Component
 * Panel for searching within the book content
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Backdrop, FloatingPanel } from '@/components/ui';

interface SearchMatch {
    cfi: string;
    excerpt: string;
}

interface ReaderSearchProps {
    visible: boolean;
    onClose: () => void;
    onNavigate: (location: string) => void;
    onSearch: (query: string) => AsyncGenerator<any>;
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
    const [results, setResults] = useState<SearchMatch[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [progress, setProgress] = useState(0);
    const searchRef = useRef(0);
    const inputRef = useRef<HTMLInputElement>(null);

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
        if (!query.trim()) return;

        setIsSearching(true);
        setResults([]);
        setProgress(0);
        searchRef.current++;
        const currentSearchId = searchRef.current;

        try {
            const iter = onSearch(query);
            for await (const result of iter) {
                if (currentSearchId !== searchRef.current) break;

                if (result === 'done') {
                    setProgress(100);
                    break;
                } else if (result.progress !== undefined) {
                    setProgress(Math.round(result.progress * 100));
                } else if (result.cfi) {
                    setResults(prev => [...prev, result as SearchMatch]);
                }
            }
        } catch (err) {
            console.error('Search error:', err);
        } finally {
            if (currentSearchId === searchRef.current) {
                setIsSearching(false);
            }
        }
    }, [query, onSearch]);

    const handleClear = useCallback(() => {
        setQuery('');
        setResults([]);
        setIsSearching(false);
        setProgress(0);
        searchRef.current++;
        onClearSearch();
    }, [onClearSearch]);

    const handleNavigate = useCallback((cfi: string) => {
        onNavigate(cfi);
    }, [onNavigate]);

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={cn('flex flex-col overflow-hidden', className)}>
                {/* Header/Search Input */}
                <div className="reader-panel-header px-4 pt-4 pb-3">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Search</h2>
                        <button
                            onClick={onClose}
                            className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80"
                            aria-label="Close search"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <form onSubmit={handleSearch} className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search in book..."
                            className="w-full h-10 pl-10 pr-10 bg-[var(--color-background)] rounded-xl text-sm border-2 border-transparent focus:border-[var(--color-accent)] transition-colors outline-none text-[var(--color-text-primary)]"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-[var(--color-surface-muted)] transition-colors text-[var(--color-text-muted)]"
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
                        <div className="flex flex-col items-center justify-center py-12 px-6 text-center opacity-50">
                            <Search className="w-8 h-8 mb-3" />
                            <p className="text-xs font-medium">Find words, names or phrases</p>
                        </div>
                    )}

                    {query && isSearching && results.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent)] mb-3" />
                            <p className="text-xs text-[var(--color-text-muted)]">Scanning book... {progress}%</p>
                        </div>
                    )}

                    {query && !isSearching && results.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12 px-6 text-center opacity-70">
                            <h3 className="text-sm font-semibold mb-1">No results found</h3>
                            <p className="text-xs text-[var(--color-text-muted)]">Try a different search term</p>
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
                                    className="text-[var(--font-size-caption)] text-[var(--color-text-secondary)] line-clamp-3 leading-relaxed"
                                    dangerouslySetInnerHTML={{
                                        __html: result.excerpt.replace(
                                            new RegExp(`(${query})`, 'gi'),
                                            '<span class="bg-[var(--color-accent)]/20 text-[var(--color-accent)] font-bold">$1</span>'
                                        )
                                    }}
                                />
                                <div className="flex items-center gap-1.5 text-[var(--font-size-3xs)] text-[var(--color-accent)] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span>Jump to match</span>
                                    <ChevronRight className="w-3 h-3" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {results.length > 0 && (
                    <div className="reader-panel-footer p-3 bg-[var(--color-background)]">
                        <p className="text-[var(--font-size-3xs)] font-bold text-[var(--color-text-muted)] text-center uppercase tracking-widest">
                            {results.length} {results.length === 1 ? 'Result' : 'Results'} found
                        </p>
                    </div>
                )}
            </FloatingPanel>
        </>
    );
}

export default ReaderSearch;
