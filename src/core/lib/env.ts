/**
 * Environment detection utilities
 * Tauri-only desktop application
 */

import { useEffect, useCallback, useRef } from 'react';

/**
 * Check if running in a Tauri environment
 */
export function isTauri(): boolean {
    return typeof window !== 'undefined' && (
        !!(window as any).__TAURI_INTERNALS__ ||
        !!(window as any).__TAURI__ ||
        !!(window as any).__TAURI_IPC__
    );
}

/**
 * Check if running on mobile (for UI adaptations)
 */
export function isMobile(): boolean {
    if (typeof window === 'undefined') return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
    );
}

/**
 * Check if running in Tauri on a mobile device.
 */
export function isTauriMobile(): boolean {
    return isTauri() && isMobile();
}

/**
 * Check if running in Tauri on desktop.
 */
export function isTauriDesktop(): boolean {
    return isTauri() && !isMobile();
}

/**
 * Check if runtime browser engine is WebKit (Safari/WebKitGTK).
 * Excludes Chromium- and Firefox-based user agents.
 */
export function isWebKitBrowserEngine(): boolean {
    if (typeof navigator === 'undefined') return false;

    const userAgent = navigator.userAgent;
    const isWebKit = /AppleWebKit/i.test(userAgent);
    const isChromiumBased = /Chrome|Chromium|CriOS|Edg\//i.test(userAgent);
    const isFirefoxBased = /Firefox|FxiOS/i.test(userAgent);

    return isWebKit && !isChromiumBased && !isFirefoxBased;
}

/**
 * Check if running on a touch device
 */
export function isTouchDevice(): boolean {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Hook to handle Android back button in Tauri
 * Uses history API to intercept back button
 */
export function useAndroidBackButton(handler: () => boolean) {
    const handlerRef = useRef(handler);

    // Keep handler ref up to date without triggering effect re-runs
    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    useEffect(() => {
        if (!isTauriMobile()) return;

        // Push initial interceptor state
        // We only do this once on mount of the component using the hook
        window.history.pushState({ __theorem_back: true }, '');

        const handlePopState = (event: PopStateEvent) => {
            // Only handle our specific back interceptor state
            // If the state being popped ISN'T ours, let App.tsx handle it
            const state = event.state;

            // If we find ourselves back at a state without our flag, it means we've
            // already "popped" the interceptor.
            const handled = handlerRef.current();

            if (handled) {
                // handler returned true: they intercepted the back action (e.g. closed a modal)
                // stay on current page by re-pushing the interceptor state
                window.history.pushState({ __theorem_back: true }, '');
            } else {
                // handler returned false: they WANT to proceed with back navigation
                // We've already popped the interceptor state, so we just let it be.
                // The browser/webview is now at the state BEFORE our interceptor.
            }
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
            // If we are unmounting, we might want to go back once more if we're still 
            // sitting on our dummy state, but usually the navigation that caused
            // unmount has already cleared it.
        };
    }, []); // Only run on mount
}
