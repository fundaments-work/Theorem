import { type ReactNode } from "react";
import {
    Bookmark,
    FolderOpen,
    Highlighter,
    Library,
    Rss,
    Settings,
} from "lucide-react";
import { cn } from "../../core";
import { useUIStore, useSettingsStore } from "../../core";
import type { AppRoute } from "../../core";

interface NavItem {
    id: AppRoute;
    label: string;
    icon: ReactNode;
}

const navItems: NavItem[] = [
    { id: "library", label: "Library", icon: <Library className="h-5 w-5" /> },
    { id: "shelves", label: "Shelves", icon: <FolderOpen className="h-5 w-5" /> },
    { id: "annotations", label: "Highlights", icon: <Highlighter className="h-5 w-5" /> },
    { id: "feeds", label: "Feeds", icon: <Rss className="h-5 w-5" /> },
    { id: "settings", label: "Settings", icon: <Settings className="h-5 w-5" /> },
];

export function BottomNav() {
    const currentRoute = useUIStore((state) => state.currentRoute);
    const setRoute = useUIStore((state) => state.setRoute);
    
    return (
        <nav className="fixed bottom-0 left-0 right-0 z-[var(--z-nav)] border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)] md:hidden">
            <ul className="flex h-16 items-stretch justify-around px-2">
                {navItems.map((item) => {
                    const isActive = currentRoute === item.id;
                    return (
                        <li key={item.id} className="flex-1">
                            <button
                                onClick={() => {
                                    setRoute(item.id);
                                    if (item.id !== "library") {
                                        sessionStorage.removeItem("theorem-selected-shelf");
                                    }
                                }}
                                className={cn(
                                    "flex h-full w-full flex-col items-center justify-center gap-1 transition-colors",
                                    isActive
                                        ? "text-[color:var(--color-accent)]"
                                        : "text-[color:var(--color-text-secondary)] active:bg-[var(--color-surface-muted)]"
                                )}
                            >
                                <span className={cn(
                                    "relative flex items-center justify-center rounded-full px-4 py-1",
                                    isActive && "bg-[var(--color-accent)]/10"
                                )}>
                                    {item.icon}
                                </span>
                                <span className="text-[10px] font-medium uppercase tracking-wider">{item.label}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
