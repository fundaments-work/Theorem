import { cn } from "../../core/lib/utils";
import { Spinner } from "./Spinner";

export interface PageLoaderProps {
    message?: string;
    className?: string;
}

export function PageLoader({ message, className }: PageLoaderProps) {
    return (
        <div
            role="status"
            className={cn(
                "flex h-full w-full flex-col items-center justify-center bg-[var(--color-background)]",
                className,
            )}
        >
            <Spinner size="lg" label={message ?? "Loading..."} />
            {message ? (
                <p className="mt-4 text-sm text-[color:var(--color-text-muted)]">{message}</p>
            ) : null}
        </div>
    );
}
