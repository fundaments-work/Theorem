import { useState, useCallback, useEffect, useRef } from "react";
import { toPng } from "html-to-image";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "../../ui";
import { Download, Share2, CheckCircle, AlertCircle } from "lucide-react";
import { downloadImage, shareImageNative, buildImageFilename, shareOnX, buildShareText } from "../../core/lib/share";
import { ShareCard, type CardFormat, type CardTheme, type BookInfo, type StatsData } from "./ShareCard";
import type { Annotation } from "../../core/types";

interface AnnotationShareProps {
    kind: "annotation";
    annotation: Annotation;
    book: BookInfo | undefined;
}

interface StatsShareProps {
    kind: "stats";
    statsData: StatsData;
}

type ShareCardModalProps = (AnnotationShareProps | StatsShareProps) & {
    onClose: () => void;
};

export function ShareCardModal(props: ShareCardModalProps) {
    const { kind, onClose } = props;
    const annotation = kind === "annotation" ? (props as AnnotationShareProps).annotation : undefined;
    const book = kind === "annotation" ? (props as AnnotationShareProps).book : undefined;
    const statsData = kind === "stats" ? (props as StatsShareProps).statsData : undefined;

    const [format, setFormat] = useState<CardFormat>("square");
    const [theme, setTheme] = useState<CardTheme>("match");
    const [showNote, setShowNote] = useState(true);
    const [imageBlob, setImageBlob] = useState<Blob | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);

    const captureCard = useCallback(async () => {
        const el = cardRef.current;
        if (!el) return;
        setIsGenerating(true);
        try {
            await document.fonts.ready;
            const dataUrl = await toPng(el, {
                quality: 0.92,
                pixelRatio: 1,
                cacheBust: true,
            });
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            setImageBlob(blob);
            setPreviewUrl((prev) => {
                if (prev) URL.revokeObjectURL(prev);
                return dataUrl;
            });
        } catch {
            setToast({ type: "error", message: "Image generation failed" });
        } finally {
            setIsGenerating(false);
        }
    }, []);

    useEffect(() => {
        captureCard();
    }, [kind, format, theme, showNote, annotation, book, statsData, captureCard]);

    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, []);

    useEffect(() => {
        if (toast) {
            const t = setTimeout(() => setToast(null), 3000);
            return () => clearTimeout(t);
        }
    }, [toast]);

    const handleDownload = useCallback(async () => {
        if (!imageBlob) return;
        const filename = buildImageFilename(kind === "annotation" ? book?.title || "Highlight" : "ReadingStats");
        const result = await downloadImage(imageBlob, filename);
        if (result.ok) {
            setToast({ type: "success", message: "Image saved" });
        } else if (result.reason !== "Cancelled") {
            setToast({ type: "error", message: result.reason });
        }
    }, [imageBlob, book, kind]);

    const handleNativeShare = useCallback(async () => {
        if (!imageBlob) return;
        try {
            await shareImageNative(imageBlob, kind === "annotation" ? book?.title || "Highlight" : "ReadingStats");
            onClose();
        } catch {
            setToast({ type: "error", message: "Share failed" });
        }
    }, [imageBlob, book, kind, onClose]);

    const handleShareOnX = useCallback(() => {
        if (kind === "annotation" && annotation) {
            const text = buildShareText(annotation, book);
            shareOnX(text);
            onClose();
        }
    }, [kind, annotation, book, onClose]);

    const previewHeight = format === "story" ? 280 : 240;

    return (
        <Modal isOpen={true} onClose={onClose} size="xl">
            <ModalHeader title={kind === "annotation" ? "Share Highlight" : "Share Reading Stats"} onClose={onClose} />
            <ModalBody className="flex flex-col md:flex-row gap-8">
                <div className="flex-1 flex items-center justify-center bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-4 relative min-h-[260px]">
                    {isGenerating && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-surface)] bg-opacity-70">
                            <div className="animate-pulse font-sans text-sm text-[var(--color-text-secondary)]">Generating preview...</div>
                        </div>
                    )}
                    <div style={{ position: "absolute", left: -9999, top: 0 }} ref={cardRef}>
                        <ShareCard
                            kind={kind}
                            annotation={annotation}
                            book={book}
                            statsData={statsData}
                            format={format}
                            theme={theme}
                            showNote={kind === "annotation" ? showNote : false}
                        />
                    </div>
                    {previewUrl && !isGenerating ? (
                        <img
                            src={previewUrl}
                            alt="Share Preview"
                            style={{ maxHeight: previewHeight, objectFit: "contain" }}
                            className="shadow-md transition-colors duration-300"
                        />
                    ) : !isGenerating ? (
                        <div className="w-full h-full bg-[var(--color-border-subtle)] animate-pulse" />
                    ) : null}
                </div>

                <div className="w-full md:w-64 flex flex-col gap-6 shrink-0">
                    <div>
                        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-secondary)] mb-3">Format</h3>
                        <div className="flex flex-col gap-2">
                            {([["square", "Square (1:1)"], ["story", "Story (9:16)"]] as const).map(([val, label]) => (
                                <button key={val} onClick={() => setFormat(val)} className={`ui-btn w-full justify-start ${format === val ? "ui-btn-primary" : ""}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-secondary)] mb-3">Theme</h3>
                        <div className="flex flex-col gap-2">
                            {([["match", "App Theme"], ["dark", "Dark"], ["tinted", "Tinted"], ["sepia", "Sepia"]] as const).map(([val, label]) => (
                                <button key={val} onClick={() => setTheme(val)} className={`ui-btn w-full justify-start ${theme === val ? "ui-btn-primary" : ""}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                    {kind === "annotation" && annotation?.noteContent && (
                        <div>
                            <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-secondary)] mb-3">Options</h3>
                            <label className="flex items-center gap-2 cursor-pointer text-sm font-sans text-[color:var(--color-text-primary)]">
                                <input type="checkbox" checked={showNote} onChange={(e) => setShowNote(e.target.checked)} className="w-4 h-4 accent-[var(--color-accent)]" />
                                Include my note
                            </label>
                        </div>
                    )}
                </div>
            </ModalBody>
            <ModalFooter>
                {toast && (
                    <div className={`absolute bottom-full left-0 right-0 mb-2 flex items-center justify-center gap-1.5 text-xs py-2 rounded bg-[var(--color-surface)] border border-[var(--color-border)] shadow-lg ${toast.type === "success" ? "text-[var(--color-success,#22c55e)]" : "text-[var(--color-error)]"}`}>
                        {toast.type === "success" ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        {toast.message}
                    </div>
                )}
                <div className="flex-1" />
                {kind === "annotation" && (
                    <button className="ui-btn-ghost shrink-0" onClick={handleShareOnX} disabled={!imageBlob || isGenerating}>
                        <Share2 className="w-4 h-4" />
                        Share on X
                    </button>
                )}
                <button className="ui-btn-ghost shrink-0" onClick={onClose}>Cancel</button>
                <button className="ui-btn-primary" onClick={handleDownload} disabled={!imageBlob || isGenerating}>
                    <Download className="w-4 h-4" />
                    Download
                </button>
                {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                    <button className="ui-btn" onClick={handleNativeShare} disabled={!imageBlob || isGenerating}>
                        <Share2 className="w-4 h-4" />
                        Share...
                    </button>
                )}
            </ModalFooter>
        </Modal>
    );
}
