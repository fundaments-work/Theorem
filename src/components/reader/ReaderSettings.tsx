/**
 * ReaderSettings Component
 * Popover panel for reading customization options
 */

import { X, Sun, Moon, Sunrise, Type, ChevronDown, Plus, Minus, Layers, ArrowUpDown, PlayCircle, Square, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReaderSettings as ReaderSettingsType, ReaderTheme, FontFamily } from '@/types';

interface ReaderSettingsProps {
    settings: ReaderSettingsType;
    visible: boolean;
    onClose: () => void;
    onUpdate: (updates: Partial<ReaderSettingsType>) => void;
    className?: string;
}

const THEMES: { id: ReaderTheme; label: string; icon: React.ReactNode; bg: string; text: string; border: string }[] = [
    { id: 'light', label: 'Light', icon: <Sun className="w-4 h-4" />, bg: '#FFFFFF', text: '#1A1A1A', border: '#E5E5E5' },
    { id: 'sepia', label: 'Sepia', icon: <Sunrise className="w-4 h-4" />, bg: '#F4ECD8', text: '#5F4B32', border: '#DCD3BD' },
    { id: 'dark', label: 'Dark', icon: <Moon className="w-4 h-4" />, bg: '#1A1A1A', text: '#E0E0E0', border: '#333333' },
];

const FONTS: { id: FontFamily; label: string; family: string }[] = [
    { id: 'original', label: 'Book Original', family: 'inherit' },
    { id: 'serif', label: 'Serif', family: 'var(--font-serif)' },
    { id: 'sans', label: 'Sans', family: 'var(--font-sans)' },
    { id: 'mono', label: 'Mono', family: 'var(--font-mono)' },
];

