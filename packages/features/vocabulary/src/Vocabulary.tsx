import { useEffect, useMemo, useState, useCallback } from "react";
import {
    BookOpenText,
    Hash,
    NotebookPen,
    Save,
    Trash2,
    ArrowLeft,
    ChevronLeft,
} from "lucide-react";
import { cn } from "@theorem/core";
import { useLearningStore, useUIStore } from "@theorem/core";
import type { VocabularyContext, VocabularyTerm } from "@theorem/core";

interface SourceFilterOption {
    key: string;
    label: string;
    count: number;
    lastSeenAt: Date | null;
}

function getTermPrimaryDefinition(term: VocabularyTerm): string {
    const firstMeaning = term.meanings[0];
    if (!firstMeaning || firstMeaning.definitions.length === 0) {
        return "No definition";
    }
    return firstMeaning.definitions[0];
}

function toValidDate(value: Date | string | null | undefined): Date | null {
    if (!value) {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    return date;
}

function getLatestDate(current: Date | null, incoming: Date | null): Date | null {
    if (!current) {
        return incoming;
    }
    if (!incoming) {
        return current;
    }
    return current.getTime() >= incoming.getTime() ? current : incoming;
}

function buildSourceFilterOptions(terms: VocabularyTerm[]): SourceFilterOption[] {
    const optionMap = new Map<string, SourceFilterOption>();

    for (const term of terms) {
        const seenKeys = new Set<string>();
        for (const context of term.contexts) {
            if (seenKeys.has(context.key)) {
                continue;
            }
            seenKeys.add(context.key);

            const existing = optionMap.get(context.key);
            if (!existing) {
                optionMap.set(context.key, {
                    key: context.key,
                    label: context.label,
                    count: 1,
                    lastSeenAt: toValidDate(context.lastSeenAt),
                });
                continue;
            }

            optionMap.set(context.key, {
                ...existing,
                count: existing.count + 1,
                lastSeenAt: getLatestDate(existing.lastSeenAt, toValidDate(context.lastSeenAt)),
            });
        }
    }

    return Array.from(optionMap.values()).sort((a, b) => {
        const dateDelta = (b.lastSeenAt?.getTime() || 0) - (a.lastSeenAt?.getTime() || 0);
        if (dateDelta !== 0) {
            return dateDelta;
        }
        const countDelta = b.count - a.count;
        if (countDelta !== 0) {
            return countDelta;
        }
        return a.label.localeCompare(b.label);
    });
}

function getContextLabel(context: VocabularyContext): string {
    return context.label || context.sourceId;
}

function toDisplayTimestamp(value: Date | string | null | undefined): string {
    const date = toValidDate(value);
    if (!date) {
        return "Last accessed never";
    }
    return `Last accessed ${date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
    })}`;
}

function toTermCountLabel(count: number): string {
    return `${count} term${count === 1 ? "" : "s"}`;
}

function getNoResultsMessage(searchQuery: string, sourceFilter: string): string {
    if (searchQuery.trim().length > 0 && sourceFilter !== "all") {
        return "No terms match your search in this source.";
    }
    if (searchQuery.trim().length > 0) {
        return "No terms match your search.";
    }
    if (sourceFilter !== "all") {
        return "No terms in this source yet.";
    }
    return "No terms found.";
}

function getSourceButtonClass(isActive: boolean): string {
    return cn(
        "w-full border-2 px-4 py-3 text-left transition-colors",
        isActive
            ? "border-[var(--color-text-primary)] bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]"
            : "border-transparent text-[color:var(--color-text-secondary)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]",
    );
}

/**
 * Standalone vocabulary workspace with source-based organization.
 */
export function VocabularyPage() {
    const searchQuery = useUIStore((state) => state.searchQuery);
    const setSearchQuery = useUIStore((state) => state.setSearchQuery);
    const vocabularyTerms = useLearningStore((state) => state.vocabularyTerms);
    const updateVocabularyTerm = useLearningStore((state) => state.updateVocabularyTerm);
    const deleteVocabularyTerm = useLearningStore((state) => state.deleteVocabularyTerm);

    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
    const [draftNote, setDraftNote] = useState("");
    const [draftTags, setDraftTags] = useState("");

    // Mobile view state: 'sources' (sidebar) or 'terms' (content)
    const [showMobileList, setShowMobileList] = useState(true);

    const sourceOptions = useMemo(
        () => buildSourceFilterOptions(vocabularyTerms),
        [vocabularyTerms],
    );

    const allTermsLastSeenAt = useMemo(() => {
        let latest: Date | null = null;
        for (const option of sourceOptions) {
            latest = getLatestDate(latest, option.lastSeenAt);
        }
        return latest;
    }, [sourceOptions]);

    const filteredTerms = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        return vocabularyTerms
            .filter((term) => {
                if (sourceFilter === "all") {
                    return true;
                }
                return term.contexts.some((context) => context.key === sourceFilter);
            })
            .filter((term) => {
                if (!query) {
                    return true;
                }

                if (term.term.toLowerCase().includes(query)) {
                    return true;
                }

                if (term.meanings.some((meaning) => (
                    meaning.definitions.some((definition) => definition.toLowerCase().includes(query))
                ))) {
                    return true;
                }

                if ((term.personalNote || "").toLowerCase().includes(query)) {
                    return true;
                }

                if (term.tags.some((tag) => tag.toLowerCase().includes(query))) {
                    return true;
                }

                return term.contexts.some((context) => getContextLabel(context).toLowerCase().includes(query));
            })
            .sort((a, b) => {
                const updatedA = a.updatedAt ? new Date(a.updatedAt).getTime() : new Date(a.createdAt).getTime();
                const updatedB = b.updatedAt ? new Date(b.updatedAt).getTime() : new Date(b.createdAt).getTime();
                if (updatedA !== updatedB) {
                    return updatedB - updatedA;
                }
                return a.term.localeCompare(b.term);
            });
    }, [searchQuery, sourceFilter, vocabularyTerms]);

    const selectedTerm = useMemo(() => (
        selectedTermId
            ? filteredTerms.find((term) => term.id === selectedTermId) || null
            : null
    ), [filteredTerms, selectedTermId]);

    const selectedSourceLabel = useMemo(() => {
        if (sourceFilter === "all") return "All Terms";
        return sourceOptions.find((option) => option.key === sourceFilter)?.label || "Source";
    }, [sourceFilter, sourceOptions]);

    const subtitleText = useMemo(() => {
        if (sourceFilter === "all") {
            return `${filteredTerms.length} terms${searchQuery ? " matching search" : ""}`;
        }
        const sourceLabel = sourceOptions.find((option) => option.key === sourceFilter)?.label || "source";
        return `${filteredTerms.length} terms from ${sourceLabel}`;
    }, [filteredTerms.length, searchQuery, sourceFilter, sourceOptions]);

    const hasActiveFilters = searchQuery.trim().length > 0 || sourceFilter !== "all";

    useEffect(() => {
        if (sourceFilter === "all") {
            return;
        }
        const hasOption = sourceOptions.some((option) => option.key === sourceFilter);
        if (!hasOption) {
            setSourceFilter("all");
        }
    }, [sourceFilter, sourceOptions]);

    useEffect(() => {
        if (selectedTermId && !filteredTerms.some((term) => term.id === selectedTermId)) {
            setSelectedTermId(null);
        }
    }, [filteredTerms, selectedTermId]);

    useEffect(() => {
        if (!selectedTerm) {
            setDraftNote("");
            setDraftTags("");
            return;
        }
        setDraftNote(selectedTerm.personalNote || "");
        setDraftTags(selectedTerm.tags.join(", "));
    }, [selectedTerm]);

    const handleSelectSource = useCallback((id: string) => {
        setSourceFilter(id);
        setShowMobileList(false);
    }, []);

    const handleBackToSources = useCallback(() => {
        setShowMobileList(true);
    }, []);

    const handleClearFilters = useCallback(() => {
        setSourceFilter("all");
        setSearchQuery("");
    }, [setSearchQuery]);

    function handleSaveMetadata(termId: string) {
        const tags = draftTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean);

        updateVocabularyTerm(termId, {
            personalNote: draftNote.trim() || undefined,
            tags,
        });
    }

    function handleDeleteTerm(termId: string) {
        deleteVocabularyTerm(termId);
        if (selectedTermId === termId) {
            setSelectedTermId(null);
        }
    }

    if (vocabularyTerms.length === 0) {
        return (
            <div className="ui-page animate-fade-in">
                <div className="ui-empty-state-stack px-4 sm:px-6 flex flex-col items-center justify-center py-20 text-center">
                    <div className="ui-empty-icon">
                        <BookOpenText className="w-6 h-6" />
                    </div>
                    <h2 className="ui-empty-state-title text-lg font-medium text-[color:var(--color-text-primary)] mb-2">
                        No Vocabulary Yet
                    </h2>
                    <p className="ui-empty-state-copy text-[color:var(--color-text-muted)] mb-8 text-sm leading-relaxed">
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
            {/* Left Sidebar: Sources */}
            <div className={cn(
                "flex-col border-r-2 border-[var(--color-border)] bg-[var(--color-surface)]",
                "h-full flex-shrink-0 transition-all duration-300",
                showMobileList ? "flex w-full" : "hidden",
                "md:flex md:w-64"
            )}>
                <div className="px-4 pt-8 pb-4 flex items-center justify-between">
                    <h2 className="text-xs font-semibold tracking-wide text-[color:var(--color-text-muted)]">
                        Sources
                    </h2>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    <button
                        onClick={() => handleSelectSource("all")}
                        className={cn(getSourceButtonClass(sourceFilter === "all"), "mb-3")}
                    >
                        <p className="text-sm font-semibold leading-tight">
                            {`All Terms (${toTermCountLabel(vocabularyTerms.length)})`}
                        </p>
                        <p className="mt-1 text-xs text-[color:var(--color-text-muted)]">
                            {toDisplayTimestamp(allTermsLastSeenAt)}
                        </p>
                    </button>

                    <div className="space-y-2">
                        {sourceOptions.map((option) => (
                            <button
                                key={option.key}
                                onClick={() => handleSelectSource(option.key)}
                                className={getSourceButtonClass(sourceFilter === option.key)}
                            >
                                <p className="text-sm font-semibold leading-tight truncate">
                                    {`${option.label} (${toTermCountLabel(option.count)})`}
                                </p>
                                <p className="mt-1 text-xs text-[color:var(--color-text-muted)] truncate">
                                    {toDisplayTimestamp(option.lastSeenAt)}
                                </p>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right Content: Terms and Details */}
            <div className={cn(
                "flex-col min-w-0 bg-[var(--color-background)]",
                "h-full flex-1 transition-all duration-300",
                !showMobileList ? "flex" : "hidden",
                "md:flex"
            )}>
                <header className="shrink-0 px-6 pt-8 pb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <button
                            onClick={handleBackToSources}
                            className="md:hidden -ml-2 p-1.5 rounded-lg text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>

                        <div>
                            <h1 className="ui-page-title truncate">
                                {selectedSourceLabel}
                            </h1>
                            <p className="ui-page-subtitle">
                                {subtitleText}
                            </p>
                        </div>
                    </div>
                </header>

                <div className="flex-1 flex min-h-0 overflow-hidden">
                    <div className={cn(
                        "flex flex-col min-w-0 transition-all",
                        "md:w-80 md:flex-none md:border-r md:border-[var(--color-border-subtle)]"
                    )}>
                        <div className="flex-1 overflow-y-auto px-4 pb-12 space-y-1">
                            {filteredTerms.length > 0 ? (
                                filteredTerms.map((term) => {
                                    const isSelected = selectedTermId === term.id;

                                    return (
                                        <button
                                            key={term.id}
                                            onClick={() => setSelectedTermId(term.id)}
                                            className={cn(
                                                "w-full rounded-xl px-4 py-4 text-left transition-all",
                                                isSelected
                                                    ? "bg-[var(--color-surface-elevated)] shadow-sm ring-1 ring-[var(--color-border-subtle)]"
                                                    : "hover:bg-[var(--color-surface-muted)]/50"
                                            )}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className={cn(
                                                    "font-semibold truncate text-sm md:text-base",
                                                    isSelected ? "text-[color:var(--color-accent)]" : "text-[color:var(--color-text-primary)]"
                                                )}>
                                                    {term.term}
                                                </span>
                                            </div>
                                            <p className="mt-1 truncate text-xs text-[color:var(--color-text-secondary)] opacity-80 leading-snug">
                                                {getTermPrimaryDefinition(term)}
                                            </p>
                                        </button>
                                    );
                                })
                            ) : (
                                <div className="flex flex-col items-center justify-center py-20 text-center opacity-60">
                                    <BookOpenText className="mb-4 h-12 w-12 text-[color:var(--color-text-muted)]" />
                                    <p className="text-sm font-medium text-[color:var(--color-text-primary)]">No terms found</p>
                                    <p className="text-xs text-[color:var(--color-text-muted)] mt-1">{getNoResultsMessage(searchQuery, sourceFilter)}</p>
                                    {hasActiveFilters && (
                                        <button
                                            onClick={handleClearFilters}
                                            className="mt-4 ui-btn ui-btn-ghost px-4 py-2 text-xs"
                                        >
                                            Clear search and filters
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className={cn(
                        "flex-1 bg-[var(--color-background)]",
                        "fixed inset-0 z-50 flex flex-col transition-transform duration-300 ease-in-out",
                        selectedTermId ? "translate-x-0" : "translate-x-full",
                        "md:static md:translate-x-0 md:bg-transparent"
                    )}>
                        {selectedTerm ? (
                            <div className="flex flex-col h-full overflow-y-auto p-6 animate-fade-in group/detail">
                                <div className="mb-6 flex items-center gap-3 md:hidden">
                                    <button
                                        onClick={() => setSelectedTermId(null)}
                                        className="p-2 -ml-2 rounded-lg text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                                    >
                                        <ChevronLeft className="w-6 h-6" />
                                    </button>
                                    <span className="text-sm font-medium text-[color:var(--color-text-secondary)]">Back to list</span>
                                </div>

                                <div className="max-w-3xl space-y-8">
                                    <div>
                                        <h2 className="text-4xl font-bold text-[color:var(--color-text-primary)] tracking-tight">
                                            {selectedTerm.term}
                                        </h2>
                                        <div className="mt-3 flex flex-wrap items-center gap-3">
                                            {selectedTerm.phonetic && (
                                                <span className="font-mono text-sm text-[color:var(--color-text-secondary)] bg-[var(--color-surface-muted)] px-2 py-1 rounded-md">
                                                    /{selectedTerm.phonetic}/
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        {selectedTerm.meanings.map((meaning, idx) => (
                                            <div key={`${meaning.provider}-${idx}`} className="space-y-3">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-accent)] bg-[var(--color-accent)]/5 px-2 py-1 rounded">
                                                        {meaning.partOfSpeech}
                                                    </span>
                                                    <span className="text-[10px] uppercase text-[color:var(--color-text-muted)] font-semibold tracking-wider opacity-60">
                                                        {meaning.provider}
                                                    </span>
                                                </div>
                                                <ul className="space-y-4">
                                                    {meaning.definitions.slice(0, 4).map((def) => (
                                                        <li key={def} className="flex gap-4 text-base text-[color:var(--color-text-primary)] leading-relaxed">
                                                            <span className="shrink-0 text-[color:var(--color-accent)] mt-2.5 h-1.5 w-1.5 rounded-full bg-current opacity-30" />
                                                            <span>{def}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>

                                    <hr className="border-[var(--color-border-subtle)]" />

                                    <div className="grid gap-6 sm:grid-cols-2">
                                        <div className="space-y-4 rounded-2xl bg-[var(--color-surface-muted)]/40 p-5">
                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[color:var(--color-text-muted)]">
                                                    <NotebookPen className="w-3.5 h-3.5" />
                                                    Personal Notes
                                                </label>
                                                <textarea
                                                    value={draftNote}
                                                    onChange={(e) => setDraftNote(e.target.value)}
                                                    placeholder="Add mnemonics, examples, or context..."
                                                    className="ui-input w-full min-h-[120px] px-4 py-3 text-sm placeholder:text-[color:var(--color-text-muted)]/40"
                                                />
                                            </div>

                                            <div className="space-y-2">
                                                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[color:var(--color-text-muted)]">
                                                    <Hash className="w-3.5 h-3.5" />
                                                    Tags
                                                </label>
                                                <input
                                                    value={draftTags}
                                                    onChange={(e) => setDraftTags(e.target.value)}
                                                    placeholder="difficult, medical, etc."
                                                    className="ui-input w-full px-4 py-3 text-sm placeholder:text-[color:var(--color-text-muted)]/40"
                                                />
                                            </div>

                                            <button
                                                onClick={() => handleSaveMetadata(selectedTerm.id)}
                                                className="w-full ui-btn ui-btn-primary py-3"
                                            >
                                                <Save className="w-4 h-4" />
                                                <span>Save Changes</span>
                                            </button>
                                        </div>

                                        <div className="space-y-6">
                                            <div>
                                                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[color:var(--color-text-muted)]">Found in sources</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {selectedTerm.contexts.map((context) => (
                                                        <div key={context.key} className="group/chip flex max-w-full items-center gap-2 px-3 py-2 border-2 border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/30 transition-all cursor-default">
                                                            <BookOpenText className="w-3.5 h-3.5 text-[color:var(--color-text-muted)] group-hover/chip:text-[color:var(--color-accent)] transition-colors" />
                                                            <span className="truncate text-xs text-[color:var(--color-text-secondary)] font-medium">
                                                                {getContextLabel(context)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="pt-4 border-t border-[var(--color-border-subtle)]/50">
                                                <button
                                                    onClick={() => handleDeleteTerm(selectedTerm.id)}
                                                    className="w-full ui-btn ui-btn-danger py-3 text-xs font-bold uppercase tracking-wider"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                    Delete this term
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="h-20 md:hidden" />
                                </div>
                            </div>
                        ) : (
                            <div className="hidden h-full flex-col items-center justify-center text-center p-12 md:flex animate-fade-in opacity-40">
                                <div className="w-20 h-20 rounded-3xl bg-[var(--color-surface-muted)] flex items-center justify-center mb-6">
                                    <BookOpenText className="w-10 h-10 text-[color:var(--color-text-muted)]" />
                                </div>
                                <h3 className="text-xl font-semibold text-[color:var(--color-text-primary)] mb-2">Select a term</h3>
                                <p className="text-sm text-[color:var(--color-text-muted)] max-w-xs">
                                    Browse your collection to view definitions and notes.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
