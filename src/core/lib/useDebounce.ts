import { useState, useEffect } from "react";

export function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        // Skip debounce when value is an empty string — clearing the
        // search input must reset results immediately, not after 250ms.
        const effectiveDelay = typeof value === "string" && value === "" ? 0 : delay;
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, effectiveDelay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
}
