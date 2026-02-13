import type { ReactNode } from "react";
import { Minus, Moon, Plus, Sun, Sunrise, X } from "lucide-react";
import { cn, READER_THEME_PREVIEWS, type ReaderTheme } from "@theorem/core";
import { FloatingPanel } from "@theorem/ui";

interface ArticleReaderSettingsPanelProps {
    visible: boolean;
    fontSize: number;
    lineHeight: number;
    brightness: number;
    theme: ReaderTheme;
    onFontSizeChange: (value: number) => void;
    onLineHeightChange: (value: number) => void;
    onBrightnessChange: (value: number) => void;
    onThemeChange: (theme: ReaderTheme) => void;
    onClose: () => void;
}

const THEME_OPTIONS: Array<{ id: ReaderTheme; label: string; icon: ReactNode }> = [
    { id: "light", label: "Light", icon: <Sun className="w-5 h-5" /> },
    { id: "sepia", label: "Sepia", icon: <Sunrise className="w-5 h-5" /> },
    { id: "dark", label: "Dark", icon: <Moon className="w-5 h-5" /> },
];

export function ArticleReaderSettingsPanel({
    visible,
    fontSize,
    lineHeight,
    brightness,
    theme,
    onFontSizeChange,
    onLineHeightChange,
    onBrightnessChange,
    onThemeChange,
    onClose,
}: ArticleReaderSettingsPanelProps) {
    return (
        <FloatingPanel visible={visible} className="overflow-hidden">
            <div className="reader-panel-header px-4 pt-4 pb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">Reading Settings</h2>
                <button
                    onClick={onClose}
                    className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80"
                    title="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="p-4 sm:p-5 space-y-5 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                <div className="space-y-2">
                    <label className="text-xs text-[color:var(--color-text-muted)]">Theme</label>
                    <div className="grid grid-cols-3 gap-2">
                        {THEME_OPTIONS.map((option) => {
                            const preview = READER_THEME_PREVIEWS[option.id];
                            const isActive = theme === option.id;
                            return (
                                <button
                                    key={option.id}
                                    onClick={() => onThemeChange(option.id)}
                                    className="reader-chip rounded-2xl p-3 flex flex-col items-center gap-2 group transition-colors duration-150"
                                    data-active={isActive}
                                >
                                    <div
                                        className={cn(
                                            "w-9 h-9 rounded-full flex items-center justify-center transition-opacity duration-150",
                                            isActive ? "scale-105" : "opacity-65 group-hover:opacity-90",
                                        )}
                                        style={{ backgroundColor: preview.bg, color: preview.fg }}
                                    >
                                        {option.icon}
                                    </div>
                                    <span className={cn(
                                        "text-[var(--font-size-3xs)] uppercase tracking-wide",
                                        isActive ? "opacity-100" : "opacity-70",
                                    )}>
                                        {option.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-[color:var(--color-text-muted)]">Brightness</label>
                        <span className="text-xs font-mono tabular-nums">{brightness}%</span>
                    </div>
                    <input
                        type="range"
                        min="20"
                        max="100"
                        step="1"
                        value={brightness}
                        onChange={(event) => onBrightnessChange(Number(event.target.value))}
                        className="w-full h-1 rounded-full"
                        style={{ accentColor: "var(--color-accent)" }}
                    />
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-[color:var(--color-text-muted)]">Font size</label>
                        <span className="text-xs font-mono tabular-nums">{fontSize}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onFontSizeChange(Math.max(12, fontSize - 1))}
                            className="p-1.5 rounded-lg bg-[var(--color-surface-muted)] hover:opacity-65 transition-opacity"
                        >
                            <Minus className="w-4 h-4" />
                        </button>
                        <input
                            type="range"
                            min="12"
                            max="32"
                            step="1"
                            value={fontSize}
                            onChange={(event) => onFontSizeChange(Number(event.target.value))}
                            className="flex-1 h-1 rounded-full"
                            style={{ accentColor: "var(--color-accent)" }}
                        />
                        <button
                            onClick={() => onFontSizeChange(Math.min(32, fontSize + 1))}
                            className="p-1.5 rounded-lg bg-[var(--color-surface-muted)] hover:opacity-65 transition-opacity"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs text-[color:var(--color-text-muted)]">Line spacing</label>
                        <span className="text-xs font-mono tabular-nums">{lineHeight.toFixed(1)}</span>
                    </div>
                    <input
                        type="range"
                        min="1.2"
                        max="2.2"
                        step="0.1"
                        value={lineHeight}
                        onChange={(event) => onLineHeightChange(Number(event.target.value))}
                        className="w-full h-1 rounded-full"
                        style={{ accentColor: "var(--color-accent)" }}
                    />
                </div>
            </div>
        </FloatingPanel>
    );
}
