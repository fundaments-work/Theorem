/**
 * Environment detection utilities
 * Tauri-only desktop application
 */

import { useEffect, useCallback } from 'react';

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
    useEffect(() => {
        if (!isTauriMobile()) return;

        // Push initial state to enable back button handling
        window.history.pushState({ __theorem_back: true }, '');

        const handlePopState = () => {
            const handled = handler();
            if (handled) {
                // Re-push state to continue handling future back buttons
                window.history.pushState({ __theorem_back: true }, '');
            }
            // If not handled, the app will exit (default Android behavior)
        };

        window.addEventListener('popstate', handlePopState);

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [handler]);
}
