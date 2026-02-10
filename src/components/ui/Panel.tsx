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
                'fixed z-50 flex flex-col reader-sheet border',
                'left-0 right-0 bottom-0 rounded-t-2xl max-h-[min(82vh,680px)]',
                'sm:bottom-auto sm:top-[calc(env(safe-area-inset-top)+4.25rem)] sm:max-h-[calc(100vh-6rem)] sm:w-[min(22rem,calc(100vw-2.5rem))] sm:rounded-2xl',
                anchor === 'top-right' && 'sm:left-auto sm:right-5',
                anchor === 'top-left' && 'sm:left-5 sm:right-auto',
                'transform transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 pointer-events-none sm:-translate-y-2',
                className
            )}
        >
            {children}
        </div>
    );
}

export default Panel;
