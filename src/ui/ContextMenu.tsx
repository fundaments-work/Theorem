
import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";

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

export function ContextMenu({ items, children, className }: ContextMenuProps) {
    return (
        <ContextMenuPrimitive.Root>
            <ContextMenuPrimitive.Trigger asChild>
                <div className={className}>{children}</div>
            </ContextMenuPrimitive.Trigger>

            <ContextMenuPrimitive.Portal>
                <ContextMenuPrimitive.Content
                    className="z-[calc(var(--z-dropdown)+1)] min-w-[var(--layout-dropdown-menu-min-width)] max-w-[var(--layout-dropdown-menu-max-width)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1"
                >
                    {items.map((item) => {
                        if (item.separator) {
                            return (
                                <ContextMenuPrimitive.Separator
                                    key={item.id}
                                    className="mx-3 my-1 h-px bg-[var(--color-border)]"
                                />
                            );
                        }
                        return (
                            <ContextMenuPrimitive.Item
                                key={item.id}
                                disabled={item.disabled}
                                onSelect={item.onClick}
                                className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-[color:var(--color-text-primary)] outline-none cursor-pointer data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-[var(--color-surface-muted)] aria-[current]:bg-[var(--color-surface-muted)]"
                            >
                                {item.icon && <span className="flex-shrink-0 w-4 h-4">{item.icon}</span>}
                                <span className="flex-1">{item.label}</span>
                                {item.shortcut && (
                                    <span className="ml-auto text-[0.6875rem] text-[color:var(--color-text-muted)]">
                                        {item.shortcut}
                                    </span>
                                )}
                            </ContextMenuPrimitive.Item>
                        );
                    })}
                </ContextMenuPrimitive.Content>
            </ContextMenuPrimitive.Portal>
        </ContextMenuPrimitive.Root>
    );
}


