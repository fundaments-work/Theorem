/// Theorem LAN Sync — Embedded HTTP Server
///
/// An axum-based HTTP server that runs inside the Tauri application,
/// enabling peer-to-peer sync between Theorem devices on the same LAN.
use crate::sync_crypto::{self, DeviceIdentity, EncryptedPayload};
use crate::sync_protocol::*;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};
use tower_http::cors::{Any, CorsLayer};

// ─── Event Emitter ───

/// Type-erased event emitter callback.
/// Accepts (event_name, payload_json) and emits to the Tauri frontend.
pub type EventEmitter = Arc<dyn Fn(&str, &str) + Send + Sync>;

// ─── Server State ───

/// Shared state for the sync server.
pub struct SyncServerState {
    /// This device's persistent identity.
    pub identity: DeviceIdentity,
    /// Human-readable device name.
    pub device_name: String,
    /// All paired peer devices, keyed by device_id.
    pub paired_devices: Mutex<HashMap<String, PairedDevice>>,
    /// Path to the app data directory (for persisting paired devices).
    pub app_data_dir: PathBuf,
    /// Pending pairing session (if any). Only one pairing at a time.
    pub pending_pairing: Mutex<Option<PendingPairing>>,
    /// Data provider callback — called by sync handlers to get/set domain data.
    /// This is populated by the Tauri command layer which has access to the frontend stores.
    pub sync_data: Mutex<Option<SyncDataSnapshot>>,
    /// Optional event emitter for notifying the frontend about incoming sync data.
    /// Injected from the Tauri command layer which has access to AppHandle.
    pub event_emitter: Option<EventEmitter>,
}

/// Ephemeral state for an in-progress pairing handshake.
pub struct PendingPairing {
    /// The host's X25519 static secret (used for this pairing).
    pub host_secret_bytes: [u8; 32],
    /// The nonce used as HKDF salt.
    pub nonce: [u8; 32],
    /// Hex-encoded nonce for matching.
    pub nonce_hex: String,
}

/// Snapshot of app data provided by the frontend for sync operations.
/// This is set before a sync and read by the server handlers.
#[derive(Clone, Debug, Default)]
pub struct SyncDataSnapshot {
    /// JSON-serialized data per domain.
    pub domains: HashMap<String, String>,
    /// Version stamps per domain.
    pub manifest: HashMap<String, DomainVersion>,
}

/// Handle to a running sync server, used for shutdown.
pub struct SyncServerHandle {
    pub addr: SocketAddr,
    pub shutdown_notify: Arc<Notify>,
}

// ─── Server Lifecycle ───

/// Start the sync server on a random available port.
///
/// Returns a handle that can be used to shut down the server.
pub async fn start_server(state: Arc<SyncServerState>) -> Result<SyncServerHandle, String> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(handle_health))
        .route("/pair", post(handle_pair))
        .route("/sync/manifest", post(handle_sync_manifest))
        .route("/sync/push/{domain}", post(handle_sync_push))
        .route("/sync/pull/{domain}", post(handle_sync_pull))
        .route("/sync/complete", post(handle_sync_complete))
        .layer(cors)
        .with_state(state.clone());

    // Bind to any available port on all interfaces.
    let listener = TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Failed to bind sync server: {e}"))?;

    let addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get server address: {e}"))?;

    let shutdown_notify = Arc::new(Notify::new());
    let shutdown_clone = shutdown_notify.clone();

    // Spawn the server in a background tokio task.
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                shutdown_clone.notified().await;
            })
            .await
            .ok();
    });

    Ok(SyncServerHandle {
        addr,
        shutdown_notify,
    })
}

/// Get the device's LAN IP address.
pub fn get_local_ip() -> Result<String, String> {
    local_ip_address::local_ip()
        .map(|ip| ip.to_string())
        .map_err(|e| format!("Failed to determine local IP: {e}"))
}

// ─── Paired Devices Persistence ───

