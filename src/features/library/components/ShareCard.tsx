import type { Annotation, Book, HighlightColor } from "../../../core";
import { cn } from "../../../core";
import { getResolvedColor } from "./share-card-colors";

interface ShareCardProps {
    annotation: Annotation;
    book: Pick<Book, "title" | "author"> | undefined;
    className?: string;
}

function resolveAccentColor(color: HighlightColor | undefined): string {
    if (!color) return getResolvedColor("--color-text-muted");
    const colorMap: Record<HighlightColor, string> = {
        yellow: getResolvedColor("--highlight-yellow"),
        green: getResolvedColor("--highlight-green"),
        blue: getResolvedColor("--highlight-blue"),
        red: getResolvedColor("--highlight-red"),
        orange: getResolvedColor("--highlight-orange"),
        purple: getResolvedColor("--highlight-purple"),
    };
    return colorMap[color] || getResolvedColor("--color-text-muted");
}

function truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars - 1) + "…";
}

export function ShareCard({ annotation, book, className }: ShareCardProps) {
    const accentColor = resolveAccentColor(annotation.color);
    const displayText = truncateText(annotation.selectedText || "", 500);
    const displayNote = annotation.noteContent
        ? truncateText(annotation.noteContent, 300)
        : null;

    return (
        <div
            className={cn("w-[1080px] h-[1080px] flex overflow-hidden", className)}
            style={{
                width: "1080px",
                height: "1080px",
                display: "flex",
                overflow: "hidden",
                backgroundColor: getResolvedColor("--color-surface"),
                fontFamily: "Georgia, 'Times New Roman', serif",
            }}
        >
            <div
                className="w-[24px] shrink-0"
                style={{ 
                    width: "24px", 
                    flexShrink: 0, 
                    backgroundColor: accentColor 
                }}
            />
            <div 
                className="flex flex-col flex-1 px-16 py-16 justify-between"
                style={{ 
                    display: "flex", 
                    flexDirection: "column", 
                    flex: "1 1 0%", 
                    padding: "64px", 
                    justifyContent: "space-between" 
                }}
            >
                <div 
                    className="flex-1 flex flex-col justify-center min-h-0"
                    style={{ 
                        flex: "1 1 0%", 
                        display: "flex", 
                        flexDirection: "column", 
                        justifyContent: "center", 
                        minHeight: 0 
                    }}
                >
                    <svg
                        className="w-16 h-16 mb-8 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={accentColor}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ 
                            width: "64px", 
                            height: "64px", 
                            marginBottom: "32px", 
                            flexShrink: 0, 
                            opacity: 0.25 
                        }}
                    >
                        <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
                        <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
                    </svg>
                    <div 
                        className="flex-1 overflow-hidden"
                        style={{ flex: "1 1 0%", overflow: "hidden" }}
                    >
                        {displayText && (
                            <p
                                className="text-[32px] leading-[1.5]"
                                style={{
                                    fontSize: "32px",
                                    lineHeight: "1.5",
                                    color: getResolvedColor("--color-text-primary"),
                                    fontFamily: "Georgia, 'Times New Roman', serif",
                                    margin: 0,
                                }}
                            >
                                {displayText}
                            </p>
                        )}
                        {displayNote && (
                            <div
                                className="mt-8 pt-6"
                                style={{
                                    marginTop: "32px",
                                    paddingTop: "24px",
                                    borderTop: `1px solid ${getResolvedColor("--color-border")}`,
                                }}
                            >
                                <p
                                    className="text-[20px] leading-[1.6] italic"
                                    style={{
                                        fontSize: "20px",
                                        lineHeight: "1.6",
                                        fontStyle: "italic",
                                        color: getResolvedColor("--color-text-secondary"),
                                        fontFamily: "Georgia, 'Times New Roman', serif",
                                        margin: 0,
                                    }}
                                >
                                    {displayNote}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
                <div 
                    className="flex items-end justify-between shrink-0 mt-10"
                    style={{ 
                        display: "flex", 
                        alignItems: "flex-end", 
                        justifyContent: "space-between", 
                        flexShrink: 0, 
                        marginTop: "40px" 
                    }}
                >
                    <div 
                        className="min-w-0 mr-6"
                        style={{ minWidth: 0, marginRight: "24px" }}
                    >
                        <h2
                            className="text-[24px] font-bold leading-tight"
                            style={{
                                fontSize: "24px",
                                fontWeight: "bold",
                                lineHeight: "1.25",
                                color: getResolvedColor("--color-text-primary"),
                                fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                                margin: 0,
                            }}
                        >
                            {book?.title || "Unknown Source"}
                        </h2>
                        {book?.author && (
                            <p
                                className="text-[18px] mt-1.5"
                                style={{
                                    fontSize: "18px",
                                    marginTop: "6px",
                                    color: getResolvedColor("--color-text-secondary"),
                                    fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                                    margin: 0,
                                }}
                            >
                                {book.author}
                            </p>
                        )}
                    </div>
                    <div
                        className="flex items-center gap-2.5 shrink-0"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            flexShrink: 0,
                            color: getResolvedColor("--color-text-muted"),
                            fontFamily: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
                        }}
                    >
                        <svg
                            className="w-6 h-6 text-current"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            style={{ width: "24px", height: "24px" }}
                        >
                            <rect x="1" y="1" width="22" height="22" fill="currentColor" />
                            <rect x="5" y="5" width="14" height="14" fill={getResolvedColor("--color-surface")} />
                            <rect x="8" y="8" width="8" height="8" fill="currentColor" />
                        </svg>
                        <span 
                            className="text-[17px] font-medium"
                            style={{ fontSize: "17px", fontWeight: 500 }}
                        >Shared via Theorem</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
