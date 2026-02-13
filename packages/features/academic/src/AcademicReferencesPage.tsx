import { useCallback, useEffect, useMemo, useState } from "react";
import {
    cn,
    generateCitation,
    isAcademicBook,
    rankByFuzzyQuery,
    toAcademicPaper,
    useLibraryStore,
    useUIStore,
    type AcademicPaper,
    type Book,
    type CitationFormat,
    type Collection,
} from "@theorem/core";
import {
    Dropdown,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    ShelfModal,
    type DropdownOption,
} from "@theorem/ui";
import {
    BookOpenText,
    Copy,
    ExternalLink,
    Filter,
    FolderPlus,
    Layers,
    Pencil,
    Trash2,
} from "lucide-react";
import {
    copyToClipboard,
    formatDateLabel,
    isBookInAcademicCollection,
    sourceLabel,
} from "./utils";

type ShelfSelection = "all" | string;
type SourceFilter = "all" | "arxiv" | "pubmed" | "manual";

interface PaperEntry {
    book: Book;
    paper: AcademicPaper;
}

const SOURCE_FILTER_OPTIONS: Array<DropdownOption<SourceFilter>> = [
    { value: "all", label: "All Sources" },
    { value: "arxiv", label: "arXiv" },
    { value: "pubmed", label: "PubMed" },
    { value: "manual", label: "Manual" },
];

function toFallbackPaper(book: Book): AcademicPaper {
    return {
        id: book.id,
        source: "manual",
        title: book.title,
        authors: book.author
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        abstract: book.description,
        journal: book.publisher,
        doi: book.academic?.doi,
        conference: book.academic?.conference,
        citationCount: book.academic?.citationCount,
        pdfUrl: book.academic?.pdfUrl || book.filePath,
        url: book.filePath,
        publishedDate: book.publishedDate,
        referenceData: book.academic?.referenceData,
    };
}

function getSafeExternalUrl(paper: AcademicPaper): string | undefined {
    const url = paper.url || paper.pdfUrl;
    if (!url) return undefined;
    if (url.startsWith("http://") || url.startsWith("https://")) {
        return url;
    }
    return undefined;
}

function shelfBookCount(shelf: Collection, academicBookIds: Set<string>): number {
    return shelf.bookIds.filter((bookId) => academicBookIds.has(bookId)).length;
}

