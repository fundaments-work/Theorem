import { useCallback, useMemo, useState } from "react";
import {
    cn,
    downloadPaper,
    generateCitation,
    isAcademicBook,
    searchAcademicPapers,
    toAcademicPaper,
    useLibraryStore,
    useUIStore,
    type AcademicPaper,
    type Book,
    type CitationFormat,
} from "@theorem/core";
import {
    BookOpenText,
    Copy,
    Download,
    ExternalLink,
    FileSearch,
    Filter,
    Loader2,
    Search,
} from "lucide-react";

type SearchSource = "arxiv" | "pubmed" | "all";

const SEARCH_SOURCE_OPTIONS: Array<{ value: SearchSource; label: string }> = [
    { value: "arxiv", label: "arXiv" },
    { value: "pubmed", label: "PubMed" },
    { value: "all", label: "All Sources" },
];

function formatDateLabel(value?: string): string {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
}

async function copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
}

function getPaperIdentityKey(paper: AcademicPaper): string {
    if (paper.doi) {
        return `doi:${paper.doi.toLowerCase()}`;
    }
    if (paper.sourceId) {
        return `${paper.source}:${paper.sourceId}`;
    }
    return `${paper.source}:${paper.id}`;
}

function getBookIdentityKey(book: Book): string {
    if (book.academic?.doi) {
        return `doi:${book.academic.doi.toLowerCase()}`;
    }
    if (book.academic?.source && book.academic?.sourceId) {
        return `${book.academic.source}:${book.academic.sourceId}`;
    }
    if (book.filePath) {
        return `url:${book.filePath}`;
    }
    return `book:${book.id}`;
}

