import type { RssArticle } from "@theorem/core";

export function sanitizeArticleHtml(html: string): string {
    if (!html) {
        return "";
    }

    const temp = document.createElement("div");
    temp.innerHTML = html;

    temp.querySelectorAll("script, style, iframe, object, embed, form").forEach((el) => el.remove());

    temp.querySelectorAll("*").forEach((el) => {
        Array.from(el.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = attr.value.toLowerCase();
            if (
                name.startsWith("on")
                || (name === "href" && value.startsWith("javascript:"))
                || (name === "src" && value.startsWith("javascript:"))
            ) {
                el.removeAttribute(attr.name);
            }
        });
    });

    temp.querySelectorAll("a").forEach((link) => {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
    });

    temp.querySelectorAll("img").forEach((img) => {
        img.setAttribute("loading", "lazy");
    });

    return temp.innerHTML;
}

export function stripHtml(value: string): string {
    const temp = document.createElement("div");
    temp.innerHTML = value;
    return temp.textContent || temp.innerText || "";
}

export function formatArticleDate(date: Date | string | undefined): string {
    if (!date) {
        return "";
    }

    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return "";
    }

    return parsed.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

export function buildArticleDescription(article: RssArticle): string {
    const content = article.summary || article.content;
    const plain = stripHtml(content).trim();
    if (!plain) {
        return "";
    }
    if (plain.length <= 320) {
        return plain;
    }
    return `${plain.slice(0, 317)}...`;
}

export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function highlightExcerpt(excerpt: string, query: string): string {
    const safeExcerpt = escapeHtml(excerpt);
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return safeExcerpt;
    }

    const safeQuery = escapeHtml(normalizedQuery);
    if (!safeExcerpt.toLowerCase().includes(safeQuery.toLowerCase())) {
        return safeExcerpt;
    }

    const queryRegex = new RegExp(`(${escapeRegExp(safeQuery)})`, "gi");
    return safeExcerpt.replace(
        queryRegex,
        '<span class="bg-[var(--color-accent)]/20 text-[color:var(--color-accent)] font-bold">$1</span>',
    );
}
