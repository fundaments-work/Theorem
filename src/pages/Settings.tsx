/**
 * Settings Page
 * App and reader configuration
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSettingsStore, useLibraryStore } from "@/store";
import { formatFileSize } from "@/lib/utils";
import type { ReaderTheme, FontFamily, ReadingFlow, PageLayout, PageAnimation } from "@/types";
import { confirmClearAllData } from "@/lib/dialogs";
import {
    Settings,
    Type,
    Palette,
    Layout,
    BookOpen,
    Database,
    Moon,
    Sun,

    RotateCcw,
    Trash2,
    AlertTriangle,
    ChevronRight,
    FolderOpen,

    Check,
} from "lucide-react";

// Section component
interface SectionProps {
    title: string;
    description?: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}

function Section({ title, description, icon, children }: SectionProps) {
    return (
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-border-subtle)]/50">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--color-surface)] text-[var(--color-text-primary)]">
                        {icon}
                    </div>
                    <div>
                        <h2 className="font-semibold text-[var(--color-text-primary)]">{title}</h2>
                        {description && (
                            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
                        )}
                    </div>
                </div>
            </div>
            <div className="p-6">{children}</div>
        </section>
    );
}

// Setting row component
interface SettingRowProps {
    label: string;
    description?: string;
    children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
    return (
        <div className="flex items-center justify-between py-4 first:pt-0 last:pb-0 border-b border-[var(--color-border-subtle)] last:border-0">
            <div className="flex-1 pr-4">
                <label className="font-medium text-sm text-[var(--color-text-primary)]">{label}</label>
                {description && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
                )}
            </div>
            <div className="flex-shrink-0">{children}</div>
        </div>
    );
}

// Toggle component
function Toggle({
    checked,
    onChange,
}: {
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <button
            onClick={() => onChange(!checked)}
            className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
            )}
        >
            <span
                className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    checked ? "translate-x-6" : "translate-x-1"
                )}
            />
        </button>
    );
}

// Theme selector
const themes: { id: ReaderTheme; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "sepia", label: "Sepia", icon: BookOpen },
    { id: "dark", label: "Dark", icon: Moon },
];

// Font selector
const fonts: { id: FontFamily; label: string; sample: string }[] = [
    { id: "original", label: "Original", sample: "Aa" },
    { id: "serif", label: "Serif", sample: "Aa" },
    { id: "sans", label: "Sans", sample: "Aa" },
    { id: "mono", label: "Mono", sample: "Aa" },
];

// Flow selector
const flows: { id: ReadingFlow; label: string; description: string }[] = [
    { id: "paged", label: "Paged", description: "Page by page" },
    { id: "scroll", label: "Scroll", description: "Continuous scroll" },
    { id: "auto", label: "Auto", description: "Automatic" },
];

// Layout selector
const layouts: { id: PageLayout; label: string }[] = [
    { id: "single", label: "Single" },
    { id: "double", label: "Double" },
];

// Animation selector
const animations: { id: PageAnimation; label: string }[] = [
    { id: "slide", label: "Slide" },
    { id: "fade", label: "Fade" },
    { id: "instant", label: "Instant" },
];

// Main page component
export function SettingsPage() {
    const { settings, updateSettings, updateReaderSettings, resetSettings, resetReaderSettings } = useSettingsStore();
    const { books, annotations } = useLibraryStore();
    const [activeTab, setActiveTab] = useState<"general" | "reader" | "storage">("general");

    const totalStorage = books.reduce((acc, b) => acc + b.fileSize, 0);

    const handleClearData = async () => {
        const confirmed = await confirmClearAllData();
        if (confirmed) {
            localStorage.clear();
            window.location.reload();
        }
    };

    const tabButtons = [
        { id: "general" as const, label: "General", icon: Settings },
        { id: "reader" as const, label: "Reader", icon: BookOpen },
        { id: "storage" as const, label: "Storage", icon: Database },
    ];

    return (
        <div className="p-8 max-w-7xl mx-auto animate-fade-in min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between mb-10">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">
                        Settings
                    </h1>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                        Customize your reading experience
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 p-1 bg-[var(--color-border-subtle)] rounded-lg w-fit mb-8">
                {tabButtons.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                            activeTab === tab.id
                                ? "bg-[var(--color-surface)] text-[var(--color-text-primary)] shadow-sm"
                                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                        )}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* General Settings */}
            {activeTab === "general" && (
                <div className="space-y-6">
                    <Section
                        title="Library"
                        description="Library display and organization preferences"
                        icon={<Layout className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Library View"
                            description="Choose how books are displayed"
                        >
                            <div className="flex items-center gap-2">
                                {(["grid", "list", "compact"] as const).map((view) => (
                                    <button
                                        key={view}
                                        onClick={() => updateSettings({ libraryViewMode: view })}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors",
                                            settings.libraryViewMode === view
                                                ? "bg-[var(--color-accent)] text-white"
                                                : "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                        )}
                                    >
                                        {view}
                                    </button>
                                ))}
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Sort By"
                            description="Default sorting for library"
                        >
                            <select
                                value={settings.librarySortBy}
                                onChange={(e) =>
                                    updateSettings({ librarySortBy: e.target.value as typeof settings.librarySortBy })
                                }
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-sm",
                                    "bg-[var(--color-border-subtle)] text-[var(--color-text-primary)]",
                                    "border-none focus:ring-2 focus:ring-[var(--color-accent)]",
                                    "cursor-pointer"
                                )}
                            >
                                <option value="lastRead">Last Read</option>
                                <option value="title">Title</option>
                                <option value="author">Author</option>
                                <option value="dateAdded">Date Added</option>
                                <option value="progress">Progress</option>
                                <option value="rating">Rating</option>
                            </select>
                        </SettingRow>

                        <SettingRow
                            label="Sort Order"
                            description="Ascending or descending order"
                        >
                            <div className="flex items-center gap-2">
                                {(["asc", "desc"] as const).map((order) => (
                                    <button
                                        key={order}
                                        onClick={() => updateSettings({ librarySortOrder: order })}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors",
                                            settings.librarySortOrder === order
                                                ? "bg-[var(--color-accent)] text-white"
                                                : "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                        )}
                                    >
                                        {order === "asc" ? "Ascending" : "Descending"}
                                    </button>
                                ))}
                            </div>
                        </SettingRow>
                    </Section>

                    <Section
                        title="Appearance"
                        description="Customize the look and feel"
                        icon={<Palette className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Sidebar Collapsed"
                            description="Start with the sidebar collapsed"
                        >
                            <Toggle
                                checked={settings.sidebarCollapsed}
                                onChange={(checked) => updateSettings({ sidebarCollapsed: checked })}
                            />
                        </SettingRow>
                    </Section>

                    <div className="flex items-center justify-end">
                        <button
                            onClick={() => {
                                if (confirm("Reset all general settings to default?")) {
                                    resetSettings();
                                }
                            }}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Reset to Defaults
                        </button>
                    </div>
                </div>
            )}

            {/* Reader Settings */}
            {activeTab === "reader" && (
                <div className="space-y-6">
                    <Section
                        title="Typography"
                        description="Text appearance settings"
                        icon={<Type className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Font Family"
                            description="Choose your preferred font"
                        >
                            <div className="flex items-center gap-2">
                                {fonts.map((font) => (
                                    <button
                                        key={font.id}
                                        onClick={() => updateReaderSettings({ fontFamily: font.id })}
                                        className={cn(
                                            "px-3 py-2 rounded-md text-sm font-medium transition-colors",
                                            settings.readerSettings.fontFamily === font.id
                                                ? "bg-[var(--color-accent)] text-white"
                                                : "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                        )}
                                    >
                                        {font.label}
                                    </button>
                                ))}
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Font Size"
                            description={`Current: ${settings.readerSettings.fontSize}px`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-[var(--color-text-muted)]">12</span>
                                <input
                                    type="range"
                                    min={12}
                                    max={32}
                                    value={settings.readerSettings.fontSize}
                                    onChange={(e) =>
                                        updateReaderSettings({ fontSize: parseInt(e.target.value) })
                                    }
                                    className="w-32"
                                />
                                <span className="text-xs text-[var(--color-text-muted)]">32</span>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Line Height"
                            description={`Current: ${settings.readerSettings.lineHeight}`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-[var(--color-text-muted)]">1.2</span>
                                <input
                                    type="range"
                                    min={1.2}
                                    max={2}
                                    step={0.1}
                                    value={settings.readerSettings.lineHeight}
                                    onChange={(e) =>
                                        updateReaderSettings({ lineHeight: parseFloat(e.target.value) })
                                    }
                                    className="w-32"
                                />
                                <span className="text-xs text-[var(--color-text-muted)]">2.0</span>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Margins"
                            description={`Current: ${settings.readerSettings.margins}%`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-[var(--color-text-muted)]">0%</span>
                                <input
                                    type="range"
                                    min={0}
                                    max={25}
                                    value={settings.readerSettings.margins}
                                    onChange={(e) =>
                                        updateReaderSettings({ margins: parseInt(e.target.value) })
                                    }
                                    className="w-32"
                                />
                                <span className="text-xs text-[var(--color-text-muted)]">25%</span>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Text Alignment"
                            description="How text is aligned on the page"
                        >
                            <div className="flex items-center gap-2">
                                {(["left", "justify"] as const).map((align) => (
                                    <button
                                        key={align}
                                        onClick={() => updateReaderSettings({ textAlign: align })}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors",
                                            settings.readerSettings.textAlign === align
                                                ? "bg-[var(--color-accent)] text-white"
                                                : "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                        )}
                                    >
                                        {align}
                                    </button>
                                ))}
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Hyphenation"
                            description="Enable word hyphenation"
                        >
                            <Toggle
                                checked={settings.readerSettings.hyphenation}
                                onChange={(checked) => updateReaderSettings({ hyphenation: checked })}
                            />
                        </SettingRow>
                    </Section>

                    <Section
                        title="Theme"
                        description="Reading color theme"
                        icon={<Palette className="w-5 h-5" />}
                    >
                        <div className="grid grid-cols-3 gap-4">
                            {themes.map((theme) => (
                                <button
                                    key={theme.id}
                                    onClick={() => updateReaderSettings({ theme: theme.id })}
                                    className={cn(
                                        "flex flex-col items-center gap-3 p-4 rounded-xl border-2 transition-all",
                                        settings.readerSettings.theme === theme.id
                                            ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
                                            : "border-[var(--color-border)] hover:border-[var(--color-text-muted)]"
                                    )}
                                >
                                    <div
                                        className={cn(
                                            "w-12 h-12 rounded-full flex items-center justify-center theme-preview",
                                            theme.id === "light" && "bg-[var(--reader-bg)] border border-[var(--color-border)]",
                                            theme.id === "sepia" && "bg-[var(--reader-bg)]",
                                            theme.id === "dark" && "bg-[var(--reader-bg)]"
                                        )}
                                        data-theme={theme.id}
                                    >
                                        <theme.icon
                                            className={cn(
                                                "w-6 h-6",
                                                "text-[var(--reader-fg)]"
                                            )}
                                        />
                                    </div>
                                    <span className="font-medium text-sm text-[var(--color-text-primary)]">
                                        {theme.label}
                                    </span>
                                    {settings.readerSettings.theme === theme.id && (
                                        <Check className="w-4 h-4 text-[var(--color-accent)]" />
                                    )}
                                </button>
                            ))}
                        </div>
                    </Section>

                    <Section
                        title="Layout"
                        description="Page layout and navigation"
                        icon={<Layout className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Reading Flow"
                            description="How pages are displayed"
                        >
                            <div className="flex items-center gap-2">
                                {flows.map((flow) => (
                                    <button
                                        key={flow.id}
                                        onClick={() => updateReaderSettings({ flow: flow.id })}
                                        className={cn(
                                            "flex flex-col items-center px-4 py-2 rounded-md text-sm transition-colors",
                                            settings.readerSettings.flow === flow.id
                                                ? "bg-[var(--color-accent)] text-white"
                                                : "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                        )}
                                    >
                                        <span className="font-medium">{flow.label}</span>
                                    </button>
                                ))}
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Page Layout"
                            description="Single or double page view"
                        >
                            <div className="flex items-center gap-2">
                                {layouts.map((layout) => (
                                    <button
                                        key={layout.id}
                                        onClick={() => updateReaderSettings({ layout: layout.id })}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors",
                                            settings.readerSettings.layout === layout.id
                                                ? "bg-[var(--color-accent)] text-white"
                                                : "bg-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                        )}
                                    >
                                        {layout.label}
                                    </button>
                                ))}
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Page Animation"
                            description="Transition between pages"
                        >
                            <select
                                value={settings.readerSettings.pageAnimation}
                                onChange={(e) =>
                                    updateReaderSettings({ pageAnimation: e.target.value as PageAnimation })
                                }
                                className={cn(
                                    "px-3 py-1.5 rounded-md text-sm",
                                    "bg-[var(--color-border-subtle)] text-[var(--color-text-primary)]",
                                    "border-none focus:ring-2 focus:ring-[var(--color-accent)]",
                                    "cursor-pointer"
                                )}
                            >
                                {animations.map((anim) => (
                                    <option key={anim.id} value={anim.id}>
                                        {anim.label}
                                    </option>
                                ))}
                            </select>
                        </SettingRow>

                        <SettingRow
                            label="Fullscreen"
                            description="Start reader in fullscreen mode"
                        >
                            <Toggle
                                checked={settings.readerSettings.fullscreen}
                                onChange={(checked) => updateReaderSettings({ fullscreen: checked })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Toolbar Auto-hide"
                            description="Hide toolbar when reading"
                        >
                            <Toggle
                                checked={settings.readerSettings.toolbarAutoHide}
                                onChange={(checked) => updateReaderSettings({ toolbarAutoHide: checked })}
                            />
                        </SettingRow>
                    </Section>

                    <div className="flex items-center justify-end">
                        <button
                            onClick={() => {
                                if (confirm("Reset all reader settings to default?")) {
                                    resetReaderSettings();
                                }
                            }}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Reset Reader Settings
                        </button>
                    </div>
                </div>
            )}

            {/* Storage Settings */}
            {activeTab === "storage" && (
                <div className="space-y-6">
                    <Section
                        title="Storage Usage"
                        description="Manage your data and storage"
                        icon={<Database className="w-5 h-5" />}
                    >
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-[var(--color-border-subtle)] rounded-lg">
                                <div className="flex items-center gap-3">
                                    <BookOpen className="w-5 h-5 text-[var(--color-text-muted)]" />
                                    <div>
                                        <p className="font-medium text-sm text-[var(--color-text-primary)]">Books</p>
                                        <p className="text-xs text-[var(--color-text-muted)]">
                                            {books.length} {books.length === 1 ? "book" : "books"}
                                        </p>
                                    </div>
                                </div>
                                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                                    {formatFileSize(totalStorage)}
                                </span>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-[var(--color-border-subtle)] rounded-lg">
                                <div className="flex items-center gap-3">
                                    <FolderOpen className="w-5 h-5 text-[var(--color-text-muted)]" />
                                    <div>
                                        <p className="font-medium text-sm text-[var(--color-text-primary)]">Highlights & Notes</p>
                                        <p className="text-xs text-[var(--color-text-muted)]">
                                            {annotations.length} {annotations.length === 1 ? "annotation" : "annotations"}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Section>

                    <Section
                        title="Data Management"
                        description="Clear and export your data"
                        icon={<Trash2 className="w-5 h-5" />}
                    >
                        <div className="space-y-3">
                            <button
                                onClick={handleClearData}
                                className={cn(
                                    "w-full flex items-center gap-3 p-4 rounded-lg",
                                    "border border-[var(--color-error)]/20",
                                    "text-[var(--color-error)] hover:bg-[var(--color-error)]/5",
                                    "transition-colors text-left"
                                )}
                            >
                                <AlertTriangle className="w-5 h-5" />
                                <div className="flex-1">
                                    <p className="font-medium text-sm">Clear All Data</p>
                                    <p className="text-xs opacity-80">
                                        Delete all books, highlights, and settings. This cannot be undone.
                                    </p>
                                </div>
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </Section>
                </div>
            )}
        </div>
    );
}

