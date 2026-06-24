import { useState } from "react";
import { Download, Check, AlertCircle, WifiOff } from "lucide-react";
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
    // Reader-dict.com (Wiktionary-based, free monolingual + bilingual)
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
    // FreeDict.org (much larger bilingual dictionaries, 100k-500k headwords)
    { name: "English ⇄ German (FreeDict)", language: "de", url: "https://download.freedict.org/dictionaries/eng-deu/eng-deu-stardict.tar.bz2", sizeApprox: "~80 MB" },
    { name: "German ⇄ English (FreeDict)", language: "de", url: "https://download.freedict.org/dictionaries/deu-eng/deu-eng-stardict.tar.bz2", sizeApprox: "~90 MB" },
    { name: "English ⇄ French (FreeDict)", language: "fr", url: "https://download.freedict.org/dictionaries/eng-fra/eng-fra-stardict.tar.bz2", sizeApprox: "~15 MB" },
    { name: "English ⇄ Spanish (FreeDict)", language: "es", url: "https://download.freedict.org/dictionaries/eng-spa/eng-spa-stardict.tar.bz2", sizeApprox: "~50 MB" },
    { name: "English ⇄ Japanese (FreeDict)", language: "ja", url: "https://download.freedict.org/dictionaries/eng-jpn/eng-jpn-stardict.tar.bz2", sizeApprox: "~60 MB" },
    { name: "English ⇄ Chinese (FreeDict)", language: "zh", url: "https://download.freedict.org/dictionaries/eng-cmn/eng-cmn-stardict.tar.bz2", sizeApprox: "~30 MB" },
];

interface DictionaryDownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function DictionaryDownloadModal({ isOpen, onClose }: DictionaryDownloadModalProps) {
    const [error, setError] = useState<string | null>(null);
    const [justInstalled, setJustInstalled] = useState<Set<string>>(new Set());
    const installedDicts = useVocabularyStore((s) => s.installedDictionaries);
    const activeDownload = useVocabularyStore((s) => s.activeDownload);
    const setActiveDownload = useVocabularyStore((s) => s.setActiveDownload);
    const addInstalledDictionary = useVocabularyStore((s) => s.addInstalledDictionary);

    const handleDownload = async (dict: DictEntry) => {
        if (!isTauri()) {
            setError("Dictionary download requires the desktop or mobile app. Use Import Files for local StarDict files.");
            return;
        }

        setActiveDownload({ dictName: dict.name, progress: { percent: 0, downloaded: 0, total: 0 } });
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

            addInstalledDictionary({
                id: metadata.id,
                name: metadata.name,
                language: metadata.language,
                format: "stardict" as const,
                sizeBytes: metadata.sizeBytes,
                importedAt: new Date(),
            });
            setJustInstalled((prev) => new Set([...prev, dict.name]));
        } catch (err) {
            const message = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
            console.error("[DictionaryDownload]", message, err);
            setError(message || "Download failed");
        } finally {
            setActiveDownload(null);
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
                    One-click install of free dictionaries for offline word lookup. You can also use <strong>Import Files</strong> to add any StarDict or Dictd (.ifo + .idx/.index + .dict.dz) dictionary.
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
                                    <div className="w-full sm:w-48 flex flex-col gap-1">
                                        <div className="flex items-center justify-between text-xs text-[color:var(--color-text-muted)]">
                                            <span>Downloading {dict.sizeApprox}</span>
                                            <span>{activeDownload.progress.percent}%</span>
                                        </div>
                                        <div className="w-full h-2 bg-[var(--color-surface-muted)] overflow-hidden">
                                            <div
                                                className="h-full bg-[var(--color-accent)] transition-[width] duration-300"
                                                style={{ width: `${activeDownload.progress.percent}%` }}
                                            />
                                        </div>
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
