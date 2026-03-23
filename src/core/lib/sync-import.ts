/**
 * Theorem – Sync Import / Merge Module
 *
 * Provides per-domain merge functions that implement a last-write-wins (LWW)
 * strategy for importing data received from a paired peer device during
 * LAN sync.
 *
 * Every merge function is pure (no side-effects) and returns the merged array
 * so the caller can persist the result into the relevant Zustand store.
 */

import type {
    Book,
    Annotation,
    Collection,
    DeletionTombstone,
    TombstoneEntity,
    VocabularyTerm,
    RssFeed,
    RssArticle,
    AppSettings,
    ReadingStats,
    DailyReadingActivity,
} from "../types";

// ─── Helpers ───

/** Default tombstone retention period: 90 days in milliseconds. */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** Build a Set of entity IDs from tombstones filtered by entity type. */
function tombstoneIdSet(
    tombstones: DeletionTombstone[],
    entityType: TombstoneEntity,
): Set<string> {
    const ids = new Set<string>();
    for (const t of tombstones) {
        if (t.entityType === entityType) ids.add(t.entityId);
    }
    return ids;
}

/** Parse a date value (Date | string | undefined) into epoch-ms; 0 if invalid. */
function toEpoch(d: Date | string | undefined | null): number {
    if (!d) return 0;
    const ms =
        typeof d === "string" ? new Date(d).getTime() : d.getTime();
    return Number.isNaN(ms) ? 0 : ms;
}

// ─── Deletion Tombstones ───

/**
 * Merge incoming tombstones with local tombstones.
 *
 * Deduplicates by (entityId, entityType) keeping the earliest `deletedAt` to
 * maximise the suppression window.  Also garbage-collects tombstones older
 * than `TOMBSTONE_TTL_MS` (default 90 days) to prevent unbounded growth.
 */
export function mergeTombstones(
    incoming: DeletionTombstone[],
    existing: DeletionTombstone[],
): DeletionTombstone[] {
    const key = (t: DeletionTombstone) => `${t.entityType}::${t.entityId}`;
    const byKey = new Map<string, DeletionTombstone>();

    for (const t of existing) {
        byKey.set(key(t), t);
    }

    for (const t of incoming) {
        const k = key(t);
        const prev = byKey.get(k);
        if (!prev || toEpoch(t.deletedAt) < toEpoch(prev.deletedAt)) {
            byKey.set(k, t);
        }
    }

    // Garbage-collect expired tombstones.
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    const result: DeletionTombstone[] = [];
    for (const t of byKey.values()) {
        if (toEpoch(t.deletedAt) >= cutoff) {
            result.push(t);
        }
    }

    return result;
}

// ─── Books ───

/**
 * Merge incoming books with existing books.
 *
 * - Deduplicate by `contentHash` where available, otherwise by `id`.
 * - For duplicates keep the richer metadata set and latest reading progress.
 * - Books whose ID appears in `tombstones` (with entityType "book") are
 *   excluded from the result — they were intentionally deleted locally or
 *   on a peer and should not be resurrected.
 */
