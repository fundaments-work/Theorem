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
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Notify};

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
    /// When this pairing session was created — expires after 5 minutes.
    pub created_at: std::time::Instant,
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

// ─── Port Persistence ───

const PREFERRED_PORT_FILE: &str = "sync-preferred-port";

/// Load the preferred port from disk.
fn load_preferred_port(app_data_dir: &Path) -> Option<u16> {
    let path = app_data_dir.join(PREFERRED_PORT_FILE);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| s.trim().parse::<u16>().ok())
        .filter(|&p| p > 0)
}

/// Save the preferred port to disk.
fn save_preferred_port(app_data_dir: &Path, port: u16) {
    let path = app_data_dir.join(PREFERRED_PORT_FILE);
    let _ = std::fs::write(&path, port.to_string());
}

// ─── Server Lifecycle ───

/// Start the sync server, reusing the previously bound port if possible.
///
/// Returns a handle that can be used to shut down the server.
pub async fn start_server(state: Arc<SyncServerState>) -> Result<SyncServerHandle, String> {
    let app = Router::new()
        .route("/health", get(handle_health))
        .route("/pair", post(handle_pair))
        .route("/sync/manifest", post(handle_sync_manifest))
        .route("/sync/push/{domain}", post(handle_sync_push))
        .route("/sync/pull/{domain}", post(handle_sync_pull))
        .route("/sync/push-batch", post(handle_sync_push_batch))
        .route("/sync/pull-batch", post(handle_sync_pull_batch))
        .route("/sync/complete", post(handle_sync_complete))
        .route("/sync/file/availability", post(handle_file_availability))
        .route("/sync/file/pull", post(handle_file_pull))
        .route("/sync/file/cover", post(handle_cover_pull))
        .with_state(state.clone());

    // Try to reuse the previously bound port. Fall back to a random port.
    let preferred_port = load_preferred_port(&state.app_data_dir);
    let listener = if let Some(port) = preferred_port {
        match TcpListener::bind(format!("0.0.0.0:{port}")).await {
            Ok(l) => l,
            Err(_) => {
                // Port unavailable (another process took it) — fall back to random.
                TcpListener::bind("0.0.0.0:0")
                    .await
                    .map_err(|e| format!("Failed to bind sync server: {e}"))?
            }
        }
    } else {
        TcpListener::bind("0.0.0.0:0")
            .await
            .map_err(|e| format!("Failed to bind sync server: {e}"))?
    };

    let addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get server address: {e}"))?;

    // Persist the port so next restart tries the same one.
    save_preferred_port(&state.app_data_dir, addr.port());

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

    let payload = sync_crypto::encrypt_payload(sym_key, &json).map_err(|e| {
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

    // Reject if the pairing session has expired (5-minute window).
    if pending.created_at.elapsed() > std::time::Duration::from_secs(300) {
        return Err((StatusCode::GONE, "Pairing session has expired".into()));
    }

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
    let now = sync_crypto::now_iso8601();
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
        if let Err(e) = save_paired_devices(&state.app_data_dir, &devices) {
            eprintln!("[sync] Failed to persist paired devices after pairing: {e}");
        }
    }

    // Clear the pending pairing session.
    {
        let mut pending_guard = state.pending_pairing.lock().await;
        *pending_guard = None;
    }

    // Create encrypted acknowledgment.
    let ack_payload = sync_crypto::encrypt_payload(&symmetric_key, b"THEOREM_PAIR_ACK")
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
        let local_dv = local_manifest.get(&domain);
        let remote_dv = remote_manifest.domains.get(&domain);

        let local_ver = local_dv.map(|v| v.version).unwrap_or(0);
        let remote_ver = remote_dv.map(|v| v.version).unwrap_or(0);
        let local_hash = local_dv.map(|v| v.content_hash.as_str()).unwrap_or("");
        let remote_hash = remote_dv.map(|v| v.content_hash.as_str()).unwrap_or("");

        let direction = if local_ver == 0 && remote_ver == 0 {
            SyncDirection::Skip
        } else if !local_hash.is_empty() && !remote_hash.is_empty() && local_hash == remote_hash {
            // Content hashes match — data is identical, skip entirely.
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

/// Validate that a domain name is in the SYNC_DOMAINS whitelist.
fn validate_domain(domain: &str) -> Result<(), (StatusCode, String)> {
    if !SYNC_DOMAINS.contains(&domain) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("Unknown sync domain: {}", domain),
        ));
    }
    Ok(())
}

