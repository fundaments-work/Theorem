/**
 * TtsPanel — Read Aloud controls overlay at the bottom.
 *
 * Uses the same FloatingPanel + Backdrop pattern as ReaderSettings.
 */
import { Volume2, Play, Pause, X } from "lucide-react";
import { cn } from "../../../core";
import { Backdrop, FloatingPanel } from "../../../ui";
import type { TtsState, TtsVoiceGroup } from "../tts/tts-manager";

interface TtsPanelProps {
    visible: boolean;
    onClose: () => void;
    state: TtsState;
    voices: TtsVoiceGroup[];
    selectedVoice: string;
    speed: number;
    isSpeaking: boolean;
    isPaused: boolean;
    isReady: boolean;
    onPlayPause: () => void;
    onStop: () => void;
    onVoiceChange: (voiceId: string) => void;
    onSpeedChange: (speed: number) => void;
    className?: string;
}

const SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function TtsPanel({
    visible,
    onClose,
    state,
    voices,
    selectedVoice,
    speed,
    isSpeaking,
    isPaused,
    isReady,
    onPlayPause,
    onStop,
    onVoiceChange,
    onSpeedChange,
    className,
}: TtsPanelProps) {
    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel
                visible={visible}
                anchor="bottom"
                className={cn("overflow-hidden bg-[var(--color-surface)]", className)}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2">
                        <Volume2 className="w-5 h-5 text-[color:var(--color-accent)]" />
                        <h2 className="text-base font-medium text-[color:var(--color-text-primary)]">
                            Read Aloud
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="ui-icon-btn"
                        aria-label="Close read aloud"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-4">
                    {/* Status */}
                    <p className={cn(
                        "text-xs font-medium",
                        state.status === "playing" && "text-[color:var(--color-accent)]",
                        state.status === "paused" && "text-[color:var(--color-text-muted)]",
                        state.status === "loading" && "text-[color:var(--color-accent)] animate-pulse",
                        state.status === "error" && "text-[color:var(--color-error)]",
                        state.status === "ready" && "text-[color:var(--color-text-muted)]",
                        state.status === "idle" && "text-[color:var(--color-text-muted)]",
                    )}>
                        {state.status === "playing" && "Speaking…"}
                        {state.status === "paused" && "Paused"}
                        {state.status === "loading" && "Loading speech engine…"}
                        {state.status === "error" && (() => { const s = state as { status: "error"; message: string }; return s.message; })()}
                        {state.status === "ready" && "Ready — press play"}
                        {state.status === "idle" && "Idle"}
                    </p>

                    {/* Playback controls row */}
                    <div className="flex items-center gap-3">
                        {/* Play / Pause */}
                        <button
                            onClick={onPlayPause}
                            disabled={!isReady}
                            className={cn(
                                "flex items-center justify-center w-12 h-12 rounded-full transition-colors",
                                isReady
                                    ? isSpeaking || isPaused
                                        ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)] hover:bg-[var(--color-accent)]/20"
                                        : "bg-[var(--color-accent)] text-[color:var(--color-on-accent)] hover:opacity-90"
                                    : "bg-[var(--color-border)] text-[color:var(--color-text-muted)] cursor-not-allowed",
                            )}
                            aria-label={isSpeaking ? "Pause" : isPaused ? "Resume" : "Play"}
                        >
                            {isSpeaking ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                        </button>

                        {/* Stop */}
                        <button
                            onClick={onStop}
                            className="flex items-center justify-center w-10 h-10 rounded-full text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
                            aria-label="Stop"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Voice selector */}
                    {voices.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-[color:var(--color-text-muted)]">
                                Voice
                            </label>
                            <select
                                value={selectedVoice}
                                onChange={(e) => onVoiceChange(e.target.value)}
                                className="w-full text-sm px-3 py-2 border border-[var(--color-border)] bg-[var(--color-surface)] text-[color:var(--color-text-primary)] rounded-md"
                            >
                                {voices.map((group) => (
                                    <optgroup key={group.label} label={group.label}>
                                        {group.voices.map((v) => (
                                            <option key={v.id} value={v.id}>
                                                {v.name} ({v.gender})
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Speed selector */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-[color:var(--color-text-muted)]">
                            Speed
                        </label>
                        <div className="flex gap-1">
                            {SPEED_PRESETS.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => onSpeedChange(s)}
                                    className={cn(
                                        "flex-1 py-1.5 text-xs font-medium rounded-md transition-colors",
                                        speed === s
                                            ? "bg-[var(--color-accent)] text-[color:var(--color-on-accent)]"
                                            : "bg-[var(--color-surface-hover)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text)]",
                                    )}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Loading placeholder */}
                    {state.status === "loading" && !isReady && (
                        <div className="space-y-2">
                            <div className="h-2 bg-[var(--color-border)] rounded animate-pulse" />
                            <div className="h-2 w-2/3 bg-[var(--color-border)] rounded animate-pulse" />
                        </div>
                    )}
                </div>
            </FloatingPanel>
        </>
    );
}
