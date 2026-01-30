/**
 * BookInfoPopover Component
 * Displays book metadata and additional document information
 */

import { X, Info, Calendar, Hash, Globe, FileText, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DocMetadata } from '@/engines';

interface BookInfoPopoverProps {
    metadata: DocMetadata | null;
    visible: boolean;
    onClose: () => void;
    className?: string;
}

export function BookInfoPopover({
    metadata,
    visible,
    onClose,
    className,
}: BookInfoPopoverProps) {
    if (!metadata) return null;

    const sections = [
        { label: 'Author', value: metadata.author, icon: <User className="w-4 h-4" /> },
        { label: 'Published', value: metadata.pubdate, icon: <Calendar className="w-4 h-4" /> },
        { label: 'Publisher', value: metadata.publisher, icon: <FileText className="w-4 h-4" /> },
        { label: 'Language', value: metadata.language, icon: <Globe className="w-4 h-4" /> },
        { label: 'Identifier', value: metadata.identifier, icon: <Hash className="w-4 h-4" /> },
    ].filter(s => s.value);

    return (
        <>
            {/* Backdrop */}
            {visible && (
                <div
                    className="fixed inset-0 z-40 bg-black/5"
                    onClick={onClose}
                />
            )}

            {/* Panel */}
            <div
                className={cn(
                    'fixed top-16 right-6 w-80 max-w-[calc(100vw-3rem)] z-50',
                    'bg-[var(--color-surface)] rounded-2xl shadow-2xl',
                    'border border-[var(--color-border)]',
                    'transform transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] origin-top-right',
                    visible
                        ? 'opacity-100 scale-100 translate-y-0'
                        : 'opacity-0 scale-95 -translate-y-2 pointer-events-none',
                    className
                )}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-[var(--color-background)] text-[var(--color-accent)]">
                            <Info className="w-4 h-4" />
                        </div>
                        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Book Information</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl hover:bg-[var(--color-border-subtle)] transition-colors text-[var(--color-text-secondary)]"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Cover & Title */}
                    <div className="flex gap-4">
                        {metadata.cover ? (
                            <img
                                src={metadata.cover}
                                alt={metadata.title}
                                className="w-20 aspect-[2/3] object-cover rounded-lg shadow-md border border-[var(--color-border)]"
                            />
                        ) : (
                            <div className="w-20 aspect-[2/3] bg-[var(--color-border-subtle)] rounded-lg flex items-center justify-center text-[var(--color-text-muted)] border border-[var(--color-border)]">
                                <FileText className="w-6 h-6" />
                            </div>
                        )}
                        <div className="flex-1 overflow-hidden">
                            <h3 className="text-sm font-bold text-[var(--color-text-primary)] line-clamp-2 mb-1">
                                {metadata.title}
                            </h3>
                            <p className="text-xs text-[var(--color-text-secondary)] line-clamp-1">
                                {metadata.author}
                            </p>
                        </div>
                    </div>

                    {/* Metadata List */}
                    <div className="space-y-4">
                        {sections.map((section, idx) => (
                            <div key={idx} className="flex flex-col gap-1.5">
                                <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                                    {section.icon}
                                    {section.label}
                                </span>
                                <span className="text-xs text-[var(--color-text-primary)] font-medium leading-relaxed">
                                    {section.value}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Description */}
                    {metadata.description && (
                        <div className="space-y-2 pt-2 border-t border-[var(--color-border-subtle)]">
                            <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                                Description
                            </span>
                            <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed italic line-clamp-[8]">
                                {metadata.description}
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

export default BookInfoPopover;
