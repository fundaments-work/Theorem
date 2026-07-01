import { useState, useCallback, useEffect } from "react";
import {
    generateShareStatsImage,
    downloadImage,
    shareImageNative,
    buildImageFilename,
} from "../../core";
import type { ShareStatsData } from "../../core/lib/share-canvas";
import type { ShareImageOptions } from "../../core/lib/share-canvas";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "../../ui";
import { Download, Share2, CheckCircle, AlertCircle } from "lucide-react";

interface ShareStatsStudioModalProps {
    statsData: ShareStatsData;
    onClose: () => void;
}

export function ShareStatsStudioModal({ statsData, onClose }: ShareStatsStudioModalProps) {
    const [format, setFormat] = useState<ShareImageOptions["format"]>("square");
    const [theme, setTheme] = useState<ShareImageOptions["theme"]>("match");
    const [imageBlob, setImageBlob] = useState<Blob | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

    useEffect(() => {
        let isMounted = true;
        
        async function updatePreview() {
            setIsGenerating(true);
            try {
                await document.fonts.ready;
                const blob = await generateShareStatsImage(statsData, {
                    format,
                    theme,
                    showNote: false
                });
                
                if (isMounted) {
                    setImageBlob(blob);
                    const url = URL.createObjectURL(blob);
                    setPreviewUrl((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return url;
                    });
                }
            } catch (err) {
                if (isMounted) {
                    setToast({ type: "error", message: "Image generation failed" });
                }
            } finally {
                if (isMounted) {
                    setIsGenerating(false);
                }
            }
        }
        
        updatePreview();
        
        return () => {
            isMounted = false;
        };
    }, [statsData, format, theme]);

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
        const filename = buildImageFilename("ReadingStats");
        const result = await downloadImage(imageBlob, filename);
        if (result.ok) {
            setToast({ type: "success", message: "Image saved" });
        } else if (result.reason !== "Cancelled") {
            setToast({ type: "error", message: result.reason });
        }
    }, [imageBlob]);

    const handleNativeShare = useCallback(async () => {
        if (imageBlob) {
            try {
                await shareImageNative(imageBlob, "ReadingStats");
                onClose();
            } catch (e) {
                setToast({ type: "error", message: "Share failed" });
            }
        }
    }, [imageBlob, onClose]);

    return (
        <Modal isOpen={true} onClose={onClose} size="xl">
            <ModalHeader title="Share Reading Stats" onClose={onClose} />
            <ModalBody className="flex flex-col md:flex-row gap-8">
                {/* Preview Area */}
                <div className="flex-1 flex items-center justify-center bg-[var(--color-surface-muted)] border border-[var(--color-border)] p-4 relative min-h-[300px]">
                    {isGenerating && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--color-surface)] bg-opacity-70">
                            <div className="animate-pulse font-sans text-sm text-[var(--color-text-secondary)]">Generating preview...</div>
                        </div>
                    )}
                    {previewUrl ? (
                        <img 
                            src={previewUrl} 
                            alt="Share Stats Preview" 
                            className="max-h-[50vh] object-contain shadow-md transition-all duration-300"
                        />
                    ) : (
                        <div className="w-full h-full bg-[var(--color-border-subtle)] animate-pulse" />
                    )}
                </div>
                
                {/* Controls Area */}
                <div className="w-full md:w-64 flex flex-col gap-6 shrink-0">
                    <div>
                        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-secondary)] mb-3">
                            Format
                        </h3>
                        <div className="flex flex-col gap-2">
                            <button 
                                onClick={() => setFormat('square')} 
                                className={`ui-btn w-full justify-start ${format === 'square' ? 'ui-btn-primary' : ''}`}
                            >
                                ⬛ Square (Feed)
                            </button>
                            <button 
                                onClick={() => setFormat('story')} 
                                className={`ui-btn w-full justify-start ${format === 'story' ? 'ui-btn-primary' : ''}`}
                            >
                                📱 Story (9:16)
                            </button>
                        </div>
                    </div>
                    
                    <div>
                        <h3 className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-secondary)] mb-3">
                            Theme
                        </h3>
                        <div className="flex flex-col gap-2">
                            <button 
                                onClick={() => setTheme('match')} 
                                className={`ui-btn w-full justify-start ${theme === 'match' ? 'ui-btn-primary' : ''}`}
                            >
                                🎨 Match App Theme
                            </button>
                            <button 
                                onClick={() => setTheme('dark')} 
                                className={`ui-btn w-full justify-start ${theme === 'dark' ? 'ui-btn-primary' : ''}`}
                            >
                                🌙 Dark Mode
                            </button>
                            <button 
                                onClick={() => setTheme('tinted')} 
                                className={`ui-btn w-full justify-start ${theme === 'tinted' ? 'ui-btn-primary' : ''}`}
                            >
                                ✨ Tinted Vibrant
                            </button>
                            <button 
                                onClick={() => setTheme('sepia')} 
                                className={`ui-btn w-full justify-start ${theme === 'sepia' ? 'ui-btn-primary' : ''}`}
                            >
                                📜 Classic Sepia
                            </button>
                        </div>
                    </div>
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
                <button className="ui-btn-ghost shrink-0" onClick={onClose}>
                    Cancel
                </button>
                <button 
                    className="ui-btn-primary" 
                    onClick={handleDownload} 
                    disabled={!imageBlob || isGenerating}
                >
                    <Download className="w-4 h-4" />
                    Download Image
                </button>
                {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                    <button 
                        className="ui-btn" 
                        onClick={handleNativeShare} 
                        disabled={!imageBlob || isGenerating}
                    >
                        <Share2 className="w-4 h-4" />
                        Share...
                    </button>
                )}
            </ModalFooter>
        </Modal>
    );
}
