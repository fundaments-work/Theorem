/**
 * RSS Service
 * Fetches and parses RSS/Atom/JSON/RDF feeds using fast-xml-parser for robust
 * XML handling, with @mozilla/readability for full-article extraction.
 */

import type { RssFeed, RssArticle } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { Readability } from '@mozilla/readability';
import { XMLParser } from 'fast-xml-parser';
import { isTauri } from '../lib/env';

// ── Types ──

interface ParsedFeed {
    title: string;
    description?: string;
    siteUrl?: string;
    iconUrl?: string;
    articles: Omit<RssArticle, 'id' | 'feedId' | 'fetchedAt' | 'isRead' | 'isFavorite'>[];
}

export interface ExtractedArticleContent {
    content: string;
    title?: string;
    author?: string;
    summary?: string;
    imageUrl?: string;
    publishedAt?: Date;
}

// ── Helpers ──

/**
 * Safely coerce a value to a string.
 * fast-xml-parser may return numbers, booleans, objects, or strings depending
 * on how the XML node is structured.
 */
function str(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    // Object: could be an element with attributes — try #text or toString
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if ('#text' in obj) return str(obj['#text']);
        if ('__text' in obj) return str(obj['__text']);
        return '';
    }
    return '';
}

/** Ensure a value is an array. */
function ensureArray<T>(value: T | T[] | undefined | null): T[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function parseOptionalDate(value: unknown): Date | undefined {
    const s = str(value);
    if (!s) return undefined;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? undefined : d;
}

function resolveAbsoluteUrl(value: string, baseUrl: string): string {
    if (!value || value.startsWith('data:') || value.startsWith('javascript:')) {
        return value;
    }
    try {
        return new URL(value, baseUrl).href;
    } catch {
        return value;
    }
}

function absolutizeSrcset(srcset: string, baseUrl: string): string {
    return srcset
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(candidate => {
            const parts = candidate.split(/\s+/);
            const resolved = resolveAbsoluteUrl(parts[0], baseUrl);
            return parts.length === 1 ? resolved : `${resolved} ${parts.slice(1).join(' ')}`;
        })
        .join(', ');
}

function normalizeWhitespace(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

// ── XML Parser Factory ──

function createFeedParser(): XMLParser {
    return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        // Preserve namespace prefixes so we can match on them.
        removeNSPrefix: false,
        // Parse text inside CDATA as text (not raw CDATA markers).
        cdataPropName: undefined,
        textNodeName: '#text',
        // Never treat known feed values as numbers — keep them as strings.
        parseTagValue: false,
        parseAttributeValue: false,
        // Treat certain tags that can repeat as arrays even if only one exists.
        isArray: (_name: string, _jpath: string) => {
            // Items / entries are always arrays.
            if (_name === 'item' || _name === 'entry') return true;
            // Atom links can repeat.
            if (_name === 'link') return true;
            return false;
        },
        trimValues: true,
    });
}

// ── HTML Detection & Feed Discovery ──

function isHtmlContent(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
        return true;
    }
    if (trimmed.includes('<html') && !trimmed.includes('<rss') && !trimmed.includes('<feed')) {
        return true;
    }
    // If it has typical HTML-only elements and no feed-level indicators.
    const htmlTags = ['<head', '<body', '<meta', '<div', '<script', '<style'];
    const feedIndicators = ['<rss', '<feed', '<channel', 'jsonfeed', '<rdf:'];
    if (htmlTags.some(t => trimmed.includes(t)) && !feedIndicators.some(t => trimmed.includes(t))) {
        return true;
    }
    return false;
}

/**
 * Extract all discoverable feed URLs from an HTML page.
 * Returns an array of absolute URLs.
 */
function extractFeedUrlsFromHtml(htmlText: string, baseUrl?: string): string[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const urls: string[] = [];

    // Standard <link> discovery.
    const feedLinks = doc.querySelectorAll(
        'link[type="application/rss+xml"],' +
        'link[type="application/atom+xml"],' +
        'link[type="application/json"],' +
        'link[type="application/feed+json"],' +
        'link[type="application/json+feed"],' +
        'link[type="application/xml"],' +
        'link[type="text/xml"]'
    );
    for (const link of Array.from(feedLinks)) {
        const href = link.getAttribute('href');
        if (href) {
            urls.push(baseUrl ? resolveAbsoluteUrl(href, baseUrl) : href);
        }
    }

    // Anchor-based heuristic: <a href="...rss...">, <a href="...feed...">
    if (urls.length === 0) {
        const anchors = doc.querySelectorAll<HTMLAnchorElement>('a[href]');
        const feedPattern = /\/(feed|rss|atom)(\.xml|\.json|\/)?$/i;
        for (const a of Array.from(anchors)) {
            const href = a.getAttribute('href');
            if (href && feedPattern.test(href)) {
                urls.push(baseUrl ? resolveAbsoluteUrl(href, baseUrl) : href);
            }
        }
    }

    return urls;
}

