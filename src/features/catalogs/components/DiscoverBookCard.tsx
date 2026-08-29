import { useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../../../core/lib/utils";
import { useLibraryStore, useUIStore } from "../../../core/store";
import { DiscoverService } from "../../../core/services/DiscoverService";
import type { OpdsEntry } from "../../../core/types";
import { TheoremBookCover } from "../../../ui";

export interface DiscoverBookCardProps {
    entry: OpdsEntry;
    onSelect?: (entry: OpdsEntry) => void;
    className?: string;
}

export function DiscoverBookCard({ entry, onSelect, className }: DiscoverBookCardProps) {
    const books = useLibraryStore((state) => state.books);
    const setRoute = useUIStore((state) => state.setRoute);
    const [isDownloading, setIsDownloading] = useState(false);

    // Check if user already has this book in their library
    const existingBook = books.find(
        (b) => b.title.toLowerCase().trim() === entry.title.toLowerCase().trim()
    );

    const handleGet = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (existingBook) {
            setRoute("library");
            return;
        }

        setIsDownloading(true);
        const toastId = toast.loading(`Adding "${entry.title}"…`);
        try {
            await DiscoverService.downloadBook(entry, (msg) => {
                toast.loading(msg, { id: toastId });
            });
            toast.success(`"${entry.title}" is in your Library`, {
                id: toastId,
                action: {
                    label: "Open Library",
                    onClick: () => setRoute("library"),
                },
            });
        } catch (err: any) {
            toast.error(err.message || "Failed to download book", { id: toastId });
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div
            onClick={() => onSelect?.(entry)}
            className={cn(
                "group relative flex flex-col cursor-pointer select-none transition-transform active:scale-[0.98]",
                className
            )}
        >
            {/* Book Cover Container */}
            <div className="relative aspect-[2/3] w-full rounded-lg overflow-hidden border border-[var(--color-border)] shadow-sm group-hover:shadow-md group-hover:border-[var(--color-border-strong)] transition-all duration-200">
                <TheoremBookCover
                    title={entry.title}
                    author={entry.author}
                    coverUrl={entry.coverUrl || entry.thumbnailUrl}
                />

                {/* Micro Action Button on Cover */}
                <button
                    onClick={handleGet}
                    disabled={isDownloading}
                    className={cn(
                        "absolute bottom-2.5 right-2.5 z-20 flex items-center justify-center rounded-full transition-all duration-200 shadow-md",
                        existingBook
                            ? "h-7 px-2.5 bg-zinc-900 text-zinc-100 text-[10px] font-bold border border-zinc-700 hover:bg-black"
                            : "h-7 px-2.5 bg-white text-black text-[10px] font-bold hover:bg-neutral-200 active:scale-95"
                    )}
                    title={existingBook ? "In Library" : "Add to Library"}
                >
                    {isDownloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : existingBook ? (
                        <span className="flex items-center gap-1">
                            <Check className="h-3 w-3" />
                            <span>In Library</span>
                        </span>
                    ) : (
                        <span className="flex items-center gap-1">
                            <Download className="h-3 w-3" />
                            <span>Get</span>
                        </span>
                    )}
                </button>
            </div>

            {/* Title & Author */}
            <div className="mt-2.5 flex flex-col min-w-0">
                <h3 className="text-xs font-bold text-[color:var(--color-text-primary)] truncate group-hover:text-[color:var(--color-accent)] transition-colors">
                    {entry.title}
                </h3>
                <p className="text-[11px] font-medium text-[color:var(--color-text-muted)] truncate mt-0.5">
                    {entry.author || "Public Domain"}
                </p>
            </div>
        </div>
    );
}
