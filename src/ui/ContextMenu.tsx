import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../core";

const LONG_PRESS_DURATION_MS = 420;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    shortcut?: string;
    onClick?: () => void;
    disabled?: boolean;
    separator?: boolean;
    danger?: boolean;
}

interface ContextMenuProps {
    items: ContextMenuItem[];
    children: React.ReactNode;
    className?: string;
}

/**
 * Context Menu Component using React Portal
 * Renders outside the main DOM tree to avoid z-index conflicts with titlebar
 * Swiss Design Standard
 */
export function ContextMenu({ items, children, className }: ContextMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);
    const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressTriggeredRef = useRef(false);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);

    const clearLongPress = useCallback(() => {
        if (longPressTimeoutRef.current) {
            clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
        }
    }, []);

    const openMenuAt = useCallback((x: number, y: number) => {
        setPosition({ x, y });
        setIsOpen(true);
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        openMenuAt(e.clientX, e.clientY);
    }, [openMenuAt]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length !== 1) {
            return;
        }

        const touch = e.touches[0];
        const touchX = touch.clientX;
        const touchY = touch.clientY;
        touchStartRef.current = { x: touchX, y: touchY };
        longPressTriggeredRef.current = false;
        clearLongPress();

        longPressTimeoutRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            openMenuAt(touchX, touchY);
        }, LONG_PRESS_DURATION_MS);
    }, [clearLongPress, openMenuAt]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!touchStartRef.current || e.touches.length !== 1) {
            clearLongPress();
            return;
        }

        const touch = e.touches[0];
        const deltaX = Math.abs(touch.clientX - touchStartRef.current.x);
        const deltaY = Math.abs(touch.clientY - touchStartRef.current.y);

        if (deltaX > LONG_PRESS_MOVE_TOLERANCE_PX || deltaY > LONG_PRESS_MOVE_TOLERANCE_PX) {
            clearLongPress();
        }
    }, [clearLongPress]);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        clearLongPress();
        touchStartRef.current = null;

        if (longPressTriggeredRef.current) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, [clearLongPress]);

    const handleClickCapture = useCallback((e: React.MouseEvent) => {
        if (longPressTriggeredRef.current) {
            e.preventDefault();
            e.stopPropagation();
            longPressTriggeredRef.current = false;
        }
    }, []);

    const handleClickOutside = useCallback((e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
            setIsOpen(false);
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setIsOpen(false);
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            document.addEventListener("keydown", handleKeyDown);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, handleClickOutside]);

    useEffect(() => {
        if (isOpen && menuRef.current) {
            const menu = menuRef.current;
            const rect = menu.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            let adjustedX = position.x;
            let adjustedY = position.y;

            if (rect.right > viewportWidth) {
                adjustedX = position.x - rect.width;
            }
            if (rect.bottom > viewportHeight) {
                adjustedY = position.y - rect.height;
            }

            menu.style.left = `${adjustedX}px`;
            menu.style.top = `${adjustedY}px`;
        }
    }, [isOpen, position]);

    useEffect(() => {
        return () => {
            clearLongPress();
        };
    }, [clearLongPress]);

    const handleItemClick = (item: ContextMenuItem) => {
        if (!item.disabled && !item.separator) {
            item.onClick?.();
            setIsOpen(false);
        }
    };

    // Render menu content using Portal when open
    const menuContent = isOpen ? (
        <>
            {/* Backdrop to capture clicks outside - high z-index to cover everything */}
            <div 
                className="fixed inset-0 z-[var(--z-dropdown)]"
                onClick={() => setIsOpen(false)}
            />
            
            {/* Menu - even higher z-index */}
            <div
                ref={menuRef}
                className="fixed z-[calc(var(--z-dropdown)+1)] min-w-[var(--layout-dropdown-menu-min-width)] max-w-[var(--layout-dropdown-menu-max-width)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1"
                style={{
                    left: position.x,
                    top: position.y,
                }}
            >
                {items.map((item, index) => {
                    if (item.separator) {
                        const hasActionBefore = items.slice(0, index).some((entry) => !entry.separator);
                        const hasActionAfter = items.slice(index + 1).some((entry) => !entry.separator);
                        if (!hasActionBefore || !hasActionAfter) {
                            return null;
                        }
                        return (
                            <div key={item.id} className="mx-3 my-1 h-px bg-[var(--color-border)]" />
                        );
                    }

                    return (
                        <button
                            key={item.id}
                            onClick={() => handleItemClick(item)}
                            disabled={item.disabled}
                            className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-[color:var(--color-text-primary)] transition-colors duration-200 ease-out hover:bg-[var(--color-surface-muted)] data-[danger=true]:text-[color:var(--color-error)] data-[danger=true]:hover:bg-[color:color-mix(in_srgb,var(--color-error)_10%,var(--color-surface))] data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50"
                            data-danger={item.danger}
                            data-disabled={item.disabled}
                        >
                            {item.icon && (
                                <span className="flex-shrink-0 w-4 h-4">
                                    {item.icon}
                                </span>
                            )}
                            <span className="flex-1">{item.label}</span>
                            {item.shortcut && (
                                <span className="ml-auto text-[0.6875rem] text-[color:var(--color-text-muted)]">
                                    {item.shortcut}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </>
    ) : null;

    return (
        <div
            ref={triggerRef}
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
            onClickCapture={handleClickCapture}
            className={className}
        >
            {children}
            {menuContent && createPortal(menuContent, document.body)}
        </div>
    );
}

export default ContextMenu;
