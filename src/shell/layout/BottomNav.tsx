import { type ReactNode } from "react";
import {
    FolderOpen,
    Highlighter,
    Library,
    BookOpenText,
    Rss,
    Settings,
} from "lucide-react";
import { useUIStore, useSettingsStore } from "../../core";
import type { AppRoute } from "../../core";

interface NavItem {
    id: AppRoute;
    label: string;
    icon: ReactNode;
}

const baseNavItems: NavItem[] = [
    { id: "library", label: "Library", icon: <Library className="h-[var(--icon-size-lg)] w-[var(--icon-size-lg)]" /> },
    { id: "shelves", label: "Shelves", icon: <FolderOpen className="h-[var(--icon-size-lg)] w-[var(--icon-size-lg)]" /> },
    { id: "annotations", label: "Highlights", icon: <Highlighter className="h-[var(--icon-size-lg)] w-[var(--icon-size-lg)]" /> },
    { id: "vocabulary", label: "Words", icon: <BookOpenText className="h-[var(--icon-size-lg)] w-[var(--icon-size-lg)]" /> },
    { id: "feeds", label: "Feeds", icon: <Rss className="h-[var(--icon-size-lg)] w-[var(--icon-size-lg)]" /> },
    { id: "settings", label: "Settings", icon: <Settings className="h-[var(--icon-size-lg)] w-[var(--icon-size-lg)]" /> },
];

export function BottomNav() {
    const currentRoute = useUIStore((state) => state.currentRoute);
    const setRoute = useUIStore((state) => state.setRoute);
    const vocabularyEnabled = useSettingsStore((state) => state.settings.vocabulary.vocabularyEnabled);

    const navItems = baseNavItems.filter(
        (item) => item.id !== "vocabulary" || vocabularyEnabled,
    );
    
    return (
        <nav className="ui-bottom-nav fixed bottom-0 left-0 right-0 z-[var(--z-nav)] pb-[env(safe-area-inset-bottom)] md:hidden">
            <ul className="ui-bottom-nav-list px-2">
                {navItems.map((item) => {
                    const isActive = currentRoute === item.id;
                    return (
                        <li key={item.id} className="flex-1">
                            <button
                                onClick={() => {
                                    if (!isActive) {
                                        setRoute(item.id);
                                        if (item.id !== "library") {
                                            sessionStorage.removeItem("theorem-selected-shelf");
                                        }
                                    }
                                }}
                                className="ui-bottom-nav-btn"
                                data-active={isActive ? "true" : undefined}
                                aria-current={isActive ? "page" : undefined}
                            >
                                <span className="ui-bottom-nav-pill">
                                    {item.icon}
                                </span>
                                <span className="ui-bottom-nav-label">{item.label}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}
