
import DOMPurify from "dompurify";
import type { Config } from "dompurify";

const PURIFY_CONFIG: Config = {
    ALLOWED_TAGS: [
        "p", "br", "b", "i", "em", "strong", "a", "ul", "ol", "li",
        "blockquote", "pre", "code", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
        "img", "span", "div", "table", "thead", "tbody", "tr", "th", "td",
        "dl", "dt", "dd", "q", "cite", "abbr", "sup", "sub",
    ],
    ALLOWED_ATTR: [
        "href", "target", "rel", "src", "alt", "title", "class",
        "id", "style", "width", "height", "lang",
    ],
    ALLOW_DATA_ATTR: false,
};

function purify(html: string): string {
    return DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
}

export function sanitizeHtml(html: string): string {
    return purify(html);
}

export function sanitizeHtmlForDisplay(html: string): { __html: string } {
    return { __html: purify(html) };
}

export function setElementHtml(el: HTMLElement, html: string): void {
    el.innerHTML = purify(html);
}
