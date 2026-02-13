import { useCallback, useEffect, useMemo, useState } from "react";
import {
    cn,
    generateReferenceCitation,
    rankByFuzzyQuery,
    sortReferenceItems,
    toReferenceItem,
    useLibraryStore,
    useUIStore,
    type Annotation,
    type Book,
    type CitationFormat,
    type Collection,
    type ReferenceItem,
    type ReferenceSortMode,
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
    Link2,
    Pencil,
    Trash2,
} from "lucide-react";
import {
    copyToClipboard,
    formatDateLabel,
} from "./utils";

type ShelfSelection = "all" | string;
type SourceFilter = "all" | "arxiv" | "pubmed" | "manual" | "library";
type TypeFilter = "all" | "book" | "paper";
const MAX_VISIBLE_REFERENCES = 180;

interface ReferenceEntry {
    book: Book;
    reference: ReferenceItem;
    linkedAnnotations: Annotation[];
    linkedNotes: Annotation[];
    linkedBookmarks: Annotation[];
}

const TYPE_FILTER_OPTIONS: Array<DropdownOption<TypeFilter>> = [
    { value: "all", label: "All Types" },
    { value: "paper", label: "Papers" },
    { value: "book", label: "Books / Docs" },
];

const SOURCE_FILTER_OPTIONS: Array<DropdownOption<SourceFilter>> = [
    { value: "all", label: "All Sources" },
    { value: "arxiv", label: "arXiv" },
    { value: "pubmed", label: "PubMed" },
    { value: "manual", label: "Manual" },
    { value: "library", label: "Library" },
];

const SORT_OPTIONS: Array<DropdownOption<ReferenceSortMode>> = [
    { value: "relevance", label: "Relevance" },
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "citations_desc", label: "Most Cited" },
    { value: "citations_asc", label: "Least Cited" },
    { value: "title_asc", label: "Title A-Z" },
    { value: "title_desc", label: "Title Z-A" },
];

function sourceLabel(source: ReferenceItem["source"]): string {
    switch (source) {
        case "arxiv":
            return "arXiv";
        case "pubmed":
            return "PubMed";
        case "manual":
            return "Manual";
        default:
            return "Library";
    }
}

function resolveVenue(reference: ReferenceItem): string {
    return (reference.journal || reference.conference || "").trim();
}

function resolveExternalUrl(reference: ReferenceItem): string | undefined {
    const value = (reference.url || "").trim();
    if (!value) return undefined;
    return value.startsWith("http://") || value.startsWith("https://")
        ? value
        : undefined;
}

function shelfReferenceCount(shelf: Collection, referenceBookIds: Set<string>): number {
    return shelf.bookIds.filter((bookId) => referenceBookIds.has(bookId)).length;
}

