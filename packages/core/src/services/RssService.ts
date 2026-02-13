/**
 * RSS Service
 * Fetches and parses RSS/Atom/JSON feeds
 */

import type { RssFeed, RssArticle } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { isTauri } from '../lib/env';

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
 * Detect if the content is HTML instead of XML/JSON
 */
function isHtmlContent(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    // Check for common HTML doctype or html tag
    if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
        return true;
    }
    // Check if it contains HTML but not XML feed indicators
    if (trimmed.includes('<html') && !trimmed.includes('<rss') && !trimmed.includes('<feed')) {
        return true;
    }
    // Check for parser error that indicates HTML
    if (trimmed.includes('<parsererror') || trimmed.includes('xmlns') === false) {
        // Additional check: if it has typical HTML elements
        const htmlTags = ['<head', '<body', '<meta', '<title', '<div', '<script', '<style'];
        return htmlTags.some(tag => trimmed.includes(tag));
    }
    return false;
}

/**
 * Extract feed URL from HTML page if available
 */
function extractFeedUrlFromHtml(htmlText: string): string | null {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    // Look for RSS/Atom link tags
    const feedLinks = doc.querySelectorAll('link[type="application/rss+xml"], link[type="application/atom+xml"], link[type="application/json+feed"], link[type="application/feed+json"]');

    for (const link of Array.from(feedLinks)) {
        const href = link.getAttribute('href');
        if (href) {
            return href;
        }
    }

    return null;
}

/**
 * Parse an RSS 2.0, Atom, RSS 1.0, or JSON Feed document into a structured feed.
 */
