/**
 * AppTitlebar Component
 * Frameless window title bar with navigation, search, and window controls
 */

import { useState, useEffect } from "react";
import type { KeyboardEvent } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
    Minus,
    Square,
    X,
    Search,
    BarChart3,
    ArrowDownUp,
} from "lucide-react";
import {
    cn,
    getPairedDevices,
    getSearchPlaceholder,
    hasSearchDomain,
    isMobile,
    isTauri,
    resolveSearchDomain,
    runDeviceSync,
    useUIStore,
} from "../core";
import { TheoremLogo } from "./TheoremLogo";

interface AppTitlebarProps {
    title: string;
    className?: string;
}

const TITLEBAR_ICON_BUTTON =
    "ui-icon-btn !h-9 !w-9";
const TITLEBAR_WINDOW_BUTTON =
    "ui-icon-btn hidden sm:inline-flex !h-8 !w-8 border-transparent bg-transparent";
const TITLEBAR_CLOSE_BUTTON = `${TITLEBAR_WINDOW_BUTTON} hover:bg-[color:color-mix(in_srgb,var(--color-error)_14%,transparent)] hover:text-[color:var(--color-error)] hover:border-[color:color-mix(in_srgb,var(--color-error)_35%,var(--color-border))]`;
const TITLEBAR_SEARCH_INPUT =
    "ui-input bg-[var(--color-surface)] pl-[calc(var(--control-padding-x)+var(--icon-size-sm)+var(--spacing-md))]";

