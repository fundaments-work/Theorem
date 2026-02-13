#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const AI_DOCS_DIR = join(ROOT, "docs", "ai");

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

function readWorkspacePackagePatterns() {
    const workspaceConfigPath = join(ROOT, "pnpm-workspace.yaml");
    if (!existsSync(workspaceConfigPath)) {
        return ["apps/*", "packages/*"];
    }

    const lines = readFileSync(workspaceConfigPath, "utf8").split(/\r?\n/);
    const patterns = [];
    let inPackagesSection = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }

        if (!inPackagesSection) {
            if (line === "packages:") {
                inPackagesSection = true;
            }
            continue;
        }

        if (/^[a-zA-Z0-9_-]+:\s*$/.test(line) && !line.startsWith("-")) {
            break;
        }

        const match = line.match(/^-\s*['"]?(.+?)['"]?\s*$/);
        if (!match) {
            continue;
        }

        const pattern = match[1].trim();
        if (!pattern || pattern.startsWith("!")) {
            continue;
        }
        patterns.push(pattern);
    }

    return patterns.length > 0 ? patterns : ["apps/*", "packages/*"];
}

function patternSegmentToRegExp(segment) {
    const escaped = segment.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}

function expandWorkspacePattern(pattern) {
    const segments = pattern.split("/").filter(Boolean);
    let currentPaths = [ROOT];

    for (const segment of segments) {
        if (segment === "**") {
            const expanded = [];
            for (const basePath of currentPaths) {
                const stack = [basePath];
                while (stack.length > 0) {
                    const candidate = stack.pop();
                    expanded.push(candidate);
                    const entries = readdirSync(candidate, { withFileTypes: true });
                    for (const entry of entries) {
                        if (!entry.isDirectory()) {
                            continue;
                        }
                        if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "target" || entry.name === ".git") {
                            continue;
                        }
                        stack.push(join(candidate, entry.name));
                    }
                }
            }
            currentPaths = expanded;
            continue;
        }

        if (segment.includes("*")) {
            const nextPaths = [];
            const matcher = patternSegmentToRegExp(segment);
            for (const basePath of currentPaths) {
                if (!existsSync(basePath)) {
                    continue;
                }
                const entries = readdirSync(basePath, { withFileTypes: true });
                for (const entry of entries) {
                    if (!entry.isDirectory()) {
                        continue;
                    }
                    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "target" || entry.name === ".git") {
                        continue;
                    }
                    if (matcher.test(entry.name)) {
                        nextPaths.push(join(basePath, entry.name));
                    }
                }
            }
            currentPaths = nextPaths;
            continue;
        }

        currentPaths = currentPaths
            .map((basePath) => join(basePath, segment))
            .filter((path) => existsSync(path));
    }

    return currentPaths;
}

function resolveWorkspacePackageDirs() {
    const packageDirs = new Set();
    const packagePatterns = readWorkspacePackagePatterns();

    for (const pattern of packagePatterns) {
        const expanded = expandWorkspacePattern(pattern);
        for (const absoluteDir of expanded) {
            if (existsSync(join(absoluteDir, "package.json"))) {
                packageDirs.add(absoluteDir);
            }
        }
    }

    return [...packageDirs].sort((left, right) => left.localeCompare(right));
}

function toPosixPath(filePath) {
    return filePath.replaceAll("\\", "/");
}

function relativeFromRoot(filePath) {
    const normalizedRoot = toPosixPath(ROOT);
    const normalized = toPosixPath(filePath);
    if (!normalized.startsWith(normalizedRoot)) {
        return normalized;
    }
    return normalized.slice(normalizedRoot.length + 1);
}

function scanWorkspacePackages() {
    const partialPackages = resolveWorkspacePackageDirs()
        .map((dirPath) => {
            const packageJsonPath = join(dirPath, "package.json");
            const json = readJson(packageJsonPath);
            const relativeDir = relativeFromRoot(dirPath);
            const dependencies = {
                ...(json.dependencies || {}),
                ...(json.devDependencies || {}),
                ...(json.peerDependencies || {}),
            };

            const exportPath = resolvePrimaryExport(json);
            const primaryExport = exportPath ? join(dirPath, exportPath) : null;
            const relativeExport = primaryExport ? relativeFromRoot(primaryExport) : "";
            const packageName = normalizePackageName(json, relativeDir);

            return {
                name: packageName,
                version: json.version || "0.0.0",
                relativeDir,
                relativeExport,
                dependencies,
                summary: inferSummary(json, relativeDir),
            };
        })
        .sort((left, right) => left.name.localeCompare(right.name));

    const workspacePackageNames = new Set(partialPackages.map((pkg) => pkg.name));

    return partialPackages.map((pkg) => ({
        ...pkg,
        internalDependencies: Object.keys(pkg.dependencies)
            .filter((name) => workspacePackageNames.has(name))
            .sort(),
    }));
}

function resolvePrimaryExport(packageJson) {
    const exportsField = packageJson.exports;
    if (typeof exportsField === "string") {
        return exportsField;
    }
    if (exportsField && typeof exportsField === "object" && typeof exportsField["."] === "string") {
        return exportsField["."];
    }
    if (typeof packageJson.main === "string") {
        return packageJson.main;
    }
    return "";
}

function normalizePackageName(packageJson, relativeDir) {
    const packageName = typeof packageJson.name === "string" ? packageJson.name.trim() : "";
    return packageName || relativeDir;
}

