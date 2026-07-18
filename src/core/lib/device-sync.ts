
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env";
import type {
    PairedDevice,
    DeviceIdentityInfo,
    PairingQrData,
} from "../types";

function requireTauri(label: string): void {
    if (!isTauri()) {
        throw new Error(`[DeviceSync] ${label} requires Tauri runtime`);
    }
}

export interface IrohNodeIdResponse {
    nodeId: string;
    deviceId: string;
    fingerprint: string;
}

export async function irohStart(): Promise<IrohNodeIdResponse> {
    requireTauri("irohStart");
    return invoke<IrohNodeIdResponse>("iroh_start");
}

export async function irohStop(): Promise<void> {
    requireTauri("irohStop");
    return invoke("iroh_stop");
}

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

export async function generatePairingQr(): Promise<PairingQrData> {
    requireTauri("generatePairingQr");
    return invoke<PairingQrData>("generate_pairing_qr");
}

export async function submitPairingCode(
    pairingCode: string,
): Promise<PairedDevice> {
    requireTauri("submitPairingCode");
    const raw = await invoke<PairedDevice>("submit_pairing_code", { pairingCode });
    return raw;
}

export async function getDeviceIdentity(): Promise<DeviceIdentityInfo> {
    requireTauri("getDeviceIdentity");
    return invoke<DeviceIdentityInfo>("get_device_identity");
}

export async function setDeviceFingerprint(
    fingerprint: string,
): Promise<void> {
    requireTauri("setDeviceFingerprint");
    return invoke("set_device_fingerprint", { fingerprint });
}

export async function getPairedDevices(): Promise<PairedDevice[]> {
    requireTauri("getPairedDevices");
    const raw = await invoke<PairedDevice[]>("get_paired_devices");
    return raw;
}

export async function unpairDevice(deviceId: string): Promise<void> {
    requireTauri("unpairDevice");
    return invoke("unpair_device", { deviceId });
}

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