/** Legacy single-URL convenience wrapper. */
function extractFeedUrlFromHtml(htmlText: string, baseUrl?: string): string | null {
    const urls = extractFeedUrlsFromHtml(htmlText, baseUrl);
    return urls[0] ?? null;
}

// ── JSON Feed ──

interface JsonFeedAttachment {
    url: string;
    mime_type?: string;
    title?: string;
}

interface JsonFeedItem {
    id: string;
    title?: string;
    url?: string;
    external_url?: string;
    content_html?: string;
    content_text?: string;
    summary?: string;
    date_published?: string;
    date_modified?: string;
    author?: { name?: string };
    authors?: Array<{ name?: string }>;
    image?: string;
    banner_image?: string;
    attachments?: JsonFeedAttachment[];
}

function tryParseJsonFeed(text: string): ParsedFeed | null {
    try {
        const json = JSON.parse(text);
        if (!json.version || (!json.version.includes('jsonfeed') && !json.items)) {
            return null;
        }

        const articles = (json.items || []).map((item: JsonFeedItem) => {
            const content = item.content_html || item.content_text || item.summary || '';
            const summary = item.summary || (item.content_text ? item.content_text.substring(0, 500) : undefined);

            let imageUrl: string | undefined;
            if (item.banner_image) {
                imageUrl = item.banner_image;
            } else if (item.image) {
                imageUrl = item.image;
            } else if (item.attachments) {
                const imageAttachment = item.attachments.find((a: JsonFeedAttachment) =>
                    a.mime_type?.startsWith('image/')
                );
                if (imageAttachment) {
                    imageUrl = imageAttachment.url;
                }
            }

            return {
                title: item.title || 'Untitled',
                url: item.url || item.external_url || '',
                content,
                summary,
                author: item.author?.name || (Array.isArray(item.authors) ? item.authors[0]?.name : undefined),
                imageUrl,
                publishedAt: item.date_published ? new Date(item.date_published) :
                    item.date_modified ? new Date(item.date_modified) : undefined,
            };
        });

        return {
            title: json.title || 'Untitled Feed',
            description: json.description,
            siteUrl: json.home_page_url,
            iconUrl: json.icon || json.favicon,
            articles,
        };
    } catch {
        return null;
    }
}

// ── XML Feed Parsing with fast-xml-parser ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FeedNode = Record<string, any>;

/** Extract a text string from a node that could be #text, plain string, or nested. */
function nodeText(node: unknown): string {
    if (node == null) return '';
    if (typeof node === 'string') return node.trim();
    if (typeof node === 'number') return String(node);
    if (typeof node === 'object') {
        const obj = node as FeedNode;
        // CDATA / text content
        if ('#text' in obj) return str(obj['#text']);
        // If it's an array, join texts
        if (Array.isArray(obj)) return obj.map(nodeText).join(' ').trim();
    }
    return '';
}

/**
 * Find the first truthy value from a list of potential node paths on an object.
 * Handles namespaced keys like "content:encoded", "dc:creator", etc.
 */
function firstOf(obj: FeedNode, ...keys: string[]): unknown {
    for (const key of keys) {
        if (obj[key] != null) return obj[key];
    }
    return undefined;
}

/** Get the Atom link href, preferring rel="alternate", then bare links. */
function atomLinkHref(links: FeedNode | FeedNode[] | undefined, rel = 'alternate'): string {
    const arr = ensureArray(links) as FeedNode[];
    // First try the specified rel.
    for (const link of arr) {
        if (typeof link === 'string') return (link as string).trim();
        const l = link as FeedNode;
        if (l['@_rel'] === rel || (!l['@_rel'] && rel === 'alternate')) {
            const href = l['@_href'] ?? '';
            if (href) return str(href);
        }
    }
    // Fallback to first href we find.
    for (const link of arr) {
        if (typeof link === 'string') return (link as string).trim();
        const l = link as FeedNode;
        const href = l['@_href'] ?? '';
        if (href) return str(href);
    }
    return '';
}

