import { cn } from "../../core/lib/utils";

export interface SpinnerProps {
    size?: "sm" | "md" | "lg";
    className?: string;
    label?: string;
}

const SPINNER_SIZES = {
    sm: "h-4 w-4 border-2",
    md: "h-8 w-8 border-3",
    lg: "h-12 w-12 border-3",
} as const;

export function Spinner({ size = "md", className, label = "Loading..." }: SpinnerProps) {
    return (
        <span role="status" aria-label={label} className="inline-flex items-center justify-center">
            <span
                className={cn(
                    "rounded-full border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin",
                    SPINNER_SIZES[size],
                    className,
                )}
            />
            <span className="sr-only">{label}</span>
        </span>
    );
}
