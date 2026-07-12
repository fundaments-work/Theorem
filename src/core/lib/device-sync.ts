/**
 * Theorem – Device Sync Frontend Module
 *
 * Wraps all Tauri IPC commands for the iroh P2P device sync feature.
 * This is the single point of interaction between the React UI
 * and the Rust sync backend.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env";
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

/** Request a book file from a paired peer using the theorem-file/v1 QUIC stream. */
export async function requestBookFile(peerDeviceId: string, bookId: string): Promise<Uint8Array | null> {
    if (!isTauri()) return null;
    try {
        const result = await invoke<number[]>("request_book_file", { peerDeviceId, bookId });
        return new Uint8Array(result);
    } catch (e) {
        console.error(`[file-xfer] requestBookFile failed for ${bookId}: ${e}`);
        return null;
    }
}


