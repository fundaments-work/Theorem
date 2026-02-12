import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@lionreader/core";

export interface DropdownOption<T = string> {
    value: T;
    label: string;
    disabled?: boolean;
}

export interface DropdownProps<T = string> {
    options: DropdownOption<T>[];
    value?: T;
    defaultValue?: T;
    onChange?: (value: T) => void;
    placeholder?: string;
    disabled?: boolean;
    size?: "sm" | "md" | "lg";
    variant?: "default" | "filled" | "outlined";
    className?: string;
    dropdownClassName?: string;
    align?: "left" | "right";
    showCheckmark?: boolean;
}

const sizeClasses = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
    lg: "px-4 py-2.5 text-base",
};

const variantClasses = {
    default: "bg-[var(--color-surface)] border border-[var(--color-border)]",
    filled: "bg-[var(--color-surface-muted)] border-none",
    outlined: "bg-transparent border border-[var(--color-border)]",
};

/**
 * Custom Dropdown Component
 * Replaces native <select> with styled dropdown matching the app's design system
 */
export function Dropdown<T extends string = string>({
    options,
    value,
    defaultValue,
    onChange,
    placeholder = "Select...",
    disabled = false,
    size = "md",
    variant = "default",
    className,
    dropdownClassName,
    align = "left",
    showCheckmark = true,
}: DropdownProps<T>) {
    const [isOpen, setIsOpen] = useState(false);
    const [internalValue, setInternalValue] = useState<T | undefined>(defaultValue);
    const containerRef = useRef<HTMLDivElement>(null);

    const isControlled = value !== undefined;
    const selectedValue = isControlled ? value : internalValue;
    const selectedOption = options.find((opt) => opt.value === selectedValue);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
        }

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, [isOpen]);

    // Close on escape key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener("keydown", handleKeyDown);
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen]);

    const handleSelect = (optionValue: T) => {
        const option = options.find((opt) => opt.value === optionValue);
        if (option?.disabled) return;

        if (!isControlled) {
            setInternalValue(optionValue);
        }
        onChange?.(optionValue);
        setIsOpen(false);
    };

    return (
        <div ref={containerRef} className={cn("relative inline-block", className)}>
            {/* Trigger Button */}
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={cn(
                    "flex items-center justify-between gap-2 w-full rounded-lg ui-clickable ui-focus-ring",
                    "text-[color:var(--color-text-primary)]",
                    "transition-colors duration-200",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    sizeClasses[size],
                    variantClasses[variant],
                    isOpen && "ring-2 ring-[var(--color-accent)]/50"
                )}
            >
                <span className={cn("truncate", !selectedOption && "text-[color:var(--color-text-muted)]")}>
                    {selectedOption?.label || placeholder}
                </span>
                <ChevronDown
                    className={cn(
                        "w-4 h-4 text-[color:var(--color-text-muted)] flex-shrink-0 transition-transform duration-200",
                        isOpen && "rotate-180"
                    )}
                />
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <>
                    {/* Backdrop for mobile/click-outside */}
                    <div
                        className="fixed inset-0 z-[var(--z-dropdown)]"
                        onClick={() => setIsOpen(false)}
                    />

                    {/* Menu */}
                    <div
                        className={cn(
                            "absolute z-[calc(var(--z-dropdown)+1)] mt-1 min-w-full w-max",
                            "bg-[var(--color-surface)] border border-[var(--color-border)]",
                            "rounded-lg shadow-[var(--shadow-md)]",
                            "py-1 max-h-60 overflow-y-auto",
                            align === "right" ? "right-0" : "left-0",
                            dropdownClassName
                        )}
                    >
                        {options.map((option) => {
                            const isSelected = selectedValue === option.value;
                            return (
                                <button
                                    key={String(option.value)}
                                    type="button"
                                    onClick={() => handleSelect(option.value)}
                                    disabled={option.disabled}
                                    className={cn(
                                        "flex items-center justify-between gap-3 w-full px-3 py-2 text-left",
                                        "text-sm transition-colors",
                                        "disabled:opacity-40 disabled:cursor-not-allowed",
                                        isSelected
                                            ? "bg-[var(--color-accent-light)] text-[color:var(--color-accent)]"
                                            : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-muted)] hover:text-[color:var(--color-text-primary)]"
                                    )}
                                >
                                    <span className="truncate">{option.label}</span>
                                    {showCheckmark && isSelected && (
                                        <Check className="w-4 h-4 flex-shrink-0" />
                                    )}
                                </button>
                            );
                        })}

                        {options.length === 0 && (
                            <div className="px-3 py-2 text-sm text-[color:var(--color-text-muted)]">
                                No options available
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