function inferSummary(packageJson, relativeDir) {
    const explicitSummary = typeof packageJson.description === "string"
        ? packageJson.description.replace(/\s+/g, " ").trim()
        : "";
    if (explicitSummary) {
        return explicitSummary;
    }

    const pathSegments = relativeDir.split("/").filter(Boolean);
    if (pathSegments[0] === "apps") {
        return "Application package.";
    }
    if (pathSegments.includes("features")) {
        return "Feature package.";
    }
    if (pathSegments[0] === "packages") {
        return "Shared workspace package.";
    }
    return "Workspace package.";
}

function formatDependencies(dependencies) {
    if (dependencies.length === 0) {
        return "_none_";
    }
    return dependencies.map((name) => `\`${name}\``).join(", ");
}

function getRepositoryDisplayName() {
    const rootPackageJsonPath = join(ROOT, "package.json");
    if (!existsSync(rootPackageJsonPath)) {
        return "Workspace";
    }

    try {
        const rootPackageJson = readJson(rootPackageJsonPath);
        const rawName = typeof rootPackageJson.name === "string" ? rootPackageJson.name.trim() : "";
        if (!rawName) {
            return "Workspace";
        }
        return rawName.replace(/[-_]+/g, " ");
    } catch {
        return "Workspace";
    }
}

function buildModuleIndex(packages) {
    const lines = [
        "# Module Index",
        "",
        "Generated from workspace manifests. Use this file as the first lookup point for AI-assisted changes.",
        "",
        "| Package | Path | Public Entry | Internal Dependencies | Purpose |",
        "| --- | --- | --- | --- | --- |",
    ];

    for (const pkg of packages) {
        lines.push(
            `| \`${pkg.name}\` | \`${pkg.relativeDir}\` | \`${pkg.relativeExport || "n/a"}\` | ${formatDependencies(pkg.internalDependencies)} | ${pkg.summary} |`,
        );
    }

    lines.push("");
    lines.push("## Usage Rules");
    lines.push("");
    lines.push("1. Edit one package at a time whenever possible.");
    lines.push("2. Import cross-package symbols only through package entry points.");
    lines.push("3. Run package-level checks before full app checks.");
    lines.push("4. Update this index after adding/removing workspace packages.");
    lines.push("");

    return `${lines.join("\n")}\n`;
}

function buildLlms(packages, repositoryName) {
    const lines = [
        `# ${repositoryName}`,
        "",
        "> Modular monorepo application with package boundaries and generated module docs.",
        "",
        "## Priority Context",
        "",
        "- `/AGENTS.md`: Agent workflow and coding rules.",
        "- `/README.md`: Workspace commands and project overview.",
        "- `/docs/monorepo-guide.md`: Monorepo structure and package boundaries.",
        "- `/docs/ai/module-index.md`: Package map and dependency graph.",
        "- `/docs/api/README.md`: Generated API docs from package public exports.",
        "",
        "## Workspace Packages",
        "",
    ];

    for (const pkg of packages) {
        lines.push(`- \`${pkg.name}\` -> \`/${pkg.relativeDir}\``);
    }

    lines.push("");
    lines.push("## Fast Validation Commands");
    lines.push("");
    lines.push("- `pnpm typecheck`");
    lines.push("- `pnpm build`");
    lines.push("- `pnpm docs:build`");
    lines.push("");

    return `${lines.join("\n")}\n`;
}

function buildLlmsFull(packages, repositoryName) {
    const lines = [
        `# ${repositoryName} (Full AI Context)`,
        "",
        "## Repository Intent",
        "",
        `${repositoryName} is a modular monorepo designed for AI-assisted development with strict package boundaries and explicit public APIs.`,
        "",
        "## Required Operating Pattern for Agents",
        "",
        "1. Identify the target package from `/docs/ai/module-index.md` before editing code.",
        "2. Restrict imports to package entrypoints rather than deep relative paths.",
        "3. Prefer local package checks first, then run repository checks.",
        "4. Update generated docs after API changes (`pnpm docs:build`).",
        "",
        "## Package Overview",
        "",
    ];

    for (const pkg of packages) {
        lines.push(`### ${pkg.name}`);
        lines.push(`- Path: \`/${pkg.relativeDir}\``);
        lines.push(`- Public entry: \`/${pkg.relativeExport || "n/a"}\``);
        lines.push(`- Purpose: ${pkg.summary}`);
        lines.push(`- Internal deps: ${formatDependencies(pkg.internalDependencies)}`);
        lines.push("");
    }

    lines.push("## Canonical Docs");
    lines.push("");
    lines.push("- `/AGENTS.md`");
    lines.push("- `/README.md`");
    lines.push("- `/docs/monorepo-guide.md`");
    lines.push("- `/docs/ai/module-index.md`");
    lines.push("- `/docs/api/README.md`");
    lines.push("");

    return `${lines.join("\n")}\n`;
}

function ensureAiDocsDirectory() {
    if (!existsSync(AI_DOCS_DIR)) {
        mkdirSync(AI_DOCS_DIR, { recursive: true });
    } else if (!statSync(AI_DOCS_DIR).isDirectory()) {
        throw new Error(`Expected docs directory at ${AI_DOCS_DIR}`);
    }
}

function run() {
    ensureAiDocsDirectory();

    const packages = scanWorkspacePackages();
    const repositoryName = getRepositoryDisplayName();

    writeFileSync(join(AI_DOCS_DIR, "module-index.md"), buildModuleIndex(packages), "utf8");
    writeFileSync(join(ROOT, "llms.txt"), buildLlms(packages, repositoryName), "utf8");
    writeFileSync(join(ROOT, "llms-full.txt"), buildLlmsFull(packages, repositoryName), "utf8");

    console.log(`Wrote docs/ai/module-index.md for ${packages.length} packages.`);
    console.log("Wrote llms.txt and llms-full.txt.");
}

run();
