/**
 * TtsPlayerBar — audiobook-style bottom player bar.
 *
 * Skip back / Play-Pause / Skip forward + progress bar + speed + settings + close.
 * Uses app design tokens (ui-icon-btn, --color-accent, etc.).
 */
import { Play, Pause, SkipBack, SkipForward, Settings2, X, Loader2 } from "lucide-react";
import { cn } from "../../../core";
import type { TtsState, TtsProgress } from "../tts/tts-manager";

interface TtsPlayerBarProps {
    state: TtsState;
    progress: TtsProgress;
    isSpeaking: boolean;
    isReady: boolean;
    isLoading: boolean;
    speed: number;
    onPlayPause: () => void;
    onStop: () => void;
    onSkipForward: () => void;
    onSkipBack: () => void;
    onSpeedCycle: () => void;
    onOpenSettings: () => void;
    className?: string;
}

export function TtsPlayerBar({
    state,
    progress,
    isSpeaking,
    isReady,
    isLoading,
    speed,
    onPlayPause,
    onStop,
    onSkipForward,
    onSkipBack,
    onSpeedCycle,
    onOpenSettings,
    className,
}: TtsPlayerBarProps) {
    const fraction = progress.total > 0 ? progress.current / progress.total : 0;
    const pct = Math.round(fraction * 100);
    const errMsg = state.status === "error" ? (state as { status: "error"; message: string }).message : null;

    return (
        <div
            className={cn(
                "flex items-center gap-2 px-3 py-2 sm:px-4",
                "bg-[var(--color-surface)] border-t border-[var(--color-border)]",
                className,
            )}
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
        >
            {/* Skip back */}
            <button
                onClick={onSkipBack}
                disabled={!isReady || progress.current === 0}
                className="p-1.5 rounded-md text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Previous sentence"
            >
                <SkipBack className="w-4 h-4" />
            </button>

            {/* Play / Pause */}
            <button
                onClick={onPlayPause}
                disabled={!isReady || isLoading}
                className={cn(
                    "flex items-center justify-center w-9 h-9 rounded-full transition-all shrink-0",
                    isSpeaking
                        ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)] hover:bg-[var(--color-accent)]/20"
                        : "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] hover:opacity-90",
                    "disabled:opacity-40 disabled:pointer-events-none",
                )}
                aria-label={isSpeaking ? "Pause" : "Play"}
            >
                {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : isSpeaking ? (
                    <Pause className="w-4 h-4" />
                ) : (
                    <Play className="w-4 h-4 ml-0.5" />
                )}
            </button>

            {/* Skip forward */}
            <button
                onClick={onSkipForward}
                disabled={!isReady || progress.current + 1 >= progress.total}
                className="p-1.5 rounded-md text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Next sentence"
            >
                <SkipForward className="w-4 h-4" />
            </button>

            {/* Progress bar */}
            <div className="flex-1 flex items-center gap-2 min-w-0">
                <div className="flex-1 h-1 bg-[var(--color-surface-variant)] rounded-full overflow-hidden">
                    <div
                        className="h-full bg-[var(--color-accent)] transition-[width] duration-200"
                        style={{ width: `${fraction * 100}%` }}
                    />
                </div>
                <span className="text-[var(--font-size-2xs)] text-[color:var(--color-text-muted)] tabular-nums shrink-0 hidden sm:inline">
                    {errMsg ? (
                        <span className="text-[color:var(--color-error)] truncate max-w-[120px]">{errMsg}</span>
                    ) : isLoading ? (
                        "Loading…"
                    ) : progress.total > 0 ? (
                        `${progress.current + 1}/${progress.total}`
                    ) : (
                        `${pct}%`
                    )}
                </span>
            </div>

            {/* Speed */}
            <button
                onClick={onSpeedCycle}
                disabled={!isReady}
                className="px-2 py-1 text-xs font-medium rounded-md text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors tabular-nums shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Change speed"
            >
                {speed}x
            </button>

            {/* Settings — opens voice overlay */}
            <button
                onClick={onOpenSettings}
                disabled={!isReady}
                className="p-1.5 rounded-md text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Voice settings"
            >
                <Settings2 className="w-4 h-4" />
            </button>

            {/* Close */}
            <button
                onClick={onStop}
                className="p-1.5 rounded-md text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors shrink-0"
                aria-label="Stop and close"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
