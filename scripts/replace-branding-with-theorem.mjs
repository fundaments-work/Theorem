#!/usr/bin/env node

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const shouldWrite = args.has("--write");
const isVerbose = args.has("--verbose");
const rootDir = process.cwd();
const scriptPath = toPosixPath(relative(rootDir, fileURLToPath(import.meta.url)));

const REPLACEMENTS = [
    [/\bLION READER\b/g, "THEOREM"],
    [/\bLion Reader\b/g, "Theorem"],
    [/\blion reader\b/g, "theorem"],
    [/\bLIONREADER\b/g, "THEOREM"],
    [/\bLionReader\b/g, "Theorem"],
    [/\blionreader\b/g, "theorem"],
    [/\blion-reader\b/g, "theorem"],
];

const SKIP_DIRECTORIES = new Set([".git", ".pnpm-store", "dist", "node_modules", "target"]);
const SKIP_SUFFIXES = [".tsbuildinfo", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".woff", ".woff2", ".ttf", ".eot", ".zip", ".gz"];
const SKIP_BASENAMES = new Set(["pnpm-lock.yaml"]);

function toPosixPath(value) {
    return value.replaceAll("\\", "/");
}

function listCodebaseFiles(baseDir, currentDir = baseDir, files = []) {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (SKIP_DIRECTORIES.has(entry.name)) {
                continue;
            }
            listCodebaseFiles(baseDir, join(currentDir, entry.name), files);
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        const absolutePath = join(currentDir, entry.name);
        const relativePath = toPosixPath(relative(baseDir, absolutePath));
        files.push(relativePath);
    }

    return files;
}

function shouldSkipFile(filePath) {
    if (filePath === scriptPath) {
        return true;
    }

    if (SKIP_BASENAMES.has(filePath.split("/").at(-1) ?? "")) {
        return true;
    }

    return SKIP_SUFFIXES.some((suffix) => filePath.endsWith(suffix));
}

function isLikelyBinary(buffer) {
    const inspectLength = Math.min(buffer.length, 8000);
    for (let i = 0; i < inspectLength; i += 1) {
        if (buffer[i] === 0) {
            return true;
        }
    }
    return false;
}

function applyReplacements(source) {
    let updated = source;
    let replacementCount = 0;

    for (const [pattern, replacement] of REPLACEMENTS) {
        updated = updated.replace(pattern, () => {
            replacementCount += 1;
            return replacement;
        });
    }

    return { updated, replacementCount };
}

const changedFiles = [];
let totalReplacements = 0;

for (const filePath of listCodebaseFiles(rootDir)) {
    if (shouldSkipFile(filePath)) {
        continue;
    }

    const absolutePath = join(rootDir, filePath);
    const buffer = readFileSync(absolutePath);
    if (isLikelyBinary(buffer)) {
        continue;
    }

    const original = buffer.toString("utf8");
    const { updated, replacementCount } = applyReplacements(original);

    if (replacementCount === 0 || updated === original) {
        continue;
    }

    changedFiles.push({ filePath, replacementCount });
    totalReplacements += replacementCount;

    if (shouldWrite) {
        writeFileSync(absolutePath, updated, "utf8");
    }
}

if (changedFiles.length === 0) {
    console.log("No lionreader text variants found.");
    process.exit(0);
}

console.log(`${shouldWrite ? "Updated" : "Would update"} ${changedFiles.length} files with ${totalReplacements} replacement(s).`);
for (const { filePath, replacementCount } of changedFiles) {
    if (isVerbose || changedFiles.length <= 40) {
        console.log(`- ${filePath} (${replacementCount})`);
    }
}

if (!shouldWrite) {
    console.log("Run with --write to apply changes.");
}