// ── RSS 2.0 Parser ──

function parseRss2(root: FeedNode): ParsedFeed {
    const rss = root.rss || root;
    const channel: FeedNode = rss.channel || rss;

    const title = nodeText(channel.title);
    const description = nodeText(channel.description);
    const siteUrl = nodeText(channel.link);
    const iconUrl = nodeText(channel.image?.url) || nodeText(channel['itunes:image']?.['@_href']);

    const items = ensureArray(channel.item);
    const articles = items.map((item: FeedNode) => {
        const itemTitle = nodeText(item.title);

        // Link: try <link>, then <guid isPermaLink="true">
        let link = nodeText(item.link);
        if (!link) {
            const guid = item.guid;
            if (typeof guid === 'object' && guid?.['@_isPermaLink'] === 'true') {
                link = nodeText(guid);
            } else if (typeof guid === 'string' && (guid.startsWith('http://') || guid.startsWith('https://'))) {
                link = guid.trim();
            }
        }

        // Content: prefer content:encoded, then description
        const contentEncoded = firstOf(item, 'content:encoded', 'content\\:encoded', 'encoded');
        let content = nodeText(contentEncoded);
        if (!content) {
            content = nodeText(item.description);
        }

        const summary = nodeText(item.description);

        // Author: try <author>, <dc:creator>, <dc:author>
        const author = nodeText(firstOf(item, 'author', 'dc:creator', 'dc:author'))
            || nodeText(firstOf(item, 'itunes:author'))
            || undefined;

        // Date: <pubDate>, <dc:date>
        const pubDate = nodeText(firstOf(item, 'pubDate', 'dc:date', 'published', 'updated'));

        // Image: enclosure, media:content, media:thumbnail, itunes:image
        let articleImageUrl: string | undefined;

        // 1. Enclosure with image type
        const enclosures = ensureArray(item.enclosure);
        for (const enc of enclosures) {
            const type = str(enc?.['@_type']);
            if (type.startsWith('image/')) {
                articleImageUrl = str(enc?.['@_url']);
                break;
            }
        }

        // 2. media:content
        if (!articleImageUrl) {
            const mediaContents = ensureArray(firstOf(item, 'media:content')) as FeedNode[];
            for (const mc of mediaContents) {
                const n = mc as FeedNode;
                const type = str(n['@_type'] ?? n['@_medium']);
                const url = str(n['@_url']);
                if (url && (type.startsWith('image') || type === 'image')) {
                    articleImageUrl = url;
                    break;
                }
                // If medium="image" without a type attribute
                if (url && str(n['@_medium']) === 'image') {
                    articleImageUrl = url;
                    break;
                }
            }
        }

        // 3. media:thumbnail
        if (!articleImageUrl) {
            const mediaThumbnail = firstOf(item, 'media:thumbnail');
            const thumbUrl = str(typeof mediaThumbnail === 'object' ? (mediaThumbnail as FeedNode)?.['@_url'] : mediaThumbnail);
            if (thumbUrl) articleImageUrl = thumbUrl;
        }

        // 4. media:group > media:content / media:thumbnail
        if (!articleImageUrl) {
            const mediaGroup = item['media:group'];
            if (mediaGroup) {
                const groupContents = ensureArray(mediaGroup['media:content']);
                for (const mc of groupContents) {
                    if (str(mc?.['@_medium']) === 'image' || str(mc?.['@_type']).startsWith('image')) {
                        articleImageUrl = str(mc?.['@_url']);
                        break;
                    }
                }
                if (!articleImageUrl) {
                    const groupThumb = mediaGroup['media:thumbnail'];
                    const gUrl = str(typeof groupThumb === 'object' ? groupThumb?.['@_url'] : groupThumb);
                    if (gUrl) articleImageUrl = gUrl;
                }
            }
        }

        // 5. itunes:image
        if (!articleImageUrl) {
            const itunesImage = item['itunes:image'];
            if (itunesImage) {
                articleImageUrl = str(typeof itunesImage === 'object' ? itunesImage?.['@_href'] : itunesImage);
            }
        }

        // 6. Extract first <img> from content HTML as last resort
        if (!articleImageUrl && content) {
            const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch?.[1]) {
                articleImageUrl = imgMatch[1];
            }
        }

        return {
            title: itemTitle || 'Untitled',
            url: link,
            content: content || summary || '',
            summary: summary !== content ? summary : undefined,
            author,
            imageUrl: articleImageUrl,
            publishedAt: parseOptionalDate(pubDate),
        };
    });

    return {
        title: title || 'Untitled Feed',
        description: description || undefined,
        siteUrl: siteUrl || undefined,
        iconUrl: iconUrl || undefined,
        articles,
    };
}

