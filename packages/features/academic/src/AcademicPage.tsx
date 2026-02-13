import { useCallback, useEffect, useMemo, useState } from "react";
import {
    clearAcademicSearchCache,
    cn,
    discoverAcademicPapers,
    downloadPaper,
    generateCitation,
    isAcademicBook,
    searchAcademicPapers,
    useLibraryStore,
    useSettingsStore,
    useUIStore,
    type AcademicPaper,
    type AcademicTopic,
    type CitationFormat,
} from "@theorem/core";
import { Dropdown, type DropdownOption } from "@theorem/ui";
import {
    Compass,
    Copy,
    Download,
    ExternalLink,
    Loader2,
    Pencil,
    Plus,
    RefreshCw,
    Sparkles,
    Trash2,
} from "lucide-react";
import {
    copyToClipboard,
    formatDateLabel,
    getBookIdentityKey,
    getPaperIdentityKey,
    isBookInAcademicCollection,
    sourceLabel,
} from "./utils";

type SearchSource = "arxiv" | "pubmed" | "all";
type SortMode = "relevance" | "newest" | "oldest" | "citations_desc" | "citations_asc";
type DateWindow = "all" | "30d" | "90d" | "365d" | "730d";
type CitationBucket = "all" | "10" | "50" | "100" | "500";

const MIN_SEARCH_QUERY_LENGTH = 3;

const SOURCE_OPTIONS: Array<DropdownOption<SearchSource>> = [
    { value: "all", label: "All Sources" },
    { value: "arxiv", label: "arXiv" },
    { value: "pubmed", label: "PubMed" },
];

const SORT_OPTIONS: Array<DropdownOption<SortMode>> = [
    { value: "relevance", label: "Relevance" },
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "citations_desc", label: "Most Cited" },
    { value: "citations_asc", label: "Least Cited" },
];

const DATE_OPTIONS: Array<DropdownOption<DateWindow>> = [
    { value: "all", label: "Any Date" },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
    { value: "365d", label: "Last year" },
    { value: "730d", label: "Last 2 years" },
];

const CITATION_OPTIONS: Array<DropdownOption<CitationBucket>> = [
    { value: "all", label: "Any Citations" },
    { value: "10", label: "10+ citations" },
    { value: "50", label: "50+ citations" },
    { value: "100", label: "100+ citations" },
    { value: "500", label: "500+ citations" },
];

const CURATED_FIELD_TOPICS: AcademicTopic[] = [
    { id: "ml-foundation", label: "ML Foundations", query: "machine learning" },
    { id: "llm", label: "LLM Systems", query: "large language model" },
    { id: "ai-safety", label: "AI Safety", query: "AI alignment safety" },
    { id: "vision", label: "Computer Vision", query: "computer vision" },
    { id: "nlp", label: "NLP", query: "natural language processing" },
    { id: "speech", label: "Speech AI", query: "speech recognition synthesis" },
    { id: "robotics", label: "Robotics", query: "robotics autonomous systems" },
    { id: "systems", label: "Distributed Systems", query: "distributed systems" },
    { id: "databases", label: "Databases", query: "database systems data management" },
    { id: "security", label: "Computer Security", query: "computer security" },
    { id: "privacy", label: "Privacy", query: "privacy differential privacy" },
    { id: "cryptography", label: "Cryptography", query: "cryptography protocols" },
    { id: "hci", label: "HCI", query: "human computer interaction" },
    { id: "economics", label: "Economics", query: "economics econometrics" },
    { id: "finance", label: "Quant Finance", query: "quantitative finance risk modeling" },
    { id: "math", label: "Mathematics", query: "mathematics applied math" },
    { id: "physics", label: "Physics", query: "physics condensed matter" },
    { id: "quantum", label: "Quantum", query: "quantum computing quantum information" },
    { id: "bioinformatics", label: "Bioinformatics", query: "bioinformatics" },
    { id: "biomed", label: "Biomedicine", query: "biomedical research" },
    { id: "neuroscience", label: "Neuroscience", query: "neuroscience" },
    { id: "genomics", label: "Genomics", query: "genomics sequencing" },
    { id: "public-health", label: "Public Health", query: "public health epidemiology" },
    { id: "materials", label: "Materials", query: "materials science" },
    { id: "energy", label: "Energy", query: "energy systems batteries grid" },
    { id: "climate", label: "Climate", query: "climate science" },
    { id: "education", label: "Education", query: "learning sciences education" },
];