function ReferenceCard({
    entry,
    copiedKey,
    shelfNames,
    onOpen,
    onManageShelves,
    onCopyCitation,
    onJumpToNotes,
}: {
    entry: ReferenceEntry;
    copiedKey: string | null;
    shelfNames: string[];
    onOpen: (bookId: string) => void;
    onManageShelves: (book: Book) => void;
    onCopyCitation: (reference: ReferenceItem, format: CitationFormat) => void;
    onJumpToNotes: (bookId: string) => void;
}) {
    const { book, reference, linkedNotes, linkedBookmarks } = entry;
    const externalUrl = resolveExternalUrl(reference);
    const venue = resolveVenue(reference);
    const fallbackAddedAt = (() => {
        if (book.addedAt instanceof Date) {
            return book.addedAt.toISOString();
        }
        if (typeof book.addedAt === "string") {
            return book.addedAt;
        }
        return undefined;
    })();
    const publishedLabel = formatDateLabel(
        reference.publishedDate || book.publishedDate || fallbackAddedAt,
    );

    return (
        <article className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
            <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="inline-flex items-center rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[color:var(--color-accent)] uppercase">
                                {reference.type === "paper" ? "Paper" : "Book"}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[color:var(--color-text-secondary)] uppercase">
                                {sourceLabel(reference.source)}
                            </span>
                            {publishedLabel && (
                                <span className="text-xs text-[color:var(--color-text-muted)]">{publishedLabel}</span>
                            )}
                            {typeof reference.citationCount === "number" && (
                                <span className="text-xs text-[color:var(--color-text-muted)]">
                                    {reference.citationCount} citations
                                </span>
                            )}
                        </div>
                        <h3 className="text-sm sm:text-base font-semibold text-[color:var(--color-text-primary)] leading-snug">
                            {reference.title}
                        </h3>
                        <p className="mt-1 text-xs sm:text-sm text-[color:var(--color-text-secondary)] line-clamp-2">
                            {reference.authors.length > 0 ? reference.authors.join(", ") : "Unknown authors"}
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
                    {venue && <span>{venue}</span>}
                    {reference.doi && <span className="truncate max-w-full">DOI: {reference.doi}</span>}
                    {linkedNotes.length > 0 && <span>{linkedNotes.length} linked note(s)</span>}
                    {linkedBookmarks.length > 0 && <span>{linkedBookmarks.length} linked bookmark(s)</span>}
                </div>

                {reference.abstract && (
                    <p className="text-xs sm:text-sm text-[color:var(--color-text-secondary)] leading-relaxed line-clamp-3">
                        {reference.abstract}
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
                        onClick={() => onCopyCitation(reference, "apa")}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        {copiedKey === `${reference.id}:apa` ? "Copied APA" : "Copy APA"}
                    </button>

                    <button
                        onClick={() => onCopyCitation(reference, "bibtex")}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        {copiedKey === `${reference.id}:bibtex` ? "Copied BibTeX" : "Copy BibTeX"}
                    </button>

                    <button
                        onClick={() => onCopyCitation(reference, "mla")}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        {copiedKey === `${reference.id}:mla` ? "Copied MLA" : "Copy MLA"}
                    </button>

                    <button
                        onClick={() => onJumpToNotes(book.id)}
                        disabled={linkedNotes.length === 0}
                        className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border",
                            linkedNotes.length === 0
                                ? "border-[var(--color-border)] text-[color:var(--color-text-muted)] bg-[var(--color-surface-muted)] cursor-not-allowed"
                                : "border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)]"
                        )}
                    >
                        <Link2 className="w-3.5 h-3.5" />
                        {linkedNotes.length > 0 ? `Linked Notes (${linkedNotes.length})` : "No Linked Notes"}
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
    const annotations = useLibraryStore((state) => state.annotations);
    const collections = useLibraryStore((state) => state.collections);
    const addCollection = useLibraryStore((state) => state.addCollection);
    const updateCollection = useLibraryStore((state) => state.updateCollection);
    const removeCollection = useLibraryStore((state) => state.removeCollection);
    const addBookToCollection = useLibraryStore((state) => state.addBookToCollection);
    const removeBookFromCollection = useLibraryStore((state) => state.removeBookFromCollection);
    const setRoute = useUIStore((state) => state.setRoute);
    const searchQuery = useUIStore((state) => state.searchQuery);

    const [selectedShelfId, setSelectedShelfId] = useState<ShelfSelection>("all");
    const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
    const [authorQuery, setAuthorQuery] = useState("");
    const [venueQuery, setVenueQuery] = useState("");
    const [sortBy, setSortBy] = useState<ReferenceSortMode>("relevance");
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const [isShelfModalOpen, setIsShelfModalOpen] = useState(false);
    const [editingShelf, setEditingShelf] = useState<{ id: string; name: string; description?: string } | undefined>();
    const [organizingBook, setOrganizingBook] = useState<Book | null>(null);

    const entries = useMemo<ReferenceEntry[]>(() => {
        const annotationsByReference = new Map<string, Annotation[]>();
        for (const annotation of annotations) {
            const referenceId = annotation.referenceId || annotation.bookId;
            if (!referenceId) {
                continue;
            }
            if (!annotationsByReference.has(referenceId)) {
                annotationsByReference.set(referenceId, []);
            }
            annotationsByReference.get(referenceId)?.push(annotation);
        }

        return books
            .map((book) => {
                const reference = toReferenceItem(book);
                const linkedAnnotations = annotationsByReference.get(reference.bookId) || [];
                const linkedNotes = linkedAnnotations.filter((annotation) => (
                    annotation.type === "highlight" || annotation.type === "note"
                ));
                const linkedBookmarks = linkedAnnotations.filter((annotation) => annotation.type === "bookmark");
                return {
                    book,
                    reference,
                    linkedAnnotations,
                    linkedNotes,
                    linkedBookmarks,
                };
            })
            .sort((a, b) => new Date(b.book.addedAt).getTime() - new Date(a.book.addedAt).getTime());
    }, [annotations, books]);

    const referenceBookIds = useMemo(
        () => new Set(entries.map((entry) => entry.book.id)),
        [entries],
    );

    const researchShelves = useMemo(
        () => collections.filter((collection) => collection.kind === "research"),
        [collections],
    );

    useEffect(() => {
        if (selectedShelfId === "all") {
            return;
        }
        if (!researchShelves.some((shelf) => shelf.id === selectedShelfId)) {
            setSelectedShelfId("all");
        }
    }, [selectedShelfId, researchShelves]);

    const filteredEntries = useMemo<ReferenceEntry[]>(() => {
        let scoped = entries;
        const normalizedAuthorQuery = authorQuery.trim().toLowerCase();
        const normalizedVenueQuery = venueQuery.trim().toLowerCase();

        if (selectedShelfId !== "all") {
            const selectedShelf = researchShelves.find((shelf) => shelf.id === selectedShelfId);
            if (!selectedShelf) {
                scoped = [];
            } else {
                const allowedBookIds = new Set(selectedShelf.bookIds);
                scoped = scoped.filter((entry) => allowedBookIds.has(entry.book.id));
            }
        }

        if (typeFilter !== "all") {
            scoped = scoped.filter((entry) => entry.reference.type === typeFilter);
        }

        if (sourceFilter !== "all") {
            scoped = scoped.filter((entry) => entry.reference.source === sourceFilter);
        }

        if (normalizedAuthorQuery) {
            scoped = scoped.filter((entry) => (
                entry.reference.authors.some((author) => author.toLowerCase().includes(normalizedAuthorQuery))
            ));
        }

        if (normalizedVenueQuery) {
            scoped = scoped.filter((entry) => (
                resolveVenue(entry.reference).toLowerCase().includes(normalizedVenueQuery)
            ));
        }

        const trimmedQuery = searchQuery.trim();
        if (trimmedQuery) {
            const ranked = rankByFuzzyQuery(
                scoped.map((entry) => ({
                    entry,
                    title: entry.reference.title,
                    authors: entry.reference.authors.join(" "),
                    venue: resolveVenue(entry.reference),
                    doi: entry.reference.doi || "",
                    tags: entry.reference.tags.join(" "),
                })),
                trimmedQuery,
                {
                    keys: [
                        { name: "title", weight: 0.45 },
                        { name: "authors", weight: 0.25 },
                        { name: "venue", weight: 0.15 },
                        { name: "doi", weight: 0.1 },
                        { name: "tags", weight: 0.05 },
                    ],
                },
            ).map(({ item }) => item.entry);

            if (sortBy === "relevance") {
                return ranked;
            }

            scoped = ranked;
        }

        const effectiveSort: ReferenceSortMode = sortBy === "relevance" ? "newest" : sortBy;
        const entryById = new Map(scoped.map((entry) => [entry.reference.id, entry]));
        const sortedReferences = sortReferenceItems(
            scoped.map((entry) => entry.reference),
            effectiveSort,
        );

        return sortedReferences
            .map((reference) => entryById.get(reference.id))
            .filter((entry): entry is ReferenceEntry => Boolean(entry));
    }, [
        authorQuery,
        entries,
        researchShelves,
        searchQuery,
        selectedShelfId,
        sortBy,
        sourceFilter,
        typeFilter,
        venueQuery,
    ]);

    const visibleEntries = useMemo(() => {
        if (filteredEntries.length <= MAX_VISIBLE_REFERENCES) {
            return filteredEntries;
        }
        return filteredEntries.slice(0, MAX_VISIBLE_REFERENCES);
    }, [filteredEntries]);

    const shelfNamesByBookId = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const shelf of researchShelves) {
            for (const bookId of shelf.bookIds) {
                if (!referenceBookIds.has(bookId)) {
                    continue;
                }
                if (!map.has(bookId)) {
                    map.set(bookId, []);
                }
                map.get(bookId)?.push(shelf.name);
            }
        }
        return map;
    }, [researchShelves, referenceBookIds]);

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

    const handleOpenBook = useCallback((bookId: string) => {
        setRoute("reader", bookId);
    }, [setRoute]);

    const handleJumpToNotes = useCallback((bookId: string) => {
        setRoute("annotations", bookId);
    }, [setRoute]);

    const handleCopyCitation = useCallback(async (reference: ReferenceItem, format: CitationFormat) => {
        try {
            const citation = generateReferenceCitation(reference, format);
            await copyToClipboard(citation);
            setCopiedKey(`${reference.id}:${format}`);
            window.setTimeout(() => {
                setCopiedKey((current) => (current === `${reference.id}:${format}` ? null : current));
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
    }, [addCollection, editingShelf, updateCollection]);

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

    return (
        <div className="ui-page animate-fade-in">
            <div className="mb-8">
                <h1 className="ui-page-title">References</h1>
                <p className="ui-page-subtitle">
                    Manage citations for all library books and papers, then organize active workstreams in research shelves.
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
                                : "border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-surface-muted)]"
                        )}
                    >
                        <p className="text-sm font-semibold text-[color:var(--color-text-primary)]">All References</p>
                        <p className="text-xs text-[color:var(--color-text-secondary)] mt-1">
                            {entries.length} item{entries.length === 1 ? "" : "s"}
                        </p>
                    </button>

                    {researchShelves.map((shelf) => {
                        const itemCount = shelfReferenceCount(shelf, referenceBookIds);
                        const isActive = selectedShelfId === shelf.id;

                        return (
                            <div
                                key={shelf.id}
                                className={cn(
                                    "rounded-xl border p-3",
                                    isActive
                                        ? "border-[color-mix(in_srgb,var(--color-accent)_45%,var(--color-border))] bg-[var(--color-accent-light)]"
                                        : "border-[var(--color-border)] bg-[var(--color-background)]"
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
                                        {itemCount} item{itemCount === 1 ? "" : "s"}
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
                        No research shelves yet. Create one to group books and papers for each project.
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

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 mb-4">
                    <Dropdown
                        options={TYPE_FILTER_OPTIONS}
                        value={typeFilter}
                        onChange={setTypeFilter}
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
                    <Dropdown
                        options={SORT_OPTIONS}
                        value={sortBy}
                        onChange={setSortBy}
                        className="w-full"
                        dropdownClassName="w-full"
                        variant="default"
                    />
                    <input
                        type="text"
                        value={authorQuery}
                        onChange={(event) => setAuthorQuery(event.target.value)}
                        placeholder="Filter author (contains)"
                        className="ui-input w-full"
                    />
                    <input
                        type="text"
                        value={venueQuery}
                        onChange={(event) => setVenueQuery(event.target.value)}
                        placeholder="Filter venue/publisher"
                        className="ui-input w-full"
                    />
                </div>

                <div className="mb-4 text-xs sm:text-sm text-[color:var(--color-text-secondary)]">
                    {filteredEntries.length} reference{filteredEntries.length === 1 ? "" : "s"}
                    {searchQuery.trim() ? ` matching "${searchQuery.trim()}"` : ""}
                </div>

                {filteredEntries.length > MAX_VISIBLE_REFERENCES && (
                    <div className="mb-4 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-sm text-[color:var(--color-text-secondary)]">
                        Showing latest {MAX_VISIBLE_REFERENCES} results. Narrow with shelf, top search, or filters.
                    </div>
                )}

                {filteredEntries.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-background)] py-10 text-center text-sm text-[color:var(--color-text-muted)]">
                        No references match the current shelf and filters.
                    </div>
                ) : (
                    <div className="space-y-3">
                        {visibleEntries.map((entry) => (
                            <ReferenceCard
                                key={entry.reference.id}
                                entry={entry}
                                copiedKey={copiedKey}
                                shelfNames={shelfNamesByBookId.get(entry.book.id) || []}
                                onOpen={handleOpenBook}
                                onManageShelves={setOrganizingBook}
                                onCopyCitation={handleCopyCitation}
                                onJumpToNotes={handleJumpToNotes}
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
                    title={organizingBook ? "Organize Shelves" : "Organize Shelves"}
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
                                    Create a research shelf first, then assign this reference.
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