// ── Atom Parser ──

function parseAtomFeed(root: FeedNode): ParsedFeed {
    const feed: FeedNode = root.feed || root;

    const title = nodeText(feed.title);
    const subtitle = nodeText(feed.subtitle);
    const siteUrl = atomLinkHref(feed.link, 'alternate');
    const iconUrl = nodeText(feed.icon) || nodeText(feed.logo);

    const entries = ensureArray(feed.entry);
    const articles = entries.map((entry: FeedNode) => {
        const entryTitle = nodeText(entry.title);
        const link = atomLinkHref(entry.link, 'alternate');

        // Content: prefer type="html", then any content, then summary.
        let content = '';
        const contentNode = entry.content;
        if (contentNode != null) {
            if (typeof contentNode === 'object' && '#text' in contentNode) {
                content = str(contentNode['#text']);
            } else {
                content = nodeText(contentNode);
            }
        }

        const summary = nodeText(entry.summary);
        if (!content) content = summary;

        // Author
        let author = '';
        const authorNode = entry.author;
        if (authorNode) {
            author = nodeText(authorNode.name) || nodeText(authorNode);
        }
        if (!author) {
            // Try feed-level author.
            const feedAuthor = feed.author;
            if (feedAuthor) {
                author = nodeText(feedAuthor.name) || nodeText(feedAuthor);
            }
        }

        // Date
        const published = nodeText(firstOf(entry, 'published', 'updated', 'dc:date'));

        // Image: try media:thumbnail, media:content, enclosure
        let imageUrl: string | undefined;
        const mediaThumbnail = firstOf(entry, 'media:thumbnail');
        if (mediaThumbnail) {
            imageUrl = str(typeof mediaThumbnail === 'object' ? (mediaThumbnail as FeedNode)?.['@_url'] : mediaThumbnail);
        }
        if (!imageUrl) {
            const mediaContents = ensureArray(firstOf(entry, 'media:content')) as FeedNode[];
            for (const mc of mediaContents) {
                const n = mc as FeedNode;
                if (str(n['@_medium']) === 'image' || str(n['@_type']).startsWith('image')) {
                    imageUrl = str(n['@_url']);
                    break;
                }
            }
        }
        if (!imageUrl) {
            const enclosures = ensureArray(entry.link);
            for (const enc of enclosures) {
                if (str(enc?.['@_rel']) === 'enclosure' && str(enc?.['@_type']).startsWith('image')) {
                    imageUrl = str(enc?.['@_href']);
                    break;
                }
            }
        }
        // Last resort: first <img> in content
        if (!imageUrl && content) {
            const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (imgMatch?.[1]) imageUrl = imgMatch[1];
        }

        return {
            title: entryTitle || 'Untitled',
            url: link,
            content: content || '',
            summary: summary !== content ? summary : undefined,
            author: author || undefined,
            imageUrl,
            publishedAt: parseOptionalDate(published),
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

// ── RDF / RSS 1.0 Parser ──

function parseRdfFeed(root: FeedNode): ParsedFeed {
    // RDF feeds use namespaced tags like rdf:RDF > rss:channel + rss:item
    // fast-xml-parser preserves prefixes, so we search for common patterns.
    const rdf = root['rdf:RDF'] || root['RDF'] || root;
    const channel: FeedNode = rdf.channel || rdf['rss:channel'] || {};

    const title = nodeText(firstOf(channel, 'title', 'rss:title'));
    const description = nodeText(firstOf(channel, 'description', 'rss:description'));
    const siteUrl = nodeText(firstOf(channel, 'link', 'rss:link'));

    const items = ensureArray(rdf.item || rdf['rss:item']);
    const articles = items.map((item: FeedNode) => {
        const itemTitle = nodeText(firstOf(item, 'title', 'rss:title'));
        const link = nodeText(firstOf(item, 'link', 'rss:link'));
        const itemDesc = nodeText(firstOf(item, 'description', 'rss:description'));
        const contentEncoded = firstOf(item, 'content:encoded', 'content\\:encoded');
        const content = nodeText(contentEncoded) || itemDesc;
        const author = nodeText(firstOf(item, 'dc:creator', 'dc:author', 'author'));
        const pubDate = nodeText(firstOf(item, 'dc:date', 'pubDate'));

        return {
            title: itemTitle || 'Untitled',
            url: link,
            content: content || '',
            summary: itemDesc || undefined,
            author: author || undefined,
            imageUrl: undefined,
            publishedAt: parseOptionalDate(pubDate),
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

// ── Main Feed Dispatcher ──

function parseFeedXml(xmlText: string): ParsedFeed {
    // HTML detection.
    if (isHtmlContent(xmlText)) {
        const feedUrl = extractFeedUrlFromHtml(xmlText);
        if (feedUrl) {
            throw new Error(
                `This URL returns an HTML page instead of a feed. ` +
                `The actual feed URL appears to be: ${feedUrl}. ` +
                `Please try using that URL instead.`
            );
        }
        throw new Error(
            `This URL returns HTML instead of a valid RSS/Atom feed. ` +
            `The site may require visiting the page in a browser first, ` +
            `or the feed URL may be different. Try looking for a link ` +
            `with "RSS" or "Feed" on the website.`
        );
    }

    // Try JSON Feed first (before XML parsing).
    const jsonFeed = tryParseJsonFeed(xmlText);
    if (jsonFeed) return jsonFeed;

    // Parse XML.
    const parser = createFeedParser();
    let parsed: FeedNode;
    try {
        parsed = parser.parse(xmlText);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse feed XML: ${msg}`);
    }

    // Detect feed type from the parsed object structure.
    // RSS 2.0: root has <rss> or <rss><channel>.
    if (parsed.rss) {
        return parseRss2(parsed);
    }

    // Atom: root has <feed>.
    if (parsed.feed) {
        return parseAtomFeed(parsed);
    }

    // RDF / RSS 1.0: root has <rdf:RDF> or <RDF>.
    if (parsed['rdf:RDF'] || parsed['RDF']) {
        return parseRdfFeed(parsed);
    }

    // Some feeds omit the <rss> wrapper and just start with <channel>.
    if (parsed.channel) {
        return parseRss2({ channel: parsed.channel });
    }

    // Last resort: look at all top-level keys.
    const keys = Object.keys(parsed).filter(k => !k.startsWith('?'));
    if (keys.length === 1) {
        const root = parsed[keys[0]];
        if (root?.channel) return parseRss2(root);
        if (root?.entry) return parseAtomFeed(root);
    }

    throw new Error(
        'Unrecognized feed format. Supported formats: RSS 2.0, RSS 1.0/RDF, Atom, JSON Feed.'
    );
}

// ── Fetching ──

async function fetchWithTauri(url: string): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('fetch_rss_feed', { url });
}

async function fetchUrlWithTauri(url: string): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('fetch_url_content', { url });
}

function isCorsError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
        message.includes('cors') ||
        message.includes('access control') ||
        message.includes('preflight') ||
        message.includes('cross-origin') ||
        message.includes('blocked by cors') ||
        (message.includes('load failed') && !message.includes('json')) ||
        message.includes('networkerror') ||
        message.includes('failed to fetch')
    );
}

function isLikelyCorsRestricted(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    const corsRestrictedServices = [
        'elsevier.com', 'springer.com', 'sciencedirect.com', 'nature.com',
        'ieee.org', 'acm.org', 'jstor.org', 'wiley.com',
        'tandfonline.com', 'sagepub.com',
    ];
    return corsRestrictedServices.some(service => lowerUrl.includes(service));
}

// ── Article Content Extraction (Readability + fallback) ──

const ARTICLE_CONTAINER_SELECTORS = [
    'article',
    '[itemprop="articleBody"]',
    '[data-testid*="article"]',
    '.article-content',
    '.article-body',
    '.post-content',
    '.entry-content',
    '.story-content',
    '.content-body',
    'main article',
    'main',
    '#content',
];

const ARTICLE_REMOVE_SELECTORS = [
    'script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas',
    'form', 'button', 'input', 'textarea', 'select',
    'nav', 'aside', 'footer', 'header',
    '[role="navigation"]', '[role="banner"]', '[role="dialog"]',
    '[aria-hidden="true"]',
    '[class*="cookie"]', '[id*="cookie"]',
    '[class*="consent"]', '[id*="consent"]',
    '[class*="ad-"]', '[class*="advert"]', '[id*="ad-"]',
    '.advertisement', '.social-share', '.share-buttons',
    '.related-posts', '.newsletter',
    '.sidebar', '.widget', '.popup', '.modal',
    '[class*="subscription"]', '[class*="paywall"]',
    '[class*="comment"]', '[id*="comment"]',
];

const ARTICLE_META_TITLE_SELECTORS = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
];
const ARTICLE_META_SUMMARY_SELECTORS = [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
];
const ARTICLE_META_AUTHOR_SELECTORS = [
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[name="twitter:creator"]',
];
const ARTICLE_META_IMAGE_SELECTORS = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
];
const ARTICLE_META_PUBLISH_TIME_SELECTORS = [
    'meta[property="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    'time[datetime]',
];

const MIN_EXTRACTED_ARTICLE_TEXT_LENGTH = 320;

function stripNonContentElements(root: HTMLElement): void {
    root.querySelectorAll(ARTICLE_REMOVE_SELECTORS.join(',')).forEach(n => n.remove());
}

function normalizeContentUrls(root: HTMLElement, baseUrl: string): void {
    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href) link.setAttribute('href', resolveAbsoluteUrl(href, baseUrl));
    });
    root.querySelectorAll<HTMLElement>('[src]').forEach(node => {
        const src = node.getAttribute('src');
        if (src) node.setAttribute('src', resolveAbsoluteUrl(src, baseUrl));
    });
    root.querySelectorAll<HTMLElement>('[srcset]').forEach(node => {
        const srcset = node.getAttribute('srcset');
        if (srcset) node.setAttribute('srcset', absolutizeSrcset(srcset, baseUrl));
    });
}

function getMetaContent(doc: Document, selectors: string[]): string | undefined {
    for (const selector of selectors) {
        const el = doc.querySelector(selector);
        if (!el) continue;
        const content = (el.getAttribute('content') || el.textContent || '').trim();
        if (content) return content;
    }
    return undefined;
}

function scoreArticleCandidate(element: HTMLElement): number {
    const clone = element.cloneNode(true) as HTMLElement;
    stripNonContentElements(clone);

    const text = normalizeWhitespace(clone.textContent || '');
    const textLength = text.length;
    if (textLength === 0) return 0;

    const paragraphCount = clone.querySelectorAll('p').length;
    const headingCount = clone.querySelectorAll('h1, h2, h3').length;
    const linkTextLength = Array.from(clone.querySelectorAll('a')).reduce(
        (total, link) => total + normalizeWhitespace(link.textContent || '').length, 0,
    );
    const linkDensity = textLength > 0 ? linkTextLength / textLength : 1;
    return textLength + (paragraphCount * 120) + (headingCount * 80) - (linkDensity * 400);
}

function selectArticleRoot(doc: Document): HTMLElement | null {
    const candidates: HTMLElement[] = [];
    const seen = new Set<Element>();

    for (const selector of ARTICLE_CONTAINER_SELECTORS) {
        doc.querySelectorAll(selector).forEach(node => {
            if (!(node instanceof HTMLElement) || seen.has(node)) return;
            seen.add(node);
            candidates.push(node);
        });
    }

    if (doc.body && !seen.has(doc.body)) {
        candidates.push(doc.body);
    }

    let bestCandidate: HTMLElement | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
        const score = scoreArticleCandidate(candidate);
        if (score > bestScore) {
            bestScore = score;
            bestCandidate = candidate;
        }
    }
    return bestCandidate;
}

function extractArticleContentWithReadability(html: string, articleUrl: string): ExtractedArticleContent | null {
    const domParser = new DOMParser();
    const metaDoc = domParser.parseFromString(html, 'text/html');
    const readabilityDoc = domParser.parseFromString(html, 'text/html');

    if (readabilityDoc.head && !readabilityDoc.querySelector('base')) {
        const base = readabilityDoc.createElement('base');
        base.setAttribute('href', articleUrl);
        readabilityDoc.head.prepend(base);
    }

    const parsed = new Readability(readabilityDoc, {
        keepClasses: false,
        charThreshold: MIN_EXTRACTED_ARTICLE_TEXT_LENGTH,
    }).parse();

    if (!parsed?.content) return null;

    const contentDoc = domParser.parseFromString(parsed.content, 'text/html');
    const contentRoot = contentDoc.body;
    if (!contentRoot) return null;

    stripNonContentElements(contentRoot);
    normalizeContentUrls(contentRoot, articleUrl);

    const content = contentRoot.innerHTML.trim();
    const textLength = normalizeWhitespace(contentRoot.textContent || '').length;
    if (!content || textLength < MIN_EXTRACTED_ARTICLE_TEXT_LENGTH) return null;

    const summary = normalizeWhitespace(parsed.excerpt || '')
        || getMetaContent(metaDoc, ARTICLE_META_SUMMARY_SELECTORS)
        || undefined;
    const title = normalizeWhitespace(parsed.title || '')
        || getMetaContent(metaDoc, ARTICLE_META_TITLE_SELECTORS)
        || normalizeWhitespace(metaDoc.title || '')
        || undefined;
    const author = normalizeWhitespace(parsed.byline || '')
        || getMetaContent(metaDoc, ARTICLE_META_AUTHOR_SELECTORS)
        || normalizeWhitespace(metaDoc.querySelector('[rel="author"], .author, .byline')?.textContent || '')
        || undefined;
    const imageUrl = resolveAbsoluteUrl(
        getMetaContent(metaDoc, ARTICLE_META_IMAGE_SELECTORS)
        || contentRoot.querySelector('img')?.getAttribute('src')
        || '',
        articleUrl,
    ) || undefined;
    const publishedAt = parseOptionalDate(
        metaDoc.querySelector('time[datetime]')?.getAttribute('datetime')
        || getMetaContent(metaDoc, ARTICLE_META_PUBLISH_TIME_SELECTORS),
    );

    return { content, title, summary, author, imageUrl, publishedAt };
}

function extractArticleContentFallback(html: string, articleUrl: string): ExtractedArticleContent | null {
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(html, 'text/html');
    const articleRoot = selectArticleRoot(doc);
    if (!articleRoot) return null;

    const contentRoot = articleRoot.cloneNode(true) as HTMLElement;
    stripNonContentElements(contentRoot);
    normalizeContentUrls(contentRoot, articleUrl);

    const content = contentRoot.innerHTML.trim();
    const textLength = normalizeWhitespace(contentRoot.textContent || '').length;
    if (!content || textLength < MIN_EXTRACTED_ARTICLE_TEXT_LENGTH) return null;

    const title = getMetaContent(doc, ARTICLE_META_TITLE_SELECTORS)
        || normalizeWhitespace(doc.querySelector('h1')?.textContent || '')
        || normalizeWhitespace(doc.title || '')
        || undefined;
    const summary = getMetaContent(doc, ARTICLE_META_SUMMARY_SELECTORS);
    const author = getMetaContent(doc, ARTICLE_META_AUTHOR_SELECTORS)
        || normalizeWhitespace(doc.querySelector('[rel="author"], .author, .byline')?.textContent || '')
        || undefined;
    const imageUrl = resolveAbsoluteUrl(
        getMetaContent(doc, ARTICLE_META_IMAGE_SELECTORS)
        || contentRoot.querySelector('img')?.getAttribute('src')
        || '',
        articleUrl,
    ) || undefined;
    const publishedAt = parseOptionalDate(
        doc.querySelector('time[datetime]')?.getAttribute('datetime')
        || getMetaContent(doc, ARTICLE_META_PUBLISH_TIME_SELECTORS),
    );

    return { content, title, summary, author, imageUrl, publishedAt };
}

async function fetchUrlContent(url: string): Promise<string> {
    if (isTauri()) {
        try {
            return await fetchUrlWithTauri(url);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to fetch article content: ${message}`);
        }
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });
    } catch (error) {
        const fetchError = error instanceof Error ? error : new Error(String(error));
        if (isCorsError(fetchError)) {
            throw new Error(
                `CORS Error while fetching article from ${new URL(url).hostname}. ` +
                `Use the desktop app mode or a feed source with full-text content.`,
            );
        }
        throw fetchError;
    }

    if (!response.ok) {
        throw new Error(`Failed to fetch article: ${response.status} ${response.statusText}`);
    }

    return await response.text();
}

// ── Public API ──

/**
 * Fetches the linked article URL and extracts full readable content.
 * Falls back to feed content if extraction fails.
 */
export async function fetchAndExtractArticleContent(articleUrl: string): Promise<ExtractedArticleContent> {
    const htmlText = await fetchUrlContent(articleUrl);
    const extracted = extractArticleContentWithReadability(htmlText, articleUrl)
        || extractArticleContentFallback(htmlText, articleUrl);
    if (!extracted) {
        throw new Error('Could not extract full article content from source page.');
    }
    return extracted;
}

/**
 * Fetch and parse an RSS or Atom feed from a URL.
 * If the URL returns HTML, attempts auto-discovery of feed URLs and follows them.
 */
export async function fetchAndParseFeed(
    url: string,
): Promise<{ feed: Omit<ParsedFeed, 'articles'>; articles: ParsedFeed['articles'] }> {
    let xmlText: string;

    if (isTauri()) {
        try {
            xmlText = await fetchWithTauri(url);
        } catch (tauriError) {
            const errorMsg = tauriError instanceof Error ? tauriError.message : String(tauriError);
            throw new Error(`Failed to fetch feed: ${errorMsg}`);
        }
    } else {
        if (isLikelyCorsRestricted(url)) {
            throw new Error(
                `This URL appears to be from an academic publisher that blocks browser requests (CORS). ` +
                `Academic publishers typically require authentication and block direct feed access from web browsers. ` +
                `Try using a different feed source or accessing through the publisher's official RSS page.`
            );
        }

        let response: Response;
        try {
            response = await fetch(url, { method: 'GET' });
        } catch (fetchError) {
            const error = fetchError instanceof Error ? fetchError : new Error(String(fetchError));
            if (isCorsError(error)) {
                throw new Error(
                    `CORS Error: The server at ${new URL(url).hostname} is blocking browser requests. ` +
                    `This is a security restriction on the server side. ` +
                    `Try these solutions:\n` +
                    `1. Find the feed on a different aggregator (e.g., Feedly)\n` +
                    `2. Use the website's main RSS link instead\n` +
                    `3. Check if the site requires authentication`
                );
            }
            if (error.message.includes('failed to fetch') || error.message.includes('network')) {
                throw new Error(
                    `Network error: Unable to reach ${url}. ` +
                    `Please check:\n` +
                    `1. Your internet connection\n` +
                    `2. The URL is correct\n` +
                    `3. The server is online`
                );
            }
            throw error;
        }

        if (!response.ok) {
            if (response.status === 403) {
                throw new Error(
                    `Access forbidden (403): The server blocked this request. ` +
                    `This may be due to:\n` +
                    `1. CORS restrictions - the server blocks browser requests\n` +
                    `2. Authentication required\n` +
                    `3. Rate limiting\n` +
                    `Try accessing the feed URL directly in your browser to verify it works.`
                );
            }
            if (response.status === 404) {
                throw new Error(`Feed not found (404): The URL does not exist. Please check the URL is correct.`);
            }
            if (response.status === 401) {
                throw new Error(`Authentication required (401): This feed requires login credentials.`);
            }
            throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
        }

        try {
            xmlText = await response.text();
        } catch (textError) {
            throw new Error(`Failed to read feed content: ${textError instanceof Error ? textError.message : 'Unknown error'}`);
        }
    }

    // If we got HTML, attempt feed auto-discovery and follow redirects.
    if (isHtmlContent(xmlText)) {
        const discoveredUrls = extractFeedUrlsFromHtml(xmlText, url);
        for (const feedUrl of discoveredUrls) {
            const resolvedUrl = new URL(feedUrl, url).href;
            try {
                let newText: string;
                if (isTauri()) {
                    newText = await fetchWithTauri(resolvedUrl);
                } else {
                    const newResponse = await fetch(resolvedUrl, { method: 'GET' });
                    if (!newResponse.ok) continue;
                    newText = await newResponse.text();
                }
                if (!isHtmlContent(newText)) {
                    const parsed = parseFeedXml(newText);
                    const { articles, ...feedMeta } = parsed;
                    return { feed: feedMeta, articles };
                }
            } catch {
                // Try next discovered URL.
            }
        }

        // If no discovered URLs worked, try common feed paths as a heuristic.
        const commonFeedPaths = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml', '/feed/'];
        for (const path of commonFeedPaths) {
            try {
                const guessUrl = new URL(path, url).href;
                let guessText: string;
                if (isTauri()) {
                    guessText = await fetchWithTauri(guessUrl);
                } else {
                    const guessRes = await fetch(guessUrl, { method: 'GET' });
                    if (!guessRes.ok) continue;
                    guessText = await guessRes.text();
                }
                if (!isHtmlContent(guessText)) {
                    const parsed = parseFeedXml(guessText);
                    const { articles, ...feedMeta } = parsed;
                    return { feed: feedMeta, articles };
                }
            } catch {
                // Continue trying.
            }
        }
    }

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
