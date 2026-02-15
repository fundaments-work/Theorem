import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "./env";
import type { Annotation, Book, VaultIntegrationSettings, VocabularyTerm } from "../types";

const DEFAULT_HIGHLIGHTS_FILE_NAME = "theorem-highlights.md";
const DEFAULT_VOCABULARY_FILE_NAME = "theorem-vocabulary.md";
const BOOK_PAGES_FOLDER_SUFFIX = "-books";
const MAX_BOOK_PAGE_FILE_NAME_LENGTH = 180;

export type VaultSyncResult =
    | { status: "synced"; message: string; filePaths: string[] }
    | { status: "skipped"; message: string }
    | { status: "error"; message: string };

interface SyncVaultMarkdownParams {
    books: Book[];
    annotations: Annotation[];
    vocabularyTerms: VocabularyTerm[];
    settings: VaultIntegrationSettings;
}

interface AppendAnnotationParams {
    annotation: Annotation;
    book?: Book;
    settings: VaultIntegrationSettings;
}

interface ExportSource {
    id: string;
    title: string;
    author: string;
    format: string;
    filePath: string;
}

interface ExportBookPage {
    source: ExportSource;
    annotations: Annotation[];
    fileName: string;
    relativePath: string;
    absolutePath: string;
}

function toSingleLineText(value: string | undefined, fallback = ""): string {
    const normalized = (value || "").replace(/\s+/g, " ").trim();
    return normalized || fallback;
}

function toMultilineText(value: string | undefined): string {
    return (value || "").replace(/\r\n/g, "\n").trim();
}

function toIso(value: Date | string | undefined): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
    }

    if (value !== undefined) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }

    return new Date().toISOString();
}

function toYamlString(value: string): string {
    const escaped = value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
    return `"${escaped}"`;
}

function normalizeMarkdownFileName(value: string, fallback: string): string {
    const candidate = value.trim() || fallback;
    const withExtension = candidate.toLowerCase().endsWith(".md")
        ? candidate
        : `${candidate}.md`;
    return withExtension.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
}

function normalizeFolderName(value: string, fallback: string): string {
    const candidate = value.trim() || fallback;
    const cleaned = candidate
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
        .replace(/\.+$/g, "")
        .trim();
    return cleaned || fallback;
}

function normalizeFileSegment(value: string, fallback: string): string {
    const singleLine = toSingleLineText(value, fallback);
    const cleaned = singleLine
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
        .replace(/\.+$/g, "")
        .trim();
    return cleaned || fallback;
}

function normalizeDirectoryPath(value: string): string {
    const candidate = value.trim();
    if (!candidate.startsWith("file://")) {
        return candidate;
    }

    try {
        const url = new URL(candidate);
        if (url.protocol !== "file:") {
            return candidate;
        }

        const decodedPath = decodeURIComponent(url.pathname);
        if (url.host) {
            return `//${url.host}${decodedPath}`;
        }

        // Windows file URI shape: file:///C:/Users/...
        if (/^\/[A-Za-z]:\//.test(decodedPath)) {
            return decodedPath.slice(1);
        }

        return decodedPath;
    } catch {
        return candidate;
    }
}

function toShortHash(input: string): string {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function truncateSegment(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return value.slice(0, maxLength).trim();
}

function clampFileNameLength(fileName: string, maxLength: number): string {
    if (fileName.length <= maxLength) {
        return fileName;
    }

    const extension = ".md";
    const withoutExtension = fileName.endsWith(extension)
        ? fileName.slice(0, -extension.length)
        : fileName;
    const clampedBase = withoutExtension.slice(0, Math.max(8, maxLength - extension.length)).trim();
    return `${clampedBase}${extension}`;
}

function toErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        const message = error.message.trim();
        if (message) {
            return message;
        }
    }

    if (typeof error === "string") {
        const message = error.trim();
        if (message) {
            return message;
        }
    }

    if (typeof error === "object" && error !== null) {
        const candidate = Reflect.get(error, "message");
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }

        try {
            const serialized = JSON.stringify(error);
            if (serialized && serialized !== "{}") {
                return serialized;
            }
        } catch {
            // ignore serialization failures and use fallback message
        }
    }

    return fallback;
}

function removeMarkdownExtension(fileName: string): string {
    return fileName.replace(/\.md$/i, "");
}

function joinPath(basePath: string, part: string): string {
    const separator = basePath.includes("\\") ? "\\" : "/";
    const trimmedBase = basePath.endsWith("/") || basePath.endsWith("\\")
        ? basePath.slice(0, -1)
        : basePath;
    return `${trimmedBase}${separator}${part}`;
}

