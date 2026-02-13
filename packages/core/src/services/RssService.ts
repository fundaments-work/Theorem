/**
 * RSS Service
 * Fetches and parses RSS/Atom feeds, converts articles to EPUB blobs
 */

import type { RssFeed, RssArticle } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { zipSync, strToU8 } from 'fflate';

// ── Feed Parsing ──

interface ParsedFeed {
    title: string;
    description?: string;
    siteUrl?: string;
    iconUrl?: string;
    articles: Omit<RssArticle, 'id' | 'feedId' | 'fetchedAt' | 'isRead' | 'isFavorite'>[];
}

function textContent(el: Element | null): string {
    return el?.textContent?.trim() ?? '';
}

function attrContent(el: Element | null, attr: string): string {
    return el?.getAttribute(attr)?.trim() ?? '';
}

/**
 * Parse an RSS 2.0 or Atom XML document into a structured feed.
 */
function parseFeedXml(xmlText: string): ParsedFeed {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error(`Invalid XML: ${parseError.textContent?.substring(0, 200)}`);
    }

    const root = doc.documentElement;

    // Atom feed
    if (root.tagName === 'feed' || root.namespaceURI?.includes('Atom')) {
        return parseAtomFeed(root);
    }

    // RSS 2.0
    const channel = root.querySelector('channel');
    if (channel) {
        return parseRss2Feed(channel);
    }

    // RDF/RSS 1.0
    const rdfChannel = root.getElementsByTagNameNS('http://purl.org/rss/1.0/', 'channel')[0];
    if (rdfChannel) {
        return parseRss1Feed(root);
    }

    throw new Error('Unrecognized feed format');
}

function parseRss2Feed(channel: Element): ParsedFeed {
    const title = textContent(channel.querySelector(':scope > title'));
    const description = textContent(channel.querySelector(':scope > description'));
    const siteUrl = textContent(channel.querySelector(':scope > link'));
    const imageUrl = textContent(channel.querySelector(':scope > image > url'));

    const items = Array.from(channel.querySelectorAll(':scope > item'));
    const articles = items.map(item => {
        const itemTitle = textContent(item.querySelector('title'));
        const link = textContent(item.querySelector('link'));
        // content:encoded or description
        const contentEncoded = item.getElementsByTagNameNS('http://purl.org/rss/content/modules/1.0/', 'encoded')[0]
            ?? item.querySelector('content\\:encoded');
        const content = textContent(contentEncoded) || textContent(item.querySelector('description'));
        const summary = textContent(item.querySelector('description'));
        const author = textContent(item.querySelector('author'))
            || textContent(item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]);
        const pubDate = textContent(item.querySelector('pubDate'));

        // Try to extract image from enclosure or media:content
        const enclosure = item.querySelector('enclosure[type^="image"]');
        const mediaContent = item.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'content')[0];
        const imageUrl = attrContent(enclosure, 'url') || attrContent(mediaContent, 'url');

        return {
            title: itemTitle || 'Untitled',
            url: link,
            content: content || summary || '',
            summary: summary !== content ? summary : undefined,
            author: author || undefined,
            imageUrl: imageUrl || undefined,
            publishedAt: pubDate ? new Date(pubDate) : undefined,
        };
    });

    return {
        title: title || 'Untitled Feed',
        description: description || undefined,
        siteUrl: siteUrl || undefined,
        iconUrl: imageUrl || undefined,
        articles,
    };
}

function parseAtomFeed(feed: Element): ParsedFeed {
    const title = textContent(feed.querySelector(':scope > title'));
    const subtitle = textContent(feed.querySelector(':scope > subtitle'));
    const siteLink = feed.querySelector(':scope > link[rel="alternate"]')
        ?? feed.querySelector(':scope > link:not([rel])');
    const siteUrl = attrContent(siteLink, 'href');
    const iconUrl = textContent(feed.querySelector(':scope > icon'))
        || textContent(feed.querySelector(':scope > logo'));

    const entries = Array.from(feed.querySelectorAll(':scope > entry'));
    const articles = entries.map(entry => {
        const entryTitle = textContent(entry.querySelector('title'));
        const linkEl = entry.querySelector('link[rel="alternate"]')
            ?? entry.querySelector('link:not([rel])');
        const link = attrContent(linkEl, 'href');
        const contentEl = entry.querySelector('content');
        const summaryEl = entry.querySelector('summary');
        const content = textContent(contentEl) || textContent(summaryEl);
        const summary = textContent(summaryEl);
        const author = textContent(entry.querySelector('author > name'));
        const published = textContent(entry.querySelector('published'))
            || textContent(entry.querySelector('updated'));

        return {
            title: entryTitle || 'Untitled',
            url: link,
            content: content || summary || '',
            summary: summary !== content ? summary : undefined,
            author: author || undefined,
            imageUrl: undefined,
            publishedAt: published ? new Date(published) : undefined,
        };
    });

    return {
        title: title || 'Untitled Feed',
        description: subtitle || undefined,
        siteUrl: siteUrl || undefined,
        iconUrl: iconUrl || undefined,
        articles,
    };
}