const PAIRED_DEVICES_FILE: &str = "sync-paired-devices.json";

/// Load paired devices from disk.
pub fn load_paired_devices(app_data_dir: &Path) -> HashMap<String, PairedDevice> {
    let path = app_data_dir.join(PAIRED_DEVICES_FILE);
    if !path.exists() {
        return HashMap::new();
    }

    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

/// Save paired devices to disk.
pub fn save_paired_devices(
    app_data_dir: &Path,
    devices: &HashMap<String, PairedDevice>,
) -> Result<(), String> {
    let path = app_data_dir.join(PAIRED_DEVICES_FILE);
    let content = serde_json::to_string_pretty(devices)
        .map_err(|e| format!("Failed to serialize paired devices: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write paired devices: {e}"))?;
    Ok(())
}

// ─── Route Handlers ───

async fn decrypt_request<T: serde::de::DeserializeOwned>(
    state: &Arc<SyncServerState>,
    req: &AuthenticatedRequest,
) -> Result<(T, [u8; 32]), (StatusCode, String)> {
    let devices = state.paired_devices.lock().await;
    let device = devices
        .get(&req.device_id)
        .ok_or_else(|| (StatusCode::FORBIDDEN, "Device not paired".into()))?;

    let sym_key_vec = BASE64
        .decode(&device.symmetric_key_b64)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Key err: {e}")))?;

    let sym_key: [u8; 32] = sym_key_vec.try_into().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Key length is not 32 bytes".into(),
        )
    })?;

    drop(devices);

    let decrypted = sync_crypto::decrypt_payload(&sym_key, &req.payload)
        .map_err(|e| (StatusCode::FORBIDDEN, format!("Decrypt failed: {}", e)))?;

    let obj = serde_json::from_slice(&decrypted)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Parse failed: {}", e)))?;

    Ok((obj, sym_key))
}

fn encrypt_response<T: serde::Serialize>(
    sym_key: &[u8; 32],
    data: &T,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    let json = serde_json::to_vec(data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Serialize failed: {}", e),
        )
    })?;

    let payload = sync_crypto::encrypt_payload(sym_key, 0, &json).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Encrypt failed: {}", e),
        )
    })?;

    Ok(Json(payload))
}

/// GET /health — Server health check.
async fn handle_health(State(state): State<Arc<SyncServerState>>) -> impl IntoResponse {
    Json(HealthResponse {
        status: "ok".to_string(),
        device_id: state.identity.device_id.clone(),
        device_name: state.device_name.clone(),
        version: "1".to_string(),
    })
}

