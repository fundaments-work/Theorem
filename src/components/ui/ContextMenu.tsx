import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ContextMenuItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    shortcut?: string;
    onClick: () => void;
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
 */
export function ContextMenu({ items, children, className }: ContextMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLDivElement>(null);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Calculate position to keep menu on screen
        const x = e.clientX;
        const y = e.clientY;
        
        setPosition({ x, y });
        setIsOpen(true);
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

    // Adjust position to keep menu on screen
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

    const handleItemClick = (item: ContextMenuItem) => {
        if (!item.disabled) {
            item.onClick();
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
                className={cn(
                    "fixed z-[calc(var(--z-dropdown)+1)] min-w-[var(--layout-dropdown-menu-min-width)] max-w-[var(--layout-dropdown-menu-max-width)]",
                    "bg-[var(--color-surface)] border border-[var(--color-border)]",
                    "rounded-lg shadow-[var(--shadow-md)] py-1",
                    "animate-fade-in"
                )}
                style={{
                    left: position.x,
                    top: position.y,
                }}
            >
                {items.map((item, index) => (
                    <div key={item.id}>
                        {item.separator && index > 0 && (
                            <div className="my-1 border-t border-[var(--color-border)]" />
                        )}
                        <button
                            onClick={() => handleItemClick(item)}
                            disabled={item.disabled}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 text-left",
                                "text-sm transition-colors",
                                item.disabled
                                    ? "opacity-50 cursor-not-allowed text-[var(--color-text-muted)]"
                                    : item.danger
                                        ? "text-[var(--color-error)] hover:bg-[color-mix(in_srgb,var(--color-error)_10%,transparent)]"
                                        : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
                            )}
                        >
                            {item.icon && (
                                <span className="flex-shrink-0 w-4 h-4">
                                    {item.icon}
                                </span>
                            )}
                            <span className="flex-1">{item.label}</span>
                            {item.shortcut && (
                                <span className="text-xs text-[var(--color-text-muted)]">
                                    {item.shortcut}
                                </span>
                            )}
                        </button>
                    </div>
                ))}
            </div>
        </>
    ) : null;

    return (
        <div
            ref={triggerRef}
            onContextMenu={handleContextMenu}
            className={className}
        >
            {children}
            {menuContent && createPortal(menuContent, document.body)}
        </div>
    );
}
