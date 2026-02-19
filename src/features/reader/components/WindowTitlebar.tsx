/**
 * WindowTitlebar Component
 * Custom title bar with native-looking window controls and reader controls
 * Theme-aware - adapts to reader theme colors
 */

import { useState, useEffect, useRef } from "react";
import {
    ArrowLeft,
    List,
    Bookmark as BookmarkIcon,
    Search,
    Maximize2,
    Minimize2,
    Minus,
    X,
    EllipsisVertical,
    Type,
    Info,
} from "lucide-react";
import { cn } from "../../../core";
import { isMobile, isTauri } from "../../../core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { DocMetadata, DocLocation } from "../../../core";

interface WindowTitlebarProps {
    metadata: DocMetadata | null;
    location?: DocLocation | null;
    onBack: () => void;
    onPrevPage?: () => void;
    onNextPage?: () => void;
    onToggleToc: () => void;
    onToggleSettings: () => void;
    onToggleBookmarks: () => void;
    onToggleSearch: () => void;
    onToggleInfo: () => void;
    onToggleMenu: () => void;
    onAddBookmark?: () => void;
    isCurrentPageBookmarked?: boolean;
    activePanel: string | null;
    fullscreen?: boolean;
    onToggleFullscreen?: () => void;
    className?: string;
    // Legacy props kept for compatibility until verified
    hideReaderControls?: boolean;
    pdfControls?: any;
}

const ICON_BUTTON_CLASS = "inline-flex h-9 w-9 shrink-0 items-center justify-center border border-transparent bg-transparent p-0 text-[color:var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)]";
const ICON_BUTTON_ACTIVE_CLASS = "border-[var(--color-text-primary)] bg-[var(--color-surface-muted)] text-[color:var(--color-text-primary)]";
const ICON_BUTTON_INACTIVE_CLASS = "border-transparent text-[color:var(--color-text-secondary)]";

function ToolbarButton({
    onClick,
    active,
    title,
    className,
    children,
}: {
    onClick?: () => void;
    active?: boolean;
    title: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                ICON_BUTTON_CLASS,
                active ? ICON_BUTTON_ACTIVE_CLASS : ICON_BUTTON_INACTIVE_CLASS,
                className,
            )}
            style={{ color: "var(--reader-fg)" }}
            title={title}
        >
            {children}
        </button>
    );
}

function WindowControlButton({
    onClick,
    title,
    danger = false,
    children,
}: {
    onClick: () => void;
    title: string;
    danger?: boolean;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "inline-flex h-8 w-8 items-center justify-center border border-transparent bg-transparent p-0 text-[color:var(--color-text-secondary)] transition-[background-color,border-color,color] duration-200 ease-out hover:border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)]",
                danger
                    ? "hover:bg-[color:color-mix(in_srgb,var(--color-error)_14%,transparent)] hover:text-[color:var(--color-error)]"
                    : "text-[color:var(--color-text-secondary)]",
            )}
            style={{ color: "var(--reader-fg)" }}
            title={title}
        >
            {children}
        </button>
    );
}

interface MenuProps {
    isOpen: boolean;
    onClose: () => void;
    items: Array<{
        label: string;
        icon: React.ReactNode;
        onClick: () => void;
        active?: boolean;
        disabled?: boolean;
    }>;
    triggerRef: React.RefObject<HTMLButtonElement | null>;
}

