/**
 * Panel Component
 * Reusable sliding panel with consistent animations
 * Theme-aware - adapts to reader theme colors
 */

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

export type PanelPosition = 'left' | 'right';

interface PanelProps {
    visible: boolean;
    children: ReactNode;
    position?: PanelPosition;
    width?: string;
    className?: string;
    header?: ReactNode;
}

export function Panel({
    visible,
    children,
    position = 'right',
    width = 'w-80',
    className,
    header,
}: PanelProps) {
    const isLeft = position === 'left';

    return (
        <div
            className={cn(
                'fixed top-0 h-full max-w-[85vw] z-50 flex flex-col',
                'transform transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]',
                isLeft ? 'left-0 border-r' : 'right-0 border-l',
                visible
                    ? 'translate-x-0 shadow-2xl'
                    : isLeft ? '-translate-x-full shadow-none' : 'translate-x-full shadow-none',
                width,
                className
            )}
            style={{
                backgroundColor: 'var(--reader-bg, var(--color-surface))',
                borderColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)',
            }}
        >
            {header && (
                <div 
                    className="flex items-center justify-between p-5 border-b"
                    style={{ borderColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)' }}
                >
                    {header}
                </div>
            )}
            {children}
        </div>
    );
}

interface FloatingPanelProps {
    visible: boolean;
    children: ReactNode;
    className?: string;
    anchor?: 'top-left' | 'top-right';
}

export function FloatingPanel({
    visible,
    children,
    className,
    anchor = 'top-right',
}: FloatingPanelProps) {
    return (
        <div
            className={cn(
                'fixed z-50 w-80 max-w-[calc(100vw-3rem)] rounded-2xl shadow-2xl flex flex-col',
                'transform transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
                anchor === 'top-right' && 'top-16 right-6 origin-top-right',
                anchor === 'top-left' && 'top-16 left-6 origin-top-left',
                visible
                    ? 'opacity-100 scale-100 translate-y-0'
                    : 'opacity-0 scale-95 -translate-y-2 pointer-events-none',
                className
            )}
            style={{
                backgroundColor: 'var(--reader-bg, var(--color-surface))',
                borderColor: 'color-mix(in srgb, var(--reader-fg, var(--color-text)) 15%, transparent)',
                borderWidth: '1px',
                borderStyle: 'solid',
            }}
        >
            {children}
        </div>
    );
}

export default Panel;