function sourceSummary(source: SearchSource): string {
    if (source === "arxiv") return "Showing arXiv papers";
    if (source === "pubmed") return "Showing PubMed papers";
    return "Showing arXiv + PubMed papers";
}

function publicationTimestamp(paper: AcademicPaper): number | null {
    if (!paper.publishedDate) {
        return null;
    }

    const parsed = new Date(paper.publishedDate).getTime();
    if (Number.isNaN(parsed)) {
        return null;
    }

    return parsed;
}

function matchesDateWindow(paper: AcademicPaper, dateWindow: DateWindow): boolean {
    if (dateWindow === "all") {
        return true;
    }

    const timestamp = publicationTimestamp(paper);
    if (timestamp == null) {
        return false;
    }

    const now = Date.now();
    const byWindow: Record<Exclude<DateWindow, "all">, number> = {
        "30d": 30,
        "90d": 90,
        "365d": 365,
        "730d": 730,
    };

    const days = byWindow[dateWindow];
    return timestamp >= now - (days * 24 * 60 * 60 * 1000);
}

function matchesCitationBucket(paper: AcademicPaper, bucket: CitationBucket): boolean {
    if (bucket === "all") {
        return true;
    }

    const threshold = Number(bucket);
    return (paper.citationCount ?? -1) >= threshold;
}