/// POST /sync/push/:domain — Receive domain data from a peer.
async fn handle_sync_push(
    State(state): State<Arc<SyncServerState>>,
    axum::extract::Path(domain): axum::extract::Path<String>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    validate_domain(&domain)?;

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
    validate_domain(&domain)?;

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

/// POST /sync/push-batch — Receive multiple domains from a peer in one request.
async fn handle_sync_push_batch(
    State(state): State<Arc<SyncServerState>>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    let (payload, sym_key): (BatchedDomainPayload, [u8; 32]) =
        decrypt_request(&state, &req).await?;

    // Validate all domain names before processing any.
    for domain in payload.domains.keys() {
        validate_domain(domain)?;
    }

    let domain_count = payload.domains.len();

    {
        let mut sync_data = state.sync_data.lock().await;
        if let Some(data) = sync_data.as_mut() {
            for (domain, data_json) in &payload.domains {
                data.domains
                    .insert(format!("incoming_{}", domain), data_json.clone());
            }
        }
    }

    // Notify the frontend that new data arrived.
    if let Some(ref emitter) = state.event_emitter {
        let event_payload =
            serde_json::json!({ "domains": payload.domains.keys().collect::<Vec<_>>() })
                .to_string();
        emitter("sync-incoming-data", &event_payload);

        // Fallback: trigger a merge opportunity immediately after batched push.
        // This keeps responder-side convergence robust even if the initiator's
        // later /sync/complete notification is delayed or dropped.
        let complete_like_payload = serde_json::json!({
            "peer_device_id": payload.sender_device_id,
            "timestamp": sync_crypto::now_iso8601(),
            "source": "push_batch",
        })
        .to_string();
        emitter("sync-incoming-complete", &complete_like_payload);
    }

    let response = serde_json::json!({
        "status": "received",
        "domain_count": domain_count,
    });
    encrypt_response(&sym_key, &response)
}

/// POST /sync/pull-batch — Send multiple domains to a peer in one response.
async fn handle_sync_pull_batch(
    State(state): State<Arc<SyncServerState>>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    let (pull_req, sym_key): (BatchedPullRequest, [u8; 32]) = decrypt_request(&state, &req).await?;

    // Validate all requested domain names.
    for domain in &pull_req.domains {
        validate_domain(domain)?;
    }

    let sync_data = state.sync_data.lock().await;
    let mut response_domains: HashMap<String, String> = HashMap::new();

    for domain in &pull_req.domains {
        let data_json = sync_data
            .as_ref()
            .and_then(|d| d.domains.get(domain))
            .cloned()
            .unwrap_or_else(|| "[]".to_string());
        response_domains.insert(domain.clone(), data_json);
    }

    let response = BatchedPullResponse {
        domains: response_domains,
    };
    encrypt_response(&sym_key, &response)
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

        // Save the initiator's current server address so this device (the responder)
        // can connect back to pull book files or initiate reverse syncs.
        if !message.server_ip.is_empty() && message.server_port > 0 {
            device.last_ip = message.server_ip.clone();
            device.last_port = message.server_port;
        }

        if let Err(e) = save_paired_devices(&state.app_data_dir, &devices) {
            eprintln!("[sync] Failed to persist paired devices after sync complete: {e}");
        }
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

// ─── File Transfer Handlers ───

/// The subdirectory under app_data_dir where materialized book files are stored.
const BOOK_CACHE_DIR: &str = "book-cache";
/// SQLite database filename under app_data_dir.
const SQLITE_DB_FILE: &str = "theorem.db";

/// Validate that a book ID is safe for use in file paths.
/// Rejects path traversal characters, null bytes, and non-alphanumeric chars
/// (only allows alphanumeric, hyphens, and underscores).
fn validate_book_id(book_id: &str) -> Result<(), (StatusCode, String)> {
    if book_id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "Empty book ID".into()));
    }
    if book_id.len() > 256 {
        return Err((StatusCode::BAD_REQUEST, "Book ID too long".into()));
    }
    if book_id.contains('\0')
        || book_id.contains('/')
        || book_id.contains('\\')
        || book_id.contains("..")
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Book ID contains illegal characters".into(),
        ));
    }
    // Only allow alphanumeric, hyphens, underscores, and colons (for rss:articleId).
    if !book_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':')
    {
        return Err((
            StatusCode::BAD_REQUEST,
            "Book ID contains disallowed characters".into(),
        ));
    }
    Ok(())
}

/// Resolve the on-disk path for a book's binary data.
/// Caller MUST validate book_id with `validate_book_id` before calling.
fn book_file_path(app_data_dir: &Path, book_id: &str) -> PathBuf {
    app_data_dir
        .join(BOOK_CACHE_DIR)
        .join(format!("{book_id}.book"))
}

fn sqlite_database_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SQLITE_DB_FILE)
}

