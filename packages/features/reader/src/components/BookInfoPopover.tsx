/**
 * BookInfoPopover Component
 * Displays book metadata and additional document information
 */

import { X, Info, Calendar, Hash, Globe, FileText, User } from 'lucide-react';
import type { DocMetadata } from '@/types';
import { Backdrop, FloatingPanel } from '@/components/ui';
import { cn, normalizeAuthor } from '@/lib/utils';

interface BookInfoPopoverProps {
    metadata: DocMetadata | null;
    visible: boolean;
    onClose: () => void;
    className?: string;
}

const METADATA_SECTIONS = [
    { key: 'author', label: 'Author', icon: User },
    { key: 'pubdate', label: 'Published', icon: Calendar },
    { key: 'publisher', label: 'Publisher', icon: FileText },
    { key: 'language', label: 'Language', icon: Globe },
    { key: 'identifier', label: 'Identifier', icon: Hash },
] as const;

export function BookInfoPopover({
    metadata,
    visible,
    onClose,
    className,
}: BookInfoPopoverProps) {
    if (!metadata) return null;

    const sections = METADATA_SECTIONS
        .map(({ key, label, icon: Icon }) => ({
            label,
            value: metadata[key as keyof DocMetadata],
            Icon,
        }))
        .filter(s => s.value);

    return (
        <>
            <Backdrop visible={visible} onClick={onClose} />

            <FloatingPanel visible={visible} className={cn("overflow-hidden", className)}>
                {/* Header */}
                <div className="reader-panel-header flex items-center justify-between p-4 sm:p-5">
                    <div className="flex items-center gap-2.5">
                        <div className="p-1.5 rounded-lg bg-[var(--color-background)] text-[color:var(--color-accent)]">
                            <Info className="w-4 h-4" />
                        </div>
                        <h2 className="text-sm font-semibold text-[color:var(--color-text-primary)]">Book Information</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="reader-chip w-8 h-8 rounded-full inline-flex items-center justify-center transition-colors hover:opacity-80 text-[color:var(--color-text-secondary)]"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="p-5 sm:p-6 space-y-6 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    {/* Cover & Title */}
                    <div className="flex gap-4">
                        {metadata.cover ? (
                            <img
                                src={metadata.cover}
                                alt={metadata.title}
                                className="w-20 aspect-[2/3] object-cover rounded-lg shadow-md border border-[var(--color-border)]"
                            />
                        ) : (
                            <div className="w-20 aspect-[2/3] bg-[var(--color-surface-muted)] rounded-lg flex items-center justify-center text-[color:var(--color-text-muted)] border border-[var(--color-border)]">
                                <FileText className="w-6 h-6" />
                            </div>
                        )}
                        <div className="flex-1 overflow-hidden">
                            <h3 className="text-sm font-bold text-[color:var(--color-text-primary)] line-clamp-2 mb-1">
                                {metadata.title}
                            </h3>
                            <p className="text-xs text-[color:var(--color-text-secondary)] line-clamp-1">
                                {normalizeAuthor(metadata.author) || "Unknown Author"}
                            </p>
                        </div>
                    </div>

                    {/* Metadata List */}
                    <div className="space-y-4">
                        {sections.map(({ label, value, Icon }, idx) => (
                            <div key={idx} className="flex flex-col gap-1.5">
                                <span className="text-[var(--font-size-3xs)] font-bold text-[color:var(--color-text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                                    <Icon className="w-4 h-4" />
                                    {label}
                                </span>
                                <span className="text-xs text-[color:var(--color-text-primary)] font-medium leading-relaxed">
                                    {value}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* Description */}
                    {metadata.description && (
                        <div className="space-y-2 pt-2 border-t border-[var(--color-border-subtle)]">
                            <span className="text-[var(--font-size-3xs)] font-bold text-[color:var(--color-text-muted)] uppercase tracking-wider">
                                Description
                            </span>
                            <p className="text-xs text-[color:var(--color-text-secondary)] leading-relaxed italic line-clamp-[8]">
                                {metadata.description}
                            </p>
                        </div>
                    )}
                </div>
            </FloatingPanel>
        </>
    );
}

export default BookInfoPopover;
