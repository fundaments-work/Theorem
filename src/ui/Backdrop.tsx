/**
 * Backdrop Component
 * Reusable backdrop for panels and modals
 */

import { cn } from '../core';

interface BackdropProps {
    visible: boolean;
    onClick?: () => void;
    className?: string;
    blur?: boolean;
}

export function Backdrop({ visible, onClick, className, blur = false }: BackdropProps) {
    if (!visible) return null;

    return (
        <div
            className={cn(
                'fixed inset-0 z-[var(--z-backdrop)] bg-[var(--color-overlay-medium)] sm:bg-[var(--color-overlay-strong)] transition-opacity duration-200',
                blur && 'backdrop-blur-[var(--effect-backdrop-blur-sm)]',
                className
            )}
            onClick={onClick}
        />
    );
}

export default Backdrop;