/// Ensure a transferable `.book` file exists for the given book ID.
///
/// Fast path: use existing `book-cache/<id>.book`.
/// Fallback: if cache file is missing, try materializing from SQLite `books.data`.
fn resolve_book_file_for_transfer(
    app_data_dir: &Path,
    book_id: &str,
) -> Result<Option<(PathBuf, u64)>, String> {
    let cache_path = book_file_path(app_data_dir, book_id);

    // If a stale 0-byte file exists on disk, remove it and re-try from SQLite.
    if let Ok(metadata) = std::fs::metadata(&cache_path) {
        if metadata.is_file() && metadata.len() > 0 {
            return Ok(Some((cache_path, metadata.len())));
        }
        // Stale empty file — delete it so we fall through to SQLite.
        let _ = std::fs::remove_file(&cache_path);
    }

    let db_path = sqlite_database_path(app_data_dir);
    if !db_path.exists() {
        return Ok(None);
    }

    let connection = Connection::open(&db_path)
        .map_err(|error| format!("Failed to open SQLite database '{db_path:?}': {error}"))?;

    let blob = connection
        .query_row(
            "SELECT data FROM books WHERE id = ?1",
            params![book_id],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to query SQLite book blob for '{book_id}': {error}"))?;

    let Some(blob_data) = blob else {
        return Ok(None);
    };
    if blob_data.is_empty() {
        return Ok(None);
    }

    if let Some(parent_dir) = cache_path.parent() {
        std::fs::create_dir_all(parent_dir).map_err(|error| {
            format!("Failed to create book cache directory '{parent_dir:?}': {error}")
        })?;
    }
    std::fs::write(&cache_path, &blob_data).map_err(|error| {
        format!("Failed to materialize book file for '{book_id}' at '{cache_path:?}': {error}")
    })?;

    // Best-effort cleanup: once materialized, we no longer need duplicate blob bytes in SQLite.
    let _ = connection.execute(
        "UPDATE books SET data = X'' WHERE id = ?1",
        params![book_id],
    );

    let metadata = std::fs::metadata(&cache_path).map_err(|error| {
        format!(
            "Failed to stat materialized book file for '{book_id}' at '{cache_path:?}': {error}"
        )
    })?;
    if metadata.is_file() && metadata.len() > 0 {
        return Ok(Some((cache_path, metadata.len())));
    }

    Ok(None)
}

/// POST /sync/file/availability — Check which book files this device has on disk.
///
/// Accepts a list of book IDs and returns which ones have `.book` files available
/// along with their file sizes (for progress estimation on the requesting side).
async fn handle_file_availability(
    State(state): State<Arc<SyncServerState>>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    let (availability_req, sym_key): (FileAvailabilityRequest, [u8; 32]) =
        decrypt_request(&state, &req).await?;

    let app_data_dir = state.app_data_dir.clone();
    let requested_book_ids = availability_req.book_ids;
    let (available_ids, file_sizes, cover_sizes) = tokio::task::spawn_blocking(move || {
        let mut available_ids = Vec::new();
        let mut file_sizes: HashMap<String, u64> = HashMap::new();

        for book_id in &requested_book_ids {
            // Skip book IDs that fail path-safety validation.
            if validate_book_id(book_id).is_err() {
                continue;
            }

            match resolve_book_file_for_transfer(&app_data_dir, book_id) {
                Ok(Some((_path, size))) => {
                    available_ids.push(book_id.clone());
                    file_sizes.insert(book_id.clone(), size);
                }
                Ok(None) => {}
                Err(error) => {
                    eprintln!(
                        "[sync] File availability resolution failed for '{book_id}': {error}"
                    );
                }
            }
        }

        // Also resolve cover availability.
        let cover_sizes = resolve_cover_sizes(&app_data_dir, &requested_book_ids);

        (available_ids, file_sizes, cover_sizes)
    })
    .await
    .map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("File availability task failed: {error}"),
        )
    })?;

    let response = FileAvailabilityResponse {
        available_ids,
        file_sizes,
        cover_sizes,
    };
    encrypt_response(&sym_key, &response)
}

/// Look up cover data_url sizes from SQLite for a set of book IDs.
/// Returns a map of book_id → data_url byte length for books that have covers.
fn resolve_cover_sizes(app_data_dir: &Path, book_ids: &[String]) -> HashMap<String, u64> {
    let db_path = app_data_dir.join(SQLITE_DB_FILE);
    if !db_path.exists() || book_ids.is_empty() {
        return HashMap::new();
    }

    let connection = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };

    let mut sizes = HashMap::new();
    for book_id in book_ids {
        if let Ok(Some(len)) = connection
            .query_row(
                "SELECT length(data_url) FROM covers WHERE book_id = ?1",
                params![book_id],
                |row| row.get::<_, u64>(0),
            )
            .optional()
        {
            if len > 0 {
                sizes.insert(book_id.clone(), len);
            }
        }
    }
    sizes
}