function toRelativeMarkdownLink(path: string): string {
    return path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function toBlockQuote(value: string): string {
    return value
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
}

function toLinkLabel(value: string): string {
    return value.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function getHighlightAnnotations(annotations: Annotation[]): Annotation[] {
    return annotations.filter((annotation) => annotation.type === "highlight" || annotation.type === "note");
}

function sortAnnotations(annotations: Annotation[]): Annotation[] {
    return [...annotations].sort((left, right) => {
        const leftTime = new Date(left.createdAt).getTime();
        const rightTime = new Date(right.createdAt).getTime();
        if (leftTime !== rightTime) {
            return leftTime - rightTime;
        }
        return left.id.localeCompare(right.id);
    });
}

function buildFallbackSource(bookId: string): ExportSource {
    const sourceId = toSingleLineText(bookId, "unknown-source");

    if (sourceId.startsWith("rss:")) {
        const articleId = sourceId.slice(4);
        return {
            id: sourceId,
            title: articleId ? `RSS Article ${articleId}` : "RSS Article",
            author: "Unknown Author",
            format: "rss",
            filePath: "",
        };
    }

    return {
        id: sourceId,
        title: `Unknown Source ${sourceId}`,
        author: "Unknown Author",
        format: "unknown",
        filePath: "",
    };
}

function buildExportSource(bookId: string, booksById: Map<string, Book>): ExportSource {
    const book = booksById.get(bookId);
    if (!book) {
        return buildFallbackSource(bookId);
    }

    return {
        id: book.id,
        title: toSingleLineText(book.title, "Untitled Source"),
        author: toSingleLineText(book.author, "Unknown Author"),
        format: book.format,
        filePath: toSingleLineText(book.filePath, ""),
    };
}

function buildUniqueFileName(
    source: ExportSource,
    usedNames: Set<string>,
): string {
    const safeTitle = truncateSegment(
        normalizeFileSegment(source.title, "Untitled Source"),
        80,
    );
    const safeAuthor = truncateSegment(
        normalizeFileSegment(source.author, "Unknown Author"),
        48,
    );
    const idSeed = normalizeFileSegment(source.id, "source");
    const shortId = toShortHash(idSeed || `${safeTitle}:${safeAuthor}`);
    const base = `${safeTitle} - ${safeAuthor} (${shortId})`;
    let candidate = clampFileNameLength(`${base}.md`, MAX_BOOK_PAGE_FILE_NAME_LENGTH);
    let index = 2;

    while (usedNames.has(candidate.toLowerCase())) {
        candidate = clampFileNameLength(`${base} ${index}.md`, MAX_BOOK_PAGE_FILE_NAME_LENGTH);
        index += 1;
    }

    usedNames.add(candidate.toLowerCase());
    return candidate;
}

function buildBookPageMarkdown(
    source: ExportSource,
    annotations: Annotation[],
    generatedAt: string,
): string {
    const sorted = sortAnnotations(annotations);
    const highlightsCount = sorted.filter((annotation) => annotation.type === "highlight").length;
    const notesCount = sorted.filter((annotation) => annotation.type === "note").length;

    const lines: string[] = [
        "---",
        `title: ${toYamlString(source.title)}`,
        `type: ${toYamlString("theorem-book-highlights")}`,
        `theorem_book_id: ${toYamlString(source.id)}`,
        `author: ${toYamlString(source.author)}`,
        `format: ${toYamlString(source.format)}`,
        `source_path: ${toYamlString(source.filePath)}`,
        `generated_at: ${toYamlString(generatedAt)}`,
        `annotations_total: ${sorted.length}`,
        `highlights_total: ${highlightsCount}`,
        `notes_total: ${notesCount}`,
        "tags:",
        "  - theorem",
        "  - highlights",
        "  - notes",
        "---",
        "",
        `# ${source.title}`,
        "",
        `- Author: ${source.author}`,
        `- Format: ${source.format}`,
        `- Source ID: \`${source.id}\``,
        `- Exported at: ${generatedAt}`,
        "",
        "## Highlights and Notes",
        "",
    ];

    if (sorted.length === 0) {
        lines.push("_No highlights or notes yet._", "");
        return lines.join("\n");
    }

    sorted.forEach((annotation, index) => {
        const annotationKind = annotation.type === "note" ? "Note" : "Highlight";
        const quote = toMultilineText(annotation.selectedText);
        const note = toMultilineText(annotation.noteContent);

        lines.push(`### ${index + 1}. ${annotationKind}`);
        lines.push(`- Annotation ID: \`${annotation.id}\``);
        lines.push(`- Created: ${toIso(annotation.createdAt)}`);
        if (annotation.updatedAt) {
            lines.push(`- Updated: ${toIso(annotation.updatedAt)}`);
        }
        if (annotation.color) {
            lines.push(`- Color: ${annotation.color}`);
        }
        const location = toSingleLineText(annotation.location);
        if (location) {
            lines.push(`- Location: ${location}`);
        }
        if (annotation.pageNumber !== undefined) {
            lines.push(`- Page: ${annotation.pageNumber}`);
        }
        lines.push("");

        if (quote) {
            lines.push("**Quote**", "", toBlockQuote(quote), "");
        }

        if (note) {
            lines.push("**Note**", "", note, "");
        }

        lines.push("---", "");
    });

    return lines.join("\n");
}

function buildHighlightsIndexMarkdown(
    pages: ExportBookPage[],
    generatedAt: string,
): string {
    const sortedPages = [...pages].sort((left, right) => left.source.title.localeCompare(right.source.title));
    const totalAnnotations = sortedPages.reduce((count, page) => count + page.annotations.length, 0);

    const lines: string[] = [
        "---",
        `title: ${toYamlString("Theorem Highlights Index")}`,
        `type: ${toYamlString("theorem-highlights-index")}`,
        `generated_at: ${toYamlString(generatedAt)}`,
        `books_total: ${sortedPages.length}`,
        `annotations_total: ${totalAnnotations}`,
        "tags:",
        "  - theorem",
        "  - highlights",
        "  - index",
        "---",
        "",
        "# Theorem Highlights",
        "",
        `- Exported at: ${generatedAt}`,
        `- Books: ${sortedPages.length}`,
        `- Highlights and notes: ${totalAnnotations}`,
        "",
        "## Book Pages",
        "",
    ];

    if (sortedPages.length === 0) {
        lines.push("_No highlights or notes found._", "");
        return lines.join("\n");
    }

    for (const page of sortedPages) {
        const linkLabel = toLinkLabel(page.source.title);
        const linkPath = toRelativeMarkdownLink(page.relativePath);
        lines.push(
            `- [${linkLabel}](${linkPath}) | ${page.source.author} | ${page.annotations.length} entries`,
        );
    }

    lines.push("");
    return lines.join("\n");
}

function collectDefinitions(term: VocabularyTerm): string[] {
    const definitions: string[] = [];
    const seen = new Set<string>();

    for (const meaning of term.meanings) {
        for (const definition of meaning.definitions) {
            const normalized = toSingleLineText(definition);
            if (!normalized) {
                continue;
            }
            if (seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            definitions.push(normalized);
        }
    }

    return definitions;
}

function buildVocabularyMarkdown(terms: VocabularyTerm[], generatedAt: string): string {
    const sortedTerms = [...terms].sort((left, right) => left.term.localeCompare(right.term));
    const languages = Array.from(
        new Set(sortedTerms.map((term) => toSingleLineText(term.language)).filter(Boolean)),
    ).sort((left, right) => left.localeCompare(right));

    const lines: string[] = [
        "---",
        `title: ${toYamlString("Theorem Vocabulary")}`,
        `type: ${toYamlString("theorem-vocabulary")}`,
        `generated_at: ${toYamlString(generatedAt)}`,
        `terms_total: ${sortedTerms.length}`,
        "languages:",
        ...(languages.length > 0
            ? languages.map((language) => `  - ${toYamlString(language)}`)
            : ["  - \"unknown\""]),
        "tags:",
        "  - theorem",
        "  - vocabulary",
        "---",
        "",
        "# Theorem Vocabulary",
        "",
        `- Exported at: ${generatedAt}`,
        `- Terms: ${sortedTerms.length}`,
        "",
    ];

    if (sortedTerms.length === 0) {
        lines.push("_No vocabulary terms available._", "");
        return lines.join("\n");
    }

    sortedTerms.forEach((term, index) => {
        const providers = Array.from(new Set(term.providerHistory)).sort((left, right) => left.localeCompare(right));
        const definitions = collectDefinitions(term);
        const contexts = Array.from(
            new Set(term.contexts.map((context) => toSingleLineText(context.label || context.sourceId)).filter(Boolean)),
        );
        const tags = Array.from(new Set(term.tags.map((tag) => toSingleLineText(tag)).filter(Boolean)));
        const note = toMultilineText(term.personalNote);

        lines.push(`## ${index + 1}. ${term.term}`);
        lines.push(`- Term ID: \`${term.id}\``);
        lines.push(`- Language: ${toSingleLineText(term.language, "unknown")}`);
        if (term.phonetic) {
            lines.push(`- Phonetic: /${toSingleLineText(term.phonetic)}/`);
        }
        lines.push(`- Lookup count: ${Math.max(1, term.lookupCount || 1)}`);
        lines.push(`- Created: ${toIso(term.createdAt)}`);
        if (term.updatedAt) {
            lines.push(`- Updated: ${toIso(term.updatedAt)}`);
        }
        if (providers.length > 0) {
            lines.push(`- Providers: ${providers.join(", ")}`);
        }
        if (contexts.length > 0) {
            lines.push(`- Sources: ${contexts.join(", ")}`);
        }
        if (tags.length > 0) {
            lines.push(`- Tags: ${tags.join(", ")}`);
        }
        lines.push("");

        if (definitions.length > 0) {
            lines.push("### Definitions", "");
            definitions.forEach((definition, definitionIndex) => {
                lines.push(`${definitionIndex + 1}. ${definition}`);
            });
            lines.push("");
        }

        if (note) {
            lines.push("### Personal Note", "", note, "");
        }

        lines.push("---", "");
    });

    return lines.join("\n");
}

function buildBookPages(
    books: Book[],
    annotations: Annotation[],
    vaultPath: string,
    pagesDirectoryName: string,
): ExportBookPage[] {
    const booksById = new Map(books.map((book) => [book.id, book]));
    const groupedAnnotations = new Map<string, Annotation[]>();

    for (const annotation of getHighlightAnnotations(annotations)) {
        const existing = groupedAnnotations.get(annotation.bookId);
        if (existing) {
            existing.push(annotation);
        } else {
            groupedAnnotations.set(annotation.bookId, [annotation]);
        }
    }

    const usedFileNames = new Set<string>();
    const pagesDirectoryPath = joinPath(vaultPath, pagesDirectoryName);

    return Array.from(groupedAnnotations.entries()).map(([bookId, bookAnnotations]) => {
        const source = buildExportSource(bookId, booksById);
        const fileName = buildUniqueFileName(source, usedFileNames);
        const relativePath = `${pagesDirectoryName}/${fileName}`;
        const absolutePath = joinPath(pagesDirectoryPath, fileName);

        return {
            source,
            annotations: bookAnnotations,
            fileName,
            relativePath,
            absolutePath,
        };
    });
}

export async function syncVaultMarkdownSnapshot({
    books,
    annotations,
    vocabularyTerms,
    settings,
}: SyncVaultMarkdownParams): Promise<VaultSyncResult> {
    if (!settings.enabled) {
        return { status: "skipped", message: "Markdown export sync is disabled." };
    }

    const vaultPath = normalizeDirectoryPath(settings.vaultPath);
    if (!vaultPath) {
        return { status: "skipped", message: "Export folder is not configured." };
    }

    if (!isTauri()) {
        return { status: "skipped", message: "Markdown export sync is available in desktop mode only." };
    }

    const highlightsFileName = normalizeMarkdownFileName(
        settings.highlightsFileName,
        DEFAULT_HIGHLIGHTS_FILE_NAME,
    );
    const vocabularyFileName = normalizeMarkdownFileName(
        settings.vocabularyFileName,
        DEFAULT_VOCABULARY_FILE_NAME,
    );
    const highlightsBaseName = normalizeFolderName(
        removeMarkdownExtension(highlightsFileName),
        removeMarkdownExtension(DEFAULT_HIGHLIGHTS_FILE_NAME),
    );
    const pagesDirectoryName = `${highlightsBaseName}${BOOK_PAGES_FOLDER_SUFFIX}`;
    const pagesDirectoryPath = joinPath(vaultPath, pagesDirectoryName);
    const highlightsIndexPath = joinPath(vaultPath, highlightsFileName);
    const vocabularyPath = joinPath(vaultPath, vocabularyFileName);
    const generatedAt = new Date().toISOString();

    try {
        await mkdir(vaultPath, { recursive: true });
        await mkdir(pagesDirectoryPath, { recursive: true });

        const pages = buildBookPages(books, annotations, vaultPath, pagesDirectoryName);

        await Promise.all(
            pages.map((page) => (
                writeTextFile(
                    page.absolutePath,
                    buildBookPageMarkdown(page.source, page.annotations, generatedAt),
                )
            )),
        );

        await writeTextFile(
            highlightsIndexPath,
            buildHighlightsIndexMarkdown(pages, generatedAt),
        );

        await writeTextFile(
            vocabularyPath,
            buildVocabularyMarkdown(vocabularyTerms, generatedAt),
        );

        const highlightsTotal = pages.reduce((sum, page) => sum + page.annotations.length, 0);
        return {
            status: "synced",
            message: `Synced ${pages.length} book page(s), ${highlightsTotal} highlight/note item(s), and ${vocabularyTerms.length} vocabulary term(s).`,
            filePaths: [
                highlightsIndexPath,
                ...pages.map((page) => page.absolutePath),
                vocabularyPath,
            ],
        };
    } catch (error) {
        const message = toErrorMessage(
            error,
            "Failed to sync markdown in selected export folder.",
        );
        return {
            status: "error",
            message,
        };
    }
}

export async function appendAnnotationToVaultMarkdown({
    annotation,
    book,
    settings,
}: AppendAnnotationParams): Promise<VaultSyncResult> {
    return syncVaultMarkdownSnapshot({
        books: book ? [book] : [],
        annotations: [annotation],
        vocabularyTerms: [],
        settings,
    });
}
