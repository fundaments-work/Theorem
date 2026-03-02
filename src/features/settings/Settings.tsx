/**
 * Settings Page
 * App configuration and preferences
 */

import { useRef, useState, useEffect, type ChangeEvent } from "react";
import { cn } from "../../core";
import {
    showOpenDirectoryDialog,
    showSaveFileDialog,
    syncVaultMarkdownSnapshot,
    exportUnifiedSyncBundle,
    estimateSyncBundleSizeBytes,
    isMobile,
    isTauri,
    normalizeFilePath,
    pickLibraryFolderMobile,
    useVocabularyStore,
    useLibraryStore,
    useRssStore,
    useSettingsStore,
    useUIStore,
} from "../../core";
import { formatFileSize } from "../../core";
import { confirmClearAllData } from "../../core";
import { clearAllApplicationStorage, getRssStorageStats } from "../../core/lib/storage-manager";
import { DeviceSyncSection } from "./DeviceSync";
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
    WifiOff,
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

function normalizeHighlightsExportName(value: string): string {
    return value.replace(/\.md$/i, "").trim();
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
                        ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
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
                        ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
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
                            ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
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
    const articles = useRssStore((state) => state.articles);
    const highlightsExportName = normalizeHighlightsExportName(settings.vault.highlightsFileName);
    const primaryLibraryFolder = settings.scanFolders[0] || "";
    const isMobilePlatform = isMobile();
    const setVaultSyncStatus = useUIStore((state) => state.setVaultSyncStatus);
    const vaultSyncStatus = useUIStore((state) => state.vaultSyncStatus);
    const vaultSyncMessage = useUIStore((state) => state.vaultSyncMessage);
    const vaultSyncAt = useUIStore((state) => state.vaultSyncAt);
    const { vocabularyTerms, installedDictionaries, importStarDict, removeDictionary } = useVocabularyStore();
    const [activeTab, setActiveTab] = useState<
        "general" | "dictionary" | "integrations" | "storage"
    >("general");

    const dictionaryFileInputRef = useRef<HTMLInputElement>(null);

    const totalStorage = books.reduce((acc, b) => acc + b.fileSize, 0);
    const offlineDictionarySize = installedDictionaries.reduce(
        (acc, dictionary) => acc + dictionary.sizeBytes,
        0,
    );

    const [rssStats, setRssStats] = useState<{ articleCount: number; totalSize: number }>({ articleCount: 0, totalSize: 0 });

    useEffect(() => {
        getRssStorageStats().then(setRssStats);
    }, []);

    const handleClearData = async () => {
        const confirmed = await confirmClearAllData();
        if (!confirmed) return;

        try {
            await clearAllApplicationStorage();

            const storesToClear: PersistableStore[] = [
                useSettingsStore as unknown as PersistableStore,
                useLibraryStore as unknown as PersistableStore,
                useVocabularyStore as unknown as PersistableStore,
                useRssStore as unknown as PersistableStore,
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

            window.location.reload();
        } catch (error) {
            console.error("[Settings] Failed to clear all data:", error);
        }
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
        if (isMobilePlatform) {
            alert("Folder selection is not supported on mobile. Configure export path on desktop.");
            return;
        }

        const selectedPath = await showOpenDirectoryDialog({
            title: "Choose Export Folder",
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

    const handlePickLibraryFolder = async () => {
        if (isMobilePlatform) {
            const selectedUri = await pickLibraryFolderMobile();
            if (!selectedUri) {
                return;
            }
            updateSettings({ scanFolders: [selectedUri] });
            return;
        }

        const selectedPath = await showOpenDirectoryDialog({
            title: "Choose Library Folder",
            defaultPath: primaryLibraryFolder || undefined,
        });

        if (!selectedPath) {
            return;
        }

        const normalizedPath = normalizeFilePath(selectedPath);
        updateSettings({
            scanFolders: normalizedPath ? [normalizedPath] : [],
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

    const handleSyncVaultNow = async () => {
        setVaultSyncStatus("syncing", "STATUS: SYNCING_MARKDOWN_EXPORT");
        const result = await syncVaultMarkdownSnapshot({
            books,
            annotations,
            rssArticles: articles,
            vocabularyTerms,
            settings: settings.vault,
        });

        if (result.status === "synced") {
            setVaultSyncStatus("synced", result.message, new Date().toISOString());
            return;
        }

        if (result.status === "error") {
            setVaultSyncStatus("error", result.message);
            return;
        }

        setVaultSyncStatus("idle", result.message);
    };

    const handleExportData = async () => {
        try {
            const { bundle, warnings } = await exportUnifiedSyncBundle();
            const bundleSize = estimateSyncBundleSizeBytes(bundle);
            const payload = JSON.stringify(bundle, null, 2);
            const defaultFileName = `theorem-sync-${new Date().toISOString().slice(0, 10)}.json`;

            if (isTauri()) {
                const outputPath = await showSaveFileDialog({
                    title: "Export Unified Sync Bundle",
                    defaultPath: defaultFileName,
                    filters: [{ name: "JSON", extensions: ["json"] }],
                });

                if (!outputPath) {
                    return;
                }

                const { writeTextFile } = await import("@tauri-apps/plugin-fs");
                await writeTextFile(outputPath, payload);
            } else {
                const blob = new Blob([payload], { type: "application/json" });
                const objectUrl = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = objectUrl;
                link.download = defaultFileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(objectUrl);
            }

            const warningSuffix = warnings.length > 0
                ? ` Warnings: ${warnings.length} missing binary item(s).`
                : "";
            alert(`Export complete (${formatFileSize(bundleSize)}).${warningSuffix}`);
        } catch (error) {
            console.error("[Settings] Failed to export unified sync bundle:", error);
            alert(error instanceof Error ? error.message : "Failed to export data.");
        }
    };

    const tabButtons = [
        { id: "general" as const, label: "General" },
        { id: "dictionary" as const, label: "Dictionary" },
        { id: "integrations" as const, label: "Sync & Devices" },
        { id: "storage" as const, label: "Data & Storage" },
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
                                        ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
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
                                    ? "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)]"
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

                        <SettingRow
                            label="Library Folder"
                            description={
                                isMobilePlatform
                                    ? "Pick a documents folder (SAF) for mobile folder scanning."
                                    : "Default folder used when scanning books from the Library page"
                            }
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    type="text"
                                    value={primaryLibraryFolder}
                                    readOnly
                                    placeholder="Not configured"
                                    className={cn("ui-input", "min-w-[20rem] sm:w-[28rem]")}
                                />
                                <button
                                    onClick={() => {
                                        void handlePickLibraryFolder();
                                    }}
                                    className="ui-btn"
                                >
                                    Pick folder
                                </button>
                                {primaryLibraryFolder && (
                                    <button
                                        onClick={() => updateSettings({ scanFolders: [] })}
                                        className="ui-btn"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
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
                                        "w-20 px-3 py-1.5 text-sm",
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
                                        "w-20 px-3 py-1.5 text-sm",
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
                            <div className="mt-2 h-2 bg-[var(--color-surface-muted)] overflow-hidden">
                                <div
                                    className="h-full bg-[var(--color-accent)] transition-all duration-500"
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
                            className="ui-btn-danger"
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
                            <span className="text-sm text-[color:var(--color-text-muted)] px-3 py-1.5 bg-[var(--color-surface-muted)]">
                                Free Dictionary API
                            </span>
                        </SettingRow>

                        <SettingRow
                            label="Fallback"
                            description="Secondary dictionary source"
                        >
                            <span className="text-sm text-[color:var(--color-text-muted)] px-3 py-1.5 bg-[var(--color-surface-muted)]">
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
                                    className="ui-btn-primary"
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
                                    className="ui-btn-danger"
                                >
                                    Remove
                                </button>
                            </SettingRow>
                        ))}

                        <SettingRow
                            label="Offline Mode Guard"
                            description="When offline mode is enabled without dictionaries, lookups will show setup guidance"
                        >
                            <span className="text-sm text-[color:var(--color-text-muted)] px-3 py-1.5 bg-[var(--color-surface-muted)]">
                                Enabled
                            </span>
                        </SettingRow>
                    </Section>
                </div>
            )}


            {/* Integrations Settings */}
            {activeTab === "integrations" && (
                <div className="space-y-8">
                    <Section
                        title="Export and sync"
                        description="Local-first markdown sync for highlights, notes, and vocabulary"
                        icon={<BookOpen className="w-5 h-5" />}
                    >
                        <SettingRow
                            label="Enable Export Sync"
                            description="Enable markdown sync in your selected export folder"
                        >
                            <Toggle
                                checked={settings.vault.enabled}
                                onChange={(checked) => updateVaultSettings({ enabled: checked })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Export Folder"
                            description={
                                isMobilePlatform
                                    ? "Folder selection is unavailable on mobile. Configure export path on desktop."
                                    : "Pick the local folder to receive markdown updates"
                            }
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    type="text"
                                    value={settings.vault.vaultPath}
                                    onChange={(e) => updateVaultSettings({ vaultPath: e.target.value })}
                                    placeholder="/Users/you/Documents/Reading-Exports"
                                    className={cn(
                                        "ui-input",
                                        "min-w-[20rem] sm:w-[28rem]"
                                    )}
                                />
                                <button
                                    onClick={() => {
                                        void handlePickVaultDirectory();
                                    }}
                                    disabled={isMobilePlatform}
                                    className={cn("ui-btn", isMobilePlatform && "pointer-events-none opacity-50")}
                                >
                                    Pick folder
                                </button>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label="Auto Export Highlights"
                            description="Rebuild markdown pages when a highlight or note is saved"
                        >
                            <Toggle
                                checked={settings.vault.autoExportHighlights}
                                onChange={(checked) => updateVaultSettings({ autoExportHighlights: checked })}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Highlights Export Name"
                            description="Base name for highlights pages folder (<name>-books). .md suffix is ignored."
                        >
                            <input
                                type="text"
                                value={highlightsExportName}
                                onChange={(e) => (
                                    updateVaultSettings({
                                        highlightsFileName: normalizeHighlightsExportName(e.target.value),
                                    })
                                )}
                                placeholder="theorem-highlights"
                                className={cn("ui-input", "min-w-[16rem]")}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Vocabulary File"
                            description="Vocabulary markdown file generated inside selected export folder"
                        >
                            <input
                                type="text"
                                value={settings.vault.vocabularyFileName}
                                onChange={(e) => updateVaultSettings({ vocabularyFileName: e.target.value })}
                                placeholder="theorem-vocabulary.md"
                                className={cn("ui-input", "min-w-[16rem]")}
                            />
                        </SettingRow>

                        <SettingRow
                            label="Sync Markdown Now"
                            description="Export all book/article highlight pages and vocabulary immediately"
                        >
                            <button
                                onClick={() => {
                                    void handleSyncVaultNow();
                                }}
                                disabled={vaultSyncStatus === "syncing"}
                                className={cn(
                                    "ui-btn",
                                    vaultSyncStatus === "syncing" && "pointer-events-none opacity-60",
                                )}
                            >
                                {vaultSyncStatus === "syncing" ? "Syncing..." : "Sync now"}
                            </button>
                        </SettingRow>

                        <SettingRow
                            label="Live Sync Status"
                            description="Latest markdown export status"
                        >
                            <div className="border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 font-sans text-[11px] font-medium text-[color:var(--color-text-primary)]">
                                {vaultSyncStatus === "synced" && "Status: Synced to export folder"}
                                {vaultSyncStatus === "syncing" && "Status: Syncing markdown pages"}
                                {vaultSyncStatus === "error" && "Status: Sync error"}
                                {vaultSyncStatus === "idle" && "Status: Idle"}
                                {vaultSyncMessage ? ` | ${vaultSyncMessage}` : ""}
                                {vaultSyncAt ? ` | ${new Date(vaultSyncAt).toLocaleTimeString()}` : ""}
                            </div>
                        </SettingRow>
                    </Section>

                    <DeviceSyncSection />
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
                            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)]">
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

                            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)]">
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

                            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)]">
                                <div className="flex items-center gap-3">
                                    <Rss className="w-5 h-5 text-[color:var(--color-text-muted)]" />
                                    <div>
                                        <p className="font-medium text-sm text-[color:var(--color-text-primary)]">RSS Articles</p>
                                        <p className="text-xs text-[color:var(--color-text-muted)]">
                                            {rssStats.articleCount} {rssStats.articleCount === 1 ? "article" : "articles"} cached
                                        </p>
                                    </div>
                                </div>
                                <span className="text-sm font-medium text-[color:var(--color-text-primary)]">
                                    {formatFileSize(rssStats.totalSize)}
                                </span>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-[var(--color-surface-muted)]">
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
                                    "w-full flex items-center gap-3 p-4",
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
                                onClick={handleExportData}
                                className={cn(
                                    "w-full flex items-center gap-3 p-4",
                                    "border border-[var(--color-border)]",
                                    "text-[color:var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]",
                                    "transition-colors text-left"
                                )}
                            >
                                <Download className="w-5 h-5" />
                                <div className="flex-1">
                                    <p className="font-medium text-sm">Export Data</p>
                                    <p className="text-xs text-[color:var(--color-text-muted)]">
                                        Export full sync bundle with books, highlights, vocabulary, RSS, and dictionaries
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
