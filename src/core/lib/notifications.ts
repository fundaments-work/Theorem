/**
 * Native OS notification service via tauri-plugin-notification.
 * Falls back to a no-op in browser mode.
 */

import { isTauri } from "./env";

type NotificationPermission = "granted" | "denied" | "default" | "prompt";

let _isPermissionGranted: (() => Promise<boolean>) | undefined;
let _requestPermission: (() => Promise<NotificationPermission>) | undefined;
let _sendNotification: ((options: { title: string; body: string }) => void) | undefined;

async function ensureBindings() {
    if (_sendNotification) return;
    if (!isTauri()) return;
    try {
        const mod = await import("@tauri-apps/plugin-notification");
        _isPermissionGranted = mod.isPermissionGranted;
        _requestPermission = mod.requestPermission;
        _sendNotification = mod.sendNotification;
    } catch {
        /* plugin not available */
    }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
    await ensureBindings();
    if (_isPermissionGranted && _requestPermission) {
        const granted = await _isPermissionGranted();
        if (granted) return "granted";
        return await _requestPermission();
    }
    if ("Notification" in window) {
        const result = await window.Notification.requestPermission();
        return result;
    }
    return "denied";
}

export async function notify(title: string, body: string) {
    await ensureBindings();
    if (_sendNotification) {
        await _sendNotification({ title, body });
    } else if ("Notification" in window && window.Notification.permission === "granted") {
        new window.Notification(title, { body });
    }
}

export async function notifyIfGranted(title: string, body: string) {
    await ensureBindings();
    if (_isPermissionGranted) {
        const granted = await _isPermissionGranted();
        if (granted) {
            await notify(title, body);
        } else if (_requestPermission) {
            const permission = await _requestPermission();
            if (permission === "granted") {
                await notify(title, body);
            }
        }
    } else if ("Notification" in window) {
        if (window.Notification.permission === "granted") {
            await notify(title, body);
        } else if (window.Notification.permission === "default") {
            const permission = await window.Notification.requestPermission();
            if (permission === "granted") {
                await notify(title, body);
            }
        }
    }
}
