import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
    size?: "sm" | "md" | "lg" | "xl";
    showCloseButton?: boolean;
}

const sizeClasses = {
    sm: "max-w-md min-w-[min(var(--layout-modal-width-fluid),var(--layout-modal-width-sm))]",
    md: "max-w-xl min-w-[min(var(--layout-modal-width-fluid),var(--layout-modal-width-md))]",
    lg: "max-w-2xl min-w-[min(var(--layout-modal-width-fluid),var(--layout-modal-width-lg))]",
    xl: "max-w-4xl min-w-[min(var(--layout-modal-width-fluid),var(--layout-modal-width-xl))]",
};

/**
 * Reusable Modal Component using React Portal
 * Renders outside the main DOM tree for proper z-index stacking
 */
export function Modal({
    isOpen,
    onClose,
    children,
    className,
    size = "md",
    showCloseButton = true,
}: ModalProps) {
    const overlayRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (e.target === overlayRef.current) {
                onClose();
            }
        };

        // Lock body scroll when modal is open
        document.body.style.overflow = "hidden";

        // Add event listeners
        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            document.body.style.overflow = "";
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return createPortal(
        <div
            ref={overlayRef}
            className={cn(
                "fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4",
                "bg-[var(--color-overlay-strong)]",
                "animate-fade-in"
            )}
            onClick={(e) => {
                if (e.target === overlayRef.current) {
                    onClose();
                }
            }}
        >
            <div
                className={cn(
                    "ui-card bg-[var(--color-surface)] rounded-xl shadow-[var(--shadow-lg)]",
                    "flex flex-col max-h-[var(--layout-modal-max-height)]",
                    "overflow-hidden",
                    "w-full",
                    sizeClasses[size],
                    className
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>,
        document.body
    );
}

interface ModalHeaderProps {
    title: string;
    onClose?: () => void;
    showCloseButton?: boolean;
}

export function ModalHeader({ title, onClose, showCloseButton = true }: ModalHeaderProps) {
    return (
        <div className="flex items-center justify-between p-6 border-b border-[var(--color-border)]">
            <h2 className="text-lg font-semibold text-[color:var(--color-text-primary)]">
                {title}
            </h2>
            {showCloseButton && onClose && (
                <button
                    onClick={onClose}
                    className="ui-icon-btn w-8 h-8 rounded-lg text-[color:var(--color-text-muted)]"
                    aria-label="Close"
                >
                    <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                        />
                    </svg>
                </button>
            )}
        </div>
    );
}

export function ModalBody({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={cn("p-6 overflow-y-auto flex-1", className)}>
            {children}
        </div>
    );
}

interface ModalFooterProps {
    children: React.ReactNode;
    className?: string;
}

export function ModalFooter({ children, className }: ModalFooterProps) {
    return (
        <div className={cn("p-4 border-t border-[var(--color-border)] flex justify-end gap-2", className)}>
            {children}
        </div>
    );
}
/* Modal Portal Implementation v2 - Mon Feb  2 04:41:48 PM +0545 2026 */
