import { Maximize2, RotateCw, SlidersHorizontal, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn, type PdfZoomMode } from "../../../core";
import { Backdrop, FloatingPanel } from "../../../ui";

interface PDFViewSettingsPanelProps {
    visible: boolean;
    zoom: number;
    zoomMode: PdfZoomMode;
    onClose: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onZoomReset: () => void;
    onFitPage?: () => void;
    onFitWidth?: () => void;
    onRotate: () => void;
    className?: string;
}

function formatZoomModeLabel(zoomMode: PdfZoomMode, zoom: number): string {
    if (zoomMode === "page-fit") {
        return "Fit Page";
    }
    if (zoomMode === "width-fit") {
        return "Fit Width";
    }
    return `${Math.round(zoom * 100)}%`;
}

export function PDFViewSettingsPanel({
    visible,
    zoom,
    zoomMode,
    onClose,
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onFitPage,
    onFitWidth,
    onRotate,
    className,
}: PDFViewSettingsPanelProps) {
    const zoomLabel = formatZoomModeLabel(zoomMode, zoom);

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} className="z-[145]" />

            <FloatingPanel
                visible={visible}
                className={cn("z-[160] overflow-hidden bg-[var(--color-surface)]", className)}
            >
                <div className="reader-panel-header flex items-center justify-between border-b border-[var(--color-border)] p-4">
                    <div className="flex items-center gap-2">
                        <SlidersHorizontal className="w-5 h-5 text-[color:var(--color-text-primary)]" />
                        <h2 className="text-base font-medium text-[color:var(--color-text-primary)]">View Settings</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="ui-icon-btn"
                        aria-label="Close view settings"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5 space-y-5">
                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-[color:var(--color-text-muted)]">Zoom</p>
                            <span className="text-xs text-[color:var(--color-text-secondary)]">{zoomLabel}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <button
                                onClick={onZoomOut}
                                className="ui-chip-btn"
                                title="Zoom out"
                            >
                                <span className="inline-flex items-center justify-center gap-1.5">
                                    <ZoomOut className="w-4 h-4" />
                                    <span>Out</span>
                                </span>
                            </button>
                            <button
                                onClick={onZoomReset}
                                className="ui-chip-btn"
                                title="Reset zoom"
                            >
                                {zoomLabel}
                            </button>
                            <button
                                onClick={onZoomIn}
                                className="ui-chip-btn"
                                title="Zoom in"
                            >
                                <span className="inline-flex items-center justify-center gap-1.5">
                                    <ZoomIn className="w-4 h-4" />
                                    <span>In</span>
                                </span>
                            </button>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <p className="text-xs font-medium text-[color:var(--color-text-muted)]">Fit</p>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                onClick={onFitPage}
                                className="ui-chip-btn"
                                data-active={zoomMode === "page-fit"}
                            >
                                <span className="inline-flex items-center justify-center gap-1.5">
                                    <Maximize2 className="w-4 h-4" />
                                    <span>Fit Page</span>
                                </span>
                            </button>
                            <button
                                onClick={onFitWidth}
                                className="ui-chip-btn"
                                data-active={zoomMode === "width-fit"}
                            >
                                <span className="inline-flex items-center justify-center gap-1.5">
                                    <Maximize2 className="w-4 h-4" />
                                    <span>Fit Width</span>
                                </span>
                            </button>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <p className="text-xs font-medium text-[color:var(--color-text-muted)]">Page</p>
                        <button
                            onClick={onRotate}
                            className="ui-chip-btn w-full"
                            title="Rotate clockwise"
                        >
                            <span className="inline-flex items-center justify-center gap-1.5">
                                <RotateCw className="w-4 h-4" />
                                <span>Rotate Clockwise</span>
                            </span>
                        </button>
                    </section>
                </div>
            </FloatingPanel>
        </>
    );
}

export default PDFViewSettingsPanel;
