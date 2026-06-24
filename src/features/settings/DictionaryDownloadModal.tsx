import { useRef, useState } from "react";
import { Download, Check, AlertCircle, X } from "lucide-react";
import { Modal, ModalHeader, ModalBody } from "../../ui";
import { cn, isTauri } from "../../core";
import { useVocabularyStore } from "../../core";
import { importStarDictFromBytes } from "../../core/services/StarDictService";

interface DictEntry {
    name: string;
    language: string;
    url: string;
    sizeApprox: string;
}

const AVAILABLE_DICTS: DictEntry[] = [
    { name: "English", language: "en", url: "https://github.com/sapienskid/wiktionary-stardict/releases/download/en-latest/dict-en-en.zip", sizeApprox: "~50 MB" },
];

async function downloadWithProgress(
    url: string,
    onProgress: (percent: number) => void,
    signal: AbortSignal,
): Promise<Uint8Array> {
    const { fetch } = await import("@tauri-apps/plugin-http");
    const response = await fetch(url, { signal });
    if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
    }
    const total = Number(response.headers.get("Content-Length") ?? 0);
    const reader = response.body!.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    let lastEmitted = -1;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) {
            const pct = Math.round((received / total) * 100);
            if (pct !== lastEmitted) {
                lastEmitted = pct;
                onProgress(pct);
            }
        }
    }

    const blob = new Blob(chunks as BlobPart[]);
    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
}

async function extractZip(buffer: Uint8Array): Promise<Record<string, Uint8Array>> {
    const { ZipReader, Uint8ArrayReader, Uint8ArrayWriter } = await import("@zip.js/zip.js");
    const reader = new ZipReader(new Uint8ArrayReader(buffer));
    const entries = await reader.getEntries();
    const result: Record<string, Uint8Array> = {};

    for (const entry of entries) {
        if (entry.directory) continue;
        const name = entry.filename.split("/").pop() || entry.filename;
        const data = await (entry as any).getData(new Uint8ArrayWriter());
        result[name] = data;
    }

    await reader.close();
    return result;
}

interface DictionaryDownloadModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function DictionaryDownloadModal({ isOpen, onClose }: DictionaryDownloadModalProps) {
    const [error, setError] = useState<string | null>(null);
    const [justInstalled, setJustInstalled] = useState<Set<string>>(new Set());
    const abortRef = useRef<AbortController | null>(null);
    const [stage, setStage] = useState<string | null>(null);
    const installedDicts = useVocabularyStore((s) => s.installedDictionaries);
    const activeDownload = useVocabularyStore((s) => s.activeDownload);
    const setActiveDownload = useVocabularyStore((s) => s.setActiveDownload);
    const addInstalledDictionary = useVocabularyStore((s) => s.addInstalledDictionary);

    const handleCancel = () => {
        abortRef.current?.abort();
        abortRef.current = null;
    };

    const handleDownload = async (dict: DictEntry) => {
        if (!isTauri()) {
            setError("Dictionary download requires the desktop or mobile app.");
            return;
        }

        const abort = new AbortController();
        abortRef.current = abort;
        setStage("Downloading");
        setActiveDownload({ dictName: dict.name, progress: { percent: 0, downloaded: 0, total: 0 } });
        setError(null);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        try {
            const buffer = await downloadWithProgress(dict.url, (percent) => {
                setActiveDownload({
                    dictName: dict.name,
                    progress: { percent, downloaded: 0, total: 0 },
                });
            }, abort.signal);

            setStage("Extracting");
            const files = await extractZip(buffer);
            const ifoKey = Object.keys(files).find((k) => k.endsWith(".ifo"));
            const idxKey = Object.keys(files).find((k) => k.endsWith(".idx"));
            const dictKey = Object.keys(files).find((k) => k.endsWith(".dict.dz") || k.endsWith(".dict"));
            const synKey = Object.keys(files).find((k) => k.endsWith(".syn"));

            if (!ifoKey || !idxKey || !dictKey) {
                throw new Error("Archive missing required dictionary files");
            }

            setStage("Installing");
            const installed = await importStarDictFromBytes(files[ifoKey], files[idxKey], files[dictKey], synKey ? files[synKey] : undefined);
            addInstalledDictionary(installed);
            setJustInstalled((prev) => new Set([...prev, dict.name]));
        } catch (err) {
            if ((err as any)?.name === "AbortError") return;
            const message = err instanceof Error ? err.message : (typeof err === "string" ? err : JSON.stringify(err));
            console.error("[DictionaryDownload]", message, err);
            setError(message || "Download failed");
        } finally {
            setStage(null);
            if (abortRef.current === abort) {
                abortRef.current = null;
            }
            setActiveDownload(null);
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