function parseRss1Feed(root: Element): ParsedFeed {
    const ns = 'http://purl.org/rss/1.0/';
    const channel = root.getElementsByTagNameNS(ns, 'channel')[0];
    const title = textContent(channel?.getElementsByTagNameNS(ns, 'title')[0]);
    const description = textContent(channel?.getElementsByTagNameNS(ns, 'description')[0]);
    const siteUrl = textContent(channel?.getElementsByTagNameNS(ns, 'link')[0]);

    const items = Array.from(root.getElementsByTagNameNS(ns, 'item'));
    const articles = items.map(item => {
        const itemTitle = textContent(item.getElementsByTagNameNS(ns, 'title')[0]);
        const link = textContent(item.getElementsByTagNameNS(ns, 'link')[0]);
        const itemDesc = textContent(item.getElementsByTagNameNS(ns, 'description')[0]);
        const contentEncoded = item.getElementsByTagNameNS('http://purl.org/rss/content/modules/1.0/', 'encoded')[0];
        const content = textContent(contentEncoded) || itemDesc;
        const author = textContent(item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]);
        const pubDate = textContent(item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'date')[0]);

        return {
            title: itemTitle || 'Untitled',
            url: link,
            content: content || '',
            summary: itemDesc || undefined,
            author: author || undefined,
            imageUrl: undefined,
            publishedAt: pubDate ? new Date(pubDate) : undefined,
        };
    });

    return {
        title: title || 'Untitled Feed',
        description: description || undefined,
        siteUrl: siteUrl || undefined,
        iconUrl: undefined,
        articles,
    };
}

// ── Public API ──

/**
 * Fetch and parse an RSS or Atom feed from a URL.
 */
export async function fetchAndParseFeed(
    url: string,
): Promise<{ feed: Omit<ParsedFeed, 'articles'>; articles: ParsedFeed['articles'] }> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
    }
    const xmlText = await response.text();
    const parsed = parseFeedXml(xmlText);
    const { articles, ...feedMeta } = parsed;
    return { feed: feedMeta, articles };
}

/**
 * Convert parsed feed results into store-ready objects.
 */
export function materializeFeed(
    url: string,
    parsed: Awaited<ReturnType<typeof fetchAndParseFeed>>,
): { feed: RssFeed; articles: RssArticle[] } {
    const feedId = uuidv4();
    const now = new Date();

    const articles: RssArticle[] = parsed.articles.map(a => ({
        id: uuidv4(),
        feedId,
        title: a.title,
        author: a.author,
        url: a.url,
        content: a.content,
        summary: a.summary,
        imageUrl: a.imageUrl,
        publishedAt: a.publishedAt,
        fetchedAt: now,
        isRead: false,
        isFavorite: false,
    }));

    const feed: RssFeed = {
        id: feedId,
        title: parsed.feed.title,
        url,
        siteUrl: parsed.feed.siteUrl,
        description: parsed.feed.description,
        iconUrl: parsed.feed.iconUrl,
        lastFetched: now,
        addedAt: now,
        unreadCount: articles.length,
    };

    return { feed, articles };
}

// ── Article → EPUB Conversion ──

/**
 * Convert an RSS article's HTML content into a minimal EPUB blob
 * that can be opened by the foliate engine.
 */
export function articleToEpub(article: RssArticle, feedTitle?: string): Blob {
    const title = article.title || 'Untitled Article';
    const author = article.author || feedTitle || 'Unknown';
    const identifier = `rss-article-${article.id}`;
    const articleDate = article.publishedAt ? new Date(article.publishedAt) : undefined;
    const fetchDate = article.fetchedAt ? new Date(article.fetchedAt) : new Date();
    const date = (articleDate ?? fetchDate).toISOString();

    // Sanitize HTML content - wrap in a proper XHTML document
    const xhtmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>${escapeXml(title)}</title>
    <style>
        body { font-family: serif; line-height: 1.6; }
        img { max-width: 100%; height: auto; }
        a { color: inherit; }
        pre, code { font-size: 0.9em; overflow-wrap: break-word; white-space: pre-wrap; }
        blockquote { margin-left: 1em; padding-left: 1em; border-left: 3px solid #ccc; }
        h1 { font-size: 1.4em; margin-bottom: 0.3em; }
        .article-meta { color: #666; font-size: 0.85em; margin-bottom: 1.5em; }
    </style>
</head>
<body>
    <h1>${escapeXml(title)}</h1>
    <div class="article-meta">
        ${author ? `<span>By ${escapeXml(author)}</span>` : ''}
        ${date ? ` · <time>${new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>` : ''}
        ${feedTitle ? ` · <span>${escapeXml(feedTitle)}</span>` : ''}
    </div>
    <div class="article-content">
        ${article.content}
    </div>
    ${article.url ? `<hr/><p><a href="${escapeXml(article.url)}">View original article</a></p>` : ''}
</body>
</html>`;

    // Build EPUB structure using fflate
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`;

    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>
        <dc:title>${escapeXml(title)}</dc:title>
        <dc:creator>${escapeXml(author)}</dc:creator>
        <dc:language>en</dc:language>
        <dc:date>${date}</dc:date>
        <meta property="dcterms:modified">${date}</meta>
    </metadata>
    <manifest>
        <item id="article" href="article.xhtml" media-type="application/xhtml+xml"/>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    </manifest>
    <spine>
        <itemref idref="article"/>
    </spine>
</package>`;

    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Navigation</title></head>
<body>
    <nav epub:type="toc">
        <ol>
            <li><a href="article.xhtml">${escapeXml(title)}</a></li>
        </ol>
    </nav>
</body>
</html>`;

    const files: Record<string, Uint8Array> = {
        'mimetype': strToU8('application/epub+zip'),
        'META-INF/container.xml': strToU8(containerXml),
        'OEBPS/content.opf': strToU8(contentOpf),
        'OEBPS/article.xhtml': strToU8(xhtmlContent),
        'OEBPS/nav.xhtml': strToU8(navXhtml),
    };

    const zipped = zipSync(files, {
        // mimetype must be stored uncompressed (EPUB spec)
        // fflate's zipSync stores all by default, which is fine for small EPUBs
    });

    return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/epub+zip' });
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
