/**
 * Settings Page
 * App configuration with all planned features
 */

import { useRef, useState, type ChangeEvent } from "react";
import { cn } from "@theorem/core";
import { useLearningStore, useSettingsStore, useLibraryStore } from "@theorem/core";
import { formatFileSize } from "@theorem/core";
import { confirmClearAllData } from "@theorem/core";
import { Dropdown } from "@theorem/ui";
import {
    Settings,
    Layout,
    Database,
    RotateCcw,
    Trash2,
    AlertTriangle,
    ChevronRight,
    FolderOpen,
    BookOpen,
    Languages,
    Rss,
    Puzzle,
    Download,
    Globe,
    Wifi,
    WifiOff,
    Key,
    ExternalLink,
    Copy,
    Moon,
    Sun,
    BookOpenCheck,
    Target,
} from "lucide-react";

type PersistableStore = {
    persist?: {
        clearStorage?: () => void | Promise<void>;
    };
};

// Section component
interface SectionProps {
    title: string;
    description?: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}

function Section({ title, description, icon, children }: SectionProps) {
    return (
        <section className="ui-card">
            <div className="px-6 py-4 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)]/50">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-[var(--color-surface)] text-[color:var(--color-text-primary)]">
                        {icon}
                    </div>
                    <div>
                        <h2 className="font-semibold text-[color:var(--color-text-primary)]">{title}</h2>
                        {description && (
                            <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">{description}</p>
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
        <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 border-b border-[var(--color-border-subtle)] last:border-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:flex-1 sm:pr-4">
                <label className="font-medium text-sm text-[color:var(--color-text-primary)]">{label}</label>
                {description && (
                    <p className="text-xs text-[color:var(--color-text-muted)] mt-0.5">{description}</p>
                )}
            </div>
            <div className="w-full sm:w-auto sm:flex-shrink-0">{children}</div>
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
                    "inline-block h-4 w-4 transform rounded-full bg-[var(--color-surface)] transition-transform",
                    checked ? "translate-x-6" : "translate-x-1"
                )}
            />
        </button>
    );
}

