import { useState, useEffect, useRef } from "react";
import { Play, Pause, X, Maximize2, Minimize2 } from "lucide-react";

interface SpeedReaderProps {
    isOpen: boolean;
    text: string;
    onClose: () => void;
    onAutoNext?: () => void;
    theme?: "light" | "sepia" | "dark";
}

const THEME_COLORS = {
    light: { bg: "var(--reader-bg, #ffffff)", fg: "var(--reader-fg, #1a1a1a)", accent: "var(--app-accent, var(--color-accent, #2d6a6e))" },
    sepia: { bg: "var(--reader-bg-override, #f4ecd8)", fg: "var(--reader-fg-override, #3d3025)", accent: "var(--reader-link-override, #3d3025)" },
    dark: { bg: "var(--reader-bg, #000000)", fg: "var(--reader-fg, #ffffff)", accent: "var(--reader-link, #fbbf24)" },
};

export function SpeedReader({ isOpen, text, onClose, onAutoNext, theme = "dark" }: SpeedReaderProps) {
    const [wpm, setWpm] = useState(400);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const wordsRef = useRef<string[]>([]);
    const timerRef = useRef<number | null>(null);
    const autoPlayRef = useRef(false);

    const colors = THEME_COLORS[theme] || THEME_COLORS.dark;

    useEffect(() => {
        if (!text) { wordsRef.current = []; return; }
        const normalized = text.replace(/\s+/g, " ").trim();
        const tokens = normalized.split(" ").filter(Boolean);
        const avgLen = tokens.reduce((s, t) => s + t.length, 0) / Math.max(1, tokens.length);
        wordsRef.current = (avgLen < 2 ? [normalized.replace(/\s+/g, "")] : tokens).filter((w) => w.length > 0);
        setCurrentIndex(0);
        if (autoPlayRef.current) { autoPlayRef.current = false; setIsPlaying(true); }
        else { setIsPlaying(false); }
    }, [text]);

    useEffect(() => {
        if (!isPlaying || !isOpen) {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
            return;
        }
        const delay = (60 * 1000) / wpm;
        timerRef.current = window.setInterval(() => {
            setCurrentIndex((prev) => {
                if (prev >= wordsRef.current.length - 1) {
                    setIsPlaying(false);
                    if (onAutoNext) autoPlayRef.current = true;
                    setTimeout(() => onAutoNext?.(), 400);
                    return prev;
                }
                return prev + 1;
            });
        }, delay);
        return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
    }, [isPlaying, wpm, isOpen, onAutoNext]);

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            switch (e.key) {
                case " ": e.preventDefault(); setIsPlaying((p) => !p); break;
                case "ArrowRight": e.preventDefault(); setCurrentIndex((i) => Math.min(i + 10, wordsRef.current.length - 1)); break;
                case "ArrowLeft": e.preventDefault(); setCurrentIndex((i) => Math.max(i - 10, 0)); break;
                case "ArrowUp": e.preventDefault(); setWpm((w) => Math.min(w + 50, 2000)); break;
                case "ArrowDown": e.preventDefault(); setWpm((w) => Math.max(w - 50, 50)); break;
                case "Escape":
                    if (isFullscreen) document.exitFullscreen?.();
                    else { setIsPlaying(false); onClose(); }
                    break;
                case "f": case "F":
                    isFullscreen ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
                    break;
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [isOpen, isFullscreen, onClose]);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", handler);
        return () => document.removeEventListener("fullscreenchange", handler);
    }, []);

    const progress = wordsRef.current.length > 0 ? (currentIndex / wordsRef.current.length) * 100 : 0;
    const currentWord = wordsRef.current[currentIndex] || "";
    const wordCount = wordsRef.current.length;

    if (!isOpen) return null;

    return (
        <div style={{ background: colors.bg, color: colors.fg }}
            className="fixed inset-0 z-[200] flex flex-col select-none">
            <div className="flex items-center justify-between shrink-0 h-11 px-5"
                style={{ borderBottom: `1px solid ${colors.fg}15` }}>
                <button onClick={() => { setIsPlaying(false); onClose(); }}
                    className="flex items-center gap-1.5 text-xs font-medium"
                    style={{ color: colors.fg, opacity: 0.45 }}>
                    <X className="w-4 h-4" /> Close
                </button>
                <div className="flex items-center gap-3">
                    <span style={{ color: colors.fg, opacity: 0.25, fontSize: 11 }}>
                        {currentIndex + 1}/{wordCount}
                    </span>
                    <div className="w-24 h-0.5 rounded-full overflow-hidden" style={{ background: `${colors.fg}12` }}>
                        <div className="h-full rounded-full" style={{ width: `${progress}%`, background: colors.accent }} />
                    </div>
                </div>
                <button onClick={() => setIsFullscreen(!isFullscreen)}
                    className="p-1" style={{ color: colors.fg, opacity: 0.45 }}
                    aria-label="Fullscreen">
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
            </div>

            <div className="flex-1 flex items-center justify-center px-6 py-8 overflow-hidden">
                <div className="flex flex-col items-center justify-center w-full max-w-5xl mx-auto">
                    <div
                        key={currentIndex}
                        className="text-center w-full px-4 leading-tight font-medium tracking-tight"
                        style={{
                            color: colors.fg,
                            fontSize: "clamp(1.75rem, 5.5vw, 4.5rem)",
                            lineHeight: 1.15,
                            letterSpacing: "-0.02em",
                            wordBreak: "break-word",
                        }}>
                        {currentWord || "—"}
                    </div>
                    <div style={{ color: colors.fg, opacity: 0.08, fontSize: 10, marginTop: 20, letterSpacing: "0.25em", textTransform: "uppercase" }}>
                        {isPlaying ? "Reading" : "Paused"}
                    </div>
                </div>
            </div>

            <div className="shrink-0 px-6 pb-6 space-y-4">
                <div className="flex items-center justify-center gap-5">
                    <button onClick={() => setWpm((w) => Math.max(50, w - 25))}
                        className="flex items-center justify-center h-9 w-9 text-sm font-medium border"
                        style={{ borderColor: `${colors.fg}20`, color: colors.fg, opacity: 0.4 }}>
                        −
                    </button>

                    <div className="flex items-center gap-1.5 min-w-[3rem] justify-center">
                        <span style={{ color: colors.fg, fontSize: 14, fontWeight: 500 }}>{wpm}</span>
                        <span style={{ color: colors.fg, opacity: 0.3, fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em" }}>wpm</span>
                    </div>

                    <button onClick={() => setWpm((w) => Math.min(2000, w + 25))}
                        className="flex items-center justify-center h-9 w-9 text-sm font-medium border"
                        style={{ borderColor: `${colors.fg}20`, color: colors.fg, opacity: 0.4 }}>
                        +
                    </button>

                    <button onClick={() => setIsPlaying(!isPlaying)}
                        className="flex items-center justify-center h-10 w-10 rounded-full transition-transform active:scale-95 shadow-sm"
                        style={{ background: colors.accent, color: colors.bg }}
                        aria-label={isPlaying ? "Pause" : "Play"}>
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>

                    <div style={{ width: 64, color: colors.fg, opacity: 0.25 }}>
                        <input type="range" min={50} max={2000} step={10} value={wpm}
                            onChange={(e) => setWpm(Number(e.target.value))}
                            className="w-full h-0.5" style={{ accentColor: colors.accent }}
                            aria-label="Speed" />
                    </div>
                </div>

                <div className="flex items-center justify-center gap-3"
                    style={{ color: colors.fg, opacity: 0.1, fontSize: 9, letterSpacing: "0.06em" }}>
                    <span>Space</span><span>·</span><span>↑↓</span><span>·</span><span>←→</span><span>·</span><span>F</span>
                </div>
            </div>
        </div>
    );
}
