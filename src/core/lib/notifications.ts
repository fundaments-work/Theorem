/**
 * Native OS notification service via tauri-plugin-notification.
 * Falls back to a no-op in browser mode.
 */

import { isTauri } from "./env";

type NotificationPermission = "granted" | "denied" | "default" | "prompt";

let _isPermissionGranted: (() => Promise<boolean>) | undefined;
let _requestPermission: (() => Promise<NotificationPermission>) | undefined;
let _sendNotification: ((options: { title: string; body: string; icon?: string }) => void) | undefined;

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

export async function resolveNotificationIcon(name: string): Promise<string | undefined> {
    if (!isTauri()) return undefined;
    try {
        const { resourceDir, join } = await import("@tauri-apps/api/path");
        return await join(await resourceDir(), "resources", name);
    } catch {
        return undefined;
    }
}

export async function notify(title: string, body?: string, icon?: string) {
    await ensureBindings();
    if (_sendNotification) {
        await _sendNotification({ title, body: body ?? "", ...(icon ? { icon } : {}) });
    } else if ("Notification" in window && window.Notification.permission === "granted") {
        new window.Notification(title, { body });
    }
}

export async function notifyIfGranted(title: string, body?: string, icon?: string) {
    await ensureBindings();
    if (_isPermissionGranted) {
        const granted = await _isPermissionGranted();
        if (granted) {
            await notify(title, body, icon);
        } else if (_requestPermission) {
            const permission = await _requestPermission();
            if (permission === "granted") {
                await notify(title, body, icon);
            }
        }
    } else if ("Notification" in window) {
        if (window.Notification.permission === "granted") {
            await notify(title, body, icon);
        } else if (window.Notification.permission === "default") {
            const permission = await window.Notification.requestPermission();
            if (permission === "granted") {
                await notify(title, body, icon);
            }
        }
    }
}
