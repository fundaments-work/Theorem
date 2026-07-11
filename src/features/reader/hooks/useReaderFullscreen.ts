import { useEffect } from "react";

interface UseReaderFullscreenOptions {
    fullscreen: boolean;
    enabled?: boolean;
    onExitFullscreen?: () => void;
    errorLabel?: string;
}

export function useReaderFullscreen({
    fullscreen,
    enabled = true,
    onExitFullscreen,
    errorLabel = "[Reader]",
}: UseReaderFullscreenOptions): void {
    useEffect(() => {
        if (!enabled || typeof document === "undefined") {
            return;
        }

        const syncFullscreenState = async () => {
            try {
                if (fullscreen) {
                    if (!document.fullscreenElement) {
                        await document.documentElement.requestFullscreen();
                    }
                    return;
                }

                if (document.fullscreenElement) {
                    await document.exitFullscreen();
                }
            } catch (error) {
            }
        };

        void syncFullscreenState();

        const handleFullscreenChange = () => {
            if (!document.fullscreenElement && fullscreen) {
                onExitFullscreen?.();
            }
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
            if (fullscreen && document.fullscreenElement) {
                void document.exitFullscreen().catch(e => console.error("[catch]", e));
            }
        };
    }, [enabled, errorLabel, fullscreen, onExitFullscreen]);
}
