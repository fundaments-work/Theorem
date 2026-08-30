import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Play, Pause, X, Maximize2, Minimize2, Eye, EyeOff } from "lucide-react";
import { cn } from "../../../core/lib/utils";

interface SpeedReaderProps {
    isOpen: boolean;
    text: string;
    onClose: () => void;
    onAutoNext?: () => void;
    theme?: "light" | "sepia" | "dark";
}

function getOrpIndex(word: string): number {
    const len = word.length;
    if (len <= 1) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 13) return 3;
    return 4;
}

function splitWordForOrp(rawWord: string): { prefix: string; focal: string; suffix: string } {
    if (!rawWord) return { prefix: "", focal: "", suffix: "" };
    const orpIdx = getOrpIndex(rawWord);
    return {
        prefix: rawWord.slice(0, orpIdx),
        focal: rawWord[orpIdx] || "",
        suffix: rawWord.slice(orpIdx + 1),
    };
}

function getWordDelayFactor(word: string): number {
    if (!word) return 1;
    const lastChar = word[word.length - 1];
    if (lastChar === "." || lastChar === "!" || lastChar === "?" || lastChar === ":") {
        return 2.0;
    }
    if (lastChar === "," || lastChar === ";" || lastChar === "—" || lastChar === "-") {
        return 1.4;
    }
    if (word.length > 10) {
        return 1.2;
    }
    return 1.0;
}

