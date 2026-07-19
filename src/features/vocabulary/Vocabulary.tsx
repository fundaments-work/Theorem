import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    BookOpenText,
    Trash2,
    X,
    ChevronLeft,
} from "lucide-react";
import { cn } from "../../core/lib/utils";
import { sanitizeHtmlForDisplay } from "../../core/lib/sanitize";
import { useVocabularyStore, useUIStore } from "../../core/store";
import type { VocabularyTerm } from "../../core/types";

function getTermPrimaryDefinition(term: VocabularyTerm): string {
    const firstMeaning = term.meanings[0];
    if (!firstMeaning || firstMeaning.definitions.length === 0) {
        return "No definition";
    }
    return firstMeaning.definitions[0];
}

function isHtml(text: string): boolean {
    return text.includes("<") && text.includes(">");
}

export function VocabularyPage() {
    const searchQuery = useUIStore((state) => state.searchQuery);
    const vocabularyTerms = useVocabularyStore((state) => state.vocabularyTerms);
    const deleteVocabularyTerm = useVocabularyStore((state) => state.deleteVocabularyTerm);

    const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
    const [showMobileList, setShowMobileList] = useState(true);

    const filteredTerms = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return vocabularyTerms
            .filter((term) => {
                if (!query) return true;
                if (term.term.toLowerCase().includes(query)) return true;
                return term.meanings.some((m) =>
                    m.definitions.some((d) => d.toLowerCase().includes(query))
                );
            })
            .sort((a, b) => {
                const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.createdAt).getTime();
                const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.createdAt).getTime();
                if (updatedA !== updatedB) return updatedB - updatedA;
                return a.term.localeCompare(b.term);
            });
    }, [searchQuery, vocabularyTerms]);

    const scrollRef = useRef<HTMLDivElement>(null);

    const termsVirtualizer = useVirtualizer({
        count: filteredTerms.length,
        getScrollElement: useCallback(() => scrollRef.current, []),
        estimateSize: useCallback(() => 48, []),
        overscan: 5,
    });

    const selectedTerm = useMemo(() => (
        selectedTermId ? filteredTerms.find((t) => t.id === selectedTermId) || null : null
    ), [filteredTerms, selectedTermId]);

    useEffect(() => {
        if (selectedTermId && !filteredTerms.some((t) => t.id === selectedTermId)) {
            setSelectedTermId(null);
        }
    }, [filteredTerms, selectedTermId]);

    const handleBackToSources = useCallback(() => {
        setShowMobileList(true);
    }, []);

    function handleDeleteTerm(termId: string) {
        deleteVocabularyTerm(termId);
        if (selectedTermId === termId) setSelectedTermId(null);
    }

    if (vocabularyTerms.length === 0) {
        return (
            <div className="mx-auto min-h-full w-full max-w-[var(--layout-content-max-width)] px-4 py-6 pb-[calc(var(--spacing-2xl)+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:py-8 animate-fade-in">
                <div className="mx-auto w-full max-w-[26rem] min-w-0 px-4 sm:px-6 flex flex-col items-center justify-center py-20 text-center">
                    <div className="mb-5 inline-flex h-16 w-16 items-center justify-center border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]">
                        <BookOpenText className="w-6 h-6" />
                    </div>
                    <h2 className="w-full break-words text-balance text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                        No Vocabulary Yet
                    </h2>
                    <p className="mx-auto w-full max-w-[24rem] break-words text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
                        Words and phrases you capture while reading will appear here.
                    </p>
                    <div className="w-full border-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-xs text-[color:var(--color-text-secondary)]">
                        Terms appear here automatically when you save lookups while reading.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex overflow-hidden bg-[var(--color-background)]">
            
            <div className={cn(
                "flex-col bg-[var(--color-background)]",
                "h-full flex-shrink-0 transition-colors duration-300",
                showMobileList ? "flex w-full" : "hidden",
                "md:flex md:w-64 md:border-r md:border-[var(--color-border-subtle)]",
            )}>
                <header className="shrink-0 px-6 pt-8 pb-4">
                    <div>
                        <h1 className="text-xl font-semibold text-[color:var(--color-text-primary)]">Vocabulary</h1>
                        <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">{vocabularyTerms.length} terms{
                            searchQuery ? ` — "${searchQuery}"` : ""
                        }</p>
                    </div>
                </header>

                <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-12 [content-visibility:auto] overscroll-contain">
                    {filteredTerms.length > 0 ? (
                        <div style={{ height: `${termsVirtualizer.getTotalSize()}px`, position: "relative" }}>
                            <div style={{ paddingTop: `${termsVirtualizer.getVirtualItems()[0]?.start ?? 0}px` }}>
                                {termsVirtualizer.getVirtualItems().map((virtualRow) => {
                                    const term = filteredTerms[virtualRow.index];
                                    const isSelected = selectedTermId === term.id;
                                    return (
                                        <button
                                            key={term.id}
                                            data-index={virtualRow.index}
                                            onClick={() => {
                                                setSelectedTermId(isSelected ? null : term.id);
                                                setShowMobileList(false);
                                            }}
                                            className={cn(
                                                "w-full px-3 py-3 text-left transition-colors border-l-2",
                                                isSelected
                                                    ? "border-l-[var(--color-accent)] bg-[var(--color-surface-elevated)]"
                                                    : "border-l-transparent hover:bg-[var(--color-surface-muted)]",
                                            )}
                                        >
                                            <p className={cn("text-sm font-medium truncate",
                                                isSelected ? "text-[color:var(--color-accent)]" : "text-[color:var(--color-text-primary)]",
                                            )}>{term.term}</p>
                                            <p className="mt-0.5 truncate text-[11px] text-[color:var(--color-text-muted)] leading-snug">
                                                {(() => {
                                                    const def = getTermPrimaryDefinition(term);
                                                    return isHtml(def) ? (term.meanings[0]?.partOfSpeech || "Definition") : def;
                                                })()}
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-20 text-center opacity-60">
                            <BookOpenText className="mb-4 h-10 w-10 text-[color:var(--color-text-muted)]" />
                            <p className="text-sm font-medium text-[color:var(--color-text-primary)]">No terms found</p>
                            <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
                                {searchQuery ? "No terms match your search." : "No terms found."}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <div className={cn(
                "flex-col min-w-0 bg-[var(--color-background)]",
                "h-full flex-1 transition-colors duration-300",
                !showMobileList ? "flex" : "hidden",
                "md:flex",
            )}>
                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {selectedTerm ? (
                        <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
                            <div className="flex flex-col h-full overflow-y-auto animate-fade-in [content-visibility:auto] overscroll-contain">
                                <div className="p-6 md:p-8 lg:p-10 max-w-full">
                                    <button
                                        onClick={handleBackToSources}
                                        className="md:hidden mb-4 flex items-center gap-1 text-sm text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                                    >
                                        <ChevronLeft className="w-4 h-4" />
                                        Back to list
                                    </button>

                                    <div className="mb-8 flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <h2 className="text-3xl font-bold text-[color:var(--color-text-primary)] tracking-tight break-words">
                                                {selectedTerm.term}
                                            </h2>
                                            {selectedTerm.phonetic && (
                                                <span className="inline-block mt-2 font-mono text-sm text-[color:var(--color-text-secondary)] bg-[var(--color-surface-muted)] px-2 py-0.5">
                                                    /{selectedTerm.phonetic}/
                                                </span>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => setSelectedTermId(null)}
                                            className="hidden md:flex shrink-0 p-1.5 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
                                            title="Close detail"
                                        >
                                            <X className="w-5 h-5" />
                                        </button>
                                    </div>

                                    <div className="space-y-8 mb-10">
                                        {selectedTerm.meanings.map((meaning, idx) => (
                                            <div key={`${meaning.provider}-${idx}`}>
                                                <div className="flex items-center gap-3 mb-4">
                                                    {meaning.partOfSpeech && (
                                                        <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-accent)] bg-[var(--color-accent)]/10 px-2.5 py-1">
                                                            {meaning.partOfSpeech}
                                                        </span>
                                                    )}
                                                    <span className="text-[10px] uppercase text-[color:var(--color-text-muted)] tracking-wider font-medium">
                                                        {meaning.provider}
                                                    </span>
                                                </div>
                                                <ul className="space-y-2.5">
                                                    {meaning.definitions.slice(0, 5).map((def, i) => (
                                                        <li key={`${i}-${def.slice(0, 40)}`} className="flex gap-3 text-[15px] text-[color:var(--color-text-primary)] leading-relaxed">
                                                            <span className="shrink-0 mt-2.5 h-2 w-2 rounded-full bg-[var(--color-accent)] opacity-40" />
                                                            {isHtml(def) ? (
                                                                <div
                                                                    className="dict-definition min-w-0 break-words"
                                                                    dangerouslySetInnerHTML={sanitizeHtmlForDisplay(def)}
                                                                />
                                                            ) : (
                                                                <span className="min-w-0 break-words">{def}</span>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>

                                    <hr className="border-[var(--color-border-subtle)] mb-8" />

                                    <button
                                        onClick={() => handleDeleteTerm(selectedTerm.id)}
                                        className="ui-btn-danger py-2.5 px-5 text-[11px] font-bold uppercase tracking-wider"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Delete this term
                                    </button>

                                    <div className="h-12 md:hidden" />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="hidden h-full w-full flex-col items-center justify-center text-center p-12 md:flex opacity-30">
                            <BookOpenText className="w-12 h-12 text-[color:var(--color-text-muted)] mb-4" />
                            <p className="text-sm font-medium text-[color:var(--color-text-primary)]">Select a term</p>
                            <p className="text-xs text-[color:var(--color-text-muted)] mt-1 max-w-[16rem]">
                                Browse your collection to view definitions and notes.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
