/**
 * ReaderSettings Component - Minimal Design
 * 
 * - Black & white only (no blue)
 * - Sepia theme for warmth
 * - Minimal theme selection
 * - Instant brightness for whole screen
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    X, Sun, Moon, Sunrise, Plus, Minus,
    Layers, ArrowUpDown,
    AlignLeft, AlignJustify, AlignCenter, Type,
    Palette, Maximize2, Zap, Settings2, ZoomIn
} from 'lucide-react';
import { READER_THEME_PREVIEWS } from "@/lib/design-tokens";
import { cn } from '@/lib/utils';
import { ReaderSettings as ReaderSettingsType, ReaderTheme, FontFamily, BookFormat } from '@/types';
import { isFixedLayout } from '@/types';
import { Backdrop, FloatingPanel } from '@/components/ui';

interface ReaderSettingsProps {
    settings: ReaderSettingsType;
    visible: boolean;
    onClose: () => void;
    onUpdate: (updates: Partial<ReaderSettingsType>) => void;
    format?: BookFormat;
    className?: string;
}

type TabId = 'themes' | 'typography' | 'zoom' | 'layout';

const THEMES: Array<{ id: ReaderTheme; label: string; icon: React.ReactNode; previewBg: string; previewFg: string }> = [
    { id: "light", label: "Light", icon: <Sun className="w-5 h-5" />, previewBg: READER_THEME_PREVIEWS.light.bg, previewFg: READER_THEME_PREVIEWS.light.fg },
    { id: "sepia", label: "Sepia", icon: <Sunrise className="w-5 h-5" />, previewBg: READER_THEME_PREVIEWS.sepia.bg, previewFg: READER_THEME_PREVIEWS.sepia.fg },
    { id: "dark", label: "Dark", icon: <Moon className="w-5 h-5" />, previewBg: READER_THEME_PREVIEWS.dark.bg, previewFg: READER_THEME_PREVIEWS.dark.fg },
];

const FONTS: Array<{ id: FontFamily; label: string; family: string }> = [
    { id: 'original', label: 'Original', family: 'inherit' },
    { id: 'serif', label: 'Serif', family: 'var(--font-merriweather), Georgia, serif' },
    { id: 'sans', label: 'Sans', family: 'var(--font-sans), system-ui, sans-serif' },
    { id: 'mono', label: 'Mono', family: 'var(--font-mono), monospace' },
];

const FLOW_OPTIONS = [
    { id: 'paged', label: 'Paged', icon: Layers },
    { id: 'scroll', label: 'Scroll', icon: ArrowUpDown },
] as const;

const ALIGN_OPTIONS = [
    { id: 'left', label: 'Left', icon: AlignLeft },
    { id: 'justify', label: 'Justify', icon: AlignJustify },
    { id: 'center', label: 'Center', icon: AlignCenter },
] as const;

function useSmoothSlider(
    initialValue: number,
    onChange: (value: number) => void,
    min: number,
    max: number,
    step: number = 1
) {
    const [localValue, setLocalValue] = useState(initialValue);
    const isDraggingRef = useRef(false);
    
    useEffect(() => {
        if (!isDraggingRef.current) {
            setLocalValue(initialValue);
        }
    }, [initialValue]);
    
    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const val = step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value);
        setLocalValue(val);
        onChange(val);
    }, [onChange, step]);
    
    const handleMouseDown = useCallback(() => {
        isDraggingRef.current = true;
    }, []);
    
    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false;
    }, []);
    
    const increment = useCallback(() => {
        const newVal = Math.min(max, localValue + step);
        setLocalValue(newVal);
        onChange(newVal);
    }, [localValue, max, step, onChange]);
    
    const decrement = useCallback(() => {
        const newVal = Math.max(min, localValue - step);
        setLocalValue(newVal);
        onChange(newVal);
    }, [localValue, min, step, onChange]);
    
    return { value: localValue, handleChange, handleMouseDown, handleMouseUp, increment, decrement };
}

export function ReaderSettings({
    settings,
    visible,
    onClose,
    onUpdate,
    format = 'epub',
    className,
}: ReaderSettingsProps) {
    const [activeTab, setActiveTab] = useState<TabId>('themes');
    const [showAdvancedType, setShowAdvancedType] = useState(false);
    
    // Determine if current format is fixed layout (CBZ/PDF, plus legacy CBR entries)
    const isFixed = isFixedLayout(format);
    const reflowZoomMin = settings.flow === "paged" ? 100 : 50;

    const brightnessSlider = useSmoothSlider(
        settings.brightness ?? 100,
        (v) => onUpdate({ brightness: v }),
        20, 100, 1
    );
    
    const fontSizeSlider = useSmoothSlider(
        settings.fontSize ?? 18,
        (v) => onUpdate({ fontSize: v }),
        12, 32, 1
    );
    
    const lineHeightSlider = useSmoothSlider(
        settings.lineHeight ?? 1.6,
        (v) => onUpdate({ lineHeight: v }),
        1.0, 2.2, 0.1
    );
    
    const zoomSlider = useSmoothSlider(
        settings.zoom ?? 100,
        (v) => onUpdate({ zoom: v }),
        isFixed ? 50 : reflowZoomMin,
        200,
        10,
    );

    const currentFontFamily = FONTS.find(f => f.id === settings.fontFamily)?.family;

    const handleReset = useCallback(() => {
        onUpdate({
            theme: 'light', fontFamily: 'original', fontSize: 18, lineHeight: 1.6,
            letterSpacing: 0, wordSpacing: 0, paragraphSpacing: 1, textAlign: 'left',
            hyphenation: false, margins: 10, zoom: 100, flow: 'paged', layout: 'auto',
            brightness: 100, forcePublisherStyles: false,
        });
    }, [onUpdate]);

    const tabs = [
        { id: 'themes' as TabId, label: 'Theme', icon: <Palette className="w-4 h-4" /> },
        isFixed 
            ? { id: 'zoom' as TabId, label: 'Zoom', icon: <Zap className="w-4 h-4" /> }
            : { id: 'typography' as TabId, label: 'Type', icon: <Type className="w-4 h-4" /> },
        { id: 'layout' as TabId, label: 'Layout', icon: <Maximize2 className="w-4 h-4" /> },
    ];

    // Common styles using semantic design tokens
    const textStyle = { color: 'var(--color-text-primary)' };
    const textMutedStyle = { color: 'var(--color-text-muted)' };
    const borderStyle = { borderColor: 'var(--color-border)' };
    const surfaceStyle = { backgroundColor: 'var(--color-surface-muted)' };

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={cn("overflow-hidden", className)}>
                {/* Header */}
                <div className="reader-panel-header flex items-center justify-between p-4" style={borderStyle}>
                    <div className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5" style={textStyle} />
                        <h2 className="text-base font-medium" style={textStyle}>Settings</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleReset}
                            className="reader-chip px-3 py-1.5 text-xs rounded-full transition-opacity hover:opacity-80"
                            style={textMutedStyle}
                        >
                            Reset
                        </button>
                        <button
                            onClick={onClose}
                            className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-opacity hover:opacity-80"
                            style={surfaceStyle}
                        >
                            <X className="w-5 h-5" style={textStyle} />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="reader-panel-header px-4 py-3" style={borderStyle}>
                    <div className="grid grid-cols-3 gap-2">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    'reader-chip w-full min-h-9 flex items-center justify-center gap-1.5 px-2 text-xs rounded-lg transition-colors duration-150',
                                    activeTab === tab.id ? 'opacity-100' : 'opacity-70 hover:opacity-100',
                                )}
                                data-active={activeTab === tab.id}
                            >
                                {tab.icon}
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Tab Content */}
                <div className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto">
                    {/* THEMES TAB */}
                    {activeTab === 'themes' && (
                        <div className="space-y-6">
                            {/* Brightness - Instant whole screen */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs" style={textMutedStyle}>Brightness</label>
                                    <span className="text-xs font-mono tabular-nums" style={textStyle}>{brightnessSlider.value}%</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Sun className="w-4 h-4 opacity-40" style={textStyle} />
                                    <input
                                        type="range" min="20" max="100"
                                        value={brightnessSlider.value}
                                        onChange={brightnessSlider.handleChange}
                                        onMouseDown={brightnessSlider.handleMouseDown}
                                        onMouseUp={brightnessSlider.handleMouseUp}
                                        className="flex-1 h-1 rounded-full"
                                        style={{ accentColor: 'var(--color-accent)' }}
                                    />
                                    <Sun className="w-5 h-5" style={textStyle} />
                                </div>
                            </div>

                            {/* Theme Presets */}
                            <div className="space-y-3">
                                <label className="text-xs" style={textMutedStyle}>Theme</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {THEMES.map((theme) => (
                                        <button
                                            key={theme.id}
                                            onClick={() => onUpdate({ theme: theme.id })}
                                            className="reader-chip rounded-2xl p-3 flex flex-col items-center gap-2 group transition-colors duration-150"
                                            data-active={settings.theme === theme.id}
                                        >
                                            <div
                                                className={cn(
                                                    'w-9 h-9 rounded-full flex items-center justify-center transition-opacity duration-150',
                                                    settings.theme === theme.id ? 'scale-105' : 'opacity-65 group-hover:opacity-90'
                                                )}
                                                style={{ backgroundColor: theme.previewBg, color: theme.previewFg }}
                                            >
                                                {theme.icon}
                                            </div>
                                            <span className={cn(
                                                "text-[var(--font-size-3xs)] uppercase tracking-wide",
                                                settings.theme === theme.id ? "opacity-100" : "opacity-70"
                                            )} style={textStyle}>
                                                {theme.label}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TYPOGRAPHY TAB */}
                    {activeTab === 'typography' && (
                        <div className="space-y-5">
                            {/* Font Family Dropdown */}
                            <div className="space-y-2">
                                <label className="text-xs" style={textMutedStyle}>Font</label>
                                
                                {/* Font Family Selection - Grid of buttons */}
                                <div className="grid grid-cols-2 gap-2">
                                    {FONTS.map((font) => (
                                        <button
                                            key={font.id}
                                            onClick={() => onUpdate({ fontFamily: font.id })}
                                            className={cn(
                                                'py-3 px-3 rounded-lg flex flex-col items-center gap-1.5 transition-colors duration-150 border text-left',
                                                settings.fontFamily === font.id
                                                    ? 'opacity-100'
                                                    : 'opacity-40 hover:opacity-70'
                                            )}
                                            style={{
                                                backgroundColor: settings.fontFamily === font.id
                                                    ? 'var(--color-accent-light)'
                                                    : 'transparent',
                                                borderColor: settings.fontFamily === font.id
                                                    ? 'color-mix(in srgb, var(--color-accent) 35%, var(--color-border))'
                                                    : 'var(--color-border)',
                                                color: settings.fontFamily === font.id
                                                    ? 'var(--color-accent)'
                                                    : 'var(--color-text-secondary)',
                                                fontFamily: font.family,
                                            }}
                                        >
                                            <span className="text-sm font-medium w-full">{font.label}</span>
                                            <span className="text-xs opacity-60 w-full truncate" style={{ fontFamily: font.family }}>
                                                Aa Bb Cc
                                            </span>
                                        </button>
                                    ))}
                                </div>
                                
                                {/* Font preview showing sample in selected font */}
                                <div
                                    className="p-3 text-center text-base rounded-lg border mt-3 transition-colors duration-150"
                                    style={{
                                        borderColor: 'var(--color-border)',
                                        fontFamily: currentFontFamily,
                                        color: 'var(--color-text-primary)',
                                        backgroundColor: 'var(--color-surface-muted)',
                                    }}
                                >
                                    The quick brown fox jumps over the lazy dog
                                </div>
                                
                                {/* Font family indicator */}
                                <div className="text-[var(--font-size-3xs)] text-center uppercase tracking-wider opacity-50" style={textStyle}>
                                    {settings.fontFamily === 'original' ? 'Book default' : settings.fontFamily}
                                </div>
                            </div>

                            {/* Font Size */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs" style={textMutedStyle}>Size</label>
                                    <span className="text-xs font-mono tabular-nums" style={textStyle}>{fontSizeSlider.value}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={fontSizeSlider.decrement} className="p-1.5 rounded-lg hover:opacity-60 transition-opacity" style={surfaceStyle}>
                                        <Minus className="w-4 h-4" style={textStyle} />
                                    </button>
                                    <input
                                        type="range" min="12" max="32"
                                        value={fontSizeSlider.value}
                                        onChange={fontSizeSlider.handleChange}
                                        className="flex-1 h-1 rounded-full"
                                        style={{ accentColor: 'var(--color-accent)' }}
                                    />
                                    <button onClick={fontSizeSlider.increment} className="p-1.5 rounded-lg hover:opacity-60 transition-opacity" style={surfaceStyle}>
                                        <Plus className="w-4 h-4" style={textStyle} />
                                    </button>
                                </div>
                            </div>

                            {/* More/Less Button - Same tab */}
                            <button 
                                onClick={() => setShowAdvancedType(!showAdvancedType)} 
                                className="w-full py-3 text-xs rounded-lg border transition-opacity hover:opacity-70 flex items-center justify-center gap-2"
                                style={{ ...borderStyle, color: 'var(--color-text-secondary)' }}
                            >
                                <span>{showAdvancedType ? 'Less options' : 'More options'}</span>
                                <svg 
                                    width="10" height="6" viewBox="0 0 10 6" fill="currentColor" 
                                    className={cn("transition-transform", showAdvancedType ? "rotate-180" : "")}
                                >
                                    <path d="M0 0h10L5 6z"/>
                                </svg>
                            </button>

                            {/* Advanced Options */}
                            {showAdvancedType && (
                                <div className="space-y-4 pt-2 border-t animate-fade-in" style={borderStyle}>
                                    {/* Line Height */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs" style={textMutedStyle}>Line spacing</label>
                                            <span className="text-xs font-mono" style={textMutedStyle}>{lineHeightSlider.value.toFixed(1)}</span>
                                        </div>
                                        <input
                                            type="range" min="1.0" max="2.2" step="0.1"
                                            value={lineHeightSlider.value}
                                            onChange={lineHeightSlider.handleChange}
                                            className="w-full h-1 rounded-full"
                                            style={{ accentColor: 'var(--color-accent)' }}
                                        />
                                    </div>

                                    {/* Text Alignment */}
                                    <div className="space-y-2">
                                        <label className="text-xs" style={textMutedStyle}>Alignment</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {ALIGN_OPTIONS.map(({ id, label, icon: Icon }) => (
                                                <button
                                                    key={id}
                                                    onClick={() => onUpdate({ textAlign: id })}
                                                    className={cn(
                                                        'py-2.5 rounded-lg flex flex-col items-center gap-1.5 transition-colors duration-150 border',
                                                        settings.textAlign === id 
                                                            ? 'opacity-100' 
                                                            : 'opacity-40 hover:opacity-70'
                                                    )}
                                                    style={{ 
                                                        backgroundColor: settings.textAlign === id 
                                                            ? 'var(--color-accent-light)' 
                                                            : 'transparent',
                                                        borderColor: settings.textAlign === id
                                                            ? 'color-mix(in srgb, var(--color-accent) 35%, var(--color-border))'
                                                            : 'var(--color-border)',
                                                        color: settings.textAlign === id
                                                            ? 'var(--color-accent)'
                                                            : 'var(--color-text-secondary)',
                                                    }}
                                                >
                                                    <Icon className="w-4 h-4" />
                                                    <span className="text-[var(--font-size-3xs)]">{label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ZOOM TAB - For fixed layouts (CBZ/PDF, plus legacy CBR entries) */}
                    {activeTab === 'zoom' && (
                        <div className="space-y-5">
                            {/* Zoom Level */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <ZoomIn className="w-4 h-4 opacity-50" style={textStyle} />
                                        <label className="text-xs" style={textMutedStyle}>Zoom Level</label>
                                    </div>
                                    <span className="text-xs font-mono tabular-nums" style={textStyle}>{zoomSlider.value}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={zoomSlider.decrement} className="p-1.5 rounded-lg hover:opacity-60 transition-opacity" style={surfaceStyle}>
                                        <Minus className="w-4 h-4" style={textStyle} />
                                    </button>
                                    <input
                                        type="range" min="50" max="300" step="10"
                                        value={zoomSlider.value}
                                        onChange={zoomSlider.handleChange}
                                        className="flex-1 h-1 rounded-full"
                                        style={{ accentColor: 'var(--color-accent)' }}
                                    />
                                    <button onClick={zoomSlider.increment} className="p-1.5 rounded-lg hover:opacity-60 transition-opacity" style={surfaceStyle}>
                                        <Plus className="w-4 h-4" style={textStyle} />
                                    </button>
                                </div>
                            </div>

                            {/* Quick Zoom Presets */}
                            <div className="space-y-2">
                                <label className="text-xs" style={textMutedStyle}>Presets</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { id: 'fit-width', label: 'Fit Width', value: 100 },
                                        { id: 'fit-page', label: 'Fit Page', value: 100 },
                                        { id: 'actual', label: '100%', value: 100 },
                                        { id: '125', label: '125%', value: 125 },
                                        { id: '150', label: '150%', value: 150 },
                                        { id: '200', label: '200%', value: 200 },
                                    ].map((preset) => (
                                        <button
                                            key={preset.id}
                                            onClick={() => onUpdate({ zoom: preset.value })}
                                            className={cn(
                                                'py-2 rounded-lg text-xs transition-colors duration-150 border',
                                                settings.zoom === preset.value
                                                    ? 'opacity-100'
                                                    : 'opacity-40 hover:opacity-70'
                                            )}
                                            style={{
                                                backgroundColor: settings.zoom === preset.value
                                                    ? 'var(--color-accent-light)'
                                                    : 'transparent',
                                                borderColor: settings.zoom === preset.value
                                                    ? 'color-mix(in srgb, var(--color-accent) 35%, var(--color-border))'
                                                    : 'var(--color-border)',
                                                color: settings.zoom === preset.value
                                                    ? 'var(--color-accent)'
                                                    : 'var(--color-text-secondary)',
                                            }}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Note about fixed layout */}
                            <div className="p-3 rounded-lg text-xs" style={surfaceStyle}>
                                <p style={textMutedStyle}>
                                    This document has a fixed layout. Zoom controls replace text size options for comics.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* LAYOUT TAB */}
                    {activeTab === 'layout' && (
                        <div className="space-y-5">
                            <div className="space-y-3">
                                <label className="text-xs" style={textMutedStyle}>Mode</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {FLOW_OPTIONS.map(({ id, label, icon: Icon }) => (
                                        <button
                                            key={id}
                                            onClick={() => onUpdate({ flow: id })}
                                            className={cn(
                                                'py-3 rounded-lg flex flex-col items-center gap-2 transition-colors duration-150 border',
                                                settings.flow === id ? 'opacity-100' : 'opacity-40 hover:opacity-70'
                                            )}
                                            style={{ 
                                                backgroundColor: settings.flow === id 
                                                    ? 'var(--color-accent-light)' 
                                                    : 'transparent',
                                                borderColor: settings.flow === id
                                                    ? 'color-mix(in srgb, var(--color-accent) 35%, var(--color-border))'
                                                    : 'var(--color-border)',
                                                color: settings.flow === id
                                                    ? 'var(--color-accent)'
                                                    : 'var(--color-text-secondary)',
                                            }}
                                        >
                                            <Icon className="w-5 h-5" />
                                            <span className="text-xs">{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Zap className="w-4 h-4 opacity-50" style={textStyle} />
                                        <label className="text-xs" style={textMutedStyle}>Zoom</label>
                                    </div>
                                    <span className="text-xs font-mono" style={textStyle}>{zoomSlider.value}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={zoomSlider.decrement} className="p-1.5 rounded-lg hover:opacity-60 transition-opacity" style={surfaceStyle}>
                                        <Minus className="w-4 h-4" style={textStyle} />
                                    </button>
                                    <input
                                        type="range"
                                        min={reflowZoomMin}
                                        max="200"
                                        step="10"
                                        value={zoomSlider.value}
                                        onChange={zoomSlider.handleChange}
                                        className="flex-1 h-1 rounded-full"
                                        style={{ accentColor: 'var(--color-accent)' }}
                                    />
                                    <button onClick={zoomSlider.increment} className="p-1.5 rounded-lg hover:opacity-60 transition-opacity" style={surfaceStyle}>
                                        <Plus className="w-4 h-4" style={textStyle} />
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
