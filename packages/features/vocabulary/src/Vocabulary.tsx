import { useEffect, useMemo, useState } from "react";
import { BookOpenText, BrainCircuit, ChevronDown, Save, Trash2 } from "lucide-react";
import { cn } from "@lionreader/core";
import { useLearningStore, useUIStore } from "@lionreader/core";
import type { VocabularyContext, VocabularyTerm } from "@lionreader/core";

interface SourceFilterOption {
    key: string;
    label: string;
    count: number;
}

function getTermPrimaryDefinition(term: VocabularyTerm): string {
    const firstMeaning = term.meanings[0];
    if (!firstMeaning || firstMeaning.definitions.length === 0) {
        return "No definition";
    }
    return firstMeaning.definitions[0];
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
                });
                continue;
            }

            optionMap.set(context.key, {
                ...existing,
                count: existing.count + 1,
            });
        }
    }

    return Array.from(optionMap.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function getContextLabel(context: VocabularyContext): string {
    return context.label || context.sourceId;
}

/**
 * Standalone vocabulary workspace with source-based organization and scoped review launcher.
 */
export function VocabularyPage() {
    const searchQuery = useUIStore((state) => state.searchQuery);
    const vocabularyTerms = useLearningStore((state) => state.vocabularyTerms);
    const updateVocabularyTerm = useLearningStore((state) => state.updateVocabularyTerm);
    const deleteVocabularyTerm = useLearningStore((state) => state.deleteVocabularyTerm);
    const openReviewSession = useLearningStore((state) => state.openReviewSession);
    const dueVocabularyCount = useLearningStore((state) => (
        state.getDueReviewItems(new Date(), "vocabulary").length
    ));

    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [expandedTermId, setExpandedTermId] = useState<string | null>(null);
    const [draftNote, setDraftNote] = useState("");
    const [draftTags, setDraftTags] = useState("");

    const sourceOptions = useMemo(
        () => buildSourceFilterOptions(vocabularyTerms),
        [vocabularyTerms],
    );

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

    const expandedTerm = useMemo(() => (
        expandedTermId
            ? vocabularyTerms.find((term) => term.id === expandedTermId) || null
            : null
    ), [expandedTermId, vocabularyTerms]);

    useEffect(() => {
        if (!expandedTerm) {
            setDraftNote("");
            setDraftTags("");
            return;
        }
        setDraftNote(expandedTerm.personalNote || "");
        setDraftTags(expandedTerm.tags.join(", "));
    }, [expandedTerm?.id]);

    useEffect(() => {
        if (sourceFilter === "all") {
            return;
        }
        const hasOption = sourceOptions.some((option) => option.key === sourceFilter);
        if (!hasOption) {
            setSourceFilter("all");
        }
    }, [sourceFilter, sourceOptions]);

    function toggleExpanded(term: VocabularyTerm) {
        if (expandedTermId === term.id) {
            setExpandedTermId(null);
            return;
        }
        setExpandedTermId(term.id);
    }

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
        if (expandedTermId === termId) {
            setExpandedTermId(null);
        }
    }

    return (
        <div className="ui-page animate-fade-in space-y-6">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="ui-page-title">Vocabulary</h1>
                    <p className="ui-page-subtitle">
                        {vocabularyTerms.length} term{vocabularyTerms.length === 1 ? "" : "s"} tracked across sources.
                    </p>
                </div>

                <button
                    onClick={() => openReviewSession("vocabulary")}
                    disabled={dueVocabularyCount === 0}
                    className={cn(
                        "inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                        dueVocabularyCount > 0
                            ? "bg-[var(--color-accent)] ui-text-accent-contrast"
                            : "bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)]",
                    )}
                >
                    <BrainCircuit className="h-4 w-4" />
                    Review Vocabulary
                    <span className="rounded-full bg-[var(--color-overlay-subtle)] px-2 py-0.5 text-xs">
                        {dueVocabularyCount}
                    </span>
                </button>
            </header>

            <section className="ui-card p-4">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => setSourceFilter("all")}
                        className={cn(
                            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                            sourceFilter === "all"
                                ? "border-[var(--color-accent)] bg-[var(--color-accent)] ui-text-accent-contrast"
                                : "border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-secondary)]",
                        )}
                    >
                        All Sources ({vocabularyTerms.length})
                    </button>

                    {sourceOptions.map((option) => (
                        <button
                            key={option.key}
                            onClick={() => setSourceFilter(option.key)}
                            className={cn(
                                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                sourceFilter === option.key
                                    ? "border-[var(--color-accent)] bg-[var(--color-accent)] ui-text-accent-contrast"
                                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-secondary)]",
                            )}
                            title={option.label}
                        >
                            {option.label} ({option.count})
                        </button>
                    ))}
                </div>

                <div className="space-y-2">
                    {filteredTerms.map((term) => {
                        const isExpanded = expandedTermId === term.id;
                        return (
                            <article
                                key={term.id}
                                className={cn(
                                    "rounded-xl border px-4 py-3 transition-colors",
                                    isExpanded
                                        ? "border-[var(--color-accent)] bg-[var(--color-accent)]/8"
                                        : "border-[var(--color-border)] bg-[var(--color-surface)]",
                                )}
                            >
                                <button
                                    onClick={() => toggleExpanded(term)}
                                    className="flex w-full items-start justify-between gap-3 text-left"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate font-semibold text-[color:var(--color-text-primary)]">
                                            {term.term}
                                        </p>
                                        <p className="truncate text-xs text-[color:var(--color-text-muted)]">
                                            {getTermPrimaryDefinition(term)}
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            {term.contexts.map((context) => (
                                                <span
                                                    key={context.key}
                                                    className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[11px] text-[color:var(--color-text-secondary)]"
                                                >
                                                    {getContextLabel(context)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <ChevronDown
                                        className={cn(
                                            "mt-1 h-4 w-4 flex-shrink-0 text-[color:var(--color-text-muted)] transition-transform",
                                            isExpanded && "rotate-180",
                                        )}
                                    />
                                </button>

                                {isExpanded && (
                                    <div className="mt-4 space-y-4 border-t border-[var(--color-border)] pt-4 animate-fade-in">
                                        {term.phonetic && (
                                            <p className="text-xs text-[color:var(--color-text-muted)]">/{term.phonetic}/</p>
                                        )}

                                        <div className="space-y-2">
                                            {term.meanings.map((meaning, idx) => (
                                                <div
                                                    key={`${meaning.provider}-${idx}`}
                                                    className="rounded-lg bg-[var(--color-surface-muted)] p-3"
                                                >
                                                    <p className="text-xs font-semibold uppercase text-[color:var(--color-text-muted)]">
                                                        {meaning.partOfSpeech || "Meaning"} • {meaning.provider}
                                                    </p>
                                                    <ul className="mt-1 space-y-1 text-sm text-[color:var(--color-text-primary)]">
                                                        {meaning.definitions.slice(0, 4).map((definition) => (
                                                            <li key={definition}>• {definition}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs font-medium text-[color:var(--color-text-secondary)]">
                                                Personal note
                                            </label>
                                            <textarea
                                                value={draftNote}
                                                onChange={(event) => setDraftNote(event.target.value)}
                                                className="min-h-24 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-xs font-medium text-[color:var(--color-text-secondary)]">
                                                Tags
                                            </label>
                                            <input
                                                value={draftTags}
                                                onChange={(event) => setDraftTags(event.target.value)}
                                                placeholder="root, noun, essay"
                                                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm"
                                            />
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                onClick={() => handleSaveMetadata(term.id)}
                                                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm ui-text-accent-contrast"
                                            >
                                                <Save className="h-4 w-4" />
                                                Save Metadata
                                            </button>

                                            <button
                                                onClick={() => handleDeleteTerm(term.id)}
                                                className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-error)]/10 px-3 py-1.5 text-sm text-[color:var(--color-error)]"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                Delete Term
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </article>
                        );
                    })}

                    {filteredTerms.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-10 text-center">
                            <BookOpenText className="mb-3 h-8 w-8 text-[color:var(--color-text-muted)]" />
                            <p className="text-sm text-[color:var(--color-text-secondary)]">
                                No vocabulary terms match this view yet.
                            </p>
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
