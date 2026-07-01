import { createContext, useContext, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "../core/lib/utils";

const ModalHeaderIdContext = createContext<string | undefined>(undefined);

const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    className?: string;
    size?: "sm" | "md" | "lg" | "xl" | "fullscreen";
    showCloseButton?: boolean;
    ariaLabelledby?: string;
}

const sizeClasses = {
    sm: "max-w-[var(--layout-modal-width-sm)]",
    md: "",
    lg: "max-w-[var(--layout-modal-width-lg)]",
    xl: "max-w-[var(--layout-modal-width-xl)]",
    fullscreen: "h-screen max-h-none w-screen max-w-none border-0",
};

/**
 * Reusable Modal Component using React Portal
 * Renders outside the main DOM tree for proper z-index stacking
 * Swiss Design Standard
 */
export function Modal({
    isOpen,
    onClose,
    children,
    className,
    size = "md",
    ariaLabelledby,
}: ModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLElement | null>(null);
    const autoHeaderId = useId();
    const headerId = ariaLabelledby || autoHeaderId;

    useEffect(() => {
        if (isOpen) {
            triggerRef.current = document.activeElement as HTMLElement;
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            if (triggerRef.current) {
                try {
                    triggerRef.current.focus();
                } catch {
                    // element may have been removed from DOM
                }
                triggerRef.current = null;
            }
            return;
        }

        const timer = setTimeout(() => {
            const dialog = dialogRef.current;
            if (!dialog) return;
            const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
            if (focusable.length > 0) {
                focusable[0].focus();
            } else {
                dialog.focus();
            }
        }, 0);

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
                return;
            }

            if (e.key !== "Tab") return;

            const dialog = dialogRef.current;
            if (!dialog) return;

            const focusable = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
            if (focusable.length === 0) {
                e.preventDefault();
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];

            if (!dialog.contains(document.activeElement)) {
                e.preventDefault();
                first.focus();
                return;
            }

            if (e.shiftKey) {
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (e.target === overlayRef.current) {
                onClose();
            }
        };

        document.body.style.overflow = "hidden";
        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("mousedown", handleClickOutside);

        return () => {
            clearTimeout(timer);
            document.body.style.overflow = "";
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const main = document.querySelector("main") || document.getElementById("root");
        if (main) {
            main.setAttribute("aria-hidden", "true");
            return () => {
                main.removeAttribute("aria-hidden");
            };
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return createPortal(
        <div
            ref={overlayRef}
            className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-[var(--color-overlay-strong)] p-4"
            onClick={(e) => {
                if (e.target === overlayRef.current) {
                    onClose();
                }
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={headerId}
                tabIndex={-1}
                className={cn(
                    "flex w-full max-h-[var(--layout-modal-max-height)] max-w-[var(--layout-modal-width-md)] flex-col overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)] outline-none",
                    sizeClasses[size],
                    className
                )}
            >
                <ModalHeaderIdContext.Provider value={headerId}>
                    {children}
                </ModalHeaderIdContext.Provider>
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
    const headerId = useContext(ModalHeaderIdContext);
    return (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
            <h2
                id={headerId}
                className="text-base font-semibold uppercase tracking-[0.08em] text-[color:var(--color-text-primary)]"
            >
                {title}
            </h2>
            {showCloseButton && onClose && (
                <button
                    onClick={onClose}
                    className="inline-flex h-9 w-9 items-center justify-center border border-[color:var(--color-border-subtle)] bg-transparent text-[color:var(--color-text-secondary)] transition-[background-color,border-color,color,opacity] duration-200 ease-out hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)] data-[active=true]:border-[var(--color-accent)] data-[active=true]:bg-[var(--color-accent)] data-[active=true]:text-[color:var(--color-accent-contrast)]"
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
        <div className={cn("flex-1 overflow-y-auto px-5 py-5", className)}>
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
        <div className={cn("relative flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4", className)}>
            {children}
        </div>
    );
}
