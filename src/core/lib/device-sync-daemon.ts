/**
 * Theorem – Device Sync Daemon Frontend Module
 *
 * Wraps HTTP calls to the sync daemon's local REST control API (port 43936).
 * Falls back gracefully when the daemon is not running.
 */

import type { PairedDevice, DeviceIdentityInfo } from "../types";

const DAEMON_BASE = "http://127.0.0.1:43936";

/** Create an AbortSignal that times out after `ms` milliseconds.
 *  Uses AbortController internally for compatibility with older WebViews
 *  where AbortSignal.timeout() may not exist. */
function timeoutSignal(ms: number): AbortSignal {
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
        return AbortSignal.timeout(ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
}

// ─── Daemon Health ───

export async function isDaemonRunning(): Promise<boolean> {
    try {
        const res = await fetch(`${DAEMON_BASE}/daemon/health`, {
            signal: timeoutSignal(2000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

export interface DaemonStatus {
    running: boolean;
    device_id: string;
    device_name: string;
    server_port: number;
    paired_devices: PairedDevice[];
    auto_sync_enabled: boolean;
    last_sync_at: string | null;
}

export async function getDaemonStatus(): Promise<DaemonStatus | null> {
    try {
        const res = await fetch(`${DAEMON_BASE}/daemon/status`, {
            signal: timeoutSignal(2000),
        });
        if (!res.ok) return null;
        const body = await res.json();
        return body.data ?? null;
    } catch {
        return null;
    }
}

// ─── Sync Data ───

export async function pushSyncDataToDaemon(
    domains: Record<string, string>,
    manifest: Record<string, any>,
    bookFilePaths?: Record<string, string>,
): Promise<boolean> {
    try {
        const res = await fetch(`${DAEMON_BASE}/daemon/set-sync-data`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domains, manifest, bookFilePaths: bookFilePaths ?? {} }),
            signal: timeoutSignal(5000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

// ─── Sync Trigger ───

export async function triggerDaemonSync(): Promise<boolean> {
    try {
        const res = await fetch(`${DAEMON_BASE}/daemon/sync-now`, {
            method: "POST",
            signal: timeoutSignal(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

// ─── Daemon Configuration ───

export async function configureDaemon(config: Record<string, any>): Promise<boolean> {
    try {
        const res = await fetch(`${DAEMON_BASE}/daemon/configure`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
            signal: timeoutSignal(3000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

// ─── Device Identity from Daemon ───

export async function getDaemonDeviceIdentity(): Promise<DeviceIdentityInfo | null> {
    const status = await getDaemonStatus();
    if (!status) return null;
    return {
        deviceId: status.device_id,
        deviceName: status.device_name,
        publicKeyHex: "",
    };
}

// ─── Paired Devices from Daemon ───

export async function getDaemonPairedDevices(): Promise<PairedDevice[]> {
    const status = await getDaemonStatus();
    if (!status) return [];
    return status.paired_devices;
}
