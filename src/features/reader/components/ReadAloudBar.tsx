import { useState, useCallback, useRef, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward, X, Volume2 } from "lucide-react";
import { cn } from "../../../core";

function hasSpeechSynthesis(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
}

export interface ReadAloudController {
    getNextChunk: () => string | null;
    getPrevChunk: () => string | null;
    getCurrentChunk: () => string | null;
}

interface ReadAloudBarProps {
    controller: ReadAloudController | null;
    onClose: () => void;
    className?: string;
}

export function ReadAloudBar({ controller, onClose, className }: ReadAloudBarProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
    const isActiveRef = useRef(false);

    const speakNext = useCallback(() => {
        if (!controller || !hasSpeechSynthesis()) return;
        const text = controller.getNextChunk();
        if (!text) {
            isActiveRef.current = false;
            setIsPlaying(false);
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;

        utterance.onend = () => {
            if (!isActiveRef.current) return;
            speakNext();
        };

        utterance.onerror = () => {
            isActiveRef.current = false;
            setIsPlaying(false);
        };

        utteranceRef.current = utterance;
        speechSynthesis.speak(utterance);
    }, [controller]);

    const play = useCallback(() => {
        if (!controller || !hasSpeechSynthesis()) return;
        speechSynthesis.cancel();
        isActiveRef.current = true;
        setIsPlaying(true);
        speakNext();
    }, [controller, speakNext]);

    const pause = useCallback(() => {
        if (!hasSpeechSynthesis()) return;
        speechSynthesis.pause();
        setIsPlaying(false);
    }, []);

    const resume = useCallback(() => {
        if (!hasSpeechSynthesis()) return;
        speechSynthesis.resume();
        isActiveRef.current = true;
        setIsPlaying(true);
    }, []);

    const skipBack = useCallback(() => {
        if (!controller || !hasSpeechSynthesis()) return;
        speechSynthesis.cancel();
        const text = controller.getPrevChunk();
        if (text) {
            isActiveRef.current = true;
            setIsPlaying(true);
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.95;
            utterance.onend = () => {
                if (!isActiveRef.current) return;
                speakNext();
            };
            utteranceRef.current = utterance;
            speechSynthesis.speak(utterance);
        } else {
            play();
        }
    }, [controller, play, speakNext]);

    const skipForward = useCallback(() => {
        if (!hasSpeechSynthesis()) return;
        speechSynthesis.cancel();
        if (!isActiveRef.current) return;
        speakNext();
    }, [speakNext]);

    useEffect(() => {
        return () => {
            if (hasSpeechSynthesis()) {
                speechSynthesis.cancel();
            }
            isActiveRef.current = false;
        };
    }, []);

    if (!controller || !hasSpeechSynthesis()) return null;

    return (
        <div
            className={cn(
                "absolute bottom-0 left-0 right-0 z-[var(--z-tooltip)]",
                "flex items-center gap-2 px-4 py-2.5",
                "bg-[var(--color-surface)]/95 backdrop-blur-xl border-t border-[var(--color-border-subtle)]",
                "shadow-[0_-4px_24px_rgba(0,0,0,0.12)]",
                className,
            )}
        >
            <Volume2 className="w-4 h-4 text-[color:var(--color-accent)] shrink-0" />

            <div className="flex items-center gap-0.5">
                <button
                    onClick={skipBack}
                    className="p-1.5 rounded-md text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    aria-label="Previous sentence"
                >
                    <SkipBack className="w-4 h-4" />
                </button>

                <button
                    onClick={isPlaying ? pause : resume}
                    className="p-1.5 rounded-md text-[color:var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors"
                    aria-label={isPlaying ? "Pause" : "Resume"}
                >
                    {isPlaying ? (
                        <Pause className="w-4 h-4" />
                    ) : (
                        <Play className="w-4 h-4" />
                    )}
                </button>

                <button
                    onClick={skipForward}
                    className="p-1.5 rounded-md text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
                    aria-label="Next sentence"
                >
                    <SkipForward className="w-4 h-4" />
                </button>
            </div>

            <button
                onClick={onClose}
                className="ml-auto p-1.5 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
                aria-label="Stop reading"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
