#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const OUTPUT_DIR = join(ROOT, "docs", "api");
const TYPE_FORMAT_FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

function toPosixPath(value) {
    return value.replaceAll("\\", "/");
}

function relativePathFromRoot(absolutePath) {
    const normalizedRoot = toPosixPath(ROOT);
    const normalizedPath = toPosixPath(absolutePath);
    if (!normalizedPath.startsWith(normalizedRoot)) {
        return normalizedPath;
    }
    return normalizedPath.slice(normalizedRoot.length + 1);
}

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

function findFiles(rootPath, predicate, acc) {
    if (!existsSync(rootPath)) {
        return;
    }

    const entries = readdirSync(rootPath, { withFileTypes: true });
    for (const entry of entries) {
        const abs = join(rootPath, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "target" || entry.name === ".git") {
                continue;
            }
            findFiles(abs, predicate, acc);
            continue;
        }

        if (entry.isFile() && predicate(abs, entry.name)) {
            acc.push(abs);
        }
    }
}

function findPackageJsonFiles() {
    return resolveWorkspacePackageDirs().map((packageDir) => join(packageDir, "package.json"));
}

function findTsSourceFiles() {
    const sourceFiles = [];
    const isTsSource = (_path, name) => (
        name.endsWith(".ts")
        || name.endsWith(".tsx")
        || name.endsWith(".d.ts")
    );

    const packageDirs = resolveWorkspacePackageDirs();
    for (const packageDir of packageDirs) {
        findFiles(packageDir, isTsSource, sourceFiles);
    }
    return sourceFiles;
}

function resolvePrimaryExport(packageJson, packageDir) {
    if (typeof packageJson.exports === "string") {
        return join(packageDir, packageJson.exports);
    }
    if (packageJson.exports && typeof packageJson.exports === "object") {
        const dotExport = packageJson.exports["."];
        if (typeof dotExport === "string") {
            return join(packageDir, dotExport);
        }
    }
    if (typeof packageJson.main === "string") {
        return join(packageDir, packageJson.main);
    }
    return "";
}

function normalizePackageName(packageJson, relativePackageDir) {
    const name = typeof packageJson.name === "string" ? packageJson.name.trim() : "";
    return name || relativePackageDir;
}

function inferModuleSummary(packageJson, relativePackageDir) {
    const explicitSummary = typeof packageJson.description === "string"
        ? packageJson.description.replace(/\s+/g, " ").trim()
        : "";
    if (explicitSummary) {
        return explicitSummary;
    }

    const pathSegments = relativePackageDir.split("/").filter(Boolean);
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

function inferModuleDocFileName(packageName) {
    return packageName
        .replace(/^@/, "")
        .replaceAll("/", "-")
        .replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function formatDependencies(packageJson, workspacePackageNames) {
    const deps = Object.keys(packageJson.dependencies || {});
    const internalDeps = deps.filter((name) => workspacePackageNames.has(name)).sort();
    const externalDeps = deps.filter((name) => !workspacePackageNames.has(name)).sort();
    return { internalDeps, externalDeps };
}

function formatList(items) {
    if (items.length === 0) {
        return "_none_";
    }
    return items.map((item) => `- \`${item}\``).join("\n");
}

function formatDocComment(text) {
    return text.replace(/\s+/g, " ").trim();
}

function getSymbolDocumentation(checker, symbol) {
    const docs = ts.displayPartsToString(symbol.getDocumentationComment(checker));
    return formatDocComment(docs);
}

function resolveExportSymbol(checker, symbol) {
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
        try {
            return checker.getAliasedSymbol(symbol);
        } catch {
            return symbol;
        }
    }
    return symbol;
}

function pickDeclaration(symbol, packageDirRel) {
    const declarations = symbol.getDeclarations() || [];
    if (declarations.length === 0) {
        return null;
    }

    const localDecl = declarations.find((decl) => {
        const sourceRel = relativePathFromRoot(decl.getSourceFile().fileName);
        return sourceRel.startsWith(packageDirRel);
    });

    return localDecl || declarations[0];
}

function getTypeText(checker, type, declaration) {
    return checker.typeToString(type, declaration, TYPE_FORMAT_FLAGS);
}

function isPrimitiveLikeType(type) {
    const primitiveFlags = (
        ts.TypeFlags.StringLike
        | ts.TypeFlags.NumberLike
        | ts.TypeFlags.BooleanLike
        | ts.TypeFlags.BigIntLike
        | ts.TypeFlags.ESSymbolLike
        | ts.TypeFlags.Null
        | ts.TypeFlags.Undefined
        | ts.TypeFlags.Void
        | ts.TypeFlags.Never
        | ts.TypeFlags.Unknown
        | ts.TypeFlags.Any
    );
    return (type.flags & primitiveFlags) !== 0;
}

function isInspectableObjectType(checker, type) {
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
        return false;
    }

    if (isPrimitiveLikeType(type)) {
        return false;
    }

    if (type.isUnion()) {
        const nonNullable = type.types.filter((item) => (item.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) === 0);
        if (nonNullable.length === 0) {
            return false;
        }

        return nonNullable.some((item) => isInspectableObjectType(checker, item));
    }

    return checker.getPropertiesOfType(type).length > 0;
}

