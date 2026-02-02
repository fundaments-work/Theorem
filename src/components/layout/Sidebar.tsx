import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { useUIStore, useSettingsStore } from "@/store";
import type { AppRoute } from "@/types";
import { LionLogo } from "@/components/LionLogo";
import {
    Library,
    Bookmark,
    Settings,
    ChevronLeft,
    ChevronRight,
    Highlighter,
    FolderOpen,
} from "lucide-react";

interface SidebarItem {
    id: AppRoute;
    label: string;
    icon: React.ReactNode;
}

const mainNavItems: SidebarItem[] = [
    { id: "library", label: "Library", icon: <Library className="w-5 h-5" /> },
    { id: "annotations", label: "Highlights", icon: <Highlighter className="w-5 h-5" /> },
    { id: "bookmarks", label: "Bookmarks", icon: <Bookmark className="w-5 h-5" /> },
];

export function Sidebar() {
    const { currentRoute, setRoute, sidebarOpen, toggleSidebar } = useUIStore();
    const { settings, updateSettings } = useSettingsStore();

    const handleToggle = useCallback(() => {
        toggleSidebar();
        updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
    }, [toggleSidebar, updateSettings, settings.sidebarCollapsed]);

    return (
        <aside
            className={cn(
                "flex flex-col h-full bg-[var(--color-surface)] border-r border-[var(--color-border)]",
                "transition-all duration-300 ease-in-out",
                sidebarOpen ? "w-56" : "w-16"
            )}
        >
            {/* Logo - hidden on mobile, visible on md and up */}
            <div className="hidden md:flex items-center h-14 px-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2 overflow-hidden">
                    <LionLogo size={28} className="flex-shrink-0" />
                    <span className={cn(
                        "font-semibold text-lg text-[var(--color-text-primary)] whitespace-nowrap",
                        sidebarOpen ? "opacity-100" : "opacity-0 w-0"
                    )}>
                    </span>
                </div>
            </div>

            {/* Navigation Items */}
            <nav className="flex-1 py-4 overflow-y-auto scrollbar-hide">
                <ul className="space-y-1 px-2">
                    {/* Main Navigation */}
                    {mainNavItems.map((item) => (
                        <li key={item.id}>
                            <button
                                onClick={() => {
                                    setRoute(item.id);
                                    // Clear shelf filter when navigating away from library
                                    if (item.id !== "library") {
                                        sessionStorage.removeItem("lion-reader-selected-shelf");
                                    }
                                }}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg",
                                    "transition-colors duration-200",
                                    "hover:bg-[var(--color-border-subtle)]",
                                    currentRoute === item.id
                                        ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                                        : "text-[var(--color-text-secondary)]"
                                )}
                                title={!sidebarOpen ? item.label : undefined}
                            >
                                <span className="flex-shrink-0">{item.icon}</span>
                                {sidebarOpen && (
                                    <span className="font-medium text-sm animate-fade-in">
                                        {item.label}
                                    </span>
                                )}
                            </button>
                        </li>
                    ))}

                    {/* Shelves Link - navigates to dedicated shelves page */}
                    <li>
                        <button
                            onClick={() => setRoute("shelves")}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg",
                                "transition-colors duration-200",
                                "hover:bg-[var(--color-border-subtle)]",
                                currentRoute === "shelves"
                                    ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                                    : "text-[var(--color-text-secondary)]"
                            )}
                            title={!sidebarOpen ? "Shelves" : undefined}
                        >
                            <span className="flex-shrink-0">
                                <FolderOpen className="w-5 h-5" />
                            </span>
                            {sidebarOpen && (
                                <span className="font-medium text-sm animate-fade-in flex-1 text-left">
                                    Shelves
                                </span>
                            )}
                        </button>
                    </li>
                </ul>
            </nav>

            {/* Bottom Actions */}
            <div className={cn(
                "p-2 border-t border-[var(--color-border)] flex",
                sidebarOpen ? "flex-row items-center gap-1" : "flex-col space-y-1"
            )}>
                {/* Settings */}
                <button
                    onClick={() => setRoute("settings")}
                    className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-200 hover:bg-[var(--color-border-subtle)]",
                        sidebarOpen ? "flex-1" : "w-full justify-center",
                        currentRoute === "settings"
                            ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                            : "text-[var(--color-text-secondary)]"
                    )}
                    title={!sidebarOpen ? "Settings" : undefined}
                >
                    <span className="flex-shrink-0"><Settings className="w-5 h-5" /></span>
                    {sidebarOpen && (
                        <span className="font-medium text-sm animate-fade-in">
                            Settings
                        </span>
                    )}
                </button>

                {/* Collapse Toggle */}
                <button
                    onClick={handleToggle}
                    className={cn(
                        "flex items-center justify-center p-2.5 rounded-lg",
                        "text-[var(--color-text-muted)] hover:bg-[var(--color-border-subtle)]",
                        "transition-colors duration-200",
                        sidebarOpen ? "w-10" : "w-full"
                    )}
                    title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                >
                    {sidebarOpen ? (
                        <ChevronLeft className="w-5 h-5" />
                    ) : (
                        <ChevronRight className="w-5 h-5" />
                    )}
                </button>
            </div>

        </aside>
    );
}
