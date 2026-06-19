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
    {
        name: "English (GCIDE)",
        language: "en",
        url: "https://github.com/BoboTiG/ebook-reader-dict/raw/master/en/en-en-gcide.tar.bz2",
        sizeApprox: "~30 MB",
    },
    {
        name: "English (Wiktionary)",
        language: "en",
        url: "https://github.com/BoboTiG/ebook-reader-dict/raw/master/en/en-en-wiktionary.tar.bz2",
        sizeApprox: "~8 MB",
    },
    {
        name: "English (WordNet)",
        language: "en",
        url: "https://github.com/BoboTiG/ebook-reader-dict/raw/master/en/en-en-wordnet.tar.bz2",
        sizeApprox: "~4 MB",
    },
    {
        name: "Français (Littré)",
        language: "fr",
        url: "https://github.com/BoboTiG/ebook-reader-dict/raw/master/fr/fr-fr-littre.tar.bz2",
        sizeApprox: "~22 MB",
    },
    {
        name: "Español (DRAE)",
        language: "es",
        url: "https://github.com/BoboTiG/ebook-reader-dict/raw/master/es/es-es-drae.tar.bz2",
        sizeApprox: "~18 MB",
    },
    {
        name: "Deutsch (Wiktionary)",
        language: "de",
        url: "https://github.com/BoboTiG/ebook-reader-dict/raw/master/de/de-en-wiktionary.tar.bz2",
        sizeApprox: "~10 MB",
    },
];

async function importDictFromParts(parts: {
    ifo: string;
    idx: string;
    dict: string;
    syn?: string;
}): Promise<void> {
    const { importStarDictFromBytes } = await import("../../core/services/StarDictService");

    const b64ToBytes = (b64: string) =>
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    const ifoBytes = b64ToBytes(parts.ifo);
    const idxBytes = b64ToBytes(parts.idx);
    const dictBytes = b64ToBytes(parts.dict);
    const synBytes = parts.syn ? b64ToBytes(parts.syn) : undefined;

    const dict = await importStarDictFromBytes(ifoBytes, idxBytes, dictBytes, synBytes);
    useVocabularyStore.getState().addInstalledDictionary(dict);
}

interface DictionaryDownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImported: () => void;
}

export function DictionaryDownloadModal({ isOpen, onClose, onImported }: DictionaryDownloadModalProps) {
    const [downloading, setDownloading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [installed, setInstalled] = useState<Set<string>>(new Set());
    const installedDicts = useVocabularyStore((s) => s.installedDictionaries);

    const handleDownload = async (dict: DictEntry) => {
        if (!isTauri()) {
            setError("Dictionary download requires the desktop app. Use Import Files for local StarDict files.");
            return;
        }

        setDownloading(dict.name);
        setError(null);

        try {
            const { invoke } = await import("@tauri-apps/api/core");
            const parts = await invoke<{ ifo: string; idx: string; dict: string; syn?: string }>(
                "download_and_extract_stardict",
                { url: dict.url },
            );
            await importDictFromParts(parts);
            setInstalled((prev) => new Set([...prev, dict.name]));
            onImported();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed");
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
                    One-click download and install of free StarDict dictionaries for offline word lookup.
                </p>

                <div className="space-y-3">
                    {AVAILABLE_DICTS.map((dict) => {
                        const isInstalled = installed.has(dict.name)
                            || installedDicts.some((d) => d.language === dict.language);

                        return (
                            <div
                                key={dict.name}
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
                                        "px-3 py-1.5 text-[11px] font-medium shrink-0 border transition-colors",
                                        isInstalled
                                            ? "bg-[color:var(--color-success,#22c55e)] text-white border-transparent"
                                            : "border-[var(--color-border)] text-[color:var(--color-accent)] hover:bg-[var(--color-surface-muted)]",
                                        downloading !== null && "opacity-50 cursor-not-allowed",
                                    )}
                                >
                                    {downloading === dict.name ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
