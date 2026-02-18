import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
    BookOpenText,
    Bookmark,
    ChevronLeft,
    ChevronRight,
    FolderOpen,
    Highlighter,
    Library,
    Rss,
    Settings,
} from "lucide-react";
import { cn } from "../../core";
import { useUIStore, useSettingsStore } from "../../core";
import type { AppRoute } from "../../core";
import { TheoremLogo } from "../TheoremLogo";

interface SidebarItem {
    id: AppRoute;
    label: string;
    icon: ReactNode;
}

const mainNavItems: SidebarItem[] = [
    { id: "library", label: "Library", icon: <Library className="h-4 w-4" /> },
    { id: "vocabulary", label: "Vocabulary", icon: <BookOpenText className="h-4 w-4" /> },
    { id: "annotations", label: "Highlights", icon: <Highlighter className="h-4 w-4" /> },
    { id: "bookmarks", label: "Bookmarks", icon: <Bookmark className="h-4 w-4" /> },
    { id: "shelves", label: "Shelves", icon: <FolderOpen className="h-4 w-4" /> },
    { id: "feeds", label: "Snapshots", icon: <Rss className="h-4 w-4" /> },
];

interface SidebarProps {
    isMobile?: boolean;
    onClose?: () => void;
}

export function Sidebar({ isMobile, onClose }: SidebarProps) {
    const currentRoute = useUIStore((state) => state.currentRoute);
    const setRoute = useUIStore((state) => state.setRoute);
    const sidebarOpen = useUIStore((state) => state.sidebarOpen);
    const toggleSidebar = useUIStore((state) => state.toggleSidebar);
    const sidebarCollapsed = useSettingsStore((state) => state.settings.sidebarCollapsed);
    const vocabularyEnabled = useSettingsStore((state) => state.settings.vocabulary.vocabularyEnabled);
    const updateSettings = useSettingsStore((state) => state.updateSettings);
    const sidebarRef = useRef<HTMLElement>(null);
    const touchStartX = useRef<number>(0);
    const isCollapsedDesktop = !isMobile && !sidebarOpen;
    const showDesktopFooterRow = !isMobile && sidebarOpen;

    const handleToggle = useCallback(() => {
        toggleSidebar();
        updateSettings({ sidebarCollapsed: !sidebarCollapsed });
    }, [sidebarCollapsed, toggleSidebar, updateSettings]);

    useEffect(() => {
        if (!isMobile) return;

        const sidebar = sidebarRef.current;
        if (!sidebar) return;

        const handleTouchStart = (event: TouchEvent) => {
            touchStartX.current = event.touches[0].clientX;
        };

        const handleTouchEnd = (event: TouchEvent) => {
            const delta = touchStartX.current - event.changedTouches[0].clientX;
            if (delta > 50) {
                onClose?.();
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
                "flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]",
                "transition-[width] duration-220 ease-out",
                isMobile && "h-[100dvh] pt-[calc(env(safe-area-inset-top)+var(--spacing-sm))] pb-[calc(env(safe-area-inset-bottom)+var(--spacing-sm))]",
                isMobile
                    ? "w-[min(var(--layout-sidebar-width),calc(100vw-env(safe-area-inset-left)-env(safe-area-inset-right)-var(--spacing-lg)))]"
                    : (
                        (sidebarOpen || isMobile)
                            ? "w-[var(--layout-sidebar-width)]"
                            : "w-[var(--layout-sidebar-collapsed-width)]"
                    ),
            )}
        >
            <div
                className={cn(
                    "flex h-16 items-center border-b border-[var(--color-border)] px-4",
                    "font-sans text-[12px] font-semibold text-[color:var(--color-text-secondary)]",
                )}
            >
                <div className="flex items-center gap-3.5">
                    <TheoremLogo size={26} className="shrink-0" />
                    {!isCollapsedDesktop && (
                        <span className="truncate text-[14px] leading-none tracking-[0.04em] text-[color:var(--color-text-primary)]">
                            Theorem
                        </span>
                    )}
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto py-2">
                <ul className="flex flex-col">
                    {mainNavItems
                        .filter((item) => item.id !== "vocabulary" || vocabularyEnabled)
                        .map((item) => {
                            const isActive = currentRoute === item.id;

                            return (
                                <li key={item.id}>
                                    <button
                                        onClick={() => {
                                            setRoute(item.id);
                                            if (item.id !== "library") {
                                                sessionStorage.removeItem("theorem-selected-shelf");
                                            }
                                            if (isMobile) {
                                                onClose?.();
                                            }
                                        }}
                                        className={cn(
                                            "relative flex h-11 w-full items-center border-b border-[var(--color-border-subtle)] px-4 text-left",
                                            "font-sans text-[12px] font-medium",
                                            "transition-colors",
                                            isActive
                                                ? "bg-[var(--color-accent)] text-white !text-white"
                                                : "text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]",
                                        )}
                                        title={isCollapsedDesktop ? item.label : undefined}
                                        aria-current={isActive ? "page" : undefined}
                                    >
                                        {isActive && (
                                            <span className="absolute inset-y-0 left-0 w-[3px] bg-black" aria-hidden="true" />
                                        )}
                                        {isCollapsedDesktop ? (
                                            <span className="inline-flex h-4 w-4 items-center justify-center">{item.icon}</span>
                                        ) : (
                                            <span>{item.label}</span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                </ul>
            </nav>

            <div className="border-t border-[var(--color-border)]">
                {showDesktopFooterRow ? (
                    <div className="flex items-stretch">
                        <button
                            onClick={() => {
                                setRoute("settings");
                            }}
                            className={cn(
                                "relative flex h-11 flex-1 items-center border-r border-[var(--color-border-subtle)] px-4 text-left",
                                "font-sans text-[12px] font-medium text-[color:var(--color-text-secondary)]",
                                "hover:text-[color:var(--color-text-primary)]",
                                currentRoute === "settings" && "bg-[var(--color-accent)] text-white !text-white",
                            )}
                            title="Settings"
                        >
                            {currentRoute === "settings" && (
                                <span className="absolute inset-y-0 left-0 w-[3px] bg-black" aria-hidden="true" />
                            )}
                            <span>Settings</span>
                        </button>

                        <button
                            onClick={handleToggle}
                            className="flex h-11 w-12 items-center justify-center text-[color:var(--color-text-secondary)] transition-colors hover:text-[color:var(--color-text-primary)]"
                            title="Collapse sidebar"
                        >
                            <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ) : (
                    <>
                        <button
                            onClick={() => {
                                setRoute("settings");
                                if (isMobile) {
                                    onClose?.();
                                }
                            }}
                            className={cn(
                                "relative flex h-11 w-full items-center border-b border-[var(--color-border-subtle)] px-4 text-left",
                                "font-sans text-[12px] font-medium text-[color:var(--color-text-secondary)]",
                                "hover:text-[color:var(--color-text-primary)]",
                                currentRoute === "settings" && "bg-[var(--color-accent)] text-white !text-white",
                            )}
                            title={isCollapsedDesktop ? "Settings" : undefined}
                        >
                            {currentRoute === "settings" && (
                                <span className="absolute inset-y-0 left-0 w-[3px] bg-black" aria-hidden="true" />
                            )}
                            {isCollapsedDesktop ? (
                                <span className="inline-flex h-4 w-4 items-center justify-center">
                                    <Settings className="h-4 w-4" />
                                </span>
                            ) : (
                                <span>Settings</span>
                            )}
                        </button>

                        {!isMobile && (
                            <button
                                onClick={handleToggle}
                                className={cn(
                                    "relative flex h-11 w-full items-center border-b border-[var(--color-border-subtle)] px-4 text-left",
                                    "font-sans text-[11px] font-medium text-[color:var(--color-text-secondary)]",
                                    "hover:text-[color:var(--color-text-primary)]",
                                )}
                                title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                            >
                                {isCollapsedDesktop ? (
                                    <span className="inline-flex h-4 w-4 items-center justify-center">
                                        {sidebarOpen ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                    </span>
                                ) : (
                                    <span>{sidebarOpen ? "‹ Collapse" : "› Expand"}</span>
                                )}
                            </button>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
}
