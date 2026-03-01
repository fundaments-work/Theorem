/// Theorem LAN Sync — Protocol Types
///
/// Defines all message types, device metadata, and sync manifest structures
/// used in the peer-to-peer synchronization protocol.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Device Identity (frontend-visible) ───

/// Lightweight device identity info returned to the frontend.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceIdentityInfo {
    pub device_id: String,
    pub device_name: String,
    pub public_key_hex: String,
}

// ─── Pairing ───

/// Payload encoded into the QR code shown by the host device.
/// The scanner decodes this to initiate the pairing handshake.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PairingQrPayload {
    /// Protocol version (for forward compatibility).
    pub version: u8,
    /// Host device LAN IP address.
    pub ip: String,
    /// Host device sync server port.
    pub port: u16,
    /// Host's ephemeral X25519 public key (hex-encoded, 64 chars).
    pub ephemeral_public_key: String,
    /// Host device ID (first 16 hex chars of SHA-256 of long-term public key).
    pub device_id: String,
    /// Human-readable device name.
    pub device_name: String,
    /// Random 32-byte nonce (hex-encoded), used as HKDF salt.
    pub nonce: String,
}

/// Data returned to the frontend after generating a pairing QR code.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PairingQrData {
    /// SVG string of the QR code.
    pub qr_svg: String,
    /// The raw pairing payload as a JSON string (for manual entry fallback).
    pub pairing_code: String,
}

/// Request sent by the scanning device to the host's /pair endpoint.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PairingRequest {
    /// Scanner's ephemeral X25519 public key (hex-encoded).
    pub ephemeral_public_key: String,
    /// Scanner's persistent device ID.
    pub device_id: String,
    /// Scanner's human-readable device name.
    pub device_name: String,
    /// Encrypted proof: ChaCha20-Poly1305(derived_key, "THEOREM_PAIR_V1").
    /// Proves the scanner has the correct shared secret.
    pub encrypted_proof: String,
}

/// Response sent by the host back to the scanner after successful pairing.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PairingResponse {
    /// Host's persistent device ID.
    pub device_id: String,
    /// Host's human-readable device name.
    pub device_name: String,
    /// Encrypted acknowledgment (proves the host also has the shared secret).
    pub encrypted_ack: String,
}

// ─── Paired Device (persisted) ───

/// A paired peer device. Persisted to disk so pairing survives app restarts.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PairedDevice {
    /// Peer's persistent device ID.
    pub device_id: String,
    /// Peer's human-readable device name.
    pub device_name: String,
    /// Base64-encoded symmetric key derived during pairing (32 bytes).
    /// Used for all subsequent encrypted communication with this peer.
    pub symmetric_key_b64: String,
    /// Last known IP address of the peer.
    pub last_ip: String,
    /// Last known port of the peer's sync server.
    pub last_port: u16,
    /// ISO 8601 timestamp when pairing was established.
    pub paired_at: String,
    /// ISO 8601 timestamp of the last successful sync (if any).
    pub last_sync_at: Option<String>,
}

/// Frontend-safe view of a paired device (no symmetric key exposed).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PairedDeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub last_ip: String,
    pub last_port: u16,
    pub paired_at: String,
    pub last_sync_at: Option<String>,
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
        }
    }
}

// ─── Sync Manifest ───

/// Version stamp for a single data domain.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct DomainVersion {
    /// Monotonic version counter or max timestamp for this domain.
    pub version: u64,
    /// Number of items in this domain.
    pub item_count: u32,
    /// ISO 8601 timestamp of the last modification in this domain.
    pub last_modified_at: String,
}

/// A manifest describing the current state of all data domains on a device.
/// Exchanged at the start of a sync to determine what needs to be transferred.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncManifest {
    /// Device ID of the manifest owner.
    pub device_id: String,
    /// ISO 8601 timestamp of the last successful sync with any peer.
    pub last_sync_at: Option<String>,
    /// Version stamps per data domain.
    pub domains: HashMap<String, DomainVersion>,
}

/// The sync direction for a specific domain.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum SyncDirection {
    /// Initiator should push data to the responder.
    Push,
    /// Initiator should pull data from the responder.
    Pull,
    /// Both have same version; no transfer needed.
    Skip,
    /// Both have changes; bidirectional merge needed.
    Merge,
}

/// Describes what action to take for a specific data domain during sync.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncAction {
    /// The data domain (e.g., "annotations", "vocabulary", "books").
    pub domain: String,
    /// Transfer direction.
    pub direction: SyncDirection,
    /// Local version stamp.
    pub local_version: u64,
    /// Remote version stamp.
    pub remote_version: u64,
}

/// Response to a manifest exchange: the list of actions to perform.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncPlan {
    pub actions: Vec<SyncAction>,
}

// ─── Sync Data Payloads ───

use crate::sync_crypto::EncryptedPayload;

/// Wrapper for any encrypted sync request.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuthenticatedRequest {
    pub device_id: String,
    pub payload: EncryptedPayload,
}

/// Wrapper for domain data being pushed or pulled.
/// The `data_json` is the serialized domain data (e.g., annotations array).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncDomainPayload {
    /// The data domain name.
    pub domain: String,
    /// Device ID of the sender.
    pub sender_device_id: String,
    /// Serialized domain data as a JSON string.
    pub data_json: String,
    /// Number of items in the payload.
    pub item_count: u32,
}

/// Confirmation sent after all domains have been synced.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncCompleteMessage {
    /// Device ID of the sender.
    pub device_id: String,
    /// ISO 8601 timestamp to record as the new last-sync time.
    pub sync_timestamp: String,
}

// ─── Server Info ───

/// Information about the running sync server, returned to the frontend.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncServerInfo {
    /// The LAN IP address the server is bound to.
    pub ip: String,
    /// The port the server is listening on.
    pub port: u16,
    /// Whether the server is currently running.
    pub running: bool,
}

/// Health check response.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HealthResponse {
    pub status: String,
    pub device_id: String,
    pub device_name: String,
    pub version: String,
}

// ─── Sync Status (for frontend) ───

/// Overall sync operation status reported to the frontend.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncStatus {
    pub state: SyncState,
    pub message: Option<String>,
    pub progress: Option<SyncProgress>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum SyncState {
    Idle,
    ServerRunning,
    Pairing,
    Syncing,
    Completed,
    Error,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SyncProgress {
    pub current_domain: String,
    pub domains_completed: u32,
    pub domains_total: u32,
    pub bytes_transferred: u64,
}

// ─── Well-Known Sync Domains ───

/// All recognized data domains for synchronization.
pub const SYNC_DOMAINS: &[&str] = &[
    "books",
    "annotations",
    "collections",
    "vocabulary",
    "settings",
    "reading_stats",
    "rss_feeds",
    "rss_articles",
];
