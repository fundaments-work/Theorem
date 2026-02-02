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
import { cn } from "@/lib/utils";

import { useUIStore } from "@/store";

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
    const { currentRoute, searchQuery, setSearchQuery, setRoute } = useUIStore();

    useEffect(() => {
        const handleResize = () => {
            const isMax = window.innerWidth === window.screen.availWidth && 
                         window.innerHeight === window.screen.availHeight;
            setIsMaximized(isMax);
        };

        window.addEventListener("resize", handleResize);
        handleResize();

        return () => window.removeEventListener("resize", handleResize);
    }, []);

    const handleMinimize = () => {
        // @ts-ignore - Tauri API
        if (window.__TAURI__) {
            // @ts-ignore
            window.__TAURI__.window.getCurrentWindow().minimize();
        }
    };

    const handleMaximize = () => {
        // @ts-ignore - Tauri API
        if (window.__TAURI__) {
            // @ts-ignore
            const win = window.__TAURI__.window.getCurrentWindow();
            if (isMaximized) {
                win.unmaximize();
            } else {
                win.maximize();
            }
        }
    };

    const handleClose = () => {
        // @ts-ignore - Tauri API
        if (window.__TAURI__) {
            // @ts-ignore
            window.__TAURI__.window.getCurrentWindow().close();
        }
    };

    const getPageTitle = () => {
        switch (currentRoute) {
            case "library":
                return "Library";
            case "reader":
                return "Books";
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
                "w-full z-50 select-none bg-[var(--color-surface)] border-b border-[var(--color-border)]",
                "h-14 flex items-center justify-between px-3 gap-3",
                className
            )}
            data-tauri-drag-region
        >
            {/* Left side - Menu (mobile only) + Title */}
            <div className="flex items-center gap-2 shrink-0" data-tauri-drag-region>
                {onMenuClick && (
                    <button
                        onClick={onMenuClick}
                        className="md:hidden p-2 rounded-lg hover:bg-[var(--color-background)] text-[var(--color-text)] transition-colors"
                        title="Toggle Sidebar"
                    >
                        <Menu className="w-5 h-5" />
                    </button>
                )}

                <h1 className="text-sm font-semibold text-[var(--color-text)] truncate">
                    {getPageTitle()}
                </h1>
            </div>

            {/* Center - Search */}
            <div className="flex-1 max-w-3xl" data-tauri-drag-region>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search books, authors, or highlights..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={cn(
                            "w-full pl-9 pr-4 py-1.5 rounded-lg",
                            "bg-[var(--color-background)] border border-[var(--color-border)]",
                            "text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]",
                            "focus:outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent-light)]",
                            "transition-colors duration-200"
                        )}
                    />
                </div>
            </div>

            {/* Right side - Stats button + Window controls */}
            <div className="flex items-center gap-1 shrink-0">
                {/* Statistics Button */}
                <button
                    onClick={() => setRoute("statistics")}
                    className={cn(
                        "p-2 rounded-lg transition-colors",
                        currentRoute === "statistics"
                            ? "bg-[var(--color-accent)] text-white"
                            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)]"
                    )}
                    title="Statistics"
                >
                    <BarChart3 className="w-5 h-5" />
                </button>

                <div className="w-px h-5 bg-[var(--color-border)] mx-1" />

                {/* Window controls */}
                <button
                    onClick={handleMinimize}
                    className="p-1.5 rounded-lg hover:bg-[var(--color-background)] text-[var(--color-text)] transition-colors"
                    title="Minimize"
                >
                    <Minus className="w-4 h-4" />
                </button>
                <button
                    onClick={handleMaximize}
                    className="p-1.5 rounded-lg hover:bg-[var(--color-background)] text-[var(--color-text)] transition-colors"
                    title={isMaximized ? "Restore" : "Maximize"}
                >
                    <Square className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={handleClose}
                    className="p-1.5 rounded-lg hover:bg-red-500 hover:text-white text-[var(--color-text)] transition-colors"
                    title="Close"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

export default AppTitlebar;
