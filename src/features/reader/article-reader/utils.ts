import type { RssArticle } from "../../../core";

export function sanitizeArticleHtml(html: string): string {
    if (!html) {
        return "";
    }

    const temp = document.createElement("div");
    temp.innerHTML = html;

    temp
        .querySelectorAll("script, style, link[rel='stylesheet'], iframe, object, embed, form")
        .forEach((el) => el.remove());

    temp.querySelectorAll("*").forEach((el) => {
        Array.from(el.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = attr.value.toLowerCase();
            if (
                name.startsWith("on")
                || (name === "href" && value.startsWith("javascript:"))
                || (name === "src" && value.startsWith("javascript:"))
                || name === "style"
                || name === "class"
                || name === "width"
                || name === "height"
                || name === "bgcolor"
                || name === "color"
                || name === "face"
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
