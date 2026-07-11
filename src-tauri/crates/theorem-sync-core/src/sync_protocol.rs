/// Theorem LAN Sync — Protocol Types
///
/// Defines all message types, device metadata, and sync manifest structures
/// used in the peer-to-peer synchronization protocol.
use serde::{Deserialize, Serialize};

// ─── Device Identity (frontend-visible) ───

/// Lightweight device identity info returned to the frontend.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentityInfo {
    pub device_id: String,
    pub device_name: String,
    pub public_key_hex: String,
    /// Stable device fingerprint used for deduplication.
    #[serde(default)]
    pub fingerprint: String,
}

// ─── Pairing ───

/// Payload encoded into the QR code shown by the host device.
/// The scanner decodes this to initiate the pairing handshake.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PairingQrPayload {
    pub version: u8,
    pub node_id: String,
    pub device_id: String,
    pub device_name: String,
    #[serde(default)]
    pub fingerprint: String,
    /// Local IPv4/IPv6 addresses of the host for LAN-direct pairing
    /// without requiring internet (N0 DNS/relay fallback).
    #[serde(default)]
    pub lan_addrs: Vec<String>,
}

/// Data returned to the frontend after generating a pairing QR code.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PairingQrData {
    /// SVG string of the QR code.
    pub qr_svg: String,
    /// The raw pairing payload as a JSON string (for manual entry fallback).
    pub pairing_code: String,
}

/// Request sent by the scanning device to the host's /pair endpoint.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PairingRequest {
    pub device_id: String,
    pub device_name: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub node_id: String,
}

/// Response sent by the host back to the scanner after successful pairing.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PairingResponse {
    pub device_id: String,
    pub device_name: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub sync_doc_ticket: String,
}

// ─── Paired Device (persisted) ───

/// A paired peer device. Persisted to disk so pairing survives app restarts.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PairedDevice {
    /// Peer's persistent device ID.
    pub device_id: String,
    /// Peer's human-readable device name.
    pub device_name: String,
    /// Peer's iroh node ID (public key string) for QUIC connectivity.
    #[serde(default)]
    pub iroh_node_id: String,
    pub last_ip: String,
    /// Last known port of the peer's sync server.
    pub last_port: u16,
    /// ISO 8601 timestamp when pairing was established.
    pub paired_at: String,
    /// ISO 8601 timestamp of the last successful sync (if any).
    pub last_sync_at: Option<String>,
    /// Peer's stable device fingerprint for deduplication.
    #[serde(default)]
    pub fingerprint: String,
    /// Peer's iroh relay URL for reconnection across restarts.
    #[serde(default)]
    pub peer_relay_url: String,
    /// iroh-docs NamespaceId for the shared sync document (base64 string).
    #[serde(default)]
    pub sync_doc_id: String,
    /// DocTicket for re-importing the shared doc after database reset.
    #[serde(default)]
    pub sync_doc_ticket: String,
}

/// Frontend-safe view of a paired device (no symmetric key exposed).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PairedDeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub last_ip: String,
    pub last_port: u16,
    pub paired_at: String,
    pub last_sync_at: Option<String>,
    /// Peer's stable device fingerprint for deduplication.
    #[serde(default)]
    pub fingerprint: String,
    /// Peer's iroh relay URL for reconnection.
    #[serde(default)]
    pub peer_relay_url: String,
    /// iroh-docs NamespaceId for the shared sync document (base64 string).
    #[serde(default)]
    pub sync_doc_id: String,
    /// DocTicket for re-importing the shared doc after database reset.
    #[serde(default)]
    pub sync_doc_ticket: String,
}

impl From<&PairedDevice> for PairedDeviceInfo {
    fn from(device: &PairedDevice) -> Self {
        Self {
            device_id: device.device_id.clone(),
            device_name: device.device_name.clone(),
            last_ip: device.last_ip.clone(),
            last_port: device.last_port,
            paired_at: device.paired_at.clone(),
            last_sync_at: device.last_sync_at.clone(),
            fingerprint: device.fingerprint.clone(),
            peer_relay_url: device.peer_relay_url.clone(),
            sync_doc_id: device.sync_doc_id.clone(),
            sync_doc_ticket: device.sync_doc_ticket.clone(),
        }
    }
}
