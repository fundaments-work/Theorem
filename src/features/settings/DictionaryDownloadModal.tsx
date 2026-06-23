import { useState } from "react";
import { Download, Loader2, Check, AlertCircle, WifiOff } from "lucide-react";
import { Modal, ModalHeader, ModalBody } from "../../ui";
import { cn, isTauri } from "../../core";
import { useVocabularyStore } from "../../core";

interface DictEntry {
    name: string;
    language: string;
    url: string;
    sizeApprox: string;
}

const AVAILABLE_DICTS: DictEntry[] = [
    { name: "English", language: "en", url: "https://www.reader-dict.com/file/en/dict-en-en.zip", sizeApprox: "~40 MB" },
    { name: "Français", language: "fr", url: "https://www.reader-dict.com/file/fr/dict-fr-fr.zip", sizeApprox: "~30 MB" },
    { name: "Deutsch", language: "de", url: "https://www.reader-dict.com/file/de/dict-de-de.zip", sizeApprox: "~40 MB" },
    { name: "Español", language: "es", url: "https://www.reader-dict.com/file/es/dict-es-es.zip", sizeApprox: "~30 MB" },
    { name: "Italiano", language: "it", url: "https://www.reader-dict.com/file/it/dict-it-it.zip", sizeApprox: "~30 MB" },
    { name: "Português", language: "pt", url: "https://www.reader-dict.com/file/pt/dict-pt-pt.zip", sizeApprox: "~30 MB" },
    { name: "Русский", language: "ru", url: "https://www.reader-dict.com/file/ru/dict-ru-ru.zip", sizeApprox: "~40 MB" },
    { name: "日本語", language: "ja", url: "https://www.reader-dict.com/file/ja/dict-ja-ja.zip", sizeApprox: "~5 MB" },
    { name: "中文", language: "zh", url: "https://www.reader-dict.com/file/zh/dict-zh-zh.zip", sizeApprox: "~25 MB" },
    { name: "Svenska", language: "sv", url: "https://www.reader-dict.com/file/sv/dict-sv-sv.zip", sizeApprox: "~10 MB" },
    { name: "Norsk", language: "no", url: "https://www.reader-dict.com/file/no/dict-no-no.zip", sizeApprox: "~10 MB" },
    { name: "Dansk", language: "da", url: "https://www.reader-dict.com/file/da/dict-da-da.zip", sizeApprox: "~8 MB" },
];

interface DictionaryDownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function DictionaryDownloadModal({ isOpen, onClose }: DictionaryDownloadModalProps) {
    const [downloading, setDownloading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [installed, setInstalled] = useState<Set<string>>(new Set());
    const installedDicts = useVocabularyStore((s) => s.installedDictionaries);

    const handleDownload = async (dict: DictEntry) => {
        if (!isTauri()) {
            setError("Dictionary download requires the desktop or mobile app. Use Import Files for local StarDict files.");
            return;
        }

        setDownloading(dict.name);
        setError(null);

        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        try {
            const { invoke } = await import("@tauri-apps/api/core");
            const metadata = await invoke<{
                id: string;
                name: string;
                language: string;
                sizeBytes: number;
            }>("download_and_extract_stardict", { url: dict.url });

            useVocabularyStore.getState().addInstalledDictionary({
                id: metadata.id,
                name: metadata.name,
                language: metadata.language,
                format: "stardict" as const,
                sizeBytes: metadata.sizeBytes,
                importedAt: new Date(),
            });
            setInstalled((prev) => new Set([...prev, dict.name]));
        } catch (err) {
            const message = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
            console.error("[DictionaryDownload]", message, err);
            setError(message || "Download failed");
        } finally {
            setDownloading(null);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="md">
            <ModalHeader title="Download Dictionary" onClose={onClose} />
            <ModalBody>
                {!isTauri() && (
                    <div className="flex items-start gap-2 p-3 mb-4 border border-[color:color-mix(in_srgb,var(--color-text-muted)_30%,transparent)] bg-[var(--color-surface-muted)]">
                        <WifiOff className="w-4 h-4 text-[color:var(--color-text-muted)] shrink-0 mt-0.5" />
                        <p className="text-sm text-[color:var(--color-text-muted)]">
                            Dictionary download requires the desktop app. Use Import Files to add local StarDict dictionaries.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="flex items-start gap-2 p-3 mb-4 border border-[color:color-mix(in_srgb,var(--color-error)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--color-error)_8%,transparent)]">
                        <AlertCircle className="w-4 h-4 text-[color:var(--color-error)] shrink-0 mt-0.5" />
                        <p className="text-sm text-[color:var(--color-error)]">{error}</p>
                    </div>
                )}

                <p className="text-sm text-[color:var(--color-text-secondary)] mb-4">
                    One-click install of free StarDict dictionaries for offline word lookup.
                </p>

                <div className="space-y-3">
                    {AVAILABLE_DICTS.map((dict) => {
                        const isInstalled = installed.has(dict.name)
                            || installedDicts.some((d) => d.language === dict.language);

                        return (
                            <div
                                key={dict.language}
                                className="flex items-center justify-between gap-4 p-3 border border-[var(--color-border)]"
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm text-[color:var(--color-text-primary)]">
                                        {dict.name}
                                    </p>
                                    <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">
                                        {dict.language.toUpperCase()} — {dict.sizeApprox}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleDownload(dict)}
                                    disabled={downloading !== null || isInstalled}
                                    className={cn(
                                        "px-3 py-1.5 min-h-[40px] text-[11px] font-medium shrink-0 border transition-colors touch-manipulation",
                                        isInstalled
                                            ? "bg-[color:var(--color-success,#22c55e)] text-white border-transparent"
                                            : "border-[var(--color-border)] text-[color:var(--color-accent)] hover:bg-[var(--color-surface-muted)] active:bg-[var(--color-surface-muted)]",
                                        downloading !== null && "opacity-50 cursor-not-allowed",
                                    )}
                                >
                                    {downloading === dict.name ? (
                                        <span className="flex items-center gap-1.5">
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            Downloading {dict.sizeApprox}…
                                        </span>
                                    ) : isInstalled ? (
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
                            </div>
                        );
                    })}
                </div>
            </ModalBody>
        </Modal>
    );
}