function isBookInAcademicCollection(book: Book): boolean {
    if (book.academic) return true;
    if (book.category?.toLowerCase() === "academic") return true;
    return book.tags.some((tag) => {
        const lowered = tag.toLowerCase();
        return lowered === "academic" || lowered === "paper";
    });
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
    const sourceLabel = paper.source === "arxiv" ? "arXiv" : "PubMed";
    const publishedLabel = formatDateLabel(paper.publishedDate);
    const hasPdfUrl = Boolean(paper.pdfUrl);

    return (
        <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-flex items-center rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[color:var(--color-accent)] uppercase">
                            {sourceLabel}
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
                {(paper.authors.length > 0 ? paper.authors.join(", ") : "Unknown authors")}
            </p>

            {(paper.journal || paper.conference) && (
                <p className="text-xs text-[color:var(--color-text-muted)]">
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

function ReferencePaperCard({
    book,
    copiedKey,
    onOpen,
    onCopyCitation,
}: {
    book: Book;
    copiedKey: string | null;
    onOpen: (bookId: string) => void;
    onCopyCitation: (paper: AcademicPaper, format: CitationFormat) => void;
}) {
    const paper = toAcademicPaper(book);
    const reference = paper || {
        id: book.id,
        source: "manual" as const,
        title: book.title,
        authors: book.author
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        abstract: book.description,
        journal: book.publisher,
        publishedDate: book.publishedDate,
        pdfUrl: book.academic?.pdfUrl || book.filePath,
        url: book.filePath,
    };
    const publishedLabel = formatDateLabel(reference.publishedDate);

    return (
        <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm sm:text-base font-semibold text-[color:var(--color-text-primary)] leading-snug">
                        {reference.title}
                    </h3>
                    <p className="mt-1 text-xs sm:text-sm text-[color:var(--color-text-secondary)] line-clamp-2">
                        {reference.authors.length > 0 ? reference.authors.join(", ") : "Unknown authors"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--color-text-muted)]">
                        {(reference.journal || reference.conference) && (
                            <span>{reference.journal || reference.conference}</span>
                        )}
                        {publishedLabel && <span>{publishedLabel}</span>}
                        {reference.doi && <span className="truncate max-w-full">DOI: {reference.doi}</span>}
                    </div>
                </div>

                <button
                    onClick={() => onOpen(book.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--color-accent)] ui-text-accent-contrast hover:opacity-90"
                >
                    <BookOpenText className="w-3.5 h-3.5" />
                    Open
                </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                    onClick={() => onCopyCitation(reference, "apa")}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedKey === `${book.id}:apa` ? "Copied APA" : "Copy APA"}
                </button>

                <button
                    onClick={() => onCopyCitation(reference, "mla")}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedKey === `${book.id}:mla` ? "Copied MLA" : "Copy MLA"}
                </button>

                <button
                    onClick={() => onCopyCitation(reference, "bibtex")}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedKey === `${book.id}:bibtex` ? "Copied BibTeX" : "Copy BibTeX"}
                </button>

                {reference.url && (
                    <a
                        href={reference.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Source
                    </a>
                )}
            </div>
        </article>
    );
}

export function AcademicPage() {
    const books = useLibraryStore((state) => state.books);
    const addBook = useLibraryStore((state) => state.addBook);
    const setRoute = useUIStore((state) => state.setRoute);

    const [query, setQuery] = useState("");
    const [source, setSource] = useState<SearchSource>("arxiv");
    const [results, setResults] = useState<AcademicPaper[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [authorFilter, setAuthorFilter] = useState("");
    const [journalFilter, setJournalFilter] = useState("");

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

    const filteredAcademicBooks = useMemo(() => {
        const authorNeedle = authorFilter.trim().toLowerCase();
        const journalNeedle = journalFilter.trim().toLowerCase();

        return academicBooks
            .filter((book) => {
                const paper = toAcademicPaper(book);
                const authorHaystack = (
                    paper?.authors.join(" ")
                    || book.author
                    || ""
                ).toLowerCase();
                const journalHaystack = (
                    paper?.journal
                    || paper?.conference
                    || book.publisher
                    || ""
                ).toLowerCase();

                const authorMatch = !authorNeedle || authorHaystack.includes(authorNeedle);
                const journalMatch = !journalNeedle || journalHaystack.includes(journalNeedle);
                return authorMatch && journalMatch;
            })
            .sort((a, b) => {
                const aTime = new Date(a.addedAt).getTime();
                const bTime = new Date(b.addedAt).getTime();
                return bTime - aTime;
            });
    }, [academicBooks, authorFilter, journalFilter]);

    const handleSearch = useCallback(async () => {
        const trimmed = query.trim();
        if (!trimmed) {
            setResults([]);
            setError(null);
            return;
        }

        setIsSearching(true);
        setError(null);
        try {
            const papers = await searchAcademicPapers(trimmed, {
                source,
                maxResults: 20,
            });
            setResults(papers);
        } catch (searchError) {
            console.error("[AcademicPage] Search failed:", searchError);
            setError(searchError instanceof Error ? searchError.message : "Search failed.");
        } finally {
            setIsSearching(false);
        }
    }, [query, source]);

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

    const handleOpenBook = useCallback((bookId: string) => {
        setRoute("reader", bookId);
    }, [setRoute]);

    return (
        <div className="ui-page animate-fade-in">
            <div className="mb-8">
                <h1 className="ui-page-title">Papers</h1>
                <p className="ui-page-subtitle">
                    Search arXiv and PubMed, download papers, and manage references in one place.
                </p>
            </div>

            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6 mb-8">
                <div className="flex items-center gap-2 mb-4">
                    <FileSearch className="w-5 h-5 text-[color:var(--color-accent)]" />
                    <h2 className="text-base sm:text-lg font-semibold text-[color:var(--color-text-primary)]">
                        Academic Search
                    </h2>
                </div>

                <div className="flex flex-col lg:flex-row gap-3 mb-4">
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                void handleSearch();
                            }
                        }}
                        placeholder="Search papers by title, author, topic..."
                        className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2.5 text-sm text-[color:var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                    />

                    <select
                        value={source}
                        onChange={(event) => setSource(event.target.value as SearchSource)}
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm text-[color:var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                    >
                        {SEARCH_SOURCE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>

                    <button
                        onClick={() => {
                            void handleSearch();
                        }}
                        disabled={isSearching}
                        className={cn(
                            "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors",
                            isSearching
                                ? "bg-[var(--color-surface-muted)] text-[color:var(--color-text-muted)] cursor-not-allowed"
                                : "bg-[var(--color-accent)] ui-text-accent-contrast hover:opacity-90",
                        )}
                    >
                        {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        Search
                    </button>
                </div>

                {error && (
                    <div className="mb-4 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-sm text-[color:var(--color-error)]">
                        {error}
                    </div>
                )}

                {results.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background)] py-8 text-center text-sm text-[color:var(--color-text-muted)]">
                        {isSearching ? "Searching papers..." : "Run a search to see papers from arXiv and PubMed."}
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

            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                        <Filter className="w-5 h-5 text-[color:var(--color-accent)]" />
                        <h2 className="text-base sm:text-lg font-semibold text-[color:var(--color-text-primary)]">
                            Reference Manager
                        </h2>
                    </div>
                    <span className="text-xs sm:text-sm text-[color:var(--color-text-secondary)]">
                        {filteredAcademicBooks.length} paper{filteredAcademicBooks.length === 1 ? "" : "s"}
                    </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
                    <input
                        value={authorFilter}
                        onChange={(event) => setAuthorFilter(event.target.value)}
                        placeholder="Filter by author"
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm text-[color:var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                    />
                    <input
                        value={journalFilter}
                        onChange={(event) => setJournalFilter(event.target.value)}
                        placeholder="Filter by journal or conference"
                        className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm text-[color:var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
                    />
                </div>

                {filteredAcademicBooks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background)] py-10 text-center text-sm text-[color:var(--color-text-muted)]">
                        No academic papers in your library yet.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredAcademicBooks.map((book) => (
                            <ReferencePaperCard
                                key={book.id}
                                book={book}
                                copiedKey={copiedKey}
                                onOpen={handleOpenBook}
                                onCopyCitation={handleCopyCitation}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
