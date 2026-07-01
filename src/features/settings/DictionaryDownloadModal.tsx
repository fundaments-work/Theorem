import { useEffect, useRef, useState } from "react";
import { Download, Check, AlertCircle, X } from "lucide-react";
import { Modal, ModalHeader, ModalBody } from "../../ui";
import { cn } from "../../core/lib/utils";
import { isTauri } from "../../core/lib/env";
import { useVocabularyStore } from "../../core/store";

interface DictEntry {
    name: string;
    language: string;
    url: string;
    sizeApprox: string;
}

const AVAILABLE_DICTS: DictEntry[] = [
    { name: "English", language: "en", url: "https://github.com/sapienskid/wiktionary-stardict/releases/download/en-latest/dict-en-en.zip", sizeApprox: "~50 MB" },
];

interface DictionaryDownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function DictionaryDownloadModal({ isOpen, onClose }: DictionaryDownloadModalProps) {
    const [error, setError] = useState<string | null>(null);
    const [justInstalled, setJustInstalled] = useState<Set<string>>(new Set());
    const [stage, setStage] = useState<string | null>(null);
    const installedDicts = useVocabularyStore((s) => s.installedDictionaries);
    const activeDownload = useVocabularyStore((s) => s.activeDownload);
    const setActiveDownload = useVocabularyStore((s) => s.setActiveDownload);
    const addInstalledDictionary = useVocabularyStore((s) => s.addInstalledDictionary);
    const abortRef = useRef<(() => void) | null>(null);
    const unlistenRef = useRef<(() => void) | null>(null);

    // Clean up download state and listeners when modal closes
    useEffect(() => {
        if (!isOpen) {
            abortRef.current?.();
            abortRef.current = null;
            unlistenRef.current?.();
            unlistenRef.current = null;
            setStage(null);
            setActiveDownload(null);
        }
    }, [isOpen, setActiveDownload]);

    const handleCancel = () => {
        abortRef.current?.();
        abortRef.current = null;
        unlistenRef.current?.();
        unlistenRef.current = null;
        setStage(null);
        setActiveDownload(null);
    };

    const handleDownload = async (dict: DictEntry) => {
        if (!isTauri()) {
            setError("Dictionary download requires the desktop or mobile app.");
            return;
        }

        setStage("Downloading");
        setActiveDownload({ dictName: dict.name, progress: { percent: 0, downloaded: 0, total: 0 } });
        setError(null);

        try {
            const { invoke } = await import("@tauri-apps/api/core");
            const { listen } = await import("@tauri-apps/api/event");

            // Listen for download progress from Rust
            const unlisten = await listen<{ percent: number; downloaded: number; total: number }>(
                "dictionary-download-progress",
                (event) => {
                    setActiveDownload({
                        dictName: dict.name,
                        progress: {
                            percent: event.payload.percent,
                            downloaded: event.payload.downloaded,
                            total: event.payload.total,
                        },
                    });
                },
            );
            unlistenRef.current = unlisten;

            // Use a promise + flag so we can abort from the cancel button
            let aborted = false;
            abortRef.current = () => {
                aborted = true;
            };

            const result = await invoke<{
                id: string;
                name: string;
                language: string;
                sizeBytes: number;
            }>("download_and_extract_stardict", { url: dict.url });

            unlistenRef.current?.();
            unlistenRef.current = null;
            abortRef.current = null;

            if (aborted) {
                setActiveDownload(null);
                return;
            }

            setStage("Installing");
            addInstalledDictionary({
                id: result.id,
                name: result.name,
                language: result.language,
                format: "stardict",
                sizeBytes: result.sizeBytes,
                importedAt: new Date(),
            });
            setJustInstalled((prev) => new Set([...prev, dict.name]));
            setActiveDownload(null);
        } catch (err) {
            unlistenRef.current?.();
            unlistenRef.current = null;
            abortRef.current = null;
            const message = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
            setError(message || "Download failed");
            setActiveDownload(null);
        } finally {
            setStage(null);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="md">
            <ModalHeader title="Download Dictionary" onClose={onClose} />
            <ModalBody>
                {error && (
                    <div className="flex items-start gap-2 p-3 mb-4 border border-[color:color-mix(in_srgb,var(--color-error)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--color-error)_8%,transparent)]">
                        <AlertCircle className="w-4 h-4 text-[color:var(--color-error)] shrink-0 mt-0.5" />
                        <p className="text-sm text-[color:var(--color-error)]">{error}</p>
                    </div>
                )}

                <p className="text-sm text-[color:var(--color-text-secondary)] mb-4">
                    One-click install of free dictionaries for offline word lookup.
                </p>

                <div className="space-y-3">
                    {AVAILABLE_DICTS.map((dict) => {
                        const isInstalled = justInstalled.has(dict.name)
                            || installedDicts.some((d) => d.language === dict.language);
                        const isDownloading = activeDownload?.dictName === dict.name;

                        return (
                            <div
                                key={dict.language}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border border-[var(--color-border)]"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm text-[color:var(--color-text-primary)]">
                                        {dict.name}
                                    </p>
                                    <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
                                        {dict.language.toUpperCase()} — {dict.sizeApprox}
                                    </p>
                                </div>
                                {isDownloading && activeDownload ? (
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <div className="flex-1 sm:w-36 flex flex-col gap-1">
                                            <div className="flex items-center justify-between text-xs text-[color:var(--color-text-muted)]">
                                                <span>{stage ?? "Downloading"}</span>
                                                <span>{activeDownload.progress.percent}%</span>
                                            </div>
                                            <div className="w-full h-2 bg-[var(--color-surface-muted)] overflow-hidden">
                                                <div
                                                    className="h-full bg-[var(--color-accent)]"
                                                    style={{ width: `${activeDownload.progress.percent}%` }}
                                                />
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleCancel}
                                            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-surface-muted)] transition-colors touch-manipulation"
                                            title="Cancel download"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => handleDownload(dict)}
                                        disabled={activeDownload !== null || isInstalled}
                                        className={cn(
                                            "px-3 py-1.5 min-h-[36px] text-[11px] font-medium shrink-0 border transition-colors touch-manipulation whitespace-nowrap",
                                            "w-full sm:w-auto",
                                            isInstalled
                                                ? "bg-[color:var(--color-success,#22c55e)] text-white border-transparent"
                                                : "border-[var(--color-border)] text-[color:var(--color-accent)] hover:bg-[var(--color-surface-muted)] active:bg-[var(--color-surface-muted)]",
                                            activeDownload !== null && !isDownloading && "opacity-50 cursor-not-allowed",
                                        )}
                                    >
                                        {isInstalled ? (
                                            <>
                                                <Check className="w-3.5 h-3.5 inline mr-1" />
                                                Installed
                                            </>
                                        ) : (
                                            <>
                                                <Download className="w-3.5 h-3.5 inline mr-1" />
                                                Install
                                            </>
                                        )}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </ModalBody>
        </Modal>
    );
}