export function mergeBooks(
    incoming: Book[],
    existing: Book[],
    tombstones: DeletionTombstone[] = [],
): Book[] {
    const deletedBookIds = tombstoneIdSet(tombstones, "book");
    // Build lookup maps — skip locally-tombstoned books so they stay deleted.
    const byId = new Map<string, Book>();
    const byHash = new Map<string, Book>();

    for (const book of existing) {
        if (deletedBookIds.has(book.id)) continue;
        byId.set(book.id, book);
        if (book.contentHash) byHash.set(book.contentHash, book);
    }

    for (const inc of incoming) {
        // Skip incoming books that have been tombstoned (deleted on either device).
        if (deletedBookIds.has(inc.id)) continue;

        // Try to match by contentHash first (same file on both devices).
        const match =
            (inc.contentHash ? byHash.get(inc.contentHash) : undefined) ??
            byId.get(inc.id);

        if (!match) {
            // New book from remote — flag it as having no local file.
            const localPlaceholderPath = `sqlite://${inc.id}`;
            // Preserve cover data URL from the peer so it displays immediately
            // without waiting for file transfer + re-extraction.
            const incomingCover = (typeof inc.coverPath === "string" && inc.coverPath.startsWith("data:"))
                ? inc.coverPath
                : undefined;
            const remoteBook: Book = {
                ...inc,
                filePath: localPlaceholderPath,
                storagePath: localPlaceholderPath,
                coverPath: incomingCover,
                coverExtractionDone: Boolean(incomingCover),
                syncedWithoutFile: true,
            };
            byId.set(inc.id, remoteBook);
            if (inc.contentHash) byHash.set(inc.contentHash, remoteBook);
            continue;
        }

        // Merge: keep the existing id, merge metadata.
        // Start with all local fields via spread (preserves fields not explicitly
        // handled below, such as publishedDate, pageProgress, pdfViewState,
        // locations, category, manualCompletionState, progressBeforeFinish,
        // completedAt, lastClickFraction, contentHash, etc.).
        // Then selectively override with richer/newer remote values.
        const merged: Book = {
            ...match,
            // Prefer richer title/author.
            title:
                (inc.title && inc.title.length > (match.title?.length ?? 0))
                    ? inc.title
                    : match.title,
            author:
                (inc.author && inc.author.length > (match.author?.length ?? 0))
                    ? inc.author
                    : match.author,
            description: match.description || inc.description,
            publisher: match.publisher || inc.publisher,
            language: match.language || inc.language,
            isbn: match.isbn || inc.isbn,
            publishedDate: match.publishedDate || inc.publishedDate,
            category: match.category || inc.category,
            // Keep higher progress.
            progress: Math.max(match.progress ?? 0, inc.progress ?? 0),
            // Keep later reading time.
            lastReadAt:
                toEpoch(inc.lastReadAt) > toEpoch(match.lastReadAt)
                    ? inc.lastReadAt
                    : match.lastReadAt,
            currentLocation:
                toEpoch(inc.lastReadAt) > toEpoch(match.lastReadAt)
                    ? inc.currentLocation ?? match.currentLocation
                    : match.currentLocation,
            // Reading time: take max (idempotent, monotonic counter — see TS IMP 7).
            readingTime: Math.max(match.readingTime ?? 0, inc.readingTime ?? 0),
            // Keep favorite if either flagged.
            isFavorite: match.isFavorite || inc.isFavorite,
            // Merge tags.
            tags: [...new Set([...(match.tags ?? []), ...(inc.tags ?? [])])],
            // Keep higher rating.
            rating:
                (match.rating ?? 0) >= (inc.rating ?? 0)
                    ? match.rating
                    : inc.rating,
            // Preserve local paths — never overwrite with remote paths.
            // If an old synced record is missing filePath/storagePath, repair it
            // with a local sqlite placeholder path so downstream consumers that
            // call `startsWith` do not crash.
            filePath: match.filePath || match.storagePath || `sqlite://${match.id}`,
            storagePath: match.storagePath || match.filePath || `sqlite://${match.id}`,
            coverPath: match.coverPath || (
                typeof inc.coverPath === "string" && inc.coverPath.startsWith("data:")
                    ? inc.coverPath
                    : match.coverPath
            ),
            // Fill in contentHash if local is missing.
            contentHash: match.contentHash || inc.contentHash,
            // If local has a file, keep current sync flag.
            syncedWithoutFile: match.syncedWithoutFile,
            // Completion state: adopt remote if local has no completion.
            completedAt: match.completedAt || inc.completedAt,
            manualCompletionState: match.manualCompletionState ?? inc.manualCompletionState,
            progressBeforeFinish: match.progressBeforeFinish ?? inc.progressBeforeFinish,
        };

        byId.set(match.id, merged);
    }

    return [...byId.values()];
}

