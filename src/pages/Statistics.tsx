/**
 * Statistics Page
 * User statistics, reading progress, and achievements
 */

import { useMemo } from "react";
import { cn, normalizeAuthor } from "@/lib/utils";
import { useLibraryStore, useSettingsStore, useUIStore } from "@/store";
import { formatReadingTime } from "@/lib/utils";
import {
    BookOpen,
    Clock,
    Target,
    Flame,
    Trophy,

    TrendingUp,
    ChevronRight,
    Star,
    Bookmark,
    Highlighter,
} from "lucide-react";

// Stat card component
interface StatCardProps {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    subtext?: string;
    trend?: "up" | "down" | "neutral";
}

function StatCard({ icon, label, value, subtext }: StatCardProps) {
    return (
        <div className="ui-card p-5 hover:border-[var(--color-text-muted)] transition-colors">
            <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-lg bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]">
                    {icon}
                </div>
            </div>
            <div className="mt-4">
                <p className="text-2xl font-bold text-[color:var(--color-text-primary)]">{value}</p>
                <p className="text-sm text-[color:var(--color-text-muted)] mt-0.5">{label}</p>
                {subtext && (
                    <p className="text-xs text-[color:var(--color-text-secondary)] mt-2">{subtext}</p>
                )}
            </div>
        </div>
    );
}

// Progress bar component
function ProgressBar({
    current,
    target,
    label,
}: {
    current: number;
    target: number;
    label: string;
}) {
    const percentage = Math.min(100, (current / target) * 100);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
                <span className="text-[color:var(--color-text-secondary)]">{label}</span>
                <span className="text-[color:var(--color-text-primary)] font-medium">
                    {current} / {target}
                </span>
            </div>
            <div className="h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                <div
                    className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-500"
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}

// Recent book card
interface RecentBookCardProps {
    book: {
        id: string;
        title: string;
        author: string;
        coverPath?: string;
        progress: number;
        lastReadAt?: Date;
    };
    onClick: () => void;
}

function RecentBookCard({ book, onClick }: RecentBookCardProps) {
    return (
        <button
            onClick={onClick}
            className="flex items-center gap-4 p-3 ui-surface hover:border-[var(--color-text-muted)] transition-colors text-left w-full"
        >
            {book.coverPath ? (
                <img
                    src={book.coverPath}
                    alt={book.title}
                    className="w-12 h-16 object-cover rounded shadow-sm flex-shrink-0"
                />
            ) : (
                <div className="w-12 h-16 bg-[var(--color-surface-muted)] rounded flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                </div>
            )}
            <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm text-[color:var(--color-text-primary)] truncate">
                    {book.title}
                </h4>
                <p className="text-xs text-[color:var(--color-text-secondary)] truncate">{normalizeAuthor(book.author) || "Unknown Author"}</p>
                <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 h-1.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[var(--color-accent)] rounded-full"
                            style={{ width: `${book.progress * 100}%` }}
                        />
                    </div>
                    <span className="text-xs text-[color:var(--color-text-muted)]">
                        {Math.round(book.progress * 100)}%
                    </span>
                </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[color:var(--color-text-muted)] flex-shrink-0" />
        </button>
    );
}