function MobileMenu({ isOpen, onClose, items, triggerRef }: MenuProps) {
    if (!isOpen) return null;

    return (
        <>
            {/* Transparent overlay to catch clicks on the toolbar/chrome area */}
            <div
                className="fixed inset-0 z-[160]"
                onClick={onClose}
            />
            <div
                className="absolute right-2 top-full mt-1 z-[161] min-w-[12rem] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg backdrop-blur-md"
                style={{
                    backgroundColor: 'var(--reader-bg, var(--color-surface))',
                    borderColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)',
                }}
            >
                {items.map((item, index) => (
                    <button
                        key={index}
                        onClick={() => {
                            item.onClick();
                            onClose();
                        }}
                        disabled={item.disabled}
                        className={cn(
                            "flex w-full items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors",
                            item.active
                                ? "bg-[color:color-mix(in_srgb,var(--reader-fg,var(--color-text))_10%,transparent)] font-medium"
                                : "hover:bg-[color:color-mix(in_srgb,var(--reader-fg,var(--color-text))_5%,transparent)]",
                            item.disabled && "opacity-50 cursor-not-allowed"
                        )}
                        style={{ color: 'var(--reader-fg, var(--color-text))' }}
                    >
                        <span className="w-5 h-5 flex items-center justify-center opacity-70">{item.icon}</span>
                        {item.label}
                    </button>
                ))}
            </div>
        </>
    );
}

