import { useEffect, useState } from "react";
import { cn } from "../../core/lib/utils";

export interface SplashScreenProps {
    isReady?: boolean;
    onFinish?: () => void;
    message?: string;
}

export function SplashScreen({ isReady = false, onFinish, message = "Loading Theorem…" }: SplashScreenProps) {
    const [visible, setVisible] = useState(true);
    const [fadeOut, setFadeOut] = useState(false);

    useEffect(() => {
        if (isReady) {
            setFadeOut(true);
            const timer = setTimeout(() => {
                setVisible(false);
                onFinish?.();
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [isReady, onFinish]);

    if (!visible) return null;

    return (
        <div
            className={cn(
                "fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black text-white select-none",
                "transition-opacity duration-300 ease-out",
                fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"
            )}
            aria-label="Theorem Splash Screen"
        >
            <div className="flex flex-col items-center gap-6 px-6 text-center animate-fade-in">
                {/* Theorem Q.E.D. Emblem */}
                <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-[#121212] border border-[#27272a] shadow-2xl">
                    <svg viewBox="0 0 512 512" className="h-11 w-11 text-white" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path
                            transform="translate(128, 128) scale(10.666)"
                            d="M 4 4 H 20 V 8 L 14 8 V 16 H 18 V 20 H 14 L 10 20 V 8 L 4 8 V 4 Z M 10 16 H 14 V 20 H 10 V 16 Z"
                            fillRule="evenodd"
                        />
                    </svg>
                </div>

                {/* Typography */}
                <div className="flex flex-col items-center gap-1.5">
                    <h1 className="font-sans text-xl font-bold tracking-[0.25em] uppercase text-white">
                        Theorem
                    </h1>
                    <p className="text-[11px] font-medium tracking-[0.18em] uppercase text-zinc-400">
                        Local-First Knowledge & Reader
                    </p>
                </div>

                {/* Subtle Monochrome Loading Line */}
                <div className="mt-4 flex flex-col items-center gap-2">
                    <div className="h-0.5 w-28 overflow-hidden rounded-full bg-zinc-800">
                        <div className="h-full w-full bg-white animate-pulse" />
                    </div>
                    {message ? (
                        <span className="text-[11px] text-zinc-400 font-mono">
                            {message}
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
