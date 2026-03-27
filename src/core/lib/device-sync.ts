/**
 * Theorem – Device Sync Frontend Module
 *
 * Wraps all Tauri IPC commands for the LAN device sync feature.
 * This is the single point of interaction between the React UI
 * and the Rust sync backend.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env";
import type {
    PairedDevice,
    DeviceIdentityInfo,
    SyncServerInfo,
    PairingQrData,
} from "../types";

// ─── Guard ───

function requireTauri(label: string): void {
    if (!isTauri()) {
        throw new Error(`[DeviceSync] ${label} requires Tauri runtime`);
    }
}

// ─── Server Lifecycle ───

/** Start the embedded sync server. Returns the server's LAN IP and port. */
export async function startSyncServer(): Promise<SyncServerInfo> {
    requireTauri("startSyncServer");
    return invoke<SyncServerInfo>("start_sync_server");
}

/** Stop the sync server. */
export async function stopSyncServer(): Promise<void> {
    requireTauri("stopSyncServer");
    return invoke("stop_sync_server");
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
    const raw = await invoke<{
        device_id: string;
        device_name: string;
        last_ip: string;
        last_port: number;
        paired_at: string;
        last_sync_at?: string;
    }>("submit_pairing_code", { pairingCode });

    // Map snake_case (Rust) to camelCase (TypeScript).
    return {
        deviceId: raw.device_id,
        deviceName: raw.device_name,
        lastIp: raw.last_ip,
        lastPort: raw.last_port,
        pairedAt: raw.paired_at,
        lastSyncAt: raw.last_sync_at,
    };
}

// ─── Device Identity ───

/** Get this device's identity (ID, name, public key). */
export async function getDeviceIdentity(): Promise<DeviceIdentityInfo> {
    requireTauri("getDeviceIdentity");
    return invoke<DeviceIdentityInfo>("get_device_identity");
}

// ─── Paired Devices ───

/** Get all paired devices. */
export async function getPairedDevices(): Promise<PairedDevice[]> {
    requireTauri("getPairedDevices");
    const raw = await invoke<
        Array<{
            device_id: string;
            device_name: string;
            last_ip: string;
            last_port: number;
            paired_at: string;
            last_sync_at?: string;
        }>
    >("get_paired_devices");

    return raw.map((d) => ({
        deviceId: d.device_id,
        deviceName: d.device_name,
        lastIp: d.last_ip,
        lastPort: d.last_port,
        pairedAt: d.paired_at,
        lastSyncAt: d.last_sync_at,
    }));
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
 */
export async function setSyncData(
    domainsJson: string,
    manifestJson: string,
): Promise<void> {
    requireTauri("setSyncData");
    return invoke("set_sync_data", { domainsJson, manifestJson });
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

/**
 * Discover a paired peer's current address on the LAN.
 *
 * Probes the peer's last-known IP on a range of candidate ports.
 * On success, updates the stored address and returns [ip, port].
 * On failure, throws with a descriptive error message.
 */
export async function discoverPeer(
    peerDeviceId: string,
): Promise<[string, number]> {
    requireTauri("discoverPeer");
    return invoke<[string, number]>("discover_peer", { peerDeviceId });
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
 * Pull book binary files from a paired peer device.
 *
 * Checks which of the given book IDs have files on the peer,
 * then transfers each file via chunked encrypted HTTP, verifies
 * integrity (SHA-256), and saves to the local book-cache.
 *
 * Emits `sync-file-progress` events that can be listened to for UI updates.
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

