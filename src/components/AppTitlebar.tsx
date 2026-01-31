/**
 * AppTitlebar Component
 * Generic title bar for app screens (Library, Settings, etc.)
 * Frameless window title bar with navigation
 */

import { useState, useEffect } from "react";
import {
    Minus,
    Square,
    X,
    Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LionLogo } from "./LionLogo";

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

    return (
        <div
            className={cn(
                "w-full z-50 select-none bg-[var(--color-surface)] border-b border-[var(--color-border)]",
                "h-11 flex items-center justify-between px-3",
                className
            )}
            data-tauri-drag-region
        >
            {/* Left side - Logo (mobile only) + Menu (mobile only) + Title (draggable) */}
            <div className="flex-1 flex items-center min-w-0" data-tauri-drag-region>
                {/* Logo - only on mobile/tablet where sidebar is hidden */}
                <LionLogo size={24} className="md:hidden flex-shrink-0 mr-2" />
                
                {onMenuClick && (
                    <button
                        onClick={onMenuClick}
                        className="md:hidden p-1.5 rounded-lg hover:bg-[var(--color-background)] text-[var(--color-text)] transition-colors mr-2"
                        title="Toggle Sidebar"
                    >
                        <Menu className="w-4 h-4" />
                    </button>
                )}
                <h1 className="text-sm font-semibold text-[var(--color-text)] truncate">
                    {title}
                </h1>
            </div>

            {/* Center - Spacer for dragging */}
            <div className="flex-1 h-full" data-tauri-drag-region />

            {/* Right side - Window controls */}
            <div className="flex items-center gap-0.5 shrink-0">
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