function ReferencePaperCard({
    entry,
    copiedKey,
    shelfNames,
    onOpen,
    onManageShelves,
    onCopyCitation,
}: {
    entry: PaperEntry;
    copiedKey: string | null;
    shelfNames: string[];
    onOpen: (bookId: string) => void;
    onManageShelves: (book: Book) => void;
    onCopyCitation: (paper: AcademicPaper, format: CitationFormat) => void;
}) {
    const { book, paper } = entry;
    const publishedLabel = formatDateLabel(paper.publishedDate);
    const externalUrl = getSafeExternalUrl(paper);

    return (
        <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
            <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                            <span className="inline-flex items-center rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[color:var(--color-accent)] uppercase">
                                {sourceLabel(paper.source)}
                            </span>
                            {publishedLabel && (
                                <span className="text-xs text-[color:var(--color-text-muted)]">{publishedLabel}</span>
                            )}
                        </div>
                        <h3 className="text-sm sm:text-base font-semibold text-[color:var(--color-text-primary)] leading-snug">
                            {paper.title}
                        </h3>
                        <p className="mt-1 text-xs sm:text-sm text-[color:var(--color-text-secondary)] line-clamp-2">
                            {paper.authors.length > 0 ? paper.authors.join(", ") : "Unknown authors"}
                        </p>
                    </div>

                    <button
                        onClick={() => onOpen(book.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-[var(--color-accent)] ui-text-accent-contrast hover:opacity-90"
                    >
                        <BookOpenText className="w-3.5 h-3.5" />
                        Open
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--color-text-muted)]">
                    {(paper.journal || paper.conference) && (
                        <span>{paper.journal || paper.conference}</span>
                    )}
                    {paper.doi && <span className="truncate max-w-full">DOI: {paper.doi}</span>}
                </div>

                {paper.abstract && (
                    <p className="text-xs sm:text-sm text-[color:var(--color-text-secondary)] leading-relaxed line-clamp-3">
                        {paper.abstract}
                    </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                    {shelfNames.length === 0 ? (
                        <span className="text-[10px] font-semibold rounded-full border border-dashed border-[var(--color-border)] px-2 py-1 text-[color:var(--color-text-muted)]">
                            No research shelf
                        </span>
                    ) : (
                        shelfNames.map((name) => (
                            <span
                                key={name}
                                className="text-[10px] font-semibold rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-[color:var(--color-text-secondary)]"
                            >
                                {name}
                            </span>
                        ))
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => onManageShelves(book)}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <Layers className="w-3.5 h-3.5" />
                        Shelves
                    </button>

                    <button
                        onClick={() => onCopyCitation(paper, "apa")}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        {copiedKey === `${book.id}:apa` ? "Copied APA" : "Copy APA"}
                    </button>

                    <button
                        onClick={() => onCopyCitation(paper, "bibtex")}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        {copiedKey === `${book.id}:bibtex` ? "Copied BibTeX" : "Copy BibTeX"}
                    </button>

                    {externalUrl && (
                        <a
                            href={externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Source
                        </a>
                    )}
                </div>
            </div>
        </article>
    );
}

export function AcademicReferencesPage() {
    const books = useLibraryStore((state) => state.books);
    const collections = useLibraryStore((state) => state.collections);
    const addCollection = useLibraryStore((state) => state.addCollection);
    const updateCollection = useLibraryStore((state) => state.updateCollection);
    const removeCollection = useLibraryStore((state) => state.removeCollection);
    const addBookToCollection = useLibraryStore((state) => state.addBookToCollection);
    const removeBookFromCollection = useLibraryStore((state) => state.removeBookFromCollection);
    const setRoute = useUIStore((state) => state.setRoute);
    const searchQuery = useUIStore((state) => state.searchQuery);

    const [selectedShelfId, setSelectedShelfId] = useState<ShelfSelection>("all");
    const [authorFilter, setAuthorFilter] = useState<string>("all");
    const [venueFilter, setVenueFilter] = useState<string>("all");
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const [isShelfModalOpen, setIsShelfModalOpen] = useState(false);
    const [editingShelf, setEditingShelf] = useState<{ id: string; name: string; description?: string } | undefined>();
    const [organizingBook, setOrganizingBook] = useState<Book | null>(null);

    const academicBooks = useMemo(
        () => books
            .filter((book) => isBookInAcademicCollection(book) || isAcademicBook(book))
            .sort((a, b) => {
                const aTime = new Date(a.addedAt).getTime();
                const bTime = new Date(b.addedAt).getTime();
                return bTime - aTime;
            }),
        [books],
    );

    const academicBookIds = useMemo(
        () => new Set(academicBooks.map((book) => book.id)),
        [academicBooks],
    );

    const researchShelves = useMemo(
        () => collections.filter((collection) => (
            collection.kind === "research"
            || collection.bookIds.some((bookId) => academicBookIds.has(bookId))
        )),
        [collections, academicBookIds],
    );

    useEffect(() => {
        if (selectedShelfId === "all") {
            return;
        }
        if (!researchShelves.some((shelf) => shelf.id === selectedShelfId)) {
            setSelectedShelfId("all");
        }
    }, [selectedShelfId, researchShelves]);

    const entries = useMemo<PaperEntry[]>(() => {
        return academicBooks.map((book) => ({
            book,
            paper: toAcademicPaper(book) || toFallbackPaper(book),
        }));
    }, [academicBooks]);

    const authorOptions = useMemo<Array<DropdownOption<string>>>(() => {
        const values = new Set<string>();
        for (const { paper } of entries) {
            for (const author of paper.authors) {
                if (author.trim()) {
                    values.add(author.trim());
                }
            }
        }

        return [
            { value: "all", label: "All Authors" },
            ...Array.from(values)
                .sort((a, b) => a.localeCompare(b))
                .map((author) => ({ value: author, label: author })),
        ];
    }, [entries]);

    const venueOptions = useMemo<Array<DropdownOption<string>>>(() => {
        const values = new Set<string>();
        for (const { paper } of entries) {
            const venue = (paper.journal || paper.conference || "").trim();
            if (venue) {
                values.add(venue);
            }
        }

        return [
            { value: "all", label: "All Journals / Conferences" },
            ...Array.from(values)
                .sort((a, b) => a.localeCompare(b))
                .map((venue) => ({ value: venue, label: venue })),
        ];
    }, [entries]);

    const filteredEntries = useMemo(() => {
        let scopedEntries = entries;

        if (selectedShelfId !== "all") {
            const selectedShelf = researchShelves.find((shelf) => shelf.id === selectedShelfId);
            if (!selectedShelf) {
                scopedEntries = [];
            } else {
                const allowedBookIds = new Set(selectedShelf.bookIds);
                scopedEntries = scopedEntries.filter(({ book }) => allowedBookIds.has(book.id));
            }
        }

        if (authorFilter !== "all") {
            scopedEntries = scopedEntries.filter(({ paper }) => paper.authors.includes(authorFilter));
        }

        if (venueFilter !== "all") {
            scopedEntries = scopedEntries.filter(({ paper }) => (
                (paper.journal || paper.conference || "") === venueFilter
            ));
        }

        if (sourceFilter !== "all") {
            scopedEntries = scopedEntries.filter(({ paper }) => paper.source === sourceFilter);
        }

        const trimmedQuery = searchQuery.trim();
        if (!trimmedQuery) {
            return scopedEntries;
        }

        const ranked = rankByFuzzyQuery(
            scopedEntries.map((entry) => ({
                entry,
                title: entry.paper.title,
                authors: entry.paper.authors.join(" "),
                venue: `${entry.paper.journal || ""} ${entry.paper.conference || ""}`.trim(),
                doi: entry.paper.doi || "",
            })),
            trimmedQuery,
            {
                keys: [
                    { name: "title", weight: 0.45 },
                    { name: "authors", weight: 0.3 },
                    { name: "venue", weight: 0.15 },
                    { name: "doi", weight: 0.1 },
                ],
            },
        );

        return ranked.map(({ item }) => item.entry);
    }, [entries, selectedShelfId, researchShelves, authorFilter, venueFilter, sourceFilter, searchQuery]);

    const shelfNamesByBookId = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const shelf of researchShelves) {
            for (const bookId of shelf.bookIds) {
                if (!academicBookIds.has(bookId)) {
                    continue;
                }
                if (!map.has(bookId)) {
                    map.set(bookId, []);
                }
                map.get(bookId)?.push(shelf.name);
            }
        }
        return map;
    }, [researchShelves, academicBookIds]);

    const handleOpenBook = useCallback((bookId: string) => {
        setRoute("reader", bookId);
    }, [setRoute]);

    const handleCopyCitation = useCallback(async (paper: AcademicPaper, format: CitationFormat) => {
        try {
            const citation = generateCitation(paper, format);
            await copyToClipboard(citation);
            setCopiedKey(`${paper.id}:${format}`);
            window.setTimeout(() => {
                setCopiedKey((current) => (current === `${paper.id}:${format}` ? null : current));
            }, 1800);
        } catch (copyError) {
            console.error("[AcademicReferencesPage] Failed to copy citation:", copyError);
        }
    }, []);

    const handleCreateShelf = useCallback(() => {
        setEditingShelf(undefined);
        setIsShelfModalOpen(true);
    }, []);

    const handleEditShelf = useCallback((shelf: Collection) => {
        setEditingShelf({
            id: shelf.id,
            name: shelf.name,
            description: shelf.description,
        });
        setIsShelfModalOpen(true);
    }, []);

    const handleSaveShelf = useCallback((name: string, description: string) => {
        if (editingShelf) {
            updateCollection(editingShelf.id, {
                name,
                description,
                kind: "research",
            });
        } else {
            addCollection({
                id: crypto.randomUUID(),
                name,
                description,
                bookIds: [],
                kind: "research",
                createdAt: new Date(),
            });
        }

        setIsShelfModalOpen(false);
        setEditingShelf(undefined);
    }, [editingShelf, addCollection, updateCollection]);

    const handleDeleteShelf = useCallback((shelf: Collection) => {
        if (window.confirm(`Delete research shelf "${shelf.name}"?`)) {
            removeCollection(shelf.id);
        }
    }, [removeCollection]);

    const handleToggleShelfMembership = useCallback((bookId: string, shelfId: string, shouldAdd: boolean) => {
        if (shouldAdd) {
            addBookToCollection(bookId, shelfId);
            return;
        }
        removeBookFromCollection(bookId, shelfId);
    }, [addBookToCollection, removeBookFromCollection]);

    const organizingBookShelfIds = useMemo(() => {
        if (!organizingBook) {
            return new Set<string>();
        }
        return new Set(
            researchShelves
                .filter((shelf) => shelf.bookIds.includes(organizingBook.id))
                .map((shelf) => shelf.id),
        );
    }, [organizingBook, researchShelves]);

    return (
        <div className="ui-page animate-fade-in">
            <div className="mb-8">
                <h1 className="ui-page-title">References</h1>
                <p className="ui-page-subtitle">
                    Organize papers into research shelves and use the top search bar to instantly filter your references.
                </p>
            </div>

            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6 mb-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                        <Layers className="w-5 h-5 text-[color:var(--color-accent)]" />
                        <h2 className="text-base sm:text-lg font-semibold text-[color:var(--color-text-primary)]">
                            Research Shelves
                        </h2>
                    </div>

                    <button
                        onClick={handleCreateShelf}
                        className="inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium bg-[var(--color-accent)] ui-text-accent-contrast hover:opacity-90"
                    >
                        <FolderPlus className="w-4 h-4" />
                        New Research Shelf
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <button
                        onClick={() => setSelectedShelfId("all")}
                        className={cn(
                            "rounded-xl border p-3 text-left transition-colors",
                            selectedShelfId === "all"
                                ? "border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-border))] bg-[var(--color-accent-light)]"
                                : "border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-surface-muted)]",
                        )}
                    >
                        <p className="text-sm font-semibold text-[color:var(--color-text-primary)]">All Papers</p>
                        <p className="text-xs text-[color:var(--color-text-secondary)] mt-1">
                            {academicBooks.length} paper{academicBooks.length === 1 ? "" : "s"}
                        </p>
                    </button>

                    {researchShelves.map((shelf) => {
                        const paperCount = shelfBookCount(shelf, academicBookIds);
                        const isActive = selectedShelfId === shelf.id;

                        return (
                            <div
                                key={shelf.id}
                                className={cn(
                                    "rounded-xl border p-3",
                                    isActive
                                        ? "border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-border))] bg-[var(--color-accent-light)]"
                                        : "border-[var(--color-border)] bg-[var(--color-background)]",
                                )}
                            >
                                <button
                                    onClick={() => setSelectedShelfId(shelf.id)}
                                    className="w-full text-left"
                                >
                                    <p className="text-sm font-semibold text-[color:var(--color-text-primary)] line-clamp-1">
                                        {shelf.name}
                                    </p>
                                    <p className="text-xs text-[color:var(--color-text-secondary)] mt-1 line-clamp-2">
                                        {shelf.description || "No description"}
                                    </p>
                                    <p className="text-xs text-[color:var(--color-text-muted)] mt-2">
                                        {paperCount} paper{paperCount === 1 ? "" : "s"}
                                    </p>
                                </button>

                                <div className="mt-3 flex items-center gap-1.5">
                                    <button
                                        onClick={() => handleEditShelf(shelf)}
                                        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDeleteShelf(shelf)}
                                        className="inline-flex items-center gap-1 rounded-md border border-[var(--color-error)]/30 px-2 py-1 text-xs text-[color:var(--color-error)] hover:bg-[var(--color-error)]/10"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {researchShelves.length === 0 && (
                    <p className="mt-3 text-sm text-[color:var(--color-text-muted)]">
                        No research shelves yet. Create one to group papers by topic.
                    </p>
                )}
            </section>

            <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Filter className="w-5 h-5 text-[color:var(--color-accent)]" />
                    <h2 className="text-base sm:text-lg font-semibold text-[color:var(--color-text-primary)]">
                        Reference Manager
                    </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4">
                    <Dropdown
                        options={authorOptions}
                        value={authorFilter}
                        onChange={setAuthorFilter}
                        className="w-full"
                        dropdownClassName="w-full"
                        variant="default"
                    />
                    <Dropdown
                        options={venueOptions}
                        value={venueFilter}
                        onChange={setVenueFilter}
                        className="w-full"
                        dropdownClassName="w-full"
                        variant="default"
                    />
                    <Dropdown
                        options={SOURCE_FILTER_OPTIONS}
                        value={sourceFilter}
                        onChange={setSourceFilter}
                        className="w-full"
                        dropdownClassName="w-full"
                        variant="default"
                    />
                </div>

                <div className="mb-4 text-xs sm:text-sm text-[color:var(--color-text-secondary)]">
                    {filteredEntries.length} paper{filteredEntries.length === 1 ? "" : "s"}
                    {searchQuery.trim() ? ` matching "${searchQuery.trim()}"` : ""}
                </div>

                {filteredEntries.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background)] py-10 text-center text-sm text-[color:var(--color-text-muted)]">
                        No papers match the current shelf and filters.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredEntries.map((entry) => (
                            <ReferencePaperCard
                                key={entry.book.id}
                                entry={entry}
                                copiedKey={copiedKey}
                                shelfNames={shelfNamesByBookId.get(entry.book.id) || []}
                                onOpen={handleOpenBook}
                                onManageShelves={setOrganizingBook}
                                onCopyCitation={handleCopyCitation}
                            />
                        ))}
                    </div>
                )}
            </section>

            <ShelfModal
                isOpen={isShelfModalOpen}
                shelf={editingShelf}
                onClose={() => {
                    setIsShelfModalOpen(false);
                    setEditingShelf(undefined);
                }}
                onSave={handleSaveShelf}
            />

            <Modal
                isOpen={Boolean(organizingBook)}
                onClose={() => setOrganizingBook(null)}
                size="md"
            >
                <ModalHeader
                    title={organizingBook ? `Organize Shelves` : "Organize Shelves"}
                    onClose={() => setOrganizingBook(null)}
                />
                <ModalBody>
                    {organizingBook && (
                        <>
                            <p className="text-sm text-[color:var(--color-text-secondary)] mb-4">
                                {organizingBook.title}
                            </p>

                            {researchShelves.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background)] p-4 text-sm text-[color:var(--color-text-muted)]">
                                    Create a research shelf first, then assign this paper.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {researchShelves.map((shelf) => {
                                        const isChecked = organizingBookShelfIds.has(shelf.id);
                                        return (
                                            <label
                                                key={shelf.id}
                                                className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={(event) => {
                                                        handleToggleShelfMembership(
                                                            organizingBook.id,
                                                            shelf.id,
                                                            event.target.checked,
                                                        );
                                                    }}
                                                    className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)]"
                                                />
                                                <span className="min-w-0">
                                                    <span className="block text-sm font-medium text-[color:var(--color-text-primary)] line-clamp-1">
                                                        {shelf.name}
                                                    </span>
                                                    {shelf.description && (
                                                        <span className="block text-xs text-[color:var(--color-text-muted)] line-clamp-2">
                                                            {shelf.description}
                                                        </span>
                                                    )}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </ModalBody>
                <ModalFooter>
                    <button
                        onClick={() => setOrganizingBook(null)}
                        className="ui-btn ui-btn-primary"
                    >
                        Done
                    </button>
                </ModalFooter>
            </Modal>
        </div>
    );
}