function resolveExportType(checker, symbol, declaration, kind) {
    if (["interface", "type", "class", "enum"].includes(kind)) {
        return checker.getDeclaredTypeOfSymbol(symbol);
    }
    return checker.getTypeOfSymbolAtLocation(symbol, declaration);
}

function isOptionalSymbol(symbol, declaration) {
    if ((symbol.flags & ts.SymbolFlags.Optional) !== 0) {
        return true;
    }

    if (!declaration) {
        return false;
    }

    if (
        ts.isParameter(declaration)
        || ts.isPropertySignature(declaration)
        || ts.isPropertyDeclaration(declaration)
    ) {
        if (ts.isParameter(declaration)) {
            return Boolean(declaration.questionToken || declaration.initializer);
        }
        return Boolean(declaration.questionToken);
    }

    return false;
}

function getParameterName(param, declaration, index) {
    const symbolName = param.getName();
    if (!/^__\d+$/.test(symbolName)) {
        return symbolName;
    }

    if (declaration && ts.isParameter(declaration)) {
        if (ts.isIdentifier(declaration.name)) {
            return declaration.name.text;
        }
        if (ts.isObjectBindingPattern(declaration.name)) {
            return index === 0 ? "props" : `options${index + 1}`;
        }
    }

    return `arg${index + 1}`;
}

function extractFunctionSignatures(checker, type, declaration, packageDirRel) {
    const callSignatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call);

    return callSignatures.map((signature) => {
        const signatureDecl = signature.getDeclaration();
        const signatureParams = signatureDecl && "parameters" in signatureDecl
            ? signatureDecl.parameters
            : [];

        const params = signature.getParameters().map((param, index) => {
            const paramDecl = signatureParams[index]
                || param.valueDeclaration
                || (param.getDeclarations() || [])[0]
                || declaration;
            const paramType = checker.getTypeOfSymbolAtLocation(param, paramDecl);
            return {
                name: getParameterName(param, paramDecl, index),
                optional: isOptionalSymbol(param, paramDecl),
                type: getTypeText(checker, paramType, paramDecl),
                fields: extractProperties(checker, paramType, packageDirRel),
            };
        });

        return {
            text: checker.signatureToString(signature, declaration, TYPE_FORMAT_FLAGS),
            params,
            returns: getTypeText(checker, signature.getReturnType(), declaration),
        };
    });
}

function extractProperties(checker, type, packageDirRel) {
    if (!isInspectableObjectType(checker, type)) {
        return [];
    }

    const properties = checker.getPropertiesOfType(type);
    if (properties.length === 0) {
        return [];
    }

    const normalized = properties
        .map((property) => {
            const decl = property.valueDeclaration || (property.getDeclarations() || [])[0];
            if (!decl) {
                return null;
            }

            const name = property.getName();
            if (name.startsWith("__@")) {
                return null;
            }

            const sourceRel = relativePathFromRoot(decl.getSourceFile().fileName);
            const propertyType = checker.getTypeOfSymbolAtLocation(property, decl);

            return {
                name,
                type: getTypeText(checker, propertyType, decl),
                optional: isOptionalSymbol(property, decl),
                local: sourceRel.startsWith(packageDirRel),
            };
        })
        .filter(Boolean);

    const locals = normalized.filter((item) => item.local);
    if (locals.length > 0) {
        return locals.sort((left, right) => left.name.localeCompare(right.name));
    }

    return normalized
        .slice(0, 12)
        .sort((left, right) => left.name.localeCompare(right.name));
}

