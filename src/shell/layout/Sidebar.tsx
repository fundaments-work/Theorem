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
    { id: "library", label: "Library", icon: <Library className="h-[var(--icon-size-sm)] w-[var(--icon-size-sm)]" /> },
    { id: "vocabulary", label: "Vocabulary", icon: <BookOpenText className="h-[var(--icon-size-sm)] w-[var(--icon-size-sm)]" /> },
    { id: "annotations", label: "Highlights", icon: <Highlighter className="h-[var(--icon-size-sm)] w-[var(--icon-size-sm)]" /> },
    { id: "bookmarks", label: "Bookmarks", icon: <Bookmark className="h-[var(--icon-size-sm)] w-[var(--icon-size-sm)]" /> },
    { id: "shelves", label: "Shelves", icon: <FolderOpen className="h-[var(--icon-size-sm)] w-[var(--icon-size-sm)]" /> },
    { id: "feeds", label: "Snapshots", icon: <Rss className="h-[var(--icon-size-sm)] w-[var(--icon-size-sm)]" /> },
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
                !isMobile && (
                    (sidebarOpen || isMobile)
                        ? "w-[var(--layout-sidebar-width)]"
                        : "w-[var(--layout-sidebar-collapsed-width)]"
                ),
            )}
        >
            <div
                className={cn(
                    "flex h-[var(--layout-sidebar-header-height)] items-center border-b border-[var(--color-border)]",
                    isMobile ? "px-6" : (isCollapsedDesktop ? "justify-center px-0" : "!px-14")
                )}
            >
                <div className="flex items-center gap-4">
                    <TheoremLogo size={24} className="shrink-0" />
                    {!isCollapsedDesktop && (
                        <span className="truncate text-[13px] leading-none tracking-[0.12em] uppercase text-[color:var(--color-text-primary)] font-bold">
                            Theorem
                        </span>
                    )}
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto py-6 min-h-0 custom-scrollbar">
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
                                            "ui-sidebar-nav-item w-full py-4 transition-colors duration-150 relative",
                                            isActive ? "bg-[color:var(--color-text-primary)] text-[color:var(--color-surface)] shadow-md" : "hover:bg-[var(--color-surface-hover)]",
                                            isMobile ? "px-6" : (isCollapsedDesktop ? "justify-center px-0" : "!pl-14 pr-0")
                                        )}
                                        title={isCollapsedDesktop ? item.label : undefined}
                                        aria-current={isActive ? "page" : undefined}
                                    >
                                        <span className={cn(
                                            "flex items-center gap-5 w-full",
                                            isCollapsedDesktop && "justify-center"
                                        )}>
                                            <span className="shrink-0">{item.icon}</span>
                                            {!isCollapsedDesktop && (
                                                <span className="truncate uppercase tracking-[0.08em] text-[11px] font-bold">
                                                    {item.label}
                                                </span>
                                            )}
                                        </span>
                                        {isActive && !isCollapsedDesktop && (
                                            <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[color:var(--color-accent)]" />
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                </ul>
            </nav>

            <div className={cn(
                "border-t border-[var(--color-border)] bg-[var(--color-surface)] mt-auto mt-4",
                isMobile ? "py-4 px-6" : (isCollapsedDesktop ? "py-4 px-0" : "py-6 !px-14")
            )}>
                {showDesktopFooterRow ? (
                    <div className="flex items-center justify-between gap-4">
                        <button
                            onClick={() => {
                                setRoute("settings");
                            }}
                            className={cn(
                                "flex items-center gap-4 text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] transition-colors",
                                currentRoute === "settings" && "text-[color:var(--color-accent)]"
                            )}
                            title="Settings"
                        >
                            <Settings className="h-4 w-4" />
                            <span className="uppercase tracking-[0.08em] text-[11px] font-bold">Settings</span>
                        </button>

                        <button
                            onClick={handleToggle}
                            className="p-2 -mr-2 text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] transition-colors"
                            title="Collapse sidebar"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        <button
                            onClick={() => {
                                setRoute("settings");
                                if (isMobile) {
                                    onClose?.();
                                }
                            }}
                            className={cn(
                                "flex items-center justify-center text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] transition-colors",
                                isCollapsedDesktop ? "w-full" : "justify-start gap-4"
                            )}
                            title={isCollapsedDesktop ? "Settings" : undefined}
                        >
                            <Settings className="h-4 w-4" />
                            {!isCollapsedDesktop && <span className="uppercase tracking-[0.08em] text-[11px] font-bold">Settings</span>}
                        </button>

                        {!isMobile && (
                            <button
                                onClick={handleToggle}
                                className={cn(
                                    "flex items-center justify-center text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] transition-colors",
                                    isCollapsedDesktop ? "w-full" : "justify-start gap-4"
                                )}
                                title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                            >
                                {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                {!isCollapsedDesktop && <span className="uppercase tracking-[0.08em] text-[11px] font-bold">{sidebarOpen ? "Collapse" : "Expand"}</span>}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </aside>
    );
}
