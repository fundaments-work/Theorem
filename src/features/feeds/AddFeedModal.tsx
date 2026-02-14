/**
 * Add Feed Modal
 * Modal for subscribing to a new RSS feed
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@theorem/core";
import { Modal, ModalBody, ModalFooter } from "@theorem/ui";
import { Loader2, Rss, AlertCircle } from "lucide-react";

interface AddFeedModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (url: string) => Promise<void>;
    isLoading?: boolean;
    error?: string;
}

export function AddFeedModal({ isOpen, onClose, onSubmit, isLoading, error }: AddFeedModalProps) {
    const [url, setUrl] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setUrl("");
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    const handleSubmit = useCallback(async () => {
        const trimmed = url.trim();
        if (!trimmed) return;

        // Basic URL validation
        let feedUrl = trimmed;
        if (!feedUrl.startsWith("http://") && !feedUrl.startsWith("https://")) {
            feedUrl = "https://" + feedUrl;
        }

        await onSubmit(feedUrl);
    }, [url, onSubmit]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !isLoading) {
            e.preventDefault();
            handleSubmit();
        }
    }, [handleSubmit, isLoading]);

    return (
        <Modal isOpen={isOpen} onClose={onClose} size="sm" showCloseButton={true}>
            <ModalBody className="p-0">
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center">
                            <Rss className="w-5 h-5 text-[color:var(--color-accent)]" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-[color:var(--color-text-primary)]">
                                Add Feed
                            </h2>
                            <p className="text-xs text-[color:var(--color-text-muted)]">
                                Subscribe to an RSS or Atom feed
                            </p>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs text-[color:var(--color-text-muted)] uppercase mb-1.5">
                                Feed URL
                            </label>
                            <input
                                ref={inputRef}
                                type="url"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="https://example.com/feed.xml"
                                disabled={isLoading}
                                className={cn(
                                    "w-full px-3 py-2.5 rounded-lg",
                                    "bg-[var(--color-background)] border border-[var(--color-border)]",
                                    "text-sm text-[color:var(--color-text-primary)]",
                                    "placeholder:text-[color:var(--color-text-muted)]",
                                    "focus:outline-none focus:border-[var(--color-accent)]",
                                    "transition-colors",
                                    "disabled:opacity-50",
                                )}
                            />
                        </div>

                        {error && (
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--color-error)]/10">
                                <AlertCircle className="w-4 h-4 text-[color:var(--color-error)] mt-0.5 flex-shrink-0" />
                                <div className="text-xs text-[color:var(--color-error)] whitespace-pre-wrap leading-relaxed">
                                    {error}
                                </div>
                            </div>
                        )}

                        <p className="text-[var(--font-size-3xs)] text-[color:var(--color-text-muted)]">
                            Enter the URL of an RSS or Atom feed. Most blogs and news sites provide feed URLs.
                        </p>
                    </div>
                </div>
            </ModalBody>
            <ModalFooter>
                <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg text-sm text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)] transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={isLoading || !url.trim()}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-lg",
                        "bg-[var(--color-accent)] text-[color:var(--color-accent-contrast)] text-sm font-medium",
                        "hover:opacity-90 transition-opacity",
                        "disabled:opacity-50 disabled:cursor-not-allowed",
                    )}
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Adding...</span>
                        </>
                    ) : (
                        <span>Subscribe</span>
                    )}
                </button>
            </ModalFooter>
        </Modal>
    );
}
