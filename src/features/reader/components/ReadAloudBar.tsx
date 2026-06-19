import { useState, useCallback, useRef, useEffect } from "react";
import { Play, Pause, SkipBack, SkipForward, X, Volume2 } from "lucide-react";
import { cn } from "../../../core";

export interface ReadAloudController {
    /** Get the next chunk of text to speak. Returns null when done. */
    getNextChunk: () => string | null;
    /** Get the previous chunk of text. Returns null when at start. */
    getPrevChunk: () => string | null;
    /** Resume from current position. */
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
        if (!controller) return;
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
        if (!controller) return;
        speechSynthesis.cancel();
        isActiveRef.current = true;
        setIsPlaying(true);
        speakNext();
    }, [controller, speakNext]);

    const pause = useCallback(() => {
        speechSynthesis.pause();
        setIsPlaying(false);
    }, []);

    const resume = useCallback(() => {
        speechSynthesis.resume();
        isActiveRef.current = true;
        setIsPlaying(true);
    }, []);

    const skipBack = useCallback(() => {
        if (!controller) return;
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
        speechSynthesis.cancel();
        if (!isActiveRef.current) return;
        speakNext();
    }, [speakNext]);

    useEffect(() => {
        return () => {
            speechSynthesis.cancel();
            isActiveRef.current = false;
        };
    }, []);

    if (!controller) return null;

    return (
        <div
            className={cn(
                "flex items-center gap-3 px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-surface)]",
                className,
            )}
        >
            <Volume2 className="w-4 h-4 text-[color:var(--color-accent)]" />

            <div className="flex items-center gap-1">
                <button
                    onClick={skipBack}
                    className="p-1.5 text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text)] transition-colors"
                    aria-label="Previous"
                >
                    <SkipBack className="w-4 h-4" />
                </button>

                <button
                    onClick={isPlaying ? pause : resume}
                    className="p-1.5 text-[color:var(--color-accent)] hover:text-[color:var(--color-accent-hover)] transition-colors"
                    aria-label={isPlaying ? "Pause" : "Play"}
                >
                    {isPlaying ? (
                        <Pause className="w-4 h-4" />
                    ) : (
                        <Play className="w-4 h-4" />
                    )}
                </button>

                <button
                    onClick={skipForward}
                    className="p-1.5 text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text)] transition-colors"
                    aria-label="Next"
                >
                    <SkipForward className="w-4 h-4" />
                </button>
            </div>

            <button
                onClick={onClose}
                className="ml-auto p-1.5 text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)] transition-colors"
                aria-label="Stop reading"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