/// POST /pair — Handle incoming pairing request from scanner device.
async fn handle_pair(
    State(state): State<Arc<SyncServerState>>,
    Json(request): Json<PairingRequest>,
) -> Result<Json<PairingResponse>, (StatusCode, String)> {
    let pending_guard = state.pending_pairing.lock().await;
    let pending = pending_guard
        .as_ref()
        .ok_or((StatusCode::BAD_REQUEST, "No pairing session active".into()))?;

    // Decode scanner's ephemeral public key.
    let peer_public_bytes: [u8; 32] = hex::decode(&request.ephemeral_public_key)
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("Invalid public key: {e}")))?
        .try_into()
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                "Public key must be 32 bytes".into(),
            )
        })?;

    // Compute shared secret using the host's secret and scanner's public key.
    // We use StaticSecret here because the pairing secret was stored as bytes.
    let host_secret = x25519_dalek::StaticSecret::from(pending.host_secret_bytes);
    let peer_public = x25519_dalek::PublicKey::from(peer_public_bytes);
    let shared_secret_obj = host_secret.diffie_hellman(&peer_public);
    let shared_secret: [u8; 32] = *shared_secret_obj.as_bytes();

    // Derive symmetric key.
    let symmetric_key =
        sync_crypto::derive_symmetric_key(&shared_secret, &pending.nonce, b"theorem-sync-v1")
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Verify the encrypted proof from the scanner.
    let proof_bytes = BASE64.decode(&request.encrypted_proof).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid proof encoding: {e}"),
        )
    })?;

    let proof_payload: EncryptedPayload = serde_json::from_slice(&proof_bytes).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid proof format: {e}"),
        )
    })?;

    let decrypted_proof =
        sync_crypto::decrypt_payload(&symmetric_key, &proof_payload).map_err(|e| {
            (
                StatusCode::UNAUTHORIZED,
                format!("Proof verification failed: {e}"),
            )
        })?;

    if decrypted_proof != b"THEOREM_PAIR_V1" {
        return Err((StatusCode::UNAUTHORIZED, "Invalid pairing proof".into()));
    }

    // Pairing successful — save the peer device.
    let now = chrono_now_iso();
    let paired_device = PairedDevice {
        device_id: request.device_id.clone(),
        device_name: request.device_name.clone(),
        symmetric_key_b64: BASE64.encode(symmetric_key),
        last_ip: String::new(), // Will be updated on first sync
        last_port: 0,
        paired_at: now.clone(),
        last_sync_at: None,
    };

    drop(pending_guard);

    // Save to memory and disk.
    {
        let mut devices = state.paired_devices.lock().await;
        devices.insert(request.device_id.clone(), paired_device);
        let _ = save_paired_devices(&state.app_data_dir, &devices);
    }

    // Clear the pending pairing session.
    {
        let mut pending_guard = state.pending_pairing.lock().await;
        *pending_guard = None;
    }

    // Create encrypted acknowledgment.
    let ack_payload = sync_crypto::encrypt_payload(&symmetric_key, 0, b"THEOREM_PAIR_ACK")
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let ack_json = serde_json::to_string(&ack_payload).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Ack serialization failed: {e}"),
        )
    })?;

    Ok(Json(PairingResponse {
        device_id: state.identity.device_id.clone(),
        device_name: state.device_name.clone(),
        encrypted_ack: BASE64.encode(ack_json.as_bytes()),
    }))
}

/// POST /sync/manifest — Exchange sync manifests and return a sync plan.
async fn handle_sync_manifest(
    State(state): State<Arc<SyncServerState>>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    // Decrypt the manifest from the peer
    let (remote_manifest, sym_key): (SyncManifest, [u8; 32]) =
        decrypt_request(&state, &req).await?;

    // Get local data snapshot.
    let sync_data = state.sync_data.lock().await;
    let local_manifest = match sync_data.as_ref() {
        Some(data) => &data.manifest,
        None => {
            return Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Sync data not available — app may still be loading".into(),
            ));
        }
    };

    // Compare manifests per domain.
    let mut actions = Vec::new();
    for domain_name in SYNC_DOMAINS {
        let domain = domain_name.to_string();
        let local_ver = local_manifest.get(&domain).map(|v| v.version).unwrap_or(0);
        let remote_ver = remote_manifest
            .domains
            .get(&domain)
            .map(|v| v.version)
            .unwrap_or(0);

        let direction = if local_ver == 0 && remote_ver == 0 {
            SyncDirection::Skip
        } else if local_ver == 0 && remote_ver > 0 {
            // Only remote has data → remote should push to us.
            SyncDirection::Push
        } else if local_ver > 0 && remote_ver == 0 {
            // Only we have data → remote should pull from us.
            SyncDirection::Pull
        } else {
            // Both sides have data → always merge (bidirectional).
            // This is intentional: item count is not a reliable version.
            // The merge functions handle deduplication idempotently,
            // and LAN bandwidth is not a constraint.
            SyncDirection::Merge
        };

        actions.push(SyncAction {
            domain,
            direction,
            local_version: local_ver,
            remote_version: remote_ver,
        });
    }

    let plan = SyncPlan { actions };
    encrypt_response(&sym_key, &plan)
}

