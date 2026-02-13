/**
 * AppTitlebar Component
 * Frameless window title bar with navigation, search, and window controls
 */

import { useState, useEffect } from "react";
import {
    Minus,
    Square,
    X,
    Menu,
    Search,
    BarChart3,
} from "lucide-react";
import { cn } from "@theorem/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "@theorem/core";
import {
    getSearchPlaceholder,
    hasSearchDomain,
    resolveSearchDomain,
} from "@theorem/core";

import { useUIStore } from "@theorem/core";

interface AppTitlebarProps {
    title: string;
    onMenuClick?: () => void;
    className?: string;
}

export function AppTitlebar({
    title,
    onMenuClick,
    className,
}: AppTitlebarProps) {
    const [isMaximized, setIsMaximized] = useState(false);
    const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
    const { currentRoute, searchQuery, setSearchQuery, setRoute } = useUIStore();
    const isTauriRuntime = isTauri();
    const searchDomain = resolveSearchDomain({
        placement: "appTitlebar",
        route: currentRoute,
    });
    const isSearchVisible = hasSearchDomain(searchDomain);
    const searchPlaceholder = getSearchPlaceholder(searchDomain);

    useEffect(() => {
        if (!isTauriRuntime) {
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
    }, [isTauriRuntime]);

    useEffect(() => {
        setIsMobileSearchOpen(false);
    }, [currentRoute]);

    useEffect(() => {
        if (!isSearchVisible) {
            setIsMobileSearchOpen(false);
        }
    }, [isSearchVisible]);

    const handleMinimize = async () => {
        if (!isTauriRuntime) {
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
        if (!isTauriRuntime) {
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
        if (!isTauriRuntime) {
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
            case "bookDetails":
                return "Book Details";
            default:
                return title;
        }
    };

    return (
        <div
            className={cn(
                "w-full z-50 select-none border-b border-[var(--color-border)] ui-panel",
                "px-3 sm:px-4 py-2 sm:py-2.5",
                className
            )}
            data-tauri-drag-region
        >
            <div className="flex items-center justify-between gap-3 sm:gap-4" data-tauri-drag-region>
                {/* Left side - Menu + Title */}
                <div className="flex items-center gap-2 shrink-0 min-w-0" data-tauri-drag-region>
                    {onMenuClick && (
                        <div className="md:hidden">
                            <button
                                onClick={onMenuClick}
                                className="ui-icon-btn w-9 h-9 rounded-xl text-[color:var(--color-text-primary)]"
                                title="Toggle Sidebar"
                            >
                                <Menu className="w-5 h-5" />
                            </button>
                        </div>
                    )}

                    <h1 className="text-sm sm:text-base font-semibold text-[color:var(--color-text-primary)] truncate">
                        {getPageTitle()}
                    </h1>
                </div>

                {/* Center - Search (desktop) */}
                {isSearchVisible && (
                    <div className="hidden lg:flex lg:flex-1 lg:min-w-[18rem] lg:max-w-3xl" data-tauri-drag-region>
                        <div className="relative w-full">
                            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-text-muted)]" />
                            <input
                                type="text"
                                placeholder={searchPlaceholder}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className={cn(
                                    "ui-input ui-input-search ui-input-with-leading-icon w-full pr-4 rounded-xl",
                                    "min-h-[var(--control-height-md)]"
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
                                "lg:!hidden ui-icon-btn w-9 h-9 rounded-xl",
                                isMobileSearchOpen
                                    ? "bg-[var(--color-accent)] ui-text-accent-contrast border border-[var(--color-accent)]"
                                    : "text-[color:var(--color-text-secondary)]"
                            )}
                            title={isMobileSearchOpen ? "Hide search" : "Search"}
                        >
                            <Search className="w-5 h-5" />
                        </button>
                    )}

                    <button
                        onClick={() => setRoute("statistics")}
                        className={cn(
                            "ui-icon-btn w-9 h-9 rounded-xl",
                            currentRoute === "statistics"
                                ? "bg-[var(--color-accent)] ui-text-accent-contrast border border-[var(--color-accent)]"
                                : "text-[color:var(--color-text-secondary)]"
                        )}
                        title="Statistics"
                    >
                        <BarChart3 className="w-5 h-5" />
                    </button>

                    {isTauriRuntime && (
                        <>
                            <div className="hidden sm:block w-px h-5 bg-[var(--color-border)] mx-1" />
                            <button
                                onClick={handleMinimize}
                                className="hidden sm:inline-flex ui-icon-btn w-8 h-8 rounded-lg text-[color:var(--color-text-primary)]"
                                title="Minimize"
                            >
                                <Minus className="w-4 h-4" />
                            </button>
                            <button
                                onClick={handleMaximize}
                                className="hidden sm:inline-flex ui-icon-btn w-8 h-8 rounded-lg text-[color:var(--color-text-primary)]"
                                title={isMaximized ? "Restore" : "Maximize"}
                            >
                                <Square className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={handleClose}
                                className="hidden sm:inline-flex ui-icon-btn ui-icon-btn-danger w-8 h-8 rounded-lg text-[color:var(--color-text-primary)]"
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
                <div className="mt-2 lg:hidden">
                    <div className="relative w-full">
                        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[color:var(--color-text-muted)]" />
                        <input
                            type="text"
                            placeholder={searchPlaceholder}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            autoFocus
                            className={cn(
                                "ui-input ui-input-search ui-input-with-leading-icon w-full pr-12 rounded-xl",
                                "min-h-[var(--control-height-md)]"
                            )}
                        />
                        <button
                            onClick={() => setIsMobileSearchOpen(false)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 ui-icon-btn w-7 h-7 rounded-lg text-[color:var(--color-text-muted)]"
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
                            className={cn(
                                "ui-input ui-input-search ui-input-with-leading-icon w-full pr-4 rounded-xl",
                                "min-h-[var(--control-height-md)]"
                            )}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

export default AppTitlebar;
