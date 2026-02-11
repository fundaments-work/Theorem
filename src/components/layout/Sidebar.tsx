import { useCallback, useRef, useEffect } from "react";
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
    X,
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

interface SidebarProps {
    isMobile?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isMobile, onClose }: SidebarProps) {
    const { currentRoute, setRoute, sidebarOpen, toggleSidebar } = useUIStore();
    const { settings, updateSettings } = useSettingsStore();
    const sidebarRef = useRef<HTMLElement>(null);
    const touchStartX = useRef<number>(0);

    const handleToggle = useCallback(() => {
        toggleSidebar();
        updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
    }, [toggleSidebar, updateSettings, settings.sidebarCollapsed]);

    // Swipe to close handler for mobile
    useEffect(() => {
        if (!isMobile) return;

        const sidebar = sidebarRef.current;
        if (!sidebar) return;

        const handleTouchStart = (e: TouchEvent) => {
            touchStartX.current = e.touches[0].clientX;
        };

        const handleTouchEnd = (e: TouchEvent) => {
            const touchEndX = e.changedTouches[0].clientX;
            const diff = touchStartX.current - touchEndX;

            // Swipe left more than 50px to close
            if (diff > 50 && onClose) {
                onClose();
            }
        };

        sidebar.addEventListener("touchstart", handleTouchStart, { passive: true });
        sidebar.addEventListener("touchend", handleTouchEnd, { passive: true });

        return () => {
            sidebar.removeEventListener("touchstart", handleTouchStart);
            sidebar.removeEventListener("touchend", handleTouchEnd);
        };
    }, [isMobile, onClose]);

    return (
        <aside
            ref={sidebarRef}
            className={cn(
                "flex flex-col h-full border-r border-[var(--color-border)]",
                "ui-panel",
                "transition-[width] duration-220 ease-out",
                (sidebarOpen || isMobile) ? "w-[var(--layout-sidebar-width)]" : "w-[var(--layout-sidebar-collapsed-width)]"
            )}
        >
            {/* Header - Logo + App Name (visible on all screens) */}
            <div className={cn(
                "flex items-center justify-between px-4 border-b border-[var(--color-border)] h-16"
            )}>
                <div className="flex items-center gap-3 overflow-hidden">
                    <LionLogo size={28} className="flex-shrink-0" />
                    <span className={cn(
                        "font-semibold text-lg text-[var(--color-text-primary)] whitespace-nowrap",
                        !isMobile && !sidebarOpen ? "opacity-0 w-0" : "opacity-100"
                    )}>
                        Lion Reader
                    </span>
                </div>
                {/* Close button - only on mobile */}
                {isMobile && onClose && (
                    <button
                        onClick={onClose}
                        className="ui-icon-btn w-9 h-9 rounded-lg text-[var(--color-text-secondary)]"
                        aria-label="Close sidebar"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
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
                                    // Close mobile sidebar on navigation
                                    if (isMobile && onClose) {
                                        onClose();
                                    }
                                }}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl ui-clickable",
                                    "hover:bg-[var(--color-surface-muted)]",
                                    currentRoute === item.id
                                        ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] border border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-border))]"
                                        : "text-[var(--color-text-secondary)]"
                                )}
                                title={!sidebarOpen ? item.label : undefined}
                            >
                                <span className="flex-shrink-0">{item.icon}</span>
                                {(sidebarOpen || isMobile) && (
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
                            onClick={() => {
                                setRoute("shelves");
                                if (isMobile && onClose) {
                                    onClose();
                                }
                            }}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl ui-clickable",
                                "hover:bg-[var(--color-surface-muted)]",
                                currentRoute === "shelves"
                                    ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] border border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-border))]"
                                    : "text-[var(--color-text-secondary)]"
                            )}
                            title={!sidebarOpen ? "Shelves" : undefined}
                        >
                            <span className="flex-shrink-0">
                                <FolderOpen className="w-5 h-5" />
                            </span>
                            {(sidebarOpen || isMobile) && (
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
                    onClick={() => {
                        setRoute("settings");
                        if (isMobile && onClose) {
                            onClose();
                        }
                    }}
                    className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-xl ui-clickable hover:bg-[var(--color-surface-muted)]",
                        sidebarOpen ? "flex-1" : "w-full justify-center",
                        currentRoute === "settings"
                            ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] border border-[color-mix(in_srgb,var(--color-accent)_35%,var(--color-border))]"
                            : "text-[var(--color-text-secondary)]"
                    )}
                    title={!sidebarOpen ? "Settings" : undefined}
                >
                    <span className="flex-shrink-0"><Settings className="w-5 h-5" /></span>
                    {(sidebarOpen || isMobile) && (
                        <span className="font-medium text-sm animate-fade-in">
                            Settings
                        </span>
                    )}
                </button>

                {/* Collapse Toggle - desktop only */}
                {!isMobile && (
                    <button
                        onClick={handleToggle}
                        className={cn(
                            "flex items-center justify-center p-2.5 rounded-xl ui-clickable",
                            "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]",
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
                )}
            </div>

        </aside>
    );
}