export function SpeedReader({ isOpen, text, onClose, onAutoNext }: SpeedReaderProps) {
    const [wpm, setWpm] = useState(350);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showContext, setShowContext] = useState(true);

    const wordsRef = useRef<string[]>([]);
    const timerRef = useRef<number | null>(null);
    const autoPlayRef = useRef(false);
    const activeWordRef = useRef<HTMLSpanElement | null>(null);
    const contextScrollRef = useRef<HTMLDivElement | null>(null);

    // Parse tokens from text
    const words = useMemo(() => {
        if (!text) return [];
        const normalized = text.replace(/\s+/g, " ").trim();
        const tokens = normalized.split(" ").filter(Boolean);
        const avgLen = tokens.reduce((s, t) => s + t.length, 0) / Math.max(1, tokens.length);
        return (avgLen < 2 ? [normalized.replace(/\s+/g, "")] : tokens).filter((w) => w.length > 0);
    }, [text]);

    useEffect(() => {
        wordsRef.current = words;
        setCurrentIndex(0);
        if (autoPlayRef.current) {
            autoPlayRef.current = false;
            setIsPlaying(true);
        } else {
            setIsPlaying(false);
        }
    }, [words]);

    // Timer scheduling with dynamic punctuation pauses
    useEffect(() => {
        if (!isPlaying || !isOpen || wordsRef.current.length === 0) {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            return;
        }

        const tick = () => {
            setCurrentIndex((prev) => {
                if (prev >= wordsRef.current.length - 1) {
                    setIsPlaying(false);
                    if (onAutoNext) autoPlayRef.current = true;
                    setTimeout(() => onAutoNext?.(), 400);
                    return prev;
                }

                const nextIndex = prev + 1;
                const currentWord = wordsRef.current[nextIndex] || "";
                const factor = getWordDelayFactor(currentWord);
                const delay = Math.round(((60 * 1000) / wpm) * factor);

                timerRef.current = window.setTimeout(tick, delay);
                return nextIndex;
            });
        };

        const currentWord = wordsRef.current[currentIndex] || "";
        const factor = getWordDelayFactor(currentWord);
        const initialDelay = Math.round(((60 * 1000) / wpm) * factor);
        timerRef.current = window.setTimeout(tick, initialDelay);

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isPlaying, wpm, isOpen, onAutoNext, currentIndex]);

    // Smooth auto-scroll paragraph context to keep active word visible
    useEffect(() => {
        if (!showContext || !activeWordRef.current || !contextScrollRef.current) return;
        const container = contextScrollRef.current;
        const activeEl = activeWordRef.current;

        const containerTop = container.scrollTop;
        const containerHeight = container.clientHeight;
        const activeTop = activeEl.offsetTop - container.offsetTop;
        const activeHeight = activeEl.offsetHeight;

        // If active element is near edge or outside viewport, scroll it to center
        if (activeTop < containerTop + 24 || activeTop + activeHeight > containerTop + containerHeight - 24) {
            container.scrollTo({
                top: Math.max(0, activeTop - containerHeight / 2 + activeHeight / 2),
                behavior: "smooth",
            });
        }
    }, [currentIndex, showContext]);

    // Keyboard navigation
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => {
            switch (e.key) {
                case " ":
                    e.preventDefault();
                    setIsPlaying((p) => !p);
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    setCurrentIndex((i) => Math.min(i + 10, wordsRef.current.length - 1));
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    setCurrentIndex((i) => Math.max(i - 10, 0));
                    break;
                case "ArrowUp":
                    e.preventDefault();
                    setWpm((w) => Math.min(w + 25, 2000));
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    setWpm((w) => Math.max(w - 25, 50));
                    break;
                case "c":
                case "C":
                    e.preventDefault();
                    setShowContext((prev) => !prev);
                    break;
                case "Escape":
                    if (isFullscreen) {
                        void document.exitFullscreen?.();
                    } else {
                        setIsPlaying(false);
                        onClose();
                    }
                    break;
                case "f":
                case "F":
                    isFullscreen
                        ? void document.exitFullscreen?.()
                        : void document.documentElement.requestFullscreen?.();
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

    const wordCount = words.length;
    const progress = wordCount > 0 ? (currentIndex / wordCount) * 100 : 0;
    const currentWord = words[currentIndex] || "";
    const { prefix, focal, suffix } = useMemo(() => splitWordForOrp(currentWord), [currentWord]);

    const handleWordClick = useCallback((idx: number) => {
        setCurrentIndex(idx);
    }, []);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex flex-col select-none bg-[var(--color-background)] text-[var(--color-text-primary)] pt-[max(env(safe-area-inset-top,0px),0.25rem)] pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between shrink-0 min-h-11 px-3 sm:px-5 border-b border-[var(--color-border)]">
                <button
                    onClick={() => {
                        setIsPlaying(false);
                        onClose();
                    }}
                    className="flex items-center gap-1.5 text-xs font-semibold text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] cursor-pointer transition-colors min-h-[44px]"
                >
                    <X className="w-4 h-4" /> Close
                </button>

                <div className="flex items-center gap-3 sm:gap-4">
                    <button
                        onClick={() => setShowContext(!showContext)}
                        className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold border transition-colors cursor-pointer rounded-sm",
                            showContext
                                ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] border-[var(--color-accent)] shadow-xs"
                                : "bg-transparent text-[color:var(--color-text-muted)] border-[var(--color-border)] hover:text-[color:var(--color-text-primary)]"
                        )}
                        title="Toggle Paragraph Context (C)"
                    >
                        {showContext ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        <span className="hidden sm:inline">Paragraph Context</span>
                    </button>

                    <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-[color:var(--color-text-muted)]">
                            {currentIndex + 1} / {wordCount}
                        </span>
                        <div className="w-16 sm:w-24 h-1 overflow-hidden bg-[var(--color-surface-muted)] border border-[var(--color-border)]">
                            <div className="h-full bg-[var(--color-accent)] transition-all duration-150" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                </div>

                <button
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className="flex items-center justify-center min-h-[44px] min-w-[44px] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] cursor-pointer transition-colors"
                    aria-label="Fullscreen"
                >
                    {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
            </div>

            {/* Main Reading Canvas */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-3 sm:px-6 md:px-8 py-2 sm:py-4 gap-3 sm:gap-5 overflow-hidden w-full max-w-3xl mx-auto">
                {/* Spritz-style Optimal Recognition Point (ORP) Box */}
                <div className="w-full shrink-0 flex flex-col items-center justify-center">
                    <div className="relative w-full py-5 sm:py-8 md:py-10 border-y border-[var(--color-border)] bg-[var(--color-surface)]/60 backdrop-blur-sm shadow-sm flex items-center justify-center rounded-sm">
                        {/* Top and Bottom Center Focus Guides */}
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[3px] h-3 sm:h-4 bg-[var(--color-accent)] rounded-b-sm shadow-xs" />
                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[3px] h-3 sm:h-4 bg-[var(--color-accent)] rounded-t-sm shadow-xs" />

                        {/* Centered Word with Fixed Focal Letter Alignment */}
                        <div className="flex items-baseline w-full font-mono select-none px-4 text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-medium tracking-normal">
                            <span className="flex-1 text-right text-[color:var(--color-text-primary)] whitespace-pre">
                                {prefix}
                            </span>
                            <span className="shrink-0 text-[color:var(--color-accent)] font-black px-[0.5px] scale-105 drop-shadow-sm">
                                {focal || (currentWord ? "" : "—")}
                            </span>
                            <span className="flex-1 text-left text-[color:var(--color-text-primary)] whitespace-pre">
                                {suffix}
                            </span>
                        </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2 text-[10px] tracking-[0.25em] uppercase font-bold text-[color:var(--color-text-muted)]">
                        <span className={cn("inline-block w-1.5 h-1.5 rounded-full", isPlaying ? "bg-[var(--color-accent)] animate-pulse" : "bg-[var(--color-text-muted)]")} />
                        <span>{isPlaying ? "Reading" : "Paused"}</span>
                    </div>
                </div>

                {/* Responsive Paragraph Context Stream Box */}
                {showContext && (
                    <div
                        ref={contextScrollRef}
                        className="flex-1 min-h-[80px] max-h-[160px] sm:max-h-[220px] md:max-h-[280px] w-full overflow-y-auto px-3.5 sm:px-5 py-2.5 sm:py-3.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-sm text-xs sm:text-sm md:text-base leading-relaxed sm:leading-loose custom-scrollbar shadow-inner select-text transition-all duration-300"
                    >
                        <div className="flex flex-wrap gap-x-1.5 gap-y-1 sm:gap-x-2 sm:gap-y-1.5">
                            {words.map((w, idx) => {
                                const isCurrent = idx === currentIndex;
                                const isPast = idx < currentIndex;

                                return (
                                    <span
                                        key={idx}
                                        ref={isCurrent ? activeWordRef : null}
                                        onClick={() => handleWordClick(idx)}
                                        className={cn(
                                            "cursor-pointer rounded-[3px] transition-all duration-150",
                                            isCurrent
                                                ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] font-bold px-1.5 py-0.5 shadow-sm ring-2 ring-[var(--color-accent)]/30 scale-105 inline-block mx-0.5"
                                                : isPast
                                                ? "text-[color:var(--color-text-muted)] opacity-50 hover:opacity-90"
                                                : "text-[color:var(--color-text-primary)] hover:text-[color:var(--color-accent)]"
                                        )}
                                    >
                                        {w}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Controls Bar */}
            <div className="shrink-0 px-3 sm:px-6 pb-2 sm:pb-4 space-y-2 sm:space-y-3">
                <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
                    <button
                        onClick={() => setWpm((w) => Math.max(50, w - 25))}
                        className="flex items-center justify-center min-h-[38px] min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] text-sm font-bold border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] cursor-pointer transition-colors rounded-sm"
                        title="Decrease Speed"
                    >
                        −
                    </button>

                    <div className="flex items-center gap-1 min-w-[3.5rem] justify-center font-mono">
                        <span className="text-sm sm:text-base font-bold text-[color:var(--color-text-primary)]">{wpm}</span>
                        <span className="text-[9px] sm:text-[10px] tracking-[0.05em] uppercase text-[color:var(--color-text-muted)]">wpm</span>
                    </div>

                    <button
                        onClick={() => setWpm((w) => Math.min(2000, w + 25))}
                        className="flex items-center justify-center min-h-[38px] min-w-[38px] sm:min-h-[40px] sm:min-w-[40px] text-sm font-bold border border-[var(--color-border)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] cursor-pointer transition-colors rounded-sm"
                        title="Increase Speed"
                    >
                        +
                    </button>

                    <button
                        onClick={() => setIsPlaying(!isPlaying)}
                        className="flex items-center justify-center min-h-[42px] min-w-[42px] sm:min-h-[46px] sm:min-w-[46px] rounded-full transition-transform active:scale-95 bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] cursor-pointer shadow-md"
                        aria-label={isPlaying ? "Pause" : "Play"}
                    >
                        {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>

                    <div className="w-24 sm:w-36 text-[color:var(--color-text-muted)]">
                        <input
                            type="range"
                            min={50}
                            max={1200}
                            step={10}
                            value={wpm}
                            onChange={(e) => setWpm(Number(e.target.value))}
                            className="w-full cursor-pointer accent-[var(--color-accent)]"
                            aria-label="Speed"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-center gap-1.5 sm:gap-3 text-[9px] sm:text-[10px] tracking-[0.08em] uppercase text-[color:var(--color-text-muted)] font-mono flex-wrap">
                    <span>Space (Play/Pause)</span>
                    <span>·</span>
                    <span>↑↓ (WPM)</span>
                    <span>·</span>
                    <span>←→ (±10 Words)</span>
                    <span>·</span>
                    <span>C (Context)</span>
                    <span>·</span>
                    <span>F (Fullscreen)</span>
                </div>
            </div>
        </div>
    );
}
