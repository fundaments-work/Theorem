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
                'fixed inset-0 z-40 bg-black/22 sm:bg-black/28 transition-all duration-300',
                blur ? 'backdrop-blur-[3px]' : 'backdrop-blur-[1px]',
                className
            )}
            onClick={onClick}
        />
    );
}

export default Backdrop;