export function AppTitlebar({
    title,
    className,
}: AppTitlebarProps) {
    const [isMaximized, setIsMaximized] = useState(false);
    const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
    const [isQuickSyncing, setIsQuickSyncing] = useState(false);
    const currentRoute = useUIStore((state) => state.currentRoute);
    const searchQuery = useUIStore((state) => state.searchQuery);
    const setSearchQuery = useUIStore((state) => state.setSearchQuery);
    const commitSearch = useUIStore((state) => state.commitSearch);
    const setRoute = useUIStore((state) => state.setRoute);
    const setDeviceSyncStatus = useUIStore((state) => state.setDeviceSyncStatus);
    const deviceSyncStatus = useUIStore((state) => state.deviceSyncStatus);
    const isTauriRuntime = isTauri();
    const isMobileRuntime = isMobile();
    const showDesktopWindowControls = isTauriRuntime && !isMobileRuntime;
    const searchDomain = resolveSearchDomain({
        placement: "appTitlebar",
        route: currentRoute,
    });
    const isSearchVisible = hasSearchDomain(searchDomain);
    const searchPlaceholder = getSearchPlaceholder(searchDomain);

    useEffect(() => {
        if (!showDesktopWindowControls) {
            return;
        }

        const updateMaximizedState = async () => {
            try {
                const win = getCurrentWebviewWindow();
                const maximized = await win.isMaximized();
                setIsMaximized(maximized);
            } catch (err) {
                // Fallback to window size detection if Tauri API fails
                const isMax = window.innerWidth === window.screen.availWidth &&
                    window.innerHeight === window.screen.availHeight;
                setIsMaximized(isMax);
            }
        };

        const handleResize = () => {
            updateMaximizedState();
        };

        window.addEventListener("resize", handleResize);
        updateMaximizedState();

        return () => window.removeEventListener("resize", handleResize);
    }, [showDesktopWindowControls]);

    useEffect(() => {
        setIsMobileSearchOpen(false);
    }, [currentRoute]);

    useEffect(() => {
        if (!isSearchVisible) {
            setIsMobileSearchOpen(false);
        }
    }, [isSearchVisible]);

    const handleMinimize = async () => {
        if (!showDesktopWindowControls) {
            return;
        }
        try {
            const win = getCurrentWebviewWindow();
            await win.minimize();
        } catch (err) {
            console.error("Failed to minimize window:", err);
        }
    };

    const handleMaximize = async () => {
        if (!showDesktopWindowControls) {
            return;
        }
        try {
            const win = getCurrentWebviewWindow();
            if (isMaximized) {
                await win.unmaximize();
            } else {
                await win.maximize();
            }
        } catch (err) {
            console.error("Failed to maximize window:", err);
        }
    };

    const handleClose = async () => {
        if (!showDesktopWindowControls) {
            return;
        }
        try {
            const win = getCurrentWebviewWindow();
            await win.close();
        } catch (err) {
            console.error("Failed to close window:", err);
        }
    };

    const getPageTitle = () => {
        switch (currentRoute) {
            case "library":
                return "Library";
            case "reader":
                return "Books";
            case "vocabulary":
                return "Vocabulary";
            case "settings":
                return "Settings";
            case "statistics":
                return "Statistics";
            case "annotations":
                return "Highlights & Notes";
            case "bookmarks":
                return "Bookmarks";
            case "shelves":
                return "Shelves";
            case "feeds":
                return "Feeds";
            default:
                return title;
        }
    };

    const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            commitSearch();
        }
    };

    const openDeviceSyncSettings = () => {
        if (typeof window !== "undefined") {
            window.sessionStorage.setItem("theorem-settings:active-tab", "integrations");
            window.sessionStorage.setItem("theorem-settings:focus-section", "device-sync");
        }
        setRoute("settings");
    };

    const handleQuickSync = async () => {
        if (isQuickSyncing || deviceSyncStatus === "syncing") {
            return;
        }

        if (!isTauriRuntime) {
            setDeviceSyncStatus("idle", "Device sync is available in desktop/mobile app.");
            return;
        }

        setIsQuickSyncing(true);

        try {
            const pairedDevices = await getPairedDevices();

            if (pairedDevices.length === 0) {
                setDeviceSyncStatus("idle", "No paired devices yet. Pair one in Settings > Device Sync.");
                openDeviceSyncSettings();
                return;
            }

            if (pairedDevices.length > 1) {
                setDeviceSyncStatus("idle", "Multiple devices found. Choose one in Settings > Device Sync.");
                openDeviceSyncSettings();
                return;
            }

            const target = pairedDevices[0];
            setDeviceSyncStatus(
                "syncing",
                `Syncing with ${target.deviceName || target.deviceId}...`,
            );

            const result = await runDeviceSync(target.deviceId);
            if (result.success) {
                const summary = result.domainsUpdated.length > 0
                    ? `Updated ${result.domainsUpdated.length} domain(s)`
                    : "Already in sync";
                setDeviceSyncStatus("synced", summary);
                return;
            }

            setDeviceSyncStatus("error", result.error || "Sync failed");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            setDeviceSyncStatus("error", message);
        } finally {
            setIsQuickSyncing(false);
        }
    };

    return (
        <div
            className={cn(
                "w-full z-50 select-none border-b border-[var(--color-border)] bg-[var(--color-surface)]",
                "px-4 pb-3 pt-[calc(env(safe-area-inset-top)+var(--spacing-sm))] lg:h-[4rem] lg:py-4 lg:px-14",
                className
            )}
            data-tauri-drag-region={showDesktopWindowControls ? "true" : undefined}
        >
            <div
                className="flex items-center justify-between gap-3 sm:gap-4"
                data-tauri-drag-region={showDesktopWindowControls ? "true" : undefined}
            >
                {/* Left side - Menu + Title */}
                <div
                    className="flex items-center gap-2 shrink-0 min-w-0"
                    data-tauri-drag-region={showDesktopWindowControls ? "true" : undefined}
                >

                    <button
                        onClick={() => setRoute("library")}
                        className="sm:hidden inline-flex items-center p-1 -ml-1"
                        title="Go to Library"
                    >
                        <div>
                            <TheoremLogo size={24} />
                        </div>
                    </button>

                    <h1 className="hidden sm:block font-sans text-sm font-semibold text-[color:var(--color-text-primary)] truncate">
                        {getPageTitle()}
                    </h1>
                </div>

                {/* Center - Search (desktop) */}
                {isSearchVisible && (
                    <div
                        className="hidden lg:flex lg:flex-1 lg:min-w-[18rem] lg:max-w-3xl"
                        data-tauri-drag-region={showDesktopWindowControls ? "true" : undefined}
                    >
                        <div className="relative w-full">
                            <input
                                type="text"
                                placeholder={searchPlaceholder}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={handleSearchKeyDown}
                                className={cn(
                                    TITLEBAR_SEARCH_INPUT,
                                    "pr-4"
                                )}
                            />
                        </div>
                    </div>
                )}

                {/* Right side - Stats button + Window controls */}
                <div className="flex items-center gap-1 shrink-0">
                    {isSearchVisible && (
                        <button
                            onClick={() => setIsMobileSearchOpen((prev) => !prev)}
                            className={cn(
                                "sm:!hidden",
                                TITLEBAR_ICON_BUTTON
                            )}
                            title={isMobileSearchOpen ? "Hide search" : "Search"}
                            data-active={isMobileSearchOpen ? "true" : undefined}
                            aria-pressed={isMobileSearchOpen}
                        >
                            <Search className="w-5 h-5" />
                        </button>
                    )}

                    <button
                        onClick={() => {
                            void handleQuickSync();
                        }}
                        className={cn(
                            TITLEBAR_ICON_BUTTON,
                            (deviceSyncStatus === "syncing" || isQuickSyncing) && "text-[color:var(--color-accent)]",
                            deviceSyncStatus === "error" && "text-[color:var(--color-error)]",
                        )}
                        title={
                            isQuickSyncing || deviceSyncStatus === "syncing"
                                ? "Syncing devices..."
                                : "Sync devices"
                        }
                        data-active={
                            isQuickSyncing || deviceSyncStatus === "syncing"
                                ? "true"
                                : undefined
                        }
                        aria-pressed={isQuickSyncing || deviceSyncStatus === "syncing"}
                        aria-label="Sync devices"
                    >
                        <ArrowDownUp
                            className={cn(
                                "w-5 h-5",
                                (deviceSyncStatus === "syncing" || isQuickSyncing) && "animate-spin",
                            )}
                        />
                    </button>

                    <button
                        onClick={() => setRoute("statistics")}
                        className={cn(
                            TITLEBAR_ICON_BUTTON
                        )}
                        title="Statistics"
                        data-active={currentRoute === "statistics" ? "true" : undefined}
                        aria-pressed={currentRoute === "statistics"}
                    >
                        <BarChart3 className="w-5 h-5" />
                    </button>

                    {showDesktopWindowControls && (
                        <>
                            <div className="hidden sm:block w-px h-5 bg-[var(--color-border)] mx-1" />
                            <button
                                onClick={handleMinimize}
                                className={TITLEBAR_WINDOW_BUTTON}
                                title="Minimize"
                            >
                                <Minus className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleMaximize}
                                className={TITLEBAR_WINDOW_BUTTON}
                                title={isMaximized ? "Restore" : "Maximize"}
                            >
                                <Square className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={handleClose}
                                className={TITLEBAR_CLOSE_BUTTON}
                                title="Close"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Search - Mobile (toggle from icon) */}
            {isSearchVisible && isMobileSearchOpen && (
                <div className="mt-2 sm:hidden">
                    <div className="relative w-full">
                        <input
                            type="text"
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            autoFocus
                            className={cn(
                                TITLEBAR_SEARCH_INPUT,
                                "pr-12"
                            )}
                        />
                        <button
                            onClick={() => setIsMobileSearchOpen(false)}
                            className={cn(
                                "absolute right-2 top-1/2 -translate-y-1/2 !h-7 !w-7",
                                "ui-icon-btn"
                            )}
                            title="Close search"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* Search - Tablet layouts (hidden on phone sizes) */}
            {isSearchVisible && (
                <div className="mt-2 hidden sm:block lg:hidden">
                    <div className="relative w-full">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-text-muted)]" />
                        <input
                            type="text"
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchKeyDown}
                            className={cn(
                                TITLEBAR_SEARCH_INPUT,
                                "pr-4"
                            )}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default AppTitlebar;