// ─── Annotations ───

/**
 * Merge annotations using LWW by `updatedAt` (or `createdAt` as fallback)
 * per annotation ID.
 *
 * Annotations whose ID (or whose parent bookId) appears in `tombstones` are
 * excluded — they were part of a book or annotation deletion.
 */
export function mergeAnnotations(
    incoming: Annotation[],
    existing: Annotation[],
    tombstones: DeletionTombstone[] = [],
): Annotation[] {
    const deletedAnnotationIds = tombstoneIdSet(tombstones, "annotation");
    const deletedBookIds = tombstoneIdSet(tombstones, "book");

    const byId = new Map<string, Annotation>();

    for (const ann of existing) {
        if (deletedAnnotationIds.has(ann.id)) continue;
        if (deletedBookIds.has(ann.bookId)) continue;
        byId.set(ann.id, ann);
    }

    for (const inc of incoming) {
        if (deletedAnnotationIds.has(inc.id)) continue;
        if (deletedBookIds.has(inc.bookId)) continue;

        const match = byId.get(inc.id);
        if (!match) {
            // New annotation.
            byId.set(inc.id, inc);
            continue;
        }

        // LWW: keep the one with the latest updatedAt (falling back to createdAt).
        const localTs = toEpoch(match.updatedAt) || toEpoch(match.createdAt);
        const remoteTs = toEpoch(inc.updatedAt) || toEpoch(inc.createdAt);

        if (remoteTs > localTs) {
            byId.set(inc.id, inc);
        }
    }

    return [...byId.values()];
}

// ─── Collections ───

/**
 * Merge collections by ID.
 * - Same ID → union of bookIds, keep later name/description.
 * - Different IDs → add as new.
 * - Collections whose ID appears in `tombstones` are excluded.
 * - Book IDs that have been tombstoned are stripped from the merged bookIds
 *   so deleted books don't linger as dangling references in collections.
 */
export function mergeCollections(
    incoming: Collection[],
    existing: Collection[],
    tombstones: DeletionTombstone[] = [],
): Collection[] {
    const deletedCollectionIds = tombstoneIdSet(tombstones, "collection");
    const deletedBookIds = tombstoneIdSet(tombstones, "book");

    const byId = new Map<string, Collection>();

    for (const col of existing) {
        if (deletedCollectionIds.has(col.id)) continue;
        byId.set(col.id, col);
    }

    for (const inc of incoming) {
        if (deletedCollectionIds.has(inc.id)) continue;

        const match = byId.get(inc.id);
        if (!match) {
            byId.set(inc.id, inc);
            continue;
        }

        // Merge: union of bookIds, keep later name/description.
        // Prefer updatedAt for LWW timestamp; fall back to createdAt.
        const incTs = toEpoch(inc.updatedAt) || toEpoch(inc.createdAt);
        const matchTs = toEpoch(match.updatedAt) || toEpoch(match.createdAt);
        const merged: Collection = {
            ...match,
            name: incTs > matchTs ? inc.name : match.name,
            description:
                incTs > matchTs
                    ? inc.description ?? match.description
                    : match.description ?? inc.description,
            // bookIds: grow-only set union, then strip tombstoned book IDs.
            bookIds: [...new Set([...match.bookIds, ...inc.bookIds])].filter(
                (id) => !deletedBookIds.has(id),
            ),
            // Keep the latest updatedAt from either side.
            updatedAt:
                incTs > matchTs ? inc.updatedAt ?? inc.createdAt : match.updatedAt ?? match.createdAt,
        };

        byId.set(match.id, merged);
    }

    // Also strip tombstoned book IDs from collections that weren't touched
    // by the incoming set (i.e. local-only collections).
    if (deletedBookIds.size > 0) {
        for (const [id, col] of byId) {
            const filtered = col.bookIds.filter((bId) => !deletedBookIds.has(bId));
            if (filtered.length !== col.bookIds.length) {
                byId.set(id, { ...col, bookIds: filtered });
            }
        }
    }

    return [...byId.values()];
}

