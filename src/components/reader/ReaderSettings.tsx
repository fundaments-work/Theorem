/**
 * ReaderSettings Component
 * Popover panel for reading customization options
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    X, Sun, Moon, Sunrise, Type, ChevronDown, Plus, Minus,
    Layers, ArrowUpDown, PlayCircle, Square, BookOpen, Monitor,
    AlignLeft, AlignJustify, AlignCenter, Type as TypeIcon,
    WrapText, Palette, Maximize2, Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReaderSettings as ReaderSettingsType, ReaderTheme, FontFamily } from '@/types';
import { Backdrop, FloatingPanel } from '@/components/ui';

interface ReaderSettingsProps {
    settings: ReaderSettingsType;
    visible: boolean;
    onClose: () => void;
    onUpdate: (updates: Partial<ReaderSettingsType>) => void;
    className?: string;
}

const THEMES: Array<{ id: ReaderTheme; label: string; icon: React.ReactNode; bg: string; text: string }> = [
    { id: 'light', label: 'Light', icon: <Sun className="w-4 h-4" />, bg: '#FFFFFF', text: '#1A1A1A' },
    { id: 'sepia', label: 'Sepia', icon: <Sunrise className="w-4 h-4" />, bg: '#F4ECD8', text: '#5F4B32' },
    { id: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" />, bg: '#1A1A1A', text: '#E0E0E0' },
];

const FONTS: Array<{ id: FontFamily; label: string; family: string }> = [
    { id: 'original', label: 'Book Original', family: 'inherit' },
    { id: 'serif', label: 'Serif', family: 'var(--font-serif)' },
    { id: 'sans', label: 'Sans', family: 'var(--font-sans)' },
    { id: 'mono', label: 'Mono', family: 'var(--font-mono)' },
];

const FLOW_OPTIONS = [
    { id: 'paged', label: 'Paged', icon: Layers },
    { id: 'scroll', label: 'Scroll', icon: ArrowUpDown },
    { id: 'auto', label: 'Auto', icon: PlayCircle },
] as const;

const LAYOUT_OPTIONS = [
    { id: 'single', label: 'Single', icon: Square },
    { id: 'double', label: 'Double', icon: BookOpen },
    { id: 'auto', label: 'Auto', icon: Monitor },
] as const;

const ALIGN_OPTIONS = [
    { id: 'left', label: 'Left', icon: AlignLeft },
    { id: 'justify', label: 'Justify', icon: AlignJustify },
    { id: 'center', label: 'Center', icon: AlignCenter },
] as const;

export function ReaderSettings({
    settings,
    visible,
    onClose,
    onUpdate,
    className,
}: ReaderSettingsProps) {
    // Local state for sliders to prevent rapid updates while dragging
    const [localBrightness, setLocalBrightness] = useState(settings.brightness ?? 100);
    const [localFontSize, setLocalFontSize] = useState(settings.fontSize ?? 18);
    const [localLineHeight, setLocalLineHeight] = useState(settings.lineHeight ?? 1.6);
    const [localMargins, setLocalMargins] = useState(settings.margins ?? 20);
    const [localZoom, setLocalZoom] = useState(settings.zoom ?? 100);
    const [localWordSpacing, setLocalWordSpacing] = useState(settings.wordSpacing ?? 0);
    const [localLetterSpacing, setLocalLetterSpacing] = useState(settings.letterSpacing ?? 0);

    // Sync local state when settings change externally
    useEffect(() => {
        setLocalBrightness(settings.brightness ?? 100);
        setLocalFontSize(settings.fontSize ?? 18);
        setLocalLineHeight(settings.lineHeight ?? 1.6);
        setLocalMargins(settings.margins ?? 20);
        setLocalZoom(settings.zoom ?? 100);
        setLocalWordSpacing(settings.wordSpacing ?? 0);
        setLocalLetterSpacing(settings.letterSpacing ?? 0);
    }, [settings.brightness, settings.fontSize, settings.lineHeight, settings.margins,
        settings.zoom, settings.wordSpacing, settings.letterSpacing]);

    // Debounced update function
    const debouncedUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debouncedUpdate = useCallback((updates: Partial<ReaderSettingsType>) => {
        if (debouncedUpdateRef.current) {
            clearTimeout(debouncedUpdateRef.current);
        }
        debouncedUpdateRef.current = setTimeout(() => {
            onUpdate(updates);
        }, 150);
    }, [onUpdate]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (debouncedUpdateRef.current) {
                clearTimeout(debouncedUpdateRef.current);
            }
        };
    }, []);

    const currentFontFamily = FONTS.find(f => f.id === settings.fontFamily)?.family;

    // Reset all settings to default
    const handleReset = useCallback(() => {
        onUpdate({
            theme: 'light',
            fontFamily: 'original',
            fontSize: 18,
            lineHeight: 1.6,
            letterSpacing: 0,
            wordSpacing: 0,
            paragraphSpacing: 1,
            textAlign: 'left',
            hyphenation: false,
            margins: 10,
            zoom: 100,
            flow: 'paged',
            layout: 'auto',
            brightness: 100,
            forcePublisherStyles: false,
        });
    }, [onUpdate]);

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={className}>
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-[var(--color-background)] text-[var(--color-accent)]">
                            <Type className="w-4 h-4" />
                        </div>
                        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Appearance</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleReset}
                            className="px-3 py-1.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                            title="Reset to defaults"
                        >
                            Reset
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-xl hover:bg-[var(--color-border-subtle)] transition-colors text-[var(--color-text-secondary)]"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Brightness */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                Brightness
                            </label>
                            <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                {localBrightness}%
                            </span>
                        </div>
                        <div className="flex items-center gap-4 px-1">
                            <Sun className="w-4 h-4 text-[var(--color-text-muted)]" />
                            <input
                                type="range"
                                min="10"
                                max="100"
                                value={localBrightness}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    setLocalBrightness(val);
                                    debouncedUpdate({ brightness: val });
                                }}
                                className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                            />
                            <Sun className="w-5 h-5 text-[var(--color-text-primary)]" />
                        </div>
                    </div>

                    {/* Theme Selection */}
                    <div className="space-y-4">
                        <label className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                            Reader Theme
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {THEMES.map((theme) => (
                                <button
                                    key={theme.id}
                                    onClick={() => onUpdate({ theme: theme.id })}
                                    className="flex flex-col items-center gap-2 group"
                                >
                                    <div
                                        className={cn(
                                            'w-full aspect-square rounded-xl flex items-center justify-center transition-all duration-200 border-2',
                                            settings.theme === theme.id
                                                ? 'border-[var(--color-accent)] ring-4 ring-[var(--color-accent)]/10 scale-105'
                                                : 'border-transparent hover:border-[var(--color-border)]'
                                        )}
                                        style={{ backgroundColor: theme.bg, color: theme.text }}
                                    >
                                        {theme.icon}
                                    </div>
                                    <span className={cn(
                                        "text-[10px] font-semibold transition-colors",
                                        settings.theme === theme.id
                                            ? "text-[var(--color-text-primary)]"
                                            : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]"
                                    )}>
                                        {theme.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Typography */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <TypeIcon className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                Typography
                            </label>
                        </div>

                        {/* Font Family */}
                        <div className="relative">
                            <select
                                value={settings.fontFamily}
                                onChange={(e) => onUpdate({ fontFamily: e.target.value as FontFamily })}
                                className={cn(
                                    "w-full h-11 pl-4 pr-10 bg-[var(--color-background)] border-2 border-[var(--color-border-subtle)] rounded-xl appearance-none",
                                    "text-sm font-medium text-[var(--color-text-primary)] cursor-pointer focus:border-[var(--color-accent)] transition-all outline-none"
                                )}
                            >
                                {FONTS.map((font) => (
                                    <option key={font.id} value={font.id}>{font.label}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
                        </div>

                        {/* Preview */}
                        <div
                            className="p-4 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-subtle)] text-center text-lg italic text-[var(--color-text-primary)]"
                            style={{ fontFamily: currentFontFamily }}
                        >
                            The quick brown fox jumps over the lazy dog.
                        </div>
                    </div>

                    {/* Text Settings */}
                    <div className="space-y-6">
                        {/* Font Size */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                    Font Size
                                </label>
                                <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                    {localFontSize}px
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        const val = Math.max(12, localFontSize - 1);
                                        setLocalFontSize(val);
                                        debouncedUpdate({ fontSize: val });
                                    }}
                                    className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors"
                                >
                                    <Minus className="w-4 h-4" />
                                </button>
                                <input
                                    type="range"
                                    min="12"
                                    max="36"
                                    value={localFontSize}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value);
                                        setLocalFontSize(val);
                                        debouncedUpdate({ fontSize: val });
                                    }}
                                    className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                                />
                                <button
                                    onClick={() => {
                                        const val = Math.min(36, localFontSize + 1);
                                        setLocalFontSize(val);
                                        debouncedUpdate({ fontSize: val });
                                    }}
                                    className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Line Spacing */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                    Line Spacing
                                </label>
                                <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                    {localLineHeight.toFixed(1)}
                                </span>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        const val = Math.max(1.0, parseFloat((localLineHeight - 0.1).toFixed(1)));
                                        setLocalLineHeight(val);
                                        debouncedUpdate({ lineHeight: val });
                                    }}
                                    className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors"
                                >
                                    <Minus className="w-4 h-4" />
                                </button>
                                <input
                                    type="range"
                                    min="1.0"
                                    max="2.5"
                                    step="0.1"
                                    value={localLineHeight}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setLocalLineHeight(val);
                                        debouncedUpdate({ lineHeight: val });
                                    }}
                                    className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                                />
                                <button
                                    onClick={() => {
                                        const val = Math.min(2.5, parseFloat((localLineHeight + 0.1).toFixed(1)));
                                        setLocalLineHeight(val);
                                        debouncedUpdate({ lineHeight: val });
                                    }}
                                    className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-muted)] transition-colors"
                                >
                                    <Plus className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Word Spacing */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                    Word Spacing
                                </label>
                                <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                    {localWordSpacing.toFixed(2)}em
                                </span>
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="0.5"
                                step="0.05"
                                value={localWordSpacing}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setLocalWordSpacing(val);
                                    debouncedUpdate({ wordSpacing: val });
                                }}
                                className="w-full h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                            />
                        </div>

                        {/* Letter Spacing */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                    Letter Spacing
                                </label>
                                <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                    {localLetterSpacing > 0 ? '+' : ''}{localLetterSpacing.toFixed(2)}em
                                </span>
                            </div>
                            <input
                                type="range"
                                min="-0.05"
                                max="0.2"
                                step="0.01"
                                value={localLetterSpacing}
                                onChange={(e) => {
                                    const val = parseFloat(e.target.value);
                                    setLocalLetterSpacing(val);
                                    debouncedUpdate({ letterSpacing: val });
                                }}
                                className="w-full h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                            />
                        </div>
                    </div>

                    {/* Text Alignment */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <AlignLeft className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                Text Alignment
                            </label>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            {ALIGN_OPTIONS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    onClick={() => onUpdate({ textAlign: id })}
                                    className={cn(
                                        'h-12 py-2 rounded-xl flex flex-col items-center justify-center gap-1 transition-all border-2',
                                        settings.textAlign === id
                                            ? 'bg-[var(--color-accent)] text-[var(--color-background)] border-[var(--color-accent)] shadow-sm'
                                            : 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-transparent hover:border-[var(--color-border)]'
                                    )}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span className="text-[10px] font-bold capitalize tracking-tight">{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Reading Flow */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <WrapText className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                Reading Flow
                            </label>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            {FLOW_OPTIONS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    onClick={() => onUpdate({ flow: id })}
                                    className={cn(
                                        'h-16 py-2 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all border-2',
                                        settings.flow === id
                                            ? 'bg-[var(--color-accent)] text-[var(--color-background)] border-[var(--color-accent)] shadow-sm'
                                            : 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-transparent hover:border-[var(--color-border)]'
                                    )}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span className="text-[10px] font-bold capitalize tracking-tight">{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Page Layout */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <Maximize2 className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                Page Layout
                            </label>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                            {LAYOUT_OPTIONS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    onClick={() => onUpdate({ layout: id })}
                                    className={cn(
                                        'h-16 py-2 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all border-2',
                                        settings.layout === id
                                            ? 'bg-[var(--color-accent)] text-[var(--color-background)] border-[var(--color-accent)] shadow-sm'
                                            : 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-transparent hover:border-[var(--color-border)]'
                                    )}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span className="text-[10px] font-bold capitalize tracking-tight">{label}</span>
                                </button>
                            ))}
                        </div>
                        {settings.layout === 'auto' && (
                            <p className="text-[10px] text-[var(--color-text-muted)]">
                                Auto layout switches between single and double page based on window width
                            </p>
                        )}
                    </div>

                    {/* Page Margins */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                Page Margins
                            </label>
                            <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                {localMargins}%
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    const val = Math.max(0, localMargins - 1);
                                    setLocalMargins(val);
                                    debouncedUpdate({ margins: val });
                                }}
                                className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-primary)] transition-colors"
                            >
                                <Minus className="w-4 h-4" />
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="35"
                                value={localMargins}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    setLocalMargins(val);
                                    debouncedUpdate({ margins: val });
                                }}
                                className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                            />
                            <button
                                onClick={() => {
                                    const val = Math.min(35, localMargins + 1);
                                    setLocalMargins(val);
                                    debouncedUpdate({ margins: val });
                                }}
                                className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-primary)] transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Zoom */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                    Zoom
                                </label>
                            </div>
                            <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                {localZoom}%
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => {
                                    const val = Math.max(50, localZoom - 10);
                                    setLocalZoom(val);
                                    debouncedUpdate({ zoom: val });
                                }}
                                className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-primary)] transition-colors"
                            >
                                <Minus className="w-4 h-4" />
                            </button>
                            <input
                                type="range"
                                min="50"
                                max="200"
                                step="10"
                                value={localZoom}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    setLocalZoom(val);
                                    debouncedUpdate({ zoom: val });
                                }}
                                className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                            />
                            <button
                                onClick={() => {
                                    const val = Math.min(200, localZoom + 10);
                                    setLocalZoom(val);
                                    debouncedUpdate({ zoom: val });
                                }}
                                className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-primary)] transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex justify-end">
                            <button
                                onClick={() => {
                                    setLocalZoom(100);
                                    onUpdate({ zoom: 100 });
                                }}
                                className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                            >
                                Reset to 100%
                            </button>
                        </div>
                    </div>

                    {/* Advanced Options */}
                    <div className="space-y-4 pt-4 border-t border-[var(--color-border-subtle)]">
                        <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                            Advanced Options
                        </label>

                        {/* Hyphenation Toggle */}
                        <label className="flex items-center justify-between p-3 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-subtle)] cursor-pointer hover:border-[var(--color-border)] transition-colors">
                            <div className="flex items-center gap-3">
                                <WrapText className="w-4 h-4 text-[var(--color-text-secondary)]" />
                                <div>
                                    <span className="text-sm font-medium text-[var(--color-text-primary)]">Hyphenation</span>
                                    <p className="text-[10px] text-[var(--color-text-muted)]">Break words at line endings</p>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                checked={settings.hyphenation}
                                onChange={(e) => onUpdate({ hyphenation: e.target.checked })}
                                className="w-4 h-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                            />
                        </label>

                        {/* Force Publisher Styles Toggle */}
                        <label className="flex items-center justify-between p-3 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-subtle)] cursor-pointer hover:border-[var(--color-border)] transition-colors">
                            <div className="flex items-center gap-3">
                                <Palette className="w-4 h-4 text-[var(--color-text-secondary)]" />
                                <div>
                                    <span className="text-sm font-medium text-[var(--color-text-primary)]">Override Book Styles</span>
                                    <p className="text-[10px] text-[var(--color-text-muted)]">Force your settings over publisher defaults</p>
                                </div>
                            </div>
                            <input
                                type="checkbox"
                                checked={settings.forcePublisherStyles}
                                onChange={(e) => onUpdate({ forcePublisherStyles: e.target.checked })}
                                className="w-4 h-4 rounded border-[var(--color-border)] text-[var(--color-accent)] focus:ring-[var(--color-accent)]"
                            />
                        </label>
                    </div>
                </div>
            </FloatingPanel>
        </>
    );
}

export default ReaderSettings;
