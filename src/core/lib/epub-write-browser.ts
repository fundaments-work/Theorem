import { unzipSync, zipSync } from "fflate";

export interface EpubWriteMeta {
    title?: string;
    author?: string;
    description?: string;
    publisher?: string;
    publishedDate?: string;
    language?: string;
    isbn?: string;
    category?: string;
}

const DC_NS = "http://purl.org/dc/elements/1.1/";

function findCi(haystack: string, needle: string): number {
    return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

function escapeXmlText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function findMetadataSpan(opf: string): [number, number] | null {
    const start = findCi(opf, "<metadata");
    if (start === -1) return null;
    const tagEnd = opf.indexOf(">", start);
    if (tagEnd === -1) return null;
    const afterOpen = tagEnd + 1;
    const close = findCi(opf.slice(afterOpen), "</metadata");
    if (close === -1) return null;
    const closeStart = afterOpen + close;
    return [afterOpen, closeStart];
}

function findDcElementRange(metadata: string, field: string): [number, number] | null {
    const openTag = `<dc:${field}`;
    const open = findCi(metadata, openTag);
    if (open === -1) return null;
    const gt = metadata.indexOf(">", open);
    if (gt === -1) return null;
    const contentStart = gt + 1;
    const closeTag = `</dc:${field}`;
    const close = findCi(metadata.slice(contentStart), closeTag);
    if (close === -1) return null;
    return [contentStart, contentStart + close];
}

function replaceOrInsertDc(metadata: string, field: string, value: string): string {
    const escaped = escapeXmlText(value);
    const range = findDcElementRange(metadata, field);
    if (range) {
        const [start, end] = range;
        return metadata.slice(0, start) + escaped + metadata.slice(end);
    }
    return `    <dc:${field} xmlns:dc="${DC_NS}">${escaped}</dc:${field}>\n  ` + metadata;
}

function extractAttr(tag: string, attr: string): string | null {
    const lower = tag.toLowerCase();
    const attrLower = attr.toLowerCase();
    let searchFrom = 0;
    while (true) {
        const idx = lower.indexOf(attrLower, searchFrom);
        if (idx === -1) return null;
        const beforeOk =
            idx === 0 ||
            /\s/.test(lower[idx - 1]) ||
            lower[idx - 1] === "<" ||
            lower[idx - 1] === "/";
        const after = lower.slice(idx + attrLower.length).trimStart();
        if (beforeOk && after.startsWith("=")) {
            const rest = after.slice(1).trimStart();
            const delim = rest.startsWith('"') ? '"' : rest.startsWith("'") ? "'" : null;
            if (delim) {
                const value = rest.slice(1);
                const end = value.indexOf(delim);
                if (end !== -1) return value.slice(0, end);
            }
        }
        searchFrom = idx + attrLower.length;
    }
}

function findTags(xml: string, name: string): string[] {
    const lower = xml.toLowerCase();
    const needle = `<${name}`;
    const out: string[] = [];
    let from = 0;
    while (true) {
        const start = lower.indexOf(needle, from);
        if (start === -1) break;
        const gt = xml.indexOf(">", start);
        if (gt === -1) break;
        out.push(xml.slice(start, gt + 1));
        from = gt + 1;
    }
    return out;
}

function findCoverHref(opf: string): string | null {
    for (const item of findTags(opf, "item")) {
        const props = extractAttr(item, "properties");
        if (props && props.split(/\s+/).some((p) => p.toLowerCase() === "cover-image")) {
            return extractAttr(item, "href");
        }
    }
    for (const meta of findTags(opf, "meta")) {
        const name = extractAttr(meta, "name");
        if (name && name.toLowerCase() === "cover") {
            const content = extractAttr(meta, "content");
            if (content) {
                for (const item of findTags(opf, "item")) {
                    if (extractAttr(item, "id") === content) {
                        return extractAttr(item, "href");
                    }
                }
            }
        }
    }
    return null;
}

function resolveRelative(base: string, target: string): string {
    const clean = target.split(/[?#]/)[0];
    const parts = base.split("/");
    parts.pop();
    for (const seg of clean.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== "." && seg !== "") parts.push(seg);
    }
    return parts.join("/");
}

function normalizeName(name: string): string {
    return name.replace(/\\/g, "/");
}

export function rewriteEpubWithFflate(
    input: Uint8Array,
    meta: EpubWriteMeta,
    cover: Uint8Array | null,
): Uint8Array {
    const files = unzipSync(input);
    const dirs = Object.keys(files).filter((k) => k.endsWith("/"));
    for (const dir of dirs) delete files[dir];

    const containerKey = Object.keys(files).find((k) => normalizeName(k) === "META-INF/container.xml");
    if (!containerKey) throw new Error("META-INF/container.xml not found");
    const containerText = new TextDecoder().decode(files[containerKey]);
    const rootfileMatch = /full-path\s*=\s*["']([^"']+\.opf)["']/i.exec(containerText);
    if (!rootfileMatch) throw new Error("Could not locate the OPF (content.opf).");
    const opfPath = rootfileMatch[1];

    const opfKey = Object.keys(files).find((k) => normalizeName(k) === normalizeName(opfPath));
    if (!opfKey) throw new Error(`Could not read the OPF at '${opfPath}'.`);
    const opf = new TextDecoder().decode(files[opfKey]);

    let newOpf = opf;
    const fields: [string, string][] = [];
    if (meta.title) fields.push(["title", meta.title]);
    if (meta.author) fields.push(["creator", meta.author]);
    if (meta.description) fields.push(["description", meta.description]);
    if (meta.publisher) fields.push(["publisher", meta.publisher]);
    if (meta.publishedDate) fields.push(["date", meta.publishedDate]);
    if (meta.language) fields.push(["language", meta.language]);
    if (meta.isbn) fields.push(["identifier", meta.isbn]);
    if (meta.category) fields.push(["subject", meta.category]);

    const span = findMetadataSpan(newOpf);
    if (fields.length > 0 && span) {
        const [start, end] = span;
        let metaBlock = newOpf.slice(start, end);
        for (const [field, value] of fields) metaBlock = replaceOrInsertDc(metaBlock, field, value);
        newOpf = newOpf.slice(0, start) + metaBlock + newOpf.slice(end);
    }

    let coverEntryPath: string | null = null;
    if (cover) {
        const existing = findCoverHref(newOpf);
        if (existing) {
            coverEntryPath = resolveRelative(opfPath, existing);
        } else {
            const href = "cover.png";
            const entryPath = resolveRelative(opfPath, href);
            const manifestClose = findCi(newOpf, "</manifest");
            if (manifestClose !== -1) {
                const item = `    <item id="theorem-cover" href="${href}" media-type="image/png" properties="cover-image"/>\n  `;
                newOpf = newOpf.slice(0, manifestClose) + item + newOpf.slice(manifestClose);
            }
            const metaClose = findMetadataSpan(newOpf);
            if (metaClose && findCi(newOpf.slice(metaClose[0], metaClose[1]), 'name="cover"') === -1) {
                const item = `    <meta name="cover" content="theorem-cover"/>\n  `;
                newOpf =
                    newOpf.slice(0, metaClose[0]) + item + newOpf.slice(metaClose[0], metaClose[1]) + newOpf.slice(metaClose[1]);
            }
            coverEntryPath = entryPath;
        }
    }

    const outFiles: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(files)) {
        const normalized = normalizeName(key);
        if (normalized === normalizeName(opfPath)) {
            outFiles[key] = new TextEncoder().encode(newOpf);
        } else if (cover !== null && coverEntryPath !== null && normalized === normalizeName(coverEntryPath)) {
            outFiles[key] = cover;
        } else {
            outFiles[key] = value;
        }
    }
    for (const dir of dirs) outFiles[dir] = new Uint8Array(0);
    if (
        cover !== null &&
        coverEntryPath !== null &&
        !Object.keys(outFiles).some((k) => normalizeName(k) === normalizeName(coverEntryPath))
    ) {
        outFiles[coverEntryPath] = cover;
    }

    const ordered: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
    for (const key of Object.keys(outFiles)) {
        if (normalizeName(key) === "mimetype") {
            ordered[key] = [outFiles[key], { level: 0 }];
        }
    }
    for (const [key, value] of Object.entries(outFiles)) {
        if (normalizeName(key) !== "mimetype") ordered[key] = value;
    }

    return zipSync(ordered, { level: 6 });
}