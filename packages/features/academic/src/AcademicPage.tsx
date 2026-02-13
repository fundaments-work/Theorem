import { useCallback, useEffect, useMemo, useState } from "react";
import {
    cn,
    discoverAcademicPapers,
    downloadPaper,
    generateCitation,
    isAcademicBook,
    searchAcademicPapers,
    useLibraryStore,
    useUIStore,
    type AcademicPaper,
    type CitationFormat,
} from "@theorem/core";
import { Dropdown, type DropdownOption } from "@theorem/ui";
import {
    Compass,
    Copy,
    Download,
    ExternalLink,
    Loader2,
    RefreshCw,
    Sparkles,
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
type SortMode = "recent" | "relevance";

interface FieldOption {
    id: string;
    label: string;
    query: string;
    description: string;
}

const SOURCE_OPTIONS: Array<DropdownOption<SearchSource>> = [
    { value: "all", label: "All Sources" },
    { value: "arxiv", label: "arXiv" },
    { value: "pubmed", label: "PubMed" },
];

const SORT_OPTIONS: Array<DropdownOption<SortMode>> = [
    { value: "recent", label: "Newest First" },
    { value: "relevance", label: "Most Relevant" },
];

const FIELD_OPTIONS: FieldOption[] = [
    {
        id: "ml",
        label: "Machine Learning",
        query: "machine learning",
        description: "Representation learning, LLMs, multimodal systems, and evaluation.",
    },
    {
        id: "ai-safety",
        label: "AI Safety",
        query: "AI alignment safety",
        description: "Alignment methods, robustness, and trustworthy model behavior.",
    },
    {
        id: "systems",
        label: "Systems",
        query: "distributed systems",
        description: "Scalability, storage systems, architecture, and reliability.",
    },
    {
        id: "security",
        label: "Security",
        query: "computer security",
        description: "Applied cryptography, software security, and threat modeling.",
    },
    {
        id: "biomed",
        label: "Biomedicine",
        query: "biomedical research",
        description: "Translational medicine, diagnostics, and clinical studies.",
    },
    {
        id: "neuro",
        label: "Neuroscience",
        query: "neuroscience",
        description: "Cognitive systems, neural circuits, and computational neuroscience.",
    },
    {
        id: "materials",
        label: "Materials Science",
        query: "materials science",
        description: "Novel materials, simulation, and structure-property relationships.",
    },
    {
        id: "climate",
        label: "Climate",
        query: "climate science",
        description: "Earth systems, climate modeling, and mitigation technologies.",
    },
];

function sourceSummary(source: SearchSource): string {
    if (source === "arxiv") return "Showing arXiv papers";
    if (source === "pubmed") return "Showing PubMed papers";
    return "Showing arXiv + PubMed papers";
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
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-flex items-center rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[color:var(--color-accent)] uppercase">
                            {sourceLabel(paper.source)}
                        </span>
                        {publishedLabel && (
                            <span className="text-xs text-[color:var(--color-text-muted)]">
                                {publishedLabel}
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

    const [source, setSource] = useState<SearchSource>("all");
    const [sortBy, setSortBy] = useState<SortMode>("recent");
    const [selectedFieldId, setSelectedFieldId] = useState<string>(FIELD_OPTIONS[0].id);
    const [results, setResults] = useState<AcademicPaper[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const selectedField = useMemo(
        () => FIELD_OPTIONS.find((field) => field.id === selectedFieldId) || FIELD_OPTIONS[0],
        [selectedFieldId],
    );

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

    const normalizedQuery = searchQuery.trim();
    const isSearchMode = normalizedQuery.length > 0;

    useEffect(() => {
        let cancelled = false;

        const fetchPapers = async () => {
            setIsLoading(true);
            setError(null);

            try {
                let papers: AcademicPaper[] = [];
                if (isSearchMode) {
                    papers = await searchAcademicPapers(normalizedQuery, {
                        source,
                        maxResults: 28,
                        sortBy,
                    });
                } else if (sortBy === "recent") {
                    papers = await discoverAcademicPapers({
                        source,
                        fieldQuery: selectedField.query,
                        maxResults: 28,
                    });
                } else {
                    papers = await searchAcademicPapers(selectedField.query, {
                        source,
                        maxResults: 28,
                        sortBy: "relevance",
                    });
                }

                if (!cancelled) {
                    setResults(papers);
                }
            } catch (searchError) {
                if (!cancelled) {
                    console.error("[AcademicPage] Failed to load papers:", searchError);
                    setError(searchError instanceof Error ? searchError.message : "Failed to load papers.");
                    setResults([]);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        const delay = isSearchMode ? 360 : 120;
        const timer = window.setTimeout(() => {
            void fetchPapers();
        }, delay);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [normalizedQuery, isSearchMode, source, sortBy, selectedField.query, refreshKey]);

    const handleRefresh = useCallback(() => {
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
        ? `Results for "${normalizedQuery}"`
        : `Latest in ${selectedField.label}`;

    const helperText = isSearchMode
        ? `${sourceSummary(source)} using the top search bar.`
        : selectedField.description;

    return (
        <div className="ui-page animate-fade-in">
            <div className="mb-8">
                <h1 className="ui-page-title">Papers</h1>
                <p className="ui-page-subtitle">
                    Discover new research by field and use the top search bar to query titles, authors, or DOI.
                </p>
            </div>

            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6 mb-6">
                <div className="flex items-center gap-2 mb-3">
                    <Compass className="w-5 h-5 text-[color:var(--color-accent)]" />
                    <h2 className="text-base sm:text-lg font-semibold text-[color:var(--color-text-primary)]">
                        Explore Fields
                    </h2>
                </div>

                <p className="text-sm text-[color:var(--color-text-secondary)] mb-4">
                    Choose a field to surface new papers. Your top-bar search instantly switches this view to direct search.
                </p>

                <div className="flex flex-wrap gap-2">
                    {FIELD_OPTIONS.map((field) => {
                        const isActive = field.id === selectedField.id;
                        return (
                            <button
                                key={field.id}
                                onClick={() => setSelectedFieldId(field.id)}
                                className={cn(
                                    "rounded-full px-3 py-1.5 text-xs sm:text-sm font-medium transition-colors border",
                                    isActive
                                        ? "border-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-border))] bg-[var(--color-accent-light)] text-[color:var(--color-accent)]"
                                        : "border-[var(--color-border)] bg-[var(--color-background)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                                )}
                            >
                                {field.label}
                            </button>
                        );
                    })}
                </div>
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
                    </div>

                    <div className="w-full xl:w-auto flex flex-col sm:flex-row gap-2 sm:items-center">
                        <Dropdown
                            options={SOURCE_OPTIONS}
                            value={source}
                            onChange={setSource}
                            className="w-full sm:w-[12rem]"
                            dropdownClassName="w-full"
                            variant="default"
                        />
                        <Dropdown
                            options={SORT_OPTIONS}
                            value={sortBy}
                            onChange={setSortBy}
                            className="w-full sm:w-[12rem]"
                            dropdownClassName="w-full"
                            variant="default"
                        />
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
                </div>

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
                            ? "No papers found for the current query and source filters."
                            : "No papers found for this field yet. Try another field or source."}
                    </div>
                ) : (
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
                )}
            </section>
        </div>
    );
}