// ─── Vocabulary ───

/**
 * Merge vocabulary terms by normalized term + language key.
 * - Same key → merge meanings, contexts; keep higher lookupCount.
 * - Different keys → add as new.
 */
export function mergeVocabulary(
    incoming: VocabularyTerm[],
    existing: VocabularyTerm[],
): VocabularyTerm[] {
    const byKey = new Map<string, VocabularyTerm>();

    const key = (t: VocabularyTerm) => `${t.normalizedTerm}::${t.language}`;

    for (const term of existing) {
        byKey.set(key(term), term);
    }

    for (const inc of incoming) {
        const k = key(inc);
        const match = byKey.get(k);
        if (!match) {
            byKey.set(k, inc);
            continue;
        }

        // Merge.
        const merged: VocabularyTerm = {
            ...match,
            // Keep higher lookup count.
            lookupCount: Math.max(match.lookupCount, inc.lookupCount),
            // Keep later personal note.
            personalNote:
                toEpoch(inc.updatedAt) > toEpoch(match.updatedAt)
                    ? inc.personalNote ?? match.personalNote
                    : match.personalNote ?? inc.personalNote,
            // Union tags.
            tags: [...new Set([...(match.tags ?? []), ...(inc.tags ?? [])])],
            // Union contexts by key.
            contexts: mergeContexts(match.contexts ?? [], inc.contexts ?? []),
            // Union meanings by provider.
            meanings: mergeMeanings(match.meanings, inc.meanings),
            // Union provider history.
            providerHistory: [
                ...new Set([
                    ...(match.providerHistory ?? []),
                    ...(inc.providerHistory ?? []),
                ]),
            ],
            // Keep later updatedAt.
            updatedAt:
                toEpoch(inc.updatedAt) > toEpoch(match.updatedAt)
                    ? inc.updatedAt
                    : match.updatedAt,
        };

        byKey.set(k, merged);
    }

    return [...byKey.values()];
}

function mergeContexts(
    a: VocabularyTerm["contexts"],
    b: VocabularyTerm["contexts"],
): VocabularyTerm["contexts"] {
    const byKey = new Map<string, VocabularyTerm["contexts"][0]>();
    for (const ctx of a) byKey.set(ctx.key, ctx);
    for (const ctx of b) {
        if (!byKey.has(ctx.key)) {
            byKey.set(ctx.key, ctx);
        } else {
            const existing = byKey.get(ctx.key)!;
            byKey.set(ctx.key, {
                ...existing,
                occurrences: Math.max(existing.occurrences, ctx.occurrences),
                lastSeenAt:
                    toEpoch(ctx.lastSeenAt) > toEpoch(existing.lastSeenAt)
                        ? ctx.lastSeenAt
                        : existing.lastSeenAt,
            });
        }
    }
    return [...byKey.values()];
}

function mergeMeanings(
    a: VocabularyTerm["meanings"],
    b: VocabularyTerm["meanings"],
): VocabularyTerm["meanings"] {
    const byProvider = new Map<string, VocabularyTerm["meanings"][0]>();
    for (const m of a) byProvider.set(m.provider, m);
    for (const m of b) {
        if (!byProvider.has(m.provider)) {
            byProvider.set(m.provider, m);
        }
        // Same provider → keep existing (no way to determine "newer")
    }
    return [...byProvider.values()];
}

// ─── RSS ───

/**
 * Merge RSS feeds by URL.
 *
 * Uses the canonical `RssFeed` type directly to avoid type mismatch issues.
 *
 * Returns the merged feed list and a feedIdMap (remote ID → local ID) for any
 * feeds that were deduplicated by URL but had different IDs. Callers should pass
 * this map to `mergeRssArticles` so that incoming articles referencing the
 * remote feed ID are remapped to the surviving local feed ID.
 */
