import { exists, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "./env";
import type {
    Annotation,
    Book,
    HighlightColor,
    RssArticle,
    VaultIntegrationSettings,
    VocabularyTerm,
} from "../types";

const DEFAULT_HIGHLIGHTS_FILE_NAME = "theorem-highlights.md";
const DEFAULT_VOCABULARY_FILE_NAME = "theorem-vocabulary.md";
const BOOK_PAGES_FOLDER_SUFFIX = "-books";
const MAX_BOOK_PAGE_FILE_NAME_LENGTH = 180;
const FALLBACK_HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
    yellow: "#f4b400",
    green: "#2e7d32",
    blue: "#1976d2",
    red: "#d32f2f",
    orange: "#f57c00",
    purple: "#7b1fa2",
};

export type VaultSyncResult =
    | { status: "synced"; message: string; filePaths: string[] }
    | { status: "skipped"; message: string }
    | { status: "error"; message: string };

interface SyncVaultMarkdownParams {
    books: Book[];
    annotations: Annotation[];
    vocabularyTerms: VocabularyTerm[];
    rssArticles?: RssArticle[];
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

function toBlockQuote(value: string): string {
    return value
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function isHighlightColor(value: string | undefined): value is HighlightColor {
    if (!value) {
        return false;
    }
    return value in FALLBACK_HIGHLIGHT_COLORS;
}

function readRootCssVariable(variableName: string): string | null {
    if (typeof window === "undefined" || typeof document === "undefined") {
        return null;
    }
    const resolved = window.getComputedStyle(document.documentElement)
        .getPropertyValue(variableName)
        .trim();
    return resolved || null;
}

function getAnnotationHighlightColor(annotation: Annotation): string | null {
    if (!isHighlightColor(annotation.color)) {
        return null;
    }

    return readRootCssVariable(`--highlight-${annotation.color}`)
        ?? FALLBACK_HIGHLIGHT_COLORS[annotation.color];
}

function toHighlightedQuote(quote: string, color: string | null): string {
    if (!color) {
        return toBlockQuote(quote);
    }

    const escaped = escapeHtml(quote).replace(/\n/g, "<br />");
    return `<mark style="background-color: ${color}; color: inherit;">${escaped}</mark>`;
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
        return {
            id: sourceId,
            title: "RSS Article",
            author: "Unknown Author",
            format: "rss",
            filePath: "",
        };
    }

    return {
        id: sourceId,
        title: "Untitled Document",
        author: "Unknown Author",
        format: "unknown",
        filePath: "",
    };
}

function buildExportSource(
    bookId: string,
    booksById: Map<string, Book>,
    rssArticlesById: Map<string, RssArticle>,
): ExportSource {
    const rssArticleId = bookId.startsWith("rss:")
        ? toSingleLineText(bookId.slice("rss:".length))
        : "";
    const rssArticle = rssArticleId ? rssArticlesById.get(rssArticleId) : undefined;

    const book = booksById.get(bookId);
    if (book) {
        const defaultTitle = toSingleLineText(book.title, "Untitled Source");
        const fallbackTitle = toSingleLineText(rssArticle?.title, defaultTitle);
        const isSyntheticRssTitle = defaultTitle === bookId || /^RSS Article(\s|$)/i.test(defaultTitle);

        return {
            id: book.id,
            title: isSyntheticRssTitle ? fallbackTitle : defaultTitle,
            author: toSingleLineText(rssArticle?.author, toSingleLineText(book.author, "Unknown Author")),
            format: book.format,
            filePath: toSingleLineText(rssArticle?.url, toSingleLineText(book.filePath, "")),
        };
    }

    if (rssArticle) {
        return {
            id: bookId,
            title: toSingleLineText(rssArticle.title, "RSS Article"),
            author: toSingleLineText(rssArticle.author, "Unknown Author"),
            format: "rss",
            filePath: toSingleLineText(rssArticle.url, ""),
        };
    }

    return buildFallbackSource(bookId);
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
        const color = getAnnotationHighlightColor(annotation);

        lines.push(`### ${index + 1}. ${annotationKind}`);
        lines.push(`- Created: ${toIso(annotation.createdAt)}`);
        if (annotation.updatedAt) {
            lines.push(`- Updated: ${toIso(annotation.updatedAt)}`);
        }
        if (color) {
            lines.push(`- Color: ${color}`);
        }
        lines.push("");

        if (quote) {
            lines.push("**Quote**", "", toHighlightedQuote(quote, color), "");
        }

        if (note) {
            lines.push("**Note**", "", note, "");
        }

        lines.push("---", "");
    });

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
    rssArticles: RssArticle[],
    annotations: Annotation[],
    vaultPath: string,
    pagesDirectoryName: string,
): ExportBookPage[] {
    const booksById = new Map(books.map((book) => [book.id, book]));
    const rssArticlesById = new Map(rssArticles.map((article) => [article.id, article]));
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
        const source = buildExportSource(bookId, booksById, rssArticlesById);
        const fileName = buildUniqueFileName(source, usedFileNames);
        const absolutePath = joinPath(pagesDirectoryPath, fileName);

        return {
            source,
            annotations: bookAnnotations,
            fileName,
            absolutePath,
        };
    });
}

export async function syncVaultMarkdownSnapshot({
    books,
    annotations,
    vocabularyTerms,
    rssArticles = [],
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
    const legacyHighlightsIndexPath = joinPath(vaultPath, highlightsFileName);
    const vocabularyPath = joinPath(vaultPath, vocabularyFileName);
    const generatedAt = new Date().toISOString();

    try {
        await mkdir(vaultPath, { recursive: true });
        await mkdir(pagesDirectoryPath, { recursive: true });
        if (await exists(legacyHighlightsIndexPath)) {
            await remove(legacyHighlightsIndexPath);
        }

        const pages = buildBookPages(books, rssArticles, annotations, vaultPath, pagesDirectoryName);

        await Promise.all(
            pages.map((page) => (
                writeTextFile(
                    page.absolutePath,
                    buildBookPageMarkdown(page.source, page.annotations, generatedAt),
                )
            )),
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
