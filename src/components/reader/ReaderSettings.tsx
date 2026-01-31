/**
 * ReaderSettings Component
 * Simplified 3-tab settings panel (Themes/Typography/Layout)
 * Progressive disclosure for advanced options
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
    X, Sun, Moon, Sunrise, ChevronDown, Plus, Minus,
    Layers, ArrowUpDown, Square, BookOpen, Monitor,
    AlignLeft, AlignJustify, AlignCenter, Type,
    Palette, Maximize2, Zap, Settings2
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

type TabId = 'themes' | 'typography' | 'layout';

const THEMES: Array<{ id: ReaderTheme; label: string; icon: React.ReactNode; bg: string; text: string }> = [
    { id: 'light', label: 'Light', icon: <Sun className="w-5 h-5" />, bg: '#FFFFFF', text: '#1A1A1A' },
    { id: 'sepia', label: 'Sepia', icon: <Sunrise className="w-5 h-5" />, bg: '#F4ECD8', text: '#5F4B32' },
    { id: 'dark', label: 'Dark', icon: <Moon className="w-5 h-5" />, bg: '#1A1A1A', text: '#E0E0E0' },
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
    const [activeTab, setActiveTab] = useState<TabId>('themes');
    const [showAdvancedType, setShowAdvancedType] = useState(false);

    // Local state for sliders
    const [localBrightness, setLocalBrightness] = useState(settings.brightness ?? 100);
    const [localFontSize, setLocalFontSize] = useState(settings.fontSize ?? 18);
    const [localLineHeight, setLocalLineHeight] = useState(settings.lineHeight ?? 1.6);
    const [localMargins, setLocalMargins] = useState(settings.margins ?? 20);
    const [localZoom, setLocalZoom] = useState(settings.zoom ?? 100);
    const [localWordSpacing, setLocalWordSpacing] = useState(settings.wordSpacing ?? 0);
    const [localLetterSpacing, setLocalLetterSpacing] = useState(settings.letterSpacing ?? 0);

    // Sync local state
    useEffect(() => {
        setLocalBrightness(settings.brightness ?? 100);
        setLocalFontSize(settings.fontSize ?? 18);
        setLocalLineHeight(settings.lineHeight ?? 1.6);
        setLocalMargins(settings.margins ?? 20);
        setLocalZoom(settings.zoom ?? 100);
        setLocalWordSpacing(settings.wordSpacing ?? 0);
        setLocalLetterSpacing(settings.letterSpacing ?? 0);
    }, [settings]);

    // Debounced update
    const debouncedUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const debouncedUpdate = useCallback((updates: Partial<ReaderSettingsType>) => {
        if (debouncedUpdateRef.current) clearTimeout(debouncedUpdateRef.current);
        debouncedUpdateRef.current = setTimeout(() => onUpdate(updates), 150);
    }, [onUpdate]);

    useEffect(() => () => {
        if (debouncedUpdateRef.current) clearTimeout(debouncedUpdateRef.current);
    }, []);

    const currentFontFamily = FONTS.find(f => f.id === settings.fontFamily)?.family;

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

    const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
        { id: 'themes', label: 'Theme', icon: <Palette className="w-4 h-4" /> },
        { id: 'typography', label: 'Typography', icon: <Type className="w-4 h-4" /> },
        { id: 'layout', label: 'Layout', icon: <Maximize2 className="w-4 h-4" /> },
    ];

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={className}>
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-[var(--color-accent)]" />
                        <h2 className="text-base font-semibold text-[var(--color-text-primary)]">Settings</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleReset}
                            className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                        >
                            Reset
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg hover:bg-[var(--color-border-subtle)] transition-colors"
                        >
                            <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-[var(--color-border)]">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                'flex-1 flex items-center justify-center gap-2 py-3 text-xs font-medium transition-all border-b-2',
                                activeTab === tab.id
                                    ? 'text-[var(--color-accent)] border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                                    : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border-subtle)]'
                            )}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab Content */}
                <div className="p-5 max-h-[60vh] overflow-y-auto">
                    {/* THEMES TAB */}
                    {activeTab === 'themes' && (
                        <div className="space-y-6">
                            {/* Brightness */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium text-[var(--color-text-secondary)]">Brightness</label>
                                    <span className="text-xs font-mono text-[var(--color-accent)]">{localBrightness}%</span>
                                </div>
                                <div className="flex items-center gap-3">
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
                                        className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full accent-[var(--color-accent)]"
                                    />
                                    <Sun className="w-5 h-5 text-[var(--color-text-primary)]" />
                                </div>
                            </div>

                            {/* Theme Presets */}
                            <div className="space-y-3">
                                <label className="text-xs font-medium text-[var(--color-text-secondary)]">Reader Theme</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {THEMES.map((theme) => (
                                        <button
                                            key={theme.id}
                                            onClick={() => onUpdate({ theme: theme.id })}
                                            className="flex flex-col items-center gap-2"
                                        >
                                            <div
                                                className={cn(
                                                    'w-full aspect-square rounded-xl flex items-center justify-center transition-all border-2',
                                                    settings.theme === theme.id
                                                        ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/20 scale-105'
                                                        : 'border-transparent hover:border-[var(--color-border)]'
                                                )}
                                                style={{ backgroundColor: theme.bg, color: theme.text }}
                                            >
                                                {theme.icon}
                                            </div>
                                            <span className={cn(
                                                "text-xs font-medium",
                                                settings.theme === theme.id
                                                    ? "text-[var(--color-text-primary)]"
                                                    : "text-[var(--color-text-muted)]"
                                            )}>
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
                            {/* Font Family */}
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-[var(--color-text-secondary)]">Font</label>
                                <div className="relative">
                                    <select
                                        value={settings.fontFamily}
                                        onChange={(e) => onUpdate({ fontFamily: e.target.value as FontFamily })}
                                        className="w-full h-10 pl-3 pr-10 bg-[var(--color-background)] border border-[var(--color-border-subtle)] rounded-lg text-sm focus:border-[var(--color-accent)] outline-none"
                                    >
                                        {FONTS.map((font) => (
                                            <option key={font.id} value={font.id}>{font.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
                                </div>
                                {/* Preview */}
                                <div
                                    className="p-3 rounded-lg bg-[var(--color-background)] border border-[var(--color-border-subtle)] text-center text-base italic text-[var(--color-text-primary)]"
                                    style={{ fontFamily: currentFontFamily }}
                                >
                                    The quick brown fox
                                </div>
                            </div>

                            {/* Font Size */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium text-[var(--color-text-secondary)]">Size</label>
                                    <span className="text-xs font-mono text-[var(--color-accent)]">{localFontSize}px</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            const val = Math.max(12, localFontSize - 1);
                                            setLocalFontSize(val);
                                            debouncedUpdate({ fontSize: val });
                                        }}
                                        className="p-1.5 rounded-lg hover:bg-[var(--color-border-subtle)]"
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
                                        className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full accent-[var(--color-accent)]"
                                    />
                                    <button
                                        onClick={() => {
                                            const val = Math.min(36, localFontSize + 1);
                                            setLocalFontSize(val);
                                            debouncedUpdate({ fontSize: val });
                                        }}
                                        className="p-1.5 rounded-lg hover:bg-[var(--color-border-subtle)]"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Advanced Toggle */}
                            <button
                                onClick={() => setShowAdvancedType(!showAdvancedType)}
                                className="w-full py-2 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 rounded-lg transition-colors"
                            >
                                {showAdvancedType ? 'Hide Advanced' : 'Customize Spacing...'}
                            </button>

                            {/* Advanced Typography */}
                            {showAdvancedType && (
                                <div className="space-y-4 pt-2 border-t border-[var(--color-border-subtle)]">
                                    {/* Line Height */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs text-[var(--color-text-muted)]">Line Spacing</label>
                                            <span className="text-xs font-mono text-[var(--color-text-muted)]">{localLineHeight.toFixed(1)}</span>
                                        </div>
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
                                            className="w-full h-1.5 bg-[var(--color-border-subtle)] rounded-full accent-[var(--color-accent)]"
                                        />
                                    </div>

                                    {/* Word Spacing */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs text-[var(--color-text-muted)]">Word Spacing</label>
                                            <span className="text-xs font-mono text-[var(--color-text-muted)]">{localWordSpacing.toFixed(2)}em</span>
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
                                            className="w-full h-1.5 bg-[var(--color-border-subtle)] rounded-full accent-[var(--color-accent)]"
                                        />
                                    </div>

                                    {/* Letter Spacing */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs text-[var(--color-text-muted)]">Letter Spacing</label>
                                            <span className="text-xs font-mono text-[var(--color-text-muted)]">{localLetterSpacing.toFixed(2)}em</span>
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
                                            className="w-full h-1.5 bg-[var(--color-border-subtle)] rounded-full accent-[var(--color-accent)]"
                                        />
                                    </div>

                                    {/* Text Alignment */}
                                    <div className="space-y-2">
                                        <label className="text-xs text-[var(--color-text-muted)]">Alignment</label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {ALIGN_OPTIONS.map(({ id, label, icon: Icon }) => (
                                                <button
                                                    key={id}
                                                    onClick={() => onUpdate({ textAlign: id })}
                                                    className={cn(
                                                        'py-2 rounded-lg flex flex-col items-center gap-1 transition-all border',
                                                        settings.textAlign === id
                                                            ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                                                            : 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-[var(--color-border-subtle)]'
                                                    )}
                                                >
                                                    <Icon className="w-4 h-4" />
                                                    <span className="text-[10px]">{label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* LAYOUT TAB */}
                    {activeTab === 'layout' && (
                        <div className="space-y-5">
                            {/* Reading Flow */}
                            <div className="space-y-3">
                                <label className="text-xs font-medium text-[var(--color-text-secondary)]">Reading Mode</label>
                                <div className="grid grid-cols-2 gap-3">
                                    {FLOW_OPTIONS.map(({ id, label, icon: Icon }) => (
                                        <button
                                            key={id}
                                            onClick={() => onUpdate({ flow: id })}
                                            className={cn(
                                                'py-3 rounded-lg flex flex-col items-center gap-2 transition-all border',
                                                settings.flow === id
                                                    ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                                                    : 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-[var(--color-border-subtle)]'
                                            )}
                                        >
                                            <Icon className="w-5 h-5" />
                                            <span className="text-xs font-medium">{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Page Layout */}
                            <div className="space-y-3">
                                <label className="text-xs font-medium text-[var(--color-text-secondary)]">Page Layout</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {LAYOUT_OPTIONS.map(({ id, label, icon: Icon }) => (
                                        <button
                                            key={id}
                                            onClick={() => onUpdate({ layout: id })}
                                            className={cn(
                                                'py-3 rounded-lg flex flex-col items-center gap-1.5 transition-all border',
                                                settings.layout === id
                                                    ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                                                    : 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-[var(--color-border-subtle)]'
                                            )}
                                        >
                                            <Icon className="w-4 h-4" />
                                            <span className="text-[10px] font-medium">{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Margins */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-medium text-[var(--color-text-secondary)]">Margins</label>
                                    <span className="text-xs font-mono text-[var(--color-accent)]">{localMargins}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            const val = Math.max(0, localMargins - 1);
                                            setLocalMargins(val);
                                            debouncedUpdate({ margins: val });
                                        }}
                                        className="p-1.5 rounded-lg hover:bg-[var(--color-border-subtle)]"
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
                                        className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full accent-[var(--color-accent)]"
                                    />
                                    <button
                                        onClick={() => {
                                            const val = Math.min(35, localMargins + 1);
                                            setLocalMargins(val);
                                            debouncedUpdate({ margins: val });
                                        }}
                                        className="p-1.5 rounded-lg hover:bg-[var(--color-border-subtle)]"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {/* Zoom */}
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <Zap className="w-4 h-4 text-[var(--color-text-muted)]" />
                                        <label className="text-xs font-medium text-[var(--color-text-secondary)]">Zoom</label>
                                    </div>
                                    <span className="text-xs font-mono text-[var(--color-accent)]">{localZoom}%</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            const val = Math.max(50, localZoom - 10);
                                            setLocalZoom(val);
                                            debouncedUpdate({ zoom: val });
                                        }}
                                        className="p-1.5 rounded-lg hover:bg-[var(--color-border-subtle)]"
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
                                        className="flex-1 h-1.5 bg-[var(--color-border-subtle)] rounded-full accent-[var(--color-accent)]"
                                    />
                                    <button
                                        onClick={() => {
                                            const val = Math.min(200, localZoom + 10);
                                            setLocalZoom(val);
                                            debouncedUpdate({ zoom: val });
                                        }}
                                        className="p-1.5 rounded-lg hover:bg-[var(--color-border-subtle)]"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </button>
                                </div>
                                {localZoom !== 100 && (
                                    <button
                                        onClick={() => {
                                            setLocalZoom(100);
                                            onUpdate({ zoom: 100 });
                                        }}
                                        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                                    >
                                        Reset to 100%
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </FloatingPanel>
        </>
    );
}

export default ReaderSettings;
