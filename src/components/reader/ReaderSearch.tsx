/**
 * ReaderSearch Component
 * Panel for searching within the book content
 */

import { useState, useRef, useEffect } from 'react';
import { Search, X, Loader2, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchMatch {
    cfi: string;
    excerpt: string;
}

interface ReaderSearchProps {
    visible: boolean;
    onClose: () => void;
    onNavigate: (location: string) => void;
    // We pass the search functions from the parent because they come from the engine ref
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
    const searchRef = useRef<number>(0);

    // Focus input when visible
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (visible) {
            setTimeout(() => inputRef.current?.focus(), 100);
        } else {
            // Clear search highlights when hidden
            handleClear();
        }
    }, [visible]);

    const handleSearch = async (e?: React.FormEvent) => {
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
                // If a new search started, stop this one
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
    };

    const handleClear = () => {
        setQuery('');
        setResults([]);
        setIsSearching(false);
        setProgress(0);
        searchRef.current++;
        onClearSearch();
    };

    return (
        <>
            {/* Backdrop */}
            {visible && (
                <div
                    className="fixed inset-0 z-40 bg-black/5"
                    onClick={onClose}
                />
            )}

            {/* Panel */}
            <div
                className={cn(
                    'fixed top-16 right-6 w-80 max-w-[calc(100vw-3rem)] z-50',
                    'bg-[var(--color-surface)] rounded-2xl shadow-2xl flex flex-col',
                    'border border-[var(--color-border)]',
                    'transform transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-top-right',
                    visible
                        ? 'opacity-100 scale-100 translate-y-0'
                        : 'opacity-0 scale-95 -translate-y-2 pointer-events-none',
                    className
                )}
            >
                {/* Header/Search Input */}
                <div className="p-4 border-b border-[var(--color-border)]">
                    <form onSubmit={handleSearch} className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search in book..."
                            className="w-full h-10 pl-10 pr-10 bg-[var(--color-background)] rounded-xl text-sm border-2 border-transparent focus:border-[var(--color-accent)] transition-all outline-none text-[var(--color-text-primary)]"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={handleClear}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg hover:bg-[var(--color-border-subtle)] transition-colors text-[var(--color-text-muted)]"
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
                            className="h-full bg-[var(--color-accent)] transition-all duration-300"
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-2 custom-scrollbar max-h-[60vh]">
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
                                onClick={() => {
                                    onNavigate(result.cfi);
                                    // Don't close so they can see other results
                                }}
                                className="w-full flex flex-col gap-1 p-3 rounded-xl hover:bg-[var(--color-background)] transition-all text-left group"
                            >
                                <p
                                    className="text-[13px] text-[var(--color-text-secondary)] line-clamp-3 leading-relaxed"
                                    dangerouslySetInnerHTML={{
                                        __html: result.excerpt.replace(
                                            new RegExp(`(${query})`, 'gi'),
                                            '<span class="bg-[var(--color-accent)]/20 text-[var(--color-accent)] font-bold">$1</span>'
                                        )
                                    }}
                                />
                                <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-accent)] font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
                                    <span>Jump to match</span>
                                    <ChevronRight className="w-3 h-3" />
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {results.length > 0 && (
                    <div className="p-3 border-t border-[var(--color-border)] bg-[var(--color-background)] rounded-b-2xl">
                        <p className="text-[10px] font-bold text-[var(--color-text-muted)] text-center uppercase tracking-widest">
                            {results.length} {results.length === 1 ? 'Result' : 'Results'} found
                        </p>
                    </div>
                )}
            </div>
        </>
    );
}

export default ReaderSearch;
