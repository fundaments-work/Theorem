/**
 * ReaderSettings Component
 *
 * Unified visual language with app-wide primitives.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
    X,
    Sun,
    Moon,
    Sunrise,
    Plus,
    Minus,
    Layers,
    ArrowUpDown,
    AlignLeft,
    AlignJustify,
    AlignCenter,
    Type,
    Palette,
    Maximize2,
    Zap,
    Settings2,
    ZoomIn,
} from "lucide-react";
import {
    cn,
    isFixedLayout,
    READER_THEME_PREVIEWS,
    UI_BUTTON_BASE_CLASS,
    UI_CHIP_BUTTON_BASE_CLASS,
    UI_ICON_BUTTON_BASE_CLASS,
    UI_TAB_BUTTON_BASE_CLASS,
    type BookFormat,
    type FontFamily,
    type ReaderSettings as ReaderSettingsType,
    type ReaderTheme,
} from "@theorem/core";
import { Backdrop, FloatingPanel } from "@theorem/ui";

interface ReaderSettingsProps {
    settings: ReaderSettingsType;
    visible: boolean;
    onClose: () => void;
    onUpdate: (updates: Partial<ReaderSettingsType>) => void;
    format?: BookFormat;
    className?: string;
}

type TabId = "themes" | "typography" | "zoom" | "layout";

const THEMES: Array<{
    id: ReaderTheme;
    label: string;
    icon: React.ReactNode;
    previewBg: string;
    previewFg: string;
}> = [
    {
        id: "light",
        label: "Light",
        icon: <Sun className="w-5 h-5" />,
        previewBg: READER_THEME_PREVIEWS.light.bg,
        previewFg: READER_THEME_PREVIEWS.light.fg,
    },
    {
        id: "sepia",
        label: "Sepia",
        icon: <Sunrise className="w-5 h-5" />,
        previewBg: READER_THEME_PREVIEWS.sepia.bg,
        previewFg: READER_THEME_PREVIEWS.sepia.fg,
    },
    {
        id: "dark",
        label: "Dark",
        icon: <Moon className="w-5 h-5" />,
        previewBg: READER_THEME_PREVIEWS.dark.bg,
        previewFg: READER_THEME_PREVIEWS.dark.fg,
    },
];

const FONTS: Array<{ id: FontFamily; label: string; family: string }> = [
    { id: "original", label: "Original", family: "inherit" },
    { id: "serif", label: "Serif", family: 'var(--font-merriweather), Georgia, serif' },
    { id: "sans", label: "Sans", family: 'var(--font-sans), system-ui, sans-serif' },
    { id: "mono", label: "Mono", family: 'var(--font-mono), monospace' },
];

const FLOW_OPTIONS = [
    { id: "paged", label: "Paged", icon: Layers },
    { id: "scroll", label: "Scroll", icon: ArrowUpDown },
] as const;

const ALIGN_OPTIONS = [
    { id: "left", label: "Left", icon: AlignLeft },
    { id: "justify", label: "Justify", icon: AlignJustify },
    { id: "center", label: "Center", icon: AlignCenter },
] as const;

const SECONDARY_BUTTON_CLASS = UI_BUTTON_BASE_CLASS;
const TAB_BUTTON_CLASS = UI_TAB_BUTTON_BASE_CLASS;
const CHIP_CONTROL_CLASS = UI_CHIP_BUTTON_BASE_CLASS;
const ICON_CONTROL_BUTTON_CLASS = UI_ICON_BUTTON_BASE_CLASS;

function useSmoothSlider(
    initialValue: number,
    onChange: (value: number) => void,
    min: number,
    max: number,
    step: number = 1,
) {
    const [localValue, setLocalValue] = useState(initialValue);
    const isDraggingRef = useRef(false);

    useEffect(() => {
        if (!isDraggingRef.current) {
            setLocalValue(initialValue);
        }
    }, [initialValue]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = step < 1 ? Number.parseFloat(e.target.value) : Number.parseInt(e.target.value, 10);
        const clamped = Math.max(min, Math.min(max, value));
        setLocalValue(clamped);
        onChange(clamped);
    }, [max, min, onChange, step]);

    const handleMouseDown = useCallback(() => {
        isDraggingRef.current = true;
    }, []);

    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false;
    }, []);

    const increment = useCallback(() => {
        const next = Math.min(max, localValue + step);
        setLocalValue(next);
        onChange(next);
    }, [localValue, max, step, onChange]);

    const decrement = useCallback(() => {
        const next = Math.max(min, localValue - step);
        setLocalValue(next);
        onChange(next);
    }, [localValue, min, step, onChange]);

    const epsilon = Math.max(0.0001, step / 1000);
    const canDecrement = localValue > min + epsilon;
    const canIncrement = localValue < max - epsilon;

    return {
        value: localValue,
        min,
        max,
        step,
        handleChange,
        handleMouseDown,
        handleMouseUp,
        increment,
        decrement,
        canDecrement,
        canIncrement,
    };
}

function sectionLabel(label: string) {
    return <label className="text-xs font-medium leading-snug text-[color:var(--color-text-muted)]">{label}</label>;
}

function panelToggleClass(disabled = false) {
    return cn(CHIP_CONTROL_CLASS, disabled && "pointer-events-none");
}

export function ReaderSettings({
    settings,
    visible,
    onClose,
    onUpdate,
    format = "epub",
    className,
}: ReaderSettingsProps) {
    const [activeTab, setActiveTab] = useState<TabId>("themes");
    const [showAdvancedType, setShowAdvancedType] = useState(false);

    const isFixed = isFixedLayout(format);
    const reflowZoomMin = settings.flow === "paged" ? 100 : 50;

    const brightnessSlider = useSmoothSlider(
        settings.brightness ?? 100,
        (value) => onUpdate({ brightness: value }),
        20,
        100,
        1,
    );

    const fontSizeSlider = useSmoothSlider(
        settings.fontSize ?? 18,
        (value) => onUpdate({ fontSize: value }),
        12,
        32,
        1,
    );

    const lineHeightSlider = useSmoothSlider(
        settings.lineHeight ?? 1.6,
        (value) => onUpdate({ lineHeight: value }),
        1.0,
        2.2,
        0.1,
    );

    const zoomSlider = useSmoothSlider(
        settings.zoom ?? 100,
        (value) => onUpdate({ zoom: value }),
        isFixed ? 50 : reflowZoomMin,
        200,
        10,
    );

    const currentFontFamily = FONTS.find((font) => font.id === settings.fontFamily)?.family;

    const handleReset = useCallback(() => {
        onUpdate({
            theme: "light",
            fontFamily: "original",
            fontSize: 18,
            lineHeight: 1.6,
            letterSpacing: 0,
            wordSpacing: 0,
            paragraphSpacing: 1,
            textAlign: "left",
            hyphenation: false,
            margins: 10,
            zoom: 100,
            flow: "paged",
            layout: "auto",
            brightness: 100,
            forcePublisherStyles: false,
        });
    }, [onUpdate]);

    const tabs = [
        { id: "themes" as TabId, label: "Theme", icon: <Palette className="w-4 h-4" /> },
        isFixed
            ? { id: "zoom" as TabId, label: "Zoom", icon: <Zap className="w-4 h-4" /> }
            : { id: "typography" as TabId, label: "Type", icon: <Type className="w-4 h-4" /> },
        { id: "layout" as TabId, label: "Layout", icon: <Maximize2 className="w-4 h-4" /> },
    ];

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={cn("overflow-hidden bg-[var(--color-surface)]", className)}>
                <div className="reader-panel-header flex items-center justify-between border-b border-[var(--color-border)] p-4">
                    <div className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-[color:var(--color-text-primary)]" />
                        <h2 className="text-base font-medium text-[color:var(--color-text-primary)]">Settings</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleReset}
                            className={cn(SECONDARY_BUTTON_CLASS, "min-h-8 px-3 py-1 text-xs")}
                        >
                            Reset
                        </button>
                        <button
                            onClick={onClose}
                            className={ICON_CONTROL_BUTTON_CLASS}
                            aria-label="Close settings"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="reader-panel-header border-b border-[var(--color-border)] px-4 py-3">
                    <div className="grid grid-cols-3 gap-2">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={TAB_BUTTON_CLASS}
                                data-active={activeTab === tab.id}
                                aria-pressed={activeTab === tab.id}
                            >
                                <span className="inline-flex items-center justify-center gap-1.5">
                                    {tab.icon}
                                    <span>{tab.label}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-5">
                    {activeTab === "themes" && (
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    {sectionLabel("Brightness")}
                                    <span className="[font-variant-numeric:tabular-nums] text-xs text-[color:var(--color-text-primary)]">
                                        {brightnessSlider.value}%
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={brightnessSlider.decrement}
                                        className={ICON_CONTROL_BUTTON_CLASS}
                                        aria-label="Decrease brightness"
                                        disabled={!brightnessSlider.canDecrement}
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                    <input
                                        type="range"
                                        min={brightnessSlider.min}
                                        max={brightnessSlider.max}
                                        step={brightnessSlider.step}
                                        value={brightnessSlider.value}
                                        onChange={brightnessSlider.handleChange}
                                        onMouseDown={brightnessSlider.handleMouseDown}
                                        onMouseUp={brightnessSlider.handleMouseUp}
                                        className="flex-1"
                                        style={{ accentColor: "var(--color-accent)" }}
                                    />
                                    <button
                                        onClick={brightnessSlider.increment}
                                        className={ICON_CONTROL_BUTTON_CLASS}
                                        aria-label="Increase brightness"
                                        disabled={!brightnessSlider.canIncrement}
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-3">
                                {sectionLabel("Theme")}
                                <div className="grid grid-cols-3 gap-2">
                                    {THEMES.map((theme) => {
                                        const active = settings.theme === theme.id;
                                        return (
                                            <button
                                                key={theme.id}
                                                onClick={() => onUpdate({ theme: theme.id })}
                                                className={cn(CHIP_CONTROL_CLASS, "p-3 text-center")}
                                                data-active={active}
                                                aria-pressed={active}
                                            >
                                                <span className="mx-auto mb-2 inline-flex h-9 w-9 items-center justify-center border border-[var(--color-border)]" style={{ backgroundColor: theme.previewBg, color: theme.previewFg }}>
                                                    {theme.icon}
                                                </span>
                                                <span className="block text-[10px] font-medium tracking-wide">{theme.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === "typography" && (
                        <div className="space-y-5">
                            <div className="space-y-2">
                                {sectionLabel("Font")}
                                <div className="grid grid-cols-2 gap-2">
                                    {FONTS.map((font) => {
                                        const active = settings.fontFamily === font.id;
                                        return (
                                            <button
                                                key={font.id}
                                                onClick={() => onUpdate({ fontFamily: font.id })}
                                                className={cn(CHIP_CONTROL_CLASS, "px-3 py-2.5 text-left")}
                                                data-active={active}
                                                aria-pressed={active}
                                                style={{ fontFamily: font.family }}
                                            >
                                                <span className="block text-sm font-medium">{font.label}</span>
                                                <span className="mt-1 block text-xs opacity-80">Aa Bb Cc</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="mt-3 border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] p-3 text-center text-base text-[color:var(--color-text-primary)]" style={{ fontFamily: currentFontFamily }}>
                                    The quick brown fox jumps over the lazy dog
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    {sectionLabel("Size")}
                                    <span className="[font-variant-numeric:tabular-nums] text-xs text-[color:var(--color-text-primary)]">{fontSizeSlider.value}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={fontSizeSlider.decrement}
                                        className={ICON_CONTROL_BUTTON_CLASS}
                                        aria-label="Decrease font size"
                                        disabled={!fontSizeSlider.canDecrement}
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                    <input
                                        type="range"
                                        min={fontSizeSlider.min}
                                        max={fontSizeSlider.max}
                                        step={fontSizeSlider.step}
                                        value={fontSizeSlider.value}
                                        onChange={fontSizeSlider.handleChange}
                                        onMouseDown={fontSizeSlider.handleMouseDown}
                                        onMouseUp={fontSizeSlider.handleMouseUp}
                                        className="flex-1"
                                        style={{ accentColor: "var(--color-accent)" }}
                                    />
                                    <button
                                        onClick={fontSizeSlider.increment}
                                        className={ICON_CONTROL_BUTTON_CLASS}
                                        aria-label="Increase font size"
                                        disabled={!fontSizeSlider.canIncrement}
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <button
                                onClick={() => setShowAdvancedType((prev) => !prev)}
                                className={cn(SECONDARY_BUTTON_CLASS, "w-full py-2 text-xs")}
                            >
                                {showAdvancedType ? "Less options" : "More options"}
                            </button>

                            {showAdvancedType && (
                                <div className="animate-fade-in space-y-4 border-t border-[var(--color-border)] pt-4">
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            {sectionLabel("Line spacing")}
                                            <span className="[font-variant-numeric:tabular-nums] text-xs text-[color:var(--color-text-primary)]">{lineHeightSlider.value.toFixed(1)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={lineHeightSlider.min}
                                            max={lineHeightSlider.max}
                                            step={lineHeightSlider.step}
                                            value={lineHeightSlider.value}
                                            onChange={lineHeightSlider.handleChange}
                                            onMouseDown={lineHeightSlider.handleMouseDown}
                                            onMouseUp={lineHeightSlider.handleMouseUp}
                                            className="w-full"
                                            style={{ accentColor: "var(--color-accent)" }}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        {sectionLabel("Alignment")}
                                        <div className="grid grid-cols-3 gap-2">
                                            {ALIGN_OPTIONS.map(({ id, label, icon: Icon }) => (
                                                <button
                                                    key={id}
                                                    onClick={() => onUpdate({ textAlign: id })}
                                                    className={panelToggleClass()}
                                                    data-active={settings.textAlign === id}
                                                    aria-pressed={settings.textAlign === id}
                                                >
                                                    <span className="flex flex-col items-center gap-1">
                                                        <Icon className="w-4 h-4" />
                                                        <span className="text-[10px] font-medium">{label}</span>
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === "zoom" && (
                        <div className="space-y-5">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-[color:var(--color-text-muted)]">
                                        <ZoomIn className="w-4 h-4" />
                                        Zoom level
                                    </span>
                                    <span className="[font-variant-numeric:tabular-nums] text-xs text-[color:var(--color-text-primary)]">{zoomSlider.value}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={zoomSlider.decrement}
                                        className={ICON_CONTROL_BUTTON_CLASS}
                                        aria-label="Decrease zoom"
                                        disabled={!zoomSlider.canDecrement}
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                    <input
                                        type="range"
                                        min={zoomSlider.min}
                                        max={zoomSlider.max}
                                        step={zoomSlider.step}
                                        value={zoomSlider.value}
                                        onChange={zoomSlider.handleChange}
                                        onMouseDown={zoomSlider.handleMouseDown}
                                        onMouseUp={zoomSlider.handleMouseUp}
                                        className="flex-1"
                                        style={{ accentColor: "var(--color-accent)" }}
                                    />
                                    <button
                                        onClick={zoomSlider.increment}
                                        className={ICON_CONTROL_BUTTON_CLASS}
                                        aria-label="Increase zoom"
                                        disabled={!zoomSlider.canIncrement}
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {sectionLabel("Presets")}
                                <div className="grid grid-cols-2 gap-2">
                                    {[
                                        { id: "actual", label: "100%", value: 100 },
                                        { id: "125", label: "125%", value: 125 },
                                        { id: "150", label: "150%", value: 150 },
                                        { id: "200", label: "200%", value: 200 },
                                    ].map((preset) => (
                                        <button
                                            key={preset.id}
                                            onClick={() => onUpdate({ zoom: preset.value })}
                                            className={panelToggleClass()}
                                            data-active={settings.zoom === preset.value}
                                            aria-pressed={settings.zoom === preset.value}
                                        >
                                            <span className="text-xs font-medium">{preset.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="border border-[var(--color-border-subtle)] bg-[var(--color-surface-muted)] p-3 text-xs text-[color:var(--color-text-secondary)]">
                                This document has a fixed layout. Zoom controls replace text-size options.
                            </div>
                        </div>
                    )}

                    {activeTab === "layout" && (
                        <div className="space-y-5">
                            <div className="space-y-3">
                                {sectionLabel("Mode")}
                                <div className="grid grid-cols-2 gap-2">
                                    {FLOW_OPTIONS.map(({ id, label, icon: Icon }) => {
                                        const disabled = isFixed && id === "scroll";
                                        const active = !disabled && settings.flow === id;

                                        return (
                                            <button
                                                key={id}
                                                onClick={() => onUpdate({ flow: id })}
                                                className={panelToggleClass(disabled)}
                                                data-active={active}
                                                aria-pressed={active}
                                                disabled={disabled}
                                            >
                                                <span className="flex flex-col items-center gap-2">
                                                    <Icon className="w-5 h-5" />
                                                    <span className="text-xs font-medium">{label}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="inline-flex items-center gap-2 text-xs font-medium tracking-wide text-[color:var(--color-text-muted)]">
                                        <Zap className="w-4 h-4" />
                                        Zoom
                                    </span>
                                    <span className="[font-variant-numeric:tabular-nums] text-xs text-[color:var(--color-text-primary)]">{zoomSlider.value}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={zoomSlider.decrement}
                                        className={ICON_CONTROL_BUTTON_CLASS}
                                        aria-label="Decrease zoom"
                                        disabled={!zoomSlider.canDecrement}
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                    <input
                                        type="range"
                                        min={zoomSlider.min}
                                        max={zoomSlider.max}
                                        step={zoomSlider.step}
                                        value={zoomSlider.value}
                                        onChange={zoomSlider.handleChange}
                                        onMouseDown={zoomSlider.handleMouseDown}
                                        onMouseUp={zoomSlider.handleMouseUp}
                                        className="flex-1"
                                        style={{ accentColor: "var(--color-accent)" }}
                                    />
                                    <button
                                        onClick={zoomSlider.increment}
                                        className={ICON_CONTROL_BUTTON_CLASS}
                                        aria-label="Increase zoom"
                                        disabled={!zoomSlider.canIncrement}
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </FloatingPanel>
        </>
    );
}

export default ReaderSettings;
