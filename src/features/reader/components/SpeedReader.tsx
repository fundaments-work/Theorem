import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, X, Maximize2, Minimize2, ChevronUp, ChevronDown } from "lucide-react";

interface SpeedReaderProps {
    isOpen: boolean;
    text: string;
    onClose: () => void;
    theme?: "light" | "sepia" | "dark";
}

const WORD_REGEX = /\S+\s*/g;

export function SpeedReader({ isOpen, text, onClose, theme = "dark" }: SpeedReaderProps) {
    const [wpm, setWpm] = useState(400);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const wordsRef = useRef<string[]>([]);
    const timerRef = useRef<number | null>(null);

    const bgColor = theme === "sepia" ? "#f4ecd8" : theme === "light" ? "#faf9f7" : "#141416";
    const fgColor = theme === "sepia" ? "#3d3025" : theme === "light" ? "#1c1c1c" : "#e8e6e1";
    const accentColor = theme === "sepia" ? "#3d3025" : theme === "light" ? "#2d6a6e" : "#6bcdd1";

    useEffect(() => {
        if (!text) {
            wordsRef.current = [];
            return;
        }
        const matches = text.match(WORD_REGEX) || [];
        wordsRef.current = matches.map((w) => w.trim()).filter(Boolean);
        setCurrentIndex(0);
        setIsPlaying(false);
    }, [text]);

    useEffect(() => {
        if (!isPlaying || !isOpen) {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            return;
        }

        const delay = (60 * 1000) / wpm;
        timerRef.current = window.setInterval(() => {
            setCurrentIndex((prev) => {
                if (prev >= wordsRef.current.length - 1) {
                    setIsPlaying(false);
                    return prev;
                }
                return prev + 1;
            });
        }, delay);

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isPlaying, wpm, isOpen]);

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
                    setWpm((w) => Math.min(w + 50, 2000));
                    break;
                case "ArrowDown":
                    e.preventDefault();
                    setWpm((w) => Math.max(w - 50, 50));
                    break;
                case "Escape":
                    if (isFullscreen) {
                        document.exitFullscreen?.();
                    } else {
                        setIsPlaying(false);
                        onClose();
                    }
                    break;
                case "f":
                case "F":
                    if (!isFullscreen) {
                        document.documentElement.requestFullscreen?.();
                    } else {
                        document.exitFullscreen?.();
                    }
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

    const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        setCurrentIndex(Math.floor(pct * wordCount));
    }, [wordCount]);

    if (!isOpen) return null;

    return (
        <div
            style={{ background: bgColor, color: fgColor }}
            className="fixed inset-0 z-[200] flex flex-col items-center justify-center select-none"
        >
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 sm:px-8 py-3"
                style={{ background: `linear-gradient(to bottom, ${bgColor}ee, transparent)` }}>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => { setIsPlaying(false); onClose(); }}
                        className="flex items-center gap-1.5 text-xs font-medium"
                        style={{ color: fgColor, opacity: 0.5 }}
                    >
                        <X className="w-4 h-4" />
                        <span className="hidden sm:inline">Close</span>
                    </button>
                    <span style={{ color: fgColor, opacity: 0.3, fontSize: 11 }}>
                        {currentIndex + 1}/{wordCount}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-1.5" style={{ color: fgColor, opacity: 0.5 }}
                        aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            <div className="flex-1 flex items-center justify-center w-full px-8" style={{ marginTop: -60 }}>
                <div className="text-center">
                    <div
                        key={currentIndex}
                        style={{
                            color: fgColor,
                            fontSize: "clamp(2rem, 6vw, 5rem)",
                            fontWeight: 500,
                            lineHeight: 1.2,
                            letterSpacing: "-0.02em",
                            transition: "none",
                            fontFamily: "system-ui, -apple-system, sans-serif",
                        }}
                    >
                        {currentWord || "—"}
                    </div>
                    <div style={{ color: fgColor, opacity: 0.15, fontSize: 13, marginTop: 12, fontFamily: "system-ui, -apple-system, sans-serif" }}>
                        {isPlaying ? "READING" : "PAUSED"}
                    </div>
                </div>
            </div>

            <div className="w-full max-w-md px-6 pb-6 space-y-3">
                <div
                    className="h-1 rounded-full cursor-pointer overflow-hidden"
                    style={{ background: `${fgColor}15` }}
                    onClick={handleSeek}
                >
                    <div className="h-full rounded-full transition-[width] duration-100"
                        style={{ width: `${progress}%`, background: accentColor }} />
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setIsPlaying(!isPlaying)}
                            className="flex items-center justify-center w-12 h-12 rounded-full transition-colors"
                            style={{ background: accentColor, color: bgColor }}
                            aria-label={isPlaying ? "Pause" : "Play"}
                        >
                            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                        </button>
                        <button
                            onClick={() => setWpm((w) => Math.max(50, w - 50))}
                            className="p-2" style={{ color: fgColor, opacity: 0.4 }}
                            aria-label="Slower"
                        >
                            <ChevronDown className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setWpm((w) => Math.min(2000, w + 50))}
                            className="p-2" style={{ color: fgColor, opacity: 0.4 }}
                            aria-label="Faster"
                        >
                            <ChevronUp className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex items-center gap-2 text-xs font-mono" style={{ color: fgColor, opacity: 0.5 }}>
                        <input
                            type="range"
                            min={50}
                            max={2000}
                            step={10}
                            value={wpm}
                            onChange={(e) => setWpm(Number(e.target.value))}
                            className="w-20 h-1 accent-[var(--color-accent)]"
                            style={{ accentColor }}
                            aria-label="Reading speed"
                        />
                        <span className="w-12 text-right">{wpm} wpm</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
