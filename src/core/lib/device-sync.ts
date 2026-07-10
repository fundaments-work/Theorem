/**
 * Theorem – Device Sync Frontend Module
 *
 * Wraps all Tauri IPC commands for the iroh P2P device sync feature.
 * This is the single point of interaction between the React UI
 * and the Rust sync backend.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri, isMobile } from "./env";
import type {
    PairedDevice,
    DeviceIdentityInfo,
    PairingQrData,
} from "../types";

// ─── Guard ───

function requireTauri(label: string): void {
    if (!isTauri()) {
        throw new Error(`[DeviceSync] ${label} requires Tauri runtime`);
    }
}

// ─── Iroh P2P Lifecycle ───

export interface IrohNodeIdResponse {
    nodeId: string;
    deviceId: string;
    fingerprint: string;
}

/** Start the iroh P2P endpoint and accept loop. Returns node identity. */
export async function irohStart(): Promise<IrohNodeIdResponse> {
    requireTauri("irohStart");
    return invoke<IrohNodeIdResponse>("iroh_start");
}

/** Stop the iroh endpoint and accept loop. */
export async function irohStop(): Promise<void> {
    requireTauri("irohStop");
    return invoke("iroh_stop");
}

/** Register a peer's iroh node ID for outbound connections. */
export async function irohPair(
    peerDeviceId: string,
    peerNodeId: string,
    peerDeviceName: string,
    peerFingerprint: string,
): Promise<void> {
    requireTauri("irohPair");
    return invoke("iroh_pair", {
        peerDeviceId,
        peerNodeId,
        peerDeviceName,
        peerFingerprint,
    });
}

// ─── Pairing ───

/**
 * Generate a QR code for pairing.
 * Also starts the server if not already running.
 * Returns the SVG string and a fallback pairing code (plain text).
 */
export async function generatePairingQr(): Promise<PairingQrData> {
    requireTauri("generatePairingQr");
    return invoke<PairingQrData>("generate_pairing_qr");
}

/**
 * Submit a pairing code (scanned from QR or entered manually).
 * Connects to the peer and completes the ECDH key exchange.
 * Returns the newly paired device.
 */
export async function submitPairingCode(
    pairingCode: string,
): Promise<PairedDevice> {
    requireTauri("submitPairingCode");
    const raw = await invoke<PairedDevice>("submit_pairing_code", { pairingCode });
    return raw;
}

// ─── Device Identity ───

/** Get this device's identity (ID, name, public key). */
export async function getDeviceIdentity(): Promise<DeviceIdentityInfo> {
    requireTauri("getDeviceIdentity");
    return invoke<DeviceIdentityInfo>("get_device_identity");
}

/**
 * Override the device fingerprint (used on Android where ANDROID_ID
 * replaces the desktop machine-id).
 */
export async function setDeviceFingerprint(
    fingerprint: string,
): Promise<void> {
    requireTauri("setDeviceFingerprint");
    return invoke("set_device_fingerprint", { fingerprint });
}

// ─── Paired Devices ───

/** Get all paired devices. */
export async function getPairedDevices(): Promise<PairedDevice[]> {
    requireTauri("getPairedDevices");
    const raw = await invoke<PairedDevice[]>("get_paired_devices");
    return raw;
}

/** Remove a paired device. */
export async function unpairDevice(deviceId: string): Promise<void> {
    requireTauri("unpairDevice");
    return invoke("unpair_device", { deviceId });
}

// ─── Sync Data Provisioning ───

/**
 * Supply the current app data snapshot to the Rust sync server.
 * Must be called before the server can respond to sync requests.
 * @param bookFilePaths Optional map of bookId → absolute file path for books
 *   that live outside the app's book-cache (e.g. imported from disk).
 */
export async function setSyncData(
    domainsMap: Record<string, string>,
    manifestMap: Record<string, any>,
    bookFilePaths?: Record<string, string>,
): Promise<void> {
    requireTauri("setSyncData");
    return invoke("set_sync_data", { domainsMap, manifestMap, bookFilePaths: bookFilePaths ?? null });
}

// ─── Sync Trigger ───

/**
 * Initiates an active sync with the given peer.
 * Retrieves all updated domains from the peer.
 */
export async function initiateSync(peerDeviceId: string): Promise<Record<string, string>> {
    requireTauri("initiateSync");
    const incomingMapJson = await invoke<string>("initiate_sync", { peerDeviceId });
    return JSON.parse(incomingMapJson);
}

/**
 * Immediately sync with every paired peer. Incoming domains are queued for
 * the existing frontend merge flow, including file and cover transfers.
 */
export async function syncNow(): Promise<void> {
    requireTauri("syncNow");
    return invoke("sync_now");
}

// ─── Responder Mode ───

/**
 * Retrieve any data that was pushed to this device by a peer.
 * Returns a map of domain name → JSON data string.
 * Clears the incoming buffer after retrieval.
 */
