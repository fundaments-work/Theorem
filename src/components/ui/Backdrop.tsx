/**
 * Backdrop Component
 * Reusable backdrop for panels and modals
 */

import { cn } from '@/lib/utils';

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
                'fixed inset-0 z-40 bg-black/5 transition-all duration-300',
                blur && 'backdrop-blur-[2px]',
                className
            )}
            onClick={onClick}
        />
    );
}

export default Backdrop;