export function mergeRssFeeds(
    incoming: RssFeed[],
    existing: RssFeed[],
): { feeds: RssFeed[]; feedIdMap: Map<string, string> } {
    const byUrl = new Map<string, RssFeed>();
    const feedIdMap = new Map<string, string>();

    for (const feed of existing) {
        byUrl.set(feed.url, feed);
    }

    for (const inc of incoming) {
        const match = byUrl.get(inc.url);
        if (!match) {
            byUrl.set(inc.url, inc);
            continue;
        }

        // Same feed URL but different IDs — record the remap so articles
        // referencing the incoming ID can be redirected to the local ID.
        if (inc.id !== match.id) {
            feedIdMap.set(inc.id, match.id);
        }

        // Keep later lastFetched, merge metadata.
        const merged: RssFeed = {
            ...match,
            title: inc.title || match.title,
            description: inc.description || match.description,
            iconUrl: inc.iconUrl || match.iconUrl,
            lastFetched:
                toEpoch(inc.lastFetched) > toEpoch(match.lastFetched)
                    ? inc.lastFetched
                    : match.lastFetched,
        };
        byUrl.set(inc.url, merged);
    }

    return { feeds: [...byUrl.values()], feedIdMap };
}

/**
 * Merge RSS articles by ID.
 * - OR read/favorite states (if either marked, it stays marked).
 * - Optionally remaps incoming feedId references using the feedIdMap from
 *   `mergeRssFeeds`, so articles from deduplicated feeds point to the correct ID.
 */
export function mergeRssArticles(
    incoming: RssArticle[],
    existing: RssArticle[],
    feedIdMap?: Map<string, string>,
): RssArticle[] {
    const byId = new Map<string, RssArticle>();

    for (const article of existing) {
        byId.set(article.id, article);
    }

    for (const inc of incoming) {
        // Remap feedId if this article references a remote feed that was
        // deduplicated into a local feed with a different ID.
        const remappedFeedId = feedIdMap?.get(inc.feedId) ?? inc.feedId;
        const remapped = remappedFeedId !== inc.feedId ? { ...inc, feedId: remappedFeedId } : inc;

        const match = byId.get(remapped.id);
        if (!match) {
            byId.set(remapped.id, remapped);
            continue;
        }

        // Merge: OR read/favorite states.
        const merged: RssArticle = {
            ...match,
            isRead: match.isRead || remapped.isRead,
            isFavorite: match.isFavorite || remapped.isFavorite,
            // If the existing article still had the old feedId, update it
            feedId: remappedFeedId,
        };
        byId.set(remapped.id, merged);
    }

    return [...byId.values()];
}

// ─── Settings ───

/**
 * Merge incoming app settings with local settings.
 *
 * Strategy:
 * - Device-specific settings (`deviceSync`) are NEVER overwritten by the peer.
 * - Reader preferences, vocabulary settings, vault settings, and library view
 *   prefs are synced using a whole-object LWW based on an explicit
 *   `settingsUpdatedAt` timestamp passed alongside the settings object.
 * - If no timestamp is available, prefer local settings (conservative).
 */
export function mergeSettings(
    incoming: AppSettings,
    existing: AppSettings,
    incomingUpdatedAt?: string,
    localUpdatedAt?: string,
): AppSettings {
    const remoteTs = toEpoch(incomingUpdatedAt);
    const localTs = toEpoch(localUpdatedAt);

    // If remote is strictly newer, take remote settings (except device-specific).
    // If equal or local is newer, keep local.
    if (remoteTs > localTs) {
        return {
            ...incoming,
            // Always preserve local device sync settings — they're device-specific.
            deviceSync: existing.deviceSync,
        };
    }

    return {
        ...existing,
        // If both have same timestamp or local is newer, keep local.
        // But still merge in any vault/vocabulary fields that are empty locally
        // but populated remotely (fill gaps, don't overwrite).
        vault: {
            ...incoming.vault,
            ...existing.vault,
            // Keep local paths always.
            vaultPath: existing.vault.vaultPath,
        },
    };
}