function classifyExport(symbol, declaration, checker) {
    if (!declaration) {
        return "value";
    }

    if (ts.isFunctionDeclaration(declaration)) {
        return "function";
    }
    if (ts.isClassDeclaration(declaration)) {
        return "class";
    }
    if (ts.isInterfaceDeclaration(declaration)) {
        return "interface";
    }
    if (ts.isTypeAliasDeclaration(declaration)) {
        return "type";
    }
    if (ts.isEnumDeclaration(declaration)) {
        return "enum";
    }

    if (ts.isVariableDeclaration(declaration)) {
        const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
        if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
            return "function";
        }
        if (isInspectableObjectType(checker, type)) {
            return "object";
        }
        return "constant";
    }

    return "value";
}

function inspectExport(checker, exportedSymbol, packageDirRel) {
    const resolvedSymbol = resolveExportSymbol(checker, exportedSymbol);
    const declaration = pickDeclaration(resolvedSymbol, packageDirRel);
    const displayName = exportedSymbol.getName();

    if (!declaration) {
        return {
            name: displayName,
            kind: "value",
            docs: getSymbolDocumentation(checker, resolvedSymbol),
            signatures: [],
            properties: [],
            typeText: "unknown",
        };
    }

    const kind = classifyExport(resolvedSymbol, declaration, checker);
    const docs = getSymbolDocumentation(checker, resolvedSymbol);
    const type = resolveExportType(checker, resolvedSymbol, declaration, kind);

    const entry = {
        name: displayName,
        kind,
        docs,
        signatures: [],
        properties: [],
        typeText: getTypeText(checker, type, declaration),
    };

    if (kind === "function") {
        entry.signatures = extractFunctionSignatures(checker, type, declaration, packageDirRel);
    }

    if (["object", "interface", "type", "class"].includes(kind)) {
        entry.properties = extractProperties(checker, type, packageDirRel);
    }

    return entry;
}

function addPathAlias(pathAliasMap, alias, targetPath) {
    if (!alias || !targetPath) {
        return;
    }

    const normalizedTarget = toPosixPath(targetPath);
    const existing = pathAliasMap.get(alias) || new Set();
    existing.add(normalizedTarget);
    pathAliasMap.set(alias, existing);
}

function collectTsconfigPathAliases() {
    const tsconfigPaths = [];
    findFiles(ROOT, (_path, name) => name.startsWith("tsconfig") && name.endsWith(".json"), tsconfigPaths);

    const pathAliasMap = new Map();

    for (const tsconfigPath of tsconfigPaths) {
        let tsconfigJson = null;
        try {
            tsconfigJson = readJson(tsconfigPath);
        } catch {
            continue;
        }

        const compilerOptions = tsconfigJson.compilerOptions || {};
        const paths = compilerOptions.paths;
        if (!paths || typeof paths !== "object") {
            continue;
        }

        const tsconfigDir = dirname(tsconfigPath);
        const baseUrl = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".";
        const absoluteBaseUrl = join(tsconfigDir, baseUrl);

        for (const [alias, targets] of Object.entries(paths)) {
            if (!Array.isArray(targets)) {
                continue;
            }
            for (const target of targets) {
                if (typeof target !== "string") {
                    continue;
                }
                const absoluteTarget = join(absoluteBaseUrl, target);
                addPathAlias(pathAliasMap, alias, relativePathFromRoot(absoluteTarget));
            }
        }
    }

    return pathAliasMap;
}

function collectWorkspacePathAliases(modules) {
    const pathAliasMap = collectTsconfigPathAliases();

    for (const moduleInfo of modules) {
        const { packageName, packageDir, entryFilePath } = moduleInfo;
        if (packageName && entryFilePath) {
            addPathAlias(pathAliasMap, packageName, relativePathFromRoot(entryFilePath));
        }

        const srcDir = join(packageDir, "src");
        if (packageName && existsSync(srcDir)) {
            addPathAlias(pathAliasMap, `${packageName}/*`, relativePathFromRoot(join(srcDir, "*")));
        }
    }

    const normalizedPaths = {};
    for (const [alias, targets] of pathAliasMap.entries()) {
        normalizedPaths[alias] = [...targets].sort((left, right) => left.localeCompare(right));
    }

    return normalizedPaths;
}