// Activity heatmap with real data
function ActivityHeatmap({ dailyActivity }: { dailyActivity: import('@/types').DailyReadingActivity[] | undefined }) {
    // Generate last 12 weeks of data
    const weeks = useMemo(() => {
        const data: number[][] = [];
        const today = new Date();
        
        // Create a map of date to minutes read (handle undefined case)
        const activityMap = new Map<string, number>();
        (dailyActivity || []).forEach(activity => {
            activityMap.set(activity.date, activity.minutes);
        });
        
        // Generate 12 weeks (84 days) of data, ending with today
        for (let weekIndex = 0; weekIndex < 12; weekIndex++) {
            const week: number[] = [];
            for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
                const dayOffset = (11 - weekIndex) * 7 + (6 - dayIndex);
                const date = new Date(today);
                date.setDate(date.getDate() - dayOffset);
                const dateStr = date.toISOString().split('T')[0];
                
                const minutes = activityMap.get(dateStr) || 0;
                // Convert minutes to activity level 0-4
                let level = 0;
                if (minutes > 0) level = 1;
                if (minutes >= 15) level = 2;
                if (minutes >= 30) level = 3;
                if (minutes >= 60) level = 4;
                week.push(level);
            }
            data.push(week.reverse()); // Reverse to get Sunday to Saturday
        }
        return data;
    }, [dailyActivity]);

    const getColor = (level: number) => {
        switch (level) {
            case 0:
                return "bg-[var(--color-surface-muted)]";
            case 1:
                return "bg-[var(--color-accent)]/20";
            case 2:
                return "bg-[var(--color-accent)]/40";
            case 3:
                return "bg-[var(--color-accent)]/60";
            case 4:
                return "bg-[var(--color-accent)]";
            default:
                return "bg-[var(--color-surface-muted)]";
        }
    };

    // Calculate today's reading
    const todayStr = new Date().toISOString().split('T')[0];
    const todayMinutes = (dailyActivity || []).find(a => a.date === todayStr)?.minutes || 0;

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[color:var(--color-text-primary)]">Reading Activity</span>
                <span className="text-xs text-[color:var(--color-text-muted)]">Last 12 weeks</span>
            </div>
            <div className="flex gap-1">
                {weeks.map((week, weekIndex) => (
                    <div key={weekIndex} className="flex flex-col gap-1">
                        {week.map((day, dayIndex) => (
                            <div
                                key={dayIndex}
                                className={cn(
                                    "w-3 h-3 rounded-sm",
                                    getColor(day)
                                )}
                                title={`Activity level: ${day}`}
                            />
                        ))}
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-[color:var(--color-text-muted)]">
                <span>Less</span>
                {[0, 1, 2, 3, 4].map((level) => (
                    <div key={level} className={cn("w-3 h-3 rounded-sm", getColor(level))} />
                ))}
                <span>More</span>
            </div>
            {todayMinutes > 0 && (
                <p className="text-xs text-[color:var(--color-text-muted)]">
                    Today: {todayMinutes} minutes read
                </p>
            )}
        </div>
    );
}

// Main page component
export function StatisticsPage() {
    const { books, annotations } = useLibraryStore();
    const { stats } = useSettingsStore();
    const { setRoute } = useUIStore();

    // Calculate statistics
    const totalBooks = books.length;
    const completedBooks = books.filter((b) => b.progress >= 0.99).length;
    const inProgressBooks = books.filter((b) => b.progress > 0 && b.progress < 0.99).length;
    const totalHighlights = annotations.filter((a) => a.type === "highlight").length;
    const totalNotes = annotations.filter((a) => a.type === "note").length;
    const totalBookmarks = annotations.filter((a) => a.type === "bookmark").length;

    // Get recently read books
    const recentBooks = useMemo(() => {
        return [...books]
            .filter((b) => b.lastReadAt)
            .sort((a, b) => (b.lastReadAt?.getTime() || 0) - (a.lastReadAt?.getTime() || 0))
            .slice(0, 5);
    }, [books]);

    // Get favorite books
    const favoriteBooks = useMemo(() => {
        return books.filter((b) => b.isFavorite).slice(0, 5);
    }, [books]);

    const handleBookClick = (bookId: string) => {
        setRoute("reader", bookId);
    };

    return (
        <div className="ui-page animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-10">
                <div>
                    <h1 className="ui-page-title">
                        Statistics
                    </h1>
                    <p className="ui-page-subtitle">
                        Track your reading progress and achievements
                    </p>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                <StatCard
                    icon={<BookOpen className="w-5 h-5" />}
                    label="Total Books"
                    value={totalBooks}
                    subtext={`${completedBooks} completed, ${inProgressBooks} in progress`}
                />
                <StatCard
                    icon={<Clock className="w-5 h-5" />}
                    label="Reading Time"
                    value={formatReadingTime(stats.totalReadingTime)}
                    subtext="Total hours spent reading"
                />
                <StatCard
                    icon={<Target className="w-5 h-5" />}
                    label="Daily Goal"
                    value={`${stats.dailyGoal} min`}
                    subtext={`Yearly goal: ${stats.booksReadThisYear}/${stats.yearlyBookGoal} books`}
                />
                <StatCard
                    icon={<Flame className="w-5 h-5" />}
                    label="Current Streak"
                    value={`${stats.currentStreak} days`}
                    subtext={`Best: ${stats.longestStreak} days`}
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid lg:grid-cols-3 gap-8">
                {/* Left Column - Goals & Activity */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Reading Goals */}
                    <section className="ui-card p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 rounded-lg bg-[var(--color-surface-muted)]">
                                <Target className="w-5 h-5 text-[color:var(--color-text-primary)]" />
                            </div>
                            <h2 className="font-semibold text-[color:var(--color-text-primary)]">Reading Goals</h2>
                        </div>
                        <div className="space-y-6">
                            <ProgressBar
                                label="Yearly Book Goal"
                                current={stats.booksReadThisYear}
                                target={stats.yearlyBookGoal}
                            />
                            <ProgressBar
                                label="Books Completed"
                                current={completedBooks}
                                target={Math.max(completedBooks + 5, 10)}
                            />
                        </div>
                    </section>

                    {/* Activity Heatmap */}
                    <section className="ui-card p-6">
                        <ActivityHeatmap dailyActivity={stats.dailyActivity} />
                    </section>

                    {/* Recently Read */}
                    {recentBooks.length > 0 && (
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="font-semibold text-[color:var(--color-text-primary)]">Recently Read</h2>
                                <button
                                    onClick={() => setRoute("library")}
                                    className="text-sm text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent)] transition-colors flex items-center gap-1"
                                >
                                    View All
                                    <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="space-y-3">
                                {recentBooks.map((book) => (
                                    <RecentBookCard
                                        key={book.id}
                                        book={book}
                                        onClick={() => handleBookClick(book.id)}
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </div>

                {/* Right Column - Annotations & Favorites */}
                <div className="space-y-8">
                    {/* Annotations Summary */}
                    <section className="ui-card p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 rounded-lg bg-[var(--color-surface-muted)]">
                                <Highlighter className="w-5 h-5 text-[color:var(--color-text-primary)]" />
                            </div>
                            <h2 className="font-semibold text-[color:var(--color-text-primary)]">Annotations</h2>
                        </div>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 bg-[var(--color-surface-muted)] rounded-lg">
                                <div className="flex items-center gap-2">
                                    <Highlighter className="w-4 h-4 text-[color:var(--color-text-muted)]" />
                                    <span className="text-sm text-[color:var(--color-text-primary)]">Highlights</span>
                                </div>
                                <span className="font-medium text-[color:var(--color-text-primary)]">{totalHighlights}</span>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-[var(--color-surface-muted)] rounded-lg">
                                <div className="flex items-center gap-2">
                                    <BookOpen className="w-4 h-4 text-[color:var(--color-text-muted)]" />
                                    <span className="text-sm text-[color:var(--color-text-primary)]">Notes</span>
                                </div>
                                <span className="font-medium text-[color:var(--color-text-primary)]">{totalNotes}</span>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-[var(--color-surface-muted)] rounded-lg">
                                <div className="flex items-center gap-2">
                                    <Bookmark className="w-4 h-4 text-[color:var(--color-text-muted)]" />
                                    <span className="text-sm text-[color:var(--color-text-primary)]">Bookmarks</span>
                                </div>
                                <span className="font-medium text-[color:var(--color-text-primary)]">{totalBookmarks}</span>
                            </div>
                        </div>
                    </section>

                    {/* Favorites */}
                    {favoriteBooks.length > 0 && (
                        <section className="ui-card p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 rounded-lg bg-[var(--color-surface-muted)]">
                                    <Star className="w-5 h-5 text-[color:var(--color-text-primary)]" />
                                </div>
                                <h2 className="font-semibold text-[color:var(--color-text-primary)]">Favorites</h2>
                            </div>
                            <div className="space-y-3">
                                {favoriteBooks.map((book) => (
                                    <button
                                        key={book.id}
                                        onClick={() => handleBookClick(book.id)}
                                        className="flex items-center gap-3 w-full text-left group"
                                    >
                                        {book.coverPath ? (
                                            <img
                                                src={book.coverPath}
                                                alt={book.title}
                                                className="w-10 h-14 object-cover rounded shadow-sm flex-shrink-0"
                                            />
                                        ) : (
                                            <div className="w-10 h-14 bg-[var(--color-surface-muted)] rounded flex items-center justify-center flex-shrink-0">
                                                <BookOpen className="w-4 h-4 text-[color:var(--color-text-muted)]" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-sm font-medium text-[color:var(--color-text-primary)] truncate group-hover:text-[color:var(--color-accent)] transition-colors">
                                                {book.title}
                                            </h4>
                                            <p className="text-xs text-[color:var(--color-text-secondary)] truncate">
                                                {normalizeAuthor(book.author) || "Unknown Author"}
                                            </p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Achievements */}
                    <section className="ui-card p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 rounded-lg bg-[var(--color-surface-muted)]">
                                <Trophy className="w-5 h-5 text-[color:var(--color-text-primary)]" />
                            </div>
                            <h2 className="font-semibold text-[color:var(--color-text-primary)]">Achievements</h2>
                        </div>
                        <div className="space-y-3">
                            {completedBooks >= 1 && (
                                <div className="flex items-center gap-3 p-3 bg-[var(--color-accent-light)] rounded-lg">
                                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                                        <BookOpen className="w-4 h-4 text-[color:var(--color-text-inverse)]" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-[color:var(--color-text-primary)]">First Book</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">Completed your first book</p>
                                    </div>
                                </div>
                            )}
                            {completedBooks >= 5 && (
                                <div className="flex items-center gap-3 p-3 bg-[var(--color-accent-light)] rounded-lg">
                                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                                        <TrendingUp className="w-4 h-4 text-[color:var(--color-text-inverse)]" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-[color:var(--color-text-primary)]">Bookworm</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">Completed 5 books</p>
                                    </div>
                                </div>
                            )}
                            {stats.currentStreak >= 7 && (
                                <div className="flex items-center gap-3 p-3 bg-[var(--color-accent-light)] rounded-lg">
                                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                                        <Flame className="w-4 h-4 text-[color:var(--color-text-inverse)]" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-[color:var(--color-text-primary)]">On Fire</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">7 day reading streak</p>
                                    </div>
                                </div>
                            )}
                            {totalHighlights >= 10 && (
                                <div className="flex items-center gap-3 p-3 bg-[var(--color-accent-light)] rounded-lg">
                                    <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center">
                                        <Highlighter className="w-4 h-4 text-[color:var(--color-text-inverse)]" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-[color:var(--color-text-primary)]">Highlighter</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">Created 10 highlights</p>
                                    </div>
                                </div>
                            )}
                            {completedBooks < 1 && totalHighlights < 10 && stats.currentStreak < 7 && (
                                <p className="text-sm text-[color:var(--color-text-muted)] text-center py-4">
                                    Keep reading to unlock achievements!
                                </p>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