// Button select component
function ButtonSelect<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            {options.map((opt) => (
                <button
                    key={opt.value}
                    onClick={() => onChange(opt.value)}
                    className={cn(
                        "px-3 py-1.5 rounded-md text-sm font-medium transition-colors min-w-[4.5rem]",
                        value === opt.value
                            ? "bg-[var(--color-accent)] ui-text-accent-contrast shadow-[var(--shadow-xs)]"
                            : "bg-[var(--color-surface-muted)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

// Main page component
export function SettingsPage() {
    const {
        settings,
        updateSettings,
        updateLearningSettings,
        resetSettings,
        stats,
        updateStats,
    } = useSettingsStore();
    const { books, annotations } = useLibraryStore();
    const { installedDictionaries, importStarDict, removeDictionary } = useLearningStore();
    const [activeTab, setActiveTab] = useState<
        "general" | "dictionary" | "rss" | "integrations" | "storage"
    >("general");

    // Dummy states for planned features
    const [rssAutoSync, setRssAutoSync] = useState(true);
    const [rssSyncInterval, setRssSyncInterval] = useState(30);
    const [obsidianVaultPath, setObsidianVaultPath] = useState("");
    const [obsidianAutoExport, setObsidianAutoExport] = useState(false);
    const [apiEnabled, setApiEnabled] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const dictionaryFileInputRef = useRef<HTMLInputElement>(null);

    const totalStorage = books.reduce((acc, b) => acc + b.fileSize, 0);
    const offlineDictionarySize = installedDictionaries.reduce(
        (acc, dictionary) => acc + dictionary.sizeBytes,
        0,
    );

    const handleClearData = async () => {
        const confirmed = await confirmClearAllData();
        if (confirmed) {
            const storesToClear: PersistableStore[] = [
                useSettingsStore as unknown as PersistableStore,
                useLibraryStore as unknown as PersistableStore,
                useLearningStore as unknown as PersistableStore,
            ];

            await Promise.allSettled(
                storesToClear.map(async (store) => {
                    try {
                        await store.persist?.clearStorage?.();
                    } catch (error) {
                        console.error("[Settings] Failed to clear persisted store:", error);
                    }
                }),
            );

            localStorage.removeItem("theorem-settings");
            localStorage.removeItem("theorem-library");
            localStorage.removeItem("theorem-learning");
            window.location.reload();
        }
    };

    const generateApiKey = () => {
        const key = "lr_" + Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
        setApiKey(key);
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const handleDictionaryImport = async (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) {
            return;
        }

        try {
            await importStarDict(files);
        } catch (error) {
            console.error("[Settings] Failed to import StarDict dictionary:", error);
            alert(error instanceof Error ? error.message : "Failed to import dictionary files.");
        } finally {
            event.target.value = "";
        }
    };

    const tabButtons = [
        { id: "general" as const, label: "General", icon: Settings },
        { id: "dictionary" as const, label: "Dictionary", icon: Languages },
        { id: "rss" as const, label: "RSS", icon: Rss },
        { id: "integrations" as const, label: "Integrations", icon: Puzzle },
        { id: "storage" as const, label: "Storage", icon: Database },
    ];

    return (
        <div className="ui-page animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-10">
                <div>
                    <h1 className="ui-page-title">
                        Settings
                    </h1>
                    <p className="ui-page-subtitle">
                        Customize your reading experience
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="mb-8 space-y-3">
                <div className="sm:hidden -mx-1 px-1">
                    <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory">
                        {tabButtons.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "snap-start flex min-w-[9.5rem] items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                                    activeTab === tab.id
                                        ? "bg-[var(--color-accent)] ui-text-accent-contrast border-[var(--color-accent)] shadow-[var(--shadow-xs)]"
                                        : "bg-[var(--color-surface)] border-[var(--color-border)] text-[color:var(--color-text-secondary)]"
                                )}
                            >
                                <tab.icon className="w-4 h-4" />
                                <span className="truncate">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="hidden sm:flex items-center gap-1 p-1 bg-[var(--color-surface-muted)] rounded-lg w-fit flex-wrap">
                    {tabButtons.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                                activeTab === tab.id
                                    ? "bg-[var(--color-accent)] ui-text-accent-contrast border border-[var(--color-accent)] shadow-[var(--shadow-xs)]"
                                    : "text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                            )}
                        >
                            <tab.icon className="w-4 h-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>
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
                            <ButtonSelect
                                options={[
                                    { value: "grid", label: "Grid" },
                                    { value: "list", label: "List" },
                                    { value: "compact", label: "Compact" },
                                ]}
                                value={settings.libraryViewMode}
                                onChange={(v) => updateSettings({ libraryViewMode: v })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Sort By"
                            description="Default sorting for library"
                        >
                            <Dropdown
                                value={settings.librarySortBy}
                                onChange={(value) =>
                                    updateSettings({ librarySortBy: value as typeof settings.librarySortBy })
                                }
                                options={[
                                    { value: "lastRead", label: "Last Read" },
                                    { value: "title", label: "Title" },
                                    { value: "author", label: "Author" },
                                    { value: "dateAdded", label: "Date Added" },
                                    { value: "progress", label: "Progress" },
                                    { value: "rating", label: "Rating" },
                                ]}
                                variant="filled"
                                size="sm"
                            />
                        </SettingRow>

                        <SettingRow
                            label="Sort Order"
                            description="Ascending or descending order"
                        >
                            <ButtonSelect
                                options={[
                                    { value: "asc", label: "Ascending" },
                                    { value: "desc", label: "Descending" },
                                ]}
                                value={settings.librarySortOrder}
                                onChange={(v) => updateSettings({ librarySortOrder: v })}
                            />
                        </SettingRow>
                    </Section>

                    <Section
                        title="Reading Goals"
                        description="Set your daily and yearly reading targets"
                        icon={<Target className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Daily Reading Goal"
                            description="Minutes to read each day"
                        >
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    value={stats.dailyGoal}
                                    onChange={(e) => updateStats({ dailyGoal: Math.max(1, Math.min(180, parseInt(e.target.value) || 0)) })}
                                    min={1}
                                    max={180}
                                    className={cn(
                                        "w-20 px-3 py-1.5 rounded-lg text-sm",
                                        "bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]",
                                        "border-none focus:ring-2 focus:ring-[var(--color-accent)]",
                                        "text-center"
                                    )}
                                />
                                <span className="text-sm text-[color:var(--color-text-secondary)]">min/day</span>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Yearly Book Goal"
                            description="Books to complete this year"
                        >
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    value={stats.yearlyBookGoal}
                                    onChange={(e) => updateStats({ yearlyBookGoal: Math.max(1, Math.min(100, parseInt(e.target.value) || 0)) })}
                                    min={1}
                                    max={100}
                                    className={cn(
                                        "w-20 px-3 py-1.5 rounded-lg text-sm",
                                        "bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]",
                                        "border-none focus:ring-2 focus:ring-[var(--color-accent)]",
                                        "text-center"
                                    )}
                                />
                                <span className="text-sm text-[color:var(--color-text-secondary)]">books/year</span>
                            </div>
                        </SettingRow>

                        <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                            <div className="flex items-center justify-between text-sm">
                                <span className="text-[color:var(--color-text-secondary)]">Current Progress</span>
                                <span className="text-[color:var(--color-text-primary)] font-medium">
                                    {stats.booksReadThisYear} / {stats.yearlyBookGoal} books
                                </span>
                            </div>
                            <div className="mt-2 h-2 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-500"
                                    style={{ width: `${Math.min(100, (stats.booksReadThisYear / Math.max(1, stats.yearlyBookGoal)) * 100)}%` }}
                                />
                            </div>
                        </div>
                    </Section>

                    <Section
                        title="Appearance"
                        description="Customize the look and feel"
                        icon={<Sun className="w-5 h-5" />}
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

                        <SettingRow
                            label="Dark Mode"
                            description="Use dark theme throughout the app"
                        >
                            <ButtonSelect
                                options={[
                                    { value: "light", label: "Light" },
                                    { value: "dark", label: "Dark" },
                                    { value: "system", label: "System" },
                                ]}
                                value={settings.theme || "system"}
                                onChange={(v) => updateSettings({ theme: v })}
                            />
                        </SettingRow>
                    </Section>

                    <Section
                        title="Vocabulary"
                        description="Vocabulary capture controls"
                        icon={<BookOpenCheck className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Enable Vocabulary Builder"
                            description="Track words you look up while reading"
                        >
                            <Toggle
                                checked={settings.learning.vocabularyEnabled}
                                onChange={(checked) => updateLearningSettings({ vocabularyEnabled: checked })}
                            />
                        </SettingRow>
                    </Section>

                    <div className="flex items-center justify-end">
                        <button
                            onClick={() => {
                                if (confirm("Reset all settings to default?")) {
                                    resetSettings();
                                }
                            }}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-[color:var(--color-text-muted)] hover:text-[color:var(--color-error)] transition-colors"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Reset to Defaults
                        </button>
                    </div>
                </div>
            )}

            {/* Dictionary Settings */}
            {activeTab === "dictionary" && (
                <div className="space-y-6">
                    <Section
                        title="Dictionary Source"
                        description="Choose how word lookups are handled"
                        icon={<Globe className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Dictionary Mode"
                            description="How to fetch word definitions"
                        >
                            <ButtonSelect
                                options={[
                                    { value: "online", label: "Online" },
                                    { value: "offline", label: "Offline" },
                                    { value: "auto", label: "Auto" },
                                ]}
                                value={settings.learning.dictionaryMode}
                                onChange={(value) => updateLearningSettings({ dictionaryMode: value })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Primary API"
                            description="Online dictionary service"
                        >
                            <span className="text-sm text-[color:var(--color-text-muted)] px-3 py-1.5 bg-[var(--color-surface-muted)] rounded-md">
                                Free Dictionary API
                            </span>
                        </SettingRow>

                        <SettingRow
                            label="Fallback"
                            description="Secondary dictionary source"
                        >
                            <span className="text-sm text-[color:var(--color-text-muted)] px-3 py-1.5 bg-[var(--color-surface-muted)] rounded-md">
                                Wiktionary
                            </span>
                        </SettingRow>

                        <SettingRow
                            label="Show Pronunciation"
                            description="Display phonetic pronunciation"
                        >
                            <Toggle
                                checked={settings.learning.showPronunciation}
                                onChange={(checked) => updateLearningSettings({ showPronunciation: checked })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Play Audio"
                            description="Auto-play pronunciation audio"
                        >
                            <Toggle
                                checked={settings.learning.playPronunciationAudio}
                                onChange={(checked) => updateLearningSettings({ playPronunciationAudio: checked })}
                            />
                        </SettingRow>
                    </Section>

                    <Section
                        title="Offline Dictionaries"
                        description="Import StarDict files for offline dictionary lookups"
                        icon={<WifiOff className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Import StarDict"
                            description="Select .ifo, .idx, and .dict.dz files"
                        >
                            <div className="flex items-center gap-2">
                                <input
                                    ref={dictionaryFileInputRef}
                                    type="file"
                                    multiple
                                    onChange={handleDictionaryImport}
                                    className="hidden"
                                    accept=".ifo,.idx,.dict,.dict.dz,.dz,.syn"
                                />
                                <button
                                    onClick={() => dictionaryFileInputRef.current?.click()}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm bg-[var(--color-accent)] ui-text-accent-contrast hover:opacity-90 transition-opacity"
                                >
                                    <Download className="w-4 h-4" /> Import Files
                                </button>
                                <span className="text-xs text-[color:var(--color-text-muted)]">
                                    {installedDictionaries.length} installed
                                </span>
                            </div>
                        </SettingRow>

                        {installedDictionaries.length === 0 && (
                            <p className="text-sm text-[color:var(--color-text-muted)]">
                                No offline dictionaries installed yet.
                            </p>
                        )}

                        {installedDictionaries.map((dictionary) => (
                            <SettingRow
                                key={dictionary.id}
                                label={dictionary.name}
                                description={`${dictionary.language.toUpperCase()} • StarDict • ${formatFileSize(dictionary.sizeBytes)}`}
                            >
                                <button
                                    onClick={() => {
                                        void removeDictionary(dictionary.id);
                                    }}
                                    className="px-3 py-1.5 rounded-md text-sm bg-[var(--color-surface-muted)] text-[color:var(--color-error)] hover:opacity-80 transition-opacity"
                                >
                                    Remove
                                </button>
                            </SettingRow>
                        ))}

                        <SettingRow
                            label="Offline Mode Guard"
                            description="When offline mode is enabled without dictionaries, lookups will show setup guidance"
                        >
                            <span className="text-sm text-[color:var(--color-text-muted)] px-3 py-1.5 bg-[var(--color-surface-muted)] rounded-md">
                                Enabled
                            </span>
                        </SettingRow>
                    </Section>
                </div>
            )}

            {/* RSS Settings */}
            {activeTab === "rss" && (
                <div className="space-y-6">
                    <Section
                        title="RSS Feeds"
                        description="Feed reader configuration"
                        icon={<Rss className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Auto-sync Feeds"
                            description="Automatically refresh feeds in background"
                        >
                            <Toggle checked={rssAutoSync} onChange={setRssAutoSync} />
                        </SettingRow>

                        <SettingRow
                            label="Sync Interval"
                            description={`Check for new articles every ${rssSyncInterval} minutes`}
                        >
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-[color:var(--color-text-muted)]">15m</span>
                                <input
                                    type="range"
                                    min={15}
                                    max={240}
                                    step={15}
                                    value={rssSyncInterval}
                                    onChange={(e) => setRssSyncInterval(parseInt(e.target.value))}
                                    className="w-32"
                                />
                                <span className="text-xs text-[color:var(--color-text-muted)]">4h</span>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Article Extraction"
                            description="Use Mozilla Readability for cleaner articles"
                        >
                            <Toggle checked={true} onChange={() => {}} />
                        </SettingRow>

                        <SettingRow
                            label="Offline Reading"
                            description="Download articles for offline access"
                        >
                            <Toggle checked={true} onChange={() => {}} />
                        </SettingRow>
                    </Section>

                </div>
            )}

            {/* Integrations Settings */}
            {activeTab === "integrations" && (
                <div className="space-y-6">
                    <Section
                        title="Obsidian Export"
                        description="Export highlights to Obsidian vault"
                        icon={<BookOpen className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Enable Obsidian Export"
                            description="Sync highlights to your Obsidian vault"
                        >
                            <Toggle checked={!!obsidianVaultPath} onChange={() => setObsidianVaultPath(obsidianVaultPath ? "" : "/path/to/vault")} />
                        </SettingRow>

                        <SettingRow
                            label="Vault Path"
                            description="Path to your Obsidian vault"
                        >
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={obsidianVaultPath}
                                    onChange={(e) => setObsidianVaultPath(e.target.value)}
                                    placeholder="/path/to/vault"
                                    className={cn(
                                        "px-3 py-1.5 rounded-md text-sm w-48",
                                        "bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]",
                                        "border-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                    )}
                                />
                                <button className="px-3 py-1.5 rounded-md text-sm bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)] hover:bg-[var(--color-border)] transition-colors">
                                    Browse
                                </button>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Auto-export on Highlight"
                            description="Automatically export new highlights"
                        >
                            <Toggle checked={obsidianAutoExport} onChange={setObsidianAutoExport} />
                        </SettingRow>

                        <SettingRow
                            label="Export Template"
                            description="Markdown template for exported highlights"
                        >
                            <Dropdown
                                options={[
                                    { value: "default", label: "Default (with YAML frontmatter)" },
                                    { value: "minimal", label: "Minimal (text only)" },
                                    { value: "custom", label: "Custom template" },
                                ]}
                                variant="filled"
                                size="sm"
                            />
                        </SettingRow>

                        <SettingRow
                            label="Sync Tags"
                            description="Include highlight tags in export"
                        >
                            <Toggle checked={true} onChange={() => {}} />
                        </SettingRow>
                    </Section>

                    <Section
                        title="Public API"
                        description="Access your data programmatically"
                        icon={<Key className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Enable API"
                            description="Allow external applications to access your data"
                        >
                            <Toggle checked={apiEnabled} onChange={setApiEnabled} />
                        </SettingRow>

                        {apiEnabled && (
                            <>
                                <SettingRow
                                    label="API Key"
                                    description="Keep this secret!"
                                >
                                    <div className="flex items-center gap-2">
                                        <code className="px-3 py-1.5 bg-[var(--color-surface-muted)] rounded-md text-sm text-[color:var(--color-text-secondary)] max-w-[var(--layout-tooltip-max-width)] truncate">
                                            {apiKey || "No key generated"}
                                        </code>
                                        {apiKey ? (
                                            <button
                                                onClick={() => copyToClipboard(apiKey)}
                                                className="p-1.5 rounded-md hover:bg-[var(--color-surface-muted)] transition-colors"
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                        ) : (
                                            <button
                                                onClick={generateApiKey}
                                                className="px-3 py-1.5 rounded-md text-sm bg-[var(--color-accent)] ui-text-accent-contrast hover:opacity-90 transition-opacity"
                                            >
                                                Generate
                                            </button>
                                        )}
                                    </div>
                                </SettingRow>

                                <SettingRow
                                    label="Webhook URL"
                                    description="Receive real-time updates"
                                >
                                    <input
                                        type="text"
                                        placeholder="https://your-app.com/webhook"
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-sm w-56",
                                            "bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]",
                                            "border-none focus:ring-2 focus:ring-[var(--color-accent)]"
                                        )}
                                    />
                                </SettingRow>

                                <div className="mt-4 p-4 bg-[var(--color-surface-muted)] rounded-lg">
                                    <p className="text-sm font-medium text-[color:var(--color-text-primary)] mb-2">API Documentation</p>
                                    <p className="text-xs text-[color:var(--color-text-muted)] mb-3">
                                        Access your library, highlights, and vocabulary programmatically.
                                    </p>
                                    <a
                                        href="#"
                                        className="text-xs text-[color:var(--color-accent)] hover:underline flex items-center gap-1"
                                    >
                                        View OpenAPI docs <ExternalLink className="w-3 h-3" />
                                    </a>
                                </div>
                            </>
                        )}
                    </Section>
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
                            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)] rounded-lg">
                                <div className="flex items-center gap-3">
                                    <BookOpen className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                                    <div>
                                        <p className="font-medium text-sm text-[color:var(--color-text-primary)]">Books</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">
                                            {books.length} {books.length === 1 ? "book" : "books"}
                                        </p>
                                    </div>
                                </div>
                                <span className="text-sm font-medium text-[color:var(--color-text-primary)]">
                                    {formatFileSize(totalStorage)}
                                </span>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)] rounded-lg">
                                <div className="flex items-center gap-3">
                                    <FolderOpen className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                                    <div>
                                        <p className="font-medium text-sm text-[color:var(--color-text-primary)]">Highlights & Notes</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">
                                            {annotations.length} {annotations.length === 1 ? "annotation" : "annotations"}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)] rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Rss className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                                    <div>
                                        <p className="font-medium text-sm text-[color:var(--color-text-primary)]">RSS Articles</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">
                                            0 articles cached
                                        </p>
                                    </div>
                                </div>
                                <span className="text-sm font-medium text-[color:var(--color-text-primary)]">
                                    0 MB
                                </span>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)] rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Languages className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                                    <div>
                                        <p className="font-medium text-sm text-[color:var(--color-text-primary)]">Offline Dictionaries</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">
                                            {installedDictionaries.length > 0
                                                ? `${installedDictionaries.length} installed`
                                                : "None installed"}
                                        </p>
                                    </div>
                                </div>
                                <span className="text-sm font-medium text-[color:var(--color-text-primary)]">
                                    {formatFileSize(offlineDictionarySize)}
                                </span>
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
                                    "text-[color:var(--color-error)] hover:bg-[var(--color-error)]/5",
                                    "transition-colors text-left"
                                )}
                            >
                                <AlertTriangle className="w-5 h-5" />
                                <div className="flex-1">
                                    <p className="font-medium text-sm">Clear All Data</p>
                                    <p className="text-xs opacity-80">
                                        Delete all books, highlights, vocabulary, and settings. This cannot be undone.
                                    </p>
                                </div>
                                <ChevronRight className="w-4 h-4" />
                            </button>

                            <button
                                className={cn(
                                    "w-full flex items-center gap-3 p-4 rounded-lg",
                                    "border border-[var(--color-border)]",
                                    "text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                                    "transition-colors text-left"
                                )}
                            >
                                <Download className="w-5 h-5" />
                                <div className="flex-1">
                                    <p className="font-medium text-sm">Export Data</p>
                                    <p className="text-xs text-[color:var(--color-text-muted)]">
                                        Download all your data as JSON
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
