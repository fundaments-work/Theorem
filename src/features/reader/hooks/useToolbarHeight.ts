import { useLayoutEffect, useState, type RefObject } from "react";

interface UseToolbarHeightOptions {
    defaultHeight?: number;
    minHeight?: number;
    enabled?: boolean;
}

export function useToolbarHeight(
    containerRef: RefObject<HTMLElement | null>,
    options: UseToolbarHeightOptions = {},
): number {
    const {
        defaultHeight = 56,
        minHeight = 44,
        enabled = true,
    } = options;
    const [height, setHeight] = useState(defaultHeight);

    useLayoutEffect(() => {
        if (!enabled || typeof window === "undefined") {
            return;
        }

        const toolbarNode = containerRef.current;
        if (!toolbarNode) {
            return;
        }

        const updateToolbarHeight = () => {
            const measuredHeight = Math.ceil(toolbarNode.getBoundingClientRect().height);
            if (measuredHeight > 0) {
                setHeight(Math.max(minHeight, measuredHeight));
            }
        };

        updateToolbarHeight();

        let resizeObserver: ResizeObserver | null = null;
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(updateToolbarHeight);
            resizeObserver.observe(toolbarNode);
        }

        window.addEventListener("resize", updateToolbarHeight, { passive: true });
        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener("resize", updateToolbarHeight);
        };
    }, [containerRef, enabled, minHeight]);

    return height;
}
