import { useState, useEffect } from "react";

export function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        
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
