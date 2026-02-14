/**
 * Settings Page
 * App configuration with all planned features
 */

import { useRef, useState, type ChangeEvent } from "react";
import { cn } from "../../core";
import {
    showOpenDirectoryDialog,
    useVocabularyStore,
    useLibraryStore,
    useSettingsStore,
    useUIStore,
} from "../../core";
import { formatFileSize } from "../../core";
import { confirmClearAllData } from "../../core";
import { Dropdown } from "../../ui";
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
        <section className="border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="border-b border-[var(--color-border)] px-5 py-3">
                {icon && <span className="sr-only">{icon}</span>}
                <h2 className="font-sans text-[12px] font-semibold text-[color:var(--color-text-primary)]">
                    {title}
                </h2>
                {description && (
                    <p className="mt-1 font-sans text-[11px] text-[color:var(--color-text-secondary)]">
                        {description}
                    </p>
                )}
            </div>
            <div className="px-5 py-4">{children}</div>
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
        <div className="grid gap-3 border-b border-[var(--color-border-subtle)] py-4 first:pt-0 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="w-full sm:flex-1 sm:pr-4">
                <label className="font-sans text-[12px] font-semibold text-[color:var(--color-text-primary)]">
                    {label}
                </label>
                {description && (
                    <p className="mt-1 font-sans text-[11px] text-[color:var(--color-text-secondary)]">
                        {description}
                    </p>
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
        <div className="inline-flex border border-[var(--color-border)] bg-[var(--color-surface)]">
            <button
                onClick={() => onChange(true)}
                className={cn(
                    "px-3 py-1.5 font-sans text-[11px] font-medium",
                    checked
                        ? "bg-[var(--color-accent)] text-white !text-white"
                        : "text-[color:var(--color-text-secondary)]"
                )}
            >
                On
            </button>
            <button
                onClick={() => onChange(false)}
                className={cn(
                    "border-l border-[var(--color-border)] px-3 py-1.5 font-sans text-[11px] font-medium",
                    !checked
                        ? "bg-[var(--color-accent)] text-white !text-white"
                        : "text-[color:var(--color-text-secondary)]"
                )}
            >
                Off
            </button>
        </div>
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
                        "border border-[var(--color-border)] px-3 py-1.5 font-sans text-[11px] font-medium transition-colors",
                        value === opt.value
                            ? "bg-[var(--color-accent)] text-white !text-white"
                            : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
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
        updateVocabularySettings,
        resetSettings,
        stats,
        updateStats,
    } = useSettingsStore();
    const { books, annotations } = useLibraryStore();
    const vaultSyncStatus = useUIStore((state) => state.vaultSyncStatus);
    const vaultSyncMessage = useUIStore((state) => state.vaultSyncMessage);
    const vaultSyncAt = useUIStore((state) => state.vaultSyncAt);
    const { installedDictionaries, importStarDict, removeDictionary } = useVocabularyStore();
    const [activeTab, setActiveTab] = useState<
        "general" | "dictionary" | "rss" | "integrations" | "storage"
    >("general");

    // Dummy states for planned features
    const [rssAutoSync, setRssAutoSync] = useState(true);
    const [rssSyncInterval, setRssSyncInterval] = useState(30);
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
                useVocabularyStore as unknown as PersistableStore,
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
            localStorage.removeItem("theorem-vocabulary");
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

    const updateVaultSettings = (updates: Partial<typeof settings.vault>) => {
        updateSettings({
            vault: {
                ...settings.vault,
                ...updates,
            },
        });
    };

    const handlePickVaultDirectory = async () => {
        const selectedPath = await showOpenDirectoryDialog({
            title: "Choose Obsidian Vault",
            defaultPath: settings.vault.vaultPath || undefined,
        });

        if (!selectedPath) {
            return;
        }

        updateVaultSettings({
            enabled: true,
            vaultPath: selectedPath,
        });
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
        { id: "general" as const, label: "General" },
        { id: "dictionary" as const, label: "Dictionary" },
        { id: "rss" as const, label: "Snapshots" },
        { id: "integrations" as const, label: "Vault" },
        { id: "storage" as const, label: "Storage" },
    ];

    return (
        <div className="mx-auto min-h-full w-full max-w-[var(--layout-content-max-width)] px-4 py-6 sm:px-6 lg:px-8 lg:py-8 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-10">
                <div>
                    <h1 className="m-0 font-sans text-[1.45rem] font-semibold uppercase tracking-[0.12em] leading-[1.1] text-[color:var(--color-text-primary)] sm:text-[1.6rem]">
                        Settings
                    </h1>
                    <p className="mt-1 text-sm leading-relaxed text-[color:var(--color-text-secondary)]">
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
                                    "snap-start flex min-w-[10rem] items-center justify-center border border-[var(--color-border)] px-3 py-2.5 font-sans text-[11px] font-medium transition-colors",
                                    activeTab === tab.id
                                        ? "bg-[var(--color-accent)] text-white !text-white"
                                        : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)]"
                                )}
                            >
                                <span className="truncate">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="hidden sm:flex items-center gap-1 w-fit flex-wrap">
                    {tabButtons.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center border border-[var(--color-border)] px-4 py-2 font-sans text-[11px] font-medium transition-colors",
                                activeTab === tab.id
                                    ? "bg-[var(--color-accent)] text-white !text-white"
                                    : "bg-[var(--color-surface)] text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* General Settings */}
            {activeTab === "general" && (
                <div className="space-y-8">
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
                                ]}
                                value={settings.theme === "system" ? "light" : settings.theme}
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
                                checked={settings.vocabulary.vocabularyEnabled}
                                onChange={(checked) => updateVocabularySettings({ vocabularyEnabled: checked })}
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
                <div className="space-y-8">
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
                                value={settings.vocabulary.dictionaryMode}
                                onChange={(value) => updateVocabularySettings({ dictionaryMode: value })}
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
                                checked={settings.vocabulary.showPronunciation}
                                onChange={(checked) => updateVocabularySettings({ showPronunciation: checked })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Play Audio"
                            description="Auto-play pronunciation audio"
                        >
                            <Toggle
                                checked={settings.vocabulary.playPronunciationAudio}
                                onChange={(checked) => updateVocabularySettings({ playPronunciationAudio: checked })}
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
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm bg-[var(--color-accent)] text-white !text-white hover:opacity-90 transition-opacity"
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
                                description={`${dictionary.language} • StarDict • ${formatFileSize(dictionary.sizeBytes)}`}
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
                <div className="space-y-8">
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
                            <Toggle checked={true} onChange={() => { }} />
                        </SettingRow>

                        <SettingRow
                            label="Offline Reading"
                            description="Download articles for offline access"
                        >
                            <Toggle checked={true} onChange={() => { }} />
                        </SettingRow>
                    </Section>

                </div>
            )}

            {/* Integrations Settings */}
            {activeTab === "integrations" && (
                <div className="space-y-8">
                    <Section
                        title="Vault integration"
                        description="Local-first markdown pipeline for highlights"
                        icon={<BookOpen className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Enable Vault Sync"
                            description="Append highlights to markdown in your selected vault"
                        >
                            <Toggle
                                checked={settings.vault.enabled}
                                onChange={(checked) => updateVaultSettings({ enabled: checked })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Vault Directory"
                            description="Pick the local folder to receive markdown updates"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    type="text"
                                    value={settings.vault.vaultPath}
                                    onChange={(e) => updateVaultSettings({ vaultPath: e.target.value })}
                                    placeholder="/Users/you/Documents/ObsidianVault"
                                    className={cn(
                                        "ui-input",
                                        "min-w-[20rem] sm:w-[28rem]"
                                    )}
                                />
                                <button
                                    onClick={() => {
                                        void handlePickVaultDirectory();
                                    }}
                                    className="ui-btn"
                                >
                                    Pick folder
                                </button>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Auto Export Highlights"
                            description="Write markdown immediately when a highlight or note is saved"
                        >
                            <Toggle
                                checked={settings.vault.autoExportHighlights}
                                onChange={(checked) => updateVaultSettings({ autoExportHighlights: checked })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Markdown File Name"
                            description="Target file created/appended inside selected vault"
                        >
                            <input
                                type="text"
                                value={settings.vault.highlightsFileName}
                                onChange={(e) => updateVaultSettings({ highlightsFileName: e.target.value })}
                                placeholder="theorem-highlights.md"
                                className={cn("ui-input", "min-w-[16rem]")}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Live Sync Status"
                            description="Background append signal for the markdown pipeline"
                        >
                            <div className="border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-sans text-[11px] font-medium text-[color:var(--color-text-primary)]">
                                {vaultSyncStatus === "synced" && "Status: Synced to vault"}
                                {vaultSyncStatus === "syncing" && "Status: Appending to markdown"}
                                {vaultSyncStatus === "error" && "Status: Sync error"}
                                {vaultSyncStatus === "idle" && "Status: Idle"}
                                {vaultSyncMessage ? ` | ${vaultSyncMessage}` : ""}
                                {vaultSyncAt ? ` | ${new Date(vaultSyncAt).toLocaleTimeString()}` : ""}
                            </div>
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
                                                className="px-3 py-1.5 rounded-md text-sm bg-[var(--color-accent)] text-white !text-white hover:opacity-90 transition-opacity"
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
                <div className="space-y-8">
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