export function ReaderSettings({
    settings,
    visible,
    onClose,
    onUpdate,
    className,
}: ReaderSettingsProps) {
    return (
        <>
            {/* Backdrop */}
            {visible && (
                <div
                    className="fixed inset-0 z-40 bg-black/5"
                    onClick={onClose}
                />
            )}

            {/* Panel */}
            <div
                className={cn(
                    'fixed top-16 right-6 w-80 max-w-[calc(100vw-3rem)] z-50',
                    'bg-[var(--color-surface)] rounded-2xl shadow-2xl',
                    'border border-[var(--color-border)]',
                    'transform transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-top-right',
                    visible
                        ? 'opacity-100 scale-100 translate-y-0'
                        : 'opacity-0 scale-95 -translate-y-2 pointer-events-none',
                    className
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-[var(--color-background)] text-[var(--color-accent)]">
                            <Type className="w-4 h-4" />
                        </div>
                        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Appearance</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl hover:bg-[var(--color-border-subtle)] transition-colors text-[var(--color-text-secondary)]"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-6 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Brightness */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                Brightness
                            </label>
                            <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                {settings.brightness}%
                            </span>
                        </div>
                        <div className="flex items-center gap-4 px-1">
                            <Sun className="w-4 h-4 text-[var(--color-text-muted)]" />
                            <input
                                type="range"
                                min="10"
                                max="100"
                                value={settings.brightness}
                                onChange={(e) => onUpdate({ brightness: parseInt(e.target.value) })}
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
                                        settings.theme === theme.id ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]"
                                    )}>{theme.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Typography Dropdown */}
                    <div className="space-y-4">
                        <label className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                            Typography
                        </label>
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
                                    <option key={font.id} value={font.id}>
                                        {font.label}
                                    </option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
                        </div>

                        {/* Sample Text using selected font */}
                        <div
                            className="p-4 rounded-xl bg-[var(--color-background)] border border-[var(--color-border-subtle)] text-center text-lg italic text-[var(--color-text-primary)]"
                            style={{ fontFamily: FONTS.find(f => f.id === settings.fontFamily)?.family }}
                        >
                            The quick brown fox jumps over the lazy dog.
                        </div>
                    </div>

                    {/* Sliders */}
                    <div className="space-y-6">
                        {/* Font Size */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                    Font Size
                                </label>
                                <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                    {settings.fontSize}px
                                </span>
                            </div>
                            <div className="flex items-center gap-4 px-1">
                                <span className="text-sm text-[var(--color-text-muted)] font-serif">A</span>
                                <input
                                    type="range"
                                    min="12"
                                    max="36"
                                    value={settings.fontSize}
                                    onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })}
                                    className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                                />
                                <span className="text-xl text-[var(--color-text-muted)] font-serif">A</span>
                            </div>
                        </div>

                        {/* Spacing */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                                    Line Spacing
                                </label>
                                <span className="text-[10px] font-mono font-bold text-[var(--color-accent)] px-2 py-0.5 rounded-full bg-[var(--color-accent)]/10">
                                    {settings.lineHeight.toFixed(1)}
                                </span>
                            </div>
                            <div className="px-1">
                                <input
                                    type="range"
                                    min="1.0"
                                    max="2.5"
                                    step="0.1"
                                    value={settings.lineHeight}
                                    onChange={(e) => onUpdate({ lineHeight: parseFloat(e.target.value) })}
                                    className="w-full h-1.5 bg-[var(--color-border-subtle)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Reading Flow */}
                    <div className="space-y-4">
                        <label className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                            Reading Flow
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                            {(['paged', 'scroll', 'auto'] as const).map((flow) => (
                                <button
                                    key={flow}
                                    onClick={() => onUpdate({ flow })}
                                    className={cn(
                                        'h-16 py-2 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all border-2',
                                        settings.flow === flow
                                            ? 'bg-[var(--color-accent)] text-[var(--color-background)] border-[var(--color-accent)] shadow-sm'
                                            : 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-transparent hover:border-[var(--color-border)]'
                                    )}
                                >
                                    {flow === 'paged' && <Layers className="w-4 h-4" />}
                                    {flow === 'scroll' && <ArrowUpDown className="w-4 h-4" />}
                                    {flow === 'auto' && <PlayCircle className="w-4 h-4" />}
                                    <span className="text-[10px] font-bold capitalize tracking-tight">{flow}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Page Layout */}
                    <div className="space-y-4">
                        <label className="block text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                            Page Layout
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            {(['single', 'double'] as const).map((layout) => (
                                <button
                                    key={layout}
                                    onClick={() => onUpdate({ layout })}
                                    className={cn(
                                        'h-16 py-2 rounded-xl flex flex-col items-center justify-center gap-1.5 transition-all border-2',
                                        settings.layout === layout
                                            ? 'bg-[var(--color-accent)] text-[var(--color-background)] border-[var(--color-accent)] shadow-sm'
                                            : 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-transparent hover:border-[var(--color-border)]'
                                    )}
                                >
                                    {layout === 'single' && <Square className="w-4 h-4" />}
                                    {layout === 'double' && <BookOpen className="w-4 h-4" />}
                                    <span className="text-[10px] font-bold capitalize tracking-tight">{layout} Page</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Page Margins Plus/Minus */}
                    <div className="space-y-4">
                        <label className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-[0.1em]">
                            Page Margins
                        </label>
                        <div className="flex items-center justify-between bg-[var(--color-background)] p-2 rounded-xl border border-[var(--color-border-subtle)]">
                            <button
                                onClick={() => onUpdate({ margins: Math.max(0, settings.margins - 1) })}
                                className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-primary)] transition-colors"
                            >
                                <Minus className="w-4 h-4" />
                            </button>
                            <span className="text-sm font-mono font-bold text-[var(--color-accent)]">
                                {settings.margins}%
                            </span>
                            <button
                                onClick={() => onUpdate({ margins: Math.min(35, settings.margins + 1) })}
                                className="p-2 rounded-lg hover:bg-[var(--color-border-subtle)] text-[var(--color-text-primary)] transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}

export default ReaderSettings;