/// POST /sync/file/pull — Serve a single book file to a peer.
///
/// Reads the book's binary data from disk, computes a SHA-256 content hash,
/// encrypts the data in 1 MiB chunks (each with its own random nonce + AEAD tag),
/// and returns the `FilePullResponse` directly as JSON.
///
/// Note: The response is NOT wrapped in an outer `EncryptedPayload` envelope
/// because each chunk is already individually AEAD-encrypted. Double-encrypting
/// a 100+ MB payload would waste CPU and inflate the response size by ~33%.
///
/// For a 100 MB file this produces ~100 chunks. Each chunk is base64-encoded,
/// so the JSON response will be ~135 MB. LAN bandwidth makes this acceptable,
/// and the peer reassembles + writes to disk on its end.
async fn handle_file_pull(
    State(state): State<Arc<SyncServerState>>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<FilePullResponse>, (StatusCode, String)> {
    let (pull_req, sym_key): (FilePullRequest, [u8; 32]) = decrypt_request(&state, &req).await?;

    validate_book_id(&pull_req.book_id)?;
    let app_data_dir = state.app_data_dir.clone();
    let book_id = pull_req.book_id.clone();
    let resolved = tokio::task::spawn_blocking(move || {
        resolve_book_file_for_transfer(&app_data_dir, &book_id)
    })
    .await
    .map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("File pull preparation task failed: {error}"),
        )
    })?
    .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;

    let Some((path, _size)) = resolved else {
        let response = FilePullResponse {
            available: false,
            meta: None,
            chunks: Vec::new(),
        };
        return Ok(Json(response));
    };

    // Read the entire file into memory.
    // Book files are typically 1-50 MB (epubs) up to ~500 MB (large PDFs).
    // This is acceptable for a LAN-only sync where memory is not as constrained.
    let file_data = tokio::task::spawn_blocking({
        let path = path.clone();
        move || std::fs::read(&path)
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Task join failed: {e}"),
        )
    })?
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to read book file: {e}"),
        )
    })?;

    let total_size = file_data.len() as u64;

    // Compute SHA-256 content hash for integrity verification on the receiver side.
    let content_hash = {
        let mut hasher = Sha256::new();
        hasher.update(&file_data);
        hex::encode(hasher.finalize())
    };

    // Infer format from the sync_data snapshot's books domain (if available),
    // or fall back to empty string (the receiver already has the Book metadata
    // which includes the format).
    let format = String::new();

    // Encrypt the file data in chunks.
    let encrypted_chunks = sync_crypto::encrypt_file_chunks(&sym_key, &file_data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("File encryption failed: {e}"),
        )
    })?;

    let total_chunks = encrypted_chunks.len() as u32;

    let meta = FileTransferMeta {
        book_id: pull_req.book_id.clone(),
        total_size,
        total_chunks,
        format,
        content_hash,
    };

    let chunks: Vec<FileTransferChunk> = encrypted_chunks
        .into_iter()
        .enumerate()
        .map(|(i, data_b64)| FileTransferChunk {
            book_id: pull_req.book_id.clone(),
            chunk_index: i as u32,
            total_chunks,
            data_b64,
        })
        .collect();

    let response = FilePullResponse {
        available: true,
        meta: Some(meta),
        chunks,
    };

    Ok(Json(response))
}

// ─── Helpers ───

/// POST /sync/file/cover — Serve a book's cover image to a peer.
///
/// Reads the cover data_url from SQLite and returns it as an encrypted response.
/// Covers are small (typically <1 MB data URLs), so no chunking is needed.
async fn handle_cover_pull(
    State(state): State<Arc<SyncServerState>>,
    Json(req): Json<AuthenticatedRequest>,
) -> Result<Json<EncryptedPayload>, (StatusCode, String)> {
    let (cover_req, sym_key): (CoverPullRequest, [u8; 32]) = decrypt_request(&state, &req).await?;

    validate_book_id(&cover_req.book_id)?;

    let app_data_dir = state.app_data_dir.clone();
    let book_id = cover_req.book_id.clone();

    let cover_data_url = tokio::task::spawn_blocking(move || -> Option<String> {
        let db_path = app_data_dir.join(SQLITE_DB_FILE);
        if !db_path.exists() {
            return None;
        }
        let connection = Connection::open(&db_path).ok()?;
        connection
            .query_row(
                "SELECT data_url FROM covers WHERE book_id = ?1",
                params![book_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .ok()
            .flatten()
            .filter(|s| !s.is_empty())
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Cover pull task failed: {e}"),
        )
    })?;

    let response = CoverPullResponse {
        available: cover_data_url.is_some(),
        data_url: cover_data_url,
    };
    encrypt_response(&sym_key, &response)
}
