import { cn } from "../../core/lib/utils";

export interface SkeletonProps {
    className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
    return (
        <div aria-hidden className={cn("animate-pulse rounded bg-[var(--color-border-subtle)]", className)} />
    );
}