export async function getIncomingSyncData(): Promise<Record<string, string>> {
    requireTauri("getIncomingSyncData");
    const json = await invoke<string>("get_incoming_sync_data");
    return JSON.parse(json);
}

/**
 * Update a paired device's last-known IP address and port.
 */
export async function updatePeerAddress(
    deviceId: string,
    ip: string,
    port: number,
): Promise<void> {
    requireTauri("updatePeerAddress");
    return invoke("update_peer_address", { deviceId, ip, port });
}

// ─── File Transfer ───

/** Result from the Rust pull_book_files command. */
export interface FileTransferResult {
    /** Book IDs successfully transferred and saved to disk. */
    transferred: string[];
    /** Book IDs that failed with error details. */
    failed: Array<{ book_id: string; error: string }>;
    /** Book IDs that the peer did not have files for. */
    unavailable: string[];
}

/**
 * Pull book binary files from a paired peer device over iroh P2P.
 */
export async function pullBookFiles(
    peerDeviceId: string,
    bookIds: string[],
): Promise<FileTransferResult> {
    requireTauri("pullBookFiles");
    return invoke<FileTransferResult>("pull_book_files", { peerDeviceId, bookIds });
}

export interface CoverTransferResult {
    transferred: string[];
    failed: Array<{ book_id: string; error: string }>;
    unavailable: string[];
    covers: Record<string, string>;
}

/**
 * Pull cover images for books from a paired peer device.
 * Covers are fetched in parallel and saved to the SQLite covers table.
 */
export async function pullBookCovers(
    peerDeviceId: string,
    bookIds: string[],
): Promise<CoverTransferResult> {
    requireTauri("pullBookCovers");
    return invoke<CoverTransferResult>("pull_book_covers", { peerDeviceId, bookIds });
}

// ─── Background Sync ───

/**
 * Start the background sync scheduler (Rust-side periodic timer).
 * On Android, also starts the ForegroundService to keep the process alive
 * when the app is backgrounded. Uses the "connectedDevice" foreground
 * service type on Android 14+ (same as KDE Connect) which is not
 * aggressively blocked by MIUI/Xiaomi.
 * @param intervalSecs How often to sync (default 300 = 5 min, min 60).
 */
export async function startBackgroundSync(intervalSecs?: number): Promise<void> {
    requireTauri("startBackgroundSync");
    const interval = intervalSecs ?? 300;
    await invoke("start_background_sync", { intervalSecs: interval });

    // On Android, start the ForegroundService + schedule WorkManager.
    if (isMobile()) {
        try {
            await invoke("start_android_sync_worker");
            await updateSyncNotification(
                `Ready — auto-sync every ${Math.round(interval / 60)} min`,
            );
        } catch {
            // ForegroundService not available or denied.
        }
        // Schedule WorkManager as a fallback — survives app kill.
        // WorkManager fires every 15 min and runs a standalone sync
        // round via JNI even if the Tauri process was killed.
        await schedulePeriodicSyncWork();
    }
}

/** Stop the background sync scheduler and Android ForegroundService. */
export async function stopBackgroundSync(): Promise<void> {
    requireTauri("stopBackgroundSync");
    await invoke("stop_background_sync");

    if (isMobile()) {
        try {
            await invoke("stop_android_sync_worker");
        } catch {
            // ForegroundService not available.
        }
        await cancelPeriodicSyncWork();
    }
}

/** Update the sync notification text on Android (shows what's being synced). */
export async function updateSyncNotification(text: string): Promise<void> {
    if (!isMobile()) return;
    try {
        await invoke("update_sync_notification", { text });
    } catch {
        // Notification update not available.
    }
}

/** Schedule periodic WorkManager background sync (survives app kill). */
export async function schedulePeriodicSyncWork(): Promise<void> {
    if (!isMobile()) return;
    try {
        await invoke("schedule_sync_work");
    } catch {
        // WorkManager not available.
    }
}

/** Cancel periodic WorkManager background sync. */
export async function cancelPeriodicSyncWork(): Promise<void> {
    if (!isMobile()) return;
    try {
        await invoke("cancel_sync_work");
    } catch {
        // WorkManager not available.
    }
}

/**
 * Wake the Rust background sync loop so it syncs immediately
 * instead of waiting for the next timer tick.
 * Called after data mutations so the backend picks up changes
 * without the full interval delay.
 */
export async function wakeBackgroundSync(): Promise<void> {
    requireTauri("wakeBackgroundSync");
    return invoke("wake_background_sync");
}

/** Update the auto-sync-disabled flag file for Android JNI worker. */
export async function setAutoSyncFlag(enabled: boolean): Promise<void> {
    if (!isTauri()) return;
    try {
        await invoke("set_auto_sync_flag", { enabled });
    } catch {
        // Flag file operation failed — non-critical.
    }
}
