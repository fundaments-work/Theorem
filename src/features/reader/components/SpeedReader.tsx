import { useState, useEffect, useRef } from "react";
import { Play, Pause, X, Maximize2, Minimize2 } from "lucide-react";

interface SpeedReaderProps {
    isOpen: boolean;
    text: string;
    onClose: () => void;
    onAutoNext?: () => void;
    theme?: "light" | "sepia" | "dark";
}

export function SpeedReader({ isOpen, text, onClose, onAutoNext }: SpeedReaderProps) {
    const [wpm, setWpm] = useState(400);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const wordsRef = useRef<string[]>([]);
    const timerRef = useRef<number | null>(null);
    const autoPlayRef = useRef(false);

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
        <div className="fixed inset-0 z-[200] flex flex-col select-none bg-[var(--color-background)] text-[var(--color-text-primary)] pt-[max(env(safe-area-inset-top,0px),0.5rem)] pb-[max(env(safe-area-inset-bottom,0px),1rem)]">
            <div className="flex items-center justify-between shrink-0 min-h-11 px-5 border-b border-[var(--color-border)]">
                <button onClick={() => { setIsPlaying(false); onClose(); }}
                    className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors min-h-[44px]">
                    <X className="w-4 h-4" /> Close
                </button>
                <div className="flex items-center gap-3">
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                        {currentIndex + 1}/{wordCount}
                    </span>
                    <div className="w-24 h-0.5 overflow-hidden bg-[var(--color-border)]">
                        <div className="h-full bg-[var(--color-accent)]" style={{ width: `${progress}%` }} />
                    </div>
                </div>
                <button onClick={() => setIsFullscreen(!isFullscreen)}
                    className="flex items-center justify-center min-h-[44px] min-w-[44px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
                    aria-label="Fullscreen">
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
            </div>

            <div className="flex-1 flex items-center justify-center px-6 py-8 overflow-hidden">
                <div className="flex flex-col items-center justify-center w-full max-w-5xl mx-auto">
                    <div
                        key={currentIndex}
                        className="text-center w-full px-4 leading-tight font-medium tracking-tight text-[var(--color-text-primary)]"
                        style={{
                            fontSize: "clamp(1.75rem, 5.5vw, 4.5rem)",
                            lineHeight: 1.15,
                            letterSpacing: "-0.02em",
                            wordBreak: "break-word",
                        }}>
                        {currentWord || "—"}
                    </div>
                    <div className="mt-5 text-[10px] tracking-[0.25em] uppercase text-[var(--color-text-muted)]">
                        {isPlaying ? "Reading" : "Paused"}
                    </div>
                </div>
            </div>

            <div className="shrink-0 px-4 sm:px-6 pb-4 sm:pb-6 space-y-4">
                <div className="flex items-center justify-center gap-3 sm:gap-5 flex-wrap">
                    <button onClick={() => setWpm((w) => Math.max(50, w - 25))}
                        className="flex items-center justify-center min-h-[44px] min-w-[44px] text-sm font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors">
                        −
                    </button>

                    <div className="flex items-center gap-1.5 min-w-[3rem] justify-center">
                        <span className="text-sm font-medium text-[var(--color-text-primary)]">{wpm}</span>
                        <span className="text-[9px] tracking-[0.05em] uppercase text-[var(--color-text-muted)]">wpm</span>
                    </div>

                    <button onClick={() => setWpm((w) => Math.min(2000, w + 25))}
                        className="flex items-center justify-center min-h-[44px] min-w-[44px] text-sm font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors">
                        +
                    </button>

                    <button onClick={() => setIsPlaying(!isPlaying)}
                        className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full transition-transform active:scale-95 bg-[var(--color-accent)] text-[var(--color-accent-contrast)] cursor-pointer"
                        aria-label={isPlaying ? "Pause" : "Play"}>
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>

                    <div className="w-28 sm:w-36 text-[var(--color-text-muted)]">
                        <input type="range" min={50} max={2000} step={10} value={wpm}
                            onChange={(e) => setWpm(Number(e.target.value))}
                            className="w-full cursor-pointer"
                            aria-label="Speed" />
                    </div>
                </div>

                <div className="flex items-center justify-center gap-3 text-[10px] tracking-[0.08em] text-[var(--color-text-muted)]">
                    <span>Space</span><span>·</span><span>↑↓</span><span>·</span><span>←→</span><span>·</span><span>F</span>
                </div>
            </div>
        </div>
    );
}