function parseFeedXml(xmlText: string): ParsedFeed {
    // Check if this is actually HTML
    if (isHtmlContent(xmlText)) {
        // Try to extract actual feed URL
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

    // Try JSON Feed first
    const jsonFeed = tryParseJsonFeed(xmlText);
    if (jsonFeed) {
        return jsonFeed;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        const errorText = parseError.textContent?.substring(0, 200) || 'Unknown parse error';
        throw new Error(`Invalid XML: ${errorText}. The URL may be returning HTML instead of a feed.`);
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

    throw new Error('Unrecognized feed format. Supported formats: RSS 2.0, Atom, RSS 1.0, JSON Feed');
}

/**
 * Try to parse as JSON Feed format
 */
function tryParseJsonFeed(text: string): ParsedFeed | null {
    try {
        const json = JSON.parse(text);

        // JSON Feed version check
        if (!json.version || (!json.version.includes('jsonfeed') && !json.items)) {
            return null;
        }

        const articles = (json.items || []).map((item: JsonFeedItem) => {
            const content = item.content_html || item.content_text || item.summary || '';
            const summary = item.summary || (item.content_text ? item.content_text.substring(0, 500) : undefined);

            // Extract image from attachments or banner_image
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

function parseRss2Feed(channel: Element): ParsedFeed {
    const title = textContent(channel.querySelector(':scope > title'));
    const description = textContent(channel.querySelector(':scope > description'));
    const siteUrl = textContent(channel.querySelector(':scope > link'));
    const imageUrl = textContent(channel.querySelector(':scope > image > url'));

    const items = Array.from(channel.querySelectorAll(':scope > item'));
    const articles = items.map(item => {
        const itemTitle = textContent(item.querySelector('title'));

        // Handle various link formats
        let link = textContent(item.querySelector('link'));
        if (!link) {
            // Try to get link from guid with isPermaLink="true"
            const guid = item.querySelector('guid');
            if (guid?.getAttribute('isPermaLink') === 'true') {
                link = textContent(guid);
            }
        }

        // content:encoded or description
        const contentEncoded = item.getElementsByTagNameNS('http://purl.org/rss/content/modules/1.0/', 'encoded')[0]
            ?? item.querySelector('content\\:encoded');
        let content = textContent(contentEncoded);

        // If no content:encoded, try description
        if (!content) {
            content = textContent(item.querySelector('description'));
        }

        const summary = textContent(item.querySelector('description'));

        // Try various author fields
        let author = textContent(item.querySelector('author'));
        if (!author) {
            author = textContent(item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'creator')[0]);
        }
        if (!author) {
            author = textContent(item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'author')[0]);
        }

        // Try various date fields
        let pubDate = textContent(item.querySelector('pubDate'));
        if (!pubDate) {
            pubDate = textContent(item.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'date')[0]);
        }

        // Try to extract image from various sources
        let articleImageUrl: string | undefined;

        // 1. enclosure with image type
        const enclosure = item.querySelector('enclosure[type^="image"]');
        if (enclosure) {
            articleImageUrl = attrContent(enclosure, 'url');
        }

        // 2. media:content
        if (!articleImageUrl) {
            const mediaContent = item.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'content')[0];
            if (mediaContent && attrContent(mediaContent, 'type')?.startsWith('image/')) {
                articleImageUrl = attrContent(mediaContent, 'url');
            }
        }

        // 3. media:thumbnail
        if (!articleImageUrl) {
            const mediaThumbnail = item.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'thumbnail')[0];
            if (mediaThumbnail) {
                articleImageUrl = attrContent(mediaThumbnail, 'url');
            }
        }

        // 4. itunes:image
        if (!articleImageUrl) {
            const itunesImage = item.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'image')[0];
            if (itunesImage) {
                articleImageUrl = attrContent(itunesImage, 'href');
            }
        }

        return {
            title: itemTitle || 'Untitled',
            url: link,
            content: content || summary || '',
            summary: summary !== content ? summary : undefined,
            author: author || undefined,
            imageUrl: articleImageUrl,
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

    // Atom can have multiple links, find the alternate or first without rel
    const links = Array.from(feed.querySelectorAll(':scope > link'));
    const siteLink = links.find(l => l.getAttribute('rel') === 'alternate')
        ?? links.find(l => !l.getAttribute('rel'))
        ?? links[0];
    const siteUrl = attrContent(siteLink, 'href');

    const iconUrl = textContent(feed.querySelector(':scope > icon'))
        || textContent(feed.querySelector(':scope > logo'));

    const entries = Array.from(feed.querySelectorAll(':scope > entry'));
    const articles = entries.map(entry => {
        const entryTitle = textContent(entry.querySelector('title'));

        // Find link in entry
        const entryLinks = Array.from(entry.querySelectorAll('link'));
        const entryLink = entryLinks.find(l => l.getAttribute('rel') === 'alternate')
            ?? entryLinks.find(l => !l.getAttribute('rel'))
            ?? entryLinks[0];
        const link = attrContent(entryLink, 'href');

        // Try to get content, preferring type="html" content
        const contentEl = entry.querySelector('content[type="html"]')
            ?? entry.querySelector('content');
        const summaryEl = entry.querySelector('summary');

        let content = textContent(contentEl);
        // If content type is html, it might be encoded
        const contentType = contentEl?.getAttribute('type');
        if (contentType === 'html' && content) {
            // Content is already HTML
            content = content;
        }

        const summary = textContent(summaryEl);

        // Try to get author
        let author = textContent(entry.querySelector('author > name'));
        if (!author) {
            // Try feed-level author
            author = textContent(feed.querySelector(':scope > author > name'));
        }

        // Try published first, then updated
        let published = textContent(entry.querySelector('published'));
        if (!published) {
            published = textContent(entry.querySelector('updated'));
        }

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
 * Fetch feed using Tauri's native HTTP (bypasses CORS)
 */
async function fetchWithTauri(url: string): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('fetch_rss_feed', { url });
}

/**
 * Detect CORS-related errors
 */
function isCorsError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
        message.includes('cors') ||
        message.includes('access control') ||
        message.includes('preflight') ||
        message.includes('cross-origin') ||
        message.includes('blocked by cors') ||
        // TypeError: Load failed is the generic Safari error for CORS/network failures
        (message.includes('load failed') && !message.includes('json')) ||
        message.includes('networkerror') ||
        message.includes('failed to fetch')
    );
}

/**
 * Check if URL is accessible (not behind CORS restrictions)
 */
function isLikelyCorsRestricted(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    // These services are known to have CORS issues
    const corsRestrictedServices = [
        'elsevier.com',
        'springer.com',
        'sciencedirect.com',
        'nature.com',
        'ieee.org',
        'acm.org',
        'jstor.org',
        'wiley.com',
        'tandfonline.com',
        'sagepub.com'
    ];
    return corsRestrictedServices.some(service => lowerUrl.includes(service));
}

/**
 * Fetch and parse an RSS or Atom feed from a URL.
 */
export async function fetchAndParseFeed(
    url: string,
): Promise<{ feed: Omit<ParsedFeed, 'articles'>; articles: ParsedFeed['articles'] }> {
    let xmlText: string;

    // Try Tauri native HTTP first (bypasses CORS)
    if (isTauri()) {
        try {
            xmlText = await fetchWithTauri(url);
        } catch (tauriError) {
            const errorMsg = tauriError instanceof Error ? tauriError.message : String(tauriError);
            throw new Error(`Failed to fetch feed: ${errorMsg}`);
        }
    } else {
        // Browser fetch (subject to CORS)
        // Check if this is likely a CORS-restricted academic publisher
        if (isLikelyCorsRestricted(url)) {
            throw new Error(
                `This URL appears to be from an academic publisher that blocks browser requests (CORS). ` +
                `Academic publishers typically require authentication and block direct feed access from web browsers. ` +
                `Try using a different feed source or accessing through the publisher's official RSS page.`
            );
        }

        let response: Response;

        try {
            // Keep this request "simple" to avoid triggering OPTIONS preflight on strict servers.
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
            // Handle specific HTTP error codes
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

    // Check if we got HTML back and try to find the actual feed URL
    if (isHtmlContent(xmlText)) {
        const feedUrl = extractFeedUrlFromHtml(xmlText);
        if (feedUrl) {
            // Resolve relative URLs
            const resolvedUrl = new URL(feedUrl, url).href;
            try {
                let newText: string;
                if (isTauri()) {
                    newText = await fetchWithTauri(resolvedUrl);
                } else {
                    const newResponse = await fetch(resolvedUrl, { method: 'GET' });
                    if (!newResponse.ok) {
                        throw new Error(`Failed to fetch resolved feed: ${newResponse.status}`);
                    }
                    newText = await newResponse.text();
                }
                const parsed = parseFeedXml(newText);
                const { articles, ...feedMeta } = parsed;
                return { feed: feedMeta, articles };
            } catch {
                // Fall through to try parsing original as HTML error
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
