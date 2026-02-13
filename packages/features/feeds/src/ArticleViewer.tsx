/**
 * ArticleViewer Component
 * Side-panel HTML article viewer with full reader controls
 * Inspired by Notion's side-peek design
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { cn, useSettingsStore, type RssArticle } from "@theorem/core";
import { 
    X, 
    Maximize2, 
    Minimize2, 
    Type, 
    Sun, 
    Moon,
    AlignLeft,
    ExternalLink,
    Share2,
    Bookmark,
    Check
} from "lucide-react";

interface ArticleViewerProps {
    article: RssArticle | null;
    feedTitle?: string;
    isOpen: boolean;
    onClose: () => void;
    onToggleFavorite?: () => void;
}

// Font size options
const FONT_SIZES = [
    { label: "Small", value: 14 },
    { label: "Normal", value: 16 },
    { label: "Large", value: 18 },
    { label: "X-Large", value: 20 },
];

// Line height options
const LINE_HEIGHTS = [
    { label: "Compact", value: 1.4 },
    { label: "Normal", value: 1.6 },
    { label: "Relaxed", value: 1.8 },
    { label: "Loose", value: 2.0 },
];

// Theme options
const THEMES = [
    { label: "Light", value: "light", icon: Sun },
    { label: "Sepia", value: "sepia", icon: Sun },
    { label: "Dark", value: "dark", icon: Moon },
];

function closestOptionValue<T extends { value: number }>(options: T[], value: number): number {
    return options.reduce((closest, current) => {
        return Math.abs(current.value - value) < Math.abs(closest - value) ? current.value : closest;
    }, options[0]?.value ?? value);
}

export function ArticleViewer({ 
    article, 
    feedTitle,
    isOpen, 
    onClose,
    onToggleFavorite,
}: ArticleViewerProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [fontSize, setFontSize] = useState(16);
    const [lineHeight, setLineHeight] = useState(1.6);
    const [theme, setTheme] = useState<"light" | "sepia" | "dark">("light");
    const contentRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Get global reader settings for defaults
    const globalSettings = useSettingsStore((s) => s.settings.readerSettings);
    
    // Initialize from global settings
    useEffect(() => {
        // Keep feed viewer typography in a readable range even when book reader settings are extreme.
        setFontSize(closestOptionValue(FONT_SIZES, globalSettings.fontSize));
        setLineHeight(closestOptionValue(LINE_HEIGHTS, globalSettings.lineHeight));
        setTheme(globalSettings.theme);
    }, [globalSettings]);

    // Reset expanded state when closing
    useEffect(() => {
        if (!isOpen) {
            setIsExpanded(false);
            setShowSettings(false);
        }
    }, [isOpen]);

    // Handle escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleEscape);
        return () => window.removeEventListener("keydown", handleEscape);
    }, [isOpen, onClose]);

    // Handle click outside to close (only when not expanded)
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (!isExpanded && e.target === e.currentTarget) {
            onClose();
        }
    }, [isExpanded, onClose]);

    // Format date
    const formatDate = (date: Date | string | undefined) => {
        if (!date) return "";
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return "";
        return d.toLocaleDateString("en-US", { 
            year: "numeric", 
            month: "long", 
            day: "numeric" 
        });
    };

    // Get theme colors
    const getThemeColors = () => {
        switch (theme) {
            case "dark":
                return {
                    bg: "#0b0b0b",
                    text: "#f5f5f5",
                    muted: "#c2c2c2",
                    link: "#ffffff",
                    border: "#424242",
                    surface: "#121212",
                };
            case "sepia":
                return {
                    bg: "#f2f2f2",
                    text: "#141414",
                    muted: "#535353",
                    link: "#111111",
                    border: "#c8c8c8",
                    surface: "#f8f8f8",
                };
            default:
                return {
                    bg: "#ffffff",
                    text: "#111111",
                    muted: "#4a4a4a",
                    link: "#111111",
                    border: "#cfcfcf",
                    surface: "#ffffff",
                };
        }
    };

    const colors = getThemeColors();

    if (!article) return null;

    return (
        <div
            ref={containerRef}
            onClick={handleBackdropClick}
            className={cn(
                "fixed inset-0 z-[var(--z-modal)] transition-opacity duration-300",
                isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}
            style={{
                backgroundColor: isExpanded ? colors.bg : "rgba(0, 0, 0, 0.5)",
            }}
        >
            {/* Article Panel */}
            <div
                className={cn(
                    "h-full transition-all duration-300 ease-out",
                    "flex flex-col shadow-2xl",
                    isExpanded 
                        ? "w-full" 
                        : "w-full md:w-[600px] lg:w-[700px] xl:w-[800px] ml-auto"
                )}
                style={{
                    backgroundColor: colors.bg,
                    color: colors.text,
                }}
            >
                {/* Toolbar */}
                <div
                    className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
                    style={{ borderColor: colors.border }}
                >
                    {/* Left: Close button */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onClose}
                            className="p-2 rounded-lg transition-colors hover:opacity-70"
                            style={{ color: colors.muted }}
                            title="Close (Esc)"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        
                        {!isExpanded && (
                            <span 
                                className="text-xs hidden md:block"
                                style={{ color: colors.muted }}
                            >
                                Press Esc to close
                            </span>
                        )}
                    </div>

                    {/* Center: Article info */}
                    <div className="flex-1 mx-4 text-center min-w-0">
                        <h2 
                            className="text-sm font-medium truncate"
                            style={{ color: colors.text }}
                        >
                            {article.title}
                        </h2>
                        {feedTitle && (
                            <p 
                                className="text-xs truncate"
                                style={{ color: colors.muted }}
                            >
                                {feedTitle}
                            </p>
                        )}
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-1">
                        {/* Expand/Collapse */}
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="p-2 rounded-lg transition-colors hover:opacity-70"
                            style={{ color: colors.muted }}
                            title={isExpanded ? "Exit full screen" : "Full screen"}
                        >
                            {isExpanded ? (
                                <Minimize2 className="w-5 h-5" />
                            ) : (
                                <Maximize2 className="w-5 h-5" />
                            )}
                        </button>

                        {/* Settings toggle */}
                        <button
                            onClick={() => setShowSettings(!showSettings)}
                            className={cn(
                                "p-2 rounded-lg transition-colors",
                                showSettings && "opacity-100"
                            )}
                            style={{ 
                                color: showSettings ? colors.text : colors.muted,
                                backgroundColor: showSettings ? colors.surface : "transparent",
                            }}
                            title="Reading settings"
                        >
                            <Type className="w-5 h-5" />
                        </button>

                        {/* Favorite */}
                        {onToggleFavorite && (
                            <button
                                onClick={onToggleFavorite}
                                className="p-2 rounded-lg transition-colors hover:opacity-70"
                                style={{ color: article.isFavorite ? "var(--color-accent)" : colors.muted }}
                                title={article.isFavorite ? "Remove from favorites" : "Add to favorites"}
                            >
                                {article.isFavorite ? (
                                    <Bookmark className="w-5 h-5 fill-current" />
                                ) : (
                                    <Bookmark className="w-5 h-5" />
                                )}
                            </button>
                        )}

                        {/* Original link */}
                        {article.url && (
                            <a
                                href={article.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 rounded-lg transition-colors hover:opacity-70"
                                style={{ color: colors.muted }}
                                title="Open original article"
                            >
                                <ExternalLink className="w-5 h-5" />
                            </a>
                        )}
                    </div>
                </div>

                {/* Settings Panel */}
                {showSettings && (
                    <div
                        className="px-4 py-4 border-b flex flex-wrap gap-6"
                        style={{ 
                            borderColor: colors.border,
                            backgroundColor: colors.surface,
                        }}
                    >
                        {/* Font Size */}
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-medium" style={{ color: colors.muted }}>
                                Font Size
                            </span>
                            <div className="flex gap-1">
                                {FONT_SIZES.map((size) => (
                                    <button
                                        key={size.value}
                                        onClick={() => setFontSize(size.value)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                                            fontSize === size.value && "ring-1"
                                        )}
                                        style={{
                                            color: fontSize === size.value ? colors.text : colors.muted,
                                            backgroundColor: fontSize === size.value ? colors.bg : "transparent",
                                            border: `1px solid ${fontSize === size.value ? colors.border : "transparent"}`,
                                        }}
                                    >
                                        {size.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Line Height */}
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-medium" style={{ color: colors.muted }}>
                                Line Height
                            </span>
                            <div className="flex gap-1">
                                {LINE_HEIGHTS.map((lh) => (
                                    <button
                                        key={lh.value}
                                        onClick={() => setLineHeight(lh.value)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                                            lineHeight === lh.value && "ring-1"
                                        )}
                                        style={{
                                            color: lineHeight === lh.value ? colors.text : colors.muted,
                                            backgroundColor: lineHeight === lh.value ? colors.bg : "transparent",
                                            border: `1px solid ${lineHeight === lh.value ? colors.border : "transparent"}`,
                                        }}
                                    >
                                        {lh.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Theme */}
                        <div className="flex flex-col gap-2">
                            <span className="text-xs font-medium" style={{ color: colors.muted }}>
                                Theme
                            </span>
                            <div className="flex gap-1">
                                {THEMES.map((t) => (
                                    <button
                                        key={t.value}
                                        onClick={() => setTheme(t.value as any)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                                            theme === t.value && "ring-1"
                                        )}
                                        style={{
                                            color: theme === t.value ? colors.text : colors.muted,
                                            backgroundColor: theme === t.value ? colors.bg : "transparent",
                                            border: `1px solid ${theme === t.value ? colors.border : "transparent"}`,
                                        }}
                                    >
                                        <t.icon className="w-3.5 h-3.5" />
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Article Content */}
                <div 
                    ref={contentRef}
                    className="flex-1 overflow-y-auto px-6 py-8 md:px-12 md:py-12"
                >
                    <article className="w-full max-w-2xl mx-auto">
                        {/* Header */}
                        <header className="mb-8">
                            <h1 
                                className="text-2xl md:text-3xl font-bold mb-4 leading-tight"
                                style={{ 
                                    color: colors.text,
                                    fontSize: `${fontSize * 1.5}px`,
                                    lineHeight: lineHeight * 0.9,
                                }}
                            >
                                {article.title}
                            </h1>
                            
                            <div 
                                className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
                                style={{ color: colors.muted }}
                            >
                                {article.author && (
                                    <span>By {article.author}</span>
                                )}
                                {article.publishedAt && (
                                    <span>{formatDate(article.publishedAt)}</span>
                                )}
                                {feedTitle && (
                                    <span>in {feedTitle}</span>
                                )}
                            </div>
                        </header>

                        {/* Main Image */}
                        {article.imageUrl && (
                            <img
                                src={article.imageUrl}
                                alt=""
                                className="w-full h-auto rounded-lg mb-8"
                                style={{ maxHeight: "400px", objectFit: "cover" }}
                            />
                        )}

                        {/* Content */}
                        <div
                            className="article-content prose prose-lg max-w-none"
                            style={{
                                fontSize: `${fontSize}px`,
                                lineHeight: lineHeight,
                                color: colors.text,
                            }}
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(article.content) }}
                        />

                        {/* Footer */}
                        <footer className="mt-12 pt-8 border-t" style={{ borderColor: colors.border }}>
                            <div className="flex items-center justify-between">
                                <span style={{ color: colors.muted }} className="text-sm">
                                    {article.url && (
                                        <a 
                                            href={article.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="hover:underline flex items-center gap-2"
                                            style={{ color: colors.link }}
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                            Read original article
                                        </a>
                                    )}
                                </span>
                                
                                {onToggleFavorite && (
                                    <button
                                        onClick={onToggleFavorite}
                                        className="flex items-center gap-2 text-sm transition-colors hover:opacity-70"
                                        style={{ color: article.isFavorite ? "var(--color-accent)" : colors.muted }}
                                    >
                                        {article.isFavorite ? (
                                            <>
                                                <Check className="w-4 h-4" />
                                                Saved
                                            </>
                                        ) : (
                                            <>
                                                <Bookmark className="w-4 h-4" />
                                                Save for later
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        </footer>
                    </article>
                </div>
            </div>
        </div>
    );
}

/**
 * Basic HTML sanitization to prevent XSS
 */
function sanitizeHtml(html: string): string {
    if (!html) return "";
    
    // Create a temporary div to parse and clean HTML
    const temp = document.createElement("div");
    temp.innerHTML = html;
    
    // Remove potentially dangerous elements and attributes
    const dangerous = temp.querySelectorAll("script, style, iframe, object, embed, form");
    dangerous.forEach((el) => el.remove());
    
    // Clean attributes on all elements
    const allElements = temp.querySelectorAll("*");
    allElements.forEach((el) => {
        // Remove event handlers and dangerous attributes
        const attributes = Array.from(el.attributes);
        attributes.forEach((attr) => {
            const name = attr.name.toLowerCase();
            if (
                name.startsWith("on") || // Event handlers
                name === "href" && attr.value.toLowerCase().startsWith("javascript:") ||
                name === "src" && attr.value.toLowerCase().startsWith("javascript:")
            ) {
                el.removeAttribute(attr.name);
            }
        });
    });
    
    // Make all links open in new tab
    const links = temp.querySelectorAll("a");
    links.forEach((link) => {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
    });
    
    // Make images lazy loaded
    const images = temp.querySelectorAll("img");
    images.forEach((img) => {
        img.setAttribute("loading", "lazy");
    });
    
    return temp.innerHTML;
}
