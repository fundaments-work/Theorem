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
const CARD_RATIOS = { square: 1, story: 16 / 9 };

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
            return { bg: "#141416", surface: "#1c1c20", fg: "#e8e6e1", muted: "#7a7a7a", border: "#2c2c30", accent: "#6bcdd1" };
        case "tinted":
            return { bg: tintBg, surface: tintBg, fg: "#ffffff", muted: "rgba(255,255,255,0.65)", border: "rgba(255,255,255,0.15)", accent: "#ffffff" };
        case "sepia":
            return { bg: "#f4ecd8", surface: "#f4ecd8", fg: "#3d3025", muted: "#8b7d6b", border: "#d1c4a9", accent: "#3d3025" };
        default:
            return { bg: "#faf9f7", surface: "#ffffff", fg: "#1c1c1c", muted: "#9c9c9c", border: "#e2e1dd", accent: "var(--color-accent, #2d6a6e)" };
    }
}

export function ShareCard({ kind, annotation, book, statsData, format, theme, showNote }: ShareCardProps) {
    const height = CARD_WIDTH_PX / CARD_RATIOS[format];
    const colors = useMemo(() => getThemeStyles(theme, annotation?.color), [theme, annotation?.color]);

    const cardContent = kind === "annotation" && annotation ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "EB Garamond, Georgia, serif" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "60px 64px" }}>
                {annotation.selectedText && (
                    <blockquote style={{
                        fontSize: format === "story" ? 40 : 42,
                        lineHeight: 1.4,
                        color: colors.fg,
                        margin: 0,
                        padding: 0,
                        borderLeft: `4px solid ${annotation.color ? HIGHLIGHT_SOLID_COLORS[annotation.color] : colors.accent}`,
                        paddingLeft: 28,
                        fontStyle: "italic",
                        letterSpacing: "-0.01em",
                    }}>
                        {annotation.selectedText}
                    </blockquote>
                )}
                {showNote && annotation.noteContent && (
                    <>
                        {annotation.selectedText && <div style={{ height: 1, background: colors.border, margin: "32px 0" }} />}
                        <p style={{
                            fontSize: 22,
                            lineHeight: 1.5,
                            color: colors.muted,
                            margin: 0,
                            fontStyle: "normal",
                            fontFamily: "system-ui, -apple-system, sans-serif",
                        }}>
                            {annotation.noteContent}
                        </p>
                    </>
                )}
            </div>
            <div style={{
                padding: "32px 64px",
                borderTop: `1px solid ${colors.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
            }}>
                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.fg, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "system-ui, -apple-system, sans-serif" }}>
                        {book?.title || "Untitled"}
                    </div>
                    {book?.author && (
                        <div style={{ fontSize: 13, color: colors.muted, marginTop: 4, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                            {book.author}
                        </div>
                    )}
                </div>
                <div style={{ fontSize: 11, color: colors.muted, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                    Shared via Theorem
                </div>
            </div>
        </div>
    ) : statsData ? (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "system-ui, -apple-system, sans-serif" }}>
            <div style={{ padding: "48px 56px 0", textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>
                    Theorem Statistics
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, color: colors.fg, letterSpacing: "-0.02em" }}>
                    My Reading Journey
                </div>
            </div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, padding: "32px 48px" }}>
                {[
                    { label: "Reading Time", value: formatTime(statsData.totalReadingTime) },
                    { label: "Books Completed", value: String(statsData.completedBooks) },
                    { label: "Current Streak", value: `${statsData.currentStreak}d` },
                    { label: "Highlights", value: String(statsData.totalHighlights) },
                ].map((stat) => (
                    <div key={stat.label} style={{
                        background: colors.surface === colors.bg ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.06)",
                        borderRadius: 8,
                        padding: 24,
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        border: `1px solid ${colors.border}`,
                    }}>
                        <div style={{ fontSize: 36, fontWeight: 700, color: colors.accent, marginBottom: 6 }}>{stat.value}</div>
                        <div style={{ fontSize: 12, color: colors.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{stat.label}</div>
                    </div>
                ))}
            </div>
            <div style={{ padding: "0 48px 32px" }}>
                <div style={{ height: 6, background: colors.border, borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                        height: "100%",
                        width: `${Math.min(100, (statsData.booksReadThisYear / Math.max(1, statsData.yearlyBookGoal)) * 100)}%`,
                        background: colors.accent,
                        borderRadius: 3,
                    }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: colors.muted }}>
                    <span>{statsData.booksReadThisYear} / {statsData.yearlyBookGoal} books this year</span>
                    <span>Shared via Theorem</span>
                </div>
            </div>
        </div>
    ) : null;

    return (
        <div style={{ width: CARD_WIDTH_PX, height, background: colors.bg, overflow: "hidden", position: "relative" }}>
            {cardContent}
        </div>
    );
}
