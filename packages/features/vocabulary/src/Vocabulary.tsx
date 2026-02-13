import { useEffect, useMemo, useState } from "react";
import {
    BookOpenText,
    BrainCircuit,
    CalendarClock,
    Clock3,
    Hash,
    NotebookPen,
    Save,
    Trash2,
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

    const reviewedTermCount = useMemo(
        () => Array.from(reviewRecordByTermId.values()).filter((record) => record.reviewCount > 0).length,
        [reviewRecordByTermId],
    );
    const scheduledTermCount = reviewRecordByTermId.size;
    const unscheduledTermCount = Math.max(0, vocabularyTerms.length - scheduledTermCount);

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

    useEffect(() => {
        if (sourceFilter === "all") {
            return;
        }
        const hasOption = sourceOptions.some((option) => option.key === sourceFilter);
        if (!hasOption) {
            setSourceFilter("all");
        }
    }, [sourceFilter, sourceOptions]);

    /* Removed auto-select logic to keep the UI cleaner/minimal – only select if user interactions demands it or we want a default state. 
       Actually, for a Master-Detail view, it's often nice to not have anything selected initially, or select the first one. 
       The user said "when clicked it should open detail". Does it mean it's closed initially?
       I'll leave it null initially unless user clicks, essentially making the detail pane closable or empty.
       But I'll keep the `useEffect` that clears selection if the validated term is gone.
    */
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

    return (
        <div className="ui-page animate-fade-in flex h-[calc(100vh-6rem)] flex-col gap-6 pb-4 md:pb-0">
            {/* Unified Header */}
            <header className="shrink-0 flex items-center justify-between">
                <div>
                    <h1 className="ui-page-title">
                        Vocabulary
                    </h1>
                    <p className="ui-page-subtitle">
                        {vocabularyTerms.length} {vocabularyTerms.length === 1 ? 'term' : 'terms'} captured
                    </p>
                </div>

                <button
                    onClick={() => openReviewSession("vocabulary")}
                    disabled={dueVocabularyCount === 0}
                    className={cn(
                        "ui-btn ui-btn-primary",
                        dueVocabularyCount === 0 && "opacity-50 cursor-not-allowed bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)]"
                    )}
                >
                    <BrainCircuit className="h-4 w-4" />
                    <span className="hidden sm:inline">Review ({dueVocabularyCount})</span>
                    <span className="sm:hidden">Review</span>
                </button>
            </header>

            {/* Main Content Layout */}
            <div className="flex min-h-0 flex-1 md:gap-6">

                {/* Column 1: Sources (Desktop Sidebar) */}
                <aside className="hidden md:flex w-48 shrink-0 flex-col gap-1 overflow-y-auto pr-2 lg:w-56">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">
                        Sources
                    </h3>
                    <button
                        onClick={() => setSourceFilter("all")}
                        className={cn(
                            "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                            sourceFilter === "all"
                                ? "bg-[var(--color-surface-elevated)] text-[color:var(--color-text-primary)] font-medium shadow-sm"
                                : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                        )}
                    >
                        <span>All Sources</span>
                        <span className="text-xs text-[color:var(--color-text-muted)] opacity-70">{vocabularyTerms.length}</span>
                    </button>

                    <div className="space-y-0.5">
                        {sourceOptions.map((option) => (
                            <button
                                key={option.key}
                                onClick={() => setSourceFilter(option.key)}
                                className={cn(
                                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors group",
                                    sourceFilter === option.key
                                        ? "bg-[var(--color-surface-elevated)] text-[color:var(--color-text-primary)] font-medium shadow-sm"
                                        : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                                )}
                                title={option.label}
                            >
                                <span className="truncate pr-2 text-left">{option.label}</span>
                                <span className={cn(
                                    "text-xs",
                                    sourceFilter === option.key ? "text-[color:var(--color-text-primary)]" : "text-[color:var(--color-text-muted)]"
                                )}>
                                    {option.count}
                                </span>
                            </button>
                        ))}
                    </div>
                </aside>

                {/* Column 2: Vocabulary List (Mobile: Main View, Desktop: Middle Col) */}
                <main className={cn(
                    "flex flex-1 flex-col min-w-0 transition-all",
                    "md:w-72 md:flex-none md:border-l md:border-[var(--color-border-subtle)] md:pl-6"
                )}>
                    {/* Mobile Source Filters (Horizontal Scroll) */}
                    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 no-scrollbar md:hidden">
                        <button
                            onClick={() => setSourceFilter("all")}
                            className={cn(
                                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                sourceFilter === "all"
                                    ? "border-[var(--color-accent)] bg-[var(--color-accent)] ui-text-accent-contrast"
                                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-secondary)]"
                            )}
                        >
                            All ({vocabularyTerms.length})
                        </button>
                        {sourceOptions.map((option) => (
                            <button
                                key={option.key}
                                onClick={() => setSourceFilter(option.key)}
                                className={cn(
                                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                                    sourceFilter === option.key
                                        ? "border-[var(--color-accent)] bg-[var(--color-accent)] ui-text-accent-contrast"
                                        : "border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-secondary)]"
                                )}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <div className="mb-2 hidden items-center justify-between md:flex">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">
                            Terms
                        </h3>
                        {searchQuery && (
                            <span className="text-xs text-[color:var(--color-text-muted)]">
                                {filteredTerms.length} matches
                            </span>
                        )}
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1 space-y-1">
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
                                            "w-full rounded-lg px-3 py-3 text-left transition-all md:py-2.5",
                                            isSelected
                                                ? "bg-[var(--color-surface-elevated)] shadow-sm ring-1 ring-[var(--color-border-subtle)]"
                                                : "hover:bg-[var(--color-surface-hover)] border-b border-[var(--color-border-subtle)] md:border-b-transparent"
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <span className={cn(
                                                "font-medium truncate text-sm md:text-base",
                                                isSelected ? "text-[color:var(--color-text-primary)]" : "text-[color:var(--color-text-primary)]"
                                            )}>
                                                {term.term}
                                            </span>
                                            {isDue && (
                                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)] shrink-0" title="Due" />
                                            )}
                                        </div>
                                        <p className="mt-0.5 truncate text-xs text-[color:var(--color-text-secondary)] opacity-80">
                                            {getTermPrimaryDefinition(term)}
                                        </p>
                                    </button>
                                );
                            })
                        ) : (
                            <div className="flex flex-col items-center justify-center py-12 text-center opacity-60">
                                <BookOpenText className="mb-2 h-8 w-8 text-[color:var(--color-text-muted)]" />
                                <p className="text-xs text-[color:var(--color-text-secondary)]">No terms found.</p>
                            </div>
                        )}
                    </div>
                </main>

                {/* Column 3: Detail Panel (Mobile Overlay / Desktop Flex) */}
                <aside className={cn(
                    "bg-[var(--color-background)]",
                    // Mobile Styles: Fixed overlay
                    "fixed inset-0 z-50 flex flex-col transition-transform duration-300 ease-in-out",
                    selectedTermId ? "translate-x-0" : "translate-x-full",
                    // Desktop Styles: Static column
                    "md:static md:flex-1 md:translate-x-0 md:border-l md:border-[var(--color-border-subtle)] md:pl-6 md:bg-transparent"
                )}>
                    {selectedTerm ? (
                        <div className="flex flex-col h-full overflow-y-auto p-4 md:p-0 animate-fade-in">
                            {/* Mobile Nav */}
                            <div className="mb-4 flex items-center gap-2 md:hidden">
                                <button
                                    onClick={() => setSelectedTermId(null)}
                                    className="p-1 -ml-1 text-[color:var(--color-text-secondary)]"
                                >
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                                </button>
                                <span className="text-sm font-medium text-[color:var(--color-text-secondary)]">Back to list</span>
                            </div>

                            <div className="space-y-6">
                                {/* Header */}
                                <div>
                                    <h2 className="text-3xl font-bold text-[color:var(--color-text-primary)] sm:text-2xl">
                                        {selectedTerm.term}
                                    </h2>
                                    <div className="mt-2 flex items-center gap-3">
                                        {selectedTerm.phonetic && (
                                            <span className="font-mono text-sm text-[color:var(--color-text-secondary)] bg-[var(--color-surface-muted)] px-1.5 py-0.5 rounded">
                                                /{selectedTerm.phonetic}/
                                            </span>
                                        )}
                                        <div className="flex items-center gap-2">
                                            {reviewRecordByTermId.get(selectedTerm.id) && (
                                                <span className={cn(
                                                    "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
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
                                </div>

                                {/* Definitions */}
                                <div className="space-y-4">
                                    {selectedTerm.meanings.map((meaning, idx) => (
                                        <div key={`${meaning.provider}-${idx}`} className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-[color:var(--color-accent)] bg-[var(--color-accent)]/5 px-1.5 py-0.5 rounded">
                                                    {meaning.partOfSpeech}
                                                </span>
                                                <span className="text-[10px] uppercase text-[color:var(--color-text-muted)] tracking-wider">
                                                    {meaning.provider}
                                                </span>
                                            </div>
                                            <ul className="space-y-3">
                                                {meaning.definitions.slice(0, 3).map((def) => (
                                                    <li key={def} className="flex gap-2.5 text-sm text-[color:var(--color-text-primary)] leading-relaxed">
                                                        <span className="shrink-0 text-[color:var(--color-text-muted)] mt-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-50" />
                                                        <span>{def}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>

                                <hr className="border-[var(--color-border-subtle)]" />

                                {/* Metadata Inputs */}
                                <div className="space-y-4 rounded-xl bg-[var(--color-surface-muted)]/30 p-4">
                                    <div className="space-y-1.5">
                                        <label className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--color-text-muted)]">
                                            <NotebookPen className="h-3 w-3" />
                                            Notes
                                        </label>
                                        <textarea
                                            value={draftNote}
                                            onChange={(e) => setDraftNote(e.target.value)}
                                            placeholder="Write your personal mnemonics or context..."
                                            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-background)] px-3 py-2 text-sm placeholder:text-[color:var(--color-text-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] min-h-[80px]"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--color-text-muted)]">
                                            <Hash className="h-3 w-3" />
                                            Tags
                                        </label>
                                        <input
                                            value={draftTags}
                                            onChange={(e) => setDraftTags(e.target.value)}
                                            placeholder="e.g. difficult, french-origin..."
                                            className="w-full rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-background)] px-3 py-2 text-sm placeholder:text-[color:var(--color-text-muted)]/50 focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                                        />
                                    </div>

                                    <div className="pt-2">
                                        <button
                                            onClick={() => handleSaveMetadata(selectedTerm.id)}
                                            className="w-full ui-btn ui-btn-primary"
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                </div>

                                {/* Contexts */}
                                <div>
                                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">Found in sources</p>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedTerm.contexts.map((context) => (
                                            <div key={context.key} className="ui-chip inline-flex max-w-full items-center gap-1.5 px-2.5 py-1.5">
                                                <BookOpenText className="h-3.5 w-3.5 text-[color:var(--color-text-muted)]" />
                                                <span className="truncate text-xs text-[color:var(--color-text-secondary)] font-medium">
                                                    {getContextLabel(context)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex justify-center pt-4 pb-8 md:pb-0">
                                    <button
                                        onClick={() => handleDeleteTerm(selectedTerm.id)}
                                        className="ui-btn ui-btn-ghost text-[color:var(--color-error)] hover:bg-[color:var(--color-error)]/10 hover:text-[color:var(--color-error)]"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Delete this term
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="hidden h-full flex-col items-center justify-center text-center opacity-40 md:flex">
                            <BookOpenText className="mb-2 h-12 w-12 text-[color:var(--color-text-muted)]" />
                            <p className="text-sm font-medium text-[color:var(--color-text-secondary)]">Select a term to view details</p>
                            <p className="text-xs text-[color:var(--color-text-muted)]">Definitions, notes, and sources will appear here.</p>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}