function AcademicSearchResultCard({
    paper,
    isDownloading,
    inLibrary,
    copiedKey,
    onDownload,
    onCopyCitation,
}: {
    paper: AcademicPaper;
    isDownloading: boolean;
    inLibrary: boolean;
    copiedKey: string | null;
    onDownload: (paper: AcademicPaper) => void;
    onCopyCitation: (paper: AcademicPaper, format: CitationFormat) => void;
}) {
    const publishedLabel = formatDateLabel(paper.publishedDate);
    const hasPdfUrl = Boolean(paper.pdfUrl);

    return (
        <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="inline-flex items-center rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[color:var(--color-accent)] uppercase">
                            {sourceLabel(paper.source)}
                        </span>
                        {publishedLabel && (
                            <span className="text-xs text-[color:var(--color-text-muted)]">
                                {publishedLabel}
                            </span>
                        )}
                        {typeof paper.citationCount === "number" && (
                            <span className="text-xs text-[color:var(--color-text-muted)]">
                                {paper.citationCount} citations
                            </span>
                        )}
                    </div>
                    <h3 className="text-sm sm:text-base font-semibold text-[color:var(--color-text-primary)] leading-snug">
                        {paper.title}
                    </h3>
                </div>
                {inLibrary && (
                    <span className="text-[10px] font-semibold rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-[color:var(--color-text-secondary)]">
                        In Library
                    </span>
                )}
            </div>

            <p className="text-xs sm:text-sm text-[color:var(--color-text-secondary)] line-clamp-2">
                {paper.authors.length > 0 ? paper.authors.join(", ") : "Unknown authors"}
            </p>

            {(paper.journal || paper.conference) && (
                <p className="text-xs text-[color:var(--color-text-muted)] line-clamp-1">
                    {paper.journal || paper.conference}
                </p>
            )}

            {paper.abstract && (
                <p className="text-xs sm:text-sm text-[color:var(--color-text-secondary)] leading-relaxed line-clamp-4">
                    {paper.abstract}
                </p>
            )}

            {paper.doi && (
                <p className="text-xs text-[color:var(--color-text-muted)] break-all">
                    DOI: {paper.doi}
                </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                    onClick={() => onDownload(paper)}
                    disabled={!hasPdfUrl || inLibrary || isDownloading}
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        (!hasPdfUrl || inLibrary || isDownloading)
                            ? "bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)] cursor-not-allowed"
                            : "bg-[var(--color-accent)] ui-text-accent-contrast hover:opacity-90",
                    )}
                    title={!hasPdfUrl ? "No direct PDF URL available for this result" : undefined}
                >
                    {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    {inLibrary ? "In Library" : hasPdfUrl ? "Download + Library" : "No PDF URL"}
                </button>

                {paper.url && (
                    <a
                        href={paper.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Source
                    </a>
                )}

                <button
                    onClick={() => onCopyCitation(paper, "apa")}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedKey === `${paper.id}:apa` ? "Copied APA" : "Copy APA"}
                </button>
            </div>
        </article>
    );
}

export function AcademicPage() {
    const books = useLibraryStore((state) => state.books);
    const addBook = useLibraryStore((state) => state.addBook);
    const searchQuery = useUIStore((state) => state.searchQuery);
    const searchCommittedQuery = useUIStore((state) => state.searchCommittedQuery);
    const settings = useSettingsStore((state) => state.settings);
    const updateSettings = useSettingsStore((state) => state.updateSettings);

    const [source, setSource] = useState<SearchSource>("all");
    const [sortBy, setSortBy] = useState<SortMode>("relevance");
    const [dateWindow, setDateWindow] = useState<DateWindow>("all");
    const [citationBucket, setCitationBucket] = useState<CitationBucket>("all");
    const [selectedFieldId, setSelectedFieldId] = useState<string>(CURATED_FIELD_TOPICS[0].id);
    const [authorFilterQuery, setAuthorFilterQuery] = useState("");
    const [venueFilterQuery, setVenueFilterQuery] = useState("");
    const [rawResults, setRawResults] = useState<AcademicPaper[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const [isTopicEditorOpen, setIsTopicEditorOpen] = useState(false);
    const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
    const [topicLabelDraft, setTopicLabelDraft] = useState("");
    const [topicQueryDraft, setTopicQueryDraft] = useState("");

    const customTopics = settings.academic.customTopics;
    const allTopics = useMemo(
        () => [...CURATED_FIELD_TOPICS, ...customTopics],
        [customTopics],
    );

    const selectedTopic = useMemo(
        () => allTopics.find((topic) => topic.id === selectedFieldId) || allTopics[0],
        [allTopics, selectedFieldId],
    );

    useEffect(() => {
        if (!allTopics.some((topic) => topic.id === selectedFieldId)) {
            setSelectedFieldId(allTopics[0]?.id || CURATED_FIELD_TOPICS[0].id);
        }
    }, [allTopics, selectedFieldId]);

    const academicBooks = useMemo(
        () => books.filter((book) => isBookInAcademicCollection(book) || isAcademicBook(book)),
        [books],
    );

    const existingIdentityKeys = useMemo(() => {
        const keys = new Set<string>();
        for (const book of academicBooks) {
            keys.add(getBookIdentityKey(book));
        }
        return keys;
    }, [academicBooks]);

    const normalizedCommittedQuery = searchCommittedQuery.trim();
    const normalizedLiveQuery = searchQuery.trim();
    const hasPendingSearchInput = normalizedLiveQuery !== normalizedCommittedQuery;
    const isSearchMode = normalizedCommittedQuery.length > 0;
    const isCommittedQueryTooShort = (
        isSearchMode
        && normalizedCommittedQuery.length < MIN_SEARCH_QUERY_LENGTH
    );

    const apiSortBy = sortBy === "relevance" ? "relevance" : "recent";
    const shouldEnrichCitations = (
        citationBucket !== "all"
        || sortBy === "citations_desc"
        || sortBy === "citations_asc"
    );

    useEffect(() => {
        if (isCommittedQueryTooShort) {
            setRawResults([]);
            setError(null);
            setIsLoading(false);
            return;
        }

        let cancelled = false;
        const fetchPapers = async () => {
            setIsLoading(true);
            setError(null);

            try {
                let papers: AcademicPaper[] = [];
                if (isSearchMode) {
                    papers = await searchAcademicPapers(normalizedCommittedQuery, {
                        source,
                        maxResults: 40,
                        sortBy: apiSortBy,
                        enrichCitations: shouldEnrichCitations,
                    });
                } else {
                    papers = await discoverAcademicPapers({
                        source,
                        fieldQuery: selectedTopic.query,
                        maxResults: 40,
                        enrichCitations: shouldEnrichCitations,
                    });
                }

                if (!cancelled) {
                    setRawResults(papers);
                }
            } catch (searchError) {
                if (!cancelled) {
                    console.error("[AcademicPage] Failed to load papers:", searchError);
                    const fallback = searchError instanceof Error
                        ? searchError.message
                        : "Failed to load papers.";
                    setError(fallback);
                    setRawResults([]);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        void fetchPapers();
        return () => {
            cancelled = true;
        };
    }, [
        normalizedCommittedQuery,
        isSearchMode,
        isCommittedQueryTooShort,
        source,
        selectedTopic.query,
        refreshKey,
        apiSortBy,
        shouldEnrichCitations,
    ]);

    const results = useMemo(() => {
        const normalizedAuthorQuery = authorFilterQuery.trim().toLowerCase();
        const normalizedVenueQuery = venueFilterQuery.trim().toLowerCase();
        let filtered = rawResults.filter((paper) => {
            if (!matchesDateWindow(paper, dateWindow)) {
                return false;
            }
            if (!matchesCitationBucket(paper, citationBucket)) {
                return false;
            }
            if (
                normalizedAuthorQuery
                && !paper.authors.some((author) => author.toLowerCase().includes(normalizedAuthorQuery))
            ) {
                return false;
            }
            if (normalizedVenueQuery) {
                const venue = paper.journal || paper.conference || "";
                if (!venue.toLowerCase().includes(normalizedVenueQuery)) {
                    return false;
                }
            }
            return true;
        });

        if (sortBy === "relevance") {
            return filtered;
        }

        filtered = [...filtered].sort((a, b) => {
            if (sortBy === "citations_desc") {
                return (b.citationCount ?? -1) - (a.citationCount ?? -1);
            }
            if (sortBy === "citations_asc") {
                return (a.citationCount ?? -1) - (b.citationCount ?? -1);
            }

            const aDate = publicationTimestamp(a) ?? 0;
            const bDate = publicationTimestamp(b) ?? 0;
            return sortBy === "oldest" ? aDate - bDate : bDate - aDate;
        });

        return filtered;
    }, [
        rawResults,
        dateWindow,
        citationBucket,
        authorFilterQuery,
        venueFilterQuery,
        sortBy,
    ]);

    const saveCustomTopics = useCallback((nextTopics: AcademicTopic[]) => {
        updateSettings({
            academic: {
                ...settings.academic,
                customTopics: nextTopics,
            },
        });
    }, [settings.academic, updateSettings]);

    const resetTopicDraft = useCallback(() => {
        setEditingTopicId(null);
        setTopicLabelDraft("");
        setTopicQueryDraft("");
    }, []);

    const handleSaveTopic = useCallback(() => {
        const nextLabel = topicLabelDraft.trim();
        const nextQuery = topicQueryDraft.trim();
        if (!nextLabel || !nextQuery) {
            return;
        }

        if (editingTopicId) {
            const nextTopics = customTopics.map((topic) => (
                topic.id === editingTopicId
                    ? { ...topic, label: nextLabel, query: nextQuery }
                    : topic
            ));
            saveCustomTopics(nextTopics);
        } else {
            saveCustomTopics([
                ...customTopics,
                {
                    id: crypto.randomUUID(),
                    label: nextLabel,
                    query: nextQuery,
                },
            ]);
        }

        setIsTopicEditorOpen(false);
        resetTopicDraft();
    }, [customTopics, editingTopicId, resetTopicDraft, saveCustomTopics, topicLabelDraft, topicQueryDraft]);

    const handleEditTopic = useCallback((topic: AcademicTopic) => {
        setEditingTopicId(topic.id);
        setTopicLabelDraft(topic.label);
        setTopicQueryDraft(topic.query);
        setIsTopicEditorOpen(true);
    }, []);

    const handleDeleteTopic = useCallback((topicId: string) => {
        const nextTopics = customTopics.filter((topic) => topic.id !== topicId);
        saveCustomTopics(nextTopics);
        if (selectedFieldId === topicId) {
            setSelectedFieldId(CURATED_FIELD_TOPICS[0].id);
        }
    }, [customTopics, saveCustomTopics, selectedFieldId]);

    const handleRefresh = useCallback(() => {
        clearAcademicSearchCache();
        setRefreshKey((current) => current + 1);
    }, []);

    const handleDownload = useCallback(async (paper: AcademicPaper) => {
        if (!paper.pdfUrl) {
            setError("No PDF URL available for this result.");
            return;
        }

        const identityKey = getPaperIdentityKey(paper);
        if (existingIdentityKeys.has(identityKey)) {
            return;
        }

        setDownloadingIds((current) => ({ ...current, [paper.id]: true }));
        setError(null);

        try {
            const importedBook = await downloadPaper(paper.pdfUrl, paper);
            addBook(importedBook);
        } catch (downloadError) {
            console.error("[AcademicPage] Download failed:", downloadError);
            setError(downloadError instanceof Error ? downloadError.message : "Failed to download paper.");
        } finally {
            setDownloadingIds((current) => {
                const next = { ...current };
                delete next[paper.id];
                return next;
            });
        }
    }, [addBook, existingIdentityKeys]);

    const handleCopyCitation = useCallback(async (paper: AcademicPaper, format: CitationFormat) => {
        try {
            const citation = generateCitation(paper, format);
            await copyToClipboard(citation);
            setCopiedKey(`${paper.id}:${format}`);
            window.setTimeout(() => {
                setCopiedKey((current) => (current === `${paper.id}:${format}` ? null : current));
            }, 1800);
        } catch (copyError) {
            console.error("[AcademicPage] Failed to copy citation:", copyError);
        }
    }, []);

    const headingText = isSearchMode
        ? `Results for "${normalizedCommittedQuery}"`
        : `Explore ${selectedTopic.label}`;

    const helperText = isSearchMode
        ? `${sourceSummary(source)}. Use Enter in the top search bar to run a new query.`
        : `Discovery feed for topic query: ${selectedTopic.query}`;

    return (
        <div className="ui-page animate-fade-in">
            <div className="mb-8">
                <h1 className="ui-page-title">Papers</h1>
                <p className="ui-page-subtitle">
                    Discover research by topic, then run explicit top-bar searches (Enter) to avoid noisy API traffic.
                </p>
            </div>

            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6 mb-6">
                <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2">
                        <Compass className="w-5 h-5 text-[color:var(--color-accent)]" />
                        <h2 className="text-base sm:text-lg font-semibold text-[color:var(--color-text-primary)]">
                            Fields & Topics
                        </h2>
                    </div>

                    <button
                        onClick={() => {
                            setIsTopicEditorOpen((current) => !current);
                            if (isTopicEditorOpen) {
                                resetTopicDraft();
                            }
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Custom Topic
                    </button>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                    {allTopics.map((topic) => {
                        const isActive = topic.id === selectedTopic.id;
                        const isCustom = customTopics.some((entry) => entry.id === topic.id);
                        return (
                            <div key={topic.id} className="flex items-center gap-1">
                                <button
                                    onClick={() => setSelectedFieldId(topic.id)}
                                    className={cn(
                                        "rounded-full px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors border",
                                        isActive
                                            ? "border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-border))] bg-[var(--color-accent-light)] text-[color:var(--color-accent)]"
                                            : "border-[var(--color-border)] bg-[var(--color-background)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                                    )}
                                    title={topic.query}
                                >
                                    {topic.label}
                                </button>
                                {isCustom && (
                                    <>
                                        <button
                                            onClick={() => handleEditTopic(topic)}
                                            className="rounded-full p-1 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text-primary)]"
                                            title="Edit topic"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => handleDeleteTopic(topic.id)}
                                            className="rounded-full p-1 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)]"
                                            title="Delete topic"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>

                {isTopicEditorOpen && (
                    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-3 sm:p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input
                                value={topicLabelDraft}
                                onChange={(event) => setTopicLabelDraft(event.target.value)}
                                placeholder="Topic label"
                                className="ui-input w-full"
                            />
                            <input
                                value={topicQueryDraft}
                                onChange={(event) => setTopicQueryDraft(event.target.value)}
                                placeholder="Query used for discovery"
                                className="ui-input w-full"
                            />
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                            <button
                                onClick={handleSaveTopic}
                                disabled={!topicLabelDraft.trim() || !topicQueryDraft.trim()}
                                className="ui-btn ui-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {editingTopicId ? "Save Topic" : "Add Topic"}
                            </button>
                            <button
                                onClick={() => {
                                    resetTopicDraft();
                                    setIsTopicEditorOpen(false);
                                }}
                                className="ui-btn ui-btn-ghost"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </section>

            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6">
                <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <Sparkles className="w-5 h-5 text-[color:var(--color-accent)]" />
                            <h2 className="text-base sm:text-lg font-semibold text-[color:var(--color-text-primary)]">
                                {headingText}
                            </h2>
                        </div>
                        <p className="text-sm text-[color:var(--color-text-secondary)]">
                            {helperText}
                        </p>
                        {hasPendingSearchInput && (
                            <p className="text-xs text-[color:var(--color-text-muted)] mt-2">
                                Top-bar query changed. Press Enter to run: "{normalizedLiveQuery}".
                            </p>
                        )}
                    </div>

                    <button
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className={cn(
                            "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm border border-[var(--color-border)] transition-colors",
                            isLoading
                                ? "text-[color:var(--color-text-muted)] bg-[var(--color-surface-muted)] cursor-not-allowed"
                                : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]",
                        )}
                        title="Refresh papers"
                    >
                        <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                        Refresh
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 mb-4">
                    <Dropdown
                        options={SOURCE_OPTIONS}
                        value={source}
                        onChange={setSource}
                        className="w-full"
                        dropdownClassName="w-full"
                    />
                    <Dropdown
                        options={SORT_OPTIONS}
                        value={sortBy}
                        onChange={setSortBy}
                        className="w-full"
                        dropdownClassName="w-full"
                    />
                    <Dropdown
                        options={DATE_OPTIONS}
                        value={dateWindow}
                        onChange={setDateWindow}
                        className="w-full"
                        dropdownClassName="w-full"
                    />
                    <Dropdown
                        options={CITATION_OPTIONS}
                        value={citationBucket}
                        onChange={setCitationBucket}
                        className="w-full"
                        dropdownClassName="w-full"
                    />
                    <input
                        type="text"
                        value={authorFilterQuery}
                        onChange={(event) => setAuthorFilterQuery(event.target.value)}
                        placeholder="Filter author (contains)"
                        className="ui-input w-full"
                    />
                    <input
                        type="text"
                        value={venueFilterQuery}
                        onChange={(event) => setVenueFilterQuery(event.target.value)}
                        placeholder="Filter venue/journal"
                        className="ui-input w-full"
                    />
                </div>

                {isCommittedQueryTooShort && (
                    <div className="mb-4 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-sm text-[color:var(--color-text-secondary)]">
                        Search query must be at least {MIN_SEARCH_QUERY_LENGTH} characters.
                    </div>
                )}

                {error && (
                    <div className="mb-4 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-sm text-[color:var(--color-error)]">
                        {error}
                    </div>
                )}

                {isLoading ? (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background)] py-10 text-center text-sm text-[color:var(--color-text-muted)]">
                        Loading papers...
                    </div>
                ) : results.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background)] py-10 text-center text-sm text-[color:var(--color-text-muted)]">
                        {isSearchMode
                            ? "No papers found for the committed query and filters."
                            : "No papers found for this topic yet. Try another topic or source."}
                    </div>
                ) : (
                    <>
                        <p className="mb-3 text-xs sm:text-sm text-[color:var(--color-text-secondary)]">
                            {results.length} paper{results.length === 1 ? "" : "s"}
                        </p>
                        <div className="space-y-3">
                            {results.map((paper) => {
                                const identity = getPaperIdentityKey(paper);
                                return (
                                    <AcademicSearchResultCard
                                        key={paper.id}
                                        paper={paper}
                                        isDownloading={Boolean(downloadingIds[paper.id])}
                                        inLibrary={existingIdentityKeys.has(identity)}
                                        copiedKey={copiedKey}
                                        onDownload={handleDownload}
                                        onCopyCitation={handleCopyCitation}
                                    />
                                );
                            })}
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
