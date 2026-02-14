import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "./env";
import type { Annotation, Book, VaultIntegrationSettings } from "../types";

export type VaultSyncResult =
    | { status: "synced"; message: string; filePath: string }
    | { status: "skipped"; message: string }
    | { status: "error"; message: string };

interface AppendAnnotationParams {
    annotation: Annotation;
    book?: Book;
    settings: VaultIntegrationSettings;
}

function toMarkdownText(value: string | undefined): string {
    return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeFileName(value: string): string {
    const candidate = value.trim() || "theorem-highlights.md";
    const withExtension = candidate.toLowerCase().endsWith(".md")
        ? candidate
        : `${candidate}.md`;
    return withExtension.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
}

function joinPath(basePath: string, fileName: string): string {
    const separator = basePath.includes("\\") ? "\\" : "/";
    const trimmedBase = basePath.endsWith("/") || basePath.endsWith("\\")
        ? basePath.slice(0, -1)
        : basePath;
    return `${trimmedBase}${separator}${fileName}`;
}

function buildEntry(annotation: Annotation, book?: Book): string {
    const now = new Date();
    const isoStamp = now.toISOString();
    const title = toMarkdownText(book?.title) || "Untitled Source";
    const author = toMarkdownText(book?.author) || "Unknown Author";
    const quote = toMarkdownText(annotation.selectedText);
    const note = toMarkdownText(annotation.noteContent);
    const kind = annotation.type === "note" ? "NOTE" : "HIGHLIGHT";
    const color = annotation.color ? annotation.color.toUpperCase() : "DEFAULT";
    const location = toMarkdownText(annotation.location);

    const lines = [
        `### ${kind} | ${isoStamp}`,
        `- SOURCE: ${title}`,
        `- AUTHOR: ${author}`,
        `- COLOR: ${color}`,
        `- LOCATION: ${location || "N/A"}`,
    ];

    if (quote) {
        lines.push("", `> ${quote}`);
    }

    if (note) {
        lines.push("", `NOTE: ${note}`);
    }

    lines.push("", "---", "");
    return lines.join("\n");
}

function buildDocumentHeader(): string {
    const now = new Date().toISOString();
    return [
        "# THEOREM WORKBENCH",
        "",
        `STATUS: SYNCED_TO_VAULT`,
        `LAST_SYNC: ${now}`,
        "",
        "---",
        "",
    ].join("\n");
}

export async function appendAnnotationToVaultMarkdown({
    annotation,
    book,
    settings,
}: AppendAnnotationParams): Promise<VaultSyncResult> {
    if (annotation.type !== "highlight" && annotation.type !== "note") {
        return { status: "skipped", message: "Only highlights and notes are exported." };
    }

    if (!settings.enabled) {
        return { status: "skipped", message: "Vault export is disabled." };
    }

    if (!settings.vaultPath.trim()) {
        return { status: "skipped", message: "Vault path is not configured." };
    }

    if (!isTauri()) {
        return { status: "skipped", message: "Vault export is available in desktop mode only." };
    }

    const fileName = normalizeFileName(settings.highlightsFileName);
    const filePath = joinPath(settings.vaultPath.trim(), fileName);

    try {
        let existingContent = "";
        const fileExists = await exists(filePath);
        if (fileExists) {
            existingContent = await readTextFile(filePath);
        }

        const header = existingContent.trim().length === 0 ? buildDocumentHeader() : "";
        const needsBreak = existingContent.length > 0 && !existingContent.endsWith("\n\n");
        const entry = buildEntry(annotation, book);
        const nextContent = [
            existingContent,
            header,
            needsBreak ? "\n" : "",
            entry,
        ].join("");

        await writeTextFile(filePath, nextContent);

        return {
            status: "synced",
            message: "STATUS: SYNCED_TO_VAULT",
            filePath,
        };
    } catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Failed to append markdown in selected vault.";
        return {
            status: "error",
            message,
        };
    }
}