// ─── Reading Stats ───

/**
 * Merge reading statistics from two devices.
 *
 * Strategy:
 * - Cumulative counters (`totalReadingTime`, `booksCompleted`): take max.
 * - Streaks: take max for longest, recalculate current from merged daily data.
 * - Daily activity: union by date, max minutes, union book IDs.
 * - Goals: take the higher value (user-set targets).
 * - `booksReadThisYear`: take max.
 */
export function mergeReadingStats(
    incoming: ReadingStats,
    existing: ReadingStats,
): ReadingStats {
    // Merge daily activity by date key.
    const activityByDate = new Map<string, DailyReadingActivity>();
    for (const entry of existing.dailyActivity ?? []) {
        activityByDate.set(entry.date, entry);
    }
    for (const inc of incoming.dailyActivity ?? []) {
        const match = activityByDate.get(inc.date);
        if (!match) {
            activityByDate.set(inc.date, inc);
        } else {
            activityByDate.set(inc.date, {
                date: inc.date,
                minutes: Math.max(match.minutes, inc.minutes),
                booksRead: [...new Set([...match.booksRead, ...inc.booksRead])],
            });
        }
    }

    // Sort by date descending, keep last 84 days (12 weeks for heatmap).
    const mergedActivity = [...activityByDate.values()]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 84);

    // Recalculate current streak from merged daily activity.
    const currentStreak = calculateCurrentStreak(mergedActivity);

    // Determine the latest read date.
    const lastReadDate = [existing.lastReadDate, incoming.lastReadDate]
        .filter(Boolean)
        .sort()
        .pop();

    return {
        // Cumulative counters: take max (idempotent — both devices independently
        // increment, so max gives the best approximation without double-counting).
        totalReadingTime: Math.max(existing.totalReadingTime, incoming.totalReadingTime),
        booksCompleted: Math.max(existing.booksCompleted, incoming.booksCompleted),
        averageReadingSpeed: Math.max(existing.averageReadingSpeed, incoming.averageReadingSpeed),
        currentStreak,
        longestStreak: Math.max(existing.longestStreak, incoming.longestStreak, currentStreak),
        dailyGoal: Math.max(existing.dailyGoal, incoming.dailyGoal),
        yearlyBookGoal: Math.max(existing.yearlyBookGoal, incoming.yearlyBookGoal),
        booksReadThisYear: Math.max(existing.booksReadThisYear, incoming.booksReadThisYear),
        dailyActivity: mergedActivity,
        lastReadDate,
    };
}

/**
 * Calculate current reading streak from daily activity data.
 * Counts consecutive days backwards from the most recent activity day.
 */
function calculateCurrentStreak(
    sortedActivity: DailyReadingActivity[],
): number {
    if (sortedActivity.length === 0) return 0;

    // Local date formatter — avoids UTC conversion that toISOString() does,
    // which can shift the date by ±1 day near midnight in non-UTC timezones.
    const pad = (n: number) => String(n).padStart(2, "0");
    const toLocalDateStr = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    // sortedActivity is sorted date descending.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = toLocalDateStr(today);
    const yesterdayDate = new Date(today);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = toLocalDateStr(yesterdayDate);

    // The streak only counts if the most recent activity is today or yesterday.
    const mostRecent = sortedActivity[0].date;
    if (mostRecent !== todayStr && mostRecent !== yesterdayStr) {
        return 0;
    }

    // Build a set of active dates for fast lookup.
    const activeDates = new Set(sortedActivity.map((a) => a.date));

    let streak = 0;
    const cursor = new Date(mostRecent + "T00:00:00");
    while (true) {
        const dateStr = toLocalDateStr(cursor);
        if (!activeDates.has(dateStr)) break;
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }

    return streak;
}