/// POST /sync/push/:domain — Receive domain data from a peer.
async fn handle_sync_push(
    State(state): State<Arc<SyncServerState>>,
    axum::extract::Path(domain): axum::extract::Path<String>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    // Decrypt the domain payload from the peer
    let (payload, sym_key): (SyncDomainPayload, [u8; 32]) = decrypt_request(&state, &req).await?;

    // Store the incoming data in the sync snapshot for the frontend to process.
    {
        let mut sync_data = state.sync_data.lock().await;
        if let Some(data) = sync_data.as_mut() {
            data.domains
                .insert(format!("incoming_{}", domain), payload.data_json.clone());
        }
    }

    // Notify the frontend that new data arrived for this domain.
    if let Some(ref emitter) = state.event_emitter {
        let event_payload = serde_json::json!({ "domain": domain }).to_string();
        emitter("sync-incoming-data", &event_payload);
    }

    let response = serde_json::json!({
        "status": "received",
        "domain": domain,
        "item_count": payload.item_count,
    });
    encrypt_response(&sym_key, &response)
}

/// POST /sync/pull/:domain — Send domain data to a peer.
async fn handle_sync_pull(
    State(state): State<Arc<SyncServerState>>,
    axum::extract::Path(domain): axum::extract::Path<String>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    // Decrypt the request empty trigger
    let (_request, sym_key): (Value, [u8; 32]) = decrypt_request(&state, &req).await?;

    // Get the requested domain data.
    let sync_data = state.sync_data.lock().await;
    let data_json = sync_data
        .as_ref()
        .and_then(|d| d.domains.get(&domain))
        .cloned()
        .unwrap_or_else(|| "[]".to_string());

    let item_count = serde_json::from_str::<Value>(&data_json)
        .ok()
        .and_then(|v| v.as_array().map(|a| a.len() as u32))
        .unwrap_or(0);

    let payload = SyncDomainPayload {
        domain,
        sender_device_id: state.identity.device_id.clone(),
        data_json,
        item_count,
    };
    encrypt_response(&sym_key, &payload)
}

/// POST /sync/complete — Record sync completion.
async fn handle_sync_complete(
    State(state): State<Arc<SyncServerState>>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    let (message, sym_key): (SyncCompleteMessage, [u8; 32]) = decrypt_request(&state, &req).await?;

    let mut devices = state.paired_devices.lock().await;
    if let Some(device) = devices.get_mut(&message.device_id) {
        device.last_sync_at = Some(message.sync_timestamp.clone());
        let _ = save_paired_devices(&state.app_data_dir, &devices);
    }
    drop(devices);

    // Notify the frontend that the sync session is complete and it should merge.
    if let Some(ref emitter) = state.event_emitter {
        let event_payload = serde_json::json!({
            "peer_device_id": message.device_id,
            "timestamp": message.sync_timestamp,
        })
        .to_string();
        emitter("sync-incoming-complete", &event_payload);
    }

    let response = serde_json::json!({
        "status": "sync_complete",
        "timestamp": message.sync_timestamp,
    });
    encrypt_response(&sym_key, &response)
}

// ─── Helpers ───

/// Get current time as ISO 8601 string without pulling in the chrono crate.
fn chrono_now_iso() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();

    // Simple ISO 8601 approximation (good enough for sync timestamps).
    let days = secs / 86400;
    let remaining = secs % 86400;
    let hours = remaining / 3600;
    let minutes = (remaining % 3600) / 60;
    let seconds = remaining % 60;

    // Days since 1970-01-01 → approximate date.
    let mut year = 1970i64;
    let mut remaining_days = days as i64;
    loop {
        let days_in_year = if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
            366
        } else {
            365
        };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let is_leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let month_days: [i64; 12] = [
        31,
        if is_leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1u32;
    for &md in &month_days {
        if remaining_days < md {
            break;
        }
        remaining_days -= md;
        month += 1;
    }
    let day = remaining_days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}
