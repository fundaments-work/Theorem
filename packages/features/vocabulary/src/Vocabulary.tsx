import { useEffect, useMemo, useState, useCallback } from "react";
import {
    BookOpenText,
    BrainCircuit,
    CalendarClock,
    Clock3,
    Hash,
    NotebookPen,
    Save,
    Trash2,
    Plus,
    ArrowLeft,
    LayoutTemplate,
    ChevronRight,
    ChevronLeft,
} from "lucide-react";
import { cn } from "@theorem/core";
import { useLearningStore, useUIStore } from "@theorem/core";
import type { VocabularyContext, VocabularyTerm } from "@theorem/core";

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

function toDisplayDate(value: Date | string | null | undefined): string {
    if (!value) {
        return "Never";
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Never";
    }
    return date.toLocaleDateString();
}

/**
 * Standalone vocabulary workspace with source-based organization and scoped review launcher.
 * Refactored to match FeedsPage layout.
 */
export function VocabularyPage() {
    const searchQuery = useUIStore((state) => state.searchQuery);
    const vocabularyTerms = useLearningStore((state) => state.vocabularyTerms);
    const reviewRecords = useLearningStore((state) => state.reviewRecords);
    const updateVocabularyTerm = useLearningStore((state) => state.updateVocabularyTerm);
    const deleteVocabularyTerm = useLearningStore((state) => state.deleteVocabularyTerm);
    const openReviewSession = useLearningStore((state) => state.openReviewSession);
    const dueVocabularyCount = useLearningStore((state) => (
        state.getDueReviewItems(new Date(), "vocabulary").length
    ));

    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [selectedTermId, setSelectedTermId] = useState<string | null>(null);
    const [draftNote, setDraftNote] = useState("");
    const [draftTags, setDraftTags] = useState("");

    // Mobile View State: 'sources' (sidebar) or 'terms' (content)
    const [showMobileList, setShowMobileList] = useState(true);

    const now = new Date();

    const sourceOptions = useMemo(
        () => buildSourceFilterOptions(vocabularyTerms),
        [vocabularyTerms],
    );

    const reviewRecordByTermId = useMemo(() => {
        const map = new Map<string, (typeof reviewRecords)[number]>();
        for (const record of reviewRecords) {
            if (record.sourceType === "vocabulary") {
                map.set(record.sourceId, record);
            }
        }
        return map;
    }, [reviewRecords]);

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
        return sourceOptions.find(o => o.key === sourceFilter)?.label || "Source";
    }, [sourceFilter, sourceOptions]);

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
        if (selectedTermId && !filteredTerms.some((t) => t.id === selectedTermId)) {
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
    }, [selectedTerm?.id]);

    const handleSelectSource = useCallback((id: string) => {
        setSourceFilter(id);
        setShowMobileList(false);
    }, []);

    const handleBackToSources = useCallback(() => {
        setShowMobileList(true);
    }, []);

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

    // Initial Empty State
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
                        Words and phrases you capture while reading will appear here to help you build your personal lexicon.
                    </p>
                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)] text-[10px] font-bold uppercase tracking-wider border border-[var(--color-border-subtle)]">
                        <Plus className="w-3.5 h-3.5" />
                        <span>Added automatically from reader</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex overflow-hidden bg-[var(--color-background)]">
            {/* Left Sidebar: Sources */}
            <div className={cn(
                "flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]/50",
                "h-full flex-shrink-0 transition-all duration-300",
                showMobileList ? "flex w-full" : "hidden",
                "md:flex md:w-64"
            )}>
                {/* Sidebar Header */}
                <div className="px-4 pt-8 pb-4 flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">
                        Sources
                    </h2>
                </div>

                {/* Source List */}
                <div className="flex-1 overflow-y-auto p-2">
                    <button
                        onClick={() => handleSelectSource("all")}
                        className={cn(
                            "w-full flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors mb-2",
                            sourceFilter === "all"
                                ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)]"
                                : "hover:bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]",
                        )}
                    >
                        <div className={cn(
                            "w-6 h-6 rounded flex items-center justify-center transition-colors",
                            sourceFilter === "all"
                                ? "text-[color:var(--color-accent)]"
                                : "text-[color:var(--color-text-muted)]",
                        )}>
                            <LayoutTemplate className="w-4 h-4" />
                        </div>
                        <span className="text-sm font-medium">All Terms</span>
                    </button>

                    <div className="space-y-0.5">
                        {sourceOptions.map(option => (
                            <button
                                key={option.key}
                                onClick={() => handleSelectSource(option.key)}
                                className={cn(
                                    "group w-full flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors",
                                    sourceFilter === option.key
                                        ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)]"
                                        : "hover:bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)]",
                                    "active:bg-[var(--color-surface-muted)]"
                                )}
                            >
                                <div className={cn(
                                    "w-6 h-6 rounded flex items-center justify-center flex-shrink-0 overlay transition-colors",
                                    sourceFilter === option.key
                                        ? "text-[color:var(--color-accent)]"
                                        : "text-[color:var(--color-text-muted)]",
                                )}>
                                    <BookOpenText className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0 text-left">
                                    <p className="text-sm font-medium truncate">
                                        {option.label}
                                    </p>
                                </div>
                                <span className={cn(
                                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0",
                                    sourceFilter === option.key
                                        ? "bg-[var(--color-accent)] ui-text-accent-contrast"
                                        : "bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)]",
                                )}>
                                    {option.count}
                                </span>
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
                {/* Page Header */}
                <header className="shrink-0 px-6 pt-8 pb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-hidden">
                        {/* Mobile Back Button */}
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
                                {filteredTerms.length} terms {searchQuery ? "matching search" : ""}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => openReviewSession("vocabulary")}
                        disabled={dueVocabularyCount === 0}
                        className={cn(
                            "ui-btn ui-btn-primary",
                            dueVocabularyCount === 0 && "opacity-50 cursor-not-allowed bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)]"
                        )}
                    >
                        <BrainCircuit className="w-4 h-4" />
                        <span className="hidden sm:inline">Review ({dueVocabularyCount})</span>
                        <span className="sm:hidden">Review</span>
                    </button>
                </header>

                {/* Main Content Area: List + Details */}
                <div className="flex-1 flex min-h-0 overflow-hidden">
                    {/* List Pillar */}
                    <div className={cn(
                        "flex flex-col min-w-0 transition-all",
                        "md:w-80 md:flex-none md:border-r md:border-[var(--color-border-subtle)]"
                    )}>
                        <div className="flex-1 overflow-y-auto px-4 pb-12 space-y-1">
                            {filteredTerms.length > 0 ? (
                                filteredTerms.map((term) => {
                                    const isSelected = selectedTermId === term.id;
                                    const reviewRecord = reviewRecordByTermId.get(term.id);
                                    const dueAt = reviewRecord?.dueAt ? new Date(reviewRecord.dueAt) : null;
                                    const isDue = Boolean(dueAt && dueAt.getTime() <= now.getTime());

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
                                                {isDue && (
                                                    <span className="h-2 w-2 rounded-full bg-[var(--color-warning)] shrink-0" title="Due" />
                                                )}
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
                                    <p className="text-xs text-[color:var(--color-text-muted)] mt-1">Try adjusting your filters or search.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Detail Pillar */}
                    <div className={cn(
                        "flex-1 bg-[var(--color-background)]",
                        // Mobile Styles: Fixed overlay
                        "fixed inset-0 z-50 flex flex-col transition-transform duration-300 ease-in-out",
                        selectedTermId ? "translate-x-0" : "translate-x-full",
                        // Desktop Styles: Static pillar
                        "md:static md:translate-x-0 md:bg-transparent"
                    )}>
                        {selectedTerm ? (
                            <div className="flex flex-col h-full overflow-y-auto p-6 animate-fade-in group/detail">
                                {/* Mobile Header for Detail */}
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
                                    {/* Header Section */}
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
                                            {reviewRecordByTermId.get(selectedTerm.id) && (
                                                <span className={cn(
                                                    "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
                                                    reviewRecordByTermId.get(selectedTerm.id)?.dueAt && new Date(reviewRecordByTermId.get(selectedTerm.id)!.dueAt).getTime() <= now.getTime()
                                                        ? "bg-[var(--color-warning)]/20 text-[color:var(--color-warning)]"
                                                        : "bg-[var(--color-success)]/10 text-[color:var(--color-success)]"
                                                )}>
                                                    {reviewRecordByTermId.get(selectedTerm.id)?.dueAt && new Date(reviewRecordByTermId.get(selectedTerm.id)!.dueAt).getTime() <= now.getTime()
                                                        ? "Due Now"
                                                        : "Learned"}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Definitions Section */}
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

                                    {/* Metadata Section */}
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
                                                    className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-background)] px-4 py-3 text-sm placeholder:text-[color:var(--color-text-muted)]/40 focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] min-h-[120px] transition-all"
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
                                                    className="w-full rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-background)] px-4 py-3 text-sm placeholder:text-[color:var(--color-text-muted)]/40 focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] transition-all"
                                                />
                                            </div>

                                            <button
                                                onClick={() => handleSaveMetadata(selectedTerm.id)}
                                                className="w-full ui-btn ui-btn-primary py-3 rounded-xl shadow-sm"
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
                                                        <div key={context.key} className="group/chip flex max-w-full items-center gap-2 px-3 py-2 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/30 transition-all cursor-default">
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
                                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-[color:var(--color-error)] hover:bg-[color:var(--color-error)]/5 transition-all"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                    Delete this term
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="h-20 md:hidden" /> {/* Mobile bottom spacer */}
                                </div>
                            </div>
                        ) : (
                            <div className="hidden h-full flex-col items-center justify-center text-center p-12 md:flex animate-fade-in opacity-40">
                                <div className="w-20 h-20 rounded-3xl bg-[var(--color-surface-muted)] flex items-center justify-center mb-6">
                                    <BookOpenText className="w-10 h-10 text-[color:var(--color-text-muted)]" />
                                </div>
                                <h3 className="text-xl font-semibold text-[color:var(--color-text-primary)] mb-2">Select a term</h3>
                                <p className="text-sm text-[color:var(--color-text-muted)] max-w-xs">
                                    Browse your collection to view definitions, examples, and personal notes.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
