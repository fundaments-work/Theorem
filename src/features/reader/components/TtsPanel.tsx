/**
 * TtsPanel — voice settings overlay (FloatingPanel).
 *
 * Opens from the gear icon on TtsPlayerBar.
 * Contains voice selector (using the app's Dropdown component) and
 * speed presets (chip buttons matching ReaderSettings pattern).
 * Uses same Backdrop + FloatingPanel pattern as ReaderSettings.
 */
import { Volume2, X } from "lucide-react";
import { cn } from "../../../core";
import { Backdrop, FloatingPanel, Dropdown } from "../../../ui";
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

/** Flatten voice groups into Dropdown-compatible options. */
function buildVoiceOptions(voices: TtsVoiceGroup[]) {
    const opts: { value: string; label: string; group: string }[] = [];
    for (const group of voices) {
        for (const v of group.voices) {
            opts.push({
                value: v.id,
                label: `${v.name} (${v.gender})`,
                group: group.label,
            });
        }
    }
    // Sort by group then name
    opts.sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
    return opts;
}

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
    const voiceOptions = buildVoiceOptions(voices);

    // Find the current voice's group for display
    const currentVoice = voiceOptions.find((o) => o.value === selectedVoice);
    const currentGroup = currentVoice?.group;

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel
                visible={visible}
                anchor="top-right"
                className={cn("overflow-hidden bg-[var(--color-surface)]", className)}
            >
                {/* Header — matches ReaderSettings pattern */}
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

                {/* Body — matches ReaderSettings scrollable body pattern */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5">
                    {/* Voice selector — using app Dropdown component */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium leading-snug text-[color:var(--color-text-muted)]">
                            Voice
                        </label>
                        <Dropdown
                            options={voiceOptions}
                            value={selectedVoice}
                            onChange={onVoiceChange}
                            placeholder="Choose a voice…"
                            size="sm"
                            variant="default"
                            className="w-full"
                            align="left"
                        />
                        {currentGroup && (
                            <p className="text-[10px] leading-snug text-[color:var(--color-text-muted)]">
                                {currentGroup}
                            </p>
                        )}
                    </div>

                    {/* Speed presets — chips matching ReaderSettings pattern */}
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