export function WindowTitlebar({
    metadata,
    location,
    onBack,
    onPrevPage,
    onNextPage,
    onToggleToc,
    onToggleSettings,
    onToggleBookmarks,
    onToggleSearch,
    onToggleInfo,
    onToggleMenu,
    onAddBookmark,
    isCurrentPageBookmarked,
    activePanel,
    fullscreen,
    onToggleFullscreen,
    className,
}: WindowTitlebarProps) {
    const [isMaximized, setIsMaximized] = useState(false);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const isMenuOpen = activePanel === 'menu';

    const currentChapter = location?.tocItem?.label || location?.pageItem?.label;
    const isTauriRuntime = isTauri();
    const isMobileRuntime = isMobile();
    const showDesktopWindowControls = isTauriRuntime && !isMobileRuntime;

    useEffect(() => {
        if (!showDesktopWindowControls) return;
        const updateMaximizedState = async () => {
            try {
                const win = getCurrentWebviewWindow();
                const maximized = await win.isMaximized();
                setIsMaximized(maximized);
            } catch (err) {
                const isMax = window.innerWidth === window.screen.availWidth &&
                    window.innerHeight === window.screen.availHeight;
                setIsMaximized(isMax);
            }
        };
        window.addEventListener("resize", updateMaximizedState);
        updateMaximizedState();
        return () => window.removeEventListener("resize", updateMaximizedState);
    }, [showDesktopWindowControls]);

    const formatLocation = () => {
        if (!location) return null;
        if (location.pageInfo) {
            return `Page ${location.pageInfo.currentPage}${location.pageInfo.totalPages ? ` / ${location.pageInfo.totalPages}` : ""}`;
        }
        if (location.pageItem?.label) {
            return location.pageItem.label;
        }
        const percentage = Math.round((location.percentage || 0) * 100);
        return `${percentage}%`;
    };

    const handleMinimize = async () => {
        if (!showDesktopWindowControls) return;
        try { await getCurrentWebviewWindow().minimize(); } catch (err) { console.error(err); }
    };
    const handleMaximize = async () => {
        if (!showDesktopWindowControls) return;
        try {
            const win = getCurrentWebviewWindow();
            if (isMaximized) await win.unmaximize(); else await win.maximize();
        } catch (err) { console.error(err); }
    };
    const handleClose = async () => {
        if (!showDesktopWindowControls) return;
        try { await getCurrentWebviewWindow().close(); } catch (err) { console.error(err); }
    };

    const commonMenuItems: Array<{
        label: string;
        icon: React.ReactNode;
        onClick: () => void;
        active?: boolean;
        disabled?: boolean;
    }> = [
            { label: "Annotations & Notes", icon: <BookmarkIcon className="w-4 h-4" />, onClick: onToggleBookmarks, active: activePanel === "bookmarks" },
            { label: "Book Info", icon: <Info className="w-4 h-4" />, onClick: onToggleInfo, active: activePanel === "info" },
        ];



    if (onToggleFullscreen) {
        commonMenuItems.push({
            label: fullscreen ? "Exit Fullscreen" : "Fullscreen",
            icon: fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />,
            onClick: onToggleFullscreen,
            active: fullscreen,
        });
    }

    return (
        <div
            className={cn(
                "w-full z-[150] select-none border-b-2 reader-toolbar relative",
                "pt-[max(env(safe-area-inset-top,0px),4px)] lg:pt-0",
                "bg-[var(--color-surface)] border-[var(--color-border)]",
                className
            )}
            style={{
                backgroundColor: 'var(--reader-bg, var(--color-surface))',
                borderBottomColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)',
            }}
        >
            <div className="h-14 lg:h-11 flex items-center gap-1 pl-3 pr-2">
                {/* Left: Back + Title */}
                <div className="flex items-center gap-1 min-w-0 flex-1 lg:flex-none max-w-[55%] lg:max-w-[400px]">
                    <button
                        onClick={onBack}
                        className={cn(ICON_BUTTON_CLASS, "mr-1")}
                        style={{ color: 'var(--reader-fg, var(--color-text))' }}
                        title="Back"
                    >
                        <ArrowLeft className="w-5 h-5 lg:w-4 lg:h-4" />
                    </button>

                    <div className="flex-1 min-w-0 text-left overflow-hidden">
                        <h1
                            className="text-base lg:text-sm font-bold lg:font-medium truncate leading-tight"
                            style={{ color: 'var(--reader-fg, var(--color-text))' }}
                        >
                            {metadata?.title || "Loading..."}
                        </h1>
                        <div className="hidden sm:block text-[11px] lg:text-xs truncate opacity-70" style={{ color: 'var(--reader-fg, var(--color-text))' }}>
                            {currentChapter} {formatLocation() ? `• ${formatLocation()}` : ''}
                        </div>
                    </div>
                </div>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Content: Standard Tools - Always Visible */}
                <div className="flex items-center gap-0.5 mr-0.5">
                    <ToolbarButton onClick={onToggleSearch} active={activePanel === "search"} title="Search">
                        <Search className="w-5 h-5 lg:w-4 lg:h-4" />
                    </ToolbarButton>

                    {onAddBookmark && (
                        <ToolbarButton
                            onClick={onAddBookmark}
                            active={isCurrentPageBookmarked}
                            title={isCurrentPageBookmarked ? "Remove Bookmark" : "Add Bookmark"}
                        >
                            <BookmarkIcon className={cn("w-5 h-5 lg:w-4 lg:h-4", isCurrentPageBookmarked ? "fill-current" : "")} />
                        </ToolbarButton>
                    )}

                    <ToolbarButton onClick={onToggleSettings} active={activePanel === "settings"} title="Reading Settings">
                        <Type className="w-5 h-5 lg:w-4 lg:h-4" />
                    </ToolbarButton>
                </div>

                {/* Menu Trigger (Always Visible) */}
                <button
                    ref={menuButtonRef}
                    onClick={onToggleMenu}
                    className={cn(ICON_BUTTON_CLASS, isMenuOpen && ICON_BUTTON_ACTIVE_CLASS)}
                    style={{ color: 'var(--reader-fg)' }}
                >
                    <EllipsisVertical className="w-5 h-5 lg:w-4 lg:h-4" />
                </button>

                {/* Mobile/Desktop Menu */}
                <MobileMenu
                    isOpen={isMenuOpen}
                    onClose={onToggleMenu}
                    items={commonMenuItems}
                    triggerRef={menuButtonRef}
                />

                {/* Desktop Window Controls */}
                {showDesktopWindowControls && (
                    <div className="hidden lg:flex items-center gap-1 ml-2 pl-2 border-l border-[var(--color-border)]">
                        <WindowControlButton onClick={handleMinimize} title="Minimize"><Minus className="w-4 h-4" /></WindowControlButton>
                        <WindowControlButton onClick={handleMaximize} title="Maximize"><Maximize2 className="w-4 h-4" /></WindowControlButton>
                        <WindowControlButton onClick={handleClose} title="Close" danger><X className="w-4 h-4" /></WindowControlButton>
                    </div>
                )}
            </div>
        </div>
    );
}

export default WindowTitlebar;
