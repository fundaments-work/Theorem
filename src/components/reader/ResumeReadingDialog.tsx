/**
 * ResumeReadingDialog Component
 * Shows a brief notification when resuming reading from saved position
 */

import { useEffect, useState } from 'react';
import { BookOpen, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResumeReadingDialogProps {
    isVisible: boolean;
    progress: number;
    onDismiss: () => void;
    onRestart: () => void;
}

export function ResumeReadingDialog({
    isVisible,
    progress,
    onDismiss,
    onRestart,
}: ResumeReadingDialogProps) {
    const [showRestart, setShowRestart] = useState(false);

    useEffect(() => {
        if (!isVisible) return;

        // Show restart option after 3 seconds
        const timer = setTimeout(() => {
            setShowRestart(true);
        }, 3000);

        // Auto-dismiss after 5 seconds
        const dismissTimer = setTimeout(() => {
            onDismiss();
        }, 5000);

        return () => {
            clearTimeout(timer);
            clearTimeout(dismissTimer);
        };
    }, [isVisible, onDismiss]);

    if (!isVisible) return null;

    const percentage = Math.round(progress * 100);

    return (
        <div
            className={cn(
                "fixed z-50",
                "top-24 left-1/2 -translate-x-1/2",
                "bg-[var(--color-surface)]",
                "border border-[var(--color-border)]",
                "rounded-xl shadow-xl",
                "px-4 py-3",
                "flex items-center gap-3",
                "animate-fade-in"
            )}
            style={{
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)',
            }}
        >
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                <BookOpen className="w-5 h-5" />
            </div>
            
            <div className="flex flex-col">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                    Resuming from {percentage}%
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">
                    Picking up where you left off
                </span>
            </div>

            {showRestart && (
                <button
                    onClick={() => {
                        onRestart();
                        onDismiss();
                    }}
                    className={cn(
                        "ml-2 flex items-center gap-1.5",
                        "px-3 py-1.5 text-xs font-medium",
                        "rounded-lg",
                        "text-[var(--color-text-secondary)]",
                        "hover:bg-[var(--color-surface-hover)]",
                        "hover:text-[var(--color-text-primary)]",
                        "transition-colors"
                    )}
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Start Over
                </button>
            )}
        </div>
    );
}

export default ResumeReadingDialog;
