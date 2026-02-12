import { Check, Loader2, X } from "lucide-react";
import { cn } from "@lionreader/core";
import type { DictionaryLookupResult } from "@lionreader/core";

interface DictionaryResultPopoverProps {
    isOpen: boolean;
    position: { x: number; y: number };
    term: string;
    result: DictionaryLookupResult | null;
    loading: boolean;
    error?: string | null;
    saved: boolean;
    canSaveToVocabulary?: boolean;
    saveDisabledMessage?: string;
    onSave: () => void;
    onClose: () => void;
}

/**
 * Lightweight contextual dictionary popover for reader text selections.
 */
export function DictionaryResultPopover({
    isOpen,
    position,
    term,
    result,
    loading,
    error,
    saved,
    canSaveToVocabulary = true,
    saveDisabledMessage,
    onSave,
    onClose,
}: DictionaryResultPopoverProps) {
    if (!isOpen) {
        return null;
    }

    const x = Math.max(16, Math.min(window.innerWidth - 360, position.x - 160));
    const y = Math.max(16, Math.min(window.innerHeight - 280, position.y + 12));

    return (
        <div
            className={cn(
                "fixed z-[110] w-[20rem] rounded-xl border border-[var(--color-border)]",
                "bg-[var(--color-surface)] shadow-[var(--shadow-lg)]",
            )}
            style={{ left: x, top: y }}
        >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
                <div>
                    <p className="text-xs uppercase tracking-wide text-[color:var(--color-text-muted)]">Dictionary</p>
                    <p className="text-sm font-semibold text-[color:var(--color-text-primary)]">{term}</p>
                </div>
                <button
                    onClick={onClose}
                    className="rounded-md p-1 text-[color:var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="max-h-60 overflow-y-auto px-3 py-3">
                {loading && (
                    <div className="flex items-center gap-2 text-sm text-[color:var(--color-text-secondary)]">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Looking up definitions...
                    </div>
                )}

                {!loading && error && (
                    <p className="text-sm text-[color:var(--color-error)]">{error}</p>
                )}

                {!loading && !error && !result && (
                    <p className="text-sm text-[color:var(--color-text-secondary)]">No definition found.</p>
                )}

                {!loading && result && result.meanings.length > 0 && (
                    <div className="space-y-3">
                        {result.phonetic && (
                            <p className="text-xs text-[color:var(--color-text-muted)]">/{result.phonetic}/</p>
                        )}
                        {result.meanings.slice(0, 3).map((meaning, idx) => (
                            <div key={`${meaning.provider}-${idx}`} className="space-y-1">
                                <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text-muted)]">
                                    {meaning.partOfSpeech || "Meaning"}
                                </p>
                                <ul className="space-y-1 text-sm text-[color:var(--color-text-primary)]">
                                    {meaning.definitions.slice(0, 3).map((definition) => (
                                        <li key={definition} className="leading-snug">
                                            • {definition}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-end border-t border-[var(--color-border)] px-3 py-2">
                <button
                    onClick={onSave}
                    disabled={loading || !result || saved || !canSaveToVocabulary}
                    className={cn(
                        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                        saved
                            ? "bg-[var(--color-success)]/10 text-[color:var(--color-success)]"
                            : "bg-[var(--color-accent)] ui-text-accent-contrast hover:opacity-90",
                        (loading || !result || !canSaveToVocabulary) && "cursor-not-allowed opacity-60",
                    )}
                >
                    {saved ? <Check className="h-3.5 w-3.5" /> : null}
                    {saved ? "Saved" : "Save to Vocabulary"}
                </button>
            </div>
            {!canSaveToVocabulary && (
                <div className="border-t border-[var(--color-border)] px-3 py-2 text-xs text-[color:var(--color-text-muted)]">
                    {saveDisabledMessage || "Enable Vocabulary Builder in Settings to save terms."}
                </div>
            )}
        </div>
    );
}