function buildProgram(modules) {
    const baseConfig = readJson(join(ROOT, "tsconfig.base.json"));
    const converted = ts.convertCompilerOptionsFromJson(baseConfig.compilerOptions || {}, ROOT);
    const dynamicPaths = collectWorkspacePathAliases(modules);
    const options = {
        ...converted.options,
        baseUrl: ROOT,
        noEmit: true,
        paths: dynamicPaths,
    };

    const rootNames = findTsSourceFiles();
    return ts.createProgram({ rootNames, options });
}

function renderPropertiesTable(lines, properties) {
    if (properties.length === 0) {
        lines.push("_No object fields detected._");
        lines.push("");
        return;
    }

    lines.push("| Property | Type | Optional |");
    lines.push("| --- | --- | --- |");
    for (const prop of properties) {
        lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${prop.optional ? "yes" : "no"} |`);
    }
    lines.push("");
}

function renderFunctionEntry(lines, entry) {
    lines.push(`### Function \`${entry.name}\``);
    lines.push("");

    if (entry.docs) {
        lines.push(entry.docs);
        lines.push("");
    }

    if (entry.signatures.length === 0) {
        lines.push(`- Type: \`${entry.typeText}\``);
        lines.push("");
        return;
    }

    entry.signatures.forEach((signature, index) => {
        if (entry.signatures.length > 1) {
            lines.push(`**Overload ${index + 1}**`);
            lines.push("");
        }

        lines.push("```ts");
        lines.push(`${entry.name}${signature.text}`);
        lines.push("```");
        lines.push("");

        if (signature.params.length > 0) {
            lines.push("| Parameter | Type | Optional |");
            lines.push("| --- | --- | --- |");
            for (const param of signature.params) {
                lines.push(`| \`${param.name}\` | \`${param.type}\` | ${param.optional ? "yes" : "no"} |`);
            }
            lines.push("");

            for (const param of signature.params) {
                if (!param.fields || param.fields.length === 0) {
                    continue;
                }

                lines.push(`**Parameter \`${param.name}\` fields**`);
                lines.push("");
                renderPropertiesTable(lines, param.fields);
            }
        } else {
            lines.push("- Parameters: _none_");
            lines.push("");
        }

        lines.push(`- Returns: \`${signature.returns}\``);
        lines.push("");
    });
}

function renderTypedEntry(lines, entry, label) {
    lines.push(`### ${label} \`${entry.name}\``);
    lines.push("");

    if (entry.docs) {
        lines.push(entry.docs);
        lines.push("");
    }

    lines.push(`- Type: \`${entry.typeText}\``);
    lines.push("");

    if (["object", "interface", "type", "class"].includes(entry.kind)) {
        lines.push("**Fields**");
        lines.push("");
        renderPropertiesTable(lines, entry.properties);
    }
}

function writeModuleDoc(moduleInfo) {
    const {
        packageName,
        relativePackageDir,
        summary,
        packageJson,
        relativeEntryFile,
        docPath,
        exports,
        workspacePackageNames,
    } = moduleInfo;

    const { internalDeps, externalDeps } = formatDependencies(packageJson, workspacePackageNames);
    const hasTypecheckScript = Boolean(packageJson.scripts && packageJson.scripts.typecheck);

    const functions = exports.filter((entry) => entry.kind === "function");
    const objects = exports.filter((entry) => ["object", "constant", "value"].includes(entry.kind));
    const types = exports.filter((entry) => ["interface", "type", "class", "enum"].includes(entry.kind));

    const lines = [
        `# ${packageName}`,
        "",
        `${summary}`,
        "",
        "## Module",
        "",
        `- Path: \`/${relativePackageDir}\``,
        `- Version: \`${packageJson.version || "0.0.0"}\``,
        `- Public entry: \`${relativeEntryFile ? `/${relativeEntryFile}` : "n/a"}\``,
        "",
        "## Dependencies",
        "",
        "**Internal packages**",
        formatList(internalDeps),
        "",
        "**External packages**",
        formatList(externalDeps),
        "",
        "## API Reference",
        "",
    ];

    if (functions.length === 0 && objects.length === 0 && types.length === 0) {
        lines.push("_No exported symbols detected._");
        lines.push("");
    } else {
        if (functions.length > 0) {
            lines.push("### Functions");
            lines.push("");
            for (const entry of functions.sort((a, b) => a.name.localeCompare(b.name))) {
                renderFunctionEntry(lines, entry);
            }
        }

        if (objects.length > 0) {
            lines.push("### Objects and Values");
            lines.push("");
            for (const entry of objects.sort((a, b) => a.name.localeCompare(b.name))) {
                renderTypedEntry(lines, entry, "Value");
            }
        }

        if (types.length > 0) {
            lines.push("### Types and Interfaces");
            lines.push("");
            for (const entry of types.sort((a, b) => a.name.localeCompare(b.name))) {
                const label = entry.kind === "interface"
                    ? "Interface"
                    : entry.kind === "class"
                        ? "Class"
                        : entry.kind === "enum"
                            ? "Enum"
                            : "Type";
                renderTypedEntry(lines, entry, label);
            }
        }
    }

    lines.push("## Validation");
    lines.push("");
    if (hasTypecheckScript) {
        lines.push(`- \`pnpm --filter ${packageName} typecheck\``);
    } else {
        lines.push("- Uses workspace-level validation commands.");
    }
    lines.push("- `pnpm build`");
    lines.push("");
    lines.push("_Generated by `scripts/generate-module-docs.mjs`._");
    lines.push("");

    mkdirSync(dirname(docPath), { recursive: true });
    writeFileSync(docPath, `${lines.join("\n")}\n`, "utf8");
}

function writeIndex(modules) {
    const lines = [
        "# API Docs",
        "",
        "One document per workspace module/package with API signatures, parameters, return types, and object fields.",
        "",
        "| Module | Path | Purpose |",
        "| --- | --- | --- |",
    ];

    for (const moduleInfo of modules) {
        const docFileName = moduleInfo.docPath.split("/").pop();
        lines.push(`| [\`${moduleInfo.packageName}\`](./modules/${docFileName}) | \`/${moduleInfo.relativePackageDir}\` | ${moduleInfo.summary} |`);
    }

    lines.push("");
    lines.push("## Regeneration");
    lines.push("");
    lines.push("- Run `pnpm docs:api` after changing public exports.");
    lines.push("- Run `pnpm docs:build` to regenerate API + AI context files.");
    lines.push("");

    writeFileSync(join(OUTPUT_DIR, "README.md"), `${lines.join("\n")}\n`, "utf8");
}

function collectModuleMetadata() {
    return findPackageJsonFiles()
        .map((packageJsonPath) => {
            const packageJson = readJson(packageJsonPath);
            const packageDir = dirname(packageJsonPath);
            const relativePackageDir = relativePathFromRoot(packageDir);
            const packageName = normalizePackageName(packageJson, relativePackageDir);
            const entryFilePath = resolvePrimaryExport(packageJson, packageDir);
            const relativeEntryFile = entryFilePath ? relativePathFromRoot(entryFilePath) : "";
            const summary = inferModuleSummary(packageJson, relativePackageDir);
            const docFileName = `${inferModuleDocFileName(packageName)}.md`;

            return {
                packageName,
                packageDir,
                relativePackageDir,
                packageJson,
                entryFilePath,
                relativeEntryFile,
                summary,
                docPath: join(OUTPUT_DIR, "modules", docFileName),
            };
        })
        .sort((left, right) => left.packageName.localeCompare(right.packageName));
}

function run() {
    const moduleMetadata = collectModuleMetadata();
    const workspacePackageNames = new Set(moduleMetadata.map((moduleInfo) => moduleInfo.packageName));
    const program = buildProgram(moduleMetadata);
    const checker = program.getTypeChecker();

    const modules = moduleMetadata.map((moduleInfo) => {
        const sourceFile = moduleInfo.entryFilePath
            ? program.getSourceFile(toPosixPath(moduleInfo.entryFilePath))
            : null;

        let exports = [];
        if (sourceFile) {
            const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
            if (moduleSymbol) {
                const exportSymbols = checker.getExportsOfModule(moduleSymbol);
                exports = exportSymbols
                    .filter((symbol) => symbol.getName() !== "default")
                    .filter((symbol) => !symbol.getName().startsWith("__"))
                    .map((symbol) => inspectExport(checker, symbol, moduleInfo.relativePackageDir));
            }
        }

        return {
            ...moduleInfo,
            workspacePackageNames,
            exports,
        };
    });

    rmSync(OUTPUT_DIR, { recursive: true, force: true });
    mkdirSync(join(OUTPUT_DIR, "modules"), { recursive: true });

    for (const moduleInfo of modules) {
        writeModuleDoc(moduleInfo);
    }

    writeIndex(modules);

    console.log(`Generated ${modules.length} module API docs in ${relativePathFromRoot(OUTPUT_DIR)}.`);
}

run();
