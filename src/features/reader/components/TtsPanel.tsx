/**
 * TtsPanel — Read Aloud controls overlay.
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
    isSpeaking: boolean;
    isPaused: boolean;
    isReady: boolean;
    onPlayPause: () => void;
    onStop: () => void;
    onVoiceChange: (voiceId: string) => void;
    className?: string;
}

export function TtsPanel({
    visible,
    onClose,
    state,
    voices,
    selectedVoice,
    isSpeaking,
    isPaused,
    isReady,
    onPlayPause,
    onStop,
    onVoiceChange,
    className,
}: TtsPanelProps) {
    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={cn("overflow-hidden bg-[var(--color-surface)]", className)}>
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
                    <div className="flex items-center gap-2">
                        <span className={cn(
                            "text-xs font-medium",
                            state.status === "playing" && "text-[color:var(--color-accent)] animate-pulse",
                            state.status === "paused" && "text-[color:var(--color-text-muted)]",
                            state.status === "loading" && "text-[color:var(--color-accent)] animate-pulse",
                            state.status === "error" && "text-[color:var(--color-error)]",
                            state.status === "ready" && "text-[color:var(--color-text-muted)]",
                        )}>
                            {state.status === "playing" && "Speaking…"}
                            {state.status === "paused" && "Paused"}
                            {state.status === "loading" && "Loading speech engine…"}
                            {state.status === "error" && (() => { const s = state as { status: "error"; message: string }; return s.message; })()}
                            {state.status === "ready" && "Ready"}
                            {state.status === "idle" && "Idle"}
                        </span>
                    </div>

                    {/* Play / Pause button */}
                    {isReady && (
                        <button
                            onClick={onPlayPause}
                            className={cn(
                                "w-full flex items-center justify-center gap-2 py-2 rounded-md font-medium text-sm transition-colors",
                                isSpeaking || isPaused
                                    ? "bg-[var(--color-accent)]/10 text-[color:var(--color-accent)] hover:bg-[var(--color-accent)]/20"
                                    : "bg-[var(--color-accent)] text-[color:var(--color-on-accent)] hover:opacity-90",
                            )}
                        >
                            {isSpeaking ? (
                                <>
                                    <Pause className="w-4 h-4" /> Pause
                                </>
                            ) : isPaused ? (
                                <>
                                    <Play className="w-4 h-4" /> Resume
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" /> Play
                                </>
                            )}
                        </button>
                    )}

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

                    {/* Loading placeholder — shows while model downloads */}
                    {state.status === "loading" && !isReady && (
                        <div className="space-y-2">
                            <div className="h-2 bg-[var(--color-border)] rounded animate-pulse" />
                            <div className="h-2 w-2/3 bg-[var(--color-border)] rounded animate-pulse" />
                        </div>
                    )}

                    {/* Stop button */}
                    <button
                        onClick={onStop}
                        className="w-full py-2 rounded-md font-medium text-sm text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
                    >
                        Stop
                    </button>
                </div>
            </FloatingPanel>
        </>
    );
}
