import { useMemo } from "react";
import type { Annotation, HighlightColor } from "../../core/types";
import { HIGHLIGHT_SOLID_COLORS } from "../../core/lib/design-tokens";

export interface BookInfo {
    title: string;
    author: string;
}

export interface StatsData {
    totalBooks: number;
    completedBooks: number;
    totalReadingTime: number;
    currentStreak: number;
    longestStreak: number;
    booksReadThisYear: number;
    yearlyBookGoal: number;
    totalHighlights: number;
    recentlyReading?: {
        title: string;
        author: string;
        progress: number;
    };
}

export type CardFormat = "square" | "story";
export type CardTheme = "match" | "dark" | "tinted" | "sepia";

interface ShareCardProps {
    kind: "annotation" | "stats";
    annotation?: Annotation;
    book?: BookInfo;
    statsData?: StatsData;
    format: CardFormat;
    theme: CardTheme;
    showNote: boolean;
}

const CARD_WIDTH_PX = 1080;
const CARD_HEIGHTS = { square: 1080, story: 1920 };

function formatTime(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function getThemeStyles(theme: CardTheme, accent?: HighlightColor) {
    const tintBg = accent ? HIGHLIGHT_SOLID_COLORS[accent] : "#2d6a6e";
    switch (theme) {
        case "dark":
            return { bg: "#141416", fg: "#e8e6e1", accent: "#6bcdd1" };
        case "tinted":
            return { bg: tintBg, fg: "#ffffff", accent: "#ffffff" };
        case "sepia":
            return { bg: "#f4ecd8", fg: "#3d3025", accent: "#3d3025" };
        default:
            return { bg: "var(--color-background, #faf9f7)", fg: "var(--color-text-primary, #1c1c1c)", accent: "var(--color-accent, #2d6a6e)" };
    }
}

export function ShareCard({ kind, annotation, book, statsData, format, theme, showNote }: ShareCardProps) {
    const height = CARD_HEIGHTS[format];
    const isStory = format === "story";
    const colors = useMemo(() => getThemeStyles(theme, annotation?.color), [theme, annotation?.color]);

    const text = annotation?.selectedText || "";
    const charCount = text.length;

    const quoteFontSize = useMemo(() => {
        if (!text) return 40;
        const isStory = format === "story";
        const maxWidth = 1080 - 128;
        const avgCharWidth = 0.6;
        const charsPerLine = Math.floor(maxWidth / (avgCharWidth * 40));
        const noteLines = (showNote && annotation?.noteContent) ? 4 : 0;
        const availableLines = isStory ? 22 - noteLines : 11 - noteLines;
        const maxChars = charsPerLine * availableLines;
        const minSize = 24;
        const maxSize = isStory ? 48 : 44;

        if (charCount <= 0) return maxSize;
        const ratio = Math.min(1, maxChars / Math.max(1, charCount));
        const size = minSize + (maxSize - minSize) * Math.pow(ratio, 0.7);
        return Math.round(Math.max(minSize, Math.min(maxSize, size)));
    }, [text, format, showNote, annotation?.noteContent]);

    const formattedDate = annotation?.createdAt
        ? new Date(annotation.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : null;

    const cardContent = kind === "annotation" && annotation ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "EB Garamond, Georgia, serif", padding: "56px 64px" }}>
            <div style={{ color: colors.accent, fontSize: 36, lineHeight: 1, marginBottom: 24, userSelect: "none" }}>
                &#10033;
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
                {annotation.selectedText && (
                    <div style={{
                        fontSize: quoteFontSize,
                        lineHeight: 1.45,
                        color: colors.fg,
                        textAlign: "justify",
                        textJustify: "inter-word",
                        hyphens: "auto",
                    }}>
                        {annotation.selectedText}
                    </div>
                )}
                {showNote && annotation.noteContent && (
                    <div style={{
                        marginTop: annotation.selectedText ? 28 : 0,
                        paddingTop: annotation.selectedText ? 24 : 0,
                        borderTop: `1px solid ${colors.fg}20`,
                        fontSize: 17,
                        lineHeight: 1.55,
                        color: colors.fg,
                        opacity: 0.7,
                        fontFamily: "system-ui, -apple-system, sans-serif",
                    }}>
                        {annotation.noteContent}
                    </div>
                )}
            </div>
            <div style={{
                marginTop: 32,
                paddingTop: 20,
                borderTop: `1px solid ${colors.fg}20`,
                fontFamily: "system-ui, -apple-system, sans-serif",
            }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: colors.fg, lineHeight: 1.4 }}>
                    {book?.title || "Untitled"}
                </div>
                {formattedDate && (
                    <div style={{ fontSize: 12, color: colors.fg, opacity: 0.55, marginTop: 4, lineHeight: 1.4 }}>
                        {formattedDate}
                    </div>
                )}
            </div>
        </div>
    ) : statsData ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "system-ui, -apple-system, sans-serif", padding: isStory ? "40px 48px" : "48px 56px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: colors.accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>
                    {statsData.completedBooks || "–"}
                </div>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: colors.fg, opacity: 0.45, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        My Reading
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: colors.fg, marginTop: 1 }}>
                        {statsData.totalReadingTime > 0 ? `${formatTime(statsData.totalReadingTime)} total` : "Just getting started"}
                    </div>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: isStory ? 12 : 16, marginBottom: isStory ? 24 : 32 }}>
                {[
                    { label: "Books read", value: String(statsData.completedBooks) },
                    { label: "Day streak", value: `${statsData.currentStreak}` },
                    { label: "This year", value: `${statsData.booksReadThisYear}/${statsData.yearlyBookGoal}` },
                    { label: "Highlights", value: String(statsData.totalHighlights) },
                ].map((stat) => (
                    <div key={stat.label} style={{
                        background: `${colors.accent}0D`,
                        borderRadius: 8,
                        padding: isStory ? "14px 16px" : "18px 20px",
                        display: "flex",
                        flexDirection: "column",
                    }}>
                        <div style={{ fontSize: isStory ? 24 : 28, fontWeight: 600, color: colors.fg, letterSpacing: "-0.02em", lineHeight: 1.1 }}>{stat.value}</div>
                        <div style={{ fontSize: 11, color: colors.fg, opacity: 0.5, marginTop: 4 }}>{stat.label}</div>
                    </div>
                ))}
            </div>

            {statsData.yearlyBookGoal > 0 && (
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: colors.fg, opacity: 0.5, marginBottom: 6 }}>
                        <span>Yearly goal</span>
                        <span>{statsData.booksReadThisYear} / {statsData.yearlyBookGoal}</span>
                    </div>
                    <div style={{ height: 4, background: `${colors.fg}15`, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(100, (statsData.booksReadThisYear / Math.max(1, statsData.yearlyBookGoal)) * 100)}%`, background: colors.accent, borderRadius: 2 }} />
                    </div>
                </div>
            )}

            {statsData.recentlyReading && (
                <div style={{ marginTop: isStory ? 16 : 24, paddingTop: isStory ? 20 : 24, borderTop: `1px solid ${colors.fg}12` }}>
                    <div style={{ fontSize: 10, color: colors.fg, opacity: 0.4, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                        Currently reading
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: colors.fg }}>{statsData.recentlyReading.title}</div>
                </div>
            )}
        </div>
    ) : null;

    return (
        <div style={{ width: CARD_WIDTH_PX, height, background: colors.bg, overflow: "hidden", position: "relative" }}>
            {cardContent}
        </div>
    );
}
