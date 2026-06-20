/**
 * TtsPanel — voice settings overlay (FloatingPanel).
 *
 * Opens from the gear icon on TtsPlayerBar.
 * Contains voice selector and speed presets.
 * Uses same Backdrop + FloatingPanel pattern as ReaderSettings.
 */
import { Volume2, X } from "lucide-react";
import { cn } from "../../../core";
import { Backdrop, FloatingPanel } from "../../../ui";
import type { TtsVoiceGroup } from "../tts/tts-manager";

interface TtsPanelProps {
    visible: boolean;
    onClose: () => void;
    voices: TtsVoiceGroup[];
    selectedVoice: string;
    speed: number;
    onVoiceChange: (voiceId: string) => void;
    onSpeedChange: (speed: number) => void;
    className?: string;
}

const SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

export function TtsPanel({
    visible,
    onClose,
    voices,
    selectedVoice,
    speed,
    onVoiceChange,
    onSpeedChange,
    className,
}: TtsPanelProps) {
    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel
                visible={visible}
                anchor="top-right"
                className={cn("overflow-hidden bg-[var(--color-surface)]", className)}
            >
                {/* Header — same pattern as ReaderSettings */}
                <div className="reader-panel-header flex items-center justify-between border-b border-[var(--color-border)] p-4">
                    <div className="flex items-center gap-2">
                        <Volume2 className="w-5 h-5 text-[color:var(--color-accent)]" />
                        <h2 className="text-base font-medium text-[color:var(--color-text-primary)]">
                            Voice
                        </h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="ui-icon-btn"
                        aria-label="Close voice settings"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-4 space-y-5 overflow-y-auto">
                    {/* Voice selector */}
                    {voices.length > 0 && (
                        <div className="space-y-2">
                            <label className="text-xs font-medium leading-snug text-[color:var(--color-text-muted)]">
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

                    {/* Speed presets */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium leading-snug text-[color:var(--color-text-muted)]">
                            Speed
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {SPEED_PRESETS.map((s) => (
                                <button
                                    key={s}
                                    onClick={() => onSpeedChange(s)}
                                    className={cn(
                                        "ui-chip-btn",
                                        speed === s && "data-[active=true]",
                                    )}
                                    data-active={speed === s}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </FloatingPanel>
        </>
    );
}
